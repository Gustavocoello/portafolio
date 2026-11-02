// Imagen de la sección Developer del landing, dibujada con la skill anatomy-asset (~/.claude/skills/anatomy-asset):
// un casco de astronauta junto a una laptop abierta con código en pantalla, sobre una plataforma. El visor y el
// código van en azul hielo; el cursor parpadea y la luz del casco respira.
//
//   node arte/developer.mjs            → public/arte/developer.svg (+ vista previa en arte/developer.html)
//   node arte/developer.mjs --light    → public/arte/developer-light.svg (para el tema claro del landing)

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
const NAME = light ? "developer-light" : "developer";
const ICE = light ? "#2b8fc9" : "#8fd3ff";
const W = 360;
const H = 320;
const AZIMUTH = 55;
const ELEVATION = 32;
const SCREW = 0.55;

let P = { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION };
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const brand = (svg) => `<g class="ac-brand">${svg}</g>`;
const halo = (plan, z, blur = 4) => `<path class="iso-halo" d="${k.haloOf(plan, z, 0.1, P)}" style="filter:blur(${blur}px)"/>`;
const screws = (pts, z, ring = 1.2) =>
  L(pts.map(([x, y]) => k.ring(x, y, ring, z, P, 16)).join(""), { tone: "lo" }) + D(pts.map(([x, y]) => at([x, y, z])), { size: SCREW });

// ---------- la plataforma ----------
const DECK = { x: -46, y: -30, w: 92, d: 60, r: 8 };
const Z_DECK = 4;
function deck() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(DECK, -3), -3, 4, P)}"/>`];
  for (const [x, y] of k.corners(DECK, 10)) out.push(S(k.cylinder(x, y, 3, -3, 3, P, 18), { tone: "lo" }));
  out.push(S(k.slabOf(DECK, 0, Z_DECK, P, 6, 1), { tone: "mid", inner: L(k.sideSeam(DECK, 1.6, P, 6), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(DECK, 4), Z_DECK, P, 5), { tone: "faint" }));
  // dos paneles de cubierta con su junta
  out.push(L(k.lineOnTop([DECK.x + 4, 2], [DECK.x + DECK.w - 4, 2], Z_DECK, P), { tone: "faint" }));
  out.push(screws(k.corners(DECK, 7.5), Z_DECK));
  return out.join("");
}

// ---------- el casco ----------
const HC = [-24, -8];            // centro en planta
const Z_RING = Z_DECK;
const HR = 13;                   // radio de la cúpula
function helmet() {
  const out = [halo({ x: HC[0] - 15, y: HC[1] - 15, w: 30, d: 30, r: 15 }, Z_DECK, 5)];
  // aro del cuello: un anillo grueso con su junta y cuatro trabas
  out.push(S(k.cylinder(HC[0], HC[1], 12, Z_RING, 4, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(HC[0], HC[1], 12, Z_RING + 1.8, P, 56), { tone: "faint" }) }));
  out.push(S(k.cylinder(HC[0], HC[1], 12.8, Z_RING + 4, 1.6, P, 56, 0.4), { tone: "hi" }));
  const C = [HC[0], HC[1], Z_RING + 5.6 + HR - 2];
  const view = G.viewOf(P);
  // el visor mira hacia la laptop: un poco a la derecha de la cámara
  const n = G.unit3(G.add3(G.mul3(view, 1), [0.45, -0.05, -0.05]));
  const visor = G.frameAlong(C, n);
  const VR = 8.4;
  const rim = (r) => G.circleOf(visor, Math.sqrt(HR * HR - r * r), r, P, 64);
  // la cúpula, con el marco del visor dibujado encima de su superficie
  out.push(S(G.sphereOf(C, HR, P), { tone: "hi", inner: L(rim(VR + 1.4), { tone: "mid" }) }));
  // el visor: un óvalo azul hielo con su reflejo
  out.push(brand(`<path d="${rim(VR)}" style="fill:var(--anatomy-top);stroke:var(--anatomy-hi);stroke-width:var(--anatomy-weight);vector-effect:non-scaling-stroke"/>` +
    L(G.arcOf(visor, Math.sqrt(HR * HR - (VR - 2.6) ** 2), VR - 2.6, P, { least: -1, from: 0.4, to: 1.5 }), { tone: "lit", free: true })));
  // la luz de casco a un lado, que respira
  const side = G.unit3(G.cross3([0, 0, 1], n));
  const lp = G.add3(C, G.add3(G.mul3(side, -HR * 0.86), [0, 0, HR * 0.45]));
  const lf = G.frameAlong(lp, G.unit3(G.add3(G.mul3(side, -1), [0, 0, 0.5])));
  out.push(S(G.disc(-0.4, 2.2, 2.6, lf, P), { tone: "mid" }));
  out.push(a.amPulse(brand(S(G.disc(2.2, 2.8, 1.8, lf, P), { tone: "hi", lit: true })), { period: 3800, min: 0.35 }));
  return out.join("");
}

