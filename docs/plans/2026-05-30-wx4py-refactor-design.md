# WxSchedule wx4py 适配重构设计方案

> 日期: 2026-05-30 | 分支: fork4win | 状态: 设计确认，待实施

---

## 一、背景与问题

### 1.1 项目现状

WxSchedule 最初基于 Wechaty Web 协议开发，后迁移至 wx4py (Windows UI Automation)。迁移过程中**照搬了 Wechaty 时期的设计模式**，未适配 wx4py 的实际能力限制。

### 1.2 核心问题

| 问题 | 说明 |
|------|------|
| **群组/联系人列表不可靠** | wx4py 是 UI 自动化，无法通过 API 获取微信通讯录。当前"字母扫描"方案慢且不完整 |
| **并发设计不成立** | wx4py 操作微信窗口是串行的，多用户并行任务队列的设计在物理上不可能 |
| **多用户架构过度设计** | 实际使用单一微信账号，多租户 DB、用户管理增加复杂度 |
| **无效 UI 元素** | 二维码显示、服务器 IP、登录时长等在 wx4py 下无意义 |

### 1.3 设计原则

- **MVP 优先** — 先让功能真正可跑，削掉一切暂时不用的
- **以 wx4py 实际能力为准** — 不假设任何 Web 协议时期的能力
- **打好基础** — 架构清晰、可扩展、后续可加单元测试
- **UI 更易用** — 去掉无效内容，流程更直观

---

## 二、架构改造

### 2.1 架构对比

```
改造前 (多用户 + 并行)                  改造后 (单用户 + 串行)
                                  
users/                                  server/
├── admin/db.json                       └── db.json          ← 单文件
├── user1/db.json                             
└── ...                                 
                                        
每个用户独立 TaskQueue                 全局唯一 TaskQueue    ← 严格串行
多队列可"并发"执行                     5~10s 随机间隔

手动扫描获取群组列表                   手动通讯录 + 扫描辅助
```

### 2.2 删除清单

| 文件/模块 | 原因 |
|-----------|------|
| `server/src/userManager.ts` | 多用户体系 |
| `server/src/mockBot.ts` | MVP 不需要 Mock |
| `server/src/botManager.ts` 中的缓存层 | roomCache/contactCache，不再需要 |
| `server/src/botManager.ts` 中的缓存预热逻辑 | 同上 |
| `server/src/authMiddleware.ts` 多用户逻辑 | 简化为单管理员 |
| `server/users/` 目录 | 多租户 DB 目录 |
| `server/test/smoke.ts` | MockBot 依赖，后续重写 |
| 前端群组管理扫描相关代码 | 改为通讯录管理 |
| 前端二维码显示 | wx4py 下无意义 |
| 前端登录时长显示 | 简化为在线状态 |
| 前端服务器 IP 显示 | 非必要 |

### 2.3 修改清单

| 文件 | 改动 |
|------|------|
| `server/src/dbManager.ts` | 多租户 → 单文件 DB (`server/db.json`) |
| `server/src/scheduler.ts` | 多用户轮询 → 单 DB 扫描 |
| `server/src/taskQueue.ts` | 多队列并发 → 全局单队列串行，5~10s 随机间隔 |
| `server/src/api.ts` | 精简路由：删群组/联系人查询，加通讯录 CRUD |
| `server/src/authMiddleware.ts` | 简化为单管理员 JWT |
| `server/src/botManager.ts` | 删缓存层，保留 bot 生命周期管理 |
| `server/src/wxBridge.ts` | 保持，加失败重试 |
| `server/src/index.ts` | 启动流程调整 |
| `server/src/types.ts` | 更新类型定义 |

### 2.4 不变部分

| 文件 | 说明 |
|------|------|
| `server/pybridge/bridge.py` | wx4py 桥接，不修改 |
| `server/pybridge/requirements.txt` | 不修改 |
| 模板 CRUD 逻辑 | 保留 |
| 任务 CRUD 逻辑 | 保留，目标字段改为 name |
| Express 静态文件 serve | 保留 |
| 前端技术栈 (React/Vite/Tailwind) | 保留 |
| 前端系统日志页 | 保留 |

---

## 三、数据模型

### 3.1 数据库文件

`server/db.json`:
```json
{
  "contacts": [],
  "templates": [],
  "tasks": [],
  "logs": []
}
```

### 3.2 Contact (通讯录)

```typescript
interface Contact {
  id: string;           // 时间戳
  name: string;         // 群名或联系人名（手动输入）
  type: 'group' | 'contact';
  note: string;         // 备注
  createdAt: string;    // ISO 时间
}
```

### 3.3 Task (任务) — 改动项

```typescript
interface Task {
  id: string;
  templateId?: string;
  type: 'text';
  targetType: 'group' | 'contact';
  targetName: string;       // ← 改为直接用名称，不再用 targetId
  content: string[];
  currentContentIndex: number;
  scheduleTime: string;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
  status: 'pending' | 'processing' | 'success' | 'failed';
  createdAt: string;
  updatedAt?: string;
  error?: string;
}
```

### 3.4 Template (模板) — 改动项

