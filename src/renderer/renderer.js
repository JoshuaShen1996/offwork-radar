const $ = (id) => document.getElementById(id);
const api = window.offworkRadar;

const RISK_LABEL = { good: '放心走', warning: '建议提前走', danger: '赶紧走' };
const MODE_LABEL = { driving: '驾车/打车', transit: '公交地铁', bicycling: '骑行', walking: '步行' };
const MAX_TEMPLATES = 3;

let settings = null;
let lastScan = null;
let rolloverPending = false;

const globalFields = {
  amapKey: $('amapKey'),
  amapJsKey: $('amapJsKey'),
  amapSecurityCode: $('amapSecurityCode'),
  qweatherKey: $('qweatherKey'),
  qweatherHost: $('qweatherHost'),
  aiBaseUrl: $('aiBaseUrl'),
  aiModel: $('aiModel'),
  aiKey: $('aiKey'),
  notificationsEnabled: $('notificationsEnabled')
};

const tplFields = {
  name: $('tplName'),
  companyAddress: $('companyAddress'),
  homeAddress: $('homeAddress'),
  morningDepart: $('morningDepart')
};

const ALL_MODES = ['driving', 'transit', 'bicycling', 'walking'];

function setMessage(text) {
  $('message').textContent = text || '';
}

function activeTemplate() {
  return settings.templates.find((t) => t.id === settings.activeId) || settings.templates[0];
}

/* ---------- 模板切换 ---------- */
function renderTemplates() {
  const wrap = $('templateChips');
  wrap.innerHTML = '';
  settings.templates.forEach((t) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (t.id === settings.activeId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = t.name || '未命名';
    name.title = '双击改名';
    chip.appendChild(name);
    chip.addEventListener('click', () => switchTemplate(t.id));
    chip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      renameTemplate(t.id);
    });
    if (settings.templates.length > 1) {
      const del = document.createElement('span');
      del.className = 'chip-del';
      del.textContent = '×';
      del.title = '删除模板';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTemplate(t.id);
      });
      chip.appendChild(del);
    }
    wrap.appendChild(chip);
  });
  if (settings.templates.length < MAX_TEMPLATES) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip chip-add';
    add.textContent = '+ 新建模板';
    add.addEventListener('click', createTemplate);
    wrap.appendChild(add);
  }
}

async function persist(message) {
  settings = await api.saveSettings(settings);
  renderTemplates();
  fillForm();
  if (message) setMessage(message);
  runScan();
}

async function switchTemplate(id) {
  if (id === settings.activeId) return;
  settings.activeId = id;
  await persist(`已切换到「${activeTemplate().name}」`);
}

function createTemplate() {
  if (settings.templates.length >= MAX_TEMPLATES) return;
  const tpl = {
    id: `tpl_local_${Date.now()}`,
    name: `模板 ${settings.templates.length + 1}`,
    companyAddress: '',
    homeAddress: '',
    commuteModes: ['driving'],
    offworkTimes: ['18:00']
  };
  settings.templates.push(tpl);
  settings.activeId = tpl.id;
  renderTemplates();
  fillForm();
  $('settingsForm').hidden = false;
  tplFields.name.focus();
  setMessage('新模板已创建，填好信息后保存。');
}

async function deleteTemplate(id) {
  if (settings.templates.length <= 1) return;
  settings.templates = settings.templates.filter((t) => t.id !== id);
  if (settings.activeId === id) settings.activeId = settings.templates[0].id;
  await persist('模板已删除。');
}

// 双击模板 chip → 就地改名
function renameTemplate(id) {
  const tpl = settings.templates.find((t) => t.id === id);
  if (!tpl) return;
  const wrap = $('templateChips');
  const input = document.createElement('input');
  input.className = 'chip-input';
  input.value = tpl.name || '';
  input.maxLength = 12;
  const commit = async () => {
    const name = input.value.trim();
    if (name && name !== tpl.name) {
      tpl.name = name;
      settings.activeId = id;
      await persist('模板已改名。');
    } else {
      renderTemplates();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = tpl.name || '';
      input.blur();
    }
  });
  input.addEventListener('blur', commit, { once: true });
  wrap.innerHTML = '';
  wrap.appendChild(input);
  input.focus();
  input.select();
}

