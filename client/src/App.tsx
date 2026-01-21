import { useState, useEffect } from 'react';
import axios from 'axios';
import { BotStatus, Group, Task, Template } from './types';
import { t } from './utils/i18n';
import { useDebugLogs } from './hooks/useDebugLogs';
import { useToast } from './hooks/useToast';
import { useConfirmDialog } from './hooks/useConfirmDialog';

import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DebugConsole } from './components/DebugConsole';

import { DashboardView } from './views/DashboardView';
import { GroupsView } from './views/GroupsView';
import { TemplatesView } from './views/TemplatesView';
import { TasksView } from './views/TasksView';
import { LogsView } from './views/LogsView';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'groups' | 'templates' | 'tasks' | 'logs'>('dashboard');
  const [botStatus, setBotStatus] = useState<BotStatus>({ status: 'offline' });
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<{id: string, name: string}[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [draftTask, setDraftTask] = useState<Partial<Task> | undefined>(undefined);

  const { debugLogs, setDebugLogs } = useDebugLogs();
  const { toasts, showToast } = useToast();
  const { confirmDialog, openConfirm, closeConfirm } = useConfirmDialog();

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
  }, [token, isAuthenticated, showToast]);

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
    } finally {
        setIsStatusLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get('/api/groups');
      setGroups(res.data);
    } catch (e: any) {
      if (e.response && e.response.status === 503) {
          // Bot not ready, ignore
          setGroups([]);
      } else {
          console.error(e);
      }
    }
  };

  const fetchContacts = async () => {
    try {
        const res = await axios.get('/api/contacts');
        setContacts(res.data);
    } catch (e: any) {
        if (e.response && e.response.status === 503) {
            // Bot not ready, ignore
            setContacts([]);
        } else {
            console.error(e);
        }
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

  const fetchTemplates = async () => {
    try {
      const res = await axios.get('/api/templates');
      if (Array.isArray(res.data)) {
          setTemplates(res.data);
      } else {
          setTemplates([]);
      }
    } catch (e) {
      console.error('Failed to fetch templates:', e);
    }
  };

  const restartBot = async () => {
    openConfirm({
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

  const handleLoginSuccess = (newToken: string, username: string, remember: boolean, password?: string) => {
      setToken(newToken);
      setIsAuthenticated(true);
      if (remember) {
          localStorage.setItem('wxbot_username', username);
          if (password) localStorage.setItem('wxbot_password', btoa(password));
      } else {
          localStorage.removeItem('wxbot_username');
          localStorage.removeItem('wxbot_password');
      }
  };

  const handleGenerateTask = async (template: Template) => {
      if (!template.targets || template.targets.length === 0) {
          // If no targets, redirect to task creation with template pre-filled
          setDraftTask({
              content: template.content,
              recurrence: template.recurrence,
              intervalValue: template.intervalValue,
              intervalUnit: template.intervalUnit,
              uiTime: template.uiTime,
              uiWeekday: template.uiWeekday,
              uiDayOfMonth: template.uiDayOfMonth
          });
          setActiveTab('tasks');
          showToast('请选择发送对象', 'info');
          return;
      }

      const scheduleTime = prompt('请输入发送时间 (YYYY-MM-DDTHH:mm) 或留空立即发送');
      if (scheduleTime === null) return; // Cancelled
      
      const finalTime = scheduleTime ? new Date(scheduleTime).toISOString() : new Date().toISOString();
      
      try {
          let count = 0;
          for (const target of template.targets) {
              await axios.post('/api/tasks', {
                  type: template.type,
                  content: template.content,
                  targetType: target.type,
                  targetId: target.id,
                  targetName: target.name,
                  scheduleTime: finalTime,
                  recurrence: 'once',
                  templateId: template.id
              });
              count++;
          }
          showToast(`成功生成 ${count} 个任务`, 'success');
          fetchTasks();
          setActiveTab('tasks');
      } catch (e) {
          showToast('生成任务失败', 'error');
      }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); 
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    
    if (activeTab === 'tasks') {
        fetchTasks();
    }
    
    if (activeTab === 'templates') {
        fetchTemplates();
        fetchGroups();
        fetchContacts();
    }
    
    if (botStatus.status === 'logged_in' && botStatus.ready) {
      fetchGroups();
      fetchContacts();
    }
  }, [botStatus.status, botStatus.ready, isAuthenticated, activeTab]);

  if (!isAuthenticated) {
      return <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-slate-800">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} showDebug={showDebug} setShowDebug={setShowDebug} />
      
      <main className="flex-1 overflow-y-auto h-screen bg-gray-50/50">
         <header className="bg-white border-b border-gray-200 px-8 py-4 sticky top-0 z-10 flex justify-between items-center shadow-sm">
            <h2 className="text-xl font-bold text-gray-800">
                {activeTab === 'dashboard' && t.dashboard}
                {activeTab === 'groups' && t.groups}
                {activeTab === 'templates' && t.templates}
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
              <DashboardView 
                  botStatus={botStatus} 
                  isStatusLoading={isStatusLoading} 
                  qrCode={qrCode} 
                  isRestarting={isRestarting} 
                  onRestartBot={restartBot} 
              />
          )}
          {activeTab === 'groups' && (
              <GroupsView 
                  groups={groups} 
                  fetchGroups={fetchGroups} 
                  botStatus={botStatus} 
                  onSendMessage={(group) => {
                      setDraftTask({ targetId: group.id, targetType: 'group' });
                      setActiveTab('tasks');
                  }} 
              />
          )}
          {activeTab === 'templates' && (
              <TemplatesView 
                  templates={templates} 
                  fetchTemplates={fetchTemplates} 
                  showToast={showToast} 
                  onGenerateTask={handleGenerateTask} 
              />
          )}
          {activeTab === 'tasks' && (
              <TasksView 
                  tasks={tasks} 
                  templates={templates}
                  fetchTasks={fetchTasks} 
                  groups={groups} 
                  contacts={contacts} 
                  showToast={showToast} 
                  initialDraft={draftTask}
              />
          )}
          {activeTab === 'logs' && (
              <LogsView />
          )}
        </div>
      </main>

      <ToastContainer toasts={toasts} />
      <DebugConsole isOpen={showDebug} logs={debugLogs} onClose={() => setShowDebug(false)} onClear={() => setDebugLogs([])} />
      <ConfirmDialog 
          isOpen={confirmDialog.isOpen} 
          title={confirmDialog.title} 
          message={confirmDialog.message} 
          onConfirm={async () => {
              try {
                  await confirmDialog.onConfirm();
              } catch (e) {
                  console.error(e);
              } finally {
                  closeConfirm();
              }
          }} 
          onCancel={closeConfirm} 
      />
    </div>
  )
}

export default App
