/**
 * ReactiveSphere v3.0 - Esfera Abstracta Interactiva
 * - Red exterior tipo planeta (dispersa)
 * - Núcleo neuronal denso interior
 * - Colores: blanco
 * - Audio interactivo con botón micrófono
 * - Con tars (dueño): la red blanca sigue tu voz y el núcleo azul la de TARS
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CiMicrophoneOff, CiMicrophoneOn } from "react-icons/ci";
import "./ReactiveSphere.css";

/* ==================== AUDIO HOOK ==================== */
// shortcut: umbrales de volumen calibrados a ojo; si corta frases, graba ruido o se interrumpe solo, ajustarlos
const VOICE_THRESHOLD = 0.12;
const BARGE_IN_THRESHOLD = 0.3; // sin reconocimiento de voz: hablar fuerte 0,4 s interrumpe a TARS
const BARGE_IN_MS = 400;
const SILENCE_MS = 900;      // silencio que cierra una frase
const MIN_PHRASE_MS = 400;   // más corto que esto es un ruido, no una frase
const FOLLOW_UP_MS = 8000;   // tras hablar con TARS, la siguiente frase no necesita su nombre (como Alexa)
const NAME_GRACE_MS = 1000;  // el reconocimiento del navegador llega un poco después de que termina la frase
const NOTICES_EVERY_MS = 60000;
// /project-tars?debug muestra en pantalla el volumen y lo que oyó (sirve en el celular, sin consola)
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
const WAKE_WORD = /\b(tars|tarz|thars|tares|tarts)\b/i;
const STOP_WORD = /\b(tars|tarz|basta|silencio|detente|c[aá]llate|stop)\b/i;
// Solo para callarlo ("TARS, basta"): se calla y escucha, sin responderle a eso
const ONLY_STOP = /^\W*(oye\W+)?(tars\W*)?(basta|para|silencio|detente|c[aá]llate|stop|espera|ya)?\W*(tars)?\W*$/i;
const BARGE_WORDS = 2;       // palabras tuyas (no de lo que TARS está diciendo) que lo interrumpen
const BARGE_VOICE_MS = 700;  // y el micrófono (con cancelación de eco) tiene que haber oído voz hace menos de esto

/** Palabras de un texto sin tildes ni signos, para comparar lo que oyó Chrome con lo que dice TARS. */
function words(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-zñ0-9]+/g) || [];
}

// "TARS" no es palabra del español: el reconocedor de Chrome casi nunca la escribe igual ("tas", "taz", "dars",
// "tarse", "stars"...) y antes eso descartaba la frase sin avisar. Ahora una palabra parecida manda la frase a
// Whisper, que confirma el nombre (lo que no empiece con "TARS" se ignora en el backend).
const PARECIDAS = new Set(["taz", "tarse", "tarsis", "tarso", "taras", "stars", "star", "thar", "tharz", "thaz"]);
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}
/** true si alguna de las tres primeras palabras suena a "TARS" ("Oye tas, ¿qué hora es?"). */
function pareceTars(texto) {
  const palabras = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z]+/g) || [];
  return palabras.slice(0, 3).some((p) => PARECIDAS.has(p) || (p.length >= 3 && p.length <= 5 && distancia(p, "tars") <= 1));
}

function audioLevel(analyser, buffer) {
  analyser.getByteFrequencyData(buffer);
  return Math.min(1, buffer.reduce((a, b) => a + b, 0) / buffer.length / 200);
}

function chime(ctx, frequency = 880) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Reconocimiento de voz del navegador, solo para oír "TARS" sin mandar cada frase a Groq.
 * En el propio equipo si Chrome lo permite (processLocally); si no, el de Google. null si el navegador no tiene.
 */
