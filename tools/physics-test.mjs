// 無畫面的航行物理測試：node tools/physics-test.mjs
import { Boat, BOAT } from '../src/boat.js';
const DEG = Math.PI / 180;
const b = Object.create(Boat.prototype);
b.wake = { clear() {} };
b.reset(0, 0, 0);
const dt = 1 / 60;
function run(label, { heading, trim, hike = 0, wind = 6, secs = 8, steer = 0 }) {
  b.speed = 0;
  b.capsized = false; b.heel = 0; b.heelRate = 0;
  const input = { steer, trim, hike };
  for (let i = 0; i < secs * 60; i++) {
    if (heading != null) b.heading = heading * DEG;
    b.sail(dt, input, { from: 0, speed: wind });
  }
  console.log(label.padEnd(28), `速度 ${(b.speed * 1.944).toFixed(1)} 節`.padEnd(12),
    `側傾 ${(b.heel / DEG).toFixed(1)}°`.padEnd(12), `效率 ${b.efficiency.toFixed(2)}`, b.capsized ? '→ 翻船' : '');
}
run('逆風禁區 20°', { heading: 20, trim: 0.1 });
run('近迎風 50° 收緊', { heading: 50, trim: 0.05 });
run('橫風 90° 適中', { heading: 90, trim: 0.34 });
run('橫風 90° 過緊', { heading: 90, trim: 0 });
run('側順風 135° 放鬆', { heading: 135, trim: 0.68 });
run('正順風 175° 全放', { heading: 175, trim: 1 });
run('陣風 ×1.4 橫風 適中', { heading: 90, trim: 0.34, wind: 8.4 });
run('陣風 ×1.4 橫風 過緊', { heading: 90, trim: 0.0, wind: 8.4 });
run('陣風 ×1.4 過緊 + 壓舷', { heading: 90, trim: 0.0, wind: 8.4, hike: -1 });
run('陣風 ×1.45 近迎風 壓舷', { heading: 50, trim: 0.05, wind: 8.7, hike: -1 });
run('強陣風 ×3.4（最後）', { heading: 90, trim: 0.34, wind: 20.4, hike: -1 });
// 轉向延遲：從 0 速開始與全速時的轉向率
b.reset(0, 0, 90 * DEG); b.speed = 0.2;
for (let i = 0; i < 60; i++) b.sail(dt, { steer: 1, trim: 0.34, hike: 0 }, { from: 0, speed: 0.01 });
console.log('低速滿舵 1 秒轉了', ((b.heading / DEG) - 90).toFixed(1), '度');
b.reset(0, 0, 90 * DEG); b.speed = 3;
for (let i = 0; i < 60; i++) { b.sail(dt, { steer: 1, trim: 0.34, hike: 0 }, { from: 0, speed: 6 }); }
console.log('高速滿舵 1 秒轉了', ((b.heading / DEG) - 90).toFixed(1), '度');
