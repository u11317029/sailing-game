// ocean.js — Gerstner 波浪海面、天空與環境光
//
// 海面頂點位移在 GPU（vertex shader）計算；getWaveHeight / getWaveNormal
// 用 JS 跑「同一套公式、同一組參數」，讓船隻與浮標的浮力跟畫面上的浪完全一致。
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ================= 可調整參數 =================
export const OCEAN = {
  gravity: 9.81,
  waveScale: 1.0,        // 整體波高倍率（1 = 預設，約 ±0.8 公尺的小浪）
  steepness: 1.0,        // 浪的尖銳程度倍率（>1 浪峰更尖、白沫更多，過大會打結）
  deepColor: [0.005, 0.026, 0.045],   // 深水顏色（線性色彩空間）
  shallowColor: [0.025, 0.12, 0.13],   // 浪峰透光的淺色
  foamThreshold: 0.76,   // 白沫門檻：Jacobian 低於這個值的浪峰會起白沫（越大白沫越多）
  fogDensity: 1 / 2400,  // 霧氣濃度（越大地平線越近）
  sunElevation: 18,      // 太陽仰角（度）
  sunAzimuth: 35,        // 太陽方位（度，0 = 北，順時針）
};

// 波浪組：dir = 波浪前進方向（度，0 = 往南，也就是順著主風向往下風走）
// length = 波長（公尺）、amp = 振幅（公尺）、steep = 陡度 0~1、phase = 初始相位
export const WAVE_SET = [
  { dir: 0,   length: 46,  amp: 0.36,  steep: 0.50, phase: 0.0 },
  { dir: 31,  length: 27,  amp: 0.21,  steep: 0.58, phase: 1.7 },
  { dir: -38, length: 17,  amp: 0.12,  steep: 0.62, phase: 4.1 },
  { dir: 14,  length: 9.5, amp: 0.065, steep: 0.66, phase: 2.6 },
  { dir: -21, length: 5.8, amp: 0.034, steep: 0.62, phase: 5.3 },
  { dir: 57,  length: 3.6, amp: 0.018, steep: 0.55, phase: 0.9 },
];

// 畫質設定：低畫質減少波浪組數與網格細分
export const QUALITY = {
  high: { waves: 6, radialSegs: 256, innerStep: 0.45, fadeK: 16, envSize: 256 },
  low:  { waves: 4, radialSegs: 128, innerStep: 0.9,  fadeK: 8,  envSize: 128 },
};

const MAX_GUSTS = 6;

// ================= 共用波浪狀態（JS 與 shader 用同一份）=================
let waves = [];                 // 已計算好的波浪參數
let fadeK = 16;
const viewer = new THREE.Vector2();   // 觀察者（攝影機）水平位置，遠處波浪依此淡出

function buildWaves(count, k) {
  fadeK = k;
  const list = WAVE_SET.slice(0, count);
  waves = list.map(w => {
    const a = THREE.MathUtils.degToRad(w.dir);
    const kk = (2 * Math.PI) / w.length;
    const amp = w.amp * OCEAN.waveScale;
    // Q 讓每組波的 Q·k·A = steep / N，總和 < 1，浪峰不會打結
    const q = Math.min(w.steep * OCEAN.steepness, 0.95) / (kk * amp * list.length);
    return {
      dx: Math.sin(a), dz: Math.cos(a),
      k: kk, omega: Math.sqrt(OCEAN.gravity * kk),
      amp, q, phase: w.phase,
      fadeNear: w.length * fadeK,   // 超過這個距離，網格太粗表現不了這組波，逐漸淡出
    };
  });
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 在「未位移的網格座標」(px, pz) 上計算 Gerstner 位移與偏導數，跟 shader 的 gerstner() 一模一樣
function gerstner(px, pz, t, out) {
  let x = 0, y = 0, z = 0;
  let ax = 1, ay = 0, az = 0;   // dP/dx
  let bx = 0, by = 0, bz = 1;   // dP/dz
  const dist = Math.hypot(px - viewer.x, pz - viewer.y);
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const A = w.amp * (1 - smoothstep(w.fadeNear, w.fadeNear * 2, dist));
    if (A <= 0) continue;
    const th = w.k * (w.dx * px + w.dz * pz) - w.omega * t + w.phase;
    const s = Math.sin(th), c = Math.cos(th);
    const QA = w.q * A, kA = w.k * A, QkA = w.q * kA;
    x += QA * w.dx * c; z += QA * w.dz * c; y += A * s;
    ax -= QkA * w.dx * w.dx * s; ay += kA * w.dx * c; az -= QkA * w.dx * w.dz * s;
    bx -= QkA * w.dx * w.dz * s; by += kA * w.dz * c; bz -= QkA * w.dz * w.dz * s;
  }
  out.x = x; out.y = y; out.z = z;
  out.ax = ax; out.ay = ay; out.az = az;
  out.bx = bx; out.by = by; out.bz = bz;
  return out;
}

