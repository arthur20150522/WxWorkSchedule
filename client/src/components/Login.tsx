import React, { useState } from 'react';
import axios from 'axios';
import { MessageSquare, Loader2, AlertCircle } from 'lucide-react';
import { t } from '../utils/i18n';

interface LoginProps {
    onLoginSuccess: (token: string, username: string) => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, showToast }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await axios.post('/api/login', { username, password });
            if (res.data.token) {
                onLoginSuccess(res.data.token, username);
            } else {
                setError('服务器返回异常，未收到 token');
            }
        } catch (e: any) {
            if (e.response) {
                // 服务器有响应
                const status = e.response.status;
                const msg = e.response.data?.error || '';

                if (status === 401) {
                    setError('用户名或密码错误');
                    showToast(t.invalidPassword, 'error');
                } else if (status === 400) {
                    setError('请求参数错误: ' + msg);
                } else if (status >= 500) {
                    setError('服务器错误: ' + msg);
                } else {
                    setError('登录失败 (' + status + '): ' + msg);
                }
            } else if (e.request) {
                // 请求发出但无响应
                setError('无法连接到服务器，请确认 Server 已启动 (端口 3000)');
            } else {
                // 请求本身出错
                setError('请求失败: ' + e.message);
            }
        } finally {
            setLoading(false);
        }
    };

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
                    {/* 错误提示 */}
                    {error && (
                        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                            <p className="text-red-300 text-sm">{error}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300 ml-1">用户名</label>
                        <input
                            type="text"
                            className="w-full p-4 bg-gray-900/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-white placeholder-gray-500"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="admin"
                            disabled={loading}
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
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-500 hover:to-emerald-500 font-bold tracking-wide transition-all shadow-lg shadow-green-900/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                登录中...
                            </>
                        ) : (
                            t.login
                        )}
                    </button>
                </form>

                <div className="mt-6 pt-6 border-t border-gray-700/50">
                    <p className="text-xs text-gray-500 text-center">
                        默认账号: admin | 密码见 server/.user 文件
                    </p>
                </div>
            </div>
        </div>
    );
};
