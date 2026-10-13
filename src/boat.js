// boat.js — 單人小帆船：模型、浮力、航行物理、側傾與翻船
import * as THREE from 'three';
import { getWaveHeight } from './ocean.js';

const DEG = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ================= 可調整參數 =================
export const BOAT = {
  // --- 航行 ---
  noGoAngle: 43 * DEG,     // 逆風禁區（船頭與風的夾角小於這個角度就吃不到風）
  speedRatio: 0.6,         // 最佳狀態下船速 / 風速
  accel: 0.55,             // 加速反應（越大越快達到目標速度）
  decel: 0.3,              // 減速反應（越小慣性越大）
  // --- 轉向 ---
  maxRudder: 35 * DEG,     // 舵最大角度
  rudderSpeed: 2.2,        // 舵每秒最多轉多少弧度（轉向延遲）
  turnGain: 1.25,          // 舵效
  turnRefSpeed: 2.2,       // 船速達到這個值（m/s）時舵效 = 100%
  minSteer: 0.22,          // 船停住時仍保有的最低舵效
  yawResponse: 2.2,        // 轉向慣性（越小越「拖」）
  // --- 側傾 ---
  windRef: 6,              // 參考風速（m/s），側傾力與 (風速/參考風速)² 成正比
  heelPower: 0.96,         // 帆產生的側傾力
  hullRighting: 1.0,       // 船身扶正力（最大值在 45 度）
  crewBase: 0.35,          // 水手自動坐在上風舷的扶正力
  hikeMoment: 0.9,         // 玩家壓舷時額外的扶正力
  heelInertia: 0.55,       // 側傾慣性
  heelDamping: 2.4,        // 側傾阻尼
  capsizeAngle: 60 * DEG,  // 翻船角度：側傾超過這個角度就翻船
  // --- 浮力 ---
  draft: 0.15,             // 靜止時取樣點吃水深度
  buoyDamping: 6,          // 上下起伏阻尼
};

// 浮力取樣點（船身座標：x = 右舷、z = 船尾方向；船頭在 -z）
const SAMPLES = [
  [0, -1.75], [-0.42, -0.95], [0.42, -0.95],
  [-0.62, 0.1], [0.62, 0.1], [-0.55, 1.85], [0.55, 1.85],
];

// ================= 船身幾何 =================
const L = 4.2, SHEER = 0.32;

function halfBeam(s) {           // s: 0 = 船頭, 1 = 船尾
  const bow = Math.pow(Math.sin(Math.min(1, s * 1.7) * Math.PI / 2), 0.75);
  return 0.69 * bow * (1 - 0.14 * smooth(0.6, 1, s));
}
function keelY(s) {              // 船底高度（有船頭上翹）
  return -0.17 + 0.42 * Math.pow(1 - smooth(0, 0.45, s), 1.6) + 0.1 * smooth(0.75, 1, s);
}

function buildHull() {
  const NS = 28, NA = 18;
  const pos = [], col = [], idx = [];
  const white = [0.92, 0.93, 0.94], navy = [0.05, 0.1, 0.2], red = [0.7, 0.12, 0.1];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, z = -L / 2 + L * s, w = halfBeam(s), ky = keelY(s);
    for (let j = 0; j <= NA; j++) {
      const th = (j / NA) * Math.PI;        // 0 = 右舷舷緣, π = 左舷舷緣
      const x = w * Math.cos(th);
      const y = SHEER - (SHEER - ky) * Math.pow(Math.sin(th), 0.45);
      pos.push(x, y, z);
      col.push(...(y > 0.07 ? white : y > 0.0 ? navy : red));
    }
  }
  const row = NA + 1;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NA; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // 船尾板
  const base = pos.length / 3;
  pos.push(0, SHEER, L / 2); col.push(...white);
  for (let j = 0; j < NA; j++) idx.push(base, NS * row + j + 1, NS * row + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildDeck() {
  const shape = new THREE.Shape();
  const N = 28;
  for (let i = 0; i <= N; i++) { const s = i / N; shape[i ? 'lineTo' : 'moveTo'](halfBeam(s), -L / 2 + L * s); }
  for (let i = N; i >= 0; i--) { const s = i / N; shape.lineTo(-halfBeam(s), -L / 2 + L * s); }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);                 // shape 的 y → 世界 z
  g.translate(0, SHEER, 0);
  return g;
}

