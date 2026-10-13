// game.js — 遊戲流程：穿救生衣 → 繞三個浮標 → 翻船求救 → 結算安全知識
import * as THREE from 'three';
import { getWaveHeight, getWaveNormal } from './ocean.js';
import { BOAT } from './boat.js';
import { ui } from './ui.js';

const DEG = Math.PI / 180;

// ================= 可調整參數 =================
export const COURSE = {
  start: { x: -55, z: 65, heading: 75 },   // 起點與船頭方向（度，0 = 北）
  buoys: [                                  // 三個浮標（公尺；-z = 北 = 上風）
    { x: -34, z: -45 },
    { x: 42, z: -34 },
    { x: 12, z: 46 },
  ],
  roundRadius: 12,        // 船進入浮標多少公尺內算繞過
  boundary: 260,          // 離航道中心太遠會提醒
  jacketHold: 1.5,        // 穿救生衣要停住幾秒
  sosHold: 2.0,           // 舉手求救要停住幾秒
  squallForceAfter: 3.0,  // 強陣風到達後幾秒內一定翻船
};

// ================= 浮標 =================
function numberTexture(text, color = '#062027', bg = '#f2c230') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#062027'; g.stroke();
  g.fillStyle = color; g.font = '900 72px "Noto Sans TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Buoy {
  constructor(scene, index, x, z) {
    this.index = index; this.x = x; this.z = z; this.done = false;
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.45, emissive: 0x3a2a00 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.5, 20), this.bodyMat);
    body.position.y = 0.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0xd6322b, roughness: 0.5 }));
    band.position.y = 0.45;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 20), this.bodyMat);
    top.position.y = 1.4;
    this.float = new THREE.Group();
    this.float.add(body, band, top);
    this.group.add(this.float);

    this.labelTex = numberTexture(String(index + 1));
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, depthTest: false, transparent: true }));
    this.label.scale.setScalar(1.6);
    this.label.position.y = 3.2;
    this.label.renderOrder = 5;
    this.group.add(this.label);

    // 下一個目標：光柱 + 跳動箭頭 + 水面圈
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.6, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.2).multiplyScalar(2.5), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 30;
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0xf2c230, emissive: 0xf2a000, emissiveIntensity: 1.5 }));
    this.arrow.rotation.x = Math.PI;
    this.group.add(this.beam, this.arrow);

    const N = 40;
    this.ring = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2c230, emissive: 0x806000 }), N);
    this.ring.frustumCulled = false;
    this.ringN = N;
    scene.add(this.group, this.ring);
    this.normal = new THREE.Vector3(0, 1, 0);
  }

  setDone(done) {
    this.done = done;
    this.bodyMat.color.set(done ? 0x9aa5a8 : 0xf2c230);
    this.bodyMat.emissive.set(done ? 0x000000 : 0x3a2a00);
    this.label.material.map = done ? (this.doneTex ||= numberTexture('✓', '#ffffff', '#2e8b57')) : this.labelTex;
  }

  update(dt, t, isNext) {
    const y = getWaveHeight(this.x, this.z, t);
    this.group.position.set(this.x, y - 0.35, this.z);
    // 隨浪傾斜（平滑，避免抖動）
    const n = getWaveNormal(this.x, this.z, t, _n);
    this.normal.lerp(n, Math.min(1, dt * 4)).normalize();
    this.float.quaternion.setFromUnitVectors(_up, this.normal);

    this.beam.visible = this.arrow.visible = this.ring.visible = isNext;
    if (isNext) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      this.beam.material.opacity = 0.12 + 0.1 * pulse;
      this.arrow.position.y = 5 + pulse * 0.8;
      this.arrow.rotation.y = t * 1.5;
      this.label.scale.setScalar(1.6 + pulse * 0.4);
      // 繞標範圍：一圈浮球
      for (let i = 0; i < this.ringN; i++) {
        const a = (i / this.ringN) * Math.PI * 2;
        const rx = this.x + Math.cos(a) * COURSE.roundRadius, rz = this.z + Math.sin(a) * COURSE.roundRadius;
        _m.makeTranslation(rx, getWaveHeight(rx, rz, t) + 0.05, rz);
        this.ring.setMatrixAt(i, _m);
      }
      this.ring.instanceMatrix.needsUpdate = true;
    } else {
      this.label.scale.setScalar(1.6);
    }
  }
}
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();

