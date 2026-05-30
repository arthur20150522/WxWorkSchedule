# WxSchedule wx4py 重构实施计划

> 日期: 2026-05-30 | 共 4 阶段 28 项任务
> 每项完成后可独立提交，后续可基于每项补充单元测试

---

## 阶段一：后端核心改造（12 项）

### 1.1 数据模型与类型定义

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.1 | 更新 `types.ts`：新增 Contact 接口，修改 Task.targetName，删除 UserConfig | `server/src/types.ts` | 类型编译检查 |
| 1.2 | 重写 `dbManager.ts`：单文件 DB，支持 contacts/tasks/templates/logs 四表，含数据迁移逻辑（从旧多用户目录合并） | `server/src/dbManager.ts` | `initDB()` 空库初始化；`migrateFromLegacy()` 旧数据合并 |

### 1.2 认证简化

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.3 | 重写认证：删除 `userManager.ts`，登录逻辑内联；单管理员模式，首次启动自动生成密码 | `server/src/auth.ts` (新建) | `verifyPassword()` bcrypt 比对；`generateInitialPassword()` 输出格式 |
| 1.4 | 简化 `authMiddleware.ts`：移除多用户上下文，只验证 token 有效性 | `server/src/authMiddleware.ts` | `verifyToken()` 有效/过期/伪造三种 case |

### 1.3 通讯录管理

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.5 | 通讯录 CRUD 路由：`GET/POST/PUT/DELETE /api/contacts` | `server/src/api.ts` | 增删改查各一个 case |
| 1.6 | 扫描辅助路由：`GET /api/contacts/scan?q=` 调用 bridge.search | `server/src/api.ts` | 返回格式校验 |

### 1.4 调度与队列

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.7 | 重写 `scheduler.ts`：单 DB 扫描，去重排队，仅 pending 且到期任务 | `server/src/scheduler.ts` | `scanDueTasks()` 到期/未到期/processing 三种过滤；`uniqueEnqueue()` 去重 |
| 1.8 | 重写 `taskQueue.ts`：全局单队列，严格串行，5~10s 随机间隔，失败重试 1 次，周期任务自动重算 | `server/src/taskQueue.ts` | `executeTask()` 成功/失败/重试；`calculateNextTime()` daily/weekly/monthly/interval；`randomDelay()` 范围校验 |

### 1.5 Bot 管理器精简

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.9 | 精简 `botManager.ts`：删除 roomCache/contactCache/缓存预热/Wechaty 兼容层，保留 bot 生命周期（init/shutdown/restart/status） | `server/src/botManager.ts` | `getStatus()` online/offline；`restartBot()` 状态变化 |

### 1.6 Bridge 与 API

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.10 | 精简 `api.ts`：删除群组/联系人查询路由，删除二维码路由，删除多用户相关路由，更新 status 接口返回队列信息 | `server/src/api.ts` | 各 route handler 的正向/异常返回 |
| 1.11 | 更新 `index.ts` 启动流程：新 DB 初始化 → Bot 初始化 → 调度器启动 → 静态文件 serve | `server/src/index.ts` | 启动顺序正确性 |

### 1.7 清理

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 1.12 | 删除无效文件：`userManager.ts`、`mockBot.ts`、`smoke.ts`、`server/users/` 目录 | 删除操作 | 确认编译通过 |

**阶段一完成标准**：`npm run build` 通过，后端可启动，API 返回格式正确。

---

## 阶段二：前端改造（9 项）

### 2.1 类型与状态对齐

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 2.1 | 更新前端类型定义：Contact、Task（targetName）、Template（targets 简化）、BotStatus（含队列信息） | `client/src/types/index.ts` | TypeScript 编译 |
| 2.2 | 更新 i18n 字典：新增通讯录相关文案，删除无用文案（二维码、服务器IP、记住密码等） | `client/src/utils/i18n.ts` | 文案完整性 |

