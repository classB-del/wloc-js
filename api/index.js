export const config = { runtime: 'edge' };

// ===== parse.js 内联开始 =====
// 坐标解析: 接受地图链接(苹果地图 / 高德, 含短链), 抠出经纬度+名称。
// 高德为 GCJ-02; 苹果地图在中国大陆同为 GCJ-02。两者都转 WGS84 再喂给 wloc;
// gcj02ToWgs84 内含 out_of_china 判断, 境外坐标原样返回(无操作)。

export function safeDecode(s) {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch (e) {
    return String(s);
  }
}

// 从一段字符串里提取经纬度+名称。兼容:
// 苹果地图 coordinate=/ll=/sll=纬度,经度 (名称在 name=...)
// 高德 ?p=POIID,纬度,经度,名称,城市 (逗号或 %2C)
// 高德 ?q=纬度,经度,名称 (新版分享链, 逗号或 %2C)
// 纯文本 纬度,经度
export function extractFromString(s) {
  if (!s) return null;
  const str = String(s);
  let m;
  m = str.match(/(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) {
    const nm = str.match(/[?&]name=([^&]+)/i);
    return { lat: +m[1], lon: +m[2], name: nm ? safeDecode(nm[1]) : "", src: "apple" };
  }
  m = str.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  m = str.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  m = str.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{4,})/);
  if (m) return { lat: +m[1], lon: +m[2], name: "", src: "text" };
  return null;
}

// 接受原文(可能含中文地名+链接), 抠出 URL, 必要时跟随重定向展开短链, 提取坐标。
export async function parseCoords(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  let target = urlMatch ? urlMatch[0] : text;

  let hit = extractFromString(target);
  if (hit) return hit;

  if (urlMatch) {
    let cur = target;
    for (let i = 0; i < 5; i++) {
      let resp;
      try {
        resp = await fetch(cur, {
          redirect: "manual",
          headers: {
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/24A5370h Safari/604.1",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh-Hans;q=0.9",
          },
        });
      } catch (e) {
        break;
      }
      const loc = resp.headers.get("location");
      if (loc) {
        hit = extractFromString(loc);
        if (hit) return hit;
        cur = new URL(loc, cur).toString();
        hit = extractFromString(cur);
        if (hit) return hit;
        continue;
      }
      hit = extractFromString(resp.url);
      if (hit) return hit;
      try {
        const body = await resp.text();
        hit = extractFromString(body);
        if (hit) return hit;
      } catch (e) {}
      break;
    }
  }
  throw new Error("未能从链接中解析出经纬度");
}

export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjOutOfChina(lng, la) {
  return lng < 72.004 || lng > 137.8347 || la < 0.8293 || la > 55.8271;
}

function gcjDeltaLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}

function gcjDeltaLon(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
}

// WGS84 -> GCJ-02 (正向偏移)
export function wgs84ToGcj02(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let dLat = gcjDeltaLat(lon - 105.0, lat - 35.0);
  let dLon = gcjDeltaLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

// GCJ-02 -> WGS84 (迭代反算, 亚米级)
export function gcj02ToWgs84(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 6; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    const errLat = g.lat - lat;
    const errLon = g.lon - lon;
    if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
    wgsLat -= errLat;
    wgsLon -= errLon;
  }
  return { lat: wgsLat, lon: wgsLon };
}

// ===== parse.js 内联结束 =====

function getPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0b0f19">
<title>WLOC 虚拟定位</title>
<link href="https://unpkg.com/maplibre-gl@4.0.0/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.0.0/dist/maplibre-gl.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary: #0b0f19;
  --bg-secondary: rgba(15, 23, 42, 0.92);
  --bg-card: rgba(30, 41, 59, 0.8);
  --border: rgba(148, 163, 184, 0.12);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent: #3b82f6;
  --accent-glow: rgba(59, 130, 246, 0.3);
  --accent-hover: #2563eb;
  --success: #22c55e;
  --success-bg: rgba(34, 197, 94, 0.12);
  --error: #ef4444;
  --error-bg: rgba(239, 68, 68, 0.12);
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.5);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

/* ===== 地图 ===== */
#map {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.maplibregl-ctrl-group {
  background: var(--bg-card) !important;
  backdrop-filter: blur(10px);
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm) !important;
  box-shadow: var(--shadow-md) !important;
}
.maplibregl-ctrl-group button {
  background: transparent !important;
  color: var(--text-primary) !important;
  border-color: var(--border) !important;
}
.maplibregl-ctrl-group button:hover {
  background: var(--accent) !important;
  color: #fff !important;
}
.maplibregl-ctrl-group button + button {
  border-top: 1px solid var(--border) !important;
}
.maplibregl-popup-content {
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 12px 16px;
}
.maplibregl-popup-tip {
  border-top-color: var(--bg-card) !important;
}

