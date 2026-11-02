// Llamadas de TARS con fetch directo: apiClient aborta sin token y el formulario de contacto es público
const BASE_URL = import.meta.env.VITE_URL;
const APP_ID = import.meta.env.VITE_APP_ID;

async function authHeaders(getToken) {
  const token = await getToken?.({ template: "backend-api-jarvis" });
  return token ? { Authorization: `Bearer ${token}`, "X-Project-Origin": APP_ID } : null;
}

export async function isTarsOwner(getToken) {
  const headers = await authHeaders(getToken);
  if (!headers) return false;
  const res = await fetch(`${BASE_URL}/api/v2/tars/access`, { headers });
  return res.ok && (await res.json()).owner === true;
}

/** Transcribe una frase. Devuelve { awake, text }: awake sin text = solo dijo "TARS". */
export async function hearTars(blob, wake, getToken) {
  const form = new FormData();
  form.append("audio", blob, "voz.webm");
  form.append("wake", wake ? "true" : "false");
  const res = await fetch(`${BASE_URL}/api/v2/tars/hear`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: form,
  });
  if (!res.ok) throw new Error(`TARS no escuchó (${res.status})`);
  return res.json();
}

/** Respuesta de TARS frase a frase: genera eventos { type: "audio", text, mp3 (base64) } | { type: "error" } | { type: "done" }. */
export async function* replyTars(text, getToken, signal) {
  const res = await fetch(`${BASE_URL}/api/v2/tars/reply`, {
    method: "POST",
    headers: { ...(await authHeaders(getToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`TARS no respondió (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (line) yield JSON.parse(line);
    }
  }
}

/** Voz de TARS para un texto ya armado (avisos), en mp3. */
export async function sayTars(text, getToken) {
  const res = await fetch(`${BASE_URL}/api/v2/tars/say`, {
    method: "POST",
    headers: { ...(await authHeaders(getToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TARS no pudo hablar (${res.status})`);
  return res.arrayBuffer();
}

/** Lo que TARS quiere decir por iniciativa propia (correos urgentes, agenda, saludo). */
export async function tarsNotices(getToken) {
  const res = await fetch(`${BASE_URL}/api/v2/tars/notices`, { headers: await authHeaders(getToken) });
  if (!res.ok) throw new Error(`Sin avisos (${res.status})`);
  return (await res.json()).notices;
}

export async function sendContact(data) {
  const res = await fetch(`${BASE_URL}/api/v1/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail;
    throw new Error(typeof detail === "string" ? detail : "The message could not be sent. Please try again.");
  }
}
