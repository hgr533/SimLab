// Cheap unlit shaders. Light is baked into vertex attributes; weather rescales it via shared uniforms.
// No discard, except the v2.5 LOD cross-fade dither (only while an instance switches tier). Fog is three.js linear fog (doubles as LOD2 distance fade).
import * as THREE from '../vendor/three.module.js';
import { SUN_DIR } from './config.js';

export const U = {
  uAmb: { value: new THREE.Color(0.5, 0.4, 0.45) },
  uSun: { value: new THREE.Color(0.85, 0.6, 0.36) },
  uWet: { value: 0 },
  uSkyRefl: { value: new THREE.Color(0.9, 0.6, 0.4) },
  uSunRefl: { value: new THREE.Color(1, 0.7, 0.4) },
  uWindow: { value: new THREE.Color(1, 0.7, 0.4) },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(...SUN_DIR).normalize() },
  uEchoColor: { value: new THREE.Color(0.45, 0.35, 1.0) },
  // v2.2 wind: x base bend, y gust bend, z flutter, w weather wind amount (0..1)
  uWind: { value: new THREE.Vector4(0.2, 0.5, 0.4, 0.2) },
};

// GLSL copy of config.windGust(): gust wave travelling towards -z at 18 m/s.
export const GUST_GLSL = `
float windGust(float z, float t) {
  float u = z + t * 18.0;
  float a = 0.5 + 0.5 * sin(u * 0.0898);
  float a2 = a * a; return a2 * a2 * a2 * (0.55 + 0.45 * sin(u * 0.031 + 1.7));
}
`;

function fogUniforms() {
  return {
    fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 },
  };
}

const RIG_GLSL = `
attribute vec3 aRig;
attribute vec4 aAnim;
vec3 rotXp(vec3 p, float py, float pz, float a) {
  float c = cos(a), s = sin(a); float y = p.y - py, z = p.z - pz;
  return vec3(p.x, py + y * c - z * s, pz + y * s + z * c);
}
vec3 rotYp(vec3 p, float px, float pz, float a) {
  float c = cos(a), s = sin(a); float x = p.x - px, z = p.z - pz;
  return vec3(px + x * c + z * s, p.y, pz - x * s + z * c);
}
#ifdef NEARVAR
attribute vec4 aVar; // v2.5 near-tier variety: x hat, y long hair, z skin tone, w spare
#endif
vec3 rigPose(vec3 p) {
  float limb = aRig.x; float al = abs(limb);
#ifdef NEARVAR
  // 6 = hat, 7 = long hair, 8 = short hair: unselected parts collapse into the head (zero area)
  if (limb > 5.5) {
    bool show = limb < 6.5 ? aVar.x > 0.5 : (limb < 7.5 ? aVar.y > 0.5 : aVar.y < 0.5);
    if (!show) return vec3(0.0, 1.5, 0.0);
    limb = 0.0; al = 0.0;
  }
#endif
  if (limb > 4.5) return p;
  float ph = aAnim.x; float amp = aAnim.y; float sl = aAnim.z; float air = aAnim.w;
#ifdef DECORWALK
  ph += uTime * 6.5; // decor walkers animate on the GPU clock, no per-frame attribute uploads
#endif
  if (al > 0.5 && al < 1.5) {
    float side = sign(limb);
    float sw = sin(ph) * side;
    float knee = aRig.z;
    if (knee > 0.0 && p.y < knee) {
      float kb = amp * (0.35 + 1.1 * max(0.0, -cos(ph) * side)) + air * 1.2;
      p = rotXp(p, knee, 0.0, -kb);
    }
    p = rotXp(p, aRig.y, 0.0, sw * amp + air * 0.7 + sl * 1.1);
  } else if (al > 1.5 && al < 2.5) {
    float side = sign(limb);
    p = rotXp(p, aRig.y, 0.0, -sin(ph) * side * amp * 0.95 - sl * 0.6);
  } else if (al > 3.5 && al < 4.5) {
    p = rotYp(p, 0.0, aRig.z, sin(ph * 2.0) * 0.7);
  }
  if (sl > 0.001) { p = rotXp(p, 0.12, 0.0, sl * 1.05); }
  return p;
}
`;

