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

### 方式一：PM2（推荐，无窗口）

```powershell
cd C:\Users\Administrator\WxWorkSchedule\server\dist
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 开机自启（需管理员权限运行一次）
```

### 方式二：VNC 桌面手动启动

窗口1（Bridge，必须在 VNC 桌面会话中启动）：
```cmd
C:\Python314\python.exe C:\Users\Administrator\WxWorkSchedule\server\pybridge\bridge.py
```

窗口2（Node）：
```cmd
C:\Users\Administrator\WxWorkSchedule\server\dist\start.bat
```

## 关键注意事项

### ⚠️ 数据文件（绝对不能覆盖！）

| 文件 | 路径 | 说明 |
|------|------|------|
| **数据库** | `server/db.json` | 联系人和定时任务，单文件存储 |
| **登录凭证** | `server/dist/.user` | 明文或 bcrypt，首次登录自动创建 |

### ⚠️ Windows 会话隔离

Bridge 必须在**微信所在的同一 Windows 会话**中启动，否则看不到微信窗口。
- **正确方式**：VNC 连接到桌面 → 在桌面会话中启动 bridge.py
- **SSH 启动的进程在 session 0**，看不到桌面会话（session 2）的微信窗口 → 状态显示"微信未运行"

### ⚠️ PM2 环境变量

`auth.js` 已内置 JWT_SECRET 兜底值，无需额外配置环境变量即可运行。

### ⚠️ .gitignore

`server/dist/` 目录在 `.gitignore` 中，**dist 文件不会被 git 跟踪**。部署时需手动同步或使用 `git add -f`。

**部署流程**：本地修改 → `git commit` → `git push` → `scp` 到远端 → PM2 restart

### ⚠️ 微信 4.1.x 兼容

wx4py fork 已修改为使用 comtypes `FindAll` 绕过微信 4.1 的 GetChildren 屏蔽。
- SPI 屏幕阅读器标志 + RunningState 注册表键由 bridge.py 自动维护
- `find_control()` 在 WeChat 4.x 上自动使用 FindAll 绕过

## 常用命令

```powershell
# PM2 管理
pm2 list                  # 查看进程状态
pm2 logs wx-schedule      # 查看日志
pm2 restart wx-schedule   # 重启后端

# 检查微信连接
curl http://localhost:39800/status   # Bridge 状态
curl http://localhost:3000/api/status  # Node（需 token）

# 手动触发微信恢复（关弹窗+点登录）
curl -X POST http://localhost:39800/recover
```

## 排查方向

1. **网页打不开** → 检查 `tasklist /fi "imagename eq node.exe"`，如无进程则 PM2 restart
2. **微信未连接** → Bridge 是否在桌面会话中运行？VNC 是否断开？
3. **数据丢失** → 检查 `server/db.json` 是否存在且有内容（正常约 220KB）
4. **密码错误** → 检查 `server/dist/.user` 文件，格式为 `{"用户名":"密码"}`
5. **API 返回 Unauthorized** → 刷新页面重新登录获取新 token

## Git 分支

- `fork4win`：当前活跃分支
- `main`：原始分支
- 仓库：`git@github.com:arthur20150522/WxWorkSchedule.git`
