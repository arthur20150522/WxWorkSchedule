import React from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { BotStatus } from '../types';
import { LoginDuration } from '../components/LoginDuration';

interface DashboardViewProps {
    botStatus: BotStatus;
    isStatusLoading: boolean;
    qrCode: string | null;
    isRestarting: boolean;
    onRestartBot: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ 
    botStatus, isStatusLoading, qrCode, isRestarting, onRestartBot 
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
              </>
            )}

            <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-left mb-6">
                      <h3 className="font-bold text-orange-800 text-sm mb-1">{t.riskWarningTitle}</h3>
                      <p className="text-orange-700 text-xs leading-relaxed">{t.riskWarningContent}</p>
                  </div>

                  <button 
                    onClick={onRestartBot}
                    disabled={isRestarting}
                    className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                      <RefreshCw className={clsx("w-4 h-4", isRestarting && "animate-spin")} />
                      {isRestarting ? t.restarting : t.refreshQr}
                  </button>
              </div>
            </div>
          </div>
    );
};
