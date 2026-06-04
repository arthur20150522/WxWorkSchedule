import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, Loader2, AlertTriangle, BarChart3, ShieldOff, LogIn, Zap, Power, PowerOff, Clock } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { BotStatus, TaskStats } from '../types';
import axios from 'axios';

interface DashboardViewProps {
    botStatus: BotStatus;
    isStatusLoading: boolean;
    fetchTasks: () => Promise<void>;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const statCard = (value: number, label: string, color: string) => (
    <div className={clsx("rounded-lg p-3 text-center", color)}>
        <div className="text-xl font-bold">{value}</div>
        <div className="text-xs mt-0.5 opacity-75">{label}</div>
    </div>
);

const TaskBoard: React.FC<{ stats: TaskStats }> = ({ stats }) => {
    const items: { value: number; label: string; color: string }[] = [
        { value: stats.total,   label: t.taskTotal,   color: 'bg-slate-100 text-slate-700' },
        { value: stats.pending, label: t.taskPending, color: 'bg-indigo-50 text-indigo-700' },
        { value: stats.todayPending, label: t.taskTodayPending, color: stats.todayPending > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500' },
        { value: stats.overduePending, label: t.taskOverdue, color: stats.overduePending > 0 ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-500' },
        { value: stats.failed,  label: t.taskFailed,  color: stats.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500' },
        { value: stats.once,    label: t.taskOnce,    color: 'bg-amber-50 text-amber-700' },
        { value: stats.daily,   label: t.taskDaily,   color: 'bg-blue-50 text-blue-700' },
        { value: stats.weekly,  label: t.taskWeekly,  color: 'bg-sky-50 text-sky-700' },
        { value: stats.monthly, label: t.taskMonthly, color: 'bg-purple-50 text-purple-700' },
        { value: stats.interval,label: t.taskInterval,color: 'bg-cyan-50 text-cyan-700' },
    ];

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-9 gap-2">
            {items.map(item => statCard(item.value, item.label, item.color))}
        </div>
    );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
    botStatus, isStatusLoading, fetchTasks, showToast
}) => {
    const [canceling, setCanceling] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [killing, setKilling] = useState(false);
    const [launching, setLaunching] = useState(false);
    const [wechatProc, setWechatProc] = useState<{running: boolean; pidCount: number}>({running: false, pidCount: 0});
    const [wechatSched, setWechatSched] = useState({enabled: false, killTime: '03:00', launchTime: '06:00'});
    const [schedSaving, setSchedSaving] = useState(false);
    const hasQueue = botStatus.queueLength > 0;

    // Fetch WeChat process status
    const fetchWechatStatus = async () => {
        try {
            const res = await axios.get('/api/wechat/status');
            setWechatProc({running: res.data.running, pidCount: res.data.pidCount});
        } catch { /* ignore */ }
    };

    // Fetch WeChat schedule
    const fetchWechatSchedule = async () => {
        try {
            const res = await axios.get('/api/wechat/schedule');
            setWechatSched(res.data);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        fetchWechatStatus();
        fetchWechatSchedule();
        const iv = setInterval(fetchWechatStatus, 30000);
        return () => clearInterval(iv);
    }, []);

    const handleKillWeChat = async () => {
        if (!confirm('确定要关闭微信进程吗？\n\n所有WeChatAppEx.exe进程将被终止。')) return;
        setKilling(true);
        try {
            const res = await axios.post('/api/wechat/kill');
            showToast(res.data.message || '微信已关闭', 'success');
            fetchWechatStatus();
        } catch (e: any) {
            showToast('关闭失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally { setKilling(false); }
    };

    const handleLaunchWeChat = async () => {
        setLaunching(true);
        try {
            const res = await axios.post('/api/wechat/launch');
            showToast(res.data.message || '微信已拉起', 'success');
            fetchWechatStatus();
        } catch (e: any) {
            showToast('拉起失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally { setLaunching(false); }
    };

    const handleSaveSchedule = async () => {
        setSchedSaving(true);
        try {
            await axios.put('/api/wechat/schedule', wechatSched);
            showToast('定时任务已保存', 'success');
            fetchWechatSchedule();
        } catch (e: any) {
            showToast('保存失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally { setSchedSaving(false); }
    };

    const handleAutoLogin = async () => {
        setIsRecovering(true);
        try {
            const res = await axios.post('/api/bridge/recover');
            showToast(res.data?.message || '恢复已触发，等待微信响应...', 'info');
        } catch (e: any) {
            showToast('恢复失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally {
            setIsRecovering(false);
        }
    };

    const handleEmergencyCancel = async () => {
        if (!confirm('确定要紧急取消所有待发送和处理中的任务吗？\n\n此操作会将这些任务标记为失败，不会删除它们。')) return;
        setCanceling(true);
        try {
            const res = await axios.post('/api/tasks/cancel-pending');
            showToast(`一次性任务取消 ${res.data.cancelled} 个，周期任务已推到下次 ${res.data.rescheduled} 个`, 'success');
            fetchTasks();
        } catch (e: any) {
            showToast('取消失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally {
            setCanceling(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">{t.botStatus}</h1>

            {/* WeChat 进程管理 */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                        <Power className="w-4 h-4" />
                        微信进程
                    </h2>
                    <div className="flex items-center gap-2">
                        <span className={clsx(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium",
                            wechatProc.running ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        )}>
                            <span className={clsx("w-2 h-2 rounded-full", wechatProc.running ? "bg-green-500" : "bg-gray-400")} />
                            {wechatProc.running ? `运行中 (${wechatProc.pidCount}进程)` : '未运行'}
                        </span>
                        <button
                            onClick={fetchWechatStatus}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"
                            title="刷新状态"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleLaunchWeChat}
                        disabled={launching || wechatProc.running}
                        className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5"
                    >
                        {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                        {launching ? '拉起中...' : '打开微信'}
                    </button>
                    <button
                        onClick={handleKillWeChat}
                        disabled={killing || !wechatProc.running}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5"
                    >
                        {killing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                        {killing ? '关闭中...' : '关闭微信'}
                    </button>
                </div>

                {/* 定时重启 */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-gray-600 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            定时重启微信
                        </h3>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <span className="text-xs text-gray-400">{wechatSched.enabled ? '已启用' : '已禁用'}</span>
                            <button
                                onClick={() => setWechatSched({...wechatSched, enabled: !wechatSched.enabled})}
                                className={clsx(
                                    "relative w-9 h-5 rounded-full transition-colors",
                                    wechatSched.enabled ? "bg-green-500" : "bg-gray-300"
                                )}
                            >
                                <span className={clsx(
                                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                                    wechatSched.enabled ? "translate-x-4" : "translate-x-0.5"
                                )} />
                            </button>
                        </label>
                    </div>
                    {wechatSched.enabled && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 w-14">关闭时间</span>
                                <input
                                    type="time"
                                    value={wechatSched.killTime}
                                    onChange={e => setWechatSched({...wechatSched, killTime: e.target.value})}
                                    className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-red-300"
                                />
                                <span className="text-xs text-gray-400">杀掉微信进程</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 w-14">打开时间</span>
                                <input
                                    type="time"
                                    value={wechatSched.launchTime}
                                    onChange={e => setWechatSched({...wechatSched, launchTime: e.target.value})}
                                    className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-green-300"
                                />
                                <span className="text-xs text-gray-400">拉起微信进程</span>
                            </div>
                            <button
                                onClick={handleSaveSchedule}
                                disabled={schedSaving}
                                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 mt-1"
                            >
                                {schedSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                {schedSaving ? '保存中...' : '保存定时'}
                            </button>
                            <p className="text-xs text-gray-400 text-center mt-1">
                                每天 {wechatSched.killTime} 关闭，{wechatSched.launchTime} 拉起，绕过微信夜间踢号
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Bot 连接状态 */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center">
                {isStatusLoading ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <RefreshCw className="w-8 h-8 animate-spin text-green-500 mb-4" />
                        <p className="text-gray-500">正在检查登录状态...</p>
                    </div>
                ) : (
                    <>
                        <div className={clsx(
                            "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-4",
                            botStatus.online ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                        )}>
                            {botStatus.online ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                            {botStatus.online ? t.wx4pyOnline : t.wx4pyOffline}
                        </div>

                        {!botStatus.online && (
                            <div className="mt-4 space-y-3">
                                <p className="text-gray-500 text-sm">
                                    {botStatus.bridgeState === 'popup' ? '检测到"已退出"弹窗' :
                                     botStatus.bridgeState === 'login' ? '微信在登录页' :
                                     botStatus.bridgeState === 'waiting' ? '等待手机确认登录' :
                                     t.wx4pyNotConnected}
                                </p>
                                <button
                                    onClick={handleAutoLogin}
                                    disabled={isRecovering}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    {isRecovering ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <LogIn className="w-4 h-4" />
                                    )}
                                    {isRecovering ? '恢复中...' : '尝试登录'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 任务大盘 */}
            {botStatus.taskStats && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-gray-400" />
                        {t.taskDashboard}
                    </h2>
                    <TaskBoard stats={botStatus.taskStats} />
                    {botStatus.taskStats.total === 0 && (
                        <div className="mt-3 text-center text-sm text-gray-400">暂无任务</div>
                    )}
                </div>
            )}

            {/* 队列状态 */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Loader2 className={clsx("w-5 h-5", hasQueue ? "animate-spin text-blue-500" : "text-gray-400")} />
                    {t.queueStatus}
                </h2>

                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-blue-700">{botStatus.queueLength}</div>
                        <div className="text-xs text-blue-500 mt-1">{t.queueLength}</div>
                    </div>

                    <div className={clsx("rounded-lg p-4 text-center", hasQueue ? "bg-green-50" : "bg-gray-50")}>
                        <div className={clsx("text-sm font-medium truncate", hasQueue ? "text-green-700" : "text-gray-400")}>
                            {botStatus.currentTarget || '空闲'}
                        </div>
                        <div className="text-xs mt-1" style={{ color: hasQueue ? '#16a34a' : '#9ca3af' }}>{t.currentTarget}</div>
                    </div>

                    <div className={clsx("rounded-lg p-4 text-center", botStatus.lastError ? "bg-red-50" : "bg-gray-50")}>
                        <div className={clsx("text-xs font-medium truncate", botStatus.lastError ? "text-red-700" : "text-gray-400")}>
                            {botStatus.lastError || '正常'}
                        </div>
                        <div className={clsx("text-xs mt-1", botStatus.lastError ? "text-red-500" : "text-gray-400")}>{t.lastError}</div>
                    </div>
                </div>

                {!hasQueue && (
                    <div className="mt-4 text-center text-sm text-gray-400">{t.queueEmpty}</div>
                )}
            </div>

            {/* 紧急操作 */}
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5">
                <h3 className="font-bold text-red-800 text-sm mb-3 flex items-center gap-1">
                    <ShieldOff className="w-4 h-4" />
                    紧急操作
                </h3>
                <p className="text-red-600 text-xs mb-3 leading-relaxed">
                    立即将所有“待发送”和“发送中”的任务标记为失败，阻止其继续执行。任务不会被删除，可事后在任务管理中查看。
                </p>
                <button
                    onClick={handleEmergencyCancel}
                    disabled={canceling}
                    className="w-full py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {canceling ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />执行中...</>
                    ) : (
                        <><ShieldOff className="w-4 h-4" />紧急清空任务队列</>
                    )}
                </button>
            </div>

            {/* 恢复失败任务 */}
            <div className="bg-green-50 border-2 border-green-300 rounded-xl p-5">
                <h3 className="font-bold text-green-800 text-sm mb-3 flex items-center gap-1">
                    <RefreshCw className="w-4 h-4" />
                    恢复周期任务
                </h3>
                <p className="text-green-600 text-xs mb-3 leading-relaxed">
                    将所有“失败”状态的周期性任务（每天/每周/每月/间隔）重置为“待发送”，恢复其正常调度。
                </p>
                <button
                    onClick={async () => {
                        if (!confirm('确定要恢复所有失败状态的周期任务吗？')) return;
                        try {
                            const res = await axios.post('/api/tasks/recover-failed');
                            showToast(`已恢复 ${res.data.count} 个周期任务`, 'success');
                            fetchTasks();
                        } catch (e: any) {
                            showToast('恢复失败: ' + (e.response?.data?.error || e.message), 'error');
                        }
                    }}
                    className="w-full py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" />恢复失败周期任务
                </button>
            </div>

            {/* 快速恢复 — 一键拉回今天 */}
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-5">
                <h3 className="font-bold text-yellow-800 text-sm mb-3 flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    快速恢复
                </h3>
                <p className="text-yellow-600 text-xs mb-3 leading-relaxed">
                    将所有被推后的任务（"已推到下次"）重新排到今天。微信掉线恢复后一键拉回。
                </p>
                <button
                    onClick={async () => {
                        if (!confirm('确认将所有被推后的任务重置到今天吗？\n\n这些任务会保持原来的发送时间（如午餐11:00），但日期改为今天。')) return;
                        try {
                            const res = await axios.post('/api/tasks/quick-recover');
                            showToast(`已恢复 ${res.data.count} 个任务到今日`, 'success');
                            fetchTasks();
                        } catch (e: any) {
                            showToast('恢复失败: ' + (e.response?.data?.error || e.message), 'error');
                        }
                    }}
                    className="w-full py-2.5 bg-yellow-600 text-white font-bold rounded-lg hover:bg-yellow-700 transition flex items-center justify-center gap-2"
                >
                    <Zap className="w-4 h-4" />快速恢复今日任务
                </button>
            </div>

            {/* 风险提示 */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-bold text-orange-800 text-sm mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    {t.riskWarningTitle}
                </h3>
                <p className="text-orange-700 text-xs leading-relaxed">{t.riskWarningContent}</p>
            </div>
        </div>
    );
};
