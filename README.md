# WxWorkSchedule — 微信定时消息机器人

## 项目目录

```
WxSchedule/
├── client/                     # React + Vite 前端（构建输出到 client/dist/）
│   └── src/                    # TypeScript 源码
├── server/
│   ├── db.json                 # 【核心数据】单用户数据库（contacts/tasks/templates/logs）
│   ├── dist/                   # Node.js 后端（ESM 模块，生产环境直接运行）
│   │   ├── index.js            # 入口，端口 3000
│   │   ├── api.js              # 所有 HTTP API 路由
│   │   ├── auth.js             # 身份验证（JWT + .user 文件）
│   │   ├── dbManager.js        # 数据库读写（lowdb）
│   │   ├── botManager.js       # wx4py bridge 连接管理
│   │   ├── taskQueue.js        # 任务队列
│   │   ├── scheduler.js        # 定时调度
│   │   ├── wxBridge.js         # bridge HTTP 客户端
│   │   ├── ecosystem.config.cjs # PM2 配置
│   │   ├── start.bat           # 简易启动脚本
│   │   └── .user               # 【重要】登录凭证文件（JSON: {用户名: 密码或bcrypt}）
│   └── pybridge/               # Python 微信操作桥接
│       ├── bridge.py           # HTTP 服务（端口 39800），依赖 wx4py
│       └── requirements.txt    # Python 依赖
```

## 架构

```
浏览器 → Nginx(:80) → Node.js(:3000) → Python Bridge(:39800) → 微信桌面客户端
                              │
                         server/db.json（数据存储）
```

- **Node.js（HTTP 3000）**：提供前端页面和 REST API
- **Python Bridge（HTTP 39800）**：封装 wx4py，操作微信桌面客户端
- **数据**：单个 JSON 文件 `server/db.json`（单用户，非多用户体系）
- **微信**：必须与 Bridge 运行在**同一 Windows 会话**

## 启动方式

### 生产环境（PM2 管理全部进程）

两个进程均由 PM2 管理，从 VNC 桌面启动：

```powershell
cd C:\Users\Administrator\WxWorkSchedule\server\dist
pm2 start ecosystem.config.cjs   # 启动 wx-schedule (Node) + wx-bridge (Python)
pm2 save
```

| PM2 进程 | 类型 | 端口 | 说明 |
|----------|------|------|------|
| `wx-schedule` | Node.js | 3000 | 后端 API + 调度器 |
| `wx-bridge` | Python | 39800 | wx4py 微信操作桥接 |

> **注意**：PM2 必须在 VNC 桌面会话中启动（不能从 SSH 启动），否则 bridge 运行在 Session 0 无法看到微信窗口。

### 首次部署

```powershell
# 1. 克隆项目
git clone git@github.com:arthur20150522/WxWorkSchedule.git
cd WxWorkSchedule

# 2. 安装依赖
cd server && npm install && cd ..
pip install git+https://github.com/arthur20150522/wx4py.git

# 3. 配置 SSH Key（用于后续 git pull 拉取更新）
#    将本机 ~/.ssh/id_rsa 复制到服务器 C:\Users\Administrator\.ssh\id_rsa

# 4. 启动
cd server\dist
pm2 start ecosystem.config.cjs
pm2 save
```

## 关键注意事项

### ⚠️ 数据文件（绝对不能覆盖！）

| 文件 | 路径 | 说明 |
|------|------|------|
| **数据库** | `server/db.json` | 联系人和定时任务，单文件存储 |
| **登录凭证** | `server/dist/.user` | 明文或 bcrypt，首次登录自动创建 |

### ⚠️ Windows 会话隔离（最重要！）

Bridge 必须与微信在**同一 Windows 桌面会话**中运行，否则 UIA / EnumWindows 看不到微信窗口。

| 启动方式 | 会话 | 能否看到微信 |
|----------|------|:----------:|
| VNC 桌面启动 PM2 | Console (session 2) | ✅ |
| VNC 桌面直接启动 | Console (session 2) | ✅ |
| SSH 启动 | Session 0 | ❌ |
| 计划任务 | Session 0 | ❌ |

**正确操作**：VNC 连接 → 桌面开 PowerShell → 启动 PM2
- 断开 VNC 连接**不关窗口** → 进程仍在 session 2 运行
- 关闭/注销 VNC 会话 → 微信和 bridge 都会断

### ⚠️ PM2 环境变量

`auth.js` 已内置 JWT_SECRET 兜底值，无需额外配置环境变量即可运行。

### ⚠️ .gitignore

