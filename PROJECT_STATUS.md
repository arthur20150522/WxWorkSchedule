---
name: project-status
description: WxSchedule 项目状态 — 每步都有时间戳的操作日志
metadata:
  type: project
---

# WxSchedule 项目状态

分支: `fork4win` | 数据: `server/db.json` | 启动: `start.bat`

---

## 总体进度

| 阶段 | 完成时间 | 状态 |
|------|----------|:--:|
| 后端核心改造 | 2026-05-30 | ✅ |
| 前端改造 | 2026-05-30 | ✅ |
| 启动/部署工具 | 2026-05-30 | ✅ |
| 安全加固 | 2026-05-30 | ✅ |
| 集成验证 | 2026-06-02 | ✅ |
| 部署上线 | 2026-06-02 | ✅ |

---

## 2026-05-30 操作日志

### 14:00 ~ 15:00 — 后端改造

- **14:00** 重写 `server/src/types.ts` — 新增 Contact / 修改 Task (targetName 替代 targetId) / 新增 Data (contacts+tasks+templates+logs) / 新增 BotStatus / 删除 UserConfig
- **14:10** 重写 `server/src/dbManager.ts` — 单文件 DB (server/db.json) + 四表 + migrateFromLegacy() 从旧 users/ 目录合并 + 启动恢复 stuck processing 任务
- **14:20** 新建 `server/src/auth.ts` — 单管理员模式 / .user 读 UserConfig / generateInitialPassword() 首次自动生成明文密码打印到 console / verifyPassword() 明文自动迁移 bcrypt / generateToken() JWT 7天 / verifyToken()
- **14:25** 简化 `server/src/authMiddleware.ts` — 纯 token 验证，去多用户 req.user 上下文
- **14:30** 精简 `server/src/botManager.ts` — 删除 roomCache/contactCache/cacheTimestamp/缓存预热/Wechaty 兼容层/ensureBot/backward-compat helpers，只保留 init()/restart()/getStatus()
- **14:35** 重写 `server/src/scheduler.ts` — 单 DB 扫描 pending + scheduleTime<=now，按时间排序后入队
- **14:40** 重写 `server/src/taskQueue.ts` — 全局单例 TaskQueue / add()去重 / process()串行 / executeTask() 失败重试1次间隔2s / calculateNextTime(): daily/weekly/monthly/interval / 随机间隔 5~10s / currentTarget+lastError 暴露状态
- **14:50** 重写 `server/src/api.ts` — 登录路由去硬编码 admin / 通讯录 CRUD (GET/POST/PUT/DELETE /api/contacts) / 扫描辅助 GET /api/contacts/scan / status 返回 taskStats+queueLength+currentTarget+lastError / 全量导入导出
- **15:00** 重写 `server/src/index.ts` — 启动流程: initDB() → BotManager.init() → 静态文件 serve → listen() → startScheduler()
- **15:05** 删除 `server/src/userManager.ts`, `server/src/mockBot.ts`, `server/test/smoke.ts`
- **15:10** 清理 `server/package.json` — 移除 node-schedule, better-sqlite3 及对应 @types
- **15:10** Server `tsc --noEmit` 编译通过 ✅

### 15:00 ~ 16:00 — 前端改造

