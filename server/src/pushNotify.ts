/**
 * Mobile push notification via chuckfang MeoW API.
 * Pushes a message to the user's phone when critical events occur.
 */
const PUSH_BASE = 'https://api.chuckfang.com/eastpolar';
const PUSH_ENABLED = true;

export async function pushNotify(title: string, message: string): Promise<void> {
  if (!PUSH_ENABLED) return;
  try {
    const url = `${PUSH_BASE}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
    const resp = await fetch(url);
    const result = await resp.json() as { status: number; message?: string };
    if (result.status === 200) {
      console.log(`[Push] Notified: ${title} — ${message.substring(0, 50)}`);
    } else {
      console.warn(`[Push] Failed (${result.status}): ${result.message}`);
    }
  } catch (e) {
    console.error('[Push] Notification failed:', (e as Error).message);
  }
}