/* ---------- 跑路时间（可多个） ---------- */
function addTimeRow(value = '18:00') {
  const list = $('timesList');
  const row = document.createElement('div');
  row.className = 'time-row';
  const input = document.createElement('input');
  input.type = 'time';
  input.value = value;
  row.appendChild(input);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'time-del';
  del.textContent = '×';
  del.addEventListener('click', () => {
    if (list.querySelectorAll('.time-row').length > 1) row.remove();
  });
  row.appendChild(del);
  list.appendChild(row);
}

function readTimes() {
  const times = [...$('timesList').querySelectorAll('input')]
    .map((i) => i.value)
    .filter(Boolean);
  return times.length ? times : ['18:00'];
}

/* ---------- 表单 ---------- */
function readModes() {
  const modes = [...$('modeChecks').querySelectorAll('input:checked')].map((i) => i.value);
  return modes.length ? modes : ['driving'];
}

function readForm() {
  const tpl = activeTemplate();
  tpl.name = tplFields.name.value.trim() || '未命名';
  tpl.companyAddress = tplFields.companyAddress.value.trim();
  tpl.homeAddress = tplFields.homeAddress.value.trim();
  tpl.commuteModes = readModes();
  tpl.offworkTimes = readTimes();
  tpl.morningDepart = tplFields.morningDepart.value || '08:30';

  settings.amapKey = globalFields.amapKey.value.trim();
  settings.amapJsKey = globalFields.amapJsKey.value.trim();
  settings.amapSecurityCode = globalFields.amapSecurityCode.value.trim();
  settings.qweatherKey = globalFields.qweatherKey.value.trim();
  settings.qweatherHost = globalFields.qweatherHost.value.trim();
  settings.aiBaseUrl = globalFields.aiBaseUrl.value.trim();
  settings.aiModel = globalFields.aiModel.value.trim();
  settings.aiKey = globalFields.aiKey.value.trim();
  settings.notificationsEnabled = globalFields.notificationsEnabled.checked;
}

function fillForm() {
  const tpl = activeTemplate();
  tplFields.name.value = tpl.name || '';
  tplFields.companyAddress.value = tpl.companyAddress || '';
  tplFields.homeAddress.value = tpl.homeAddress || '';

  const modes = tpl.commuteModes && tpl.commuteModes.length ? tpl.commuteModes : ['driving'];
  $('modeChecks').querySelectorAll('input').forEach((i) => {
    i.checked = modes.includes(i.value);
  });

  tplFields.morningDepart.value = tpl.morningDepart || '08:30';

  $('timesList').innerHTML = '';
  (tpl.offworkTimes && tpl.offworkTimes.length ? tpl.offworkTimes : ['18:00']).forEach(addTimeRow);

  globalFields.amapKey.value = settings.amapKey || '';
  globalFields.amapJsKey.value = settings.amapJsKey || '';
  globalFields.amapSecurityCode.value = settings.amapSecurityCode || '';
  globalFields.qweatherKey.value = settings.qweatherKey || '';
  globalFields.qweatherHost.value = settings.qweatherHost || '';
  globalFields.aiBaseUrl.value = settings.aiBaseUrl || '';
  globalFields.aiModel.value = settings.aiModel || '';
  globalFields.aiKey.value = settings.aiKey || '';
  globalFields.notificationsEnabled.checked = settings.notificationsEnabled !== false;
}

/* ---------- 渲染扫描结果 ---------- */
function minutesText(value) {
  if (!Number.isFinite(Number(value))) return '--';
  return `${value} 分`;
}

function weatherText(w) {
  if (!w || !w.weather) return '--';
  return `${w.weather} ${w.temp || '--'}°`;
}

function formatCountdown(sec) {
  if (!Number.isFinite(sec)) return '--:--:--';
  if (sec < 0) return '已过';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}

