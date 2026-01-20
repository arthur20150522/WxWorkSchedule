# WxSchedule（微信机器人定时发送管理系统）

一个基于 Wechaty 的微信机器人 + Web 管理后台，用于扫码登录、管理群组/联系人，并创建“定时/周期性”自动发送任务。

## 功能概览

- 多用户/多账号管理
  - 支持多用户配置（`server/.user`）
  - 每个用户拥有独立的微信机器人实例、任务数据、日志和 Session 持久化
  - 微信扫码状态与用户绑定，持久化存储，重启不丢失登录态
- 机器人状态面板
  - offline / waiting_for_scan / logged_in
  - 展示当前登录微信用户、数据同步状态（ready）
  - 展示扫码二维码（dataURL）
  - 重启机器人/刷新二维码
- 群组管理
  - 拉取群列表、显示成员数
  - 搜索群
  - 从群一键跳转到任务创建并预填目标群
- 联系人支持
  - 拉取好友联系人列表
  - 创建任务时可选联系人为目标
- 定时任务管理
  - 创建任务：目标（群/联系人）、消息类型（文本/图片/文件）、周期（一次/每天/每周/每月/每隔多久）
  - 任务列表：按状态过滤（pending/success/failed）、删除任务
  - 调度执行：每 10 秒扫描到期任务并执行；周期任务自动推算下一次执行时间
- 系统日志
  - 查看最近 100 条 info/error 日志
  - 前端在日志页轮询刷新

## 技术栈

- Client：React + TypeScript + Vite + TailwindCSS（axios + JWT 鉴权）
- Server：Node.js + TypeScript + Express + Wechaty + lowdb（多租户数据隔离）

## 目录结构

- client：管理后台前端（Vite）
- server：后端服务
  - src/api.ts：REST API
  - src/botManager.ts：多实例 Bot 管理器
  - src/dbManager.ts：多租户 DB 管理器
  - src/userManager.ts：用户配置与认证
  - src/scheduler.ts：多用户定时任务扫描
  - users/：存放各用户数据（自动生成，已在 .gitignore 中忽略）
    - `<username>/db.json`：任务数据
    - `<username>/bot.memory-card.json`：微信登录 Session
  - .user：用户账号配置文件（已在 .gitignore 中忽略）

## 快速开始

### 1) 配置用户

在 `server` 目录下创建或修改 `.user` 文件（JSON 格式）来配置登录账号：

```json
{
  "admin": "admin123",
  "user2": "password456"
}
```

默认会自动创建一个 `admin: admin123` 的配置。

### 2) 启动后端

```bash
cd server
npm install
npm run dev
```

默认监听：`http://localhost:3000`

### 3) 启动前端

```bash
cd client
npm install
npm run dev
```

默认访问：`http://localhost:5173`

前端已配置 `/api -> http://localhost:3000` 代理。

## 配置

### JWT Secret

建议在 `server/.env` 中配置 JWT 密钥以增强安全性：

```env
JWT_SECRET=your_super_secure_secret_key
```

### 用户账号

如上所述，修改 `server/.user` 文件。该文件包含敏感密码信息，**请勿提交到版本控制系统**（已默认忽略）。

## 使用说明（管理后台）

1. 打开前端页面，输入用户名（如 `admin`）和密码登录
2. 登录后，系统会自动为该用户初始化微信机器人实例
3. 在“概览”页查看机器人状态
   - 若显示“等待扫码”，使用微信扫码登录
   - 登录成功后，Session 会自动持久化到 `server/users/<username>/bot.memory-card.json`
   - 下次重启服务或刷新页面，无需再次扫码（只要 Session 未过期）
4. 在“群组管理”页搜索群并点击“发送消息”
5. 在“任务管理”页创建定时任务
6. 在“系统日志”页查看运行日志

## 部署到远程服务器

项目提供了部署脚本 `deploy.ps1` 和 Nginx 示例配置 `nginx.conf.example`。

### 1) 前置条件

- 本地环境已安装 `ssh` 和 `scp`（Windows 通常已内置）。
- 拥有目标服务器的 SSH 访问权限。
- 目标服务器已安装 `node` (v18+), `npm`, `pm2`, `nginx`。

### 2) 部署步骤

1. 修改 `deploy.ps1` 中的配置：
   ```powershell
   $SERVER_IP = "43.153.88.215"
   $REMOTE_DIR = "/www/wwwroot/WxWork"
   $USER = "root"
   ```
2. 在本地 PowerShell 中运行部署脚本：
   ```powershell
   .\deploy.ps1
   ```
   该脚本会自动：
   - 在本地构建前端 (`client/dist`) 和后端 (`server/dist`)
   - 将构建产物上传到服务器
   - 在服务器上安装依赖并使用 PM2 启动服务

### 3) 配置 Nginx

参考 `nginx.conf.example` 配置服务器 Nginx，以反向代理 API 并服务静态文件：

```nginx
server {
    listen 80;
    server_name your_domain_or_ip;
    root /www/wwwroot/WxWork/client;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        ...
    }
}
```

## 数据存储

- 所有数据按用户名隔离存储在 `server/users/<username>/` 目录下。
- 敏感数据（Session、任务内容）均在此目录，请妥善备份但不要上传到公开仓库。

## API 速查

### 认证

- `POST /api/login`：用户登录（body: `{ username, password }`），返回 JWT Token
- `POST /api/logout`：用户退出

### 机器人（需携带 Bearer Token）

- `GET /api/status`：获取当前用户机器人状态
- `GET /api/qr`：获取扫码二维码
- `POST /api/bot/restart`：重启当前用户的机器人

### 群组/联系人（需携带 Bearer Token）

- `GET /api/groups`：获取群列表
- `GET /api/contacts`：获取联系人列表

### 任务（需携带 Bearer Token）

- `GET /api/tasks`：获取任务列表
- `POST /api/tasks`：创建任务
- `DELETE /api/tasks/:id`：删除任务

### 日志（需携带 Bearer Token）

- `GET /api/logs`：获取最近 100 条日志

## 已知限制与注意事项

- Wechaty Web 协议/UOS 存在风控风险：频繁登录/使用 Web 协议可能导致账号被限制登录，建议用小号测试。
- 调度扫描周期为 10 秒：任务触发时间存在最多约 10 秒的延迟。
- 多实例资源消耗：每个登录用户都会启动一个 Wechaty (Puppeteer) 实例，用户数较多时请注意服务器内存消耗。