// ================= 水手（簡單人偶） =================
function buildSailor() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6, emissive: 0x401000 });
  const legsMat = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.9 });

  const hips = new THREE.Group();          // 以臀部為軸壓舷
  g.add(hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.38, 4, 10), shirt);
  torso.position.y = 0.36; hips.add(torso);
  const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.26, 4, 10), jacket);
  vest.position.y = 0.4; vest.visible = false; hips.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), skin);
  head.position.y = 0.78; hips.add(head);
  const armGeo = new THREE.CapsuleGeometry(0.05, 0.45, 3, 6);
  armGeo.translate(0, -0.27, 0);
  const armL = new THREE.Mesh(armGeo, shirt), armR = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.2, 0.6, 0); armR.position.set(0.2, 0.6, 0);
  hips.add(armL, armR);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 3, 6), legsMat);
  legs.rotation.x = Math.PI / 2.4; legs.position.set(0, 0.0, -0.35); g.add(legs);
  g.userData = { hips, vest, armL, armR, legs };
  return g;
}

// ================= 主帆 =================
const SAIL_H = 4.9, FOOT = 2.7, BOOM_Y = 0.75, NU = 8, NV = 12;
function chordAt(v) { return FOOT * (1 - v) + 0.38 * Math.sin(Math.PI * v) * (1 - v * 0.5); }

