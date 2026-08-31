"""Parse bridge logs to find key transition points."""
import re, sys

with open(r"C:\Users\Administrator\.pm2\logs\wx-bridge-error.log", "r", encoding="gbk", errors="ignore") as f:
    lines = f.readlines()

transitions = []
prev_state = None

for i, line in enumerate(lines):
    # Match: "[bridge] [recover] Auto-triggered for <state>: <detail>"
    m = re.search(r'\[recover\] Auto-triggered for (\w+): (.+)', line)
    if m:
        state = m.group(1)
        detail = m.group(2).strip()
        if state != prev_state:
            transitions.append(f"Line {i+1}: {state} -> {detail}")
            prev_state = state

# Print first 3 and last 3 transitions
for t in transitions[:5]:
    print(t)
if len(transitions) > 5:
    print("...")
for t in transitions[-3:]:
    print(t)

print(f"\nTotal transitions: {len(transitions)}")
print(f"First recovery happened around line {min(int(t.split(':')[0].split()[1]) for t in transitions)}")
