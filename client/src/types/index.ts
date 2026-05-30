// ── LiveLog (实时发送记录) ──────────────────────────────
export interface LiveLog {
  id: string;
  timestamp: string;
  targetName: string;
  targetType: 'group' | 'contact';
  content: string;
  success: boolean;
  duration: number;
  error?: string;
}

// ── Bot Status (API 返回) ────────────────────────────────
export interface TaskStats {
  total: number;
  once: number;
  daily: number;
  weekly: number;
  monthly: number;
  interval: number;
  pending: number;
  failed: number;
  overduePending: number;
}

export interface BotStatus {
  online: boolean;
  queueLength: number;
  currentTarget?: string;
  lastError?: string;
  loginTime?: string;
  taskStats?: TaskStats;
}

// ── Contact (通讯录) ──────────────────────────────────────
export interface Contact {
  id: string;
  name: string;
  type: 'group' | 'contact';
  note: string;
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
  uiWeekdays?: string[];
  uiDayOfMonth?: string;
  createdAt: string;
}

// ── Task (定时任务) ──────────────────────────────────────
export interface Task {
  id: string;
  templateId?: string;
  type: 'text';
  targetType: 'group' | 'contact';
  targetName: string;
  content: string[];
  currentContentIndex?: number;
  scheduleTime: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
  // UI helper fields for TaskDraft
  uiTime?: string;
  uiWeekdays?: string[];
  uiDayOfMonth?: string;
}

// ── Log (系统日志) ───────────────────────────────────────
export interface Log {
  id: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  timestamp: string;
  taskId?: string;
}

// ── Toast ────────────────────────────────────────────────
export interface ToastMsg {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}