const BAKED_VERT = `
attribute vec4 aLight;
#if defined(SWAY) || defined(BOB) || defined(DECORWALK)
uniform float uTime;
#endif
#if defined(SWAY) || defined(BOB)
attribute float aSway;
uniform vec4 uWind;
${GUST_GLSL}
#endif
varying vec3 vCol;
varying vec4 vLight;
varying vec3 vWorld;
varying vec2 vUv;
#ifdef RIG
${RIG_GLSL}
#endif
#ifdef TINT
attribute float aTint;
#endif
#ifdef LODFADE
attribute float aFade;
varying float vFade;
#endif
#ifdef ECHO
attribute vec2 aEcho;
varying vec2 vEcho;
varying float vY;
#endif
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
#ifdef RIG
  p = rigPose(p);
#endif
#if defined(BOB) && defined(USE_INSTANCING)
  // v2.2 decor idle motion (local space): 1 = breathing bob, 2 / 2.5 = matkot paddle arms, 3 = ball
  {
    float io = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71;
    if (aSway > 0.5 && aSway < 1.5) p.y += sin(uTime * 1.9 + io) * 0.012;
    else if (aSway > 3.5) {
      // v2.5 cyclists: 4 / 4.5 legs swing round the hip, 5 crank, 6 / 6.5 wheels spin
      float ph = uTime * 8.5 + io;
      if (aSway < 4.75) { float a = 0.36 * sin(ph + (aSway < 4.25 ? 0.0 : 3.14159)); float c = cos(a), s = sin(a); float y = p.y - 0.9, z = p.z - 0.18; p.y = 0.9 + y * c - z * s; p.z = 0.18 + y * s + z * c; }
      else if (aSway < 5.5) { float c = cos(ph), s = sin(ph); float y = p.y - 0.36, z = p.z - 0.16; p.y = 0.36 + y * c - z * s; p.z = 0.16 + y * s + z * c; }
      else { float wz = aSway < 6.25 ? -0.52 : 0.52; float c = cos(ph * 1.6), s = sin(ph * 1.6); float y = p.y - 0.34, z = p.z - wz; p.y = 0.34 + y * c - z * s; p.z = wz + y * s + z * c; }
    }
    else if (aSway > 1.5) {
      float s = sin(uTime * 2.6 + io);
      if (aSway < 2.25) p.z += 0.22 * pow(max(0.0, -s), 4.0);
      else if (aSway < 2.75) p.z -= 0.22 * pow(max(0.0, s), 4.0);
      else { float c = cos(uTime * 2.6 + io); p.z += 2.3 * s; p.y += 0.9 * c * c; }
    }
  }
#endif
  vec4 wp = vec4(p, 1.0);
#ifdef USE_INSTANCING
#ifdef RIG
  if (aRig.x > 4.5 && aRig.x < 5.5) wp = vec4(instanceMatrix[3].x + p.x, p.y + min(instanceMatrix[3].y, 0.0), instanceMatrix[3].z + p.z, 1.0); // world-fixed ground shadow
  else
#endif
  wp = instanceMatrix * wp;
#endif
  wp = modelMatrix * wp;
#ifdef SWAY
  // v2.2 palm fronds bend inland (+x) with a steady breeze plus travelling gusts, and flutter
  if (aSway > 0.0) {
    float g = windGust(wp.z, uTime);
    float bend = aSway * (uWind.x + uWind.y * g);
    float fl = sin(uTime * (4.0 + 4.0 * uWind.w) + wp.x * 1.7 + wp.z * 1.1 + wp.y * 2.3) * (0.12 + 0.45 * g) * uWind.z;
    wp.x += bend + aSway * fl * 0.5;
    wp.z += aSway * fl * 0.35;
    wp.y -= bend * aSway * 0.3;
  }
#endif
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
#ifdef USE_COLOR
  vCol = color;
#else
  vCol = vec3(1.0);
#endif
#ifdef TINT
#ifdef USE_INSTANCING_COLOR
  // aTint 2 = second figure / towel in the same instance: same instance color, rotated channels
  vec3 ic = aTint > 1.5 ? instanceColor.gbr : instanceColor;
#ifdef NEARVAR
  if (aTint > 2.5) vCol *= mix(0.6, 1.14, aVar.z); // skin tone
  else
#endif
  vCol = mix(vCol, vCol * ic, min(aTint, 1.0));
#endif
#endif
  vLight = aLight;
  vUv = uv;
#ifdef LODFADE
  vFade = aFade;
#endif
#ifdef ECHO
  vEcho = aEcho;
  if (aRig.x > 4.5) vEcho.x = 0.0; // echoes carry no ground shadow
  vY = p.y;
#endif
#include <fog_vertex>
}
`;

