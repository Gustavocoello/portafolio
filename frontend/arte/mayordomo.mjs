// Portada del chat de Jarvis, dibujada con la skill anatomy-asset (~/.claude/skills/anatomy-asset):
// una bandeja de mayordomo con una campanilla de servicio (el botón en azul hielo), una libreta
// abierta con su cinta, una pluma y un sobre lacrado.
//
//   node arte/mayordomo.mjs            → public/arte/mayordomo.svg (+ vista previa en arte/mayordomo.html)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = join(homedir(), ".claude", "skills", "anatomy-asset", "kit");
const k = await import(pathToFileURL(join(KIT, "iso-kit.mjs")).href);
const a = await import(pathToFileURL(join(KIT, "asset.mjs")).href);
const G = await import(pathToFileURL(join(KIT, "lathe.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const PAPER = "#0b0d12";
const ICE = "#8fd3ff";
const W = 360;
const H = 230;
const AZIMUTH = 52;
const ELEVATION = 35;
const SCREW = 0.55;

let P = { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION };
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const depth = ([x, y, z = 0]) => k.depthOf([x, y, z], P);
const byDepth = (items, key) => [...items].sort((p, q) => depth(key(p)) - depth(key(q)));
const brand = (svg) => `<g class="ac-brand">${svg}</g>`;
const wood = (svg) => `<g class="ac-wood">${svg}</g>`;
const halo = (plan, z, blur = 4) => `<path class="iso-halo" d="${k.haloOf(plan, z, 0.1, P)}" style="filter:blur(${blur}px)"/>`;

// ---------- la bandeja ----------
const TRAY = { x: -48, y: -36, w: 96, d: 70, r: 12 };
const Z_FOOT = -4;
const Z_TRAY = 3;

function tray() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(TRAY, -4), Z_FOOT, 4, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(TRAY, 16), (p) => [...p, Z_FOOT])) {
    out.push(S(k.cylinder(x, y, 3.2, Z_FOOT, 0.8, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 2.2, Z_FOOT + 0.8, -Z_FOOT - 0.8, P, 16), { tone: "mid" }));
  }
  // asas a los lados: placas con su ranura
  for (const x0 of [TRAY.x - 7, TRAY.x + TRAY.w - 1]) {
    const h = { x: x0, y: -11, w: 8, d: 22, r: 3 };
    out.push(S(k.slabOf(h, 0.6, 2, P, 4, 0.4), { tone: "mid" }));
    out.push(L(k.planOutline({ x: x0 + 2.4, y: -7, w: 3.2, d: 14, r: 1.6 }, 2.6, P, 4), { tone: "lo" }));
  }
  out.push(S(k.slabOf(TRAY, 0, Z_TRAY, P, 8, 1.2), { tone: "hi", inner: L(k.sideSeam(TRAY, 1.2, P, 8), { tone: "faint" }) }));
  // el reborde y el fondo grabado
  out.push(L(k.planOutline(k.insetPlan(TRAY, 3), Z_TRAY, P, 8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(TRAY, 7), Z_TRAY, P, 8), { tone: "faint" }));
  return out.join("");
}

