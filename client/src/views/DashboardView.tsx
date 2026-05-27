import React from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { BotStatus } from '../types';
import { LoginDuration } from '../components/LoginDuration';

interface DashboardViewProps {
    botStatus: BotStatus;
    isStatusLoading: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
    botStatus, isStatusLoading
}) => {
    return (
          <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">{t.botStatus}</h1>
            
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
                  botStatus.status === 'logged_in' ? "bg-green-100 text-green-800" :
                  "bg-gray-100 text-gray-800"
                )}>
                  {botStatus.status === 'logged_in' && <CheckCircle className="w-4 h-4" />}
                  {botStatus.status !== 'logged_in' && <XCircle className="w-4 h-4" />}
                  {botStatus.status === 'logged_in' ? t.wx4pyLoggedIn : t.wx4pyOffline}
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

                {botStatus.status !== 'logged_in' && (
                    <div className="mt-4 text-gray-500">
                        {t.wx4pyNotConnected}
                    </div>
                )}
              </>
            )}

            <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-left">
                      <h3 className="font-bold text-orange-800 text-sm mb-1">{t.riskWarningTitle}</h3>
                      <p className="text-orange-700 text-xs leading-relaxed">{t.riskWarningContent}</p>
                  </div>
              </div>
            </div>
          </div>
    );
};
