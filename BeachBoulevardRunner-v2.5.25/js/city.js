// v2.5.12 city strip: road cars, traffic lights, zebra crossings, signs,
// deep glass cafés/shops + varied glass buildings (people inside). No extra RTs.
import { Builder, hex, mul, mix3 } from './geo.js';
import { hash2 } from './rng.js';

const METAL = hex(0x2e3138), GLASS_COL = hex(0x9eb8c6), GLASS_TOP = hex(0xb8d0dc);
const BLACK = hex(0x1a1a1e), WHITE = [1, 1, 1];
const SIGN_G = hex(0x2f6b3a), SIGN_B = hex(0x2a4a7a), POLE = hex(0x6a6e76);
const WOOD = hex(0x8a6038), FRAME = hex(0xe8e0d2), TILE = hex(0xb9a48a);

export const ROAD_X0 = 15.3, ROAD_X1 = 22.7, ROAD_MID = 19.0;
export const LANE_IN = 17.2, LANE_OUT = 20.8;
// v2.5.16: glass restos ~10 m back from the right curb
export const SHOP_X = 33.05;
export const BLVD_CAFE_X = 11.0;
// BLDG_X removed in v2.5.14 (no tall glass roadside buildings)
export const BLDG_X = 26.9;
export const SIDE_A = 13.95;  // v2.5.18: plaza sidewalk between the plaza cafes (back at 12.9) and the curb (15.0)
export const SIDE_B = 26.5;   // v2.5.16: walkable strip between curb and recessed restos
export const FILL_X = 40.6;   // v2.5.18: fill band behind the city glass cafes (was 37.7, inside them)

// THREE.Color.setHex wants integer hex codes
const BODY = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xe67e22, 0x1abc9c, 0x7f8c8d];
export function carColors() { return BODY; }

const SKINS = [hex(0xc58c63), hex(0x8d5a3b), hex(0xe0b08a), hex(0x6b4430)];
const SHIRT = [hex(0xe8473c), hex(0x2f7fd8), hex(0xf2c14e), hex(0x3fae6b), hex(0xffffff), hex(0x8a5cd6)];

function wheel(b, x, y, z, r = 0.28) {
  b.cyl(x, y, z, r, r * 0.92, 0.18, 6, BLACK, { cap: true });
  b.cyl(x, y, z, r * 0.45, r * 0.4, 0.2, 5, METAL, { cap: true });
}

function pane(b, gWet, cx, y0, cz, sx, sy, sz) {
  const w0 = b.wet; b.wet = gWet;
  b.box(cx, y0, cz, sx, sy, sz, GLASS_COL, { skipBottom: true, top: GLASS_TOP });
  b.wet = w0;
}

// tiny seated diner (faces -z); used inside glass rooms
function seatFig(b, x, y, z, yaw, skinI, shirtI) {
  b.push(); b.translate(x, y, z); b.rotY(yaw);
  const skin = SKINS[skinI % SKINS.length], shirt = SHIRT[shirtI % SHIRT.length];
  b.box(0, 0.28, 0, 0.34, 0.28, 0.34, hex(0x3b4250)); // seat block
  b.box(0, 0.55, 0.02, 0.36, 0.38, 0.22, shirt, { skipBottom: true });
  b.box(0, 0.88, 0.02, 0.18, 0.2, 0.18, skin, { skipBottom: true });
  b.box(0.12, 0.12, -0.2, 0.1, 0.22, 0.12, skin, { skipBottom: true });
  b.box(-0.12, 0.12, -0.2, 0.1, 0.22, 0.12, skin, { skipBottom: true });
  b.pop();
}

function tableTiny(b, x, y, z) {
  b.cyl(x, y, z, 0.04, 0.04, 0.7, 5, METAL, { cap: false });
  b.cyl(x, y + 0.72, z, 0.38, 0.38, 0.05, 8, WHITE);
}

