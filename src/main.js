// main.js — 進入點：渲染器、場景、攝影機、主迴圈、畫質設定
import * as THREE from 'three';
import { Ocean, createSky, getWaveHeight } from './ocean.js';
import { Boat, BOAT } from './boat.js';
import { Wind } from './wind.js';
import { Game } from './game.js';
import { ui } from './ui.js';
import { input, readInput, initPose, useKeyboard, useCam } from './pose.js';

const DEG = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- 畫質 ----------
let quality = 'high';
try { quality = localStorage.getItem('sail-quality') || 'high'; } catch { /* 無痕模式 */ }
const PIXEL_RATIO = { high: Math.min(devicePixelRatio, 1.75), low: Math.min(devicePixelRatio, 1) * 0.8 };

// ---------- 渲染器與場景 ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(PIXEL_RATIO[quality]);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.42;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc9d6df, 0.0004);   // 只影響船/浮標，海面有自己的霧
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 20000);

const { sky, envCube, sunDir } = createSky(renderer, scene, quality);
const ocean = new Ocean(scene, envCube, sunDir, quality);
const sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);

const boat = new Boat(scene);
const wind = new Wind();
const game = new Game({ scene, boat, wind });

// ---------- 第三人稱追蹤攝影機 ----------
// 位置與朝向都經過平滑，只跟隨船的「平均」高度，不跟著每個浪抖動
const rig = {
  yaw: 0, baseY: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, orbit: 0, sideBlend: 0,
};
function updateCamera(dt, t) {
  const p = boat.pos;
  rig.baseY += (p.y - rig.baseY) * Math.min(1, dt * 0.6);
  let dist = 13, height = 5.2, off = 0, yawLag = 1.4;
  if (game.phase === 'menu') { rig.orbit += dt * 0.12; off = rig.orbit; dist = 15; height = 4.5; }
  const capsized = game.phase === 'capsize' || game.phase === 'done';
  rig.sideBlend += ((capsized ? 1 : 0) - rig.sideBlend) * Math.min(1, dt * 0.8);
  if (rig.sideBlend > 0.001) {
    // 翻船：轉到船底那一側（水手在那裡），拉近一點
    off += boat.capsizeSide * 65 * DEG * rig.sideBlend;
    dist -= 3 * rig.sideBlend; height -= 1 * rig.sideBlend;
    yawLag = 0.5;
  }
  if (!rig.init) { rig.yaw = boat.heading; rig.baseY = p.y; }
  rig.yaw += wrap(boat.heading - rig.yaw) * Math.min(1, dt * yawLag);
  const a = rig.yaw + off;
  const want = new THREE.Vector3(p.x - Math.sin(a) * dist, rig.baseY + height, p.z + Math.cos(a) * dist);
  // 不讓攝影機鑽進浪裡
  want.y = Math.max(want.y, getWaveHeight(want.x, want.z, t) + 1.5);
  const look = new THREE.Vector3(p.x + Math.sin(rig.yaw) * 4 * (1 - rig.sideBlend), rig.baseY + 1.4, p.z - Math.cos(rig.yaw) * 4 * (1 - rig.sideBlend));
  if (!rig.init) { rig.pos.copy(want); rig.look.copy(look); rig.init = true; }
  rig.pos.lerp(want, Math.min(1, dt * 3));
  rig.look.lerp(look, Math.min(1, dt * 4));
  camera.position.copy(rig.pos);
  camera.lookAt(rig.look);
}