// 客户端实时算"下一个跑路点"（精确到秒）：优先今天还没到的最近一个，否则明天最早的
function nextOffworkClient(times) {
  const now = new Date();
  const valid = (times && times.length ? times : ['18:00']).filter(Boolean);
  const cands = valid.map((t) => {
    const [h, m] = t.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h || 0, m || 0, 0, 0);
    return { time: t, tod: (h || 0) * 60 + (m || 0), secTo: Math.round((at - now) / 1000) };
  });
  const upcoming = cands.filter((c) => c.secTo >= -60).sort((a, b) => a.secTo - b.secTo);
  if (upcoming.length) return { time: upcoming[0].time, secTo: upcoming[0].secTo };
  const earliest = cands.slice().sort((a, b) => a.tod - b.tod)[0];
  return { time: earliest.time, secTo: earliest.secTo + 24 * 3600 };
}

function updateCountdown() {
  if (!settings) return null;
  const tpl = activeTemplate();
  const next = nextOffworkClient(tpl.offworkTimes);
  $('countdown').textContent = `${next.time}，跑路倒计时 ${formatCountdown(next.secTo)}`;
  return next;
}

// 每秒刷新倒计时；"下一个跑路点"翻篇时自动重扫一遍刷新整张卡
function tickClock() {
  const next = updateCountdown();
  if (next && lastScan && lastScan.reminder && next.time !== lastScan.reminder.offworkTime && !rolloverPending) {
    rolloverPending = true;
    runScan().finally(() => {
      rolloverPending = false;
    });
  }
}

function renderScan(scan) {
  lastScan = scan;
  const card = $('radarCard');
  card.classList.remove('state-idle', 'state-good', 'state-warning', 'state-danger');
  card.classList.add(`state-${scan.risk || 'idle'}`);

  $('riskLabel').textContent = RISK_LABEL[scan.risk] || '待扫描';
  $('sourceTag').textContent = scan.source === 'amap' ? '实时接口' : '演示数据';
  updateCountdown();
  $('recommendText').textContent = scan.recommendText || '--';
  $('headline').textContent = scan.headline || '';
  $('suggestion').textContent = scan.suggestion || '';
  const tParts = [];
  if (scan.traffic && scan.traffic.description) tParts.push(`实时路况 · ${scan.traffic.description}`);
  if (scan.trend && scan.trend.enough) tParts.push(scan.trend.label);
  else if (!scan.traffic && scan.trend && scan.trend.label) tParts.push(scan.trend.label);
  const trendEl = $('trendTag');
  trendEl.textContent = tParts.length ? `· ${tParts.join(' · ')}` : '';
  trendEl.title = scan.traffic?.detail || '';

  const modeList = (scan.modes || []).map((m) => m.mode);
  if (!currentMapMode || !modeList.includes(currentMapMode)) currentMapMode = modeList[0] || 'driving';

  renderModes(scan);
  renderWeather(scan);
  renderMap(scan);
  renderAi(scan);
  $('foodWrap').hidden = scan.source !== 'amap';
  if (scan.source === 'amap') renderFoodToggle(scan);
}

/* ---------- 多通勤方式并列对比 ---------- */
function renderModes(scan) {
  const row = $('modesRow');
  row.innerHTML = '';
  const modes = scan.modes || (scan.commute ? [scan.commute] : []);
  if (!modes.length) return;
  const fastest = Math.min(...modes.map((m) => (m.offworkMinutes != null ? m.offworkMinutes : m.nowMinutes)));
  modes.forEach((m) => {
    const offwork = m.offworkMinutes != null ? m.offworkMinutes : m.nowMinutes;
    const isBest = offwork === fastest && modes.length > 1;
    const isSel = m.mode === currentMapMode;
    const card = document.createElement('div');
    card.className = 'mode-card' + (isBest ? ' best' : '') + (isSel ? ' selected' : '');
    card.title = `点击在地图上看这条路线｜现在约 ${m.nowMinutes} 分，下班点预计 ${offwork} 分${m.predictSource === 'estimate' ? '（估算）' : ''}`;
    card.innerHTML = `
      <span class="mc-name">${MODE_LABEL[m.mode] || m.mode}</span>
      <strong class="mc-now">${m.nowMinutes} 分</strong>
      <span class="mc-later">预计 ${offwork} 分${m.predictSource === 'estimate' ? ' 估' : ''}</span>
      ${isBest ? '<span class="mc-flag">最快</span>' : ''}`;
    card.addEventListener('click', () => selectMapMode(m.mode));
    row.appendChild(card);
  });
}

