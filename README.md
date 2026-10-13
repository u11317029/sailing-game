# 揚帆出航｜體感帆船 3D

用鏡頭偵測身體動作來駕駛一艘單人小帆船的 3D 遊戲。遊戲流程：

**穿救生衣 → 依序繞過三個浮標 → 翻船後留在船邊舉手求救 → 結算安全知識**

技術：Vite + Three.js + MediaPipe Pose（`@mediapipe/tasks-vision`）。原本的 2D 版本保留在 `legacy/index-2d.html`。

---

## 安裝與執行

需要 Node.js 18 以上（建議 20 或 22 LTS）。

```bash
npm install
```

```bash
npm run dev
```

開啟終端機顯示的網址（預設 http://localhost:5173）。
鏡頭只能在 `localhost` 或 HTTPS 底下使用，**不要直接雙擊 `index.html`**。

其他指令：

```bash
npm run build      # 打包到 dist/
```

```bash
npm run preview    # 預覽打包後的版本
```

```bash
node tools/physics-test.mjs   # 不開畫面，直接測試航行物理（船速、側傾、翻船）
```

> 第一次開啟鏡頭時，瀏覽器會從網路下載 MediaPipe 的 WASM 與姿勢模型（約 5 MB），需要連網。

---

## 操作方式

站在鏡頭前約 2 公尺，讓**上半身與臀部**完整入鏡。右下角小視窗會顯示鏡頭畫面與偵測到的骨架，下方文字會即時顯示目前偵測到的動作。

| 動作 | 體感 | 鍵盤 |
|---|---|---|
| 轉向 | 肩膀往左／右歪（一邊肩膀高、一邊低） | ← → |
| 收帆／放帆 | 雙手靠攏在胸前 = 收緊；雙手往兩側張開 = 放鬆 | ↑ 收、↓ 放 |
| 壓舷（新） | 整個上半身從腰部往側邊倒，方向要跟船傾斜的方向**相反** | A 往左、D 往右 |
| 穿救生衣 | 雙手放在胸前停住 1.5 秒 | 按住空白鍵 |
| 舉手求救 | 單手高舉過頭停住 2 秒 | 按住空白鍵 |

**轉向與壓舷怎麼分開？** 程式計算兩個角度：
- 「臀部中點 → 肩膀中點」的傾斜 = 整個身體的側傾 → **壓舷**
- 「肩線傾斜」扣掉「身體側傾」 = 只有肩膀在歪 → **轉向**

所以整個人從腰部往旁邊倒，只會壓舷不會轉向；只歪肩膀、身體中線不動，則只會轉向。
如果覺得兩個動作互相干擾，可以調整 `src/pose.js` 裡的 `POSE.leanDecouple`（設成 0 就是舊版「身體一傾就轉向」的行為）。

### 航行小知識（遊戲裡也會提示）
- 風從前方（北）吹來，船頭與風的夾角小於約 43 度就是**逆風禁區**，帆吃不到風，要走 Z 字形。
- 帆要配合風向：越接近逆風越要收緊，越順風越要放鬆。帆太鬆會飄（luffing），太緊會跑不動又容易傾斜。
- 海面上**顏色較深、水紋較碎**的區域是陣風，進去前先準備壓舷或放鬆帆。
- 側傾超過翻船角度就會翻船：留在船邊舉手求救，救生艇會幫你把船扶正，繼續比賽。
- 繞完第三個浮標後，一定會來一陣強風把船吹翻，這是最後的求救練習。

### 畫面
- 左上 HUD：時間、浮標、船速（節）、帆的狀態、側傾角度（紅線是翻船角度）
- 右上：風向儀（以畫面方向為準，黃色箭頭是風吹來的方向，中間是你的船）
- 下一個目標浮標：黃色光柱、跳動的箭頭、水面上一圈浮球（進入圈內就算繞過）；不在畫面內時邊緣會有箭頭指示方向與距離
- 左下：畫質切換（高／低）與 FPS