async function startNameListener(onText, isStopped, onError) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = "es-ES";
  rec.continuous = true;
  rec.interimResults = true;
  let local = false;
  try {
    const options = { langs: ["es-ES"], processLocally: true };
    const status = await Recognition.available?.(options);
    if (status === "downloadable" || status === "downloading") await Recognition.install(options);
    if (status && status !== "unavailable") local = rec.processLocally = true;
  } catch (err) {
    console.info("TARS: reconocimiento local no disponible, uso el del navegador", err);
  }
  let dead = false;
  let lastResultAt = -Infinity;
  rec.onresult = (e) => {
    lastResultAt = performance.now();
    for (let i = e.resultIndex; i < e.results.length; i++) onText(e.results[i][0].transcript);
  };
  rec.onerror = (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") console.warn("TARS: el reconocimiento de voz falló:", e.error);
    onError?.(e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") dead = true;
  };
  rec.onend = () => { if (!dead && !isStopped()) setTimeout(() => { try { rec.start(); } catch { /* ya iniciado */ } }, 250); };
  rec.start();
  console.info(`TARS: escucho su nombre ${local ? "en este equipo" : "con el reconocimiento del navegador"}`);
  return {
    stop: () => { dead = true; rec.abort(); },
    isAlive: () => !dead,
    // ¿El navegador entregó algún texto desde t? Si no, no sabe si dijeron "TARS" y decide Whisper
    heardSince: (t) => lastResultAt >= t,
    local,
  };
}

/**
 * Micrófono siempre abierto mientras active. Con tars ({ hear, reply, say, notices }):
 * - Solo atiende frases con su nombre, salvo con la barra espaciadora o justo después de que habló.
 * - Habla frase a frase según llegan, y se calla si le hablas encima (o con la barra, "TARS", "basta"...): lo que
 *   dijiste se graba desde que empezaste y se responde sin necesitar su nombre.
 * - Cada minuto pregunta si tiene algo que avisar (correos urgentes, agenda).
 */