// 点通勤卡 / 地图 tab 都走这里：切换地图路线 + 同步高亮
function selectMapMode(mode) {
  currentMapMode = mode;
  if (lastRoute && settings.amapJsKey) {
    renderMapTabs(lastRoute.modes || [mode]);
    renderInteractiveMap(lastRoute, mode).catch(() => {});
  }
  if (lastScan) renderModes(lastScan);
}

/* ---------- 天气：带伞 / 加外套 醒目提示 + 风/湿度 ---------- */
function weatherLine(x) {
  if (!x || !x.weather) return '--';
  const parts = [`${x.weather} ${x.temp || '--'}°`];
  if (x.feelsLike && x.feelsLike !== x.temp) parts.push(`体感 ${x.feelsLike}°`);
  if (x.pop) parts.push(`降水 ${x.pop}%`);
  if (x.wind) parts.push(x.wind);
  if (x.humidity) parts.push(`湿度 ${x.humidity}`);
  return parts.join(' · ');
}

function renderWeather(scan) {
  const w = scan.weather || {};
  const ev = scan.reminder?.eveningTime;
  $('tonightWhen').textContent = ev ? `今晚下班 ${ev}` : '今晚下班';
  const md = scan.reminder?.morningDepart;
  $('morningWhen').textContent = md ? `明早出门 ${md}` : '明早出门';
  $('tonightText').textContent = weatherLine(w.tonight);
  $('tomorrowText').textContent = weatherLine(w.tomorrow);
  $('umbrellaBadge').hidden = !w.umbrella;
  $('coatBadge').hidden = !w.coat;
  $('weatherOk').hidden = Boolean(w.umbrella || w.coat);
  $('weatherAction').textContent = w.action || '';
}

/* ---------- AI 一句话：配了 key 就显示状态 ---------- */
function renderAi(scan) {
  const aiBox = $('aiBox');
  const tag = aiBox.querySelector('.ai-tag');
  const body = $('aiSummary');
  if (scan.aiSummary) {
    aiBox.classList.remove('ai-error');
    tag.textContent = 'AI';
    body.textContent = scan.aiSummary;
    aiBox.hidden = false;
  } else if (scan.aiConfigured) {
    aiBox.classList.add('ai-error');
    tag.textContent = '!';
    body.textContent = scan.aiError ? `AI 没出文案：${scan.aiError}` : 'AI 未返回文案';
    aiBox.hidden = false;
  } else {
    aiBox.classList.remove('ai-error');
    aiBox.hidden = true;
  }
  $('askWrap').hidden = !scan.aiConfigured;
}

/* ---------- AI 问答框：基于当前扫描数据问点啥 ---------- */
function appendChat(role, text) {
  const log = $('askLog');
  log.hidden = false;
  const div = document.createElement('div');
  div.className = role === 'me' ? 'chat-me' : 'chat-ai';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function askQuestion() {
  const input = $('askInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  appendChat('me', q);
  const btn = $('askBtn');
  btn.disabled = true;
  const pending = appendChat('ai', '思考中…');
  try {
    const r = await api.askAi(q);
    pending.textContent = r.text || `（${r.error || 'AI 没回答'}）`;
  } catch (e) {
    pending.textContent = `（${e.message || '出错了'}）`;
  } finally {
    btn.disabled = false;
    $('askLog').scrollTop = $('askLog').scrollHeight;
  }
}

/* ---------- 附近美食 ---------- */
let foodActiveKey = null;
const FOOD_HINT = '点上面位置查看周边餐饮（按路线 公司→家）';
function renderFoodToggle(scan) {
  const toggle = $('foodToggle');
  toggle.innerHTML = '';
  const transfers = (scan && scan.route && scan.route.transitPlan && scan.route.transitPlan.transfers) || [];
  // 按路线顺序：公司 → 换乘站 → 家
  const locs = [{ key: 'company', label: '公司附近' }];
  transfers.forEach((tr) => locs.push({ key: tr.location, label: `换乘·${tr.name}` }));
  locs.push({ key: 'home', label: '家附近' });
  locs.forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'food-loc' + (l.key === foodActiveKey ? ' active' : '');
    b.textContent = l.label;
    b.addEventListener('click', () => {
      if (foodActiveKey === l.key) {
        // 再次点选中项 → 折叠
        foodActiveKey = null;
        b.classList.remove('active');
        $('foodList').innerHTML = `<p class="food-hint">${FOOD_HINT}</p>`;
      } else {
        foodActiveKey = l.key;
        toggle.querySelectorAll('.food-loc').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        loadFood(l.key);
      }
    });
    toggle.appendChild(b);
  });
}