export function carGeo(kind = 0) {
  // v2.5.15: people-proportionate size (~1.7 m NPCs); length along Z (yaw 0 = -z, PI = +z)
  const b = new Builder({ tint: true });
  const lens = [4.15, 3.55, 4.75, 4.45][kind];
  const wid = [1.82, 1.72, 1.92, 1.9][kind];
  const bodyH = [0.7, 0.68, 1.02, 0.92][kind];
  const cabH = [0.54, 0.48, 0.68, 0.62][kind];
  const y0 = 0.3;
  b.tint = 1;
  // body: length = Z, width = X
  b.box(0, y0, 0, wid, bodyH, lens * 0.92, WHITE, { skipBottom: true, top: mul(WHITE, 0.92) });
  const cabShift = kind === 2 ? 0.12 : -0.12; // along Z
  b.box(0, y0 + bodyH * 0.55, cabShift, wid * 0.88, cabH, lens * (kind === 1 ? 0.48 : 0.55), WHITE, { skipBottom: true });
  b.tint = 0;
  b.box(0, y0 + bodyH * 0.55 + cabH * 0.15, cabShift, wid * 0.92, cabH * 0.7, lens * 0.42, hex(0x7a96a8), { skipBottom: true });
  // bumpers at ±Z ends
  b.box(0, y0 + 0.1, lens * 0.46, wid * 0.85, 0.26, 0.12, METAL, { skipBottom: true });
  b.box(0, y0 + 0.1, -lens * 0.46, wid * 0.85, 0.26, 0.12, METAL, { skipBottom: true });
  // headlights at -Z (front), taillights at +Z
  // v2.5.18: lamps are emissive (GLOWS, aLight.z = 3 + intensity): they light up at dusk / rain / overcast
  b.wet = 3.95;
  b.box(wid * 0.3, y0 + 0.22, -lens * 0.47, 0.2, 0.12, 0.06, hex(0xfff3d0));
  b.box(-wid * 0.3, y0 + 0.22, -lens * 0.47, 0.2, 0.12, 0.06, hex(0xfff3d0));
  b.wet = 3.5;
  b.box(wid * 0.3, y0 + 0.22, lens * 0.47, 0.2, 0.12, 0.06, hex(0xe0301e));
  b.box(-wid * 0.3, y0 + 0.22, lens * 0.47, 0.2, 0.12, 0.06, hex(0xe0301e));
  b.wet = 0;
  const az = lens * 0.28, wx = wid * 0.48;
  for (const sz of [-az, az]) for (const sx of [-wx, wx]) wheel(b, sx, 0.28, sz, kind === 3 ? 0.32 : 0.28);
  return b.build();
}

// v2.5.19 city road street lamp: curb-side pole with an arm over the road (local -x), emissive warm head.
// Head local (-1.55, 5.25, 0). Glows with uLights (rain / cloudy / golden), off in sea spray. No real light.
export const SLAMP_HEAD = [-1.55, 5.25];
export function streetLampGeo(detail = true) {
  const b = new Builder({ tint: true });
  b.tint = 0;
  const pc = hex(0x4c5158);
  if (detail) b.cyl(0, 0, 0, 0.13, 0.11, 0.45, 6, pc, { cap: true });
  b.cyl(0, 0, 0, 0.075, 0.06, 5.55, detail ? 6 : 4, pc, { cap: true, top: mul(pc, 1.1) });
  b.box(-0.8, 5.45, 0, 1.6, 0.07, 0.07, pc, { skipBottom: true });
  b.box(-1.55, 5.33, 0, 0.62, 0.12, 0.3, hex(0x3a3d44));
  b.wet = 3.9; b.mapW = 0;
  b.box(-1.55, 5.22, 0, 0.5, 0.1, 0.24, [1.0, 0.9, 0.68]);
  b.wet = 0;
  return b.build();
}
export function trafficLightGeo(detail = true) {
  // v2.5.13: taller pole, larger head, brighter bulbs — readable from the runner lanes
  const b = new Builder({ tint: true });
  b.tint = 0;
  b.cyl(0, 0, 0, 0.09, 0.09, 4.2, 5, POLE, { cap: true, top: mul(POLE, 1.1) });
  b.box(-1.1, 3.85, 0, 2.2, 0.1, 0.1, POLE, { skipBottom: true });
  b.box(-2.05, 3.5, 0, 0.5, 1.35, 0.55, hex(0x2a2d33), { skipBottom: true, top: hex(0x3a3d44) });
  const bulbs = [[0.48, hex(0xe74c3c)], [0.0, hex(0xf1c40f)], [-0.48, hex(0x2ecc71)]];
  b.sunBoost = 3.2; b.ao = 0.25;
  for (const [dy, c] of bulbs) b.cyl(-2.05, 3.5 + dy, 0.18, 0.15, 0.15, 0.1, 6, c, { cap: true });
  b.sunBoost = 1; b.ao = 1;
  if (detail) {
    b.box(0.25, 1.7, 0, 0.28, 0.62, 0.18, hex(0x2a2d33), { skipBottom: true });
    b.sunBoost = 2.8;
    b.box(0.25, 1.88, 0.06, 0.16, 0.16, 0.05, hex(0xe74c3c));
    b.box(0.25, 1.52, 0.06, 0.16, 0.16, 0.05, hex(0x2ecc71));
    b.sunBoost = 1;
  }
  b.tint = 1;
  b.box(-2.05, 3.5, -0.22, 0.52, 1.4, 0.08, WHITE, { skipBottom: true });
  b.tint = 0;
  return b.build();
}

