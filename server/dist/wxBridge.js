/**
 * wxBridge — lightweight HTTP client for the Python wx4py bridge.
 * The bridge runs on 127.0.0.1:39800 and wraps all WeChat operations.
 */
const BRIDGE_URL = process.env.WX_BRIDGE_URL || 'http://127.0.0.1:39800';
async function fetchBridge(path, options) {
    const url = `${BRIDGE_URL}${path}`;
    try {
        const resp = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...options?.headers },
        });
        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Bridge HTTP ${resp.status}: ${body}`);
        }
        return await resp.json();
    }
    catch (e) {
        if (e.cause?.code === 'ECONNREFUSED') {
            throw new Error('wx4py bridge is not running. Start it with: python bridge.py');
        }
        throw e;
    }
}
export const wxBridge = {
    /** Check if the bridge is healthy */
    async health() {
        try {
            const data = await fetchBridge('/health');
            return data.ok === true;
        }
        catch {
            return false;
        }
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
            body: JSON.stringify({ target, message, target_type: targetType || 'contact' }),
        });
    },
    /** Batch send to multiple targets */
    async batchSend(targets, message, targetType) {
        return fetchBridge('/batch-send', {
            method: 'POST',
            body: JSON.stringify({ targets, message, target_type: targetType || 'contact' }),
        });
    },
    /** Trigger auto-recovery (dismiss popup + click login) */
    async recover() {
        return fetchBridge('/recover');
    },
};