```typescript
interface Template {
  id: string;
  name: string;
  type: 'text';
  content: string[];
  targets?: { name: string; type: 'group' | 'contact' }[];  // ← 简化
  recurrence: string;
  uiTime?: string;
  uiWeekday?: string;
  uiDayOfMonth?: string;
  intervalValue?: number;
  intervalUnit?: string;
  createdAt: string;
}
```

---

## 四、API 设计

### 4.1 公开路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 管理员登录 → `{ token }` |

### 4.2 受保护路由

**Bot 状态：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | Bot 状态 + 队列信息 |
| POST | `/api/bot/restart` | 重启桥接 |

**通讯录：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contacts` | 获取通讯录列表 |
| POST | `/api/contacts` | 添加联系人 |
| PUT | `/api/contacts/:id` | 编辑联系人 |
| DELETE | `/api/contacts/:id` | 删除联系人 |
| GET | `/api/contacts/scan?q=` | 尝试扫描（辅助） |

**模板（不变）：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/templates` | 列表 |
| POST | `/api/templates` | 创建 |
| PUT | `/api/templates/:id` | 更新 |
| DELETE | `/api/templates/:id` | 删除 |

**任务（不变，字段调整）：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 列表 |
| POST | `/api/tasks` | 创建 |
| PUT | `/api/tasks/:id` | 更新 |
| DELETE | `/api/tasks/:id` | 删除 |
| DELETE | `/api/tasks/batch-delete` | 批量删除 |

**日志：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 最近 100 条 |

---

## 五、调度与执行

### 5.1 调度器

```
setInterval(10s):
  db.tasks.filter(status=pending & scheduleTime <= now)
    → 按 scheduleTime 排序
    → 逐个加入全局队列 (去重: 已在队列的不重复加)
```

### 5.2 全局队列

```
单线程循环:
  while (queue.length > 0):
    task = queue.shift()
    task.status = 'processing'
    
    result = await wxBridge.send(task.targetName, task.targetType, task.content)
    
    if (success):
      if (周期性任务): 计算下次时间 → status = 'pending'
      else: status = 'success'
    else:
      if (首次失败): 等待 2s → 重试 1 次
      if (仍失败): status = 'failed', error = 原因
    
    写日志
    
    随机等待 5~10 秒  // Math.random() * 5000 + 5000
```

### 5.3 Dashboard 状态信息

```typescript
interface BotStatus {
  online: boolean;             // Bot 是否在线
  queueLength: number;         // 队列待执行任务数
  currentTarget?: string;      // 正在发送的目标名
  lastError?: string;          // 最近错误
}
```

---

## 六、前端页面改造

### 6.1 页面清单

| 页面 | 路径 | 改动说明 |
|------|------|----------|
| 登录 | `/login` | 极简：用户名 + 密码 |
| 概览 | `/` | 队列状态 + Bot 状态 + 最近日志摘要 |
| 通讯录 | `/contacts` | 手动管理 + 扫描辅助按钮 |
| 任务 | `/tasks` | 目标从通讯录下拉选择 + 支持手输 |
| 模板 | `/templates` | 目标字段改为通讯录下拉 |
| 日志 | `/logs` | 保持不变 |

### 6.2 通讯录页交互

```
┌─────────────────────────────────────────────┐
│  通讯录                        [尝试扫描]    │
│                                              │
│  [+ 添加联系人/群组]                         │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ 🏢 产品研发部    群组   工作日日报    │    │
│  │       [编辑] [删除]                  │    │
│  ├─────────────────────────────────────┤    │
│  │ 👤 张三          联系人  项目对接    │    │
│  │       [编辑] [删除]                  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

"尝试扫描"弹窗：
```
┌────────────────────────────────┐
│  扫描微信通讯录                 │
│  [搜索框: 输入关键词...]        │
│                                │
│  ☑ 产品研发部 (群)              │
│  ☑ 周末约球群 (群)              │
│  ☐ 家庭群 (群)                  │
│                                │
│  [添加到通讯录]                  │
└────────────────────────────────┘
```

### 6.3 删除的 UI 元素

- 侧边栏"群组" → 改为"通讯录"
- Dashboard 的二维码区域
- Dashboard 的登录时长
- Dashboard 的服务器 IP
- 侧边栏调试模式开关
- 调试控制台（DebugConsole）
- 登录页"记住密码"

---

## 七、向后兼容

### 7.1 数据迁移

旧数据路径 `server/users/<username>/db.json` → 新数据路径 `server/db.json`

- 首次启动时自动检测旧数据
- 如果存在，合并所有用户的 tasks/templates 到新文件
- `task.targetId` → `task.targetName` 字段迁移
- 迁移后不删除旧数据（用户手动处理）

### 7.2 配置迁移

- `.env`: 保持，`JWT_SECRET` 必填
- `.user`: 保留第一个管理员账号，其余忽略

---

## 八、后续扩展点

以下为 MVP 阶段不做、但架构预留的：

1. **单元测试** — 全局单队列的纯函数逻辑易于测试（scheduler 扫描逻辑、队列排序、重试逻辑）
2. **发送统计** — 在 task 执行记录上扩展 successRate、平均延迟等
3. **Webhook 通知** — 任务失败时推送到其他渠道
4. **AI 消息生成** — 模板内容可接入 LLM 动态生成