### 2.2 页面改造

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 2.3 | 登录页精简：去掉"记住密码"，极简布局 | `client/src/components/Login.tsx` | 视觉检查 |
| 2.4 | 通讯录页（原群组管理改造）：列表展示 + 添加/编辑弹窗 + 删除确认 + "尝试扫描"按钮 → 扫描弹窗 | `client/src/views/GroupsView.tsx` → 重命名为 `ContactsView.tsx` | 增删改操作；扫描弹窗交互 |
| 2.5 | 概览页改造：Bot 状态 + 队列长度 + 当前发送目标 + 最近错误 | `client/src/views/DashboardView.tsx` | 状态轮询刷新；队列信息展示 |
| 2.6 | 任务管理页改造：目标从通讯录下拉选择 + 支持手动输入临时名称 | `client/src/views/TasksView.tsx` | 下拉数据加载；手动输入 fallback |
| 2.7 | 模板管理页改造：目标字段改为通讯录下拉 | `client/src/views/TemplatesView.tsx` | 下拉数据加载 |

### 2.3 导航与布局

| # | 任务 | 涉及文件 | 可测试点 |
|---|------|---------|---------|
| 2.8 | 侧边栏更新：群组→通讯录，删除调试模式开关 | `client/src/components/Sidebar.tsx` | 导航跳转正确 |
| 2.9 | 清理组件：删除 `DebugConsole.tsx`、`LoginDuration.tsx`，`App.tsx` 移除对应引用 | `client/src/components/DebugConsole.tsx`、`LoginDuration.tsx`、`client/src/App.tsx` | 编译通过，无报错 |

**阶段二完成标准**：`npm run build` 通过，前端 6 个页面均可正常渲染。

---

## 阶段三：集成验证（4 项）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|---------|---------|
| 3.1 | 通讯录 → 发送全链路：添加联系人 → 创建即时任务 → 观察队列执行 → 确认微信实际发送 | 全链路 | 手动验证 |
| 3.2 | 定时任务端到端：创建 1 分钟后执行的定时任务 → 等待调度 → 确认执行 | 全链路 | 手动验证 |
| 3.3 | 周期任务端到端：创建每隔 2 分钟的周期任务 → 观察多次执行 → 确认周期正常 | 全链路 | 手动验证 |
| 3.4 | 异常场景：Bridge 断开时创建任务 → 重启 Bridge → 确认任务恢复执行 | 全链路 | 手动验证 |

**阶段三完成标准**：4 个端到端场景均通过。

---

## 阶段四：清理与文档（3 项）

| # | 任务 | 涉及文件 | 
|---|------|---------|
| 4.1 | 删除残留无效代码：`server/src/botManager.ts` 中遗留的缓存相关代码、`server/src/authMiddleware.ts` 中的用户上下文 | 各文件 |
| 4.2 | 更新 `CLAUDE.md`：新架构说明、模块职责、启动流程 | `CLAUDE.md` |
| 4.3 | 更新 `README.md`：移除 Wechaty 相关内容，更新为 wx4py 配置说明 | `README.md` |

**阶段四完成标准**：文档与代码一致，CLAUDE.md 可被其他 AI 正确理解项目。

---

## 附录：可测试性说明

重构后架构天然适合单元测试，建议后续补充：

| 模块 | 可测纯函数 | 测试工具 |
|------|-----------|---------|
| `scheduler.ts` | `scanDueTasks(tasks, now)` 纯函数 | Jest |
| `taskQueue.ts` | `calculateNextTime(task)`, `randomDelay(min, max)`, 队列排序 | Jest |
| `auth.ts` | `verifyPassword(plain, hash)`, `generateToken()` | Jest |
| `dbManager.ts` | `migrateFromLegacy(oldDir, newPath)` | Jest + 临时文件 |
| `wxBridge.ts` | 需 mock HTTP | Jest + nock |
| 通讯录 CRUD | API handler 函数 | Jest + supertest |
