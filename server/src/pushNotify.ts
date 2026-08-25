/**
 * Unified push notification — 推送到所有设备（鸿蒙 ChuckFang/MeoW + 安卓微信 Server酱）.
 *
 * linkUrl: 可选跳转链接。Server酱 渲染为 markdown 可点击链接；
 * MeoW 优先走 msgType=html 的 <a> 可点击链接，失败时降级纯文本 GET（URL 以文字形式附带）。
 *
 * MeoW 服务端观察（2026-08-17）：POST 接口故障期返回 500/HTML 错误页，
 * 此时 resp.json() 抛 "Unexpected token <" —— 降级逻辑保证纯文本通道仍可达。
 */

const CHUCKFANG_URL = 'https://api.chuckfang.com/eastpolar';
const SERVERJIANG_URL = 'https://17791.push.ft07.com/send/sctp17791t3thcbychibuxsxemwtxzwo.send';
const PUSH_ENABLED = true;

async function pushChuckFang(title: string, message: string, linkUrl?: string): Promise<boolean> {
  // 1) Preferred: html mode with a clickable <a> (needs POST — broken during MeoW outages)
  if (linkUrl) {
    try {
      const body = JSON.stringify({
        title,
        msg: `<p>${message}</p><p><a href="${linkUrl}">👉 点击查看实时二维码</a></p>`,
        url: linkUrl,
      });
      const resp = await fetch(`${CHUCKFANG_URL}?msgType=html&htmlHeight=300`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      const result = await resp.json() as { status: number; msg?: string };
      if (result.status === 200) {
        console.log(`[Push:鸿蒙] ${title} (html link)`);
        return true;
      }
      console.warn(`[Push:鸿蒙] html push failed (${result.status}): ${result.msg}`);
    } catch (e) {
      console.error('[Push:鸿蒙] html push error:', (e as Error).message);
    }
    // fall through to text fallback
  }

  // 2) Fallback: plain-text GET (most reliable path; MeoW app shows URL as text)
  try {
    const text = linkUrl ? `${message}\n${linkUrl}` : message;
    const url = `${CHUCKFANG_URL}/${encodeURIComponent(title)}/${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    const result = await resp.json() as { status: number; msg?: string };
    if (result.status === 200) {
      console.log(`[Push:鸿蒙] ${title}${linkUrl ? ' (text fallback)' : ''}`);
      return true;
    }
    console.warn(`[Push:鸿蒙] Failed (${result.status}): ${result.msg}`);
    return false;
  } catch (e) {
    console.error('[Push:鸿蒙] Error:', (e as Error).message);
    return false;
  }
}

async function pushServerJiang(title: string, message: string, linkUrl?: string): Promise<boolean> {
  try {
    // Server酱 SC3: 走 GET 查询参数 (?title=..&desp=..)，POST JSON 会被拒(403/1010)。
    const desp = linkUrl
      ? `${message}\n\n[👉 点击查看实时二维码（页面自动刷新）](${linkUrl})\n\n${linkUrl}`
      : message;
    const url = `${SERVERJIANG_URL}?title=${encodeURIComponent(title)}&desp=${encodeURIComponent(desp)}`;
    const resp = await fetch(url, { method: 'GET' });
    const result = await resp.json() as { code?: number; errno?: number; message?: string };
    if (resp.status === 200 && (result.code === 0 || result.errno === 0)) {
      console.log(`[Push:安卓] ${title}`);
      return true;
    }
    console.warn(`[Push:安卓] Failed (code=${result.code ?? result.errno}): ${result.message}`);
    return false;
  } catch (e) {
    console.error('[Push:安卓] Error:', (e as Error).message);
    return false;
  }
}

export async function pushNotify(title: string, message: string, linkUrl?: string): Promise<void> {
  if (!PUSH_ENABLED) return;
  // Fire both in parallel
  await Promise.allSettled([
    pushChuckFang(title, message, linkUrl),
    pushServerJiang(title, message, linkUrl),
  ]);
}
