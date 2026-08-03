# WLOC 虚拟定位 - Vercel 部署版

原项目 [Yu9191/wloc](https://github.com/Yu9191/wloc) 的 Vercel 适配版本。

## 功能

- 🗺️ 在线地图选点（Leaflet + OpenStreetMap，无需 API Key）
- 🔗 地图链接解析（苹果地图 / 高德 / 百度 / 坐标文本）
- 🔄 GCJ-02 ↔ WGS84 坐标自动转换
- ⭐ 收藏位置（浏览器 localStorage）
- 💾 储存到设备（通过代理拦截 gs-loc.apple.com）

## 部署步骤

### 方式一：Vercel CLI（推荐）

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 进入项目目录并部署
cd wloc-vercel
vercel --prod
```

### 方式二：Git 部署

1. 将本目录推送到 GitHub
2. 在 [Vercel Dashboard](https://vercel.com/dashboard) 点击 **Add New Project**
3. 导入 GitHub 仓库
4. 框架预设选择 **Other**
5. 点击 **Deploy**

## 使用方法

1. 部署成功后获得域名，如 `https://wloc-xxxx.vercel.app`
2. 在代理工具中订阅 wloc 模块并开启 MITM
3. 将模块中的选点页面地址替换为你的 Vercel 域名
4. 打开选点页面 → 地图选位置 → 点击「储存到设备」
5. **重启 iOS 设备**（iOS 26+ 必须重启才能清除定位缓存）

## 快捷指令修改

将快捷指令中的 Worker 地址替换为你的 Vercel 域名：

```
# 原地址
https://wloc-spoofer.wloc.workers.dev/api/parse

# 替换为
https://你的域名.vercel.app/api/parse
```

## 文件结构

```
wloc-vercel/
├── api/
│   └── index.js      # 单文件 Edge Function（含选点页面 + 坐标解析）
├── package.json      # 依赖
├── vercel.json       # Vercel 路由配置
└── README.md         # 说明文档
```

## 注意事项

- 需要 MITM 证书信任 `gs-loc.apple.com` 和 `gs-loc-cn.apple.com`
- 仅修改网络定位（WiFi/基站），不影响 GPS 硬件定位
- iOS 26+ 需要重启设备才能生效
- Vercel Hobby 版有每日函数调用次数限制，个人使用足够
- 地图使用 OpenStreetMap，国内访问可能需要代理

## License

与原项目一致。
