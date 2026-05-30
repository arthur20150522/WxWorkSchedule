# CLAUDE.md

## 操作日志规则

**每次代码修改后，必须追记到 `PROJECT_STATUS.md`**。格式：

```
### HH:MM — 简短标题
- **HH:MM** 做了什么 — 文件路径/原因/结果
```

规则：
1. 找到文件末尾 `## 待办` 之前的最新日期段落
2. 如果是同一天，追加到当天的操作日志下
3. 如果是新的一天，新建 `## YYYY-MM-DD 操作日志` 段落
4. 待办有变化时同步更新待办表
5. 不要创建新的日期命名文件，始终写 `PROJECT_STATUS.md`

---

## 关键禁止项

- **禁止执行完整 Build/打包**。仅做 `tsc --noEmit` 类型检查。
- **禁止执行 `npm run build`**。
- **不要修改 `server/pybridge/bridge.py`**（wx4py 桥接层）。
- **不要恢复多用户架构**。当前是单文件 DB + 全局单队列。
- **不要重新引入 Wechaty 兼容层**（Room.say / Contact.say 等）。
- **不要硬编码用户名**。.user 支持任意 username:password。

---

## 项目概览

WxSchedule — 微信定时消息机器人。wx4py (Windows UI Automation) + React 管理后台。

## 启动

```
双击 start.bat → 选 2 (全部启动) → http://localhost:5173
```

## 编译检查（仅类型检查，不构建）

```bash
cd server && npx tsc --noEmit   # 后端
cd client && npx tsc --noEmit   # 前端
```

## 架构（已重构，非多用户）

### 数据
- **单文件 DB**: `server/db.json` (contacts + tasks + templates + logs)
- **旧数据迁移**: dbManager.migrateFromLegacy() 自动从 `server/users/<user>/db.json` 合并

### 调度与发送
1. **Scheduler** — 每 10s 扫描 pending + scheduleTime<=now → 入队。逾期超过 MAX_TASK_DELAY_MINUTES(默认30min) 自动 skipped。
2. **TaskQueue** — 全局单例。严格串行，每任务随机 5~10s 间隔，失败重试 1 次(2s 后)。
3. **发送**: task.targetName → wxBridge.send(targetName, content, targetType)
4. **周期**: calculateNextTime() — daily/weekly/monthly/interval

### 认证
- `.user` 文件: `{ "username": "password_or_hash" }`，任意用户名
- 明文密码首次登录自动迁移为 bcrypt
- JWT 7 天，verifyPassword(username, password)

### 前端结构
- `App.tsx` — 主状态 + API 轮询 + 标签路由
- `views/` — Dashboard / Contacts / Templates / Tasks / Logs
- `utils/i18n.ts` — 中文 UI 文案
- Vite proxy `/api/*` → `http://localhost:3000`

### 通讯录
- 手动管理 + wxBridge.search 扫描辅助
- `/api/contacts` CRUD + `/api/contacts/scan?q=` 搜索

### 导入导出
- `GET /api/data/export` — 全量 JSON (contacts+templates+tasks)
- `POST /api/data/import` — 合并模式，同 id 跳过

## API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | { username, password } → { token } |
| GET | `/api/status` | Bot 状态 + 队列 + taskStats |
| POST | `/api/bot/restart` | 重启 bridge |
| GET/POST/PUT/DELETE | `/api/contacts` | 通讯录 CRUD |
| GET | `/api/contacts/scan?q=` | 扫描微信通讯录 |
| GET/POST/PUT/DELETE | `/api/templates` | 模板 CRUD |
| GET/POST/PUT/DELETE | `/api/tasks` | 任务 CRUD |
| DELETE | `/api/tasks/batch-delete` | 批量删除 |
| GET | `/api/logs` | 最近 100 条日志 |
| GET | `/api/data/export` | 全量导出 |
| POST | `/api/data/import` | 全量导入 |

## 配置文件

- `server/.env` — PORT + JWT_SECRET + MAX_TASK_DELAY_MINUTES
- `server/.user` — 用户密码文件 (gitignored)
- `server/db.json` — 主数据库 (gitignored)