export function zebraGeo() {
  // v2.5.13: thicker, taller stripes + curb flares so crossings read from the boulevard
  const b = new Builder();
  const x0 = ROAD_X0 + 0.1, x1 = ROAD_X1 - 0.1, mid = (x0 + x1) / 2, span = x1 - x0;
  for (let i = 0; i < 9; i++) b.box(mid, 0.04, -1.7 + i * 0.4, span, 0.05, 0.28, WHITE, { skipBottom: true });
  // yellow warning bars at both mouths
  for (const z of [-2.05, 2.05]) b.box(mid, 0.045, z, span, 0.04, 0.14, hex(0xf1c40f), { skipBottom: true });
  for (const x of [x0 - 0.45, x1 + 0.45]) {
    b.box(x, 0.03, 0, 0.85, 0.1, 4.0, mix3(hex(0xbdb5a8), hex(0xd8c3a0), 0.35), { skipBottom: true });
  }
  // short posts marking the crossing
  for (const x of [x0 - 0.7, x1 + 0.7]) for (const z of [-1.9, 1.9]) {
    b.cyl(x, 0.02, z, 0.06, 0.06, 0.95, 5, hex(0xf1c40f), { cap: true });
  }
  return b.build();
}

export function roadSignGeo(kind = 0) {
  const b = new Builder();
  b.cyl(0, 0, 0, 0.06, 0.06, 3.0, 5, POLE, { cap: true });
  const face = kind === 0 ? SIGN_B : kind === 1 ? SIGN_G : hex(0xc0392b);
  b.box(0.03, 2.55, 0, 0.08, 0.95, 1.15, face, { skipBottom: true, top: mul(face, 1.08) });
  b.box(0.08, 2.55, 0, 0.03, 0.6, 0.75, WHITE, { skipBottom: true });
  // small reflective strip
  b.sunBoost = 1.8; b.box(0.09, 2.2, 0, 0.02, 0.12, 0.9, hex(0xf5f0c8)); b.sunBoost = 1;
  return b.build();
}