`server/dist/` 目录在 `.gitignore` 中，**dist 文件不会被 git 跟踪**。部署时需手动同步或使用 `git add -f`。

**部署流程**：本地修改 → `git commit` → `git push` → `scp` 到远端 → PM2 restart

### ⚠️ 微信 4.1.x 兼容

wx4py fork 已修改为使用 comtypes `FindAll` 绕过微信 4.1 的 GetChildren 屏蔽。
- SPI 屏幕阅读器标志 + RunningState 注册表键由 bridge.py 自动维护
- `find_control()` 在 WeChat 4.x 上自动使用 FindAll 绕过

## 部署流程

**所有代码变更必须通过 Git**，禁止 scp / 直接修改远程文件。

```
本地 → git add + commit → git push origin fork4win
远程 → git pull origin fork4win → npx tsc → pm2 restart wx-schedule wx-bridge
```

> 远程 git pull 需先配置 SSH key（复制本机 `~/.ssh/id_rsa` 到远程 `C:\Users\Administrator\.ssh\id_rsa`），然后用 SSH 协议：`git remote set-url origin git@github.com:arthur20150522/WxWorkSchedule.git`

### 修改 bridge.py 后
```powershell
git pull                    # 拉取最新 bridge.py
pm2 restart wx-bridge       # 仅重启 Python bridge（无需重编译 Node）
```

### 修改 Node 源码后
```powershell
git pull                    # 拉取最新 .ts 源码
cd server && npx tsc        # 重新编译 TypeScript
pm2 restart wx-schedule     # 重启 Node 后端
```

### wx4py Fork

项目使用自维护的 wx4py fork (`github.com/arthur20150522/wx4py`)，包含关键修复：

- **find_wechat_window()** — 支持新版微信 `WeChatAppEx.exe` 进程名和 Qt 类名窗口
- **FindAll 兼容** — 使用 `FindAll(TreeScope_Subtree)` 绕过微信 4.x 的 GetChildren 屏蔽
- **is_connected 修正** — 同时检查 `_hwnd is not None`，防止假连接状态

```powershell
# 安装/更新
pip install git+https://github.com/arthur20150522/wx4py.git --force-reinstall
pm2 restart wx-bridge
```

## 常用命令

```powershell
# PM2 管理
pm2 list                        # 查看进程状态（含 wx-schedule + wx-bridge）
pm2 logs wx-schedule            # 查看 Node 日志
pm2 logs wx-bridge              # 查看 Bridge 日志
pm2 restart wx-schedule         # 重启 Node 后端
pm2 restart wx-bridge           # 重启 Python Bridge

# 检查微信连接
curl http://localhost:39800/status       # Bridge 快速状态
curl http://localhost:39800/deep-health  # Bridge 深度检查（UIA 扫描）
curl http://localhost:3000/api/status    # Node API 状态（需 token）

# 手动触发微信恢复（关弹窗+点登录）
curl http://localhost:39800/recover         # 直接调 Bridge
curl -X POST /api/bridge/recover            # 通过 Node API（需 token，前端用）
```

## 排查方向

1. **网页打不开** → 检查 `pm2 list`，确认 `wx-schedule` 和 `wx-bridge` 都在线
2. **微信未连接（status: popup/login/not_running）** → 
   - 检查 VNC 桌面是否正常、微信是否在运行
   - `curl http://localhost:39800/deep-health` 查看具体状态
   - 如显示 popup/login，执行 `curl http://localhost:39800/recover` 尝试自动恢复
   - 新版微信进程名为 `WeChatAppEx.exe`（非 `WeChat.exe`），需用 wx4py fork 的 `find_wechat_window()` 检测
3. **bridge 状态 hwnd=0 但 connected=true** → wx4py 缓存了失效窗口句柄 → `pm2 restart wx-bridge` 重建连接
4. **数据丢失** → 检查 `server/db.json` 是否存在且有内容（正常约 220KB）。同时确认 PM2 日志中 `[DB] Initializing at` 路径指向 `server/db.json` 而非 `server/dist/db.json`
5. **密码错误** → 检查 `server/dist/.user` 文件，格式为 `{"用户名":"密码"}`
6. **API 返回 Unauthorized** → 刷新页面重新登录获取新 token
7. **git pull 失败 (HTTPS)** → 远程到 GitHub 443 端口可能被墙 → 改用 SSH 协议（需先配 SSH key）

## Git 分支

- `fork4win`：当前活跃分支
- `main`：原始分支
- 仓库：`git@github.com:arthur20150522/WxWorkSchedule.git`