/* 自定义定位按钮 */
.locate-btn {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 500;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: all 0.2s ease;
}
.locate-btn:active {
  transform: scale(0.92);
  background: var(--accent);
}

/* ===== 底部面板 ===== */
.panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--bg-secondary);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-top: 1px solid var(--border);
  padding: 0 20px 24px;
  max-height: 62vh;
  overflow-y: auto;
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: 0 -8px 40px rgba(0,0,0,0.4);
}
.panel.collapsed {
  transform: translateY(calc(100% - 52px));
}

.panel-drag {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0 8px;
  cursor: pointer;
}
.drag-handle {
  width: 40px;
  height: 4px;
  background: var(--text-muted);
  border-radius: 2px;
  opacity: 0.5;
  transition: opacity 0.2s;
}
.panel-drag:hover .drag-handle {
  opacity: 0.8;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 4px;
}
.panel-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}
.panel-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

/* ===== 状态提示 ===== */
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 14px;
  opacity: 0;
  transform: translateY(-8px);
  transition: all 0.3s ease;
  pointer-events: none;
}
.status.show {
  opacity: 1;
  transform: translateY(0);
}
.status.success {
  background: var(--success-bg);
  color: var(--success);
  border: 1px solid rgba(34, 197, 94, 0.2);
}
.status.error {
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
}
.status-icon {
  font-size: 15px;
  flex-shrink: 0;
}

/* ===== 搜索框 ===== */
.search-box {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.search-box input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: all 0.2s;
}
.search-box input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.search-box input::placeholder {
  color: var(--text-muted);
}
.search-box button {
  padding: 12px 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px var(--accent-glow);
}
.search-box button:active {
  transform: scale(0.96);
  background: var(--accent-hover);
}

/* ===== 链接解析 ===== */
.link-parse {
  margin-bottom: 14px;
}
.link-parse input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  margin-bottom: 10px;
  transition: all 0.2s;
}
.link-parse input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.link-parse input::placeholder {
  color: var(--text-muted);
}

/* ===== 坐标显示 ===== */
.coords-display {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.coord-card {
  background: var(--bg-card);
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  transition: all 0.2s;
}
.coord-card:hover {
  border-color: var(--accent);
}
.coord-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.coord-value {
  font-size: 15px;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  letter-spacing: -0.3px;
}

/* ===== 按钮组 ===== */
.btn-group {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}
.btn {
  flex: 1;
  padding: 13px 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
.btn:active {
  transform: scale(0.96);
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 12px var(--accent-glow);
}
.btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 4px 16px var(--accent-glow);
}
.btn-secondary {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.btn-secondary:hover {
  background: rgba(148, 163, 184, 0.15);
  color: var(--text-primary);
}
.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
}
.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
}

/* ===== 收藏 ===== */
.favorites {
  margin-top: 4px;
}
.fav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 4px;
}
.fav-title {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 600;
}
.fav-count {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-card);
  padding: 2px 8px;
  border-radius: 10px;
}
.fav-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.fav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.2s ease;
}
.fav-item:hover {
  border-color: var(--accent);
  background: rgba(59, 130, 246, 0.08);
}
.fav-item.active {
  border-color: var(--accent);
  background: rgba(59, 130, 246, 0.12);
  box-shadow: 0 0 0 1px var(--accent-glow);
}
.fav-info {
  flex: 1;
  min-width: 0;
}
.fav-name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fav-coords {
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'SF Mono', monospace;
}
.fav-delete {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}
.fav-delete:hover {
  background: var(--error-bg);
  color: var(--error);
}

.fav-input-row {
  display: flex;
  gap: 10px;
}
.fav-input-row input {
  flex: 1;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: all 0.2s;
}
.fav-input-row input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.fav-input-row input::placeholder {
  color: var(--text-muted);
}
.fav-input-row .btn {
  flex: 0 0 auto;
  padding: 11px 18px;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 13px;
}
.empty-state-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.5;
}

/* 滚动条美化 */
.panel::-webkit-scrollbar {
  width: 4px;
}
.panel::-webkit-scrollbar-track {
  background: transparent;
}
.panel::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 2px;
}

/* 响应式 */
@media (min-width: 768px) {
  .panel {
    max-width: 480px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    border-radius: var(--radius-lg);
    bottom: 20px;
    max-height: 70vh;
  }
  .panel.collapsed {
    transform: translateX(-50%) translateY(calc(100% - 52px));
  }
}
</style>
</head>
<body>

<div id="map"></div>

<div class="locate-btn" onclick="locateMe()" title="定位到当前位置">📍</div>