// v2.5.14 street fill: planters, benches, bollards, kiosks, parked bikes, stalls, trees, plaza sets
export function streetFurnGeo(kind = 0) {
  const b = new Builder({ tint: true });
  const k = ((kind % 8) + 8) % 8;
  if (k === 0) { // double planter
    for (const z of [-0.7, 0.7]) {
      b.box(0, 0.15, z, 0.55, 0.45, 0.55, hex(0x8a6a4a), { skipBottom: true });
      b.cyl(0, 0.55, z, 0.28, 0.06, 0.45, 6, hex(0x3f7f3a));
    }
  } else if (k === 1) { // bench facing the road
    b.box(0, 0.22, 0, 0.55, 0.12, 1.5, WOOD, { skipBottom: true, top: mul(WOOD, 1.1) });
    b.box(0, 0.55, -0.2, 0.12, 0.55, 1.5, WOOD, { skipBottom: true });
    for (const z of [-0.55, 0.55]) b.box(0, 0, z, 0.4, 0.4, 0.12, METAL, { skipBottom: true });
  } else if (k === 2) { // bollard pair + short plaza tile
    for (const z of [-0.45, 0.45]) b.cyl(0, 0, z, 0.08, 0.08, 0.85, 5, hex(0xc9a227), { cap: true });
    b.box(0, 0.02, 0, 1.4, 0.04, 1.6, mix3(hex(0xcbb796), hex(0xd8c3a0), 0.5), { skipBottom: true });
  } else if (k === 3) { // newsstand / kiosk
    b.box(0, 0, 0, 1.4, 2.1, 1.1, hex(0xf0e2c0), { skipBottom: true, top: mul(hex(0xf0e2c0), 0.9) });
    b.tint = 1; b.box(0, 2.15, 0, 1.6, 0.2, 1.3, WHITE); b.tint = 0;
    b.box(-0.72, 0.7, 0, 0.04, 0.9, 0.9, hex(0x7a96a8), { skipBottom: true });
  } else if (k === 4) { // bike rack + two parked bikes
    for (const z of [-0.55, 0, 0.55]) {
      b.cyl(0, 0.35, z, 0.03, 0.03, 0.7, 5, METAL, { cap: false });
      b.cyl(0, 0.7, z, 0.28, 0.28, 0.04, 8, METAL, { cap: false });
    }
    for (const z of [-0.35, 0.35]) {
      b.push(); b.translate(0.15, 0.35, z); b.rotY(0.2);
      b.cyl(0.35, 0, 0, 0.22, 0.22, 0.05, 8, BLACK, { cap: true });
      b.cyl(-0.35, 0, 0, 0.22, 0.22, 0.05, 8, BLACK, { cap: true });
      b.tint = 1; b.box(0, 0.15, 0, 0.12, 0.35, 0.7, WHITE); b.tint = 0;
      b.box(0, 0.4, -0.05, 0.08, 0.25, 0.35, METAL, { skipBottom: true });
      b.pop();
    }
  } else if (k === 5) { // market stall / food cart
    b.box(0, 0.55, 0, 1.6, 1.1, 1.1, hex(0xe8d4a8), { skipBottom: true, top: mul(hex(0xe8d4a8), 0.92) });
    b.tint = 1; b.box(0, 1.35, 0, 1.9, 0.08, 1.4, WHITE); b.tint = 0;
    for (const x of [-0.7, 0.7]) b.box(x, 0, 0.4, 0.08, 1.3, 0.08, WOOD, { skipBottom: true });
    b.box(0, 0.95, -0.55, 1.4, 0.55, 0.06, hex(0x2d7c8a), { skipBottom: true });
    for (let i = 0; i < 4; i++) b.box(-0.45 + i * 0.3, 1.15, -0.4, 0.12, 0.18, 0.12, [hex(0xe74c3c), hex(0xf1c40f), hex(0x2ecc71), hex(0x3498db)][i], { skipBottom: true });
  } else if (k === 6) { // small sidewalk tree
    b.cyl(0, 0, 0, 0.12, 0.1, 1.8, 5, hex(0x6b4a2e), { cap: true });
    b.cyl(0, 1.7, 0, 0.85, 0.55, 1.1, 6, hex(0x3f7f3a), { cap: true, top: hex(0x5d9a3e) });
    b.cyl(0.35, 2.1, 0.2, 0.45, 0.35, 0.7, 5, hex(0x4a8f45), { cap: true });
    b.box(0, 0.02, 0, 0.7, 0.06, 0.7, hex(0x8a8580), { skipBottom: true });
  } else { // plaza cafe set: umbrella + table + chairs
    b.cyl(0, 0, 0, 0.04, 0.04, 2.3, 5, WHITE, { cap: false });
    b.tint = 2; b.cyl(0, 2.35, 0, 1.2, 0.05, 0.35, 8, WHITE); b.tint = 0;
    b.cyl(0, 0.72, 0, 0.38, 0.38, 0.06, 8, WHITE);
    b.cyl(0, 0, 0, 0.05, 0.05, 0.7, 5, METAL, { cap: false });
    for (const [x, z] of [[-0.55, 0.4], [0.55, 0.4], [-0.55, -0.4], [0.55, -0.4]]) {
      b.box(x, 0.2, z, 0.32, 0.08, 0.32, WOOD, { skipBottom: true });
      b.box(x, 0, z, 0.06, 0.4, 0.06, METAL, { skipBottom: true });
    }
  }
  return b.build();
}