async function loadFood(where) {
  const list = $('foodList');
  list.innerHTML = '<p class="food-hint">查询中…</p>';
  try {
    const r = await api.searchFood(where);
    if (r.error || !r.pois || !r.pois.length) {
      list.innerHTML = `<p class="food-hint">${escapeHtml(r.error || '附近没找到餐饮')}</p>`;
      return;
    }
    list.innerHTML = r.pois
      .map((p) => {
        const meta = [
          p.type,
          p.distance != null ? `${p.distance}米` : '',
          p.rating ? `★${p.rating}` : '',
          p.cost ? `人均¥${p.cost}` : ''
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="food-item"><div class="food-name">${escapeHtml(p.name)}</div><div class="food-meta">${escapeHtml(meta)}</div></div>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = `<p class="food-hint">${escapeHtml(e.message || '查询失败')}</p>`;
  }
}

/* ---------- 地图：可交互(高德 JS) > 静态图 > 占位 ---------- */
function showMap({ interactive, img, empty, zoom }) {
  $('mapInteractive').hidden = !interactive;
  $('mapImg').hidden = !img;
  $('mapEmpty').hidden = !empty;
  $('mapZoom').hidden = !zoom;
}

let lastRoute = null;
let currentMapMode = null;

function renderMap(scan) {
  if (scan.route && settings.amapJsKey) {
    lastRoute = scan.route;
    const modes = scan.route.modes && scan.route.modes.length ? scan.route.modes : ['driving'];
    if (!currentMapMode || !modes.includes(currentMapMode)) currentMapMode = modes[0];
    renderMapTabs(modes);
    showMap({ interactive: true, img: false, empty: false, zoom: true });
    renderInteractiveMap(scan.route, currentMapMode).catch((err) => {
      $('mapTabs').hidden = true;
      if (scan.mapUrl) {
        $('mapImg').src = scan.mapUrl;
        showMap({ interactive: false, img: true, empty: false, zoom: true });
      } else {
        $('mapEmpty').textContent = `地图加载失败：${err.message || '请检查 JS Key / 安全密钥'}`;
        showMap({ interactive: false, img: false, empty: true, zoom: false });
      }
    });
  } else if (scan.mapUrl) {
    $('mapTabs').hidden = true;
    $('mapImg').src = scan.mapUrl;
    showMap({ interactive: false, img: true, empty: false, zoom: true });
  } else {
    $('mapTabs').hidden = true;
    $('mapImg').removeAttribute('src');
    $('mapEmpty').textContent = '配置高德 Key 后，这里显示通勤实时路况地图';
    showMap({ interactive: false, img: false, empty: true, zoom: false });
  }
}

function renderMapTabs(modes) {
  const tabs = $('mapTabs');
  if (!modes || modes.length <= 1) {
    tabs.hidden = true;
    tabs.innerHTML = '';
    return;
  }
  tabs.hidden = false;
  tabs.innerHTML = '';
  modes.forEach((mode) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-tab' + (mode === currentMapMode ? ' active' : '');
    b.textContent = MODE_LABEL[mode] || mode;
    b.addEventListener('click', () => selectMapMode(mode));
    tabs.appendChild(b);
  });
}

let amapLoadPromise = null;
function ensureAmap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoadPromise) return amapLoadPromise;
  if (settings.amapSecurityCode) {
    window._AMapSecurityConfig = { securityJsCode: settings.amapSecurityCode };
  }
  amapLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(settings.amapJsKey)}&plugin=AMap.Driving,AMap.Transfer`;
    s.async = true;
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('AMap 未就绪')));
    s.onerror = () => {
      amapLoadPromise = null;
      reject(new Error('地图脚本加载失败'));
    };
    document.head.appendChild(s);
  });
  return amapLoadPromise;
}

function markerDot(color, label) {
  return `<div style="width:22px;height:22px;line-height:22px;border-radius:50%;background:${color};color:#06121f;font-size:11px;font-weight:700;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${label}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function transitSegText(seg) {
  if (!seg) return '';
  if (seg.transit_mode === 'WALK') {
    const d = (seg.walking && seg.walking.distance) || seg.distance;
    return `步行${d ? ` ${Math.round(d)} 米` : ''}`;
  }
  const t = seg.transit;
  const line = t && t.lines && t.lines[0] ? t.lines[0].name : '';
  if (line) {
    const on = t.on_station ? t.on_station.name : '';
    const off = t.off_station ? t.off_station.name : '';
    return `乘 ${line}，${on} → ${off}`;
  }
  return seg.instruction || '';
}

