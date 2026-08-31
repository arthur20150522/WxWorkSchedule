"""Summarize JSONL produced by server/pybridge/stability_monitor.py."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def load_events(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    events.append(value)
            except json.JSONDecodeError as exc:
                print(f"warning: skipped invalid line {line_number}: {exc}")
    return events


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()

    events = load_events(args.path)
    classifications = Counter(
        reason
        for event in events
        for reason in event.get("classification", [])
        if reason != "baseline"
    )
    print(f"events={len(events)}")
    if events:
        print(f"range={events[0].get('time')} .. {events[-1].get('time')}")
        latest = events[-1]
        latest_bridge = latest.get("bridge") or {}
        latest_process = next(
            (item for item in latest.get("processes", []) if item.get("name") == "weixin.exe"),
            None,
        )
        print(
            "latest="
            + json.dumps(
                {
                    "event": latest.get("event"),
                    "time": latest.get("time"),
                    "state": latest_bridge.get("state"),
                    "detail": latest_bridge.get("detail"),
                    "main_process": latest_process,
                    "classification": latest.get("classification"),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    print("classifications=" + json.dumps(classifications, ensure_ascii=False, sort_keys=True))
    process_traces = [event for event in events if event.get("event") == "process_trace"]
    if process_traces:
        print("process_traces:")
        for event in process_traces[-args.limit :]:
            print(
                json.dumps(
                    {
                        key: event.get(key)
                        for key in (
                            "time",
                            "action",
                            "name",
                            "pid",
                            "parent_pid",
                            "parent_name",
                            "session_id",
                            "exit_status",
                        )
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
    print("timeline:")
    interesting = [event for event in events if event.get("event") == "state_change"]
    for event in interesting[-args.limit :]:
        bridge = event.get("bridge", {})
        processes = event.get("processes", [])
        desktop = event.get("desktop", {})
        network = event.get("network", {})
        public_ip = (network.get("public_ip") or {}).get("value")
        connections = event.get("tcp_connections", [])
        remote_connections = sorted(
            {
                f"{item['remote'][0]}:{item['remote'][1]}({item.get('status')})"
                for item in connections
                if item.get("remote")
            }
        )
        main_process = next(
            (item for item in processes if item.get("name") == "weixin.exe"),
            processes[0] if processes else None,
        )
        print(
            json.dumps(
                {
                    "time": event.get("time"),
                    "classification": event.get("classification"),
                    "observer": bridge.get("observer"),
                    "state": bridge.get("state"),
                    "detail": bridge.get("detail"),
                    "hwnd": bridge.get("hwnd"),
                    "main_process": main_process,
                    "pids": [item.get("pid") for item in processes],
                    "remote_connections": remote_connections,
                    "resources": event.get("resources"),
                    "active_console": (event.get("session") or {}).get("active_console_id"),
                    "display": {
                        "primary": desktop.get("primary"),
                        "virtual": desktop.get("virtual"),
                        "count": desktop.get("monitor_count"),
                    },
                    "local_ip": network.get("local_ip"),
                    "public_ip": public_ip,
                    "wechat_log_metadata": event.get("wechat_log_metadata"),
                    "control_audit": event.get("control_audit"),
                    "schedule": event.get("schedule"),
                    "safety": event.get("safety"),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