---

## 檔案結構

```
index.html          頁面骨架（HUD、提示框、卡片）
src/style.css       介面樣式
src/main.js         進入點：渲染器、追蹤攝影機、主迴圈、畫質切換
src/ocean.js        Gerstner 海面 shader、天空、getWaveHeight / getWaveNormal
src/boat.js         帆船模型、浮力、航行物理、側傾與翻船、尾跡
src/wind.js         主風向、風向擺動、陣風、最後的強陣風
src/pose.js         MediaPipe 姿勢偵測 + 鍵盤，輸出 input 物件
src/game.js         遊戲流程、浮標、航道設定
src/ui.js           HUD、風向儀、提示框、開始與結算卡片
tools/physics-test.mjs  航行物理的無畫面測試
legacy/index-2d.html    原本的 2D 版本
```

`pose.js` 輸出的 `input` 物件：

```js
{ steer, trim, hike, jacket, raise, visible }   // 另保留舊版的 gesture
```

---

## 可調整的參數

所有參數都集中在各檔案開頭的常數物件，改完存檔，`npm run dev` 會自動重新載入。

### 海浪與畫面 — `src/ocean.js`

| 參數 | 位置 | 說明 |
|---|---|---|
| 整體波高 | `OCEAN.waveScale` | 1 = 預設（約 ±0.8 公尺的小浪），2 = 浪高加倍 |
| 浪的尖銳度 | `OCEAN.steepness` | 越大浪峰越尖、白沫越多；太大浪會「打結」 |
| 每一組波 | `WAVE_SET` | 每組的方向 `dir`、波長 `length`、振幅 `amp`、陡度 `steep` |
| 白沫多寡 | `OCEAN.foamThreshold` | 越大白沫越多 |
| 水色 | `OCEAN.deepColor`、`OCEAN.shallowColor` | 深水與浪峰透光顏色（線性色彩空間） |
| 霧氣 | `OCEAN.fogDensity` | 越大地平線越近 |
| 太陽位置 | `OCEAN.sunElevation`、`OCEAN.sunAzimuth` | 仰角與方位（度） |
| 畫質 | `QUALITY.high` / `QUALITY.low` | 波浪組數 `waves`、網格細分 `radialSegs`、近處網格間距 `innerStep`、遠處淡出距離 `fadeK` |

`getWaveHeight(x, z, time)` 與 `getWaveNormal(x, z, time)` 使用和 shader 完全相同的波浪參數與公式（包含遠處淡出），
因為 Gerstner 浪會水平擠壓水面，JS 端會先反推「哪個網格點被推到 (x, z)」，再取得高度，誤差小於 1 公釐。
海面上細小的漣漪與陣風水紋只影響光影，不影響浮力。

### 風 — `src/wind.js`

| 參數 | 位置 | 說明 |
|---|---|---|
| 風速 | `WIND.baseSpeed` | m/s，預設 6（約 12 節） |
| 主風向 | `WIND.baseFrom` | 風從哪裡吹來（度，0 = 北 = 畫面一開始的前方） |
| 風向擺動 | `WIND.shiftAmp`、`WIND.shiftPeriod` | 擺動幅度（度）與週期（秒） |
| 陣風頻率 | `WIND.gustInterval` | 幾秒出現一次，`[最短, 最長]` |
| 陣風強度 | `WIND.gustStrength` | 風速增加的比例，0.45 = 風速 ×1.45 |
| 陣風大小 | `WIND.gustRadius` | 陣風區半徑（公尺） |
| 最後的強陣風 | `WIND.squallStrength`、`WIND.squallRadius` | 繞完浮標後那陣強風 |

### 船與航行物理 — `src/boat.js`