function useVoice(active, tars) {
  const [userLevel, setUserLevel] = useState(0);
  const [tarsLevel, setTarsLevel] = useState(0);
  // idle | blocked | sleeping (espera su nombre) | listening | thinking | speaking
  const [phase, setPhase] = useState("idle");
  const tarsRef = useRef(tars);
  tarsRef.current = tars;
  // Diagnóstico para ?debug: volumen, qué entendió Chrome y qué decidió TARS (se muestra en pantalla)
  const diagRef = useRef({});

  useEffect(() => {
    if (!active) return;
    const diag = diagRef.current;
    let stopped = false;
    let raf, stream, ctx, followTimer, noticesTimer, nameListener, wakeLock;
    let recorder = null;
    let busy = false;       // TARS escucha, piensa o habla: no se graba (no escucharse a sí mismo)
    let speaking = false;
    let ptt = false;        // barra espaciadora presionada
    let followUntil = 0, startedAt = 0, lastVoice = 0, heardNameAt = -Infinity, loudSince = 0;
    let soundsLikeNameAt = -Infinity, lastHeard = "";
    let current = null;     // { controller, source } de la respuesta que está sonando
    let saying = new Set(); // palabras de lo que TARS dice en esta respuesta: si Chrome las oye, es su eco
    let bargedIn = false;   // le hablaron encima: la grabación en curso es la siguiente frase
    const cleanups = [];

    const idlePhase = () => setPhase(performance.now() < followUntil ? "listening" : "sleeping");
    const openFollowUp = () => {
      followUntil = performance.now() + FOLLOW_UP_MS;
      clearTimeout(followTimer);
      followTimer = setTimeout(() => { if (!busy && !recorder && !stopped) idlePhase(); }, FOLLOW_UP_MS + 50);
    };

    const interrupt = () => {
      if (!current) return;
      current.controller.abort();
      try { current.source?.stop(); } catch { /* ya terminó */ }
      current = null;
      if (ctx) chime(ctx); // ya te escucha: lo siguiente no necesita su nombre
    };
    const discardRecording = () => {
      if (!recorder) return;
      recorder.onstop = null;
      recorder.stop();
      recorder = null;
    };
    // Le hablaron encima: se calla y sigue la grabación que empezó con tu voz (si no había, empieza ya)
    let startRecording;
    const bargeIn = (why) => {
      if (!current) return;
      diag.decision = `interrumpido: ${why}`;
      interrupt();
      bargedIn = true;
      if (!recorder) startRecording(performance.now(), false);
      setPhase("listening");
    };

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        console.warn("Micrófono no disponible:", err);
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());

      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const mic = ctx.createAnalyser();
      mic.fftSize = 512;
      mic.smoothingTimeConstant = 0.8;
      ctx.createMediaStreamSource(stream).connect(mic);
      const voice = ctx.createAnalyser();
      voice.fftSize = 512;
      voice.connect(ctx.destination);
      const buffer = new Uint8Array(mic.frequencyBinCount);

      // El navegador no deja sonar audio hasta que el usuario toca la página (pasa al abrirla con el micrófono ya permitido)
      if (ctx.state === "suspended") setPhase("blocked");
      else idlePhase();
      const resume = () => ctx.state === "suspended" && ctx.resume().then(() => !stopped && idlePhase());
      window.addEventListener("pointerdown", resume);
      window.addEventListener("keydown", resume);
      cleanups.push(() => {
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      });

      // Pantalla siempre encendida mientras TARS escucha (modo estación, como un Alexa)
      const keepAwake = async () => {
        try { if (document.visibilityState === "visible") wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* sin permiso */ }
      };
      keepAwake();
      document.addEventListener("visibilitychange", keepAwake);
      cleanups.push(() => document.removeEventListener("visibilitychange", keepAwake));

      if (tarsRef.current) {
        nameListener = await startNameListener((text) => {
          lastHeard = text;
          diag.oido = text;
          if (WAKE_WORD.test(text)) heardNameAt = performance.now();
          else if (pareceTars(text)) soundsLikeNameAt = performance.now();
          if (!current) return;
          if (STOP_WORD.test(text)) return speaking ? bargeIn(`«${text}»`) : interrupt(); // también mientras piensa
          // Mientras habla: palabras que no son las suyas y voz en el micrófono = le estás hablando
          const tuyas = words(text).filter((w) => w.length > 2 && !saying.has(w));
          if (speaking && tuyas.length >= BARGE_WORDS && performance.now() - lastVoice < BARGE_VOICE_MS) {
            bargeIn(`«${text}»`);
          }
        }, () => stopped, (error) => { diag.error = error; });
        diag.reconocedor = nameListener ? (nameListener.local ? "local" : "del navegador") : "no hay";
      }
      const listensLocally = () => nameListener?.isAlive();

      const play = (audioBuffer, controller) => new Promise((resolve) => {
        if (controller.signal.aborted) return resolve();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(voice);
        source.onended = resolve;
        current = { controller, source };
        speaking = true;
        setPhase("speaking");
        source.start();
      });

      // Habla y, al terminar, deja 8 s para responderle sin decir su nombre
      const talk = async (produce) => {
        busy = true;
        saying = new Set();
        bargedIn = false;
        const controller = new AbortController();
        current = { controller, source: null };
        try {
          await produce(controller);
        } catch (err) {
          if (err.name !== "AbortError") {
            console.warn("TARS:", err);
            chime(ctx, 330); // tono grave: algo falló
          }
        } finally {
          speaking = false;
          if (current?.controller === controller) current = null;
          // Lo que se grabó mientras hablaba sin que lo interrumpieran es su propio eco: no se manda
          if (!bargedIn) discardRecording();
          busy = false;
          if (!stopped) {
            openFollowUp();
            if (bargedIn) setPhase("listening");
            else idlePhase();
          }
        }
      };

      const reply = (text) => talk(async (controller) => {
        setPhase("thinking");
        let queue = Promise.resolve();
        for await (const event of tarsRef.current.reply(text, controller.signal)) {
          if (event.type === "error") throw new Error(event.detail);
          if (event.type !== "audio") continue;
          words(event.text || "").forEach((w) => saying.add(w));
          const decoded = ctx.decodeAudioData(base64ToBuffer(event.mp3)); // decodifica mientras suena la anterior
          queue = queue.then(async () => play(await decoded, controller));
        }
        await queue;
      });

      const handle = async (blob, wake) => {
        busy = true;
        try {
          const heard = await tarsRef.current.hear(blob, wake);
          diag.whisper = heard.awake ? `con el nombre: «${heard.text}»` : "no empezaba con «TARS»";
          if (stopped || !heard.awake) return;
          chime(ctx);
          if (heard.text && !ONLY_STOP.test(heard.text)) return await reply(heard.text);
          openFollowUp(); // solo dijo "TARS": escucha la siguiente frase
        } catch (err) {
          console.warn("TARS:", err);
        } finally {
          if (!speaking && !current) {
            busy = false;
            if (!stopped) idlePhase();
          }
        }
      };

      // needsName: undefined = según la barra y los 8 s de seguimiento; false = le hablaron encima
      startRecording = (now, needsName = !ptt && now >= followUntil) => {
        const parts = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => parts.push(e.data);
        recorder.onstop = function () {
          const done = () => { busy = false; if (!stopped) idlePhase(); };
          if (stopped || this.phraseMs < MIN_PHRASE_MS) return done();
          const blob = new Blob(parts, { type: this.mimeType });
          if (!needsName) return handle(blob, false);
          if (!listensLocally()) return handle(blob, true); // sin reconocimiento en el navegador: Whisper busca el nombre
          // Solo se manda a Groq si el navegador oyó "TARS" en esta frase
          const phraseStart = startedAt;
          setTimeout(() => {
            const desde = phraseStart - 1500;
            if (heardNameAt >= desde) return handle(blob, false);
            if (soundsLikeNameAt >= desde) return handle(blob, true); // Whisper confirma el nombre
            // El navegador no entregó nada (pasa en el celular, que comparte el micrófono): decide Whisper
            if (!nameListener.heardSince(desde)) { diag.decision = "Chrome no entendió nada: va a Whisper"; return handle(blob, true); }
            diag.decision = `ignorado: «${lastHeard}»`;
            console.info(`TARS: sin su nombre, ignoro «${lastHeard}»`); // en la consola (F12) se ve qué entendió
            done();
          }, NAME_GRACE_MS);
        };
        recorder.start();
        startedAt = now;
        if (!needsName && !speaking) setPhase("listening");
      };
      const stopRecording = (phraseMs) => {
        busy = true;
        recorder.phraseMs = phraseMs;
        recorder.stop();
        recorder = null;
      };

      // Callarlo sin depender del micrófono: con los parlantes de la laptop, el reconocedor oye sobre todo a TARS y
      // tu "basta" se pierde. Tocar la pantalla o Escape lo callan siempre (el botón del micrófono apaga todo).
      const shush = (why) => {
        if (!current) return;
        diag.decision = `callado: ${why}`;
        interrupt();
        openFollowUp(); // lo siguiente que digas no necesita su nombre
        setPhase("listening");
      };
      const onTap = (e) => { if (!e.target.closest?.("button")) shush("tocaste la pantalla"); };
      window.addEventListener("pointerdown", onTap);
      cleanups.push(() => window.removeEventListener("pointerdown", onTap));

      const onKeyDown = (e) => {
        if (e.code === "Escape") return shush("Escape");
        if (e.code !== "Space" || e.repeat || !tarsRef.current || e.target.closest?.("input, textarea")) return;
        e.preventDefault();
        if (speaking || current) {
          interrupt(); // la barra también lo calla
          bargedIn = true; // que al terminar no descarte lo que grabas con la barra
        } else if (busy) return;
        discardRecording(); // descarta lo que grababa sola
        busy = false;
        ptt = true;
        startRecording(performance.now());
      };
      const onKeyUp = (e) => {
        if (e.code !== "Space" || !ptt) return;
        ptt = false;
        if (recorder) stopRecording(performance.now() - startedAt);
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      cleanups.push(() => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      });

      // Avisos por iniciativa propia: solo si está libre (no interrumpe una conversación)
      const checkNotices = async () => {
        if (stopped || busy || recorder || ptt || !tarsRef.current || ctx.state !== "running") return;
        try {
          const notices = await tarsRef.current.notices();
          if (!notices.length || busy || recorder) return;
          await talk(async (controller) => {
            chime(ctx, 660);
            for (const text of notices) {
              words(text).forEach((w) => saying.add(w));
              const audio = await ctx.decodeAudioData(await tarsRef.current.say(text));
              await play(audio, controller);
              if (controller.signal.aborted) break;
            }
          });
        } catch (err) {
          console.warn("TARS avisos:", err);
        }
      };
      noticesTimer = setInterval(checkNotices, NOTICES_EVERY_MS);
      setTimeout(checkNotices, 3000);

      const tick = () => {
        if (stopped) return;
        const level = audioLevel(mic, buffer);
        diag.nivel = Math.max(level, (diag.nivel || 0) * 0.97); // pico que baja despacio, para leerlo en pantalla
        diag.grabando = !!recorder;
        setUserLevel((prev) => prev * 0.82 + (busy && !speaking ? 0 : level) * 0.18);
        setTarsLevel((prev) => prev * 0.82 + audioLevel(voice, buffer) * 0.18);

        const now = performance.now();
        if (speaking && tarsRef.current && !ptt) {
          // Graba desde que empiezas a hablarle encima, para no perder el inicio si resulta que lo interrumpes;
          // si no era voz tuya, se descarta en silencio
          if (level > VOICE_THRESHOLD) {
            lastVoice = now;
            if (!recorder) startRecording(now, false);
          } else if (recorder && !bargedIn && now - lastVoice > SILENCE_MS) discardRecording();
          // Sin reconocimiento del navegador, interrumpir es hablarle fuerte un momento
          if (!listensLocally()) {
            if (level > BARGE_IN_THRESHOLD) {
              loudSince ||= now;
              if (now - loudSince > BARGE_IN_MS) bargeIn("voz fuerte");
            } else loudSince = 0;
          }
        }
        if (tarsRef.current && !busy && !ptt) {
          if (level > VOICE_THRESHOLD) {
            lastVoice = now;
            if (!recorder) startRecording(now);
          } else if (recorder && now - lastVoice > SILENCE_MS) {
            stopRecording(lastVoice - startedAt);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(followTimer);
      clearInterval(noticesTimer);
      current?.controller.abort();
      try { current?.source?.stop(); } catch { /* ya terminó */ }
      nameListener?.stop();
      wakeLock?.release().catch(() => {});
      cleanups.forEach((fn) => fn());
      if (recorder?.state === "recording") recorder.stop();
      stream?.getTracks().forEach((t) => t.stop()); // apaga el micrófono del todo
      ctx?.close();
      setPhase("idle");
      setUserLevel(0);
      setTarsLevel(0);
    };
  }, [active]);

  return { userLevel, tarsLevel, phase, diag: diagRef.current };
}

/* ==================== NEURAL NODES GENERATOR ==================== */
function generateNeuralNodes(count, radiusBase = 3.5) {
  const positions = new Float32Array(count * 3);
  const originalPositions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const energies = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const u = Math.random();
    
    // Esfera más redonda con menor distorsión
    const radiusNoise = Math.sin(t * Math.PI * 2) * 0.08 + Math.cos(u * Math.PI) * 0.06;
    const r = radiusBase + radiusNoise;

    const theta = Math.acos(2 * t - 1);
    const phi = u * Math.PI * 2;

    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    originalPositions[i * 3] = x;
    originalPositions[i * 3 + 1] = y;
    originalPositions[i * 3 + 2] = z;

    seeds[i] = Math.random();
    energies[i] = 0;
  }

  return { positions, originalPositions, seeds, energies };
}