// 自定义紧凑路线面板：默认只显示首选线路一行，详细步骤折叠
function buildRoutePanel(mode, result) {
  const panel = $('mapPanel');
  let summary = '';
  let steps = [];
  if (mode === 'transit' && result.plans && result.plans[0]) {
    const p = result.plans[0];
    const km = p.distance ? ` · ${(p.distance / 1000).toFixed(1)} 公里` : '';
    summary = `${MODE_LABEL.transit} · 约 ${Math.round((p.time || 0) / 60)} 分钟${km}`;
    steps = (p.segments || []).map(transitSegText).filter(Boolean);
  } else if (result.routes && result.routes[0]) {
    const r = result.routes[0];
    summary = `${MODE_LABEL[mode] || mode} · 约 ${Math.round((r.time || 0) / 60)} 分钟 · ${(r.distance / 1000).toFixed(1)} 公里${r.policy ? ` · ${r.policy}` : ''}`;
    steps = (r.steps || []).map((s) => s.instruction).filter(Boolean);
  } else {
    panel.hidden = true;
    return;
  }
  const stepsHtml = steps.length
    ? `<details class="route-steps"><summary>展开 ${steps.length} 步详细路线</summary><ol>${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol></details>`
    : '';
  panel.innerHTML = `<div class="route-summary">${escapeHtml(summary)}</div>${stepsHtml}`;
  panel.hidden = false;
}

// 公交面板：摘要 + 折叠的换乘详情（步行/线路/上下车站点）
function buildTransitPanel(plan) {
  const panel = $('mapPanel');
  if (!plan || !plan.segments || !plan.segments.length) {
    panel.hidden = true;
    return;
  }
  const km = plan.distance ? ` · ${(plan.distance / 1000).toFixed(1)} 公里` : '';
  const summary = `${MODE_LABEL.transit} · 约 ${plan.time} 分钟${km}`;
  const stepsHtml = `<details class="route-steps"><summary>展开换乘详情（${plan.segments.length} 段）</summary><ol>${plan.segments
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join('')}</ol></details>`;
  panel.innerHTML = `<div class="route-summary">${escapeHtml(summary)}</div>${stepsHtml}`;
  panel.hidden = false;
}

