const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

function loadEnvFile() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const raw = require('node:fs').readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, name, value] = match;
      if (!process.env[name]) {
        process.env[name] = value.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // .env is optional. Empty key means demo mode.
  }
}

loadEnvFile();

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const MAX_TEMPLATES = 3;

let templateSeq = 0;
function newId() {
  templateSeq += 1;
  return `tpl_${Date.now()}_${templateSeq}`;
}

const ALL_MODES = ['driving', 'transit', 'bicycling', 'walking'];

function makeTemplate(partial = {}) {
  const times = Array.isArray(partial.offworkTimes) ? partial.offworkTimes.filter(Boolean) : [];
  let modes = Array.isArray(partial.commuteModes) ? partial.commuteModes.filter((m) => ALL_MODES.includes(m)) : [];
  if (!modes.length && partial.commuteMode) modes = [partial.commuteMode];
  if (!modes.length) modes = ['driving'];
  return {
    id: partial.id || newId(),
    name: partial.name || '默认模板',
    companyAddress: partial.companyAddress || '',
    homeAddress: partial.homeAddress || '',
    commuteModes: modes,
    offworkTimes: times.length ? times : ['18:00']
  };
}

const GLOBAL_DEFAULTS = {
  amapKey: process.env.AMAP_KEY || '',
  amapJsKey: process.env.AMAP_JS_KEY || '',
  amapSecurityCode: process.env.AMAP_SECURITY_CODE || '',
  notificationsEnabled: true,
  aiKey: process.env.AI_KEY || process.env.OPENAI_API_KEY || '',
  aiBaseUrl: process.env.AI_BASE_URL || '',
  aiModel: process.env.AI_MODEL || ''
};

// 兼容旧的单配置存档，统一升级为「模板」结构
function normalizeSettings(raw) {
  const s = { ...GLOBAL_DEFAULTS, ...(raw || {}) };
  let templates = Array.isArray(s.templates) ? s.templates : [];
  if (!templates.length) {
    templates = [makeTemplate({
      name: '默认模板',
      companyAddress: raw?.companyAddress,
      homeAddress: raw?.homeAddress,
      commuteMode: raw?.commuteMode,
      offworkTimes: raw?.offworkTimes || (raw?.offworkTime ? [raw.offworkTime] : ['18:00']),
      remindMinutes: raw?.remindMinutes
    })];
  }
  s.templates = templates.slice(0, MAX_TEMPLATES).map(makeTemplate);
  if (!s.activeId || !s.templates.some((t) => t.id === s.activeId)) {
    s.activeId = s.templates[0].id;
  }
  for (const legacy of ['companyAddress', 'homeAddress', 'commuteMode', 'offworkTime', 'offworkTimes', 'remindMinutes']) {
    delete s[legacy];
  }
  return s;
}

function activeTemplate(settings) {
  return settings.templates.find((t) => t.id === settings.activeId) || settings.templates[0];
}

let mainWindow;
let tray;
let reminderTimer;
let firedKeys = new Set();
let lastRouteContext = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(null);
  }
}

