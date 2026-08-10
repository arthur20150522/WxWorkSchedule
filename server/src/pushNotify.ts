/**
 * Unified push notification — 推送到所有设备（鸿蒙 ChuckFang + 安卓微信 Server酱）.
 */

const CHUCKFANG_URL = 'https://api.chuckfang.com/eastpolar';
const SERVERJIANG_URL = 'https://17791.push.ft07.com/send/sctp17791t3thcbychibuxsxemwtxzwo.send';
const PUSH_ENABLED = true;

async function pushChuckFang(title: string, message: string, imageUrl?: string): Promise<boolean> {
  try {
    // With image: POST msgType=html so the App renders <img> inline (per MeoW API doc).
    if (imageUrl) {
      const url = `${CHUCKFANG_URL}?msgType=html&htmlHeight=480`;
      const body = JSON.stringify({
        title,
        msg: `<p>${message}</p><img src="${imageUrl}" style="max-width:100%;border-radius:8px"/>`,
        url: imageUrl,
      });
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      const result = await resp.json() as { status: number; message?: string };
      if (result.status === 200) {
        console.log(`[Push:鸿蒙] ${title} (with image)`);
        return true;
      }
      console.warn(`[Push:鸿蒙] Image push failed (${result.status}): ${result.message}`);
      return false;
    }
    const url = `${CHUCKFANG_URL}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
    const resp = await fetch(url);
    const result = await resp.json() as { status: number; message?: string };
    if (result.status === 200) {
      console.log(`[Push:鸿蒙] ${title}`);
      return true;
    }
    console.warn(`[Push:鸿蒙] Failed (${result.status}): ${result.message}`);
    return false;
  } catch (e) {
    console.error('[Push:鸿蒙] Error:', (e as Error).message);
    return false;
  }
}

async function pushServerJiang(title: string, message: string, imageUrl?: string): Promise<boolean> {
  try {
    // Server酱 Turbo: desp supports markdown; image must be an external https URL.
    // Plain URL appended as fallback so it's tappable even if image rendering fails.
    const desp = imageUrl
      ? `${message}\n\n![二维码](${imageUrl})\n\n[点我查看二维码](${imageUrl})`
      : message;
    const body = JSON.stringify({ title, desp });
    const resp = await fetch(SERVERJIANG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    });
    const result = await resp.json() as { code: number; message?: string };
    if (resp.status === 200 && result.code === 0) {
      console.log(`[Push:安卓] ${title}`);
      return true;
    }
    console.warn(`[Push:安卓] Failed (code=${result.code}): ${result.message}`);
    return false;
  } catch (e) {
    console.error('[Push:安卓] Error:', (e as Error).message);
    return false;
  }
}

export async function pushNotify(title: string, message: string, imageUrl?: string): Promise<void> {
  if (!PUSH_ENABLED) return;
  // Fire both in parallel
  await Promise.allSettled([
    pushChuckFang(title, message, imageUrl),
    pushServerJiang(title, message, imageUrl),
  ]);
}
