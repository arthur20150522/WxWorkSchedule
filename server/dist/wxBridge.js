/**
 * wxBridge — lightweight HTTP client for the Python wx4py bridge.
 * The bridge runs on 127.0.0.1:39800 and wraps all WeChat operations.
 */
const BRIDGE_URL = process.env.WX_BRIDGE_URL || 'http://127.0.0.1:39800';
async function fetchBridge(path, options) {
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
    }
    catch (e) {
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
    /** Quick health check */
    async health() {
        try {
            const data = await fetchBridge('/health');
            return data.ok === true;
        }
        catch {
            return false;
        }
    },
    /** Deep health check: verifies WeChat UI is actually usable */
    async deepHealth() {
        return fetchBridge('/deep-health');
    },
    /** Get WeChat connection status */
    async status() {
        return fetchBridge('/status');
    },
    /** Search groups and contacts by keyword */
    async search(q, type) {
        const params = new URLSearchParams({ q });
        if (type)
            params.set('type', type);
        const data = await fetchBridge(`/search?${params.toString()}`);
        return data.results || [];
    },
    /** Get all groups (scanned from chat list) */
    async groups() {
        return fetchBridge('/groups');
    },
    /** Get all contacts (scanned from chat list) */
    async contacts() {
        return fetchBridge('/contacts');
    },
    /** Send a message to a group or contact */
    async send(target, message, targetType) {
        return fetchBridge('/send', {
            method: 'POST',
            body: JSON.stringify({ target, message, targetType }),
        });
    },
    /** Batch send to multiple targets */
    async batchSend(targets, message, targetType) {
        return fetchBridge('/batch-send', {
            method: 'POST',
            body: JSON.stringify({ targets, message, targetType }),
        });
    },
    /** Trigger auto-recovery: dismiss popups, click login button */
    async recover() {
        return fetchBridge('/recover');
    },
    /** Low-level bridge fetch with generic typing */
    async fetchBridge(path, method = 'GET', body) {
        return fetchBridge(path, method === 'POST' ? { method: 'POST', body: JSON.stringify(body || {}) } : {});
    },
};