const tmp = {};
// Gerstner 浪會水平擠壓，所以要反推「哪個網格點最後被推到 (x, z)」
function invert(x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 6; i++) {
    gerstner(px, pz, t, tmp);
    px = x - tmp.x; pz = z - tmp.z;
  }
  return gerstner(px, pz, t, tmp);
}

/** 世界座標 (x, z) 在時間 time 的海面高度（公尺） */
export function getWaveHeight(x, z, time) {
  return invert(x, z, time).y;
}

/** 世界座標 (x, z) 在時間 time 的海面法向量（單位向量） */
export function getWaveNormal(x, z, time, target = new THREE.Vector3()) {
  const g = invert(x, z, time);
  // normal = cross(dP/dz, dP/dx)
  target.set(
    g.by * g.az - g.bz * g.ay,
    g.bz * g.ax - g.bx * g.az,
    g.bx * g.ay - g.by * g.ax,
  );
  return target.normalize();
}

/** 浪的大致最大高度，給畫面效果使用 */
export function getMaxWaveHeight() {
  return waves.reduce((s, w) => s + w.amp, 0);
}

// ================= Shader =================
const commonGLSL = /* glsl */`
  uniform float uTime;
  uniform vec2 uViewer;
  uniform vec4 uWaveA[WAVE_COUNT];   // dx, dz, k, omega
  uniform vec4 uWaveB[WAVE_COUNT];   // amp, q, phase, fadeNear

  void gerstner(vec2 p, out vec3 disp, out vec3 dPdx, out vec3 dPdz) {
    disp = vec3(0.0);
    dPdx = vec3(1.0, 0.0, 0.0);
    dPdz = vec3(0.0, 0.0, 1.0);
    float dist = length(p - uViewer);
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 a = uWaveA[i];
      vec4 b = uWaveB[i];
      float A = b.x * (1.0 - smoothstep(b.w, b.w * 2.0, dist));
      if (A <= 0.0) continue;
      vec2 D = a.xy;
      float th = a.z * dot(D, p) - a.w * uTime + b.z;
      float s = sin(th), c = cos(th);
      float QA = b.y * A, kA = a.z * A, QkA = b.y * kA;
      disp += vec3(QA * D.x * c, A * s, QA * D.y * c);
      dPdx += vec3(-QkA * D.x * D.x * s, kA * D.x * c, -QkA * D.x * D.y * s);
      dPdz += vec3(-QkA * D.x * D.y * s, kA * D.y * c, -QkA * D.y * D.y * s);
    }
  }
`;

