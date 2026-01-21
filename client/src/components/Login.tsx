import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { t } from '../utils/i18n';
import axios from 'axios';

interface LoginProps {
    onLoginSuccess: (token: string, username: string, remember: boolean, password?: string) => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, showToast }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);

    // Simple Base64 encryption for frontend demo
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
            onLoginSuccess(res.data.token, username, rememberMe, password);
        } catch (e: any) {
            if (e.response && e.response.status === 401) {
                showToast(t.invalidPassword, 'error');
            } else {
                showToast('Login failed: ' + (e.response?.data?.error || e.message), 'error');
            }
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
};