// ================= 遊戲 =================
export class Game {
  constructor({ scene, boat, wind }) {
    this.boat = boat;
    this.wind = wind;
    this.buoys = COURSE.buoys.map((b, i) => new Buoy(scene, i, b.x, b.z));
    this.phase = 'menu';
    this.useCam = false;
    this.elapsed = 0;
    this.capsizes = 0;
    this.reset();
  }

  reset() {
    const s = COURSE.start;
    this.boat.reset(s.x, s.z, s.heading * DEG);
    this.buoys.forEach(b => b.setDone(false));
    this.nextBuoy = 0;
    this.elapsed = 0;
    this.capsizes = 0;
    this.holdTime = 0;
    this.messageT = 0;
    this.finalCapsize = false;
    this.squallT = 0;
    this.wind.reset();
  }

  start(useCam) {
    this.useCam = useCam;
    this.reset();
    this.phase = 'jacket';
    ui.hideCard();
    ui.setHudVisible(true);
  }

  /** 暫時的訊息（幾秒後自動消失） */
  flash(text, sub, secs = 2.5) {
    this.message = { text, sub };
    this.messageT = secs;
  }

  update(dt, t, input) {
    const boat = this.boat;
    boat.raise = input.raise;
    if (this.messageT > 0) this.messageT -= dt;

    const windHere = this.wind.sample(boat.pos.x, boat.pos.z);
    this.windHere = windHere;

    switch (this.phase) {
      case 'menu':
        boat.luff = 1;
        break;

      case 'jacket': {
        boat.luff = 1;
        this.holdTime = input.jacket ? this.holdTime + dt : Math.max(0, this.holdTime - dt * 2);
        ui.showPrompt('出航前：先穿上救生衣',
          this.useCam ? '雙手放在胸前，像拉上拉鍊一樣停住' : '按住空白鍵', this.holdTime / COURSE.jacketHold);
        if (this.holdTime >= COURSE.jacketHold) {
          this.holdTime = 0;
          boat.jacketOn = true;
          this.phase = 'sail';
          this.flash('救生衣穿好了，出發！', '依序繞過三個黃色浮標（跟著光柱走）', 3);
        }
        break;
      }

      case 'sail':
      case 'squall': {
        this.elapsed += dt;
        boat.sail(dt, input, windHere);
        if (boat.capsized) { this.onCapsize(); break; }

        // 繞浮標
        const bu = this.buoys[this.nextBuoy];
        if (bu && Math.hypot(boat.pos.x - bu.x, boat.pos.z - bu.z) < COURSE.roundRadius) {
          bu.setDone(true);
          this.nextBuoy++;
          if (this.nextBuoy === this.buoys.length) {
            this.phase = 'squall';
            this.squallT = 0;
            this.wind.triggerSquall(boat.pos);
            this.flash('三個浮標都繞完了！', '小心…上風處的海面變暗了', 2.5);
          } else {
            this.flash(`第 ${this.nextBuoy} 個浮標完成！`, `繼續前往第 ${this.nextBuoy + 1} 個浮標`, 2.5);
          }
        }

        // 最後的強陣風：撲到船上後一定會翻
        if (this.phase === 'squall') {
          const sq = this.wind.squall;
          if (sq && Math.hypot(boat.pos.x - sq.x, boat.pos.z - sq.z) < sq.radius * 0.6) this.squallT += dt;
          if (this.squallT > COURSE.squallForceAfter || (sq && sq.age > 12)) boat.capsize(-boat.windSide);
          if (boat.capsized) { this.onCapsize(); break; }
        }
        this.sailPrompts(input);
        break;
      }

      case 'capsize': {
        if (boat.righting > 0) {
          ui.showPrompt('救生艇把船扶正了', '準備繼續航行…', null);
          break;
        }
        const ready = boat.capsizeT > 1.2;
        this.holdTime = ready && input.raise ? this.holdTime + dt : Math.max(0, this.holdTime - dt * 2);
        ui.showPrompt(this.finalCapsize ? '一陣強風，船翻了！留在船邊，舉手求救' : '船翻了！留在船邊，舉手求救',
          this.useCam ? '單手高舉過頭停住，不要游離翻覆的船' : '按住空白鍵', this.holdTime / COURSE.sosHold);
        if (this.holdTime >= COURSE.sosHold) {
          this.holdTime = 0;
          if (this.finalCapsize) {
            this.phase = 'done';
            ui.hidePrompt();
            ui.setHudVisible(false);
            ui.showFinish({ elapsed: this.elapsed, capsizes: this.capsizes, onAgain: () => this.start(this.useCam) });
          } else {
            boat.rightBoat();
            this.afterRescue = true;
          }
        }
        break;
      }
    }

    // 扶正完成 → 回到航行
    if (this.phase === 'capsize' && this.afterRescue && !boat.capsized) {
      this.afterRescue = false;
      this.phase = 'sail';
      this.flash('船扶正了，繼續航行！', '陣風來時記得放鬆帆、身體往外壓', 3);
    }

    if (this.useCam && !input.visible && this.phase !== 'menu' && this.phase !== 'done')
      ui.showPrompt('看不到你了', '退後一點，讓肩膀、雙手和臀部都在鏡頭裡', null);

    for (let i = 0; i < this.buoys.length; i++)
      this.buoys[i].update(dt, t, (this.phase === 'sail' || this.phase === 'jacket') && i === this.nextBuoy);
  }