const vertexShader = /* glsl */`
  ${commonGLSL}
  uniform vec2 uCenter;
  varying vec2 vGrid;
  varying vec3 vWorld;

  void main() {
    vec2 p = position.xz + uCenter;
    vec3 disp, dx, dz;
    gerstner(p, disp, dx, dz);
    vec3 world = vec3(p.x, 0.0, p.y) + disp;
    vGrid = p;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  ${commonGLSL}
  uniform samplerCube uEnv;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uFoamThreshold;
  uniform float uFogDensity;
  uniform float uMaxHeight;
  uniform vec2 uWindDir;            // 風往哪個方向吹（水平單位向量）
  uniform vec4 uGusts[${MAX_GUSTS}];  // x, z, 半徑, 強度
  varying vec2 vGrid;
  varying vec3 vWorld;

  // ---- 小尺度雜訊（只影響光影，不影響浮力）----
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // value noise，回傳 (值, d/dx, d/dy)
  vec3 noised(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    float v = a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
    vec2 g = du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx);
    return vec3(v, g);
  }
  vec2 ripples(vec2 p, float strength) {
    vec2 drift = uWindDir * uTime;
    vec2 s = noised(p * 0.9 - drift * 0.6).yz * 0.9;
    s += noised(p * 2.3 + vec2(7.1, 3.3) - drift * 1.1).yz * 0.45;
    s += noised(p * 5.7 + vec2(1.7, 9.2) - drift * 1.8).yz * 0.2;
    return s * strength;
  }

  float gustAt(vec2 p) {
    float g = 0.0;
    for (int i = 0; i < ${MAX_GUSTS}; i++) {
      vec4 G = uGusts[i];
      if (G.w <= 0.0) continue;
      float d = length(p - G.xy) / G.z;
      g += G.w * (1.0 - smoothstep(0.35, 1.0, d));
    }
    return clamp(g, 0.0, 1.0);
  }

  void main() {
    vec3 disp, dPdx, dPdz;
    gerstner(vGrid, disp, dPdx, dPdz);
    vec3 N = normalize(cross(dPdz, dPdx));

    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // 陣風區：細碎水紋變多、顏色變深
    float gust = gustAt(vWorld.xz);
    float detail = (0.14 + gust * 0.3) * (1.0 - smoothstep(30.0, 260.0, dist));
    vec2 r = ripples(vWorld.xz * 0.55, detail);
    N = normalize(N + vec3(-r.x, 0.0, -r.y));

    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

    // 天空反射（反射方向不往水面以下）
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = textureCube(uEnv, R).rgb;

    // 水體：浪峰較淺、較透光；背光時浪峰透出綠藍色
    float h = clamp(disp.y / uMaxHeight * 0.5 + 0.5, 0.0, 1.0);
    vec3 water = mix(uDeep, uShallow, pow(h, 2.2) * 0.85);
    float sss = pow(max(dot(-V, uSunDir) * 0.5 + 0.5, 0.0), 3.0) * pow(h, 2.0);
    water += uShallow * sss * 1.6;
    water *= 0.55 + 0.45 * max(uSunDir.y, 0.0) * 2.0;
    water = mix(water, water * 0.55, gust);

    vec3 col = mix(water, sky, fresnel);
    col *= 1.0 - 0.5 * gust;   // 陣風區：碎浪多、反光少 → 看起來較暗

    // 太陽高光：一個銳利的亮點 + 一圈較寬的閃光
    vec3 H = normalize(uSunDir + V);
    float NdH = max(dot(N, H), 0.0);
    float spec = pow(NdH, 1200.0) * 80.0 + pow(NdH, 220.0) * 0.35;
    col += uSunColor * spec * (0.15 + fresnel);

    // 浪峰白沫：Jacobian 越小代表水面被擠壓得越厲害
    float J = dPdx.x * dPdz.z - dPdx.z * dPdz.x;
    float foamNoise = noised(vGrid * 0.8 + uTime * 0.15).x * 0.6 + noised(vGrid * 2.7).x * 0.4;
    float lace = noised(vGrid * 4.5 - uTime * 0.3).x * 0.6 + noised(vGrid * 11.0).x * 0.4;
    float foam = smoothstep(uFoamThreshold, uFoamThreshold - 0.14, J + foamNoise * 0.18 - 0.09);
    foam *= smoothstep(0.3, 0.75, lace + foam * 0.35);
    foam += smoothstep(0.75, 1.0, h) * smoothstep(0.6, 0.9, foamNoise) * smoothstep(0.4, 0.8, lace) * 0.35;
    foam = clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(150.0, 700.0, dist));
    vec3 foamColor = vec3(0.92, 0.96, 1.0) * 2.0 * (0.65 + 0.35 * max(dot(N, uSunDir), 0.0));
    col = mix(col, foamColor, foam * 0.9);

    // 霧氣：遠方淡入地平線上的天空顏色
    vec3 horizonDir = normalize(vec3(-V.x, 0.015, -V.z));
    vec3 fogColor = textureCube(uEnv, horizonDir).rgb;
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.5));
    col = mix(col, fogColor, fog);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// 極座標網格：中心最密、越遠越疏（遠處自動降低精度）
function buildRadialGrid(segs, innerStep, maxRadius) {
  const radii = [0];
  let r = 0;
  const growth = 1 + (2 * Math.PI) / segs;           // 讓徑向間距 ≈ 角向間距
  const crossover = (innerStep * segs) / (2 * Math.PI);
  while (r < crossover) { r += innerStep; radii.push(r); }
  while (r < maxRadius) { r *= growth; radii.push(r); }

  const pos = [0, 0, 0];
  for (let i = 1; i < radii.length; i++) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < radii.length - 1; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return { geometry: g, rings: radii.length, step: innerStep };
}

// ================= Ocean 類別 =================
export class Ocean {
  constructor(scene, envTexture, sunDir, quality = 'high') {
    this.scene = scene;
    this.env = envTexture;
    this.sunDir = sunDir.clone();
    this.mesh = null;
    this.gusts = Array.from({ length: MAX_GUSTS }, () => new THREE.Vector4());
    this.setQuality(quality);
  }

  setQuality(quality) {
    const q = QUALITY[quality];
    this.quality = quality;
    buildWaves(q.waves, q.fadeK);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    const { geometry, step } = buildRadialGrid(q.radialSegs, q.innerStep, 9000);
    this.snap = step * 2;

    const material = new THREE.ShaderMaterial({
      defines: { WAVE_COUNT: waves.length },
      uniforms: {
        uTime: { value: 0 },
        uViewer: { value: viewer },
        uCenter: { value: new THREE.Vector2() },
        uWaveA: { value: waves.map(w => new THREE.Vector4(w.dx, w.dz, w.k, w.omega)) },
        uWaveB: { value: waves.map(w => new THREE.Vector4(w.amp, w.q, w.phase, w.fadeNear)) },
        uEnv: { value: this.env },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(18) },
        uDeep: { value: new THREE.Vector3(...OCEAN.deepColor) },
        uShallow: { value: new THREE.Vector3(...OCEAN.shallowColor) },
        uFoamThreshold: { value: OCEAN.foamThreshold },
        uFogDensity: { value: OCEAN.fogDensity },
        uMaxHeight: { value: getMaxWaveHeight() },
        uWindDir: { value: new THREE.Vector2(0, 1) },
        uGusts: { value: this.gusts },
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;  // 頂點在 shader 裡移動，不能用包圍盒裁切
    this.mesh.renderOrder = -1;
    this.scene.add(this.mesh);
  }

  /** 每幀呼叫：更新時間與網格中心（跟著攝影機） */
  update(time, cameraPosition) {
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    viewer.set(cameraPosition.x, cameraPosition.z);
    u.uCenter.value.set(
      Math.round(cameraPosition.x / this.snap) * this.snap,
      Math.round(cameraPosition.z / this.snap) * this.snap,
    );
  }

  /** 陣風區域（由 wind.js 提供）：[{x, z, radius, strength 0~1}] */
  setGusts(list, windDir) {
    for (let i = 0; i < MAX_GUSTS; i++) {
      const g = list[i];
      if (g) this.gusts[i].set(g.x, g.z, g.radius, g.strength);
      else this.gusts[i].set(0, 0, 1, 0);
    }
    if (windDir) this.mesh.material.uniforms.uWindDir.value.copy(windDir);
  }
}

// ================= 天空與環境 =================
export function sunDirection() {
  const el = THREE.MathUtils.degToRad(OCEAN.sunElevation);
  const az = THREE.MathUtils.degToRad(OCEAN.sunAzimuth);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/**
 * 建立 Three.js Sky、海面反射用的天空 cube map、物體用的環境光（PMREM）。
 * 回傳 { sky, envCube, sunDir }
 */
export function createSky(renderer, scene, quality = 'high') {
  const sunDir = sunDirection();
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.cloudCoverage.value = 0.32;
  u.cloudDensity.value = 0.45;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // 海面反射用的天空 cube map
  const skyScene = new THREE.Scene();
  const skyCopy = new Sky();
  skyCopy.scale.setScalar(10000);
  skyCopy.material.uniforms = sky.material.uniforms;   // 共用參數
  skyScene.add(skyCopy);
  const size = QUALITY[quality].envSize;
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 20000, cubeRT);
  u.showSunDisc.value = 0;   // 太陽高光由海面 shader 自己算，反射圖裡不要太陽本體
  cubeCam.update(renderer, skyScene);

  // 船、浮標用的環境光
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(skyScene).texture;
  u.showSunDisc.value = 1;
  pmrem.dispose();

  return { sky, envCube: cubeRT.texture, sunDir };
}