// ================= Boat 類別 =================
export class Boat {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);

    const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.0, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(buildHull(), hullMat));
    const deck = new THREE.Mesh(buildDeck(), new THREE.MeshStandardMaterial({ color: 0xdfe3e2, roughness: 0.8, side: THREE.DoubleSide }));
    this.group.add(deck);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 1.1), new THREE.MeshStandardMaterial({ color: 0x55606a, roughness: 0.9 }));
    cockpit.position.set(0, SHEER + 0.005, 0.95); this.group.add(cockpit);

    // 中央板與舵
    const foil = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.5 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, 0.3), foil);
    board.position.set(0, -0.55, -0.35); this.group.add(board);
    this.rudder = new THREE.Group();
    this.rudder.position.set(0, 0.1, L / 2 + 0.02);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.24), foil);
    blade.position.set(0, -0.35, 0.12);
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
    tiller.rotation.x = Math.PI / 2; tiller.position.set(0, 0.32, -0.45);
    this.rudder.add(blade, tiller);
    this.group.add(this.rudder);

    // 桅杆
    const spar = new THREE.MeshStandardMaterial({ color: 0xb8c0c6, roughness: 0.3, metalness: 0.7 });
    const mastZ = -0.75;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 5.9, 10), spar);
    mast.position.set(0, SHEER + 2.95, mastZ); this.group.add(mast);

    // 帆桁 + 主帆（掛在可繞桅杆旋轉的 pivot 上）
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, SHEER, mastZ);
    this.group.add(this.pivot);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, FOOT + 0.1, 8), spar);
    boom.rotation.x = Math.PI / 2; boom.position.set(0, BOOM_Y, FOOT / 2);
    this.pivot.add(boom);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((NU + 1) * (NV + 1) * 3), 3));
    const uv = [], si = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) uv.push(i / NU, j / NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + NU + 1;
      si.push(a, b, a + 1, a + 1, b, b + 1);
    }
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(si);
    this.sailGeo = sg;
    this.sailMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({
      color: 0xd6322b, roughness: 0.75, side: THREE.DoubleSide, map: sailTexture(),
    }));
    this.pivot.add(this.sailMesh);

    // 水手
    this.sailor = buildSailor();
    this.group.add(this.sailor);

    this.wake = new Wake(scene);
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;         // 0 = 北（-z），順時針為正
    this.speed = 0;                 // m/s
    this.yawRate = 0;
    this.rudderAngle = 0;
    this.trim = 0.5;                // 0 = 收緊, 1 = 放鬆
    this.boomAngle = 0.3;
    this.heel = 0; this.heelRate = 0;     // 正值 = 右舷往下
    this.vy = 0; this.pitch = 0; this.pitchRate = 0; this.roll = 0; this.rollRate = 0;
    this.capsized = false; this.capsizeT = 0; this.capsizeSide = 1;
    this.righting = 0;
    this.luff = 0; this.overSheet = 0; this.efficiency = 0; this.ideal = 0.5; this.inIrons = false;
    this.hike = 0; this.jacketOn = false; this.raise = false; this.windSide = 1; this.awa = 1;
    this.wake.clear();
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, -Math.cos(this.heading)); }

  // ---------- 航行物理（風 + 帆 + 舵 + 側傾） ----------
  /**
   * @param input { steer -1~1, trim 0~1, hike -1~1 }
   * @param wind  { from 弧度, speed m/s }
   */
  sail(dt, input, wind) {
    if (this.capsized) return;
    const B = BOAT;
    // 舵：有轉動速度上限 → 轉向延遲
    const targetRudder = clamp(input.steer, -1, 1) * B.maxRudder;
    this.rudderAngle += clamp(targetRudder - this.rudderAngle, -B.rudderSpeed * dt, B.rudderSpeed * dt);
    // 帆繩：玩家的手不會瞬間到位
    this.trim += (input.trim - this.trim) * Math.min(1, dt * 4);
    this.hike += (clamp(input.hike || 0, -1, 1) - this.hike) * Math.min(1, dt * 5);

    const rel = wrap(wind.from - this.heading);   // 風從船的哪一側來：正 = 右舷
    const awa = Math.abs(rel);
    const windSide = Math.sign(rel) || 1;          // 上風舷
    this.awa = awa; this.windSide = windSide;

    // 帆角：依 trim 開合，自動擺到下風側
    const maxBoom = Math.min(awa - 5 * DEG, 86 * DEG);   // 帆不會越過風的方向
    const wantBoom = Math.max(4 * DEG, Math.min(4 * DEG + this.trim * 82 * DEG, Math.max(maxBoom, 4 * DEG)));
    const targetBoom = -windSide * wantBoom;
    this.boomAngle += (targetBoom - this.boomAngle) * Math.min(1, dt * (Math.sign(targetBoom) !== Math.sign(this.boomAngle) ? 2.5 : 5));

    // 帆的效率：理想帆角隨風角線性增加
    const ideal = clamp((awa - B.noGoAngle) / (Math.PI - B.noGoAngle), 0, 1);
    this.ideal = ideal;
    this.efficiency = Math.max(0, 1 - Math.abs(this.trim - ideal) * 2.2);
    this.luff = clamp((this.trim - ideal - 0.06) * 3, 0, 1) + (awa < B.noGoAngle ? 1 : 0);
    this.luff = Math.min(1, this.luff);
    this.overSheet = Math.max(0, ideal - this.trim);
    this.inIrons = awa < B.noGoAngle;

    // 目標船速
    const ramp = smooth(B.noGoAngle, B.noGoAngle + 6 * DEG, awa);
    const polar = ramp * (0.45 + 0.55 * Math.sin(awa));
    const heelLoss = Math.pow(Math.cos(this.heel), 2);
    const target = wind.speed * B.speedRatio * polar * this.efficiency * heelLoss;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? B.accel : B.decel));
    this.speed = Math.max(0, this.speed);

    // 轉向：速度越慢舵效越差；側傾會讓船往上風偏（weather helm）
    const steerEff = clamp(this.speed / B.turnRefSpeed, B.minSteer, 1.3);
    const weatherHelm = -this.heel * 0.12;   // 右舷下沉 → 往左偏
    const targetYaw = (this.rudderAngle / B.maxRudder) * B.turnGain * steerEff + weatherHelm * steerEff;
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, dt * B.yawResponse);
    this.heading = wrap(this.heading + this.yawRate * dt);

    // 側傾力矩：帆越緊、風越強（陣風）→ 越傾斜；飄帆時幾乎沒有力
    const q = Math.pow(wind.speed / B.windRef, 2);
    const side = ramp * Math.sin(Math.max(awa, 0.2)) * (1 + this.overSheet * 1.3) * (1 - this.luff * 0.85);
    const heelMoment = -windSide * B.heelPower * q * side * Math.cos(this.heel);
    // 水手自動坐到上風舷抵銷一部分側傾力（最多 crewBase），玩家壓舷再多加 hikeMoment
    const auto = -Math.sign(heelMoment) * Math.min(Math.abs(heelMoment), B.crewBase);
    this.autoCrew = auto / B.crewBase;
    const crew = auto * Math.cos(this.heel) + this.hike * B.hikeMoment * Math.cos(this.heel);
    const righting = B.hullRighting * Math.sin(2 * this.heel);
    const acc = (heelMoment + crew - righting) / B.heelInertia - B.heelDamping * this.heelRate;
    this.heelRate += acc * dt;
    this.heel += this.heelRate * dt;
    this.heelMoment = heelMoment;

    if (Math.abs(this.heel) > B.capsizeAngle) this.capsize(Math.sign(this.heel));

    // 前進
    const f = this.forward(_v);
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
  }

  capsize(side) {
    if (this.capsized) return;
    this.capsized = true;
    this.capsizeSide = side || -this.windSide || 1;
    this.capsizeT = 0;
    this.heelRate = 1.5 * this.capsizeSide;
  }

  /** 救援後把船扶正 */
  rightBoat() {
    this.righting = 2.0;
  }

  // ---------- 浮力（每幀都要跑） ----------
  float(dt, time) {
    const B = BOAT;
    const steps = 4, h = dt / steps;
    const k = 9.81 / (SAMPLES.length * B.draft);
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (let n = 0; n < steps; n++) {
      let F = 0, Tp = 0, Tr = 0;
      for (const [lx, lz] of SAMPLES) {
        // 船身座標 → 世界座標（只用航向轉；俯仰/橫搖用線性近似）
        const wx = this.pos.x + lx * c - lz * s;
        const wz = this.pos.z + lx * s + lz * c;
        const py = this.pos.y - B.draft - lz * Math.sin(this.pitch) + lx * Math.sin(this.roll);
        const depth = clamp(getWaveHeight(wx, wz, time) - py, 0, 0.7);
        const f = k * depth;
        F += f; Tp += f * -lz; Tr += f * lx;
      }
      this.vy += (F - 9.81 - B.buoyDamping * this.vy) * h;
      this.pos.y += this.vy * h;
      this.pitchRate += (Tp * 0.08 - 3.5 * this.pitchRate) * h;
      this.pitch += this.pitchRate * h;
      this.rollRate += (Tr * 0.9 - 3.0 * this.rollRate) * h;
      this.roll += this.rollRate * h;
    }

    // 翻船：倒向一側並停在約 100 度，船帆平躺在水面上
    if (this.capsized) {
      this.capsizeT += dt;
      this.speed *= Math.max(0, 1 - dt * 1.5);
      const target = this.capsizeSide * 94 * DEG;   // 船身側躺、帆平貼在水面
      if (this.righting > 0) {
        this.righting -= dt;
        this.heel += (0 - this.heel) * Math.min(1, dt * 2.2);
        if (this.righting <= 0) { this.capsized = false; this.heel = 0; this.heelRate = 0; this.speed = 0; }
      } else {
        this.heelRate += ((target - this.heel) * 6 - 3.5 * this.heelRate) * dt;
        this.heel += this.heelRate * dt;
      }
      const f = this.forward(_v);
      this.pos.x += f.x * this.speed * dt;
      this.pos.z += f.z * this.speed * dt;
    }
  }

  // ---------- 更新畫面 ----------
  updateVisual(dt, time) {
    this.group.position.copy(this.pos);
    // 翻船時船身會比較低
    if (this.capsized) this.group.position.y -= 0.15 * smooth(0, 1.2, this.capsizeT);
    this.group.rotation.set(this.pitch, -this.heading, this.roll - this.heel);
    this.pivot.rotation.y = this.boomAngle;
    this.rudder.rotation.y = this.rudderAngle;
    this.updateSailShape(time);
    this.updateSailor(dt, time);
    this.wake.update(this, time);
  }

  updateSailShape(time) {
    const p = this.sailGeo.attributes.position;
    const side = Math.sign(this.boomAngle) || 1;
    const luff = this.capsized ? 0.15 : this.luff;
    const depth = 0.1 * (1 - luff * 0.7);
    let n = 0;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, chord = chordAt(v);
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const belly = 4 * u * (1 - u);
        let x = side * depth * chord * belly * (1 - 0.35 * v);
        // 帆太鬆會飄（luffing）
        x += luff * 0.12 * chord * belly * Math.sin(time * 22 + u * 7 + v * 5) * (0.4 + v);
        p.setXYZ(n++, x, BOOM_Y + v * SAIL_H, u * chord);
      }
    }
    p.needsUpdate = true;
    this.sailGeo.computeVertexNormals();
  }

  updateSailor(dt, time) {
    const s = this.sailor, d = s.userData;
    d.vest.visible = this.jacketOn;
    if (this.capsized && this.righting <= 0) {
      // 在水裡：抓著船底那一側，頭露出水面（用世界座標擺放，不跟著船身一起倒）
      const k = smooth(0.3, 1.3, this.capsizeT);
      const c = Math.cos(this.heading), sn = Math.sin(this.heading);
      const off = -this.capsizeSide * 1.0;   // 船底朝上的那一側
      const wx = this.pos.x + off * c + 0.4 * sn, wz = this.pos.z + off * sn - 0.4 * c;
      _w.set(wx, getWaveHeight(wx, wz, time) - 0.45, wz);
      this.group.updateMatrixWorld();
      s.position.copy(this.group.worldToLocal(_w));
      _q.setFromAxisAngle(_up, -this.heading + Math.PI / 2 * this.capsizeSide);
      s.quaternion.copy(this.group.quaternion).invert().multiply(_q);
      s.visible = k > 0.05;
      d.hips.rotation.z = 0;
      d.legs.visible = false;
      // 舉手求救（揮手）
      const wave = this.raise ? Math.PI * 0.95 + Math.sin(time * 8) * 0.25 : 0.4;
      d.armR.rotation.z += (wave - d.armR.rotation.z) * Math.min(1, dt * 6);
      d.armL.rotation.z = -0.5;
      return;
    }
    s.visible = true;
    d.legs.visible = true;
    // 坐在上風舷，壓舷時身體往外倒
    const side = this.windSide || 1;
    const hikeOut = clamp(side * this.hike, 0, 1);           // 往上風（正確方向）壓
    const lean = clamp(side * this.hike, -1, 0);             // 往錯的方向倒
    s.position.set(side * 0.5, SHEER + 0.05, 0.75);
    s.quaternion.identity();
    d.hips.rotation.z = -side * (0.15 + hikeOut * 0.85) - side * lean * 0.5;
    d.armR.rotation.z = 0.25; d.armL.rotation.z = -0.25;
  }

  /** 讓浮標/攝影機用：船在世界座標的位置 */
  get position() { return this.pos; }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

