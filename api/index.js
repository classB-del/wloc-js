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

// 简单的路由处理
export default async function handler(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS 头
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  // API: 地图链接解析
  if (pathname === "/api/parse") {
    const raw = url.searchParams.get("u") || "";
    const cs = (url.searchParams.get("cs") || "").toLowerCase();
    const fmt = (url.searchParams.get("format") || "").toLowerCase();
    try {
      let { lat, lon, name, src } = await parseCoords(raw);
      const needConv = cs === "gcj" || (cs !== "none" && (src === "amap" || src === "apple"));
      if (needConv) ({ lat, lon } = gcj02ToWgs84(lat, lon));
      lat = round6(lat);
      lon = round6(lon);
      name = name || "";
      if (fmt === "json") {
        return new Response(JSON.stringify({ lat, lon, name }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(`lat=${lat}&lon=${lon}`, {
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // 首页: 选点页面
  return new Response(getPageHtml(), {
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
  });
}

function getPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>WLOC 虚拟定位</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; overflow: hidden; }
#map { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
.panel { position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(20px); border-radius: 20px 20px 0 0; padding: 16px; max-height: 55vh; overflow-y: auto; transition: transform 0.3s; }
.panel.collapsed { transform: translateY(calc(100% - 50px)); }
.panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; cursor: pointer; }
.panel-title { font-size: 16px; font-weight: 600; color: #fff; }
.panel-toggle { width: 36px; height: 4px; background: #334155; border-radius: 2px; margin: 0 auto 12px; }
.search-box { display: flex; gap: 8px; margin-bottom: 12px; }
.search-box input { flex: 1; padding: 10px 14px; border: 1px solid #334155; border-radius: 10px; background: #1e293b; color: #e2e8f0; font-size: 14px; outline: none; }
.search-box input::placeholder { color: #64748b; }
.search-box button { padding: 10px 16px; border: none; border-radius: 10px; background: #3b82f6; color: #fff; font-size: 14px; cursor: pointer; }
.coords-display { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.coord-item { background: #1e293b; padding: 10px 12px; border-radius: 10px; }
.coord-label { font-size: 11px; color: #64748b; margin-bottom: 2px; }
.coord-value { font-size: 14px; color: #fff; font-family: monospace; }
.btn-group { display: flex; gap: 8px; margin-bottom: 12px; }
.btn { flex: 1; padding: 12px; border: none; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
.btn:active { opacity: 0.8; }
.btn-primary { background: #3b82f6; color: #fff; }
.btn-secondary { background: #334155; color: #e2e8f0; }
.btn-danger { background: #ef4444; color: #fff; }
.link-parse { margin-bottom: 12px; }
.link-parse input { width: 100%; padding: 10px 14px; border: 1px solid #334155; border-radius: 10px; background: #1e293b; color: #e2e8f0; font-size: 14px; margin-bottom: 8px; outline: none; }
.favorites { margin-top: 12px; }
.fav-title { font-size: 13px; color: #64748b; margin-bottom: 8px; }
.fav-list { display: flex; flex-direction: column; gap: 6px; }
.fav-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #1e293b; border-radius: 10px; cursor: pointer; }
.fav-item.active { border: 1px solid #3b82f6; }
.fav-name { font-size: 14px; color: #e2e8f0; }
.fav-coords { font-size: 11px; color: #64748b; font-family: monospace; }
.fav-delete { color: #ef4444; font-size: 18px; padding: 0 8px; cursor: pointer; }
.fav-input { display: flex; gap: 8px; margin-top: 8px; }
.fav-input input { flex: 1; padding: 8px 12px; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #e2e8f0; font-size: 14px; outline: none; }
.status { text-align: center; padding: 8px; border-radius: 8px; font-size: 13px; margin-bottom: 10px; display: none; }
.status.show { display: block; }
.status.success { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status.error { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.leaflet-popup-content-wrapper { background: #1e293b; color: #e2e8f0; border-radius: 12px; }
.leaflet-popup-tip { background: #1e293b; }
</style>
</head>
<body>
<div id="map"></div>

<div class="panel" id="panel">
  <div class="panel-toggle" onclick="togglePanel()"></div>
  <div class="panel-header" onclick="togglePanel()">
    <span class="panel-title">📍 WLOC 虚拟定位</span>
    <span style="font-size:12px;color:#64748b">点击收起/展开</span>
  </div>

  <div id="status" class="status"></div>

  <div class="search-box">
    <input type="text" id="searchInput" placeholder="搜索地点（如：天安门）" onkeydown="if(event.key==='Enter')searchLocation()">
    <button onclick="searchLocation()">搜索</button>
  </div>

  <div class="link-parse">
    <input type="text" id="linkInput" placeholder="粘贴地图链接（苹果地图/高德/百度/坐标文本）" onkeydown="if(event.key==='Enter')parseLink()">
    <div class="btn-group">
      <button class="btn btn-secondary" onclick="parseLink()">解析链接</button>
      <button class="btn btn-secondary" onclick="clearLink()">清空</button>
    </div>
  </div>

  <div class="coords-display">
    <div class="coord-item">
      <div class="coord-label">纬度 (Latitude)</div>
      <div class="coord-value" id="lat">--</div>
    </div>
    <div class="coord-item">
      <div class="coord-label">经度 (Longitude)</div>
      <div class="coord-value" id="lon">--</div>
    </div>
  </div>

  <div class="btn-group">
    <button class="btn btn-primary" onclick="saveToDevice()">💾 储存到设备</button>
    <button class="btn btn-secondary" onclick="addFavorite()">⭐ 收藏位置</button>
    <button class="btn btn-danger" onclick="clearLocation()">🗑️ 清除位置</button>
  </div>

  <div class="favorites">
    <div class="fav-title">📌 收藏位置 (localStorage)</div>
    <div class="fav-list" id="favList"></div>
    <div class="fav-input">
      <input type="text" id="favName" placeholder="输入备注名称" maxlength="30">
      <button class="btn btn-secondary" onclick="addFavorite()" style="flex:0 0 auto">添加</button>
    </div>
  </div>
</div>

<script>
let map, marker, currentLat = 39.9042, currentLon = 116.4074;
let favorites = JSON.parse(localStorage.getItem('wloc_favorites') || '[]');
let savedCoords = JSON.parse(localStorage.getItem('wloc_settings') || 'null');

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([currentLat, currentLon], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  marker = L.marker([currentLat, currentLon], { draggable: true }).addTo(map);
  marker.on('dragend', function(e) {
    const pos = e.target.getLatLng();
    updateCoords(pos.lat, pos.lng);
  });

  map.on('click', function(e) {
    marker.setLatLng(e.latlng);
    updateCoords(e.latlng.lat, e.latlng.lng);
  });

  updateCoords(currentLat, currentLon);
  renderFavorites();

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
  el.textContent = msg;
  el.className = 'status show ' + type;
  setTimeout(() => el.className = 'status', 3000);
}

async function searchLocation() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q));
    const data = await res.json();
    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      const latf = parseFloat(lat), lonf = parseFloat(lon);
      map.setView([latf, lonf], 16);
      marker.setLatLng([latf, lonf]);
      updateCoords(latf, lonf);
      showStatus('已定位到: ' + data[0].display_name.split(',')[0], 'success');
    } else {
      showStatus('未找到该地点', 'error');
    }
  } catch (e) {
    showStatus('搜索失败: ' + e.message, 'error');
  }
}

async function parseLink() {
  const url = document.getElementById('linkInput').value.trim();
  if (!url) return;
  try {
    const res = await fetch('/api/parse?u=' + encodeURIComponent(url) + '&format=json');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    map.setView([data.lat, data.lon], 16);
    marker.setLatLng([data.lat, data.lon]);
    updateCoords(data.lat, data.lon);
    showStatus('解析成功: ' + (data.name || ''), 'success');
  } catch (e) {
    showStatus('解析失败: ' + e.message, 'error');
  }
}

function clearLink() {
  document.getElementById('linkInput').value = '';
}

async function saveToDevice() {
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
  }
}

function addFavorite() {
  const name = document.getElementById('favName').value.trim() || '未命名';
  const exists = favorites.find(f => Math.abs(f.lat - currentLat) < 1e-6 && Math.abs(f.lon - currentLon) < 1e-6);
  if (exists) {
    showStatus('该位置已收藏', 'error');
    return;
  }
  favorites.push({ name, lat: currentLat, lon: currentLon, time: Date.now() });
  localStorage.setItem('wloc_favorites', JSON.stringify(favorites));
  document.getElementById('favName').value = '';
  renderFavorites();
  showStatus('已收藏: ' + name, 'success');
}

function removeFavorite(idx) {
  favorites.splice(idx, 1);
  localStorage.setItem('wloc_favorites', JSON.stringify(favorites));
  renderFavorites();
}

function useFavorite(fav) {
  map.setView([fav.lat, fav.lon], 16);
  marker.setLatLng([fav.lat, fav.lon]);
  updateCoords(fav.lat, fav.lon);
}

function renderFavorites() {
  const list = document.getElementById('favList');
  if (favorites.length === 0) {
    list.innerHTML = '<div style="color:#64748b;font-size:13px;text-align:center;padding:10px">暂无收藏</div>';
    return;
  }
  list.innerHTML = favorites.map((f, i) => {
    const isActive = savedCoords && Math.abs(savedCoords.lat - f.lat) < 1e-6 && Math.abs(savedCoords.lon - f.lon) < 1e-6;
    return '<div class="fav-item ' + (isActive ? 'active' : '') + '" onclick="useFavorite(favorites[' + i + '])">' +
      '<div><div class="fav-name">' + (isActive ? '✓ ' : '') + escapeHtml(f.name) + '</div>' +
      '<div class="fav-coords">' + f.lat.toFixed(6) + ', ' + f.lon.toFixed(6) + '</div></div>' +
      '<span class="fav-delete" onclick="event.stopPropagation();removeFavorite(' + i + ')">×</span></div>';
  }).join('');
}

function clearLocation() {
  localStorage.removeItem('wloc_settings');
  savedCoords = null;
  renderFavorites();
  showStatus('已清除，请重启设备恢复真实定位', 'success');
}

function togglePanel() {
  document.getElementById('panel').classList.toggle('collapsed');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

initMap();
</script>
</body>
</html>`;
}