<div class="panel" id="panel">
  <div class="panel-drag" onclick="togglePanel()">
    <div class="drag-handle"></div>
  </div>

  <div class="panel-header">
    <div>
      <div class="panel-title">WLOC 虚拟定位</div>
      <div class="panel-subtitle">修改 Apple 网络定位坐标</div>
    </div>
  </div>

  <div id="status" class="status">
    <span class="status-icon" id="statusIcon">✓</span>
    <span id="statusText"></span>
  </div>

  <div class="search-box">
    <input type="text" id="searchInput" placeholder="搜索地点（如：天安门）" onkeydown="if(event.key==='Enter')searchLocation()">
    <button onclick="searchLocation()">搜索</button>
  </div>

  <div class="link-parse">
    <input type="text" id="linkInput" placeholder="粘贴地图链接（苹果地图 / 高德 / 百度 / 坐标文本）" onkeydown="if(event.key==='Enter')parseLink()">
    <div class="btn-group">
      <button class="btn btn-secondary" onclick="parseLink()">🔗 解析链接</button>
      <button class="btn btn-secondary" onclick="clearLink()">清空</button>
    </div>
  </div>

  <div class="coords-display">
    <div class="coord-card">
      <div class="coord-label">纬度 Latitude</div>
      <div class="coord-value" id="lat">--</div>
    </div>
    <div class="coord-card">
      <div class="coord-label">经度 Longitude</div>
      <div class="coord-value" id="lon">--</div>
    </div>
  </div>

  <div class="btn-group">
    <button class="btn btn-primary" onclick="saveToDevice()">💾 储存到设备</button>
    <button class="btn btn-secondary" onclick="addFavorite()">⭐ 收藏</button>
    <button class="btn btn-danger" onclick="clearLocation()">🗑️ 清除</button>
  </div>

  <div class="favorites">
    <div class="fav-header">
      <span class="fav-title">📌 收藏位置</span>
      <span class="fav-count" id="favCount">0</span>
    </div>
    <div class="fav-list" id="favList"></div>
    <div class="fav-input-row">
      <input type="text" id="favName" placeholder="输入备注名称" maxlength="30">
      <button class="btn btn-secondary" onclick="addFavorite()">添加</button>
    </div>
  </div>
</div>

<script>
let map, marker, currentLat = 39.9042, currentLon = 116.4074;
let favorites = JSON.parse(localStorage.getItem('wloc_favorites') || '[]');
let savedCoords = JSON.parse(localStorage.getItem('wloc_settings') || 'null');
let isPanelCollapsed = false;

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [currentLon, currentLat],
    zoom: 13,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // 自定义标记
  const el = document.createElement('div');
  el.style.cssText = 'width:24px;height:24px;background:var(--accent);border:3px solid #fff;border-radius:50%;box-shadow:0 2px 12px var(--accent-glow);cursor:pointer;';

  marker = new maplibregl.Marker({ element: el, draggable: true })
    .setLngLat([currentLon, currentLat])
    .addTo(map);

  marker.on('dragend', () => {
    const pos = marker.getLngLat();
    updateCoords(pos.lat, pos.lng);
    showStatus('📍 已移动到 ' + pos.lat.toFixed(6) + ', ' + pos.lng.toFixed(6), 'success');
  });

  map.on('click', (e) => {
    marker.setLngLat(e.lngLat);
    updateCoords(e.lngLat.lat, e.lngLat.lng);
  });

  updateCoords(currentLat, currentLon);
  renderFavorites();
  updateFavCount();

  if (savedCoords && savedCoords.lat && savedCoords.lon) {
    showStatus('当前生效坐标: ' + savedCoords.lat.toFixed(6) + ', ' + savedCoords.lon.toFixed(6), 'success');
  }
}

function updateCoords(lat, lon) {
  currentLat = lat;
  currentLon = lon;
  document.getElementById('lat').textContent = lat.toFixed(6);
  document.getElementById('lon').textContent = lon.toFixed(6);
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');

  text.textContent = msg;
  el.className = 'status show ' + type;
  icon.textContent = type === 'success' ? '✓' : '✕';

  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.className = 'status';
  }, 3500);
}