// Deep glass café/restaurant. Local x=0 = facade facing -x (boulevard / road).
// level 0 full + people, 1 LOW denser glass fewer people, 2 far shell.
function deepCafeShell(b, opts) {
  const {
    depth = 5.4, width = 9.2, wallH = 3.5, gWet = 1.48, people = true,
    wall = hex(0xf1e6d2), awningTint = true, outdoor = true, door = true,
  } = opts;
  const frame = FRAME, sill = hex(0xd4cbb8), doorC = hex(0x6b5340);
  b.tint = 0; b.wet = 0;
  // indoor floor (extends +x into the room)
  b.box(depth * 0.48, -0.32, 0, depth * 0.92, 0.5, width * 0.96, mul(TILE, 0.85), { top: TILE });
  // skirts / side walls opaque low
  b.box(0.04, -0.28, 0, 0.2, 0.5, width, sill, { skipBottom: true });
  for (const s of [-1, 1]) b.box(depth * 0.5, -0.28, s * width * 0.48, depth, 0.5, 0.2, sill, { skipBottom: true });
  b.box(depth * 0.95, -0.28, 0, 0.2, 0.5, width, sill, { skipBottom: true });
  // corner posts + mullions
  for (const z of [-width * 0.48, width * 0.48]) {
    b.box(0.0, 0.2, z, 0.22, wallH, 0.22, wall, { skipBottom: true });
    b.box(depth * 0.92, 0.2, z, 0.2, wallH, 0.2, wall, { skipBottom: true });
  }
  const mullZ = [-width * 0.28, 0, width * 0.28];
  for (const z of mullZ) {
    if (door && Math.abs(z) < 0.9) continue;
    b.box(0.0, 0.2, z, 0.1, wallH - 0.15, 0.1, frame, { skipBottom: true });
  }
  for (const s of [-1, 1]) for (const x of [depth * 0.3, depth * 0.6]) {
    b.box(x, 0.2, s * width * 0.48, 0.1, wallH - 0.15, 0.1, frame, { skipBottom: true });
  }
  // rails + roof
  b.box(0.0, wallH * 0.48, 0, 0.12, 0.1, width * 0.95, frame, { skipBottom: true });
  b.box(0.0, wallH - 0.15, 0, 0.28, 0.45, width, wall);
  b.box(depth * 0.5, wallH + 0.05, 0, depth + 0.4, 0.2, width + 0.4, mul(wall, 0.88), { top: mul(wall, 0.95) });
  // door in facade
  if (door) {
    for (const z of [-1.0, 1.0]) b.box(0.02, 0.15, z, 0.12, 2.35, 0.12, doorC, { skipBottom: true });
    b.box(0.02, 2.45, 0, 0.14, 0.12, 2.1, doorC, { skipBottom: true });
    b.push(); b.translate(0.05, 0.15, 0.9); b.rotY(-0.5);
    b.box(0.5, 0, 0, 1.0, 2.25, 0.06, mul(doorC, 1.08), { skipBottom: true });
    b.box(0.88, 1.0, -0.04, 0.07, 0.07, 0.07, hex(0xc9a227));
    b.pop();
  }
  // awning over facade
  b.push(); b.translate(-0.85, wallH - 0.55, 0); b.rotZ(0.28);
  for (let k = 0; k < 8; k++) {
    if (awningTint) b.tint = k % 2 ? 0 : 1;
    b.box(0, 0, -width * 0.45 + k * (width * 0.9 / 8) + width * 0.055, 1.6, 0.06, width * 0.9 / 8, WHITE);
  }
  b.pop(); b.tint = 0;
  if (awningTint) {
    b.tint = 1; b.box(0.1, wallH + 0.25, 0, 0.12, 0.5, width * 0.55, WHITE); b.tint = 0;
  }
  // indoor counter + tables + people
  if (people) {
    b.box(depth * 0.55, 0.15, -width * 0.32, 2.2, 0.95, 0.5, mul(WOOD, 0.9), { skipBottom: true, top: WOOD });
    const zs = width > 8 ? [-2.8, -0.9, 1.0, 2.8] : [-2.0, 0.2, 2.0];
    zs.forEach((z, i) => {
      tableTiny(b, depth * 0.35, 0.05, z);
      seatFig(b, depth * 0.35 - 0.55, 0.05, z, Math.PI / 2, i, i + 1);
      if (i % 2 === 0) seatFig(b, depth * 0.35 + 0.55, 0.05, z, -Math.PI / 2, i + 2, i + 3);
    });
    // waiter
    b.push(); b.translate(depth * 0.2, 0.05, 0.2); b.rotY(Math.PI * 0.6);
    b.box(0, 0.55, 0, 0.34, 0.5, 0.22, SHIRT[1], { skipBottom: true });
    b.box(0, 0.95, 0, 0.18, 0.2, 0.18, SKINS[0], { skipBottom: true });
    b.box(0, 0.15, 0, 0.3, 0.35, 0.2, hex(0x3b4250));
    b.pop();
  }
  if (outdoor) {
    for (const z of [-width * 0.28, width * 0.28]) {
      tableTiny(b, -1.5, 0.02, z);
      seatFig(b, -1.5 - 0.5, 0.02, z, Math.PI / 2, 1, 2);
      seatFig(b, -1.5 + 0.5, 0.02, z, -Math.PI / 2, 2, 4);
    }
  }
  // glass LAST — facade (door gap), sides, back
  const y0 = 0.25, sy = wallH - 0.45;
  if (door) {
    for (const [z0, z1] of [[-width * 0.46, -1.15], [1.15, width * 0.46]]) {
      const mid = (z0 + z1) / 2, len = z1 - z0;
      pane(b, gWet, 0.0, y0, mid, 0.05, sy, len - 0.08);
    }
    pane(b, gWet, 0.0, 2.6, 0, 0.05, 0.35, 2.0); // transom
  } else {
    pane(b, gWet, 0.0, y0, 0, 0.05, sy, width * 0.88);
  }
  for (const s of [-1, 1]) pane(b, gWet, depth * 0.5, y0, s * width * 0.48, depth * 0.88, sy, 0.05);
  pane(b, gWet, depth * 0.95, y0, 0, 0.05, sy, width * 0.88);
  b.wet = 0;
}

