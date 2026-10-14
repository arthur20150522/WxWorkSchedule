"""Read-only check: did today's bot messages actually reach the group?

Run ON THE SERVER via PM2 (ssh sessions cannot see the GUI session):

    # copy this file over, then:
    pm2 start C:\\Users\\Administrator\\Temp\\vg.py --name tmp-vg --interpreter python --no-autorestart
    # inspect C:\\Users\\Administrator\\.pm2\\logs\\tmp-vg-out.log, then:
    pm2 delete tmp-vg

Collects today's messages from the target group with wx4py and matches them
against the task contents in server/db.json (alnum-normalized substrings).
Never sends anything, never clicks; only opens the chat and scrolls.
"""
import json
import re
import sys
import time

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from wx4py import WeChatClient

TARGET = '\u534e\u82f1\u8425\u517b\u79c1\u6559VIP\u670d\u52a1\u7fa4'
REPO = r'C:\Users\Administrator\WxWorkSchedule'
OUT = r'C:\Users\Administrator\Temp\hist_today.json'

db = json.loads(open(REPO + r'\server\db.json', encoding='utf-8').read())
tasks = [t for t in db.get('tasks', []) if TARGET in str(t.get('targetName', ''))]


def plain(s):
    return ''.join(ch for ch in str(s or '') if ch.isalnum())


needles = []  # (task_id, item_index, normalized head)
for t in tasks:
    for i, c in enumerate(t.get('content', [])):
        needles.append((t['id'], i, plain(c)[:12]))

wx = WeChatClient(auto_connect=False)
wx.connect()
print('is_connected:', wx.is_connected, flush=True)
if not wx.is_connected:
    print('NOT_CONNECTED')
    sys.exit(1)

chat = wx.chat_window
chat.open_chat(TARGET, 'group')
time.sleep(1.5)

msg_list = chat._get_chat_message_list()
if msg_list is not None:
    cx, cy = chat._get_message_list_center(msg_list)
    chat._scroll_message_list_to_bottom(msg_list, cx, cy)
    time.sleep(1)

hist = chat.get_chat_history(TARGET, target_type='group', since='today', max_count=300)
print('collected:', len(hist), flush=True)
if len(hist) < 20:
    print('COLLECTION_STATE_SUSPECT (too few items — scroll position may be stale)')
msgs = [{'time': m.get('time'), 'content': m.get('content'), 'type': m.get('type')} for m in hist]
open(OUT, 'w', encoding='utf-8').write(json.dumps(msgs, ensure_ascii=False, indent=1))
norms = [plain(m['content']) for m in msgs]

print('')
print('=== MATCH REPORT (plain-normalized, task content vs group messages) ===')
for tid, i, nd in needles:
    hits = [k for k, mc in enumerate(norms) if nd and nd in mc]
    print('task %s item %d [%s] -> %s' % (tid, i, nd, ('HIT idx ' + ','.join(map(str, hits))) if hits else 'NOT_FOUND'))
    for h in hits[:1]:
        print('      context: %s || %s || %s' % (norms[max(0, h - 1)][:24], norms[h][:60], norms[min(len(norms) - 1, h + 1)][:24]))

print('')
print('=== full list (idx | time | 36 plain chars) ===')
for k in range(len(msgs)):
    print('%d | %s | %s' % (k, msgs[k]['time'], norms[k][:36]))
print('DONE')