// 帆上的白色號碼與條紋
function sailTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f2c230'; g.fillRect(0, 150, 256, 18);
  g.beginPath(); g.arc(70, 95, 30, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================= 船尾的尾跡 =================
function foamTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
  // 沿著航跡方向拉長的泡沫紋（當作透明度貼圖：白 = 不透明）
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * 128, y = Math.random() * 256;
    const edge = Math.min(x, 128 - x) / 64;                  // 兩側較多泡沫
    const a = (0.15 + 0.5 * Math.pow(1 - edge, 2)) * Math.random();
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.ellipse(x, y, 1 + Math.random() * 3, 3 + Math.random() * 12, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

class Wake {
  constructor(scene) {
    this.N = 70;
    this.points = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.N * 2 * 3), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.N * 2 * 4), 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(this.N * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: foamTexture(),
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.dist = 0;
    this.last = null;
  }
  clear() { this.points = []; this.last = null; }
  update(boat, time) {
    const f = boat.forward(_v);
    const sx = boat.pos.x - f.x * 2.1, sz = boat.pos.z - f.z * 2.1;
    // 每前進 0.6 公尺記一個點
    const moved = this.last ? Math.hypot(sx - this.last.x, sz - this.last.z) : 99;
    if (!boat.capsized && moved > 0.6) {
      this.dist += Math.min(moved, 5);
      this.last = { x: sx, z: sz };
      this.points.unshift({ x: sx, z: sz, px: -f.z, pz: f.x, t: time, v: boat.speed, d: this.dist });
      if (this.points.length > this.N) this.points.pop();
    }
    const pos = this.geo.attributes.position, col = this.geo.attributes.color, uv = this.geo.attributes.uv;
    for (let i = 0; i < this.N; i++) {
      const p = i === 0 && this.points[0] ? { ...this.points[0], x: sx, z: sz, t: time } : this.points[i];
      if (!p) { col.setW(i * 2, 0); col.setW(i * 2 + 1, 0); continue; }
      const age = time - p.t;
      const w = 0.3 + age * 0.35;
      const y = getWaveHeight(p.x, p.z, time) + 0.05;
      pos.setXYZ(i * 2, p.x + p.px * w, y, p.z + p.pz * w);
      pos.setXYZ(i * 2 + 1, p.x - p.px * w, y, p.z - p.pz * w);
      uv.setXY(i * 2, 0, p.d / 6); uv.setXY(i * 2 + 1, 1, p.d / 6);
      const a = clamp(p.v / 2.5, 0, 1) * Math.max(0, 1 - age / 7) * 0.9;
      col.setXYZW(i * 2, 2.4, 2.5, 2.6, a); col.setXYZW(i * 2 + 1, 2.4, 2.5, 2.6, a);
    }
    pos.needsUpdate = true; col.needsUpdate = true; uv.needsUpdate = true;
  }
}
