/**
 * wxBridge — lightweight HTTP client for the Python wx4py bridge.
 * The bridge runs on 127.0.0.1:39800 and wraps all WeChat operations.
 */

const BRIDGE_URL = process.env.WX_BRIDGE_URL || 'http://127.0.0.1:39800';

interface SendResult {
  success: boolean;
  error?: string;
  results?: Record<string, boolean>;
}

interface SearchResult {
  id: string;
  name: string;
  type: 'group' | 'contact';
  category: string;
}

interface GroupInfo {
  id: string;
  topic: string;
  memberCount: number;
}

interface ContactInfo {
  id: string;
  name: string;
  type: string;
}

async function fetchBridge(path: string, options?: RequestInit): Promise<any> {
  const url = `${BRIDGE_URL}${path}`;
  const timeout = options?.signal ? undefined : AbortSignal.timeout(30000);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: timeout || options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Bridge HTTP ${resp.status}: ${body}`);
    }
    return await resp.json();
  } catch (e: any) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error('wx4py bridge request timeout (30s)');
    }
    if (e.cause?.code === 'ECONNREFUSED') {
      throw new Error('wx4py bridge is not running. Start it with: python bridge.py');
    }
    throw e;
  }
}

export const wxBridge = {
  /** Check if the bridge is healthy */
  async health(): Promise<boolean> {
    try {
      const data = await fetchBridge('/health');
      return data.ok === true;
    } catch {
      return false;
    }
  },

  /** Get WeChat connection status */
  async status(): Promise<{ connected: boolean; error?: string }> {
    return fetchBridge('/status');
  },

  /** Search groups and contacts by keyword */
  async search(q: string, type?: 'group' | 'contact' | 'all'): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    const data = await fetchBridge(`/search?${params.toString()}`);
    return data.results || [];
  },

  /** Get all groups (scanned from chat list) */
  async groups(): Promise<GroupInfo[]> {
    return fetchBridge('/groups');
  },

  /** Get all contacts (scanned from chat list) */
  async contacts(): Promise<ContactInfo[]> {
    return fetchBridge('/contacts');
  },

  /** Send a message to a group or contact */
  async send(target: string, message: string, targetType: 'group' | 'contact'): Promise<SendResult> {
    return fetchBridge('/send', {
      method: 'POST',
      body: JSON.stringify({ target, message, targetType }),
    });
  },

  /** Batch send to multiple targets */
  async batchSend(targets: string[], message: string, targetType: 'group' | 'contact'): Promise<SendResult> {
    return fetchBridge('/batch-send', {
      method: 'POST',
      body: JSON.stringify({ targets, message, targetType }),
    });
  },
};
