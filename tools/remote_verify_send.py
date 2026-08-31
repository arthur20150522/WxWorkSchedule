"""End-to-end @ mention verification through the real /send path.

Reads the target group from the Node db (liveLogs), POSTs a unique message
with an @Alex mention, polls the task result, prints ASCII-only status.
"""
import io
import json
import re
import sys
import time
import urllib.request

REPO = r'C:\Users\Administrator\WxWorkSchedule'
NODE_DB = REPO + r'\server\db.json'
LOG = r'C:\Users\Administrator\.pm2\logs\wx-bridge-error.log'

db = json.load(open(NODE_DB, encoding='utf-8'))
group = None
for rec in db.get('liveLogs') or []:
    if rec.get('targetType') == 'group' and '@' in (rec.get('content') or ''):
        group = rec.get('targetName')
if not group:
    print('NO_TARGET')
    sys.exit(1)

msg = '@Alex 艾特功能部署验证 %d' % int(time.time())
body = json.dumps({'target': group, 'message': msg, 'targetType': 'group'}).encode('utf-8')
print('TARGET_LEN', len(group), 'MSG_LEN', len(msg))

size_before = len(open(LOG, 'rb').read()) if io is not None else 0
req = urllib.request.Request('http://127.0.0.1:39800/send', data=body,
                             headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=150) as resp:
        result = json.loads(resp.read())
except Exception as e:
    print('SEND_HTTP_FAIL', type(e).__name__, str(e)[:80])
    sys.exit(1)

tid = result.get('task_id')
print('QUEUED task=', tid)
if not tid:
    print(json.dumps(result)[:200])
    sys.exit(1)

deadline = time.time() + 150
while time.time() < deadline:
    with urllib.request.urlopen(f'http://127.0.0.1:39800/task/{tid}', timeout=15) as r:
        st = json.loads(r.read())
    if st.get('status') in ('success', 'failed'):
        print('TASK', st.get('status'), 'result=', st.get('result'), 'error=', st.get('error'))
        break
    time.sleep(1)
else:
    print('POLL_TIMEOUT')

# pull the at-send log lines for this verification (bytes → strip non-ascii)
time.sleep(1)
raw = open(LOG, 'rb').read()[size_before:]
for line in raw.split(b'\n'):
    if b'at-send' in line or b'[send]' in line:
        txt = line.decode('utf-8', errors='replace')
        ascii_only = txt.encode('ascii', errors='replace').decode()
        print('LOG:', ascii_only.strip()[:120])
