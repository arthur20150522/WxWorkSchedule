## 目标
1.  **微信登录持久化**：确保 Wechaty 的 Session 信息被保存，避免重复扫码。
2.  **多用户/多 Bot 隔离**：引入 `.user` 配置文件，根据登录用户隔离数据（任务/日志）和 Bot 实例（Session）。
3.  **文档与安全更新**：更新 README，忽略敏感目录。

## 现状确认
- **Wechaty 持久化**：当前 `bot.ts` 中已设置 `name: 'wx-schedule-bot'`，这会默认在根目录生成 `wx-schedule-bot.memory-card.json`，**实际上已经是持久化的**。但为了配合多用户，我们需要让这个文件生成在特定用户目录下。
- **用户认证**：目前仅是一个简单的密码比对接口，无 Token/Session 机制，后续请求未鉴权。
- **数据存储**：全局单例 `db.json`。

## 实施方案
我将对服务端架构进行大幅重构，以支持多用户隔离。

### 1. 用户系统与认证改造
-   **配置文件**：在 `server/.user` (JSON格式) 中存储用户列表，例如 `{"admin": "password123", "user2": "secret"}`。
-   **鉴权机制**：
    -   登录接口 `/api/login` 验证密码后，生成一个简单的 JWT Token（包含 `username`）。
    -   前端存储 Token，并在后续所有 API 请求头中携带 `Authorization: Bearer <token>`。
    -   后端添加 `authMiddleware`，解析 Token 并将 `req.user` 注入到请求中。

### 2. 多实例 Bot 与数据隔离
-   **目录结构调整**：
    -   所有用户数据移至 `server/users/<username>/`。
    -   包含：`tasks.json` (原 db.json)、`bot.memory-card` (Wechaty Session)。
-   **Bot Manager (新模块)**：
    -   不再导出全局 `bot`。
    -   创建一个 `BotManager` 类，维护 `Map<username, WechatyInterface>`。
    -   方法 `getBot(username)`：如果实例存在直接返回；不存在则初始化一个新的 Wechaty 实例，指定 `name` 为 `users/<username>/bot`（从而将 memory-card 存到该用户目录下）。
-   **DB Manager (新模块)**：
    -   维护 `Map<username, LowdbInstance>`。
    -   方法 `getDb(username)`：动态加载 `users/<username>/tasks.json`。

### 3. 核心业务逻辑迁移
-   **API 路由**：所有路由（`tasks`, `groups`, `status`, `logs` 等）全部改为从 `req.user` 获取用户名，然后调用 `BotManager` 和 `DBManager` 获取对应的实例进行操作。
-   **调度器 (Scheduler)**：
    -   原来的 `setInterval` 循环需要遍历所有活跃用户，或者为每个活跃用户启动一个独立的调度 Loop。
    -   **方案**：改为一个主循环，遍历 `server/users/` 下的所有用户目录，分别加载 DB 检查任务并执行（需要确保 Bot 已登录）。

### 4. 前端适配
-   登录成功后保存 Token。
-   Axios 拦截器自动添加 Token。
-   处理 Token 过期或 401 错误（跳转登录页）。

### 5. 安全与文档
-   更新 `.gitignore`：忽略 `server/.user` 和 `server/users/`。
-   更新 `README.md`：说明多用户配置方式及数据目录结构。

## 执行步骤
1.  **基础架构**：创建 `UserManager`、`BotManager`、`DBManager`。
2.  **后端重构**：改造 `api.ts` 引入 Auth 中间件，改造 `scheduler.ts` 支持多用户轮询。
3.  **前端适配**：修改 `App.tsx` 的登录逻辑和请求头。
4.  **清理与迁移**：移动现有的 `db.json` 数据（如果有）到默认用户目录（如 `admin`），确保平滑过渡。
5.  **文档更新**。

确认后，我将按此计划执行重构。由于改动较大，我会分步进行，先后端后前端。