// ---------- 目標浮標提示（畫面內 / 畫面外箭頭） ----------
const _v = new THREE.Vector3();
function updateTargetHint() {
  const b = game.next;
  if (!b || !['sail', 'jacket'].includes(game.phase)) { ui.updateTarget(null); return; }
  const dist = Math.hypot(b.x - boat.pos.x, b.z - boat.pos.z);
  _v.set(b.x, b.group.position.y + 7.5, b.z).project(camera);
  const W = innerWidth, H = innerHeight, m = 60;
  const behind = _v.z > 1;
  let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
  const onScreen = !behind && x > m && x < W - m && y > m && y < H - m;
  let angle = 180;  // 箭頭朝下指著浮標
  if (!onScreen) {
    // 用水平方向決定箭頭方向，貼著畫面邊緣
    const rel = wrap(Math.atan2(b.x - camera.position.x, -(b.z - camera.position.z)) - rig.yaw);
    angle = rel / DEG;
    const r = Math.min(W, H) * 0.42;
    x = W / 2 + Math.sin(rel) * r;
    y = H / 2 - Math.cos(rel) * r * 0.8;
  }
  ui.updateTarget({ x, y, angle, dist, label: `第 ${b.index + 1} 個浮標` });
}

// ---------- 畫質切換 ----------
function setQuality(q) {
  quality = q;
  try { localStorage.setItem('sail-quality', q); } catch { /* 無痕模式 */ }
  ocean.setQuality(q);
  renderer.setPixelRatio(PIXEL_RATIO[q]);
  renderer.setSize(innerWidth, innerHeight);
  ui.setQualityLabel(q);
}
document.getElementById('qualityBtn').onclick = () => setQuality(quality === 'high' ? 'low' : 'high');
ui.setQualityLabel(quality);

// ---------- 開始畫面 ----------
function startKeyboard() {
  useKeyboard();
  document.getElementById('cam').classList.remove('on');
  game.start(false);
}
function showMenu() {
  ui.setHudVisible(false);
  ui.showMenu({
    quality,
    onQuality: setQuality,
    onKey: startKeyboard,
    onCam: async () => {
      try {
        await initPose(document.getElementById('cam'), document.getElementById('skeleton'));
        game.start(true);
      } catch (err) {
        console.error(err);
        ui.showCamError(err, { onRetry: () => location.reload(), onKey: startKeyboard });
      }
    },
  });
}
showMenu();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// 鏡頭小視窗下方：目前偵測到的動作
const arrow = v => v < -0.15 ? '←' : v > 0.15 ? '→' : '・';
function poseHint() {
  return `轉向 ${arrow(input.steer)}　帆 ${Math.round(input.trim * 100)}%　壓舷 ${arrow(input.hike)}`
    + (input.jacket ? '　手在胸前' : '') + (input.raise ? '　舉手' : '');
}

// ---------- 主迴圈 ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, simTime = 0;
renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.05)));

function frame(dt, render = true) {
  const t = (simTime += dt);
  if (game.phase !== 'menu' && game.phase !== 'done') readInput();

  wind.update(dt, t, boat.pos);
  game.update(dt, t, input);
  boat.float(dt, t);
  boat.updateVisual(dt, t);
  updateCamera(dt, t);

  ocean.setGusts(wind.oceanGusts(), wind.dir);
  ocean.update(t, camera.position);
  sky.material.uniforms.time.value = t;

  if (game.phase !== 'menu' && game.phase !== 'done') {
    ui.updateHud({ elapsed: game.elapsed, buoys: game.nextBuoy, total: game.buoys.length, speed: boat.speed, boat, capsizeAngle: BOAT.capsizeAngle });
    const w = game.windHere || wind.sample(boat.pos.x, boat.pos.z);
    ui.updateWind({ windFrom: w.from, cameraYaw: rig.yaw, boatHeading: boat.heading, speed: w.speed, gust: w.gust });
    if (useCam) ui.setPoseHint(input.visible ? poseHint() : '偵測不到身體');
  } else ui.setPoseHint('');
  updateTargetHint();

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { ui.setFps(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (render) renderer.render(scene, camera);
}

// 除錯用：在主控台可用 __tick(秒數) 快轉模擬
Object.assign(window, {
  __game: game, __boat: boat, __wind: wind, __input: input,
  __tick: secs => { for (let i = 0; i < secs * 60; i++) frame(1 / 60, false); renderer.render(scene, camera); },
});