- **15:15** 重写 `client/src/types/index.ts` — Contact / Task(targetName) / Template(targets 简化为 {name,type}) / 新增 TaskStats(含 overduePending) / BotStatus(含 taskStats)
- **15:20** 重写 `client/src/utils/i18n.ts` — 删 scanQr/serverIP/loginDuration/waitingForScan 等废弃文案 / 新增通讯录/队列/任务大盘/逾期/导入导出文案
- **15:25** 重写 `client/src/components/Login.tsx` — 去 localStorage 记住密码 / 修复 axios 导入 / 加 loading 状态旋转图标 / 加 AlertCircle 红色行内错误提示框(区分401/500/网络错误) / 底部提示 admin 默认账号
- **15:30** 新建 `client/src/views/ContactsView.tsx` — 通讯录列表/添加编辑弹窗/扫描弹窗(search→复选框→添加到通讯录)/删除确认/群组蓝色人像图标+联系人绿色图标
- **15:35** 重写 `client/src/views/DashboardView.tsx` — Bot 在线状态 + 队列状态(队列待发/正在发送/最近错误) + 任务大盘 9 格(全部/一次/每天/每周/每月/间隔/待执行/已过期/失败) + 过期>0 橙色预警
- **15:40** 重写 `client/src/views/TasksView.tsx` — 通讯录联系人复选框多选 + 手动输入目标名+类型 / 群蓝badge+人绿badge / 模板下拉自动带入关联对象 / 批量删除
- **15:45** 重写 `client/src/views/TemplatesView.tsx` — 关联对象改为通讯录复选框 / 全量导入导出按钮(服务端 API) / 时间 badge 显示 uiTime / 模板卡片优化
- **15:50** 重写 `client/src/components/Sidebar.tsx` — 群组→通讯录(BookUser 图标) / 删除调试模式按钮和 Bug 图标 / 删除 showDebug 相关 props
- **15:55** 重写 `client/src/App.tsx` — 删除 DebugConsole/LoginDuration/服务器IP 引用 / 新增 ContactsView + contacts state + fetchContacts / TabId 改为 'contacts' / handleLoginSuccess 去 remember 参数 / 删除 GroupsView 相关
- **16:00** 删除 `client/src/views/GroupsView.tsx`, `client/src/components/DebugConsole.tsx`, `client/src/components/LoginDuration.tsx`, `client/src/hooks/useDebugLogs.ts`
- **16:00** 更新 `client/src/index.css` — Tailwind v3 `@tailwind base/components/utilities` → v4 `@import "tailwindcss"`
- **16:05** 新建 `client/postcss.config.mjs` — Tailwind v4 PostCSS 插件配置
- **16:05** Client `tsc --noEmit` 编译通过 ✅

### 16:00 ~ 17:00 — 配置与启动脚本

- **16:10** 新建 `start.bat` — 菜单驱动 / 安装依赖(server+client+wx4py) / 启动全部(最小化) / 停止(按端口杀) / 状态检查 / 环境诊断
- **16:15** 创建 `server/.env` — PORT=3000 + JWT_SECRET
- **16:20** **BUG** start.bat UTF-8 编码导致中文乱码 → 重写为纯英文脚本
- **16:25** **BUG** stop all 杀不掉 → 从窗口标题匹配改为 netstat+端口杀 → 仍有问题 → 改为 PowerShell Get-NetTCPConnection → 把自己也杀了 → 改回 taskkill /FI WINDOWTITLE eq WxSvcXxx 精确标题匹配
- **16:35** **BUG** start.bat 窗口标题用 "Bridge*" 通配符 + taskkill /FI 不生效 → start 用精确标题 "WxSvcBridge/Server/Front" + taskkill 用 eq 精确匹配
- **16:40** 窗口改为 `/MIN` 最小化后台启动

### 17:00 ~ 18:00 — 迭代修复

- **17:00** **BUG** Login.tsx axios 用 `await import('axios')` 动态导入可能静默失败 → 改为顶部 `import axios from 'axios'`
- **17:05** **BUG** 登录无错误提示 → 加行内 AlertCircle 红色错误框，区分 401/500/网络错误
- **17:10** **BUG** auth.ts 用户名写死 admin → 改为任意 username:password UserConfig 字典 / verifyPassword 接收 username 参数 / generateToken 接收 username / 登录路由删除 `if (username !== 'admin')`
- **17:15** **BUG** 首次密码存 bcrypt hash 看不到明文 → generateInitialPassword() 改为存明文 + console 大字打印
- **17:20** **BUG** server/.user 旧数据 wxadmin/asdf2234 导致登录 401 → 覆盖为 admin/admin123
- **17:25** **BUG** 队列状态只显示数字无 ETA → 加 etaSeconds → 用户反馈 3 秒轮询不实时无意义 → 改为任务大盘(按重复类型统计)
- **17:30** 新增 overduePending 统计 → 大盘 9 格含"已过期"卡片
- **17:35** 模板关联对象选了但任务页不带入 → TasksView 选模板时自动 setSelectedTargets
- **17:40** 任务列表缺少群/人标识 → 桌面表+移动卡片分别加蓝色"群"/绿色"人" badge

### 18:00 ~ 19:00 — 安全与数据

