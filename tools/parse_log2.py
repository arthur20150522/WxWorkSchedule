"""Get timestamps for key log lines."""
import re, sys

key_lines = [1, 5, 9, 98, 181, 9513, 9518, 11200]  # start, first login, popup, etc

with open(r"C:\Users\Administrator\.pm2\logs\wx-bridge-error.log", "r", encoding="gbk", errors="ignore") as f:
    lines = f.readlines()

print(f"Total lines in log: {len(lines)}")
for ln in key_lines:
    if ln <= len(lines):
        line = lines[ln-1].rstrip()
        # Extract timestamp if present
        ts_match = re.match(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[\d,]+)', line)
        ts = ts_match.group(1) if ts_match else "NO_TIMESTAMP"
        print(f"\nLine {ln} [{ts}]:")
        print(f"  {line[:300]}")
