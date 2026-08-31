"""One-shot remote recovery: deploy finder v2, ensure a single bridge on 39800,
then run the at-probe. Run on the remote server.

Windows pm2 leaves the previous bridge process alive on restart (orphan still
bound to 39800, serving stale code) — hence the orphan-reaping loop.
"""
import io
import json
import re
import subprocess
import sys
import time
import urllib.request

REPO = r'C:\Users\Administrator\WxWorkSchedule'
TARGET_FILE = r'C:\Users\Administrator\at_probe_target.txt'
LOG = r'C:\Users\Administrator\.pm2\logs\wx-bridge-error.log'
RESULT_PATH = r'C:\Users\Administrator\at_probe_result.json'


def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       errors='replace')
    return (r.stdout or '') + (r.stderr or '')


def pm2_pid():
    return sh('pm2 pid wx-bridge').strip()


def listeners():
    out = sh('netstat -ano | findstr LISTENING | findstr :39800')
    return set(re.findall(r'\s(\d+)\s*$', out, re.M))


def kill(pid):
    sh(f'taskkill /F /PID {pid}')


# 0. deploy latest code
print('GIT:', sh(f'cd /d {REPO} && git fetch -q origin fork4win '
                 f'&& git reset -q --hard origin/fork4win '
                 f'&& git log --oneline -1').strip())

# 1. restart via pm2 (may leave an orphan of the previous instance)
sh('pm2 restart wx-bridge --update-env')
time.sleep(6)

# 2. reap orphans until exactly pm2's instance is listening
for i in range(4):
    cur = pm2_pid()
    for pid in listeners() - {cur}:
        print(f'KILL orphan {pid} (pm2={cur})')
        kill(pid)
    time.sleep(3)
    ls = listeners()
    print(f'round {i}: listeners={sorted(ls)} pm2pid={cur}')
    if ls == {cur}:
        break
else:
    print('FAILED_TO_ISOLATE_LISTENER')
    sys.exit(1)

# 3. health
try:
    with urllib.request.urlopen('http://127.0.0.1:39800/health', timeout=10) as r:
        print('HEALTH:', r.read().decode())
except Exception as e:
    print('HEALTH_FAIL', e)
    sys.exit(1)

# 4. probe (reuse saved target; re-parse log as fallback)
try:
    target = io.open(TARGET_FILE, encoding='utf-8').read().strip()
except OSError:
    txt = io.open(LOG, encoding='utf-8', errors='replace').read()
    target = re.findall(r'\[send\] queued \[group\] (.*?): @', txt)[-1]

body = json.dumps({'target': target, 'target_type': 'group', 'mention': 'Alex'})
print('TARGET_LEN', len(target))
req = urllib.request.Request(
    'http://127.0.0.1:39800/debug/at-probe',
    data=body.encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST',
)
try:
    with urllib.request.urlopen(req, timeout=150) as resp:
        result = resp.read()
    io.open(RESULT_PATH, 'wb').write(result)
    data = json.loads(result)
    print('PROBE_OK finder_verdict=', json.dumps(data.get('finder_verdict')))
    print('INPUT_VALUES=', data.get('input_value_before'), '|',
          data.get('input_value_at'), '|', data.get('input_value_filtered'))
    print('AFTER_AT_NODES=', len(data.get('after_at') or []),
          'FILTERED_NODES=', len(data.get('filtered') or []),
          'DESKTOP_NODES=', len(data.get('desktop_windows') or []))
except urllib.error.HTTPError as e:
    print('PROBE_HTTP_FAIL', e.code, e.read()[:200])
except Exception as e:
    print('PROBE_FAIL', e)