- **18:00** **逾期熔断** scheduler.ts — overdue > MAX_TASK_DELAY_MINUTES(默认30分钟)自动 markFailed，不发送。解决微信断联后消息堆积爆炸问题
- **18:10** 队列 5+ 个过期任务同时入队时写 warn 日志
- **18:15** 系统日志格式统一 — Task xxx【目标名称】操作结果
- **18:20** **全量导入导出** — GET /api/data/export (返回 contacts+templates+tasks) + POST /api/data/import (合并模式，同 id 跳过)
- **18:25** TemplatesView 导入导出按钮改为调服务端 API → 一个 JSON 文件包含全部数据
- **18:30** **旧数据迁移** — 读取 `F:\Downloadza\旧版任务db.json` → 提取 9 个模板 → 生成 `import_templates.json`
- **18:35** 模板卡片加 uiTime 青色 badge 显示时间

### 19:00 — 文档

- **19:00** 创建 `PROJECT_STATUS.md` — 每步带时间戳的操作日志
- **19:15** 重写 `CLAUDE.md` — 新增操作日志规则(每次修改后追记PROJECT_STATUS.md) / 更新架构描述(单文件DB+全局队列+逾期熔断) / 新增关键禁止项 / API速查表更新 / 保留 tsc --noEmit 编译检查方式
- **19:30** `server/src/dbManager.ts` — 分析旧 db.json 910KB (28,000+条日志占 900KB)，加 MAX_LOG_ENTRIES=500 上限，initDB 启动裁剪 + addLog 实时裁剪，防止 lowdb 全量序列化性能退化

---

## 2026-06-02 操作日志

### 21:30 ~ 22:00 — 远程部署排障

- **21:30** **BUG** 远程 `39.106.127.176` 实时发送失败，定时任务正常 → SSH 排查 PM2 日志发现 `Bridge HTTP 400: target and message required` → dist/api.js 是旧版多用户架构编译产物，req.body 解构 `target`/`message`，前端发的是 `targetName`/`content` → 字段不匹配 → bridge 收到空值
- **21:35** **根因** 源文件 api.ts 已更新为 `targetName`/`content`，但 dist/ 未重新编译，PM2 仍在运行旧代码。定时任务不受影响(走 TaskQueue 绕过 API 路由)
- **21:40** **修复** `npx tsc` 重新编译 → `pm2 restart wx-schedule` → 实时发送恢复正常 ✅
- **21:45** **BUG** 修复后数据"丢失" → PM2 日志显示 `[DB] Initializing at server/dist/db.json` → 新编译代码在 dist/ 下初始化了空库(711B)，真实数据在 server/db.json(224KB)
- **21:48** **根因** `dbManager.ts:9` 用 `path.resolve(process.cwd(), 'db.json')` → PM2 cwd = `server/dist/` → 路径指向 dist/db.json 而非 server/db.json
- **21:50** **修复** 改为 `import.meta.url` + `__dirname` + `'..'` 定位 → `path.resolve(__dirname, '..', 'db.json')` — 始终指向 server/db.json，不受 cwd 影响
- **21:55** 远程重新编译 + PM2 restart → DB 路径正确指向 server/db.json ✅ → 数据恢复
- **22:00** 远程 git commit `9b418a6` + 本地 git commit `02d438d` — fix: DB path use import.meta.url instead of process.cwd()
- **22:30** **BUG** Dashboard "尝试登录"按钮报 404 → 前端调 `POST /api/bridge/recover`，Node API 缺少该路由 → bridge.py 有 `/recover` 端点但未代理
- **22:35** **修复** `wxBridge.ts` 新增 `recover()` 方法 → `api.ts` 新增 `POST /bridge/recover` 路由 → CLAUDE.md 新增部署流程规则(git only, 禁止 scp) → git push → 远程 git pull + tsc + pm2 restart
- **23:55** **feat** `pushNotify.ts` 统一推送 — 新增 Server酱 (安卓微信) 与原有 ChuckFang (鸿蒙) 并行推送，`Promise.allSettled` 双通道互不阻塞

### 关键教训

1. **源码更新后必须重新编译 `npx tsc`** — dist/ 不在 git 跟踪中，PM2 从 dist/ 加载，源文件和编译产物可能不同步
2. **不要用 `process.cwd()` 定位数据文件** — PM2/直接 node/ts-node 的 cwd 各不相同，应用 `import.meta.url` + `__dirname` 相对定位
3. **PM2 环境变量中 `cwd`/`PWD` 决定 process.cwd()** — `pm2 env 0` 可查看

---

## 当前数据

