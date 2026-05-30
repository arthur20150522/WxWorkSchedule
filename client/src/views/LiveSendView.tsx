import React, { useState, useRef } from 'react';
import { Send, Users, User, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { LiveLog } from '../types';

interface Props {
  liveLogs: LiveLog[];
  fetchLiveLogs: () => void;
}

export function LiveSendView({ liveLogs, fetchLiveLogs }: Props) {
  const [targetName, setTargetName] = useState('');
  const [targetType, setTargetType] = useState<'group' | 'contact'>('group');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const latestRef = useRef<HTMLDivElement>(null);

  const handleSend = async () => {
    if (!targetName.trim() || !content.trim() || sending) return;

    setSending(true);
    try {
      const res = await axios.post('/api/send-live', {
        targetName: targetName.trim(),
        targetType,
        content: content.trim(),
      });

      fetchLiveLogs();
      if (res.data.success) {
        setContent('');
      }
    } catch {
      fetchLiveLogs();
    } finally {
      setSending(false);
      setTimeout(() => latestRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* 输入区 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t.liveSendTitle}</h2>
          <p className="text-sm text-gray-500 mt-1">{t.liveSendDesc}</p>
        </div>

        {/* 对象名 + 类型切换 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.liveSendTarget}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={targetName}
              onChange={e => setTargetName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.liveSendTargetPlaceholder}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <button
              onClick={() => setTargetType(t => t === 'group' ? 'contact' : 'group')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition border',
                targetType === 'group'
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
              )}
            >
              {targetType === 'group' ? <><Users className="w-4 h-4" />{t.liveSendGroup}</> : <><User className="w-4 h-4" />{t.liveSendContact}</>}
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.liveSendContent}</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.liveSendContentPlaceholder}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        </div>

        {/* 发送按钮 */}
        <button
          onClick={handleSend}
          disabled={sending || !targetName.trim() || !content.trim()}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition',
            sending || !targetName.trim() || !content.trim()
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
          )}
        >
          {sending ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{t.liveSendSending}</>
          ) : (
            <><Send className="w-4 h-4" />{t.liveSendBtn}</>
          )}
        </button>
      </div>

      {/* 发送记录 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">{t.liveSendHistory}</h3>
        {liveLogs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">{t.liveSendNoHistory}</p>
        ) : (
          <div className="space-y-2">
            {liveLogs.map((rec, i) => (
              <div
                key={rec.id}
                ref={i === 0 ? latestRef : undefined}
                className={clsx(
                  'flex items-start gap-3 p-3 rounded-lg border text-sm',
                  rec.success
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                )}
              >
                <div className="mt-0.5">
                  {rec.success
                    ? <CheckCircle className="w-5 h-5 text-green-600" />
                    : <XCircle className="w-5 h-5 text-red-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">
                      {rec.success ? t.liveSendSuccess : t.liveSendFailed}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">
                      {rec.targetType === 'group' ? <Users className="w-3 h-3 inline" /> : <User className="w-3 h-3 inline" />}
                      {' '}{rec.targetName}
                    </span>
                  </div>
                  <p className="text-gray-600 mt-0.5 break-all line-clamp-2">{rec.content}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(rec.timestamp).toLocaleTimeString()}</span>
                    <span>{t.liveSendDuration} {rec.duration}{t.liveSendMs}</span>
                    {rec.error && (
                      <span className="text-red-500 truncate">{rec.error}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
