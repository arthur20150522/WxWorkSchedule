import React, { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, Loader2, AlertTriangle, BarChart3, ShieldOff } from 'lucide-react';
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
        { value: stats.once,    label: t.taskOnce,    color: 'bg-amber-50 text-amber-700' },
        { value: stats.daily,   label: t.taskDaily,   color: 'bg-blue-50 text-blue-700' },
        { value: stats.weekly,  label: t.taskWeekly,  color: 'bg-green-50 text-green-700' },
        { value: stats.monthly, label: t.taskMonthly, color: 'bg-purple-50 text-purple-700' },
        { value: stats.interval,label: t.taskInterval,color: 'bg-cyan-50 text-cyan-700' },
        { value: stats.pending, label: t.taskPending, color: 'bg-indigo-50 text-indigo-700' },
        { value: stats.overduePending, label: t.taskOverdue, color: stats.overduePending > 0 ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-500' },
        { value: stats.failed,  label: t.taskFailed,  color: stats.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500' },
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
    const hasQueue = botStatus.queueLength > 0;

    const handleEmergencyCancel = async () => {
        if (!confirm('确定要紧急取消所有待发送和处理中的任务吗？\n\n此操作会将这些任务标记为失败，不会删除它们。')) return;
        setCanceling(true);
        try {
            const res = await axios.post('/api/tasks/cancel-pending');
            showToast(`已紧急取消 ${res.data.count} 个任务`, 'success');
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
                            <div className="mt-4 text-gray-500 text-sm">
                                {t.wx4pyNotConnected}
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
