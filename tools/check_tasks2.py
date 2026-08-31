"""Check task DB status."""
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(r"C:\Users\Administrator\WxWorkSchedule\server\db.json", "r", encoding="utf-8") as f:
    d = json.load(f)

tasks = d.get("tasks", [])
print(f"Total tasks: {len(tasks)}")
for t in tasks:
    name = t.get("targetName", "?")[:20]
    status = t.get("status", "?")
    sch = t.get("scheduleTime", "?")[:19]
    rec = t.get("recurrence", "once")[:8]
    err = str(t.get("error", ""))[:60]
    c = t.get("content", [])
    cp = (c[0] or "N/A")[:30] if c else "N/A"
    print(f"  {t['id'][-8:]} | {name} | {status} | {sch} | {rec} | {cp} | {err}")