async function writeSettings(settings) {
  const next = normalizeSettings(settings);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function appIcon() {
  const icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png'));
  return icon.isEmpty() ? undefined : icon;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 680,
    minWidth: 460,
    minHeight: 560,
    show: false,
    resizable: true,
    title: '下班跑路雷达',
    backgroundColor: '#0c1014',
    icon: appIcon(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.png'));
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('下班跑路雷达');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: () => mainWindow?.show() },
    { label: '立即扫描', click: () => scanAndNotify(true) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', () => mainWindow?.show());
}

function parseTimeToDate(timeText, now = new Date()) {
  const [hour, minute] = String(timeText || '18:00').split(':').map(Number);
  const target = new Date(now);
  target.setHours(Number.isFinite(hour) ? hour : 18, Number.isFinite(minute) ? minute : 0, 0, 0);
  return target;
}

function minutesBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function fmtHM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function modeLabel(mode) {
  return { driving: '驾车/打车', transit: '公交地铁', bicycling: '骑行', walking: '步行' }[mode] || '驾车';
}

// 从多个跑路时间里挑出「下一个」：优先今天还没到的最近一个，否则取明天最早的
function nextOffwork(times, now = new Date()) {
  const valid = (Array.isArray(times) && times.length ? times : ['18:00']).filter(Boolean);
  const candidates = valid.map((time) => {
    const at = parseTimeToDate(time, now);
    return { time, at, minutesTo: minutesBetween(at, now) };
  });
  const upcoming = candidates.filter((c) => c.minutesTo >= -1).sort((a, b) => a.minutesTo - b.minutesTo);
  if (upcoming.length) return upcoming[0];
  const earliest = candidates.slice().sort((a, b) => a.at - b.at)[0];
  const at = new Date(earliest.at.getTime() + 24 * 3600 * 1000);
  return { time: earliest.time, at, minutesTo: minutesBetween(at, now) };
}

function classifyRisk(primary, weatherText, trend, traffic) {
  const badWeather = /雨|雪|雷|雾|沙|霾|冰雹/.test(String(weatherText || ''));
  const delta = primary.laterMinutes - primary.nowMinutes;
  const worseThanUsual = trend && trend.enough && trend.deltaVsUsual >= 8;
  const heavyTraffic = traffic && traffic.status >= 3; // 拥堵 / 严重拥堵
  const someTraffic = traffic && traffic.status === 2; // 缓行
  if (heavyTraffic) return 'danger';
  if (badWeather && (delta >= 10 || worseThanUsual || someTraffic)) return 'danger';
  if (badWeather || delta >= 10 || worseThanUsual || someTraffic) return 'warning';
  return 'good';
}

// 今晚下班 + 明早上班，转成「带伞 / 加外套」的动作建议
function weatherAdvice(tonight, tomorrow) {
  const rain = /雨|雪|雷|冰雹/;
  const umbrella = rain.test(tonight.weather) || rain.test(tomorrow.weather);
  const temps = [Number(tonight.temp), Number(tomorrow.temp)].filter(Number.isFinite);
  const minTemp = temps.length ? Math.min(...temps) : null;
  const coat = minTemp != null && minTemp <= 15;
  const parts = [];
  if (umbrella) parts.push('带伞');
  if (coat) parts.push('加外套');
  const action = parts.length ? `记得${parts.join('、')}。` : '穿着随意，今明天气都还行。';
  return { umbrella, coat, action };
}

// 统一决策文案：以「下班/提醒时间」为基准，不建议早于下班点走；偶尔早退靠多设一个更早的时间
function decide(refTime, risk, nowMinutes, laterMinutes) {
  const delta = Math.max(0, laterMinutes - nowMinutes);

  if (risk === 'good') {
    return {
      recommendText: `${refTime} 准点走`,
      headline: '到点走就行，不急也能再等等',
      suggestion: `现在回家约 ${nowMinutes} 分钟，晚 30 分钟也才多花 ${delta} 分，路况稳。`
    };
  }
  if (risk === 'warning') {
    return {
      recommendText: `${refTime} 一到就走`,
      headline: '到点别拖，越晚越堵',
      suggestion: `现在约 ${nowMinutes} 分钟，晚 30 分钟要多花 ${delta} 分。`
    };
  }
  return {
    recommendText: `${refTime} 立刻走`,
    headline: '到点马上走，今天值得就早退',
    suggestion: `现在约 ${nowMinutes} 分钟，晚 30 分钟可能到 ${laterMinutes} 分，雨和堵会叠加。`
  };
}

function buildScan(source, tpl, now, modes, tonight, tomorrow, weatherCity, route, trend, traffic) {
  const next = nextOffwork(tpl.offworkTimes, now);
  const advice = weatherAdvice(tonight, tomorrow);
  const primary = modes[0];
  const risk = classifyRisk(primary, tonight.weather, trend, traffic);
  const d = decide(next.time, risk, primary.nowMinutes, primary.laterMinutes);

  return {
    source,
    generatedAt: now.toISOString(),
    templateName: tpl.name,
    risk,
    recommendText: d.recommendText,
    headline: d.headline,
    suggestion: d.suggestion,
    primaryMode: primary.mode,
    modes,
    commute: primary,
    trend: trend || null,
    traffic: traffic || null,
    weather: {
      city: weatherCity,
      tonight,
      tomorrow,
      umbrella: advice.umbrella,
      coat: advice.coat,
      action: advice.action
    },
    reminder: {
      offworkTime: next.time,
      minutesToOffwork: next.minutesTo,
      allTimes: tpl.offworkTimes
    },
    route: route || null,
    hasMap: Boolean(lastRouteContext)
  };
}

const MODE_DEMO_BASE = { driving: 38, transit: 52, bicycling: 30, walking: 92 };

function buildMockScan(tpl) {
  const now = new Date();
  const rainy = now.getMinutes() % 2 === 0;
  const cold = now.getHours() % 2 === 0;
  const tonight = { weather: rainy ? '小雨' : '多云', temp: cold ? '13' : '24' };
  const tomorrow = { weather: rainy ? '阴' : '晴', temp: cold ? '12' : '20' };
  const modes = tpl.commuteModes.map((mode) => {
    const nowMinutes = (MODE_DEMO_BASE[mode] || 40) + (now.getMinutes() % 9);
    const laterMinutes = nowMinutes + 6 + (now.getMinutes() % 7);
    return { mode, nowMinutes, laterMinutes, deltaMinutes: laterMinutes - nowMinutes };
  });
  const baseline = modes[0].nowMinutes - 5;
  const trend = { enough: true, baselineMinutes: baseline, deltaVsUsual: 5, label: '比平时慢约 5 分（演示数据）' };
  const traffic = rainy
    ? { status: 3, description: '拥堵', detail: '演示：主干道多处缓行', expedite: '45%' }
    : { status: 2, description: '轻度拥堵', detail: '演示：部分路段缓行', expedite: '70%' };
  return buildScan('mock', tpl, now, modes, tonight, tomorrow, '演示城市', null, trend, traffic);
}

async function amapFetch(pathname, params, key, version = 'v3') {
  const url = new URL(`https://restapi.amap.com/${version}/${pathname}`);
  url.searchParams.set('key', key);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`高德接口请求失败：${response.status}`);
  const payload = await response.json();
  if (version === 'v4') {
    if (payload.errcode && payload.errcode !== 0) throw new Error(payload.errmsg || '高德接口返回异常');
    return payload;
  }
  if (payload.status !== '1') throw new Error(payload.info || '高德接口返回异常');
  return payload;
}

async function geocode(address, key) {
  const payload = await amapFetch('geocode/geo', { address }, key);
  const first = payload.geocodes?.[0];
  if (!first?.location) throw new Error(`无法识别地址：${address}`);
  return first;
}

function routeApiForMode(mode) {
  if (mode === 'walking') return 'direction/walking';
  if (mode === 'transit') return 'direction/transit/integrated';
  return 'direction/driving';
}

async function route(origin, destination, mode, city, key) {
  const params = { origin, destination };
  if (mode === 'bicycling') {
    const payload = await amapFetch('direction/bicycling', params, key, 'v4');
    const first = payload.data?.paths?.[0];
    return Math.max(1, Math.round(Number(first?.duration || 0) / 60));
  }
  if (mode === 'transit') {
    params.city = city;
    params.cityd = city;
  }
  const payload = await amapFetch(routeApiForMode(mode), params, key);
  const routeData = payload.route || {};
  let seconds = 0;
  if (mode === 'transit') {
    seconds = Number(routeData.transits?.[0]?.duration || 0);
  } else {
    seconds = Number(routeData.paths?.[0]?.duration || 0);
  }
  return Math.max(1, Math.round(seconds / 60));
}

async function weatherForecast(adcode, key) {
  const payload = await amapFetch('weather/weatherInfo', { city: adcode, extensions: 'all' }, key);
  const forecast = payload.forecasts?.[0];
  const casts = forecast?.casts || [];
  const today = casts[0] || {};
  const tomo = casts[1] || casts[0] || {};
  return {
    city: forecast?.city || '',
    tonight: { weather: today.nightweather || '未知', temp: today.nighttemp || '' },
    tomorrow: { weather: tomo.dayweather || '未知', temp: tomo.daytemp || '' }
  };
}

// 交通态势：公司周边实时拥堵评价（status 1畅通 2缓行 3拥堵 4严重拥堵），即时可用，不靠积累
async function trafficStatus(location, key) {
  try {
    const payload = await amapFetch('traffic/status/circle', { location, radius: 2500, extensions: 'base' }, key);
    const ev = payload.trafficinfo?.evaluation;
    if (!ev || !ev.status || ev.status === '0') return null;
    return {
      status: Number(ev.status),
      description: ev.description || '',
      expedite: ev.expedite || '',
      detail: payload.trafficinfo?.description || ''
    };
  } catch {
    return null;
  }
}

// 本地路况历史：每次实时扫描存一条，用来跟「平时同一时段」对比，给出快/慢趋势
let history = null;
function historyPath() {
  return path.join(app.getPath('userData'), 'history.json');
}
async function loadHistory() {
  if (history) return history;
  try {
    history = JSON.parse(await fs.readFile(historyPath(), 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  return history;
}
function saveHistory() {
  history = history.slice(-800);
  fs.writeFile(historyPath(), JSON.stringify(history), 'utf8').catch(() => {});
}
function minOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}
function computeTrend(now, mode, nowMinutes) {
  const cur = minOfDay(now);
  const today = now.toDateString();
  const samples = history.filter(
    (h) => h.mode === mode && h.day !== today && Math.abs(h.minOfDay - cur) <= 45
  );
  if (samples.length < 2) {
    return { enough: false, baselineMinutes: null, deltaVsUsual: 0, label: '近期数据积累中，多用几天就能跟平时对比' };
  }
  const avg = Math.round(samples.reduce((s, h) => s + h.minutes, 0) / samples.length);
  const delta = nowMinutes - avg;
  const label =
    delta >= 5 ? `比平时同一时段慢约 ${delta} 分，更该早走` : delta <= -5 ? `比平时快约 ${-delta} 分，路况不错` : '和平时差不多';
  return { enough: true, baselineMinutes: avg, deltaVsUsual: delta, label };
}

async function scanCommute(settings) {
  const tpl = activeTemplate(settings);
  if (!settings.amapKey || !tpl.companyAddress || !tpl.homeAddress) {
    lastRouteContext = null;
    return buildMockScan(tpl);
  }

  const now = new Date();
  const [originGeo, destinationGeo] = await Promise.all([
    geocode(tpl.companyAddress, settings.amapKey),
    geocode(tpl.homeAddress, settings.amapKey)
  ]);

  const origin = originGeo.location;
  const destination = destinationGeo.location;
  const city = originGeo.citycode || originGeo.adcode;
  const rushHourFactor = now.getHours() >= 17 && now.getHours() <= 19 ? 1.18 : 1.08;

  // 每个选中的出行方式各算一遍耗时，外加今明天气 + 公司周边实时交通态势，一起并发
  const [modeResults, wx, traffic] = await Promise.all([
    Promise.all(
      tpl.commuteModes.map(async (mode) => {
        const nowMinutes = await route(origin, destination, mode, city, settings.amapKey);
        const laterMinutes = Math.round(nowMinutes * rushHourFactor);
        return { mode, nowMinutes, laterMinutes, deltaMinutes: laterMinutes - nowMinutes };
      })
    ),
    weatherForecast(originGeo.adcode, settings.amapKey),
    trafficStatus(origin, settings.amapKey)
  ]);

  lastRouteContext = {
    origin,
    destination,
    originName: tpl.companyAddress,
    destName: tpl.homeAddress,
    mode: tpl.commuteModes[0]
  };

  await loadHistory();
  const trend = computeTrend(now, modeResults[0].mode, modeResults[0].nowMinutes);
  for (const m of modeResults) {
    history.push({ day: now.toDateString(), minOfDay: minOfDay(now), mode: m.mode, minutes: m.nowMinutes });
  }
  saveHistory();

  const routeInfo = {
    origin,
    destination,
    originName: tpl.companyAddress,
    destName: tpl.homeAddress,
    modes: tpl.commuteModes,
    city
  };
  const scan = buildScan('amap', tpl, now, modeResults, wx.tonight, wx.tomorrow, wx.city, routeInfo, trend, traffic);
  scan.mapUrl = buildStaticMapUrl(lastRouteContext, settings.amapKey);
  return scan;
}

// 内嵌实时路况图：高德静态地图，traffic=1 显示拥堵颜色，复用 Web 服务 key
function buildStaticMapUrl(ctx, key) {
  if (!ctx || !key) return null;
  const u = new URL('https://restapi.amap.com/v3/staticmap');
  u.searchParams.set('size', '372*190');
  u.searchParams.set('scale', '2');
  u.searchParams.set('traffic', '1');
  u.searchParams.set('markers', `mid,0x2f7bff,A:${ctx.origin}|mid,0x46d18a,B:${ctx.destination}`);
  u.searchParams.set('key', key);
  return u.toString();
}

// AI 一句话决策：把接口数据翻译成人话。OpenAI 兼容接口，可指向公司内部模型。
function buildAiPrompt(scan) {
  const modeLine = scan.modes
    .map((m) => `${modeLabel(m.mode)}到家约 ${m.nowMinutes} 分（再拖半小时约 ${m.laterMinutes} 分）`)
    .join('；');
  return [
    `用户固定 ${scan.reminder.offworkTime} 下班、到点才走，不会提前离开工位。`,
    `按当前路况各方式：${modeLine}。`,
    scan.traffic ? `公司周边实时路况：${scan.traffic.description}（畅通占比 ${scan.traffic.expedite}）。` : '',
    scan.trend && scan.trend.enough ? `跟平时比：${scan.trend.label}。` : '',
    `今晚：${scan.weather.tonight.weather} ${scan.weather.tonight.temp}°，明早：${scan.weather.tomorrow.weather} ${scan.weather.tomorrow.temp}°。`,
    `系统结论（以此为准）：${scan.recommendText}（${scan.headline}）。`
  ].filter(Boolean).join('\n');
}

async function aiSummary(settings, scan) {
  if (!settings.aiKey) return { text: null, error: null };
  const base = (settings.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = settings.aiModel || 'gpt-4o-mini';
  const messages = [
    {
      role: 'system',
      content:
        '你是"下班跑路雷达"的播报助手。用户每天固定在指定下班时间走，不会早于这个时间离开工位。请根据"系统结论"、实时路况和今明天气，用一句话（40 字以内）口语化地告诉他：到点要不要准时走、会不会越晚越堵、开车还是公交更划算、要不要带伞或加外套。绝对不要说"现在就走/快跑/立刻出发"之类让他提前离岗的话，他只会到点才走。直接给结论，别客套、别复述数字。'
    },
    { role: 'user', content: buildAiPrompt(scan) }
  ];

  // qwen3 等推理模型默认会"思考"上千字、耗时 15~25s，会撞超时。
  // 先带 enable_thinking:false 关思考（约 1.5s 返回）；个别服务商不认该字段(400)时退回普通请求。
  async function call(disableThinking) {
    const body = { model, temperature: 0.6, max_tokens: 256, messages };
    if (disableThinking) body.enable_thinking = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    let r = await call(true);
    if (!r.ok && r.status === 400) r = await call(false);
    if (!r.ok) return { text: null, error: `AI 接口 ${r.status}${r.text ? '：' + r.text.slice(0, 80) : ''}` };
    const data = JSON.parse(r.text);
    const text = data.choices?.[0]?.message?.content?.trim();
    return { text: text || null, error: text ? null : 'AI 返回为空（思考可能占满，已尝试关思考）' };
  } catch (e) {
    return { text: null, error: e.name === 'AbortError' ? 'AI 超时（40s）' : e.message || 'AI 调用失败' };
  }
}

function notify(scan, fromReminder = false) {
  if (Notification.isSupported()) {
    new Notification({
      title: `跑路雷达 · ${scan.recommendText}`,
      body: scan.aiSummary || `${scan.suggestion} ${scan.weather.action}`,
      icon: appIcon(),
      silent: false
    }).show();
  }
  // 到点闹钟：除了系统通知，再闪一下任务栏 + 唤出窗口，dev 版通知被静默时也能看到
  if (fromReminder && mainWindow) {
    mainWindow.show();
    if (process.platform === 'win32') mainWindow.flashFrame(true);
  }
}

async function scanAndNotify(force = false, fromReminder = false) {
  const settings = await readSettings();
  const scan = await scanCommute(settings);
  const ai = await aiSummary(settings, scan);
  scan.aiSummary = ai.text;
  scan.aiError = ai.error;
  scan.aiConfigured = Boolean(settings.aiKey);
  mainWindow?.webContents.send('scan:update', scan);
  if (force || settings.notificationsEnabled) notify(scan, fromReminder);
  return scan;
}

function openTrafficMap() {
  if (lastRouteContext) {
    const u = new URL('https://www.amap.com/dir');
    u.searchParams.set('from[name]', lastRouteContext.originName);
    u.searchParams.set('from[lnglat]', lastRouteContext.origin);
    u.searchParams.set('to[name]', lastRouteContext.destName);
    u.searchParams.set('to[lnglat]', lastRouteContext.destination);
    u.searchParams.set('type', lastRouteContext.mode === 'transit' ? 'bus' : 'car');
    return shell.openExternal(u.toString());
  }
  return shell.openExternal('https://www.amap.com/');
}

async function reminderTick() {
  const settings = await readSettings();
  if (!settings.notificationsEnabled) return;
  const tpl = activeTemplate(settings);
  const now = new Date();
  if (firedKeys.size > 60) firedKeys = new Set();
  for (const time of tpl.offworkTimes) {
    const at = parseTimeToDate(time, now);
    const minutesLeft = minutesBetween(at, now);
    const key = `${now.toDateString()}-${tpl.id}-${time}`;
    // 到点闹钟：到设定时间(0 到 -3 分钟窗口内)准时弹一次
    if (minutesLeft <= 0 && minutesLeft >= -3 && !firedKeys.has(key)) {
      firedKeys.add(key);
      await scanAndNotify(false, true);
      break;
    }
  }
}

function startReminderLoop() {
  clearInterval(reminderTimer);
  reminderTimer = setInterval(reminderTick, 30 * 1000);
  reminderTick();
}

ipcMain.handle('settings:get', readSettings);
ipcMain.handle('settings:save', async (_event, settings) => {
  const saved = await writeSettings(settings);
  startReminderLoop();
  return saved;
});
ipcMain.handle('scan:run', async () => scanAndNotify(false));
ipcMain.handle('map:open', () => openTrafficMap());
ipcMain.handle('window:hide', () => mainWindow?.hide());

if (process.platform === 'win32') {
  app.setAppUserModelId('com.codex.offworkradar');
}

app.whenReady().then(async () => {
  await writeSettings(await readSettings());
  createWindow();
  createTray();
  startReminderLoop();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  mainWindow?.show();
});