// v2.5.14: roadside restaurant / café — same language as beach glass restos
// (depth, indoor seating, awning, door, two waiters). Facade at local x=0 faces -x (toward road).
export function roadRestoGeo(level = 0, variant = 0) {
  const b = new Builder({ tint: true });
  const walls = [hex(0xf1e6d2), hex(0xf3e9d8), hex(0xe8dcc8), hex(0xf1e0d0), hex(0xe7d2b0)];
  const wall = walls[variant % walls.length];
  const wood = WOOD, deckC = hex(0xc49a6a), tile = TILE, doorC = hex(0x6b5340);
  const gWet = level === 1 ? 1.9 : level === 2 ? 1.72 : 1.48;
  const depth = level === 2 ? 5.0 : 6.4;
  const width = level === 2 ? 9.0 : 11.0;
  const wallH = 3.55;
  b.tint = 0; b.wet = 0;
  // floors: indoor (+x) + short curb terrace (v2.5.15: facade sits on curb, no deep sidewalk gap)
  b.box(depth * 0.48, -0.32, 0, depth * 0.92, 0.5, width * 0.96, mul(tile, 0.85), { top: tile });
  b.box(-0.5, -0.3, 0, 1.05, 0.48, width * 0.9, mul(deckC, 0.85), { top: deckC });
  // skirts
  b.box(0.04, -0.28, 0, 0.2, 0.5, width, hex(0xd4cbb8), { skipBottom: true });
  for (const s of [-1, 1]) b.box(depth * 0.5, -0.28, s * width * 0.48, depth, 0.5, 0.2, hex(0xd4cbb8), { skipBottom: true });
  b.box(depth * 0.95, -0.28, 0, 0.2, 0.5, width, hex(0xd4cbb8), { skipBottom: true });
  // posts + mullions
  for (const z of [-width * 0.48, width * 0.48]) {
    b.box(0.0, 0.2, z, 0.22, wallH, 0.22, wall, { skipBottom: true });
    b.box(depth * 0.92, 0.2, z, 0.2, wallH, 0.2, wall, { skipBottom: true });
  }
  for (const z of [-width * 0.28, width * 0.28]) {
    if (Math.abs(z) < 1.0) continue;
    b.box(0.0, 0.2, z, 0.1, wallH - 0.15, 0.1, FRAME, { skipBottom: true });
  }
  for (const s of [-1, 1]) for (const x of [depth * 0.3, depth * 0.6]) {
    b.box(x, 0.2, s * width * 0.48, 0.1, wallH - 0.15, 0.1, FRAME, { skipBottom: true });
  }
  // door
  for (const z of [-1.05, 1.05]) b.box(0.02, 0.15, z, 0.12, 2.4, 0.12, doorC, { skipBottom: true });
  b.box(0.02, 2.5, 0, 0.14, 0.12, 2.2, doorC, { skipBottom: true });
  b.push(); b.translate(0.05, 0.15, 0.95); b.rotY(-0.55);
  b.box(0.5, 0, 0, 1.0, 2.3, 0.06, mul(doorC, 1.08), { skipBottom: true });
  b.box(0.88, 1.0, -0.04, 0.07, 0.07, 0.07, hex(0xc9a227));
  b.pop();
  // rails + roof + boulevard-style header
  b.box(0.0, wallH * 0.48, 0, 0.12, 0.1, width * 0.95, FRAME, { skipBottom: true });
  b.box(0.0, wallH - 0.2, 0, 0.3, 0.5, width, wall);
  b.box(depth * 0.5, wallH + 0.05, 0, depth + 0.45, 0.22, width + 0.45, mul(wall, 0.88), { top: mul(wall, 0.95) });
  // sign + awning
  b.tint = 1; b.box(0.12, wallH + 0.35, 0, 0.12, 0.55, width * 0.55, WHITE); b.tint = 0;
  b.push(); b.translate(-0.55, wallH - 0.6, 0); b.rotZ(0.28);
  for (let k = 0; k < 9; k++) { b.tint = k % 2 ? 0 : 1; b.box(0, 0, -width * 0.42 + k * (width * 0.84 / 9) + width * 0.045, 1.15, 0.06, width * 0.84 / 9, WHITE); }
  b.pop(); b.tint = 0;
  // short curb railing (flush facade — terrace stays on the curb lip)
  for (const s of [-1, 1]) {
    b.box(-0.95, 0.95, s * width * 0.28, 0.06, 0.06, width * 0.35, WHITE);
    for (let k = 0; k < 3; k++) b.box(-0.95, 0.15, s * (width * 0.12 + k * 0.55), 0.06, 0.8, 0.06, WHITE, { skipBottom: true });
  }
  if (level !== 2) {
    // counter + indoor tables + people
    b.box(depth * 0.55, 0.15, -width * 0.3, 2.4, 0.95, 0.55, mul(wood, 0.9), { skipBottom: true, top: wood });
    const zs = level === 0 ? [-3.2, -1.0, 1.2, 3.2] : [-2.2, 0.4, 2.6];
    zs.forEach((z, i) => {
      tableTiny(b, depth * 0.32, 0.05, z);
      seatFig(b, depth * 0.32 - 0.55, 0.05, z, Math.PI / 2, i, i + 1);
      if (i % 2 === 0) seatFig(b, depth * 0.32 + 0.55, 0.05, z, -Math.PI / 2, i + 2, i + 3);
    });
    // terrace tables toward road
    for (const z of (level === 0 ? [-2.8, 2.8] : [0])) {
      tableTiny(b, -0.55, 0.05, z);
      seatFig(b, -0.55 - 0.4, 0.05, z, Math.PI / 2, 1, 2);
      seatFig(b, -0.55 + 0.4, 0.05, z, -Math.PI / 2, 2, 4);
    }
    // two waiters (beach resto style)
    b.push(); b.translate(depth * 0.18, 0.05, 0.25); b.rotY(Math.PI * 0.55);
    b.box(0, 0.55, 0, 0.34, 0.5, 0.22, SHIRT[1], { skipBottom: true });
    b.box(0, 0.95, 0, 0.18, 0.2, 0.18, SKINS[0], { skipBottom: true });
    b.box(0, 0.15, 0, 0.3, 0.35, 0.2, hex(0x3b4250));
    b.box(-0.35, 1.15, 0.05, 0.32, 0.03, 0.32, METAL);
    b.pop();
    b.push(); b.translate(depth * 0.4, 0.05, -width * 0.22); b.rotY(Math.PI * 0.15);
    b.box(0, 0.55, 0, 0.34, 0.5, 0.22, SHIRT[3], { skipBottom: true });
    b.box(0, 0.95, 0, 0.18, 0.2, 0.18, SKINS[2], { skipBottom: true });
    b.box(0, 0.15, 0, 0.3, 0.35, 0.2, hex(0x3b4250));
    b.box(0.35, 1.15, 0.05, 0.32, 0.03, 0.32, METAL);
    b.pop();
    // planters on curb terrace corners
    for (const s of [-1, 1]) {
      b.box(-0.7, 0.15, s * width * 0.42, 0.4, 0.38, 0.4, hex(0x9a6a44), { skipBottom: true });
      b.cyl(-0.7, 0.5, s * width * 0.42, 0.2, 0.05, 0.32, 6, hex(0x3f7f3a));
    }
  }
  // glass LAST
  const y0 = 0.25, sy = wallH - 0.45;
  for (const [z0, z1] of [[-width * 0.46, -1.2], [1.2, width * 0.46]]) {
    const mid = (z0 + z1) / 2, len = z1 - z0;
    pane(b, gWet, 0.0, y0, mid, 0.05, sy, len - 0.08);
  }
  pane(b, gWet, 0.0, 2.65, 0, 0.05, 0.4, 2.1);
  for (const s of [-1, 1]) pane(b, gWet, depth * 0.5, y0, s * width * 0.48, depth * 0.88, sy, 0.05);
  pane(b, gWet, depth * 0.95, y0, 0, 0.05, sy, width * 0.88);
  b.wet = 0;
  return b.build();
}

// Shop / café aliases → road restos (variants for visual variety)
export function shopGeo(level = 0) { return roadRestoGeo(level, 0); }
export function cafeSideGeo(level = 0) { return roadRestoGeo(level, 2); }

export function blvdCafeGeo(level = 0) { return roadRestoGeo(level, 1); }

export function lightPhase(t, k) { return (t * 0.28 + k * 1.73) % 1; }
export function carsGreen(ph) { return ph < 0.55; }
export function pedsWalk(ph) { return ph >= 0.62 && ph < 0.88; }
export function lightTint(ph) {
  if (ph < 0.55) return hex(0x2ecc71);
  if (ph < 0.62) return hex(0xf1c40f);
  return hex(0xe74c3c);
}
