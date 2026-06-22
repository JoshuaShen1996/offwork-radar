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
  aiBaseUrl: $('aiBaseUrl'),
  aiModel: $('aiModel'),
  aiKey: $('aiKey'),
  notificationsEnabled: $('notificationsEnabled')
};

const tplFields = {
  name: $('tplName'),
  companyAddress: $('companyAddress'),
  homeAddress: $('homeAddress')
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

  settings.amapKey = globalFields.amapKey.value.trim();
  settings.amapJsKey = globalFields.amapJsKey.value.trim();
  settings.amapSecurityCode = globalFields.amapSecurityCode.value.trim();
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

  $('timesList').innerHTML = '';
  (tpl.offworkTimes && tpl.offworkTimes.length ? tpl.offworkTimes : ['18:00']).forEach(addTimeRow);

  globalFields.amapKey.value = settings.amapKey || '';
  globalFields.amapJsKey.value = settings.amapJsKey || '';
  globalFields.amapSecurityCode.value = settings.amapSecurityCode || '';
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

function formatCountdown(mins) {
  if (!Number.isFinite(mins)) return '';
  if (mins < 0) return '已过';
  if (mins < 60) return `还有 ${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `还有 ${h} 小时${m ? ` ${m} 分` : ''}`;
}

// 客户端实时算"下一个跑路点"，和主进程 nextOffwork 逻辑一致：优先今天还没到的最近一个，否则明天最早的
function nextOffworkClient(times) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const valid = (times && times.length ? times : ['18:00']).filter(Boolean);
  const parsed = valid.map((t) => {
    const [h, m] = t.split(':').map(Number);
    return { time: t, tod: (h || 0) * 60 + (m || 0) };
  });
  const upcoming = parsed.filter((p) => p.tod - nowMin >= -1).sort((a, b) => a.tod - b.tod);
  if (upcoming.length) return { time: upcoming[0].time, minutesTo: upcoming[0].tod - nowMin };
  const earliest = parsed.slice().sort((a, b) => a.tod - b.tod)[0];
  return { time: earliest.time, minutesTo: earliest.tod + 24 * 60 - nowMin };
}

// 每 15 秒刷新倒计时；"下一个跑路点"翻篇时自动重扫一遍刷新整张卡
function tickClock() {
  if (!settings) return;
  const tpl = activeTemplate();
  const next = nextOffworkClient(tpl.offworkTimes);
  $('nextOffwork').textContent = next.time;
  $('countdown').textContent = `跑路倒计时 · ${formatCountdown(next.minutesTo)}`;
  if (lastScan && lastScan.reminder && next.time !== lastScan.reminder.offworkTime && !rolloverPending) {
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
  const mins = scan.reminder?.minutesToOffwork;
  $('nextOffwork').textContent = scan.reminder?.offworkTime || '--';
  $('countdown').textContent = `跑路倒计时 · ${Number.isFinite(mins) ? formatCountdown(mins) : '--'}`;
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

  renderModes(scan);
  renderWeather(scan);
  renderMap(scan);
  renderAi(scan);
}

/* ---------- 多通勤方式并列对比 ---------- */
function renderModes(scan) {
  const row = $('modesRow');
  row.innerHTML = '';
  const modes = scan.modes || (scan.commute ? [scan.commute] : []);
  if (!modes.length) return;
  const fastest = Math.min(...modes.map((m) => m.nowMinutes));
  modes.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'mode-card' + (m.nowMinutes === fastest && modes.length > 1 ? ' best' : '');
    card.innerHTML = `
      <span class="mc-name">${MODE_LABEL[m.mode] || m.mode}</span>
      <strong class="mc-now">${m.nowMinutes} 分</strong>
      <span class="mc-later">晚 30 分 ${m.laterMinutes} 分</span>
      ${m.nowMinutes === fastest && modes.length > 1 ? '<span class="mc-flag">最快</span>' : ''}`;
    row.appendChild(card);
  });
}

/* ---------- 天气：带伞 / 加外套 醒目提示 ---------- */
function renderWeather(scan) {
  const w = scan.weather || {};
  $('tonightText').textContent = weatherText(w.tonight);
  $('tomorrowText').textContent = weatherText(w.tomorrow);
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
    b.addEventListener('click', () => {
      currentMapMode = mode;
      renderMapTabs(modes);
      if (lastRoute) renderInteractiveMap(lastRoute, mode).catch(() => {});
    });
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

let amapMap = null;
let amapRoute = null;
let amapMarkers = [];
async function renderInteractiveMap(route, mode) {
  const AMap = await ensureAmap();
  const useMode = mode || (route.modes && route.modes[0]) || 'driving';
  const [olng, olat] = String(route.origin).split(',').map(Number);
  const [dlng, dlat] = String(route.destination).split(',').map(Number);
  if (![olng, olat, dlng, dlat].every(Number.isFinite)) throw new Error('坐标无效');

  if (!amapMap) {
    amapMap = new AMap.Map('mapInteractive', { zoom: 12, center: [olng, olat], viewMode: '2D' });
    amapMap.add(new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180 }));
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

  // 驾车/公交用高德路线插件：画线 + 起终点/换乘站标记 + 详情面板（换乘站、各段用时、步骤）
  if (useMode === 'driving' || useMode === 'transit') {
    try {
      panel.hidden = false;
      if (useMode === 'transit') {
        amapRoute = new AMap.Transfer({
          map: amapMap,
          panel: 'mapPanel',
          hideMarkers: false,
          autoFitView: true,
          city: route.city || '全国',
          cityd: route.city || '全国'
        });
      } else {
        amapRoute = new AMap.Driving({
          map: amapMap,
          panel: 'mapPanel',
          showTraffic: true,
          hideMarkers: false,
          autoFitView: true
        });
      }
      amapRoute.search([olng, olat], [dlng, dlat], (status) => {
        if (status !== 'complete') panel.hidden = true;
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
    await persist('已另存为新模板。');
  });

  api.onScanUpdate(renderScan);
  runScan();
  setInterval(tickClock, 15000);
}

init().catch((error) => setMessage(error.message || '初始化失败'));