let amapMap = null;
let amapRoute = null;
let amapMarkers = [];
let amapMapKey = null;
async function renderInteractiveMap(route, mode) {
  const AMap = await ensureAmap();
  const useMode = mode || (route.modes && route.modes[0]) || 'driving';
  const [olng, olat] = String(route.origin).split(',').map(Number);
  const [dlng, dlat] = String(route.destination).split(',').map(Number);
  if (![olng, olat, dlng, dlat].every(Number.isFinite)) throw new Error('坐标无效');

  // 起终点变了（改了地址）就销毁旧地图重建，避免残留上一个地址的标记/路线
  const mapKey = `${route.origin}|${route.destination}`;
  if (amapMap && amapMapKey !== mapKey) {
    amapMap.destroy();
    amapMap = null;
    amapRoute = null;
    amapMarkers = [];
  }
  if (!amapMap) {
    amapMap = new AMap.Map('mapInteractive', { zoom: 12, center: [olng, olat], viewMode: '2D' });
    amapMap.add(new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180 }));
    amapMapKey = mapKey;
  }

  // 清旧路线、标记、详情面板
  if (amapRoute) {
    amapRoute.clear();
    amapRoute = null;
  }
  amapMarkers.forEach((m) => amapMap.remove(m));
  amapMarkers = [];
  const panel = $('mapPanel');
  panel.innerHTML = '';
  panel.hidden = true;

  // 公交：JS 插件只负责画线 + 换乘站标记；面板换乘详情用 Web 服务预取数据，默认折叠
  if (useMode === 'transit') {
    try {
      amapRoute = new AMap.Transfer({ map: amapMap, hideMarkers: false, autoFitView: true, city: route.city || '全国', cityd: route.city || '全国' });
      amapRoute.search([olng, olat], [dlng, dlat], () => {});
    } catch {
      /* 画线失败不影响面板 */
    }
    buildTransitPanel(route.transitPlan);
    return;
  }

  // 驾车：画线 + 标记，面板用自定义紧凑版（默认只显示首选线路一行，步骤折叠）
  if (useMode === 'driving') {
    try {
      amapRoute = new AMap.Driving({ map: amapMap, showTraffic: true, hideMarkers: false, autoFitView: true });
      amapRoute.search([olng, olat], [dlng, dlat], (status, result) => {
        if (status === 'complete') buildRoutePanel('driving', result);
        else panel.hidden = true;
      });
    } catch {
      panel.hidden = true;
    }
    return;
  }

  // 骑行/步行：自定义起终点标记，不画线、不出面板
  amapMarkers = [
    new AMap.Marker({ position: [olng, olat], map: amapMap, title: route.originName || '公司', content: markerDot('#2f7bff', '公'), offset: new AMap.Pixel(-11, -11) }),
    new AMap.Marker({ position: [dlng, dlat], map: amapMap, title: route.destName || '家', content: markerDot('#46d18a', '家'), offset: new AMap.Pixel(-11, -11) })
  ];
  amapMap.setFitView(amapMarkers);
}

async function runScan() {
  const scanBtn = $('scanBtn');
  scanBtn.disabled = true;
  scanBtn.textContent = '扫描中...';
  try {
    const scan = await api.runScan();
    renderScan(scan);
    setMessage(`已更新：${new Date(scan.generatedAt).toLocaleTimeString()}`);
  } catch (error) {
    setMessage(error.message || '扫描失败');
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = '立即扫描';
  }
}

/* ---------- 初始化 ---------- */
async function init() {
  settings = await api.getSettings();
  renderTemplates();
  fillForm();

  $('settingsToggle').addEventListener('click', () => {
    $('settingsForm').hidden = !$('settingsForm').hidden;
  });

  $('hideBtn').addEventListener('click', () => api.hideWindow());
  $('scanBtn').addEventListener('click', runScan);
  $('mapZoom').addEventListener('click', () => api.openMap());
  $('mapImg').addEventListener('click', () => api.openMap());
  $('addTimeBtn').addEventListener('click', () => addTimeRow('18:00'));
  $('askBtn').addEventListener('click', askQuestion);
  $('askInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askQuestion();
  });

  $('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    readForm();
    await persist('设置已保存，下班前会自动提醒。');
    $('settingsForm').hidden = true;
  });

  $('saveAsBtn').addEventListener('click', async () => {
    if (settings.templates.length >= MAX_TEMPLATES) {
      setMessage('最多只能存 3 个模板，先删一个再另存。');
      return;
    }
    readForm();
    const current = activeTemplate();
    const copy = {
      ...current,
      id: `tpl_local_${Date.now()}`,
      name: `${current.name} 副本`
    };
    settings.templates.push(copy);
    settings.activeId = copy.id;
    $('settingsForm').hidden = true;
    await persist('已另存为新模板。');
  });

  api.onScanUpdate(renderScan);
  runScan();
  setInterval(tickClock, 1000);
}

init().catch((error) => setMessage(error.message || '初始化失败'));