const BAKED_FRAG = `
uniform vec3 uAmb;
uniform vec3 uSun;
uniform float uWet;
uniform vec3 uSkyRefl;
uniform vec3 uSunRefl;
uniform vec3 uWindow;
uniform float uTime;
uniform vec3 uSunDir;
#ifdef MAP
uniform sampler2D map;
#endif
varying vec3 vCol;
varying vec4 vLight;
varying vec3 vWorld;
varying vec2 vUv;
#ifdef LODFADE
varying float vFade;
#endif
#include <fog_pars_fragment>
void main() {
#ifdef LODFADE
  // v2.5 LOD cross-fade: screen-door dither, only while an instance changes tier (vFade != 0)
  if (vFade != 0.0) {
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade > 0.0 ? n >= vFade : n < -vFade) discard;
  }
#endif
  vec3 alb = vCol;
#ifdef MAP
  alb *= mix(vec3(1.0), texture2D(map, vUv).rgb, vLight.w);
#endif
#ifdef TOWER
  float wy = step(0.42, fract(vWorld.y * 0.31));
  float wx = step(0.38, fract((vWorld.x + vWorld.z) * 0.37));
  float win = wy * wx * step(4.0, vWorld.y);
  float lit = step(0.62, fract(sin(floor(vWorld.y * 0.31) * 12.9898 + floor((vWorld.x + vWorld.z) * 0.37) * 78.233) * 43758.5453));
  alb = mix(alb, alb * 0.55 + uWindow * (0.35 + 0.65 * lit) * 0.6, win);
#endif
  vec3 c = alb * (uAmb * vLight.y + uSun * vLight.x);
#ifdef WETSURF
  float w = uWet * vLight.z;
  if (w > 0.002) {
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    float pud = sin(vWorld.x * 0.83 + sin(vWorld.z * 0.21) * 2.3) * sin(vWorld.z * 0.31 + vWorld.x * 0.17) + 0.35 * sin(vWorld.z * 1.13 + 1.7);
    pud = smoothstep(0.25, 0.55, pud);
    c *= 1.0 - 0.45 * w;
#ifdef REFLECT
    // Fake mirrored sky: vertical gradient of the sky color, plus a sun/lamp streak. No render target.
    vec2 toSun = normalize(uSunDir.xz);
    vec2 d = vWorld.xz - cameraPosition.xz;
    float along = dot(normalize(d + vec2(0.0001)), toSun);
    float streak = pow(max(0.0, along), 24.0) * (0.6 + 0.4 * sin(vWorld.z * 3.1 + uTime * 2.0));
    vec3 refl = uSkyRefl * (0.25 + 0.75 * fres) + uSunRefl * streak;
    c = mix(c, refl, w * (0.18 + 0.55 * pud) * (0.35 + 0.65 * fres));
#else
    c = mix(c, uSkyRefl * 0.6, w * pud * 0.25);
#endif
  }
#endif
  gl_FragColor = vec4(c, 1.0);
#include <fog_fragment>
}
`;

const ECHO_FRAG = `
uniform vec3 uEchoColor;
varying vec2 vEcho;
varying float vY;
varying vec3 vCol;
varying vec4 vLight;
varying vec3 vWorld;
varying vec2 vUv;
float sech2(float x) { float e = exp(-abs(x)); float d = 1.0 + e * e; return 4.0 * e * e / (d * d); }
void main() {
  // Soliton envelope: the clone keeps its full shape; a sech^2 pulse travels up the body.
  float env = vEcho.x;
  float band = sech2((vY - vEcho.y) * 2.6);
  vec3 c = mix(uEchoColor, vec3(0.92, 0.9, 1.0), 0.15 + 0.6 * band);
  gl_FragColor = vec4(c, env * (0.75 + 0.5 * band));
}
`;

export function bakedMaterial(opts = {}) {
  const defines = {};
  if (opts.rig) defines.RIG = '';
  if (opts.tint) defines.TINT = '';
  if (opts.map) defines.MAP = '';
  if (opts.wet) defines.WETSURF = '';
  if (opts.reflect) defines.REFLECT = '';
  if (opts.tower) defines.TOWER = '';
  if (opts.echo) defines.ECHO = '';
  if (opts.sway) defines.SWAY = '';
  if (opts.bob) defines.BOB = '';
  if (opts.decorWalk) defines.DECORWALK = '';
  if (opts.lodFade) defines.LODFADE = '';
  if (opts.nearVar) defines.NEARVAR = '';
  const uniforms = Object.assign(fogUniforms(), U);
  if (opts.map) uniforms.map = { value: opts.map };
  const m = new THREE.ShaderMaterial({
    defines, uniforms, vertexShader: BAKED_VERT,
    fragmentShader: opts.echo ? ECHO_FRAG : BAKED_FRAG,
    vertexColors: !opts.echo, fog: !opts.echo,
  });
  if (opts.echo) {
    m.transparent = true; m.depthWrite = false; m.blending = THREE.NormalBlending; // stacked copies saturate to the echo color, never to white
  }
  return m;
}

// ---------- Sky: gradient dome drawn AFTER opaque geometry (renderOrder) with depth test on,
// so pixels covered by the boulevard are rejected by the depth test and never shaded.
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    defines: {},
    uniforms: {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uSunDir: U.uSunDir, uSunSize: { value: 1 }, uCloud: { value: 0.3 }, uTime: U.uTime, uCity: { value: new THREE.Color() },
      uJaffa: { value: new THREE.Vector2(0.8, 0.8) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uSunDir;
      uniform float uSunSize; uniform float uCloud; uniform float uTime; uniform vec3 uCity; uniform vec2 uJaffa;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        float sd = max(0.0, dot(d, uSunDir));
        c += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 60.0) * 0.6) * uSunSize;
        c = mix(c, uSunCol * 1.25, smoothstep(0.9993, 0.99965, sd) * uSunSize);