/* ==================== OUTER PLANET NETWORK ==================== */
function OuterPlanetNetwork({ audioLevel }) {
  const pointsRef = useRef();
  const linesRef = useRef();
  const count = 500;

  const neuralData = useMemo(() => generateNeuralNodes(count, 3.5), [count]);
  const lineGeometryRef = useRef(null);
  const linePositionsRef = useRef(new Float32Array(count * 200 * 3));

  useEffect(() => {
    if (!lineGeometryRef.current) {
      lineGeometryRef.current = new THREE.BufferGeometry();
    }
    const posAttr = new THREE.BufferAttribute(linePositionsRef.current, 3);
    lineGeometryRef.current.setAttribute("position", posAttr);
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;

    const t = state.clock.getElapsedTime();
    const particles = pointsRef.current.geometry.attributes.position.array;
    const { originalPositions, seeds, energies } = neuralData;

    for (let i = 0; i < count; i++) {
      const wave1 = Math.sin(t * 0.3 + seeds[i] * Math.PI * 2) * 0.12;
      const wave2 = Math.cos(t * 0.25 + seeds[i] * Math.PI) * 0.1;
      const wave3 = Math.sin(t * 0.35 + seeds[i] * Math.PI * 1.5) * 0.11;

      energies[i] = Math.max(0, energies[i] * 0.92 + audioLevel * 0.08);
      const movementAmp = 0.25 + energies[i] * 0.4;

      particles[i * 3] = originalPositions[i * 3] + wave1 * movementAmp;
      particles[i * 3 + 1] = originalPositions[i * 3 + 1] + wave2 * movementAmp;
      particles[i * 3 + 2] = originalPositions[i * 3 + 2] + wave3 * movementAmp;
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;

    if (lineGeometryRef.current) {
      const linePos = linePositionsRef.current;
      let lineIdx = 0;
      const CONNECTION_DISTANCE = 1.4;
      const maxLines = count * 12;

      for (let i = 0; i < count && lineIdx < maxLines; i++) {
        for (let j = i + 1; j < count && lineIdx < maxLines; j++) {
          const dx = particles[i * 3] - particles[j * 3];
          const dy = particles[i * 3 + 1] - particles[j * 3 + 1];
          const dz = particles[i * 3 + 2] - particles[j * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < CONNECTION_DISTANCE) {
            linePos[lineIdx * 3] = particles[i * 3];
            linePos[lineIdx * 3 + 1] = particles[i * 3 + 1];
            linePos[lineIdx * 3 + 2] = particles[i * 3 + 2];
            lineIdx++;

            linePos[lineIdx * 3] = particles[j * 3];
            linePos[lineIdx * 3 + 1] = particles[j * 3 + 1];
            linePos[lineIdx * 3 + 2] = particles[j * 3 + 2];
            lineIdx++;
          }
        }
      }

      lineGeometryRef.current.attributes.position.needsUpdate = true;
      lineGeometryRef.current.setDrawRange(0, lineIdx);
    }
  });

  const pointSize = 0.04 + audioLevel * 0.06;

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={count}
            array={neuralData.positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={pointSize}
          sizeAttenuation
          depthWrite={true}
          color="#ffffff"
          transparent
          opacity={0.7}
          fog={false}
        />
      </points>

      {lineGeometryRef.current && (
        <lineSegments geometry={lineGeometryRef.current} ref={linesRef}>
          <lineBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.15 + audioLevel * 0.3}
            blending={THREE.AdditiveBlending}
            linewidth={1}
            fog={false}
          />
        </lineSegments>
      )}
    </>
  );
}

