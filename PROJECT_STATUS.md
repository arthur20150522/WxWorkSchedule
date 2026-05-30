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
| 集成验证 | — | ❌ |
| 部署上线 | — | ❌ |

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

---

## 待办

| P | 任务 |
|:--|------|
| 0 | 启动验证: start.bat→登录→扫描→创建任务→确认发送 |
| 1 | 导入 9 个旧模板 + 每个配置目标群 |
| 2 | 全链路验证: 通讯录/定时/周期任务/断开恢复 |
| 3 | 部署 43.153.88.215 |
| 4 | 更新 CLAUDE.md + README.md |