#ifdef CLOUDS
        float az = atan(d.x, d.z);
        float band = sin(az * 7.0 + uTime * 0.01) * 0.5 + sin(az * 17.0 + h * 40.0) * 0.3 + sin(az * 3.0 - 1.0) * 0.4;
        float cl = smoothstep(0.35, 0.9, band) * smoothstep(0.02, 0.1, h) * smoothstep(0.32, 0.12, h) * uCloud;
        c = mix(c, uHor * 1.08 + uSunCol * pow(sd, 3.0) * 0.4, cl * 0.6);
        // distant city skyline silhouette on the east side
        float skyl = 0.012 + 0.02 * step(0.5, fract(az * 9.0)) + 0.015 * step(0.7, fract(az * 23.0));
        float east = smoothstep(0.1, 0.5, d.x);
        c = mix(c, uCity, east * step(h, skyl) * step(0.0, h) * 0.8);
#endif
        // v2.1 landmark: an Old Jaffa style skyline far ahead across the bay (original procedural
        // shapes: hill with houses, a church bell tower with spire, a clock tower, a minaret).
        // It slowly grows with distance run (uJaffa.x) and fades with the weather haze (uJaffa.y).
        float ja = atan(d.x, -d.z);
        float ju = (ja + 0.24) / (0.085 * uJaffa.x);
        if (abs(ju) < 1.8 && h > -0.001 && h < 0.06) {
          float hill = sqrt(max(0.0, 1.0 - ju * ju)) * 0.42;
          float houses = step(0.12, hill) * 0.07 * step(0.45, fract(ju * 13.0 + 0.3));
          float bx = abs(ju - 0.16);
          float bell = bx < 0.05 ? 0.98 : 0.0;
          float spire = max(0.0, 1.24 - bx * 6.0) * step(bx, 0.05);
          float cx = abs(ju + 0.34);
          float clock = cx < 0.045 ? 0.74 + step(cx, 0.015) * 0.06 : 0.0;
          float minaret = abs(ju - 0.55) < 0.016 ? 0.9 : 0.0;
          float coast = 0.05 * smoothstep(1.8, 0.95, abs(ju));
          float top = max(max(hill + houses, max(bell, spire)), max(max(clock, minaret), coast));
          float sil = step(h, top * 0.034 * uJaffa.x);
          c = mix(c, mix(uHor, uCity, 0.65), sil * uJaffa.y);
        }
        if (h < 0.0) c = uHor;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// ---------- Sea: one strip mesh that follows the camera; waves and sun glitter in the shader.
export function seaMaterial(waves) {
  const uniforms = Object.assign(fogUniforms(), {
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uGlitter: { value: 1 },
    uChop: { value: 0.5 }, uSunCol: { value: new THREE.Color() }, uTime: U.uTime, uSunDir: U.uSunDir, uFoam: { value: new THREE.Color(1, 0.95, 0.9) },
  });
  return new THREE.ShaderMaterial({
    fog: true, uniforms, defines: waves ? { WAVES: '' } : {},
    vertexShader: `
      uniform float uTime; uniform float uChop;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
#ifdef WAVES
        wp.y += (sin(wp.x * 0.15 + uTime * 1.1) * 0.35 + sin(wp.z * 0.11 - uTime * 0.7) * 0.25) * uChop;
#endif
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform float uGlitter; uniform float uChop;
      uniform vec3 uSunCol; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uFoam;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        float shore = clamp((vWorld.x + 46.0) / -60.0, 0.0, 1.0);
        vec3 c = mix(uShallow, uDeep, sqrt(shore));
        vec2 d = normalize(vWorld.xz - cameraPosition.xz);
        float path = pow(max(0.0, dot(d, normalize(uSunDir.xz))), 18.0);
        float sp = sin(vWorld.x * 1.7 + uTime * 2.3) * sin(vWorld.z * 2.3 - uTime * 1.9) * sin((vWorld.x + vWorld.z) * 0.9 + uTime);
        c += uSunCol * path * (0.35 + smoothstep(0.2, 0.9, sp) * 1.4) * uGlitter;
        float foam = smoothstep(0.75, 1.0, sin(vWorld.x * 0.9 + uTime * 1.6 + sin(vWorld.z * 0.13) * 2.0)) * (1.0 - smoothstep(0.0, 0.12, shore));
        c = mix(c, uFoam, foam * (0.5 + uChop * 0.4));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
}
