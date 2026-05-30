import { useState, useEffect } from 'react';
import axios from 'axios';
import { BotStatus, Contact, Task, Template, LiveLog } from './types';
import { t } from './utils/i18n';
import { useToast } from './hooks/useToast';
import { useConfirmDialog } from './hooks/useConfirmDialog';

import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialog } from './components/ConfirmDialog';

import { DashboardView } from './views/DashboardView';
import { ContactsView } from './views/ContactsView';
import { LiveSendView } from './views/LiveSendView';
import { TemplatesView } from './views/TemplatesView';
import { TasksView } from './views/TasksView';
import { LogsView } from './views/LogsView';

type TabId = 'dashboard' | 'contacts' | 'liveSend' | 'templates' | 'tasks' | 'logs';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [botStatus, setBotStatus] = useState<BotStatus>({ online: false, queueLength: 0 });
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [liveLogs, setLiveLogs] = useState<LiveLog[]>([]);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<Partial<Task> | undefined>(undefined);

  const { toasts, showToast } = useToast();
  const { confirmDialog, closeConfirm } = useConfirmDialog();

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
                setIsAuthenticated(false);
                setToken(null);
                showToast('登录已过期，请重新登录', 'info');
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
    } catch (e) {
      console.error(e);
    } finally {
        setIsStatusLoading(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await axios.get('/api/contacts');
      setContacts(res.data || []);
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

  const fetchLiveLogs = async () => {
    try {
      const res = await axios.get('/api/live-logs');
      if (Array.isArray(res.data)) {
        setLiveLogs(res.data);
      }
    } catch (e) {
      console.error('Failed to fetch live-logs:', e);
    }
  };

  const handleLoginSuccess = (newToken: string, _username: string) => {
      setToken(newToken);
      setIsAuthenticated(true);
  };

  const handleGenerateTask = async (template: Template) => {
      if (!template.targets || template.targets.length === 0) {
          setDraftTask({
              content: template.content,
              recurrence: template.recurrence,
              intervalValue: template.intervalValue,
              intervalUnit: template.intervalUnit,
              uiTime: template.uiTime,
              uiWeekdays: template.uiWeekdays,
              uiDayOfMonth: template.uiDayOfMonth
          });
          setActiveTab('tasks');
          showToast('请选择发送对象', 'info');
          return;
      }

      const scheduleTime = prompt('请输入发送时间 (YYYY-MM-DDTHH:mm) 或留空立即发送');
      if (scheduleTime === null) return;

      const finalTime = scheduleTime ? new Date(scheduleTime).toISOString() : new Date().toISOString();

      try {
          let count = 0;
          for (const target of template.targets) {
              await axios.post('/api/tasks', {
                  type: template.type,
                  content: template.content,
                  targetType: target.type,
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
    fetchContacts();
    fetchTemplates();
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
    }

    if (activeTab === 'contacts') {
        fetchContacts();
    }

    if (activeTab === 'liveSend') {
        fetchLiveLogs();
    }
  }, [isAuthenticated, activeTab]);

  if (!isAuthenticated) {
      return <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-slate-800">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 overflow-y-auto h-screen bg-gray-50/50">
         <header className="bg-white border-b border-gray-200 px-8 py-4 sticky top-0 z-10 flex justify-between items-center shadow-sm">
            <h2 className="text-xl font-bold text-gray-800">
                {activeTab === 'dashboard' && t.dashboard}
                {activeTab === 'contacts' && t.contacts}
                {activeTab === 'liveSend' && t.liveSend}
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
                  fetchTasks={fetchTasks}
                  showToast={showToast}
              />
          )}
          {activeTab === 'contacts' && (
              <ContactsView
                  contacts={contacts}
                  fetchContacts={fetchContacts}
                  showToast={showToast}
              />
          )}
          <div style={{ display: activeTab === 'liveSend' ? 'block' : 'none' }}>
              <LiveSendView liveLogs={liveLogs} fetchLiveLogs={fetchLiveLogs} />
          </div>
          {activeTab === 'templates' && (
              <TemplatesView
                  templates={templates}
                  fetchTemplates={fetchTemplates}
                  showToast={showToast}
                  onGenerateTask={handleGenerateTask}
                  contacts={contacts}
              />
          )}
          {activeTab === 'tasks' && (
              <TasksView
                  tasks={tasks}
                  templates={templates}
                  fetchTasks={fetchTasks}
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
