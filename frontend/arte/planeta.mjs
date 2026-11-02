// Ícono del chat de Jarvis, dibujado con la skill anatomy-asset (~/.claude/skills/anatomy-asset): el planeta
// con anillo del logo, como una maqueta de escritorio sobre su base, con el anillo en azul hielo que brilla despacio.
//
//   node arte/planeta.mjs            → public/arte/planeta.svg (+ vista previa en arte/planeta.html)
//   node arte/planeta.mjs --light    → public/arte/planeta-light.svg (tema claro)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = join(homedir(), ".claude", "skills", "anatomy-asset", "kit");
const k = await import(pathToFileURL(join(KIT, "iso-kit.mjs")).href);
const a = await import(pathToFileURL(join(KIT, "asset.mjs")).href);
const G = await import(pathToFileURL(join(KIT, "lathe.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const light = process.argv.includes("--light");
const PAPER = light ? "#f6f7f9" : "#0b0d12";
const NAME = light ? "planeta-light" : "planeta";
const ICE = light ? "#2b8fc9" : "#8fd3ff";
const W = 240;
const H = 240;
const AZIMUTH = 50;
const ELEVATION = 30;

let P = { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION };
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const brand = (svg) => `<g class="ac-brand">${svg}</g>`;
const pathOf = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;

// ---------- medidas ----------
const BASE_R = 15;
const Z_BASE = 3;
const R = 13;                      // radio del planeta
const C = [0, 0, Z_BASE + 8 + R];  // centro del planeta
const AXIS = G.unit3([0.22, -0.32, 1]);
const RING_IN = R + 3;
const RING_OUT = R + 7.5;

function stand() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -BASE_R - 2, y: -BASE_R - 2, w: 2 * BASE_R + 4, d: 2 * BASE_R + 4, r: BASE_R + 2 }, 0, 3, P)}"/>`];
  out.push(S(k.cylinder(0, 0, BASE_R, 0, Z_BASE, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(0, 0, BASE_R, 1.2, P, 56), { tone: "faint" }) }));
  out.push(L(k.ring(0, 0, BASE_R - 3, Z_BASE, P, 48), { tone: "faint" }));
  out.push(S(k.cylinder(0, 0, 4, Z_BASE, 1.6, P, 32, 0.4), { tone: "hi" }));
  // el poste entra en el planeta por abajo
  out.push(S(k.cylinder(0, 0, 0.9, Z_BASE + 1.6, C[2] - R + 1 - Z_BASE - 1.6, P, 16), { tone: "mid" }));
  const ang = [0, 1, 2].map((i) => (i * 2 * Math.PI) / 3 + 0.4);
  out.push(D(ang.map((t) => at([Math.cos(t) * (BASE_R - 1.6), Math.sin(t) * (BASE_R - 1.6), Z_BASE])), { size: 0.5 }));
  return out.join("");
}

// El anillo es una corona plana (ringBand rellena el contorno entero y tapaba el planeta), en dos mitades:
// la de atrás se pinta antes del planeta y la de adelante después.
const F = G.frameAlong(C, AXIS);
const ringFill = "fill:var(--anatomy-top);stroke:var(--anatomy-hi);stroke-width:var(--anatomy-weight);vector-effect:non-scaling-stroke;stroke-linejoin:round";
const ringPoint = (t, r) => at(G.add3(C, G.add3(G.mul3(F.u, Math.cos(t) * r), G.mul3(F.v, Math.sin(t) * r))));
// ángulo del radio que mira al espectador
const view = G.viewOf(P0());
function P0() { return { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }; }
const NEAR = Math.atan2(G.dot3(view, F.v), G.dot3(view, F.u));
function halfRing(near) {
  const t0 = NEAR + (near ? -Math.PI / 2 : Math.PI / 2);
  const n = 60;
  const outer = Array.from({ length: n + 1 }, (_, i) => ringPoint(t0 + (i / n) * Math.PI, RING_OUT));
  const inner = Array.from({ length: n + 1 }, (_, i) => ringPoint(t0 + ((n - i) / n) * Math.PI, RING_IN));
  const arc = (r) => k.pathOf(Array.from({ length: n + 1 }, (_, i) => ringPoint(t0 + (i / n) * Math.PI, r)), false);
  // el relleno va sin borde para que el corte entre mitades no deje una raya; los bordes son los dos arcos
  return brand(`<path d="${pathOf([...outer, ...inner])}" style="${ringFill};stroke:none"/>` +
    L(arc(RING_IN + 1.6) + arc(RING_OUT - 1.4), { tone: "lo" }) + L(arc(RING_OUT) + arc(RING_IN), { tone: "hi" }));
}

function planet() {
  const out = [];
  const view = G.viewOf(P);
  // cráteres: círculos sobre la superficie, solo los que miran al espectador
  const craters = [[0.3, 0.75, 2.6], [-0.55, 0.45, 1.8], [0.62, 0.15, 1.4], [-0.1, 0.25, 3.2], [-0.45, -0.05, 1.2]];
  const rings = [];
  for (const [u, v, rc] of craters) {
    const n = G.unit3(G.add3(G.add3(G.mul3(view, 0.55), G.mul3(G.unit3(G.cross3(view, [0, 0, 1])), u)), [0, 0, v]));
    if (G.dot3(n, view) < 0.35) continue;
    const Fc = G.frameAlong(G.add3(C, [0, 0, 0]), n);
    rings.push(G.circleOf(Fc, Math.sqrt(R * R - rc * rc), rc, P, 32));
  }
  out.push(S(G.sphereOf(C, R, P), { tone: "mid", inner: L(rings.join(""), { tone: "lo" }) }));
  return out.join("");
}


function body() {
  return [
    stand(),
    halfRing(false),
    planet(),
    a.amPulse(halfRing(true), { period: 4600, min: 0.75 }),
  ].join("");
}

const pts = [...k.boxCorners({ x: -BASE_R, y: -BASE_R, w: 2 * BASE_R, d: 2 * BASE_R }, 0, Z_BASE)];
for (let i = 0; i < 24; i++) {
  const t = (i / 24) * 2 * Math.PI;
  pts.push(G.add3(C, G.add3(G.mul3(F.u, Math.cos(t) * RING_OUT), G.mul3(F.v, Math.sin(t) * RING_OUT))));
}
pts.push([C[0], C[1], C[2] + R]);
P = k.fitProjection(pts, W, H, { pad: 10, azimuth: AZIMUTH, elevation: ELEVATION });

const svg = a.assetSvg({
  width: W,
  height: H,
  label: "Una maqueta de escritorio de un planeta con cráteres y un anillo azul, sobre una base redonda.",
  body: body(),
  paper: PAPER,
  accents: { brand: ICE },
  weight: 0.5,
  id: NAME,
});
mkdirSync(join(HERE, "..", "public", "arte"), { recursive: true });
writeFileSync(join(HERE, "..", "public", "arte", `${NAME}.svg`), svg);
writeFileSync(join(HERE, `${NAME}.html`), a.previewHtml({ title: NAME, svg, paper: PAPER, width: W }));
console.log(`${NAME}.svg ${(svg.length / 1024).toFixed(1)} KB`);
