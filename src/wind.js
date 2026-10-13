// wind.js — 主風向、緩慢擺動的風向、隨機陣風、最後的強陣風
import * as THREE from 'three';

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ================= 可調整參數 =================
export const WIND = {
  baseFrom: 0,              // 主風向（度）：風「從」哪裡吹來，0 = 北（畫面前方），順時針
  baseSpeed: 6,             // 平均風速（m/s），6 m/s ≈ 12 節
  shiftAmp: 8,              // 風向擺動幅度（度）
  shiftPeriod: 75,          // 風向擺動週期（秒）
  speedWobble: 0.08,        // 平均風速的緩慢起伏（比例）
  gustInterval: [7, 15],    // 陣風出現間隔（秒）
  gustStrength: [0.2, 0.45],// 陣風強度：風速增加的比例（0.45 = 風速 ×1.45）
  gustRadius: [22, 42],     // 陣風區半徑（公尺）
  gustSpawnDist: [70, 120], // 陣風在船的上風多遠處生成（公尺）
  gustShift: 6,             // 陣風裡的風向偏轉（度）
  squallStrength: 2.4,      // 最後強陣風：風速 ×(1 + 這個值)
  squallRadius: 55,
};

export class Wind {
  constructor() {
    this.gusts = [];
    this.nextGust = 4;
    this.time = 0;
    this.from = WIND.baseFrom * DEG;
    this.speed = WIND.baseSpeed;
    this.dir = new THREE.Vector2(0, 1);   // 風往哪吹（x, z）
    this.squall = null;
    this.enabled = true;
  }

  reset() {
    this.gusts = [];
    this.nextGust = 4;
    this.squall = null;
  }

  /** 主風向（不含陣風） */
  baseFromAt(t) {
    return (WIND.baseFrom + WIND.shiftAmp * (Math.sin(t * 2 * Math.PI / WIND.shiftPeriod) * 0.75
      + Math.sin(t * 2 * Math.PI / (WIND.shiftPeriod * 0.43) + 1.3) * 0.25)) * DEG;
  }

  update(dt, t, boatPos) {
    this.time = t;
    this.from = this.baseFromAt(t);
    this.speed = WIND.baseSpeed * (1 + WIND.speedWobble * Math.sin(t * 0.21 + 0.7));
    this.dir.set(-Math.sin(this.from), Math.cos(this.from));

    // 生成陣風：在船的上風處出現，順著風飄過來
    if (this.enabled && !this.squall) {
      this.nextGust -= dt;
      if (this.nextGust <= 0 && this.gusts.length < 4) {
        this.nextGust = rand(...WIND.gustInterval);
        const d = rand(...WIND.gustSpawnDist), lateral = rand(-35, 35);
        this.gusts.push({
          x: boatPos.x - this.dir.x * d + this.dir.y * lateral,
          z: boatPos.z - this.dir.y * d - this.dir.x * lateral,
          radius: rand(...WIND.gustRadius),
          peak: rand(...WIND.gustStrength),
          strength: 0, age: 0,
          speed: this.speed * rand(0.8, 1.1),
          life: (d + 80) / (this.speed * 0.95),
        });
      }
    }
    for (const g of this.gusts) {
      g.age += dt;
      g.x += this.dir.x * g.speed * dt;
      g.z += this.dir.y * g.speed * dt;
      g.strength = g.peak * smooth(0, 3, g.age) * (1 - smooth(g.life - 4, g.life, g.age));
    }
    this.gusts = this.gusts.filter(g => g.age < g.life);

    if (this.squall) {
      const s = this.squall;
      s.age += dt;
      s.x += this.dir.x * s.speed * dt;
      s.z += this.dir.y * s.speed * dt;
      s.strength = s.peak * smooth(0, 2, s.age);
    }
  }

  /** 陣風區的影響量（風速增加的比例），衰減形狀與海面 shader 的 gustAt() 相同 */
  gustAt(x, z) {
    let g = 0;
    const list = this.squall ? [...this.gusts, this.squall] : this.gusts;
    for (const G of list) {
      const d = Math.hypot(x - G.x, z - G.z) / G.radius;
      g += G.strength * (1 - smooth(0.35, 1, d));
    }
    return g;
  }

  /** 某個位置的風：{ from 弧度, speed m/s, gust 0~1 } */
  sample(x, z) {
    const g = this.gustAt(x, z);
    return {
      from: this.from + Math.min(g, 1) * WIND.gustShift * DEG * Math.sin(this.time * 0.37),
      speed: this.speed * (1 + g),
      gust: g,
    };
  }

  /** 最後一個浮標後：一陣強風從上風處直接撲向船 */
  triggerSquall(boatPos) {
    const d = 50;
    this.squall = {
      x: boatPos.x - this.dir.x * d, z: boatPos.z - this.dir.y * d,
      radius: WIND.squallRadius, peak: WIND.squallStrength, strength: 0, age: 0,
      speed: this.speed * 1.6,
    };
  }

  clearSquall() { this.squall = null; }

  /** 給海面 shader 的陣風資料（強度壓在 0~1 以內） */
  oceanGusts() {
    const list = this.gusts.map(g => ({ x: g.x, z: g.z, radius: g.radius, strength: Math.min(1, g.strength / 0.45) }));
    if (this.squall) list.unshift({ x: this.squall.x, z: this.squall.z, radius: this.squall.radius, strength: Math.min(1, this.squall.strength) });
    return list;
  }

  /** 船附近即將到來的陣風（給 HUD 提示） */
  incoming(boatPos) {
    let best = null;
    for (const g of this.gusts) {
      const dx = boatPos.x - g.x, dz = boatPos.z - g.z;
      const along = dx * this.dir.x + dz * this.dir.y;         // 船在陣風下風多遠
      const across = Math.abs(dx * this.dir.y - dz * this.dir.x);
      if (along > -g.radius && along < 60 && across < g.radius * 1.1) {
        if (!best || along < best.along) best = { along, strength: g.peak };
      }
    }
    return best;
  }
}