async function searchLocation() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;

  const btn = document.querySelector('.search-box button');
  const originalText = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q));
    const data = await res.json();
    if (data && data.length > 0) {
      const latf = parseFloat(data[0].lat), lonf = parseFloat(data[0].lon);
      map.flyTo({ center: [lonf, latf], zoom: 16, speed: 1.2 });
      marker.setLngLat([lonf, latf]);
      updateCoords(latf, lonf);
      showStatus('已定位到: ' + data[0].display_name.split(',')[0], 'success');
    } else {
      showStatus('未找到该地点', 'error');
    }
  } catch (e) {
    showStatus('搜索失败: ' + e.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function parseLink() {
  const url = document.getElementById('linkInput').value.trim();
  if (!url) return;

  try {
    const res = await fetch('/api/parse?u=' + encodeURIComponent(url) + '&format=json');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    map.flyTo({ center: [data.lon, data.lat], zoom: 16, speed: 1.2 });
    marker.setLngLat([data.lon, data.lat]);
    updateCoords(data.lat, data.lon);
    showStatus('解析成功' + (data.name ? ': ' + data.name : ''), 'success');
  } catch (e) {
    showStatus('解析失败: ' + e.message, 'error');
  }
}

function clearLink() {
  document.getElementById('linkInput').value = '';
}

function locateMe() {
  if (!navigator.geolocation) {
    showStatus('浏览器不支持定位', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo({ center: [longitude, latitude], zoom: 15, speed: 1.2 });
      marker.setLngLat([longitude, latitude]);
      updateCoords(latitude, longitude);
      showStatus('已定位到当前位置', 'success');
    },
    (err) => {
      showStatus('定位失败: ' + err.message, 'error');
    }
  );
}

async function saveToDevice() {
  const btn = document.querySelector('.btn-group .btn-primary');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ 保存中...';
  btn.disabled = true;

  try {
    await fetch('https://gs-loc.apple.com/wloc-settings/save?lon=' + currentLon + '&lat=' + currentLat, {
      method: 'GET'
    });
    localStorage.setItem('wloc_settings', JSON.stringify({ lat: currentLat, lon: currentLon }));
    savedCoords = { lat: currentLat, lon: currentLon };
    showStatus('✓ 已储存到设备，重启后生效', 'success');
    renderFavorites();
  } catch (e) {
    showStatus('储存失败，请确认代理已开启', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function addFavorite() {
  const nameInput = document.getElementById('favName');
  const name = nameInput.value.trim() || '未命名';

  const exists = favorites.find(f => Math.abs(f.lat - currentLat) < 1e-6 && Math.abs(f.lon - currentLon) < 1e-6);
  if (exists) {
    showStatus('该位置已收藏', 'error');
    return;
  }

  favorites.unshift({ name, lat: currentLat, lon: currentLon, time: Date.now() });
  localStorage.setItem('wloc_favorites', JSON.stringify(favorites));
  nameInput.value = '';
  renderFavorites();
  updateFavCount();
  showStatus('已收藏: ' + name, 'success');
}

function removeFavorite(idx) {
  favorites.splice(idx, 1);
  localStorage.setItem('wloc_favorites', JSON.stringify(favorites));
  renderFavorites();
  updateFavCount();
}

function useFavorite(fav) {
  map.flyTo({ center: [fav.lon, fav.lat], zoom: 16, speed: 1.2 });
  marker.setLngLat([fav.lon, fav.lat]);
  updateCoords(fav.lat, fav.lon);
  showStatus('已切换到: ' + fav.name, 'success');
}

function renderFavorites() {
  const list = document.getElementById('favList');
  if (favorites.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📍</div>暂无收藏位置<br>选好位置后点击「收藏」添加</div>';
    return;
  }

  list.innerHTML = favorites.map((f, i) => {
    const isActive = savedCoords && Math.abs(savedCoords.lat - f.lat) < 1e-6 && Math.abs(savedCoords.lon - f.lon) < 1e-6;
    return '<div class="fav-item ' + (isActive ? 'active' : '') + '" onclick="useFavorite(favorites[' + i + '])">' +
      '<div class="fav-info"><div class="fav-name">' + (isActive ? '✓ ' : '') + escapeHtml(f.name) + '</div>' +
      '<div class="fav-coords">' + f.lat.toFixed(6) + ', ' + f.lon.toFixed(6) + '</div></div>' +
      '<span class="fav-delete" onclick="event.stopPropagation();removeFavorite(' + i + ')">×</span></div>';
  }).join('');
}

function updateFavCount() {
  document.getElementById('favCount').textContent = favorites.length;
}

function clearLocation() {
  localStorage.removeItem('wloc_settings');
  savedCoords = null;
  renderFavorites();
  showStatus('已清除，请重启设备恢复真实定位', 'success');
}

function togglePanel() {
  const panel = document.getElementById('panel');
  isPanelCollapsed = !isPanelCollapsed;
  panel.classList.toggle('collapsed', isPanelCollapsed);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 面板拖拽展开/收起
let startY = 0;
const panel = document.getElementById('panel');

panel.addEventListener('touchstart', (e) => {
  startY = e.touches[0].clientY;
}, { passive: true });

panel.addEventListener('touchmove', (e) => {
  const deltaY = e.touches[0].clientY - startY;
  if (Math.abs(deltaY) > 10) e.preventDefault();
}, { passive: false });

panel.addEventListener('touchend', (e) => {
  const deltaY = e.changedTouches[0].clientY - startY;
  if (deltaY > 60 && !isPanelCollapsed) togglePanel();
  else if (deltaY < -60 && isPanelCollapsed) togglePanel();
}, { passive: true });

initMap();
</script>
</body>
</html>`;
}
