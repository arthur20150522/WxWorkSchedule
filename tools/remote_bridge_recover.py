"""Clean recovery of the wx-bridge singleton on the remote server.

Ground truth for "which process is the bridge" is the process command line
(via PowerShell CIM), NOT `pm2 pid` — the latter lags behind on this box and
caused a kill/respawn storm. Steps:
  1. pm2 stop wx-bridge        (no respawn while we clean)
  2. kill every bridge.py process
  3. assert port 39800 has zero listeners
  4. pm2 start wx-bridge
  5. assert exactly one listener == one bridge.py process, health OK
"""
import json
import re
import subprocess
import sys
import time
import urllib.request

PS = ('powershell -NoProfile -c '
      '"Get-CimInstance Win32_Process -Filter \\"Name=\'python.exe\'\\" | '
      'Where-Object { $_.CommandLine -like \'*bridge.py*\' } | '
      'Select-Object ProcessId,CommandLine | ConvertTo-Json"')


def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       errors='replace')
    return (r.stdout or '') + (r.stderr or '')


def bridge_pids():
    out = sh(PS)
    out = out[out.index('{') if '{' in out else 0:]
    if not out.strip():
        return {}
    data = json.loads(out)
    if isinstance(data, dict):
        data = [data]
    return {int(p['ProcessId']): p['CommandLine'] for p in data}


def listeners():
    out = sh('netstat -ano | findstr LISTENING | findstr :39800')
    return set(re.findall(r'\s(\d+)\s*$', out, re.M))


print('STEP1 stop:', sh('pm2 stop wx-bridge').replace('\n', ' ')[:80])
time.sleep(2)

pids = bridge_pids()
print('STEP2 bridge processes:', list(pids))
for pid in pids:
    out = sh(f'taskkill /F /PID {pid}')
    print(f'  kill {pid}:', out.strip().splitlines()[-1] if out.strip() else 'no output')
time.sleep(3)

pids = bridge_pids()
ls = listeners()
print('STEP3 remaining bridges:', list(pids), 'listeners:', sorted(ls))
if pids or ls:
    for pid in list(pids) + sorted(ls - set(pids)):
        sh(f'taskkill /F /PID {pid}')
    time.sleep(2)
    if bridge_pids() or listeners():
        print('STILL_DIRTY — aborting')
        sys.exit(1)

print('STEP4 start:', sh('pm2 start wx-bridge').replace('\n', ' ')[:80])
time.sleep(6)

pids = bridge_pids()
ls = listeners()
print('STEP5 bridges:', list(pids), 'listeners:', sorted(ls))
ok = len(pids) == 1 and ls == set(pids)
print('SINGLETON_OK' if ok else 'SINGLETON_FAIL')

try:
    with urllib.request.urlopen('http://127.0.0.1:39800/health', timeout=10) as r:
        print('HEALTH:', r.read().decode())
except Exception as e:
    print('HEALTH_FAIL', e)
    sys.exit(1)

# stability: pid must not churn for 20s
p1 = set(bridge_pids())
time.sleep(20)
p2 = set(bridge_pids())
print('STABLE' if p1 == p2 else f'CHURNING {p1} -> {p2}')
