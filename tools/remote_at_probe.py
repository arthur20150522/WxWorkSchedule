"""Prep and fire the /debug/at-probe against the group the user last tested.

Run on the remote server. Parses the last '[send] queued [group] <name>: @...'
line from the pm2 bridge log (UTF-8 on disk), writes the probe POST body,
calls the bridge, saves the dump. Files are UTF-8 to dodge GBK console issues.
"""
import io
import json
import re
import subprocess
import sys
import time
import urllib.request

LOG = r'C:\Users\Administrator\.pm2\logs\wx-bridge-error.log'
BODY_PATH = r'C:\Users\Administrator\at_probe_body.json'
RESULT_PATH = r'C:\Users\Administrator\at_probe_result.json'

# bridge stderr is redirected by pm2 → encoded with the system locale (GBK on
# Chinese Windows), not UTF-8. Read accordingly, else Chinese turns to U+FFFD.
txt = io.open(LOG, encoding='gbk', errors='replace').read()
matches = re.findall(r'\[send\] queued \[group\] (.*?): @', txt)
if not matches:
    print('NO_AT_GROUP_FOUND')
    sys.exit(1)
target = matches[-1]
io.open(r'C:\Users\Administrator\at_probe_target.txt', 'w', encoding='utf-8').write(target)

body = json.dumps({'target': target, 'target_type': 'group', 'mention': 'Alex'})
io.open(BODY_PATH, 'w', encoding='utf-8').write(body)
print('TARGET_LEN', len(target))

req = urllib.request.Request(
    'http://127.0.0.1:39800/debug/at-probe',
    data=body.encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST',
)
with urllib.request.urlopen(req, timeout=120) as resp:
    result = resp.read()
io.open(RESULT_PATH, 'wb').write(result)
print('PROBE_DONE', len(result))