`server/db.json`:
- contacts: 3 (测试任务群1, 小号测试任务, ChatGpt测试群)
- templates: 2 (喝水提示测试, 泡脚提示)
- tasks: 2 (daily 14:30 → 测试任务群1 + ChatGpt测试群)

`import_templates.json` (待导入):
- 9 个旧模板 (早安07:00/喝水10:00/午餐11:00/喝水14:00/下午茶15:00/晚餐17:00/晚安22:00/晚安专业22:00/泡脚21:30)

`server/.user`: `{ "admin": "admin123" }`

---

## 架构决策

1. **单文件 DB**: `server/db.json` 替代 `server/users/<user>/db.json`
2. **全局单队列**: TaskQueue 严格串行，每任务随机 5~10s 间隔，失败重试 1 次
3. **逾期熔断**: overdue > 30min 自动 skipped，env `MAX_TASK_DELAY_MINUTES` 可调
4. **通讯录**: 手动管理 + wxBridge.search 扫描辅助
5. **发送**: task.targetName → wxBridge.send(targetName, content, targetType)
6. **认证**: 任意 username + 明文→bcrypt 自动迁移 + JWT 7d
7. **导入导出**: GET/POST /api/data/{export,import}，一个 JSON
8. **DB 路径**: `import.meta.url` + `__dirname` + `..` 定位，不依赖 `process.cwd()`
9. **wx4py fork**: `pip install git+https://github.com/arthur20150522/wx4py.git`，禁止 PyPI 原版
10. **代码部署铁律**: 所有变更必须通过 git push/pull，严禁 scp 或直接修改远程文件
11. **SSH 部署别名**: `ssh wxserver` → 39.106.127.176

---

## 2026-08-06 操作日志

### 17:00 ~ 18:10 — wx4py fork 修复 + 完整部署

- **17:00** **发现** 服务器 wx4py 是原版 claw-codes/wx4py 0.2.1，非我们的 fork
- **17:05** **发现** 本地 wx4py editable install 源目录已被清理 → 重装 fork
- **17:10** **验证** fork 核心改动 `core/win32.py` `find_wechat_window()`：weixin.exe +100, WeChatAppEx.exe -200
- **17:15** **澄清** README 的 FindAll 绕过在 bridge.py 独立实现，不依赖 wx4py 包
- **17:20** 本地测试：wx4py fork 连接微信 → 搜索 Alex → 发送 ✅
- **17:25** **修复 SSH**：服务器需 `HostKeyAlgorithms=+ssh-rsa` → 更新 `~/.ssh/config` 添加 `Host wxserver`
- **17:30** 修改 `start.bat` + `remote_deploy.ps1`：wx4py 安装指向 fork
- **17:40** `git push` → 服务器 `git pull` + `pip install fork` (21min/10KBps) + `tsc` + `pm2 restart all` ✅
- **17:55** 发现服务器 Node v16.20.2 过旧(包需 Node 18+)，编译仍通过
- **18:05** `/unified-push` 推送部署结果到鸿蒙 + 安卓 ✅

### 关键教训

4. **bridge.py 的 FindAll 是独立魔改** — 直接用 comtypes UIA API
5. **服务器 pip 极慢 (10KB/s)** — 建议预下载 wheel 或使用国内镜像
6. **服务器 SSH 需 `ssh-rsa`** — 已配置别名

---

## 2026-08-10 操作日志

### — 掉线二维码截图推送