/* ==================== DENSE INNER NEURAL NETWORK ==================== */
function InnerNeuralNetwork({ audioLevel }) {
  const pointsRef = useRef();
  const linesRef = useRef();
  const coreRef = useRef();
  const count = 800;

  const neuralData = useMemo(() => generateNeuralNodes(count, 1.2), [count]);
  const lineGeometryRef = useRef(null);
  const linePositionsRef = useRef(new Float32Array(count * 120 * 3));

  useEffect(() => {
    if (!lineGeometryRef.current) {
      lineGeometryRef.current = new THREE.BufferGeometry();
    }
    const posAttr = new THREE.BufferAttribute(linePositionsRef.current, 3);
    lineGeometryRef.current.setAttribute("position", posAttr);
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;

    const t = state.clock.getElapsedTime();
    const particles = pointsRef.current.geometry.attributes.position.array;
    const { originalPositions, seeds, energies } = neuralData;

    // Pulso sincronizado para núcleo y nodos
    const basePulse = Math.sin(t * 0.6) * 0.08 + 1;
    const audioBoost = audioLevel * 0.12;
    const globalScale = basePulse + audioBoost;

    for (let i = 0; i < count; i++) {
      const wave1 = Math.sin(t * 0.4 + seeds[i] * Math.PI * 2) * 0.06;
      const wave2 = Math.cos(t * 0.3 + seeds[i] * Math.PI) * 0.05;
      const wave3 = Math.sin(t * 0.5 + seeds[i] * Math.PI * 1.5) * 0.06;

      energies[i] = Math.max(0, energies[i] * 0.92 + audioLevel * 0.1);
      const movementAmp = 0.12 + energies[i] * 0.2;

      // Aplicar escala global de respiración + ondas individuales
      particles[i * 3] = (originalPositions[i * 3] + wave1 * movementAmp) * globalScale;
      particles[i * 3 + 1] = (originalPositions[i * 3 + 1] + wave2 * movementAmp) * globalScale;
      particles[i * 3 + 2] = (originalPositions[i * 3 + 2] + wave3 * movementAmp) * globalScale;
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;

    // Animar núcleo con respiración controlada
    if (coreRef.current) {
      coreRef.current.scale.setScalar(globalScale);

      const glowIntensity = 0.5 + audioLevel * 0.8;
      if (coreRef.current.material.emissiveIntensity !== undefined) {
        coreRef.current.material.emissiveIntensity = glowIntensity;
      }
    }

    if (lineGeometryRef.current) {
      const linePos = linePositionsRef.current;
      let lineIdx = 0;
      const CONNECTION_DISTANCE = 1.2;
      const maxLines = count * 25;

      for (let i = 0; i < count && lineIdx < maxLines; i++) {
        for (let j = i + 1; j < count && lineIdx < maxLines; j++) {
          const dx = particles[i * 3] - particles[j * 3];
          const dy = particles[i * 3 + 1] - particles[j * 3 + 1];
          const dz = particles[i * 3 + 2] - particles[j * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < CONNECTION_DISTANCE) {
            linePos[lineIdx * 3] = particles[i * 3];
            linePos[lineIdx * 3 + 1] = particles[i * 3 + 1];
            linePos[lineIdx * 3 + 2] = particles[i * 3 + 2];
            lineIdx++;

            linePos[lineIdx * 3] = particles[j * 3];
            linePos[lineIdx * 3 + 1] = particles[j * 3 + 1];
            linePos[lineIdx * 3 + 2] = particles[j * 3 + 2];
            lineIdx++;
          }
        }
      }

      lineGeometryRef.current.attributes.position.needsUpdate = true;
      lineGeometryRef.current.setDrawRange(0, lineIdx);
    }
  });

  const pointSize = 0.035 + audioLevel * 0.05;

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={count}
            array={neuralData.positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={pointSize}
          sizeAttenuation
          depthWrite={true}
          color="#00bfff"
          transparent
          opacity={0.95}
          fog={false}
        />
      </points>

      {lineGeometryRef.current && (
        <lineSegments geometry={lineGeometryRef.current} ref={linesRef}>
          <lineBasicMaterial
            color="#00bfff"
            transparent
            opacity={0.4 + audioLevel * 0.5}
            blending={THREE.AdditiveBlending}
            linewidth={1}
            fog={false}
          />
        </lineSegments>
      )}

      <mesh ref={coreRef}>
        <sphereGeometry args={[0.95, 128, 128]} />
        <meshStandardMaterial
          color="#00bfff"
          metalness={0.95}
          roughness={0.05}
          emissive="#00bfff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.15}
        />
      </mesh>

      <pointLight intensity={0.8} color="#00bfff" distance={12} />
    </>
  );
}

/* ==================== 3D SCENE ==================== */
function Scene3D({ userLevel, tarsLevel }) {
  const groupRef = useRef();

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.rotation.x += 0.0002;
    groupRef.current.rotation.y += 0.0003;
  });

  return (
    <>
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.2} color="#ffffff" />
      <directionalLight position={[8, 6, 5]} intensity={0.4} color="#ffffff" />
      <pointLight position={[5, 5, 5]} intensity={0.8} color="#ffffff" distance={30} />
      <pointLight position={[-5, -5, -5]} intensity={0.5} color="#ffffff" distance={25} />

      <group ref={groupRef}>
        <OuterPlanetNetwork audioLevel={userLevel} />
        <InnerNeuralNetwork audioLevel={tarsLevel} />
      </group>
    </>
  );
}

