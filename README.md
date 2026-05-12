# iPod Music Player

iPod Classic 风格的 Web 音乐播放器，支持服务端音乐库和客户端本地文件播放。

## 快速开始

### 环境要求

- **Node.js** ≥ 18（推荐 20 LTS）
- **npm** ≥ 9

```bash
# 检查版本
node -v   # v20.x
npm -v    # 10.x
```

### 服务端模式

```bash
# 1. 克隆项目
git clone https://github.com/guohui-ma/ipod-player.git
cd ipod-player

# 2. 安装依赖
npm install

# 3. 启动服务
npm start
```

访问 `http://localhost:3001`。

**自定义端口和音乐目录：**

```bash
PORT=8080 MUSIC_ROOT=/path/to/music npm start
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `3001` | 服务监听端口 |
| `MUSIC_ROOT` | `~/Music` | 默认音乐根目录 |

**依赖说明：**

| 包 | 用途 |
|---|------|
| `express` | HTTP 服务、静态文件、API 路由 |
| `music-metadata` | 服务端音频元数据解析（标签、封面、歌词） |

`npm install` 还会安装一个可选的 `music-metadata-browser`，用于客户端本地文件模式的 CDN 引用，服务端不使用。

### 客户端模式（无需 Node.js）

直接用浏览器打开静态文件：

```bash
# macOS
open public/index.html

# 或用 npx 起一个静态服务
npx serve public
# → http://localhost:3000
```

点击 Settings →「Open Local Folder」选择本地音乐目录即可播放。该模式完全在浏览器中运行，不依赖服务端。

## 功能

- **经典 iPod 外观**：360×720 竖屏，点击右下方按钮切换 720×360 横屏
- **Click Wheel 操作**：转盘按钮控制播放/暂停、上/下一曲、菜单切换
- **频谱可视化**：32 柱实时频谱动画
- **LRC 歌词**：支持嵌入标签和同名 `.lrc` 文件，随时间滚动
- **专辑封面**：从音频文件元数据提取
- **音乐源管理**：本地目录、SMB/WebDAV 远程挂载
- **歌曲搜索**：关键词搜索，分页浏览
- **播放模式**：顺序 / 随机 / 单曲循环
- **客户端本地播放**：无需服务端，浏览器直接读取本地文件（Chrome/Edge 支持目录持久化授权）
- **键盘快捷键**：`Space` 播放/暂停，`← →` 上下曲，`L` 切换横屏

## 支持格式

MP3 / FLAC / WAV / OGG / M4A / AAC / WMA / AIFF / APE / Opus / MP4 / WebM

## 项目结构

```
├── server.js              # Express 服务端（API、文件流）
├── public/
│   ├── index.html         # 播放器 UI
│   ├── app.js             # 客户端逻辑
│   └── style.css          # 样式
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker Compose 部署
├── DEPLOY.md              # ECS 部署文档
└── README.md              # 本文件
```

## Docker 部署

```bash
docker compose up -d
# → http://localhost:4000
```

详细步骤见 [DEPLOY.md](./DEPLOY.md)。
