export interface BotStatus {
    status: 'offline' | 'waiting_for_scan' | 'logged_in';
    ready?: boolean;
    user?: { name: string; id: string };
    loginTime?: string;
  }
  
  export interface Template {
      id: string;
      name: string;
      type: 'text';
      content: string[];
      targets: { type: 'group' | 'contact', id: string, name: string }[];
      createdAt: string;
  }string;
  }
  
  export interface ToastMsg {
    id: string;
    type: 'success' | 'error' | 'info';
    message: string;
  }
  
  export interface DebugLog {
    id: string;
    type: 'log' | 'error' | 'warn';
    message: string;
    timestamp: string;
  }
  
  export interface Group {
    id: string;
    topic: string;
    memberCount: number;
  }
  
  export interface Task {
  id: string;
  type: 'text';
  targetType: 'group' | 'contact';
  targetId: string;
  targetName: string;
  content: string[];
  currentContentIndex?: number;
  scheduleTime: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
}
  
  export interface Log {
    id: string;
    level: 'info' | 'error' | 'warn';
    message: string;
    timestamp: string;
    taskId?: string;
  }

  export interface Contact {
      id: string;
      name: string;
  }