/* ==================== MAIN COMPONENT ==================== */
const PHASE_TEXT = {
  idle: "Turn on the microphone to wake TARS",
  blocked: "Click anywhere to wake TARS",
  sleeping: "Say \u201cTARS\u201d or hold Space",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Tap the screen or press Esc to stop",
};

const ReactiveSphere = forwardRef(function ReactiveSphere({ tars = null }, ref) {
  const [listening, setListening] = useState(false);
  const { userLevel, tarsLevel, phase, diag } = useVoice(listening, tars);
  const [debugInfo, setDebugInfo] = useState(null);
  useEffect(() => {
    if (!DEBUG) return;
    const t = setInterval(() => setDebugInfo({ ...diag }), 250);
    return () => clearInterval(t);
  }, [diag]);

  // Como Alexa: si el micrófono ya está permitido, TARS queda escuchando al abrir la página
  useEffect(() => {
    if (!tars) return;
    navigator.permissions?.query({ name: "microphone" })
      .then((p) => p.state === "granted" && setListening(true))
      .catch(() => {});
  }, [tars]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key.toLowerCase() === "m") {
        setListening((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useImperativeHandle(ref, () => ({
    toggleMic: () => setListening((v) => !v),
    isListening: () => listening,
  }));

  return (
    <div className="rs3d-root">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ alpha: true, antialias: true, precision: "highp" }}
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        <Scene3D userLevel={userLevel} tarsLevel={tarsLevel} />
      </Canvas>

      <p className="rs3d-phase" aria-live="polite">{tars ? PHASE_TEXT[phase] : ""}</p>

      {DEBUG && debugInfo && (
        <pre style={{ position: "fixed", top: 8, left: 8, right: 8, margin: 0, padding: 8, fontSize: 12, lineHeight: 1.4,
          whiteSpace: "pre-wrap", color: "#cfe8ff", background: "rgba(0,0,0,0.7)", borderRadius: 8, zIndex: 10 }}>
          {[
            `volumen: ${(debugInfo.nivel || 0).toFixed(3)}  (graba desde ${VOICE_THRESHOLD})${debugInfo.grabando ? "  ● grabando" : ""}`,
            `fase: ${phase}  |  reconocedor: ${debugInfo.reconocedor || "-"}${debugInfo.error ? `  (último error: ${debugInfo.error})` : ""}`,
            `Chrome oyó: ${debugInfo.oido || "-"}`,
            `decisión: ${debugInfo.decision || "-"}`,
            `Whisper: ${debugInfo.whisper || "-"}`,
          ].join("\n")}
        </pre>
      )}

      {/* Botón micrófono */}
      <div className="rs3d-controls">
        <button
          aria-label={listening ? "Detener audio" : "Activar audio"}
          className={`rs3d-mic-btn ${listening ? "listening" : ""}`}
          onClick={(e) => {
            setListening((v) => !v);
            e.currentTarget.blur(); // si queda con foco, la barra espaciadora lo apagaría en vez de hablar con TARS
          }}
          title="Presiona M para alternar"
        >
          {listening ? <CiMicrophoneOff size={22} /> : <CiMicrophoneOn size={22} />}
        </button>
      </div>
    </div>
  );
});

ReactiveSphere.displayName = "ReactiveSphere";

export default ReactiveSphere;