- **需求** 微信被踢出登录（"为了你的账号安全，请重新登录"）时，自动点掉弹窗 → 点"进入微信" → 若出现二维码登录窗口 → 截图 → 推送到手机
- **排查结论** 现有 `try_auto_recover()` 已会点"我知道了"+"进入微信"，缺 QR 截图+推送；MeoW（api.chuckfang.com，文档确认支持 `msgType=html` 内联 `<img>`）和 Server酱 Turbo（desp markdown 外链图，**不支持 base64**）推图片都必须先办公网 URL
- **feat** `server/src/qrRelay.ts` 新建 — `POST /api/qr-notify`（bridge 本地上传 base64 截图，`QR_PUSH_SECRET` 校验，随机 32hex token 存 `server/data/qr/`，10min 自动删，新图覆盖旧图）+ `GET /api/qr/:file`（免鉴权出图，token 即凭证）→ 复用 pushNotify 双通道推送
- **feat** `server/src/pushNotify.ts` — pushNotify 增加可选 imageUrl 参数：MeoW 走 POST `msgType=html&htmlHeight=480` + `<img>` + `url` 跳转；Server酱 desp 追加 `![二维码](url)` + 纯链接兜底
- **feat** `server/pybridge/bridge.py` — 新增 `_capture_window_png()`（GDI BitBlt 截窗口区域，需 Pillow）+ `push_qr_screenshot()`（读 `../.env` 取密钥和端口，POST 127.0.0.1:3000/api/qr-notify，15min 推送冷却）；两个触发点：①点完"进入微信"等主界面 8s 超时 ②UIA 找不到登录按钮（二维码窗口已在显示）
- **config** `server/.env` 新增 `QR_PUSH_SECRET`（随机 48hex）+ `PUBLIC_BASE_URL=https://wechat.eastpolar.top`；`.gitignore` 加 `server/data/qr/`；`requirements.txt` 加 Pillow；api.ts bodyParser limit 提升 10mb
- **验证** server `tsc --noEmit` ✅ / bridge.py `py_compile` ✅（1252 行 SyntaxWarning 为既有代码，未动）
- **注意** ⚠️ `.env` 不进 git — 服务器部署时需手动在远程 `server/.env` 补同样的 `QR_PUSH_SECRET` + `PUBLIC_BASE_URL`，否则 bridge 上传会被 403

### — 部署 + 真实掉线事件端到端验证

- **部署** commit `c876772` push → 远程 pull → 远程 `.env` 补 QR_PUSH_SECRET/PUBLIC_BASE_URL → Pillow 已有(12.3.0) → `npx tsc` → pm2 restart wx-schedule + wx-bridge ✅
- **BUG（证据归因修复）** 触发 /recover 后 bridge 日志零输出 → 前台 ssh 复现发现会话隔离（ssh 看不到 GUI 窗口）→ 改查 bridge 自带端点：`/dump-uia` 显示当前窗口 36 个 UIA 节点（登录页 27 + 弹窗 9）→ **根因**：`_is_main_window` 用 `>30 节点` 启发式，登录页+弹窗叠加 36>30 误判为"主界面" → Step 1 快速跳过静默 return，恢复流程从不执行
- **修复** commit `11b4bae`：①`_is_main_window` 先排除登录标记（LoginWindow 类/我知道了/进入微信/登录/切换账号/仅传输文件）再数节点 ②`find_wechat_window` 导入提到函数顶部（Step 0 白屏检查在 wx4py 断开路径必 NameError 失效）③无登录按钮分支推 QR 前检查主界面标记（搜索/ChatInputField）防误推
- **端到端验证 ✅（真实掉线场景）**：/recover → 自动点"我知道了"(959,552) → 检测到二维码窗口 → GDI 截图 12KB → 上传 → 双通道推送成功（`[Push:鸿蒙] (with image)` + `[Push:安卓]`）→ 公网 URL `HTTP 200 image/png` → 下载目检确认是清晰可扫的"扫码登录"二维码
- **后续行为**：二维码 ~2min 过期；recover 每 5min 巡检，QR 推送冷却 15min — 用户不扫码则每 15min 推一次新截图直到登录恢复
- **闭环确认** 用户扫码后 deep-health 返回 `ok / 正常 — 主界面已就绪` ✅ 全链路真实验证完成

---

## 2026-08-13 操作日志

### 16:00 — 掉线通知改版：静态截图推送 → 实时二维码页面（一次通知，不再轰炸）

