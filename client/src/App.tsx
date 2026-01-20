import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { QrCode, Users, MessageSquare, List, RefreshCw, Trash2, CheckCircle, XCircle, FileText, Bug, Terminal } from 'lucide-react';
import clsx from 'clsx';

// Types
interface BotStatus {
// ... existing types ...
  status: 'offline' | 'waiting_for_scan' | 'logged_in';
  ready?: boolean;
  user?: { name: string; id: string };
  loginTime?: string;
}

interface ToastMsg {
    id: string;
    type: 'success' | 'error' | 'info';
    message: string;
}

interface DebugLog {
    id: string;
    type: 'log' | 'error' | 'warn';
    message: string;
    timestamp: string;
}

// ... existing interfaces ...

interface Group {
  id: string;
  topic: string;
  memberCount: number;
}

interface Task {
  id: string;
  type: 'text' | 'image' | 'file';
  targetType: 'group' | 'contact';
  targetId: string;
  targetName: string;
  content: string;
  scheduleTime: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number;
  intervalUnit?: 'minute' | 'hour' | 'day';
}

interface Log {
    id: string;
    level: 'info' | 'error' | 'warn';
    message: string;
    timestamp: string;
    taskId?: string;
}

// Translations
const t: any = {
    title: "微信机器人管理",
    login: "登录",
    logout: "退出登录",
    password: "密码",
    invalidPassword: "密码错误",
    dashboard: "概览",
    groups: "群组管理",
    tasks: "任务管理",
    logs: "系统日志",
    botStatus: "机器人状态",
    scanQr: "请使用微信扫码登录",
    loggedInAs: "当前登录用户",
    offline: "离线 (请检查后台)",
    waitingForScan: "等待扫码",
    loggedIn: "已登录",
    syncing: "数据同步中...",
    managedGroups: "群组列表",
    searchGroups: "搜索群组...",
    members: "成员",
    sendMessage: "发送消息",
    pleaseLogin: "请先登录以获取群组信息",
    scheduleNew: "创建定时任务",
    targetType: "发送对象类型",
    selectTarget: "选择发送对象",
    group: "群组",
    contact: "联系人",
    messageType: "消息类型",
    text: "文本",
    image: "图片链接",
    file: "文件路径",
    content: "内容",
    scheduleTime: "发送时间",
    scheduleTask: "创建任务",
    scheduledTasks: "任务列表",
    allTasks: "所有任务",
    pending: "等待执行",
    success: "执行成功",
    failed: "执行失败",
    target: "目标",
    status: "状态",
    actions: "操作",
    noTasks: "暂无任务",
    systemLogs: "系统日志",
    noLogs: "暂无日志",
    deleteConfirm: "确定要删除吗？",
    createFailed: "创建任务失败",
    refresh: "刷新",
     select: "请选择...",
     refreshQr: "刷新二维码",
     riskWarningTitle: "⚠️ 风险提示",
     riskWarningContent: "频繁登录或使用 Web 协议可能会导致微信号被暂时限制登录（如：禁止 Web 微信登录）。建议使用小号测试。如果遇到无法登录的情况，请暂停使用一段时间。",
     restarting: "正在重启机器人...",
     recurrence: "重复周期",
     once: "一次性",
     daily: "每天",
     weekly: "每周",
     monthly: "每月",
     time: "时间",
     dayOfWeek: "星期",
     dayOfMonth: "日期",
     selectDay: "选择日期",
     monday: "周一",
     tuesday: "周二",
     wednesday: "周三",
     thursday: "周四",
     friday: "周五",
     saturday: "周六",
     sunday: "周日",
     everyDayAt: "每天",
     everyWeekAt: "每周",
     everyMonthAt: "每月",
     interval: "每隔多久",
     intervalValue: "间隔数值",
     intervalUnit: "间隔单位",
     minutes: "分钟",
     hours: "小时",
     days: "天",
     startTime: "开始时间",
     loginDuration: "已登录时长",
     durationFormat: "{days}天 {hours}小时 {minutes}分",
 };

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'groups' | 'tasks' | 'logs'>('dashboard');
  const [botStatus, setBotStatus] = useState<BotStatus>({ status: 'offline' });
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<{id: string, name: string}[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isRestarting, setIsRestarting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({ isOpen: false, title: '', message: '', onConfirm: async () => {} });

  const closeConfirm = () => setConfirmDialog(prev => ({ ...prev, isOpen: false }));

  // Toasts
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = Date.now().toString() + Math.random();
      setToasts(prev => [...prev, { id, type, message }]);
      setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000); // 5 seconds
  };

  // Debug Console
  const [showDebug, setShowDebug] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  
  useEffect(() => {
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      const addLog = (type: 'log' | 'error' | 'warn', args: any[]) => {
          const message = args.map(a => {
              try {
                  return typeof a === 'object' ? JSON.stringify(a) : String(a);
              } catch (e) {
                  return '[Circular]';
              }
          }).join(' ');
          
          setDebugLogs(prev => [{
              id: Date.now().toString() + Math.random(),
              type,
              message,
              timestamp: new Date().toISOString()
          }, ...prev].slice(0, 100)); // Keep last 100 logs
      };

      console.log = (...args) => {
          originalLog(...args);
          addLog('log', args);
      };

      console.error = (...args) => {
          originalError(...args);
          addLog('error', args);
      };

      console.warn = (...args) => {
          originalWarn(...args);
          addLog('warn', args);
      };

      return () => {
          console.log = originalLog;
          console.error = originalError;
          console.warn = originalWarn;
      };
  }, []);

  // Task Form State
  const initialNewTask: Partial<Task> & {
    uiTime: string;
    uiWeekday: string;
    uiDayOfMonth: string;
    intervalValue: number;
    intervalUnit: 'minute' | 'hour' | 'day';
  } = {
    type: 'text',
    targetType: 'group',
    targetId: '',
    content: '',
    scheduleTime: '', 
    recurrence: 'once',
    uiTime: '09:00',
    uiWeekday: '1', 
    uiDayOfMonth: '1',
    intervalValue: 30,
    intervalUnit: 'minute'
  };

  const [newTask, setNewTask] = useState(initialNewTask);

  const resetAppState = () => {
    setActiveTab('dashboard');
    setBotStatus({ status: 'offline' });
    setQrCode(null);
    setGroups([]);
    setContacts([]);
    setTasks([]);
    setLogs([]);
    setSearchQuery('');
    setTaskFilter('all');
    setIsRestarting(false);
    setNewTask({ ...initialNewTask });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');
  
  // Login Duration Component
  const LoginDuration = ({ startTime }: { startTime: string }) => {
      const [duration, setDuration] = useState({ days: 0, hours: 0, minutes: 0 });

      useEffect(() => {
          const calculate = () => {
              const start = new Date(startTime).getTime();
              const now = new Date().getTime();
              const diff = Math.max(0, now - start);

              const days = Math.floor(diff / (1000 * 60 * 60 * 24));
              const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

              setDuration({ days, hours, minutes });
          };

          calculate();
          const timer = setInterval(calculate, 60000); // Update every minute
          return () => clearInterval(timer);
      }, [startTime]);

      return (
          <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              {t.loginDuration}: {t.durationFormat
                  .replace('{days}', duration.days.toString())
                  .replace('{hours}', duration.hours.toString())
                  .replace('{minutes}', duration.minutes.toString())
              }
          </div>
      );
  };

  // Filtered Groups
  const filteredGroups = groups.filter(g => g.topic.toLowerCase().includes(searchQuery.toLowerCase()));

  const fetchStatus = async () => {
    try {
      const res = await axios.get('/api/status');
      setBotStatus(res.data);
      
      if (res.data.status === 'waiting_for_scan') {
        const qrRes = await axios.get('/api/qr');
        setQrCode(qrRes.data.qr);
      } else {
        setQrCode(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get('/api/groups');
      setGroups(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchContacts = async () => {
    try {
        const res = await axios.get('/api/contacts');
        setContacts(res.data);
    } catch (e) {
        console.error(e);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await axios.get('/api/tasks');
      setTasks(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLogs = async () => {
      try {
          const res = await axios.get('/api/logs');
          setLogs(res.data);
      } catch (e) {
          console.error(e);
      }
  }

  const restartBot = async () => {
    setConfirmDialog({
        isOpen: true,
        title: t.restarting,
        message: '重启机器人会断开当前连接并刷新二维码，确定吗？',
        onConfirm: async () => {
            setIsRestarting(true);
            try {
                await axios.post('/api/bot/restart');
                setBotStatus({ status: 'offline' });
                setQrCode(null);
            } catch (e) {
                showToast('重启失败', 'error');
            } finally {
                setTimeout(() => setIsRestarting(false), 5000);
            }
        }
    });
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.targetId || !newTask.content) return;

    // Calculate Schedule Time based on Recurrence
    let finalScheduleTime = newTask.scheduleTime;
    const now = new Date();
    
    if (newTask.recurrence === 'interval') {
         // For interval, use scheduleTime as start time, or default to now
         if (!finalScheduleTime) {
             finalScheduleTime = now.toISOString();
         }
    } else if (newTask.recurrence !== 'once') {
        const [hours, minutes] = newTask.uiTime.split(':').map(Number);
        let nextRun = new Date();
        nextRun.setHours(hours, minutes, 0, 0);

        if (newTask.recurrence === 'daily') {
            if (nextRun <= now) {
                nextRun.setDate(nextRun.getDate() + 1);
            }
        } else if (newTask.recurrence === 'weekly') {
            const targetDay = parseInt(newTask.uiWeekday); // 1=Mon, 7=Sun
            // JS Date: 0=Sun, 1=Mon...6=Sat
            // Convert our target (1-7) to JS (1-6, 0)
            const jsTargetDay = targetDay === 7 ? 0 : targetDay;
            const currentDay = nextRun.getDay();
            
            let daysToAdd = (jsTargetDay - currentDay + 7) % 7;
            if (daysToAdd === 0 && nextRun <= now) {
                daysToAdd = 7;
            }
            nextRun.setDate(nextRun.getDate() + daysToAdd);
        } else if (newTask.recurrence === 'monthly') {
            const targetDate = parseInt(newTask.uiDayOfMonth);
            // Set to current month's target date
            nextRun.setDate(targetDate);
            
            // Handle edge cases (e.g. 31st in Feb) - JS Date auto rolls over, which is fine or needs check
            // If we are past the time this month, move to next month
            if (nextRun <= now) {
                nextRun.setMonth(nextRun.getMonth() + 1);
            }
        }
        finalScheduleTime = nextRun.toISOString();
    } else {
        if (!finalScheduleTime) return; // Required for 'once'
    }

    let targetName = 'Unknown';
    if (newTask.targetType === 'group') {
        targetName = groups.find(g => g.id === newTask.targetId)?.topic || 'Unknown';
    } else {
        targetName = contacts.find(c => c.id === newTask.targetId)?.name || 'Unknown';
    }
    
    try {
      await axios.post('/api/tasks', {
        ...newTask,
        scheduleTime: finalScheduleTime,
        targetName
      });
      fetchTasks();
      setActiveTab('tasks');
      // Reset form (keep some defaults)
      setNewTask({ ...newTask, content: '', scheduleTime: '' });
      showToast('任务创建成功', 'success');
    } catch (e) {
      showToast(t.createFailed, 'error');
    }
  };

  const deleteTask = async (id: string) => {
    console.log('Requesting delete for task:', id);
    setConfirmDialog({
        isOpen: true,
        title: '删除任务',
        message: t.deleteConfirm,
        onConfirm: async () => {
            try {
                console.log('Sending delete request for id:', id);
                const res = await axios.delete(`/api/tasks/${id}`);
                console.log('Delete response:', res.status, res.data);
                if (res.data.success) {
                    await fetchTasks();
                    showToast('删除成功', 'success');
                } else {
                    showToast('删除失败，服务器返回异常', 'error');
                }
            } catch (e: any) {
                console.error('Delete failed:', e);
                let errMsg = e.message;
                if (e.response) {
                    errMsg = `Server Error (${e.response.status}): ${JSON.stringify(e.response.data)}`;
                } else if (e.request) {
                    errMsg = 'Network Error: No response received';
                }
                showToast(`删除请求失败: ${errMsg}`, 'error');
            }
        }
    });
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); // Poll faster for better responsiveness
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    // Only fetch data if logged in AND ready
    if (!isAuthenticated) return;
    if (botStatus.status === 'logged_in' && botStatus.ready) {
      fetchGroups();
      fetchContacts();
    }
  }, [botStatus.status, botStatus.ready, isAuthenticated]);

  useEffect(() => {
    // Poll logs every 5 seconds if on logs tab
    if (!isAuthenticated) return;
    let interval: any;
    if (activeTab === 'logs') {
        fetchLogs();
        interval = setInterval(fetchLogs, 5000);
    }
    return () => {
        if (interval) clearInterval(interval);
    };
  }, [activeTab, isAuthenticated]);

  const [username, setUsername] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);

  // Axios interceptor for token
  useEffect(() => {
    const reqInterceptor = axios.interceptors.request.use(config => {
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    });
    
    const resInterceptor = axios.interceptors.response.use(
        response => response,
        error => {
            if (error.response && error.response.status === 401 && isAuthenticated) {
                // Token expired or invalid
                setIsAuthenticated(false);
                setToken(null);
                showToast('Session expired. Please login again.', 'warn' as any);
            }
            return Promise.reject(error);
        }
    );

    return () => {
        axios.interceptors.request.eject(reqInterceptor);
        axios.interceptors.response.eject(resInterceptor);
    };
  }, [token, isAuthenticated]);

  // Simple Base64 encryption for frontend demo
  const encrypt = (text: string) => btoa(text);
  const decrypt = (text: string) => atob(text);

  useEffect(() => {
    const savedUsername = localStorage.getItem('wxbot_username');
    const savedPassword = localStorage.getItem('wxbot_password');
    if (savedUsername && savedPassword) {
      setUsername(savedUsername);
      try {
        setPassword(decrypt(savedPassword));
        setRememberMe(true);
      } catch (e) {
        console.error('Failed to decrypt password', e);
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const res = await axios.post('/api/login', { username, password });
        setToken(res.data.token);
        setIsAuthenticated(true);
        
        if (rememberMe) {
          localStorage.setItem('wxbot_username', username);
          localStorage.setItem('wxbot_password', encrypt(password));
        } else {
          localStorage.removeItem('wxbot_username');
          localStorage.removeItem('wxbot_password');
        }
    } catch (e: any) {
        if (e.response && e.response.status === 401) {
            showToast(t.invalidPassword, 'error');
        } else {
            showToast('Login failed: ' + (e.response?.data?.error || e.message), 'error');
        }
    }
  };

  if (!isAuthenticated) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-slate-800">
              <div className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-white/20 w-full max-w-md">
                  <div className="flex justify-center mb-6">
                      <div className="p-4 bg-green-500/20 rounded-full ring-4 ring-green-500/10">
                          <MessageSquare className="w-10 h-10 text-green-400" />
                      </div>
                  </div>
                  <h1 className="text-3xl font-bold text-center mb-2 text-white">{t.title}</h1>
                  <p className="text-center text-gray-400 mb-8 font-light">{t.login}</p>
                  
                  <form onSubmit={handleLogin} className="space-y-6">
                      <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-300 ml-1">用户名</label>
                          <input 
                            type="text" 
                            className="w-full p-4 bg-gray-900/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-white placeholder-gray-500"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="username"
                          />
                      </div>
                      <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-300 ml-1">{t.password}</label>
                          <input 
                            type="password" 
                            className="w-full p-4 bg-gray-900/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-white placeholder-gray-500"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder={t.password}
                          />
                      </div>
                      
                      <div className="flex items-center">
                          <input
                            id="remember-me"
                            type="checkbox"
                            className="w-4 h-4 text-green-600 bg-gray-900 border-gray-700 rounded focus:ring-green-500 focus:ring-2"
                            checked={rememberMe}
                            onChange={e => setRememberMe(e.target.checked)}
                          />
                          <label htmlFor="remember-me" className="ml-2 text-sm font-medium text-gray-300">
                            记住密码
                          </label>
                      </div>

                      <button type="submit" className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-500 hover:to-emerald-500 font-bold tracking-wide transition-all shadow-lg shadow-green-900/20 active:scale-[0.98]">
                          {t.login}
                      </button>
                  </form>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-slate-800">
      {/* Sidebar */}
      <div className="bg-[#0f172a] text-slate-300 w-full md:w-72 flex-shrink-0 flex flex-col shadow-2xl z-20">
        <div className="p-8 border-b border-slate-800 font-bold text-2xl text-white flex items-center gap-4">
          <div className="p-2.5 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-900/30">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
          <span className="tracking-tight">WxBot</span>
        </div>
        
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible flex-1 p-6 gap-3">
          {[
            { id: 'dashboard', label: t.dashboard, icon: QrCode },
            { id: 'groups', label: t.groups, icon: Users },
            { id: 'tasks', label: t.tasks, icon: List },
            { id: 'logs', label: t.logs, icon: FileText },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={clsx(
                "flex items-center gap-4 px-5 py-3.5 text-sm font-semibold transition-all rounded-xl min-w-[140px] md:min-w-0 group",
                activeTab === item.id 
                  ? "bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-900/20 translate-x-1" 
                  : "hover:bg-slate-800 hover:text-white hover:translate-x-1"
              )}
            >
              <item.icon className={clsx("w-5 h-5 transition-colors", activeTab === item.id ? "text-white" : "text-slate-500 group-hover:text-white")} />
              {item.label}
            </button>
          ))}
        </nav>
        
        <div className="p-6 border-t border-slate-800">
             <button 
                onClick={() => {
                    setConfirmDialog({
                        isOpen: true,
                        title: t.logout,
                        message: '确定要退出登录吗？',
                        onConfirm: () => {
                             // Fire and forget logout log
                             axios.post('/api/logout').catch((e) => console.error('Logout log failed', e));
                             
                             // Reset state
                             setPassword('');
                             setToken(null);
                             resetAppState();
                             setIsAuthenticated(false);
                        }
                    });
                }}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-semibold text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-xl transition-all mb-2"
             >
                 <XCircle className="w-5 h-5" /> {t.logout}
             </button>
             
             <button
               onClick={() => setShowDebug(!showDebug)}
               className={clsx(
                 "w-full flex items-center gap-3 px-5 py-3.5 text-sm font-semibold rounded-xl transition-all",
                 showDebug ? "text-yellow-400 bg-yellow-950/30" : "text-slate-400 hover:text-yellow-400 hover:bg-yellow-950/30"
               )}
             >
               <Bug className="w-5 h-5" /> 调试模式
             </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto h-screen bg-gray-50/50">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 sticky top-0 z-10 flex justify-between items-center shadow-sm">
            <h2 className="text-xl font-bold text-gray-800">
                {activeTab === 'dashboard' && t.dashboard}
                {activeTab === 'groups' && t.groups}
                {activeTab === 'tasks' && t.tasks}
                {activeTab === 'logs' && t.logs}
            </h2>
            <div className="flex items-center gap-4">
                <div className="text-sm text-gray-500">
                    {new Date().toLocaleDateString()}
                </div>
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold border border-green-200">
                    A
                </div>
            </div>
        </header>

        <div className="p-6 md:p-8 max-w-7xl mx-auto">
        {activeTab === 'dashboard' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">{t.botStatus}</h1>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center">
              <div className={clsx(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-4",
                botStatus.status === 'logged_in' ? "bg-green-100 text-green-800" :
                botStatus.status === 'waiting_for_scan' ? "bg-yellow-100 text-yellow-800" :
                "bg-gray-100 text-gray-800"
              )}>
                {botStatus.status === 'logged_in' && <CheckCircle className="w-4 h-4" />}
                {botStatus.status === 'waiting_for_scan' && <RefreshCw className="w-4 h-4 animate-spin" />}
                {botStatus.status === 'offline' && <XCircle className="w-4 h-4" />}
                {botStatus.status === 'logged_in' ? t.loggedIn : 
                 botStatus.status === 'waiting_for_scan' ? t.waitingForScan : 
                 t.offline}
              </div>

              {botStatus.status === 'logged_in' && botStatus.user && (
                <div className="space-y-2">
                    <div className="text-lg">
                      {t.loggedInAs} <span className="font-bold">{botStatus.user.name}</span>
                    </div>
                    {botStatus.loginTime && (
                        <LoginDuration startTime={botStatus.loginTime} />
                    )}
                </div>
              )}

              {botStatus.status === 'logged_in' && !botStatus.ready && (
                 <div className="mt-4 flex items-center justify-center gap-2 text-yellow-600">
                     <RefreshCw className="w-4 h-4 animate-spin" /> {t.syncing}
                 </div>
              )}

              {botStatus.status === 'waiting_for_scan' && qrCode && (
                <div className="mt-4 flex flex-col items-center">
                  <p className="text-gray-500 mb-4">{t.scanQr}</p>
                  <img 
                    src={qrCode} 
                    alt="QR Code" 
                    className="w-64 h-64 border-2 border-gray-100 rounded-lg"
                  />
                </div>
              )}
              
              {botStatus.status === 'offline' && (
                  <div className="mt-4 text-gray-500">
                      Check server logs if bot doesn't start.
                  </div>
              )}

              <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-left mb-6">
                      <h3 className="font-bold text-orange-800 text-sm mb-1">{t.riskWarningTitle}</h3>
                      <p className="text-orange-700 text-xs leading-relaxed">{t.riskWarningContent}</p>
                  </div>

                  <button 
                    onClick={restartBot}
                    disabled={isRestarting}
                    className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                      <RefreshCw className={clsx("w-4 h-4", isRestarting && "animate-spin")} />
                      {isRestarting ? t.restarting : t.refreshQr}
                  </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'groups' && (
          <div className="space-y-4">
             <div className="flex justify-between items-center flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-gray-800">{t.managedGroups}</h1>
                <div className="flex items-center gap-2">
                    <input 
                        type="text" 
                        placeholder={t.searchGroups}
                        className="p-2 border border-gray-300 rounded"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <button onClick={fetchGroups} className="p-2 hover:bg-gray-100 rounded-full">
                        <RefreshCw className="w-5 h-5 text-gray-600" />
                    </button>
                </div>
             </div>
             
             {botStatus.status !== 'logged_in' ? (
                 <div className="text-center py-12 text-gray-500">{t.pleaseLogin}</div>
             ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredGroups.map(group => (
                    <div key={group.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <h3 className="font-bold text-gray-900 truncate" title={group.topic}>{group.topic}</h3>
                      <p className="text-sm text-gray-500 mt-1">{group.memberCount} {t.members}</p>
                      <button 
                        onClick={() => {
                            setNewTask(prev => ({ ...prev, targetId: group.id, targetType: 'group' }));
                            setActiveTab('tasks');
                        }}
                        className="mt-4 w-full py-2 bg-green-50 text-green-600 rounded text-sm hover:bg-green-100"
                      >
                        {t.sendMessage}
                      </button>
                    </div>
                  ))}
                </div>
             )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="space-y-8">
            {/* Create Task Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4">{t.scheduleNew}</h2>
              <form onSubmit={createTask} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.targetType}</label>
                  <select 
                    value={newTask.targetType}
                    onChange={e => setNewTask({...newTask, targetType: e.target.value as 'group' | 'contact', targetId: ''})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="group">{t.group}</option>
                    <option value="contact">{t.contact}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectTarget}</label>
                  <select 
                    value={newTask.targetId}
                    onChange={e => setNewTask({...newTask, targetId: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    required
                  >
                    <option value="">{t.select}</option>
                    {newTask.targetType === 'group' ? (
                        groups.map(g => (
                            <option key={g.id} value={g.id}>{g.topic}</option>
                        ))
                    ) : (
                        contacts.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.messageType}</label>
                  <select 
                    value={newTask.type}
                    onChange={e => setNewTask({...newTask, type: e.target.value as any})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="text">{t.text}</option>
                    <option value="image">{t.image}</option>
                    <option value="file">{t.file}</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.content}</label>
                  <textarea 
                    value={newTask.content}
                    onChange={e => setNewTask({...newTask, content: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    rows={3}
                    required
                    placeholder={newTask.type === 'text' ? "Hello world..." : "https://example.com/image.png"}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.recurrence}</label>
                  <select 
                    value={newTask.recurrence}
                    onChange={e => setNewTask({...newTask, recurrence: e.target.value as any})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="once">{t.once}</option>
                    <option value="daily">{t.daily}</option>
                    <option value="weekly">{t.weekly}</option>
                    <option value="monthly">{t.monthly}</option>
                    <option value="interval">{t.interval}</option>
                  </select>
                </div>

                <div>
                   {newTask.recurrence === 'once' && (
                       <>
                           <label className="block text-sm font-medium text-gray-700 mb-1">{t.scheduleTime}</label>
                           <input 
                             type="datetime-local"
                             value={newTask.scheduleTime}
                             onChange={e => setNewTask({...newTask, scheduleTime: e.target.value})}
                             className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                             required
                           />
                       </>
                   )}

                   {newTask.recurrence === 'interval' && (
                       <div className="space-y-4">
                            <div>
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.startTime}</label>
                               <input 
                                 type="datetime-local"
                                 value={newTask.scheduleTime}
                                 onChange={e => setNewTask({...newTask, scheduleTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                            </div>
                           <div className="flex gap-2">
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalValue}</label>
                                   <input 
                                     type="number"
                                     min="1"
                                     value={newTask.intervalValue}
                                     onChange={e => setNewTask({...newTask, intervalValue: parseInt(e.target.value) || 1})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                     required
                                   />
                               </div>
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalUnit}</label>
                                   <select 
                                     value={newTask.intervalUnit}
                                     onChange={e => setNewTask({...newTask, intervalUnit: e.target.value as any})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                   >
                                       <option value="minute">{t.minutes}</option>
                                       <option value="hour">{t.hours}</option>
                                       <option value="day">{t.days}</option>
                                   </select>
                               </div>
                           </div>
                       </div>
                   )}

                   {newTask.recurrence === 'daily' && (
                       <>
                           <label className="block text-sm font-medium text-gray-700 mb-1">{t.everyDayAt}</label>
                           <input 
                             type="time"
                             value={newTask.uiTime}
                             onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                             className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                             required
                           />
                       </>
                   )}

                   {newTask.recurrence === 'weekly' && (
                       <div className="flex gap-2">
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfWeek}</label>
                               <select 
                                 value={newTask.uiWeekday}
                                 onChange={e => setNewTask({...newTask, uiWeekday: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                               >
                                   <option value="1">{t.monday}</option>
                                   <option value="2">{t.tuesday}</option>
                                   <option value="3">{t.wednesday}</option>
                                   <option value="4">{t.thursday}</option>
                                   <option value="5">{t.friday}</option>
                                   <option value="6">{t.saturday}</option>
                                   <option value="7">{t.sunday}</option>
                               </select>
                           </div>
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.time}</label>
                               <input 
                                 type="time"
                                 value={newTask.uiTime}
                                 onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                           </div>
                       </div>
                   )}

                   {newTask.recurrence === 'monthly' && (
                       <div className="flex gap-2">
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfMonth}</label>
                               <select 
                                 value={newTask.uiDayOfMonth}
                                 onChange={e => setNewTask({...newTask, uiDayOfMonth: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                               >
                                   {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                                       <option key={d} value={d}>{d}日</option>
                                   ))}
                               </select>
                           </div>
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.time}</label>
                               <input 
                                 type="time"
                                 value={newTask.uiTime}
                                 onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                           </div>
                       </div>
                   )}
                </div>

                <div className="flex items-end md:col-span-2">
                  <button type="submit" className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium">
                    {t.scheduleTask}
                  </button>
                </div>
              </form>
            </div>

            {/* Task List */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-bold">{t.scheduledTasks}</h2>
                    <div className="flex items-center gap-2">
                        <select 
                            value={taskFilter}
                            onChange={e => setTaskFilter(e.target.value as any)}
                            className="p-2 border border-gray-300 rounded text-sm"
                        >
                            <option value="all">{t.allTasks}</option>
                            <option value="pending">{t.pending}</option>
                            <option value="success">{t.success}</option>
                            <option value="failed">{t.failed}</option>
                        </select>
                        <button onClick={fetchTasks} className="p-2 hover:bg-gray-100 rounded-full">
                            <RefreshCw className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>
                
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="p-4">{t.target}</th>
                                <th className="p-4">{t.content}</th>
                                <th className="p-4">{t.scheduleTime}</th>
                                <th className="p-4">{t.recurrence}</th>
                                <th className="p-4">{t.status}</th>
                                <th className="p-4">{t.actions}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tasks
                                .filter(t => taskFilter === 'all' || t.status === taskFilter)
                                .map(task => (
                                <tr key={task.id} className="hover:bg-gray-50">
                                    <td className="p-4 font-medium">{task.targetName}</td>
                                    <td className="p-4 truncate max-w-xs">{task.content}</td>
                                    <td className="p-4">{new Date(task.scheduleTime).toLocaleString()}</td>
                                    <td className="p-4">
                                        <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                                            {task.recurrence === 'interval' 
                                                ? `${t.interval}: ${task.intervalValue}${t[task.intervalUnit + 's'] || task.intervalUnit}`
                                                : t[task.recurrence || 'once']}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={clsx(
                                            "px-2 py-1 rounded-full text-xs font-medium",
                                            task.status === 'success' ? "bg-green-100 text-green-700" :
                                            task.status === 'pending' ? "bg-blue-100 text-blue-700" :
                                            "bg-red-100 text-red-700"
                                        )}>
                                            {task.status === 'success' ? t.success :
                                             task.status === 'pending' ? t.pending : t.failed}
                                        </span>
                                        {task.error && <p className="text-xs text-red-500 mt-1">{task.error}</p>}
                                    </td>
                                    <td className="p-4">
                                        <button onClick={() => deleteTask(task.id)} className="text-red-500 hover:text-red-700">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {tasks.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-500">{t.noTasks}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
            <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-gray-800">{t.systemLogs}</h1>
                    <button onClick={fetchLogs} className="p-2 hover:bg-gray-100 rounded-full">
                        <RefreshCw className="w-5 h-5 text-gray-600" />
                    </button>
                 </div>
                 <div className="bg-gray-900 text-gray-300 p-4 rounded-lg font-mono text-sm h-96 overflow-y-auto">
                     {logs.map(log => (
                         <div key={log.id} className="mb-1 border-b border-gray-800 pb-1">
                             <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                             <span className={clsx(
                                 "ml-2 font-bold",
                                 log.level === 'error' ? "text-red-400" : "text-blue-400"
                             )}>{log.level.toUpperCase()}</span>: 
                             <span className="ml-2 text-white">{log.message}</span>
                         </div>
                     ))}
                     {logs.length === 0 && <div className="text-gray-600">{t.noLogs}</div>}
                 </div>
            </div>
        )}
        </div>
      </main>

      {/* Toasts */}
      {createPortal(
        <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className={clsx(
              "px-4 py-3 rounded-lg shadow-lg text-white font-medium min-w-[200px] animate-in slide-in-from-right pointer-events-auto flex items-center gap-2",
              t.type === 'success' ? "bg-green-600" : t.type === 'error' ? "bg-red-600" : "bg-blue-600"
            )}>
               {t.type === 'success' && <CheckCircle className="w-5 h-5" />}
               {t.type === 'error' && <XCircle className="w-5 h-5" />}
               {t.type === 'info' && <FileText className="w-5 h-5" />}
               {t.message}
            </div>
          ))}
        </div>,
        document.body
      )}

      {/* Debug Console */}
      {showDebug && createPortal(
          <div className="fixed bottom-0 left-0 right-0 h-64 bg-black/90 text-green-400 font-mono text-xs z-[9999] overflow-hidden flex flex-col border-t border-gray-700">
              <div className="flex justify-between items-center px-4 py-2 bg-gray-800 border-b border-gray-700">
                  <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      <span className="font-bold">Debug Console</span>
                  </div>
                  <button onClick={() => setDebugLogs([])} className="text-gray-400 hover:text-white">Clear</button>
                  <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white">Close</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                  {debugLogs.length === 0 && <div className="text-gray-600 italic">No logs yet...</div>}
                  {debugLogs.map(log => (
                      <div key={log.id} className="break-all border-b border-gray-800/50 pb-0.5">
                          <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          <span className={clsx(
                              "mx-2 font-bold uppercase w-12 inline-block",
                              log.type === 'error' ? "text-red-500" : log.type === 'warn' ? "text-yellow-500" : "text-blue-500"
                          )}>{log.type}</span>
                          <span className="text-gray-300 whitespace-pre-wrap">{log.message}</span>
                      </div>
                  ))}
              </div>
          </div>,
          document.body
      )}

      {/* Confirm Dialog */}
      {confirmDialog.isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100 opacity-100">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
              <p className="text-gray-500 mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={closeConfirm}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={async () => {
                    try {
                      await confirmDialog.onConfirm();
                    } catch (e) {
                      console.error(e);
                    } finally {
                      closeConfirm();
                    }
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-lg shadow-red-900/20 transition-all active:scale-95"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default App
