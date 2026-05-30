// ── Contact (通讯录) ──────────────────────────────────────
export interface Contact {
  id: string;
  name: string;          // 群名或联系人名
  type: 'group' | 'contact';
  note: string;          // 备注
  createdAt: string;
}

// ── Template (消息模板) ──────────────────────────────────
export interface Template {
  id: string;
  name: string;
  type: 'text';
  content: string[];
  targets?: { name: string; type: 'group' | 'contact' }[];
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
  uiTime?: string;
  uiWeekday?: string;
  uiDayOfMonth?: string;
  createdAt: string;
}

// ── Task (定时任务) ──────────────────────────────────────
export interface Task {
  id: string;
  templateId?: string;
  type: 'text';
  targetType: 'group' | 'contact';
  targetName: string;    // 直接用名称，wx4py 通过名称定位目标
  content: string[];
  currentContentIndex: number;
  scheduleTime: string;  // ISO String
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
  status: 'pending' | 'processing' | 'success' | 'failed';
  createdAt: string;
  updatedAt?: string;
  error?: string;
}

// ── Log (系统日志) ───────────────────────────────────────
export interface Log {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  taskId?: string;
}

// ── LiveLog (实时发送记录) ───────────────────────────────
export interface LiveLog {
  id: string;
  timestamp: string;
  targetName: string;
  targetType: 'group' | 'contact';
  content: string;
  success: boolean;
  duration: number;  // ms
  error?: string;
}

// ── Database Schema ─────────────────────────────────────
export interface Data {
  contacts: Contact[];
  tasks: Task[];
  templates: Template[];
  logs: Log[];
  liveLogs: LiveLog[];
}

// ── Bot Status (API 返回) ────────────────────────────────
export interface BotStatus {
  online: boolean;
  queueLength: number;
  currentTarget?: string;
  lastError?: string;
}
