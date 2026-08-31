"""Check task DB status."""
import json

with open(r"C:\Users\Administrator\WxWorkSchedule\server\db.json", "r", encoding="utf-8") as f:
    d = json.load(f)

tasks = d.get("tasks", [])
print(f"Total tasks: {len(tasks)}\n")
for t in tasks:
    name = t.get("targetName", "?")[:20]
    status = t.get("status", "?")
    sch = t.get("scheduleTime", "?")[:19]
    rec = t.get("recurrence", "once")[:8]
    err = str(t.get("error", ""))[:50]
    c = t.get("content", [])
    content_preview = c[0][:20] if c else "N/A"
    print(f"  {t['id'][-8:]} | {name:20s} | {status:10s} | {sch} | {rec} | {content_preview} | {err}")
