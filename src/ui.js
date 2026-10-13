// ui.js — HUD、風向指示、目標浮標方向、提示框、卡片
const $ = id => document.getElementById(id);
const DEG = 180 / Math.PI;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

let promptKey = '';

export const ui = {
  // ---------- 提示框 ----------
  showPrompt(text, sub = '', progress = null) {
    $('prompt').classList.remove('hidden');
    if (promptKey !== text + sub) {
      $('ptext').textContent = text;
      $('psub').textContent = sub;
      promptKey = text + sub;
    }
    $('pbar').parentElement.style.display = progress == null ? 'none' : 'block';
    if (progress != null) $('pbar').style.width = Math.min(100, progress * 100) + '%';
  },
  hidePrompt() { $('prompt').classList.add('hidden'); promptKey = ''; },
  promptText() { return $('prompt').classList.contains('hidden') ? '' : $('ptext').textContent; },

  // ---------- 卡片 ----------
  showCard(html) { $('card').innerHTML = html; $('panel').classList.remove('hidden'); },
  hideCard() { $('panel').classList.add('hidden'); },

  showMenu({ quality, onCam, onKey, onQuality }) {
    this.showCard(`
      <h1>揚帆出航</h1>
      <p>站在鏡頭前約 2 公尺，讓上半身（含臀部）完整入鏡。你的身體就是舵、帆繩和壓舷的重量。</p>
      <ul>
        <li><b>轉向</b>：肩膀往左或往右歪（一邊肩膀高、一邊低）</li>
        <li><b>收放帆</b>：雙手靠攏在胸前 = 收帆；雙手往兩側張開 = 放帆</li>
        <li><b>壓舷</b>：船往一邊倒時，整個上半身從腰部往<b>另一邊</b>倒，把船壓平</li>
        <li>風從前方吹來，船不能正對著風開（約 45 度內是禁區），要斜斜地走 Z 字形</li>
        <li>海面上顏色較深、水紋較碎的區域是<b>陣風</b>，進去前先準備壓舷或放鬆帆</li>
      </ul>
      <p>沒有鏡頭也能用鍵盤試玩：← → 轉向，↑ ↓ 收放帆，A / D 往左／右壓舷，空白鍵做動作。</p>
      <div class="quality">畫質：
        <label><input type="radio" name="q" value="high" ${quality === 'high' ? 'checked' : ''}> 高</label>
        <label><input type="radio" name="q" value="low" ${quality === 'low' ? 'checked' : ''}> 低（較舊的筆電）</label>
      </div>
      <button id="startCam">開啟鏡頭開始</button>
      <button id="startKey" class="alt">用鍵盤試玩</button>`);
    document.querySelectorAll('input[name=q]').forEach(r => r.onchange = () => onQuality(r.value));
    $('startCam').onclick = () => { $('startCam').textContent = '載入姿勢偵測中…'; $('startCam').disabled = true; onCam(); };
    $('startKey').onclick = onKey;
  },

  showCamError(err, { onRetry, onKey }) {
    this.showCard(`<h1>鏡頭沒有開啟</h1>
      <p>請確認瀏覽器已允許使用攝影機，並用 <b>npm run dev</b> 開啟的網址（http://localhost）進入，而不是直接雙擊 HTML 檔案。</p>
      <p>錯誤訊息：${String(err?.message || err).replace(/</g, '&lt;')}</p>
      <button id="retry">重新整理</button><button id="kb" class="alt">改用鍵盤試玩</button>`);
    $('retry').onclick = onRetry;
    $('kb').onclick = onKey;
  },

  showFinish({ elapsed, capsizes, onAgain }) {
    this.showCard(`
      <h1>安全返航</h1>
      <table>
        <tr><td>完成時間</td><td><b>${elapsed.toFixed(1)} 秒</b></td></tr>
        <tr><td>途中翻船</td><td><b>${capsizes} 次</b>（不含最後那陣強風）</td></tr>
      </table>
      <p>今天記住的安全知識：</p>
      <ul>
        <li>出海一定穿好救生衣，這是第一步</li>
        <li>翻船時留在船邊，船比人顯眼，也能幫助漂浮</li>
        <li>舉手揮動求救，保留體力，不要嘗試游回岸邊</li>
        <li>看到深色、起碎浪的水面就是陣風：先放鬆帆、身體往外壓，船就不容易翻</li>
        <li>出航前查好天氣與風力，風太大就不要出海</li>
      </ul>
      <button id="again">再航一次</button>`);
    $('again').onclick = onAgain;
  },

  // ---------- HUD ----------
  setHudVisible(v) {
    $('hud').classList.toggle('hidden', !v);
    $('wind').classList.toggle('hidden', !v);
  },

  updateHud({ elapsed, buoys, total, speed, boat, capsizeAngle }) {
    $('t').textContent = elapsed.toFixed(1);
    $('b').textContent = `${buoys}/${total}`;
    $('v').textContent = (speed * 1.944).toFixed(1);
    let label = boat.trim < 0.33 ? '收緊' : boat.trim < 0.66 ? '適中' : '放鬆';
    if (boat.inIrons) label += '・吃不到風';
    else if (boat.luff > 0.3) label += '・飄帆';
    else if (boat.overSheet > 0.2) label += '・太緊';
    $('trim').textContent = label;
    const heel = Math.abs(boat.heel) * DEG, cap = capsizeAngle * DEG;
    $('heel').textContent = `${Math.round(heel)}°`;
    $('heelbar').style.width = Math.min(100, heel / 90 * 100) + '%';
    $('heelbar').style.background = heel > cap * 0.7 ? 'var(--flag-red)' : 'var(--flag-yellow)';
    $('heelmark').style.left = (cap / 90 * 100) + '%';
    $('heelChip').classList.toggle('warn', heel > cap * 0.7);
  },

  /** 風向儀：以攝影機朝向為「上」 */
  updateWind({ windFrom, cameraYaw, boatHeading, speed, gust }) {
    const rel = wrap(windFrom - cameraYaw) * DEG;
    $('windArrow').style.transform = `rotate(${rel}deg)`;
    document.querySelector('.dial .boatmark').style.transform = `rotate(${wrap(boatHeading - cameraYaw) * DEG}deg)`;
    $('windSpeed').textContent = (speed * 1.944).toFixed(0);
    $('gustLabel').textContent = gust > 0.12 ? '陣風中！' : '';
  },

  /** 目標浮標：在畫面內就標在浮標上方，在畫面外就貼著邊緣指方向 */
  updateTarget(info) {
    const el = $('targetArrow');
    if (!info) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.style.left = info.x + 'px';
    el.style.top = info.y + 'px';
    el.querySelector('span').style.transform = `rotate(${info.angle}deg)`;
    $('targetDist').textContent = `${info.label} ${Math.round(info.dist)} 公尺`;
  },

  setQualityLabel(q) { $('qualityBtn').textContent = `畫質：${q === 'high' ? '高' : '低'}`; },
  setFps(fps) { $('fps').textContent = `${fps.toFixed(0)} FPS`; },

  setPoseHint(text) {
    const el = $('poseHint');
    el.classList.toggle('on', !!text);
    el.textContent = text || '';
  },
};