- **背景** 老板反馈"一直收到推送"：①QR 截图推送每 15min 一条直到扫码（冷却在 bridge 进程内存，重启即清零）②HealthMonitor 恢复推送无冷却 ③掉线→自动重登→再掉线振荡时成对轰炸。且静态截图会过期，手机收到的图可能已失效
- **方案** 掉线后 bridge 持续截图上传（4s/帧）→ Node 托管 HTML 实时页面轮询刷新 → 掉线通知只推一次（30min 冷却）指向页面；微信恢复即销毁页面
- **feat** `server/src/qrRelay.ts` 重写 — `POST /api/qr/live`（帧上传，secret 校验，覆盖写 `live-<token>.png`）+ `POST /api/qr/clear`（恢复即撤销）+ `GET /api/qr/view/:token`（移动端自适应 HTML，JS 每 4s 轮询刷新，>110s 无更新提示过期）+ `GET /api/qr/live/:token.png` + 5min 无帧自动过期清理 + 导出 `getQrViewUrl()`；删除旧 `/api/qr-notify` 单次截图接口；token 即凭证（32hex），重启/clear 后旧 URL 全失效
- **feat** `server/src/botManager.ts` — 掉线通知加 `KICK_PUSH_COOLDOWN_MS=30min` 冷却 + 文案带实时页面链接；**删除"微信已恢复"推送**（一次掉线通知足够，页面随帧停止自动失效）
- **feat** `server/pybridge/bridge.py` — 删 `push_qr_screenshot()`，新增 `_qr_upload_frame()` / `_qr_stream_worker()` / `start_qr_stream()` / `stop_qr_stream()`（4s/帧截图上传，stop 时 POST /api/qr/clear）；触发点：①UIA 找不到登录按钮（二维码已显示）②点完"进入微信"8s 无主界面；停止点：Step 1 健康跳过 + Step 5 主窗口出现
- **验证** server `tsc --noEmit` ✅ / bridge.py `py_compile` ✅（SyntaxWarning 为既有代码）
- **调整** ①截图频率 4s → **30s**（二维码 ~2min 刷新一次，30s 帧足够且省资源）②`registerQrRoutes` 加**启动清理**——Node 每次启动先清空 `data/qr/` 残留（进程重启后旧 token 文件不可达，避免服务器硬盘堆积）
- **磁盘占用**：帧上传是**覆盖写**（磁盘恒为 1 个文件 ~12KB）；删除时机：微信恢复（`/api/qr/clear` 立即删）、5min 无帧自动过期、Node 重启清空 — 三保险
- **注意** 部署后 `.env` 无需改动（复用既有 QR_PUSH_SECRET）；新页面 URL 形如 `https://wechat.eastpolar.top/api/qr/view/<32hex>`

### 15:47 — 🔥 修复：部署重启复活历史任务（旧数据迁移缺少一次性标记）

- **事故** 老板反馈"重新部署又把历史任务拉进来了"——微信群里被 6 月旧任务（凌阿姨/大萝卜/罗小姐营养私教等）刷屏"喝水打卡/下午茶"
- **证据** 远程 pm2 日志三次重启均出现 `[DB] Detected legacy users/ directory, migrating...`（31/31/28 tasks）→ 6 月旧任务被反复导入 → 调度器把超期周期任务推进到"今天"的时段直接发送
- **根因** `server/src/dbManager.ts` 的 `migrateFromLegacy()` 没有一次性标记——`legacyMigrated` 修复已写好但**一直未提交推送**，远程跑的是旧代码，每次 pm2 重启都重新导入 `users/*/db.json`
- **修复** commit `c68fa7a`：`legacyMigrated` 标记在两条路径都落库（无 legacy 目录时 + 迁移成功后，先设标记再 `db.write()`）；`types.ts` 加 `legacyMigrated?: boolean`
- **远程清理** `pm2 stop` → 备份 `server/db.json.bak-20260813` → 删除 3 条复活任务（1780138233678/1780138233800/1780175729730，助理提示群+白龙的 6 月旧版重复任务）→ db.json 写入 `legacyMigrated: true` → pull c68fa7a + tsc + pm2 restart
- **验证** 重启日志无 migration 行、无 overdue 推进刷屏、调度器正常 ✅；db.json 剩 16 条任务全部为当前任务 ✅
- **遗留** ①远程 `server/users_legacy_backup/`（已改名，代码只查 `users`，且标记已设——双重保险不会再导入，可手动删除）②`initDB` 里 `processing → pending` 崩溃恢复逻辑：若消息已发出但状态未落库，重启后可能重发一次（本次事故无关，属已知残余风险）
- **教训** ⚠️ 本地写完修复必须 commit + push 才算数，否则"已修复"的 bug 会在下次部署时再次爆发

---

## 2026-08-17 操作日志

### — QR live 页图片 404 修复