// ---------- la laptop ----------
const LX = 2;
const LY = -8;
const LW = 36;
const LD = 24;
const Z_LAP = Z_DECK;
const TH = 1.6;                 // grosor de la base
const LID = 23;                 // alto de la tapa
const LEAN = (12 * Math.PI) / 180;
function lid() {
  // la tapa gira en la bisagra del borde de atrás y se inclina hacia atrás
  const up = [0, -Math.sin(LEAN), Math.cos(LEAN)];
  const front = [0, Math.cos(LEAN), Math.sin(LEAN)];
  const o = [LX, LY, Z_LAP + TH];
  const F = G.frameOf(o, front, [1, 0, 0], up);
  const out = [S(G.prismOf(F, [[0, 0], [LW, 0], [LW, LID], [0, LID]], -1.1, 0, P), { tone: "mid" })];
  const pt = (x, y) => at(G.add3(o, G.add3(G.mul3([1, 0, 0], x), G.mul3(up, y))));
  const face = (x0, y0, x1, y1) => `M${[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)].map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
  // la pantalla (un panel oscuro dentro del marco) y las líneas de código
  out.push(`<path d="${face(1.6, 1.6, LW - 1.6, LID - 1.6)}" style="fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight);vector-effect:non-scaling-stroke"/>`);
  const lines = [[3, 4, 14], [5, 6.5, 18], [5, 9, 11], [7, 11.5, 15], [5, 13.5, 9], [3, 15.5, 12], [3, 17.5, 7]];
  const seg = (x0, y, len) => `M${pt(x0, y).map((v) => v.toFixed(2)).join(" ")}L${pt(x0 + len, y).map((v) => v.toFixed(2)).join(" ")}`;
  out.push(brand(L(lines.map(([x, y, len]) => seg(x + 1.6, LID - 1.6 - y, len)).join(""), { tone: "hi", free: true })));
  // el cursor parpadea al final de la última línea
  out.push(a.amBlink(brand(`<path d="${face(3 + 1.6 + 7.8, LID - 1.6 - 18.4, 3 + 1.6 + 9, LID - 1.6 - 16.6)}" style="fill:var(--anatomy-top)"/>`), { period: 1100 }));
  out.push(D([pt(LW / 2, LID - 0.8)], { size: 0.45 }));   // la cámara en el marco
  return out.join("");
}
function laptopBase() {
  const base = { x: LX, y: LY, w: LW, d: LD, r: 1.6 };
  const out = [halo(k.insetPlan(base, -1), Z_LAP, 3)];
  out.push(S(k.slabOf(base, Z_LAP, TH, P, 3, 0.4), { tone: "hi", inner: L(k.sideSeam(base, Z_LAP + 0.8, P, 3), { tone: "faint" }) }));
  const z = Z_LAP + TH;
  // el teclado: un hueco con tres filas de teclas y la barra espaciadora
  const kb = { x: LX + 3, y: LY + 2.5, w: LW - 6, d: 11, r: 0.8 };
  out.push(S(k.slabOf(kb, z - 0.2, 0.2, P, 2), { tone: "lo", crease: "none" }));
  const keys = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 10; col++) keys.push({ x: kb.x + 0.6 + col * 2.95, y: kb.y + 0.6 + row * 2.75, w: 2.35, d: 2.15, r: 0.4 });
  }
  keys.push({ x: kb.x + 7, y: kb.y + 8.85, w: 15.6, d: 1.6, r: 0.4 });
  out.push(keys.map((key) => S(k.slabOf(key, z, 0.5, P, 2, 0.2), { tone: "mid", crease: "none" })).join(""));
  // el touchpad
  out.push(L(k.planOutline({ x: LX + LW / 2 - 6, y: LY + 15.5, w: 12, d: 6.6, r: 1 }, z, P, 3), { tone: "lo" }));
  return out.join("");
}

function body() {
  return deck() + helmet() + lid() + laptopBase();
}

const pts = [...k.boxCorners(k.insetPlan(DECK, -3), -3, Z_DECK), [HC[0], HC[1], Z_RING + 5.6 + 2 * HR], [LX, LY - Math.sin(LEAN) * LID, Z_LAP + TH + Math.cos(LEAN) * LID], [LX + LW, LY - Math.sin(LEAN) * LID, Z_LAP + TH + Math.cos(LEAN) * LID]];
P = k.fitProjection(pts, W, H, { pad: 12, azimuth: AZIMUTH, elevation: ELEVATION });

const svg = a.assetSvg({
  width: W,
  height: H,
  label: "Un casco de astronauta con visor azul junto a una laptop abierta con código en pantalla, sobre una plataforma.",
  body: body(),
  paper: PAPER,
  accents: { brand: ICE },
  weight: 0.6,
  id: NAME,
});
mkdirSync(join(HERE, "..", "public", "arte"), { recursive: true });
writeFileSync(join(HERE, "..", "public", "arte", `${NAME}.svg`), svg);
writeFileSync(join(HERE, `${NAME}.html`), a.previewHtml({ title: NAME, svg, paper: PAPER, width: W }));
console.log(`${NAME}.svg ${(svg.length / 1024).toFixed(1)} KB`);
