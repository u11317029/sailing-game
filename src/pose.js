// pose.js — MediaPipe Pose 體感偵測 + 鍵盤備用操作
//
// 輸出統一的 input 物件：
//   steer   -1 ~ 1  轉向（肩線傾斜；正 = 右轉）
//   trim     0 ~ 1  帆（雙手距離；0 = 收緊、1 = 放鬆）
//   hike    -1 ~ 1  壓舷（整個上半身往側邊倒；正 = 往右倒）
//   jacket  bool    雙手放胸前 = 穿救生衣
//   raise   bool    單手舉過頭 = 求救
//   visible bool    鏡頭裡看得到玩家

// ================= 可調整參數 =================
export const POSE = {
  steerDead: 0.07,       // 肩線傾斜死區（弧度）
  steerRange: 0.28,      // 傾斜多少弧度時轉到底
  leanDecouple: 1.0,     // 轉向時扣掉多少「整個身體的側傾」（1 = 完全分開兩個動作）
  hikeDead: 0.08,        // 上半身側傾死區（弧度）
  hikeRange: 0.28,       // 側傾多少弧度時壓舷到底
  smoothing: 0.35,       // 平滑程度（0 = 不平滑，越大越穩但越慢）
};

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const input = { steer: 0, trim: 0.5, hike: 0, gesture: false, jacket: false, raise: false, visible: false };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dz = (v, dead, range) => Math.abs(v) < dead ? 0 : clamp((v - Math.sign(v) * dead) / range, -1, 1);

let landmarker = null, lastVideoTime = -1, video = null, sk = null, sctx = null;
export let useCam = false;

/** 開啟鏡頭並載入 MediaPipe 模型 */
export async function initPose(videoEl, skeletonCanvas) {
  video = videoEl; sk = skeletonCanvas; sctx = sk.getContext('2d');
  const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(WASM);
  landmarker = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO', numPoses: 1,
  });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await new Promise(r => video.onloadeddata = r);
  video.classList.add('on');
  useCam = true;
}

export function useKeyboard() { useCam = false; }

/** 每幀呼叫：更新 input */
export function readInput() {
  if (useCam) readPose(); else readKeys();
  return input;
}

function ema(key, value) {
  const a = POSE.smoothing;
  input[key] = input[key] * a + value * (1 - a);
}

function readPose() {
  if (!landmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  const lm = res.landmarks?.[0];
  sk.width = 214; sk.height = Math.round(214 * video.videoHeight / video.videoWidth);
  sctx.clearRect(0, 0, sk.width, sk.height);
  if (!lm) { input.visible = false; return; }
  input.visible = true;

  // 鏡像：玩家的右邊 = 畫面右邊；x 乘上長寬比，角度才不會變形
  const aspect = video.videoWidth / video.videoHeight;
  const P = i => ({ x: (1 - lm[i].x) * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
  const nose = P(0), lS = P(11), rS = P(12), lW = P(15), rW = P(16), lH = P(23), rH = P(24);
  const A = lS.x < rS.x ? lS : rS, B = lS.x < rS.x ? rS : lS; // A 在畫面左
  const shoulderW = Math.hypot(B.x - A.x, B.y - A.y) || 0.2;
  const midX = (A.x + B.x) / 2, shY = (A.y + B.y) / 2;
  const hipsOk = lH.v > 0.5 && rH.v > 0.5;
  const hipX = (lH.x + rH.x) / 2, hipY = (lH.y + rH.y) / 2;

  // 壓舷（新動作）：整個上半身往側邊倒 = 臀部中點 → 肩膀中點 的傾斜角
  const lean = hipsOk ? Math.atan2(midX - hipX, hipY - shY) : 0;
  ema('hike', dz(lean, POSE.hikeDead, POSE.hikeRange));

  // 轉向：肩線傾斜角度（扣掉整個身體的側傾，只歪肩膀才算轉向）
  const tilt = Math.atan2(B.y - A.y, B.x - A.x) - lean * POSE.leanDecouple;
  ema('steer', dz(tilt, POSE.steerDead, POSE.steerRange));

  // 收放帆：雙手距離 / 肩寬
  const ratio = Math.hypot(lW.x - rW.x, lW.y - rW.y) / shoulderW;
  ema('trim', clamp((ratio - 0.8) / 2.4, 0, 1));

  // 穿救生衣：雙手都在肩膀和臀部之間、身體中線附近
  const bottom = hipsOk ? hipY : shY + shoulderW * 1.6;
  const onChest = w => Math.abs(w.x - midX) < shoulderW * 0.6 && w.y > shY && w.y < bottom;
  input.jacket = onChest(lW) && onChest(rW);

  // 舉手求救：任一手腕高過頭
  input.raise = lW.y < nose.y - 0.05 || rW.y < nose.y - 0.05;
  input.gesture = input.jacket || input.raise;

  // 小視窗骨架
  const sx = p => p.x / aspect * sk.width, sy = p => p.y * sk.height;
  const line = (a, b, color) => {
    sctx.strokeStyle = color; sctx.beginPath(); sctx.moveTo(sx(a), sy(a)); sctx.lineTo(sx(b), sy(b)); sctx.stroke();
  };
  sctx.lineWidth = 3; sctx.lineCap = 'round';
  const yellow = '#f2c230';
  [[lS, P(13)], [P(13), lW], [rS, P(14)], [P(14), rW]].forEach(([a, b]) => line(a, b, yellow));
  line(lS, rS, Math.abs(input.steer) > 0.05 ? '#ffffff' : yellow);
  if (hipsOk) {
    [[lS, lH], [rS, rH], [lH, rH]].forEach(([a, b]) => line(a, b, yellow));
    // 軀幹中線：壓舷時變紅
    line({ x: hipX, y: hipY }, { x: midX, y: shY }, Math.abs(input.hike) > 0.1 ? '#d6322b' : 'rgba(242,194,48,.5)');
  }
  sctx.fillStyle = '#e8f4f2';
  sctx.beginPath(); sctx.arc(sx(nose), sy(nose), 5, 0, 7); sctx.fill();
}

// ---------- 鍵盤 ----------
const keys = {};
addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase()) && e.target === document.body) e.preventDefault();
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readKeys() {
  input.visible = true;
  input.steer = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0);
  if (keys.arrowup) input.trim = Math.max(0, input.trim - 0.012);
  if (keys.arrowdown) input.trim = Math.min(1, input.trim + 0.012);
  const h = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  input.hike += (h - input.hike) * 0.15;
  input.jacket = input.raise = input.gesture = !!keys[' '];
}
