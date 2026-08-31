"""Extract timestamp-only evidence of historical WeChat login-page detection.

wx4py logs ``未检测到 MainWindow，使用当前窗口`` only after
``_try_click_login_button`` found and clicked the UIA button named ``进入微信``.
This analyzer deliberately emits no target names, message text, contacts, or
other arbitrary log content.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


MAIN_WINDOW_TIMEOUT = re.compile(
    r"^(?P<day>\d{4}-\d{2}-\d{2}) "
    r"(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2}),\d+ "
    r"- wx4py\.core\.window - WARNING - .*MainWindow"
)


def load_events(path: Path, start_hour: int, end_hour: int) -> dict[str, list[str]]:
    events: dict[str, set[str]] = defaultdict(set)
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = MAIN_WINDOW_TIMEOUT.match(line)
            if not match:
                continue
            hour = int(match.group("hour"))
            if not start_hour <= hour <= end_hour:
                continue
            timestamp = (
                f"{match.group('hour')}:{match.group('minute')}:{match.group('second')}"
            )
            events[match.group("day")].add(timestamp)
    return {day: sorted(times) for day, times in sorted(events.items())}


def period_summary(
    events: dict[str, list[str]], start: date, end: date
) -> dict[str, object]:
    observed: list[dict[str, object]] = []
    missing: list[str] = []
    current = start
    while current <= end:
        day = current.isoformat()
        if day in events:
            observed.append({"date": day, "times": events[day]})
        else:
            missing.append(day)
        current += timedelta(days=1)
    total = (end - start).days + 1
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days_total": total,
        "days_with_login_button_path": len(observed),
        "rate": round(len(observed) / total, 4),
        "observed": observed,
        "missing": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log", type=Path)
    parser.add_argument("--start-hour", type=int, default=2)
    parser.add_argument("--end-hour", type=int, default=4)
    parser.add_argument("--period", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    events = load_events(args.log, args.start_hour, args.end_hour)
    periods = []
    for raw in args.period:
        start_raw, end_raw = raw.split("..", 1)
        periods.append(period_summary(events, date.fromisoformat(start_raw), date.fromisoformat(end_raw)))

    result = {
        "classification": "historical_login_button_path_detected",
        "source_log_name": args.log.name,
        "window_hours": [args.start_hour, args.end_hour],
        "semantic_basis": (
            "In the installed wx4py window.py, the MainWindow timeout warning is "
            "reachable only after UIA found and clicked the button named 进入微信."
        ),
        "privacy": "Only dates and times are emitted; arbitrary log text is excluded.",
        "periods": periods,
    }
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