// ---------- la campanilla de servicio (el sujeto) ----------
const BELL = { x: 22, y: -12 };
function bell() {
  const out = [halo({ x: BELL.x - 17, y: BELL.y - 17, w: 34, d: 34, r: 17 }, Z_TRAY, 5)];
  const zb = Z_TRAY;
  // base de madera torneada con un aro de metal
  out.push(wood(S(k.cylinder(BELL.x, BELL.y, 16, zb, 5, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(BELL.x, BELL.y, 16, zb + 1.6, P, 56) + k.sideArc(BELL.x, BELL.y, 16, zb + 3.4, P, 56), { tone: "faint" }) })));
  out.push(S(k.cylinder(BELL.x, BELL.y, 14.4, zb + 5, 1.2, P, 52, 0.3), { tone: "lo" }));
  const ang = [0, 1, 2, 3].map((i) => (i * Math.PI) / 2 + Math.PI / 4);
  out.push(D(ang.map((t) => at([BELL.x + Math.cos(t) * 15.2, BELL.y + Math.sin(t) * 15.2, zb + 5])), { size: SCREW }));
  // la cúpula: un perfil suave torneado sobre el eje vertical
  const z0 = zb + 6.2;
  const F = G.frameOf([BELL.x, BELL.y, z0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  out.push(S(G.solidOf([[0, 13.4], [0.8, 13.6, 1], [4, 12.8, 1], [8, 10.2, 1], [11, 6.2, 1], [12.4, 2.4, 1], [12.7, 0]], F, P), { tone: "hi", lit: true }));
  const zt = z0 + 12.4;
  // el vástago y el botón, que se aprieta
  const press = [
    S(k.cylinder(BELL.x, BELL.y, 1.3, zt - 0.4, 3, P, 16), { tone: "mid" }),
    brand(S(k.cylinder(BELL.x, BELL.y, 3.6, zt + 2.6, 2.2, P, 36, 0.6), { tone: "hi", lit: true })),
    brand(L(k.ring(BELL.x, BELL.y, 2.2, zt + 4.8, P, 28), { tone: "faint" })),
  ].join("");
  out.push(a.amPress(press, [0, 0, -1.4], P, { period: 3200 }));
  return out.join("");
}

// ---------- la libreta abierta, con cinta y pluma ----------
const NB = { x: -40, y: -24, w: 42, d: 30 };
function notebook() {
  const z = Z_TRAY;
  const out = [halo({ x: NB.x - 1, y: NB.y - 1, w: NB.w + 2, d: NB.d + 2, r: 2 }, z, 3)];
  out.push(S(k.slabOf({ x: NB.x - 1, y: NB.y - 1, w: NB.w + 2, d: NB.d + 2, r: 1.4 }, z, 0.8, P, 3), { tone: "lo" }));
  const half = NB.w / 2;
  const pages = [];
  for (const [i, x0] of [[0, NB.x], [1, NB.x + half + 0.4]]) {
    const pg = { x: x0, y: NB.y, w: half - 0.4, d: NB.d, r: 0.8 };
    const zp = z + 0.8;
    const rules = Array.from({ length: 6 }, (_, j) => k.lineOnTop([pg.x + 3, pg.y + 6 + j * 4], [pg.x + pg.w - 3 - (j === 5 && i ? 7 : 0), pg.y + 6 + j * 4], zp + 3, P)).join("");
    pages.push(S(k.slabOf(pg, zp, 3, P, 2, 0.3), { tone: "hi", inner: L(k.sideSeam(pg, zp + 1, P, 2), { tone: "faint" }) }) + L(rules, { tone: "faint", free: true }));
  }
  out.push(...pages);
  // la cinta de lectura cae sobre la página derecha y sale por el borde
  out.push(brand(S(k.slabOf({ x: NB.x + half + 8, y: NB.y + 10, w: 1.8, d: NB.d - 6, r: 0.3 }, z + 3.8, 0.25, P, 2), { tone: "hi", crease: "none" })));
  // la pluma, cruzada sobre la página izquierda
  const F = G.frameAlong([NB.x + 4, NB.y + 25, z + 5.2], [0.82, -0.57, 0]);
  out.push(S(G.solidOf([[0, 0.2], [2.4, 1.1, 1], [4, 1.3], [24, 1.3], [24.4, 1.5], [27, 1.5], [28, 1.1, 1]], F, P), { tone: "mid" }));
  return out.join("");
}

// ---------- el sobre lacrado ----------
const ENV = { x: 2, y: 9, w: 32, d: 21, r: 0.8 };
function envelope() {
  const z = Z_TRAY;
  const zt = z + 1.4;
  const out = [halo(ENV, z, 3)];
  out.push(S(k.slabOf(ENV, z, 1.4, P, 2, 0.3), { tone: "hi", inner: L(k.sideSeam(ENV, z + 0.7, P, 2), { tone: "faint" }) }));
  const c = [ENV.x + ENV.w / 2, ENV.y + ENV.d * 0.55];
  const flap = [
    k.lineOnTop([ENV.x + 1.2, ENV.y], c, zt, P), k.lineOnTop([ENV.x + ENV.w - 1.2, ENV.y], c, zt, P),
    k.lineOnTop([ENV.x + 1.2, ENV.y + ENV.d], c, zt, P),
    k.lineOnTop([ENV.x + ENV.w - 1.2, ENV.y + ENV.d], c, zt, P),
  ].join("");
  out.push(L(flap, { tone: "lo" }));
  // el lacre, que respira despacio
  const seal = brand(S(k.cylinder(c[0], c[1], 3, zt, 0.9, P, 32, 0.4), { tone: "hi" }) + L(k.ring(c[0], c[1], 1.7, zt + 0.9, P, 24), { tone: "lo" }));
  out.push(seal, a.amPulse(brand(`<path d="${k.haloOf({ x: c[0] - 5, y: c[1] - 5, w: 10, d: 10, r: 5 }, zt, 1, P)}" style="fill:var(--anatomy-top);opacity:.6;filter:blur(3px)"/>`), { period: 4200, min: 0.1 }));
  out.push(D([at([ENV.x + 3, ENV.y + ENV.d - 3, zt]), at([ENV.x + 6, ENV.y + ENV.d - 3, zt])], { size: SCREW }));
  return out.join("");
}

function body() {
  const parts = [
    { key: [BELL.x, BELL.y, Z_TRAY], svg: bell },
    { key: [NB.x + NB.w / 2, NB.y + NB.d / 2, Z_TRAY], svg: notebook },
    { key: [ENV.x + ENV.w / 2, ENV.y + ENV.d / 2, Z_TRAY], svg: envelope },
  ];
  return tray() + byDepth(parts, (p) => p.key).map((p) => p.svg()).join("");
}

const points = [...k.boxCorners(k.insetPlan(TRAY, -8), Z_FOOT, Z_TRAY), [BELL.x, BELL.y, Z_TRAY + 30]];
P = k.fitProjection(points, W, H, { pad: 10, azimuth: AZIMUTH, elevation: ELEVATION });

const svg = a.assetSvg({
  width: W,
  height: H,
  label: "Una bandeja de mayordomo con una campanilla de servicio cuyo botón azul se aprieta, una libreta abierta con su cinta, una pluma y un sobre lacrado.",
  body: body(),
  paper: PAPER,
  accents: { brand: ICE, wood: "#3a2a1e" },
  weight: 0.5,
  id: "mayordomo",
});
mkdirSync(join(HERE, "..", "public", "arte"), { recursive: true });
writeFileSync(join(HERE, "..", "public", "arte", "mayordomo.svg"), svg);
writeFileSync(join(HERE, "mayordomo.html"), a.previewHtml({ title: "mayordomo", svg, paper: PAPER, width: W }));
console.log(`mayordomo.svg ${(svg.length / 1024).toFixed(1)} KB`);
