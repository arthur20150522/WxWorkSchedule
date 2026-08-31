"""Extract only WeChat process-control evidence from a WxSchedule database."""

from __future__ import annotations

import json
import sys
from pathlib import Path


NEEDLES = (
    "wechat kill",
    "wechat launch",
    "wechat schedule",
    "bridge restart",
    "bridge recover",
    "微信定时",
)


def extract(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"path": str(path), "error": f"{type(exc).__name__}: {exc}"}
    events = []
    for item in data.get("logs") or []:
        if not isinstance(item, dict):
            continue
        message = str(item.get("message") or "")
        if not any(needle in message.lower() for needle in NEEDLES):
            continue
        events.append(
            {
                key: item.get(key)
                for key in ("id", "timestamp", "time", "level", "message")
                if item.get(key) is not None
            }
        )
    return {
        "path": str(path),
        "wechatSchedule": data.get("wechatSchedule"),
        "controlEvents": events,
    }


def main() -> None:
    for raw_path in sys.argv[1:]:
        print(json.dumps(extract(Path(raw_path)), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