| 參數 | 位置 | 說明 |
|---|---|---|
| **翻船角度** | `BOAT.capsizeAngle` | 預設 60 度 |
| 逆風禁區 | `BOAT.noGoAngle` | 預設 43 度 |
| 最高船速 | `BOAT.speedRatio` | 最佳狀態下船速 / 風速 |
| 慣性 | `BOAT.accel`、`BOAT.decel` | 越小越慢達到目標速度 |
| 舵與轉向 | `BOAT.maxRudder`、`BOAT.rudderSpeed`、`BOAT.turnGain`、`BOAT.turnRefSpeed`、`BOAT.minSteer`、`BOAT.yawResponse` | 舵角、轉舵延遲、舵效、低速舵效 |
| 側傾力 | `BOAT.heelPower`、`BOAT.windRef` | 帆產生的側傾力，與 (風速 / windRef)² 成正比 |
| 扶正力 | `BOAT.hullRighting`、`BOAT.crewBase` | 船身與水手自動坐上風舷的扶正力 |
| 壓舷效果 | `BOAT.hikeMoment` | 玩家壓舷的扶正力，越大越不容易翻 |
| 側傾反應 | `BOAT.heelInertia`、`BOAT.heelDamping` | 慣性與阻尼 |
| 浮力 | `BOAT.draft`、`BOAT.buoyDamping`、檔案內的 `SAMPLES` | 吃水深度、起伏阻尼、7 個浮力取樣點 |

目前的平衡（可用 `node tools/physics-test.mjs` 驗證）：
平常風力下帆角正確時側傾約 10～20 度；帆收太緊約 30 度；遇到 ×1.4 陣風時帆正確約 50 度（危險），
帆太緊會翻船，但只要同時壓舷就能撐住（約 47 度）。

### 航道與流程 — `src/game.js`

| 參數 | 位置 | 說明 |
|---|---|---|
| 起點 | `COURSE.start` | 位置與船頭方向 |
| 浮標位置 | `COURSE.buoys` | 三個浮標的 (x, z)，-z 是北（上風） |
| 繞標範圍 | `COURSE.roundRadius` | 進入幾公尺內算繞過 |
| 停住秒數 | `COURSE.jacketHold`、`COURSE.sosHold` | 穿救生衣、舉手求救要維持幾秒 |
| 強風多久翻船 | `COURSE.squallForceAfter` | 強陣風撲到船上後幾秒內一定翻船 |

### 體感靈敏度 — `src/pose.js`

| 參數 | 說明 |
|---|---|
| `POSE.steerDead`、`POSE.steerRange` | 轉向的死區與「轉到底」需要的肩膀傾斜角（弧度） |
| `POSE.hikeDead`、`POSE.hikeRange` | 壓舷的死區與「壓到底」需要的身體傾斜角（弧度） |
| `POSE.leanDecouple` | 轉向時扣掉多少身體側傾（1 = 轉向與壓舷完全分開） |
| `POSE.smoothing` | 動作平滑程度，越大越穩但反應越慢 |

### 其他 — `src/main.js`

- `renderer.toneMappingExposure`：整體亮度
- `PIXEL_RATIO`：高／低畫質的解析度倍率
- 追蹤攝影機的距離與高度在 `updateCamera()` 裡（`dist`、`height`）

---

## 效能

- 海面是以攝影機為中心的極座標網格：近處最密（高畫質約 0.45 公尺一格）、越遠越疏，最遠到 9 公里，遠方波浪會依網格密度自動淡出，避免閃爍。
- 高畫質：6 組波、約 7.6 萬個頂點、解析度最多 1.75 倍。
- 低畫質：4 組波、約 1.9 萬個頂點、解析度 0.8 倍、關閉反鋸齒（重新整理後生效）。
- 畫質設定會記在瀏覽器裡，下次開啟沿用。如果 FPS 低於 30，請按左下角切到「低」。
- 物理每幀只需約 0.2 毫秒；姿勢偵測只在鏡頭有新畫面時執行。

## 除錯

開發時可在瀏覽器主控台使用：

```js
__tick(5)          // 快轉模擬 5 秒
__boat, __wind, __game, __input   // 直接查看或修改狀態
```
