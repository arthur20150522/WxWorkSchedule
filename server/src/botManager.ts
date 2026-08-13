import { wxBridge } from './wxBridge.js';
import { pushNotify } from './pushNotify.js';
import { getQrViewUrl } from './qrRelay.js';

let online = false;
let loginTime: string | null = null;
let wasKickedNotified = false;
// One offline notice per 30min max — prevents push bombing when the bot
// flaps between offline/recovered across process restarts (in-memory only).
let lastKickPushTs = 0;
const KICK_PUSH_COOLDOWN_MS = 30 * 60 * 1000;

export const BotManager = {
  async init(): Promise<boolean> {
    try {
      const status = await wxBridge.status();
      if (status.connected) {
        online = true;
        loginTime = new Date().toISOString();
        wasKickedNotified = false;
        console.log('[BotManager] wx4py bridge connected');
        return true;
      }
      console.warn('[BotManager] wx4py bridge running but WeChat not connected');
      return false;
    } catch (e) {
      console.warn('[BotManager] wx4py bridge not reachable:', (e as Error).message);
      return false;
    }
  },

  async restart(): Promise<boolean> {
    online = false;
    loginTime = null;
    wasKickedNotified = false;
    return this.init();
  },

  getStatus(): { online: boolean; loginTime: string | null } {
    return { online, loginTime };
  },

  startHealthMonitor() {
    // 5-minute interval — frequent enough to catch kicks, rare enough to avoid suspicion
    setInterval(async () => {
      try {
        const res = await wxBridge.deepHealth();
        const wasOnline = online;
        online = res.ok;

        if (wasOnline && !res.ok) {
          console.warn(`[HealthMonitor] WeChat offline: ${res.reason}`);
          // Push once per offline session, and at most once per 30min overall
          if (!wasKickedNotified) {
            wasKickedNotified = true;
            const now = Date.now();
            if (now - lastKickPushTs >= KICK_PUSH_COOLDOWN_MS) {
              lastKickPushTs = now;
              pushNotify('微信掉线', `原因: ${res.reason}\n\n👉 点击查看实时二维码（扫码即恢复）：${getQrViewUrl()}`);
            }
          }
        } else if (!wasOnline && res.ok) {
          console.log('[HealthMonitor] WeChat recovered');
          // No recovery push — the single offline notice is enough; the QR
          // live page expires by itself once frames stop arriving.
          wasKickedNotified = false;
        }
      } catch (e) {
        // Bridge unreachable — push once
        if (online && !wasKickedNotified) {
          pushNotify('微信掉线', 'wx4py bridge 无法连接');
          online = false;
          wasKickedNotified = true;
        }
      }
    }, 300000); // 5 min
    console.log('[HealthMonitor] Started (5min interval)');
  }
};
