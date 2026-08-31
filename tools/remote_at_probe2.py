"""Probe v2: get the target group from the Node db (liveLogs), run the
at-probe, then fetch the task result via GET /task/<id> — sidestepping both
the mixed-encoding pm2 log and the flaky HTTP response path.

Prints ASCII-only status lines; all Chinese data goes to UTF-8 files.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request

REPO = r'C:\Users\Administrator\WxWorkSchedule'
NODE_DB = REPO + r'\server\db.json'
BODY_PATH = r'C:\Users\Administrator\at_probe_body.json'
RESULT_PATH = r'C:\Users\Administrator\at_probe_result3.json'
LOG = r'C:\Users\Administrator\.pm2\logs\wx-bridge-error.log'

db = json.load(open(NODE_DB, encoding='utf-8'))
live = db.get('liveLogs') or []
group = None
for rec in live:
    if rec.get('targetType') == 'group' and '@' in (rec.get('content') or ''):
        group = rec.get('targetName')
if not group:
    print('NO_TARGET_IN_DB keys=', list(db.keys()), 'liveLogs=', len(live))
    sys.exit(1)

io = open(BODY_PATH, 'w', encoding='utf-8')
io.write(json.dumps({'target': group, 'target_type': 'group', 'mention': 'Alex'}))
io.close()
print('TARGET_LEN', len(group))

size_before = 0
try:
    size_before = len(open(LOG, 'rb').read())
except OSError:
    pass

try:
    body = open(BODY_PATH, 'rb').read()
    req = urllib.request.Request(
        'http://127.0.0.1:39800/debug/at-probe', data=body,
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=180) as resp:
        result = resp.read()
    open(RESULT_PATH, 'wb').write(result)
    print('PROBE_VIA_HTTP_OK', len(result))
    sys.exit(0)
except Exception as e:
    print('HTTP_PATH_FAIL', type(e).__name__, str(e)[:60])

# fall back: find the task id logged after the POST, then GET /task/<id>
time.sleep(3)
raw = open(LOG, 'rb').read()[size_before:]
m = re.findall(rb'at-probe. queued for .*?task=(\d+)', raw)
print('TASK_IDS_IN_LOG', [x.decode() for x in m])
if not m:
    print('NO_TASK_ID')
    sys.exit(1)
tid = m[-1].decode()
with urllib.request.urlopen(f'http://127.0.0.1:39800/task/{tid}', timeout=30) as r:
    result = r.read()
open(RESULT_PATH, 'wb').write(result)
print('PROBE_VIA_TASK_OK', tid, len(result))
