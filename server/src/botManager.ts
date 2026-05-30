import { wxBridge } from './wxBridge.js';
import { pushNotify } from './pushNotify.js';

let online = false;
let loginTime: string | null = null;
let wasKickedNotified = false;

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
          // Only push once per offline session
          if (!wasKickedNotified) {
            pushNotify('微信掉线', `原因: ${res.reason}`);
            wasKickedNotified = true;
          }
        } else if (!wasOnline && res.ok) {
          console.log('[HealthMonitor] WeChat recovered');
          wasKickedNotified = false;
          pushNotify('微信已恢复', '');
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
