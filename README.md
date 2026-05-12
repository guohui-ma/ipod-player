# iPod Music Player

iPod Classic 风格的 Web 音乐播放器，支持服务端音乐库和客户端本地文件播放。

## 快速开始

### 服务端模式

```bash
# 安装依赖
npm install

# 启动服务
npm start
# → http://localhost:3001
```

服务启动后自动扫描 `~/Music` 目录。可通过环境变量 `MUSIC_ROOT` 指定其他路径：

```bash
MUSIC_ROOT=/path/to/music npm start
```

在 Settings 中可添加多个音乐源目录。

### 客户端模式（无需服务端）

直接用浏览器打开 `public/index.html`：

```bash
open public/index.html   # macOS
```

或在项目目录下用任意静态文件服务器：

```bash
npx serve public
# → http://localhost:3000
```

点击 Settings →「Open Local Folder」选择本地音乐目录即可播放。

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
# → http://localhost:3001
```

详细步骤见 [DEPLOY.md](./DEPLOY.md)。
