import { wxBridge } from './wxBridge.js';

let online = false;
let loginTime: string | null = null;

export const BotManager = {
  /** Try to connect to wx4py bridge */
  async init(): Promise<boolean> {
    try {
      const status = await wxBridge.status();
      if (status.connected) {
        online = true;
        loginTime = new Date().toISOString();
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

  /** Disconnect and reconnect */
  async restart(): Promise<boolean> {
    online = false;
    loginTime = null;
    return this.init();
  },

  /** Get current bot status */
  getStatus(): { online: boolean; loginTime: string | null } {
    return { online, loginTime };
  },
};