  onCapsize() {
    this.phase = 'capsize';
    this.holdTime = 0;
    this.finalCapsize = this.nextBuoy >= this.buoys.length;
    if (!this.finalCapsize) this.capsizes++;
    this.wind.clearSquall();
  }

  /** 航行中的提示（依重要程度） */
  sailPrompts(input) {
    const boat = this.boat;
    const heel = boat.heel / DEG, cap = BOAT.capsizeAngle / DEG;
    // 往哪邊壓：船往右倒（heel > 0）→ 身體往左
    const hikeDir = boat.heel > 0 ? '左' : '右';
    const hikeKey = boat.heel > 0 ? 'A' : 'D';
    const incoming = this.wind.incoming(boat.pos);
    const far = Math.hypot(boat.pos.x, boat.pos.z) > COURSE.boundary;

    if (Math.abs(heel) > cap * 0.65) {
      ui.showPrompt(`船快翻了！身體往${hikeDir}倒壓舷`,
        this.useCam ? `整個上半身往${hikeDir}邊倒，或雙手張開放鬆帆` : `按住 ${hikeKey} 壓舷，或按 ↓ 放鬆帆`, null);
    } else if (this.phase === 'squall') {
      ui.showPrompt('注意！強陣風來了！', '深色的水面正朝你撲過來', null);
    } else if (this.messageT > 0 && this.message) {
      ui.showPrompt(this.message.text, this.message.sub, null);
    } else if (boat.inIrons && boat.speed < 0.6) {
      ui.showPrompt('船頭對著風，帆吃不到風了', '轉向斜邊，走 Z 字形前進', null);
    } else if (incoming && incoming.along > 0) {
      ui.showPrompt('陣風快到了！', this.useCam ? '準備把身體往外倒壓舷，或放鬆一點帆' : '準備按 A / D 壓舷，或按 ↓ 放鬆帆', null);
    } else if (far) {
      ui.showPrompt('離航道太遠了', '掉頭回去，跟著光柱找下一個浮標', null);
    } else if (boat.luff > 0.5 && boat.speed < 1.5) {
      ui.showPrompt('帆在飄，吃不到風', this.useCam ? '雙手靠攏一點，把帆收緊' : '按 ↑ 收帆', null);
    } else if (boat.overSheet > 0.3 && boat.speed < 1.5) {
      ui.showPrompt('帆收太緊了，船跑不動', this.useCam ? '雙手張開一點，把帆放鬆' : '按 ↓ 放帆', null);
    } else {
      ui.hidePrompt();
    }
  }

  get next() { return this.buoys[this.nextBuoy]; }
}