- **事故** 老板点击推送链接后二维码不显示（"无权限"观感）——live 页框架能开但图永远加载失败
- **证据** 公网实测：view 页 200 / 图片 404；页面源码 `imgBase='/api/qr/live/'+token+'.png'`
- **根因** `qrRelay.ts` 图片路由：URL 路径段已含 `live`，`:file` 参数实为 `<token>.png`（不带前缀），但代码拿它跟磁盘名 `live-<token>.png` 比较且 sendFile 直接用参数值 → 永远 404。第一次修复（84ed3d7）误把正则改成要求 `live-` 前缀，属误诊
- **修复** commit `af4659f`：参数正则 `^([a-f0-9]{32})\.png$` 提取 token 与 liveToken 比对，sendFile 拼 `live-${token}.png`；顺带 `/view` 过期/无效 token 返回友好 HTML"链接已失效"页替代空白 404
- **验证** 重启后新会话：view 页 200 ✅ / live 图 200（11984B）✅ / 下载目检为清晰"扫码登录"二维码 ✅
- **鸿蒙 MeoW 推送故障（已自愈）** 当日约半天 `[Push:鸿蒙] Error: Unexpected token <`（接口返回 HTML 错误页）连续失败 ×10；同日稍后双侧（本地+服务器）实测恢复 200 → 属 MeoW 服务端临时故障，未改代码。同期安卓 Server酱 正常（"微信掉线"通知 ×4 成功）。用户扫码后 deep-health 恢复 `ok / 主界面已就绪` ✅
- **自我批评** 第一次修复犯了模式匹配错误（看到正则就改正则），没先追 URL 构造链路；证据归因法对自家代码同样适用

---

## 2026-09-02 操作日志

### — 掉线推送链接"已失效"修复 + 恢复点击即时触发

- **现象** 手机打开掉线推送的二维码链接显示"链接已失效（超过 5 分钟无刷新）"，而远端微信卡在"为了你的账号安全，请重新登录"弹窗
- **根因** ①推送早于二维码：`getQrViewUrl()` 在掉线推送瞬间就生成 token，但帧要等恢复自动化点掉"我知道了"+"进入微信"后才有 ②`qrRelay` sweep 的 `liveLastUpdate` 初始为 0，一帧未到时第一次 60s 扫描就判死会话 → 唯一推送的链接必死 ③deep-health 探测到 popup/login 不触发恢复（原注释"交给 5 分钟循环"），叠加循环 5min 间隔 + 10min 冷却，弹窗可滞留 15 分钟
- **修复** ①`bridge.py _handle_deep_health`：popup/login 即后台线程触发 `try_auto_recover`（10min 冷却 + 恢复锁保留防轰炸）②`qrRelay.ts` sweep 加 `liveLastUpdate &&`：零帧会话永不过期，推送链接持续有效，二维码上屏后同一 token 直接可用；dist 同步手改
- **验证** bridge.py `py_compile` ✅ / dist `node --check` ✅（远程 tsc 会重新生成 dist）
- **效果** 掉线 → ≤5min 健康检查 → 同一时刻推链接 + 点进入微信 → 二维码推流进同一 token，手机旧链接刷新即见码
- **部署** f3bc51f push → 远端 pull + tsc + pm2 restart ✅；**补齐丢失的环境开关** `ALLOW_WECHAT_AUTO_RECOVERY=true`（旧进程一直打印 "auto-recovery disabled" —— 弹窗卡死的总根因：历次 pm2 重启时环境变量丢失）+ `pm2 save` 持久化
- **端到端实测** 11:14:10 五分钟循环触发 → wx4py 连上登录窗(HWND=60031498) → 自动点击"我知道了" → 二维码推流启动 → 帧上传成功（11963B，目检为可扫"扫码登录"码）✅；本轮掉线新链接：`https://wechat.eastpolar.top/api/qr/view/2fde659523134c9805994a8ed6d0baf7`
- **排查插曲** ①ssh 会话看不到 GUI（会话隔离），手动 DEBUG 复现会误报"未找到微信窗口"，一切以 pm2 进程内日志为准 ②py-spy（已装）确认线程健康，前期"线程卡死"判断系时间线误读 ③"进入微信"按钮 UIA 未找到，但弹窗点掉后微信直接停在二维码窗口，无需再点

---

## 待办

| P | 任务 |
|:--|------|
| 0 | ~~启动验证: start.bat→登录→扫描→创建任务→确认发送~~ ✅ 2026-06-02 |
| 1 | ~~部署 39.106.127.176~~ ✅ 2026-06-02 / 域名 wechat.eastpolar.top |
| 2 | 导入 9 个旧模板 + 每个配置目标群 |
| 3 | 全链路验证: 通讯录/定时/周期任务/断开恢复 |
