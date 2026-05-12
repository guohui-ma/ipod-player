# iPod Music Player — Docker 部署文档

## 前置要求

- ECS 主机已安装 **Docker** (≥ 20.10) 与 **Docker Compose** (≥ v2)
- 音乐文件已上传至服务器的某个目录，如 `/data/music`
- ECS 安全组已放行端口 `3001`（或后续 Nginx 反代端口）

```bash
# 安装 Docker（Alibaba Cloud Linux / CentOS）
sudo yum install -y docker
sudo systemctl enable docker && sudo systemctl start docker

# 安装 Docker Compose 插件
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/libexec/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/libexec/docker/cli-plugins/docker-compose
```

---

## 1. 项目文件准备

在 ECS 上创建项目目录并上传以下文件：

```
~/ipod-player/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── server.js
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

```bash
# 在 ECS 上
mkdir -p ~/ipod-player/public
# 将本地文件上传（在本地执行）
scp -r public/ server.js package.json package-lock.json Dockerfile docker-compose.yml \
  root@<你的ECS公网IP>:~/ipod-player/
```

---

## 2. 修改 docker-compose.yml

编辑 `~/ipod-player/docker-compose.yml`，将音乐目录替换为实际路径：

```yaml
services:
  ipod-player:
    build: .
    container_name: ipod-player
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - MUSIC_ROOT=/music
    volumes:
      # ↓ 替换为你的音乐文件实际路径
      - /data/music:/music:ro
      - ipod-config:/home/app
    restart: unless-stopped

volumes:
  ipod-config:
```

如需挂载多个音乐目录，可使用多个卷映射配合子路径，或直接在应用内添加远程音乐源。

---

## 3. 构建与启动

```bash
cd ~/ipod-player

# 构建镜像
docker compose build

# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f
```

启动后访问 `http://<ECS公网IP>:3001`。

---

## 4. 配置 Nginx 反向代理（推荐）

安装 Nginx 并添加 HTTPS（Let's Encrypt），同时隐藏端口号：

```bash
sudo yum install -y nginx certbot python3-certbot-nginx
```

创建配置文件 `/etc/nginx/conf.d/ipod-player.conf`：

```nginx
server {
    listen 80;
    server_name music.your-domain.com;   # 替换为你的域名

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 流媒体支持
        proxy_buffering off;
        client_max_body_size 0;
    }
}
```

申请证书并重载 Nginx：

```bash
sudo certbot --nginx -d music.your-domain.com
sudo systemctl reload nginx
```

随后即可通过 `https://music.your-domain.com` 访问。

---

## 5. 安全组配置

在阿里云 ECS 控制台 → 安全组 → 入方向规则，放行：

| 端口 | 来源 | 用途 |
|------|------|------|
| 3001 | 0.0.0.0/0 | 直连访问（测试用） |
| 80   | 0.0.0.0/0 | HTTP → HTTPS 跳转 |
| 443  | 0.0.0.0/0 | HTTPS 访问 |

正式使用后可移除 3001 端口规则，仅保留 80/443。

---

## 6. 日常运维

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f ipod-player

# 重启应用
docker compose restart

# 更新代码后重建
docker compose up -d --build

# 停止应用
docker compose down
```

---

## 7. 数据持久化说明

| 数据 | 存储方式 | 说明 |
|------|---------|------|
| 音乐文件 | 主机目录 `/data/music`（只读挂载） | 容器内只读，安全 |
| 音乐源配置 | Docker volume `ipod-config` | 路径 `/home/app/.music-player-sources.json` |

---

## 8. 故障排查

**应用无法启动**
```bash
docker compose logs ipod-player
```

**找不到音乐文件**
- 确认 `MUSIC_ROOT` 环境变量指向容器内路径（如 `/music`）
- 确认主机目录已正确挂载：`docker compose exec ipod-player ls /music`

**端口被占用**
```bash
# 修改 docker-compose.yml 中的宿主机端口
ports:
  - "3002:3001"   # 将 3001 改为其他端口
```

**SMB/SSHFS 远程挂载不支持**
- Docker 容器默认不支持 FUSE 文件系统挂载
- 如需远程音乐源，在宿主机上先挂载再以卷形式传入容器，或使用 `privileged: true`（不推荐）
