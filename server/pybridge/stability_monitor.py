"""Passive WeChat stability monitor for Windows.

The monitor never clicks UI, launches WeChat, or kills a process.  It records
only state transitions plus a periodic heartbeat so an overnight logout can be
attributed to one of these buckets:

* the account session changed while the same WeChat process stayed alive;
* the WeChat process stopped/restarted locally;
* the interactive Windows session or virtual display changed;
* the network identity changed; or
* the local wx4py bridge became unreachable.

Output is JSON Lines at server/data/stability/wechat_stability.jsonl by default.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import psutil
except ImportError:  # pragma: no cover - production dependency, fallback is useful in diagnostics
    psutil = None


SCRIPT_DIR = Path(__file__).resolve().parent
SERVER_DIR = SCRIPT_DIR.parent
DEFAULT_LOG_PATH = SERVER_DIR / "data" / "stability" / "wechat_stability.jsonl"
LOG_PATH = Path(os.environ.get("WX_STABILITY_LOG", str(DEFAULT_LOG_PATH)))
POLL_SECONDS = max(5, int(os.environ.get("WX_STABILITY_POLL_SECONDS", "15")))
HEARTBEAT_SECONDS = max(60, int(os.environ.get("WX_STABILITY_HEARTBEAT_SECONDS", "300")))
PUBLIC_IP_SECONDS = max(300, int(os.environ.get("WX_STABILITY_PUBLIC_IP_SECONDS", "3600")))
MAX_LOG_BYTES = max(1_000_000, int(os.environ.get("WX_STABILITY_MAX_LOG_BYTES", "25000000")))
BRIDGE_STATUS_URL = os.environ.get("WX_BRIDGE_STATUS_URL", "http://127.0.0.1:39800/status")
XLOG_DIR = Path(os.environ.get("APPDATA", "")) / "Tencent" / "xwechat" / "log"
WECHAT_NAMES = {"weixin.exe", "wechatappex.exe", "wechat.exe"}
LOGOUT_STATES = {"popup", "login", "qr", "logged_out"}
LOG_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def safe_error(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:500]


def get_json(url: str, timeout: float = 5.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "WxSchedule-StabilityMonitor/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        value = json.loads(response.read().decode("utf-8", errors="replace"))
    return value if isinstance(value, dict) else {"value": value}


def bridge_status_fallback() -> dict[str, Any]:
    try:
        value = get_json(BRIDGE_STATUS_URL)
        return {
            "observer": "bridge_fallback",
            "reachable": True,
            "connected": value.get("connected"),
            "state": value.get("state", "unknown"),
            "detail": value.get("detail") or value.get("error"),
            "hwnd": value.get("hwnd", 0),
        }
    except Exception as exc:
        return {
            "observer": "bridge_fallback",
            "reachable": False,
            "connected": False,
            "state": "bridge_unreachable",
            "detail": safe_error(exc),
            "hwnd": 0,
        }


def interpret_uia_state(
    names: set[str], classes: set[str], node_count: int
) -> tuple[str, str]:
    """Classify only known shell/login markers; never retain arbitrary UI text."""
    security_prompt = next(
        (name for name in names if "账号安全" in name and "重新登录" in name),
        None,
    )
    if "我知道了" in names:
        return "popup", security_prompt or '检测到“你已退出微信”弹窗'
    if "登录" in names or "进入微信" in names or "切换账号" in names:
        return "login", "检测到微信登录页"
    if "搜索" in names or "mmui::ChatInputField" in classes:
        return "ok", "正常 — 主界面已就绪"
    if "确认登录" in names or "正在登录" in names:
        return "waiting", "等待手机确认登录"
    if node_count < 30:
        return "unknown", f"低节点窗口：{node_count} 个 UIA 节点"
    return "unknown", f"未识别窗口：{node_count} 个 UIA 节点"


def passive_wechat_status() -> dict[str, Any]:
    """Observe window/UIA state without touching the bridge's cached wx4py client."""
    try:
        import pythoncom
        import win32gui
        from wx4py.core.win32 import find_wechat_window

        pythoncom.CoInitialize()
        try:
            hwnd = int(find_wechat_window() or 0)
            if not hwnd:
                return {
                    "observer": "local_uia",
                    "reachable": True,
                    "connected": False,
                    "state": "not_running",
                    "detail": "未找到微信窗口",
                    "hwnd": 0,
                }
            if not win32gui.IsWindowVisible(hwnd):
                return {
                    "observer": "local_uia",
                    "reachable": True,
                    "connected": False,
                    "state": "window_hidden",
                    "detail": "微信窗口存在但不可见",
                    "hwnd": hwnd,
                }

            import comtypes.client as cc
            import comtypes.gen.UIAutomationClient as UIA

            uia = cc.CreateObject(
                "{ff48dba4-60ef-4201-aa87-54103eef594e}",
                interface=UIA.IUIAutomation,
            )
            element = uia.ElementFromHandle(hwnd)
            items = element.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
            names: set[str] = set()
            classes: set[str] = set()
            for index in range(items.Length):
                item = items.GetElement(index)
                name = (item.CurrentName or "").strip()
                class_name = item.CurrentClassName or ""
                if name:
                    names.add(name)
                if class_name:
                    classes.add(class_name)

            state, detail = interpret_uia_state(names, classes, items.Length)
            return {
                "observer": "local_uia",
                "reachable": True,
                "connected": state == "ok",
                "state": state,
                "detail": detail,
                "hwnd": hwnd,
            }
        finally:
            pythoncom.CoUninitialize()
    except Exception as exc:
        fallback = bridge_status_fallback()
        fallback["passive_error"] = safe_error(exc)
        return fallback


def wechat_processes() -> list[dict[str, Any]]:
    if psutil is None:
        return []
    result: list[dict[str, Any]] = []
    for process in psutil.process_iter(["pid", "ppid", "name", "create_time", "exe"]):
        try:
            name = (process.info.get("name") or "").lower()
            if name not in WECHAT_NAMES:
                continue
            result.append(
                {
                    "pid": process.info["pid"],
                    "ppid": process.info.get("ppid"),
                    "name": name,
                    "created": datetime.fromtimestamp(
                        process.info.get("create_time") or 0, timezone.utc
                    ).astimezone().isoformat(timespec="seconds"),
                    "session_id": _process_session_id(process.info["pid"]),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
            continue
    return sorted(result, key=lambda item: (item["created"], item["pid"]))


def wechat_connections(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if psutil is None:
        return []
    pids = {item["pid"] for item in processes}
    result: list[dict[str, Any]] = []
    try:
        connections = psutil.net_connections(kind="tcp")
    except (psutil.AccessDenied, OSError):
        return []
    for connection in connections:
        if connection.pid not in pids:
            continue
        local = list(connection.laddr) if connection.laddr else None
        remote = list(connection.raddr) if connection.raddr else None
        result.append(
            {
                "pid": connection.pid,
                "local": local,
                "remote": remote,
                "status": connection.status,
            }
        )
    return sorted(
        result,
        key=lambda item: (
            item["pid"] or 0,
            str(item["remote"] or ""),
            str(item["local"] or ""),
            item["status"],
        ),
    )


def resource_snapshot(processes: list[dict[str, Any]]) -> dict[str, Any]:
    if psutil is None:
        return {}
    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()
    wechat_rss = 0
    wechat_private = 0
    for item in processes:
        try:
            process_memory = psutil.Process(item["pid"]).memory_info()
            wechat_rss += process_memory.rss
            wechat_private += int(getattr(process_memory, "private", 0) or 0)
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
            continue
    return {
        "physical_total_mb": round(memory.total / 1024 / 1024, 1),
        "physical_available_mb": round(memory.available / 1024 / 1024, 1),
        "physical_used_percent": memory.percent,
        "pagefile_total_mb": round(swap.total / 1024 / 1024, 1),
        "pagefile_used_mb": round(swap.used / 1024 / 1024, 1),
        "pagefile_used_percent": swap.percent,
        "wechat_working_set_mb": round(wechat_rss / 1024 / 1024, 1),
        "wechat_private_mb": round(wechat_private / 1024 / 1024, 1),
    }


def _process_session_id(pid: int) -> int | None:
    if os.name != "nt":
        return None
    session_id = wintypes.DWORD()
    if ctypes.windll.kernel32.ProcessIdToSessionId(pid, ctypes.byref(session_id)):
        return int(session_id.value)
    return None


def session_snapshot() -> dict[str, Any]:
    if os.name != "nt":
        return {"active_console_id": None, "monitor_session_id": None}
    active_console = int(ctypes.windll.kernel32.WTSGetActiveConsoleSessionId())
    return {
        "active_console_id": active_console,
        "monitor_session_id": _process_session_id(os.getpid()),
    }


class LastInputInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def desktop_snapshot() -> dict[str, Any]:
    if os.name != "nt":
        return {}
    user32 = ctypes.windll.user32
    last_input = LastInputInfo()
    last_input.cbSize = ctypes.sizeof(last_input)
    idle_seconds = None
    if user32.GetLastInputInfo(ctypes.byref(last_input)):
        tick = int(ctypes.windll.kernel32.GetTickCount64())
        idle_seconds = max(0, (tick - int(last_input.dwTime)) // 1000)
    return {
        "primary": [int(user32.GetSystemMetrics(0)), int(user32.GetSystemMetrics(1))],
        "virtual": [
            int(user32.GetSystemMetrics(76)),
            int(user32.GetSystemMetrics(77)),
            int(user32.GetSystemMetrics(78)),
            int(user32.GetSystemMetrics(79)),
        ],
        "monitor_count": int(user32.GetSystemMetrics(80)),
        "remote_session": bool(user32.GetSystemMetrics(0x1000)),
        "idle_seconds": idle_seconds,
    }


def local_ip() -> str | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("1.1.1.1", 53))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def public_ip() -> dict[str, Any]:
    errors: list[str] = []
    for url in ("https://checkip.amazonaws.com", "https://api.ipify.org"):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
            with urllib.request.urlopen(request, timeout=8) as response:
                value = response.read().decode("ascii", errors="ignore").strip()
            if value:
                return {"value": value, "source": url}
        except Exception as exc:
            errors.append(safe_error(exc))
    return {"value": None, "errors": errors}


def schedule_snapshot() -> dict[str, Any] | None:
    db_path = SERVER_DIR / "db.json"
    try:
        data = json.loads(db_path.read_text(encoding="utf-8"))
        schedule = data.get("wechatSchedule")
        if not isinstance(schedule, dict):
            return None
        return {
            "enabled": bool(schedule.get("enabled")),
            "killTime": schedule.get("killTime"),
            "launchTime": schedule.get("launchTime"),
            "process_kill_gate": os.environ.get("ALLOW_WECHAT_PROCESS_KILL") == "true",
            "hard_recovery_gate": os.environ.get("ALLOW_WECHAT_HARD_RECOVERY") == "true",
        }
    except Exception as exc:
        return {"error": safe_error(exc)}


def pm2_safety_snapshot() -> dict[str, Any]:
    """Read only the saved wx-bridge safety fields from PM2's dump.

    Python's JSON parser keeps case-sensitive environment keys, unlike the
    Windows PowerShell JSON parser on the target host.  Never copy the env
    object because it contains application secrets.
    """
    dump_path = Path(os.environ.get("PM2_HOME", str(Path.home() / ".pm2"))) / "dump.pm2"
    try:
        data = json.loads(dump_path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return {"saved": False, "error": "PM2 dump is not a process list"}
        bridge = next(
            (item for item in data if isinstance(item, dict) and item.get("name") == "wx-bridge"),
            None,
        )
        if bridge is None:
            return {"saved": False, "dump_path": str(dump_path)}
        schedule_process = next(
            (item for item in data if isinstance(item, dict) and item.get("name") == "wx-schedule"),
            None,
        )

        def saved_gate(item: dict[str, Any] | None, key: str) -> bool:
            if item is None:
                return False
            raw = item.get(key)
            env = item.get("env")
            if raw is None and isinstance(env, dict):
                raw = env.get(key)
            return str(raw).lower() == "true"

        return {
            "saved": True,
            "treekill": bridge.get("treekill"),
            "script": bridge.get("pm_exec_path"),
            "interpreter": bridge.get("exec_interpreter"),
            "auto_recovery_gate": saved_gate(bridge, "ALLOW_WECHAT_AUTO_RECOVERY"),
            "hard_recovery_gate": saved_gate(bridge, "ALLOW_WECHAT_HARD_RECOVERY"),
            "schedule_process_kill_gate": saved_gate(
                schedule_process, "ALLOW_WECHAT_PROCESS_KILL"
            ),
        }
    except Exception as exc:
        return {"saved": False, "error": safe_error(exc)}


def safety_snapshot() -> dict[str, Any]:
    return {
        "schedule": schedule_snapshot(),
        "pm2_bridge": pm2_safety_snapshot(),
    }


def control_audit_snapshot() -> list[dict[str, Any]]:
    """Return recent app control events relevant to local WeChat attribution."""
    db_path = SERVER_DIR / "db.json"
    needles = (
        "wechat kill",
        "wechat launch",
        "wechat schedule",
        "bridge restart",
        "bridge recover",
        "微信定时",
    )
    try:
        data = json.loads(db_path.read_text(encoding="utf-8"))
        logs = data.get("logs") or []
        result: list[dict[str, Any]] = []
        for item in logs:
            if not isinstance(item, dict):
                continue
            message = str(item.get("message") or "")
            if not any(needle in message.lower() for needle in needles):
                continue
            result.append(
                {
                    key: item.get(key)
                    for key in ("id", "timestamp", "time", "level", "message")
                    if item.get(key) is not None
                }
            )
        return result[-20:]
    except Exception as exc:
        return [{"error": safe_error(exc)}]


def xlog_metadata() -> list[dict[str, Any]]:
    """Record only size/mtime for current WeChat diagnostic logs, never contents."""
    result: list[dict[str, Any]] = []
    try:
        date_tag = datetime.now().strftime("%Y%m%d")
        for prefix in ("mm_", "ilink_"):
            path = XLOG_DIR / f"{prefix}{date_tag}.xlog"
            if not path.exists():
                continue
            stat = path.stat()
            result.append(
                {
                    "name": path.name,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc)
                    .astimezone()
                    .isoformat(timespec="milliseconds"),
                }
            )
    except OSError as exc:
        return [{"error": safe_error(exc)}]
    return result


def recent_windows_events() -> dict[str, Any]:
    """Collect only event IDs relevant to process/session/power attribution."""
    if os.name != "nt":
        return {}
    queries = {
        "system": (
            "System",
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and "
            "(EventID=1 or EventID=12 or EventID=13 or EventID=41 or EventID=42 or "
            "EventID=107 or EventID=6005 or EventID=6006 or EventID=6008 or EventID=1074)]]",
        ),
        "application": (
            "Application",
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and "
            "(EventID=1000 or EventID=1001)]]",
        ),
        "terminal_session": (
            "Microsoft-Windows-TerminalServices-LocalSessionManager/Operational",
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and "
            "(EventID=21 or EventID=22 or EventID=23 or EventID=24 or EventID=25 or "
            "EventID=39 or EventID=40)]]",
        ),
        "remote_connection": (
            "Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational",
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and EventID=1149]]",
        ),
        "security_auth": (
            "Security",
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and "
            "(EventID=4624 or EventID=4625 or EventID=4740 or EventID=4776)]]",
        ),
    }
    result: dict[str, Any] = {}
    for key, (log_name, query) in queries.items():
        try:
            completed = subprocess.run(
                ["wevtutil", "qe", log_name, f"/q:{query}", "/f:text", "/c:12", "/rd:true"],
                capture_output=True,
                timeout=12,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            raw = completed.stdout.decode("utf-8", errors="replace")
            if not raw.strip():
                raw = completed.stdout.decode("mbcs", errors="replace")
            # Event messages can be verbose; 12 KB per channel is enough for attribution.
            result[key] = raw[-12_000:]
        except Exception as exc:
            result[key] = {"error": safe_error(exc)}

    # Process Creation auditing is enabled on the target host.  Keep only
    # taskkill/WeChat records so ordinary process activity and command lines
    # are not copied into the stability log.
    try:
        query = (
            "*[System[TimeCreated[timediff(@SystemTime) <= 600000] and EventID=4688]]"
        )
        completed = subprocess.run(
            ["wevtutil", "qe", "Security", f"/q:{query}", "/f:text", "/c:200", "/rd:true"],
            capture_output=True,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = completed.stdout.decode("utf-8", errors="replace")
        if not raw.strip():
            raw = completed.stdout.decode("mbcs", errors="replace")
        blocks = raw.split("Event[")
        relevant = [
            "Event[" + block
            for block in blocks
            if any(name in block.lower() for name in ("taskkill.exe", "weixin.exe", "wechatappex.exe"))
        ]
        result["process_creation"] = "".join(relevant)[-12_000:]
    except Exception as exc:
        result["process_creation"] = {"error": safe_error(exc)}
    return result


def machine_baseline() -> dict[str, Any]:
    node_fingerprint = hashlib.sha256(
        f"{platform.node()}|{platform.machine()}|{platform.platform()}".encode("utf-8")
    ).hexdigest()[:16]
    return {
        "event": "startup",
        "monitor_version": 2,
        "time": now_iso(),
        "pid": os.getpid(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "node_fingerprint": node_fingerprint,
        "poll_seconds": POLL_SECONDS,
        "heartbeat_seconds": HEARTBEAT_SECONDS,
        "log_path": str(LOG_PATH),
        "schedule": schedule_snapshot(),
    }


def collect(ip_cache: dict[str, Any]) -> dict[str, Any]:
    monotonic_now = time.monotonic()
    if monotonic_now >= ip_cache.get("next_refresh", 0):
        ip_cache["snapshot"] = public_ip()
        ip_cache["next_refresh"] = monotonic_now + PUBLIC_IP_SECONDS
    processes = wechat_processes()
    return {
        "time": now_iso(),
        "bridge": passive_wechat_status(),
        "processes": processes,
        "tcp_connections": wechat_connections(processes),
        "resources": resource_snapshot(processes),
        "session": session_snapshot(),
        "desktop": desktop_snapshot(),
        "network": {"local_ip": local_ip(), "public_ip": ip_cache.get("snapshot")},
        "wechat_log_metadata": xlog_metadata(),
        "control_audit": control_audit_snapshot(),
        "safety": safety_snapshot(),
    }


def process_identity(snapshot: dict[str, Any]) -> tuple[tuple[int, str], ...]:
    return tuple((item["pid"], item["created"]) for item in snapshot.get("processes", []))


def main_process_identity(snapshot: dict[str, Any]) -> tuple[int, str] | None:
    processes = snapshot.get("processes", [])
    candidates = [item for item in processes if item.get("name") == "weixin.exe"]
    if not candidates:
        candidates = list(processes)
    if not candidates:
        return None
    main = min(candidates, key=lambda item: (item.get("created", ""), item.get("pid", 0)))
    return (main["pid"], main["created"])


def track_account_session(
    logged_out_main: tuple[int, str] | None,
    current: dict[str, Any],
) -> tuple[tuple[int, str] | None, bool]:
    """Carry a logout across transient UI states such as popup -> unknown -> ok."""
    current_main = main_process_identity(current)
    current_state = (current.get("bridge") or {}).get("state")
    if current_main and current_state in LOGOUT_STATES:
        return current_main, False
    if logged_out_main and current_main == logged_out_main and current_state == "ok":
        return None, True
    if logged_out_main and current_main != logged_out_main:
        return None, False
    return logged_out_main, False


def meaningful_key(snapshot: dict[str, Any]) -> tuple[Any, ...]:
    bridge = snapshot.get("bridge", {})
    session = snapshot.get("session", {})
    desktop = snapshot.get("desktop", {})
    network = snapshot.get("network", {})
    public = network.get("public_ip") or {}
    safety = snapshot.get("safety") or {}
    return (
        bridge.get("reachable"),
        bridge.get("connected"),
        bridge.get("state"),
        bridge.get("detail"),
        bridge.get("hwnd"),
        process_identity(snapshot),
        session.get("active_console_id"),
        session.get("monitor_session_id"),
        tuple(desktop.get("primary", [])),
        tuple(desktop.get("virtual", [])),
        desktop.get("monitor_count"),
        desktop.get("remote_session"),
        network.get("local_ip"),
        public.get("value"),
        json.dumps(safety, ensure_ascii=False, sort_keys=True),
    )


def classify(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[str]:
    if previous is None:
        return ["baseline"]
    reasons: list[str] = []
    old_ids = process_identity(previous)
    new_ids = process_identity(current)
    old_main = main_process_identity(previous)
    new_main = main_process_identity(current)
    old_bridge = previous.get("bridge", {})
    new_bridge = current.get("bridge", {})
    old_state = old_bridge.get("state")
    new_state = new_bridge.get("state")

    if old_main and not new_main:
        reasons.append("wechat_process_stopped")
    elif old_main != new_main:
        reasons.append("wechat_main_process_changed")
    elif old_ids != new_ids:
        reasons.append("wechat_child_process_set_changed")

    if old_main == new_main and old_main and old_state not in LOGOUT_STATES and new_state in LOGOUT_STATES:
        reasons.append("account_session_logout_same_main_process")
    if old_main == new_main and old_main and old_state in LOGOUT_STATES and new_state == "ok":
        reasons.append("account_session_restored_same_main_process")

    if old_bridge.get("reachable") and not new_bridge.get("reachable"):
        reasons.append("bridge_became_unreachable")

    old_session = previous.get("session", {})
    new_session = current.get("session", {})
    if old_session != new_session:
        reasons.append("windows_session_changed")

    old_desktop = previous.get("desktop", {})
    new_desktop = current.get("desktop", {})
    desktop_fields = ("primary", "virtual", "monitor_count", "remote_session")
    if any(old_desktop.get(field) != new_desktop.get(field) for field in desktop_fields):
        reasons.append("display_topology_changed")

    old_network = previous.get("network", {})
    new_network = current.get("network", {})
    old_public = (old_network.get("public_ip") or {}).get("value")
    new_public = (new_network.get("public_ip") or {}).get("value")
    if old_network.get("local_ip") != new_network.get("local_ip") or (
        old_public and new_public and old_public != new_public
    ):
        reasons.append("network_identity_changed")

    if previous.get("safety") != current.get("safety"):
        reasons.append("safety_configuration_changed")

    if new_ids and not new_bridge.get("hwnd"):
        reasons.append("wechat_process_alive_but_window_missing")
    if not reasons:
        reasons.append("wechat_ui_state_changed")
    return reasons


def rotate_if_needed() -> None:
    try:
        if not LOG_PATH.exists() or LOG_PATH.stat().st_size < MAX_LOG_BYTES:
            return
        oldest = LOG_PATH.with_suffix(LOG_PATH.suffix + ".3")
        second = LOG_PATH.with_suffix(LOG_PATH.suffix + ".2")
        first = LOG_PATH.with_suffix(LOG_PATH.suffix + ".1")
        if oldest.exists():
            oldest.unlink()
        if second.exists():
            second.replace(oldest)
        if first.exists():
            first.replace(second)
        LOG_PATH.replace(first)
    except OSError:
        pass


def write_event(value: dict[str, Any]) -> None:
    with LOG_LOCK:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        rotate_if_needed()
        with LOG_PATH.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()


def _process_trace_worker(trace_class: str, action: str) -> None:
    """Record WMI process start/stop events, including the stop exit status."""
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        service = win32com.client.GetObject("winmgmts:{impersonationLevel=impersonate}!\\\\.\\root\\cimv2")
        watcher = service.ExecNotificationQuery(f"SELECT * FROM Win32_Process{trace_class}Trace")
        while True:
            event = watcher.NextEvent()
            name = str(getattr(event, "ProcessName", "") or "").lower()
            if name not in WECHAT_NAMES:
                continue
            parent_pid = int(getattr(event, "ParentProcessID", 0) or 0)
            parent_name = None
            if psutil is not None and parent_pid:
                try:
                    parent_name = psutil.Process(parent_pid).name()
                except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
                    pass
            write_event(
                {
                    "event": "process_trace",
                    "time": now_iso(),
                    "action": action,
                    "name": name,
                    "pid": int(getattr(event, "ProcessID", 0) or 0),
                    "parent_pid": parent_pid,
                    "parent_name": parent_name,
                    "session_id": int(getattr(event, "SessionID", 0) or 0),
                    "exit_status": (
                        int(getattr(event, "ExitStatus", 0) or 0) if action == "stop" else None
                    ),
                }
            )
    except Exception as exc:
        write_event(
            {
                "event": "process_trace_error",
                "time": now_iso(),
                "action": action,
                "error": safe_error(exc),
            }
        )


def start_process_trace_threads() -> None:
    if os.name != "nt":
        return
    for trace_class, action in (("Start", "start"), ("Stop", "stop")):
        threading.Thread(
            target=_process_trace_worker,
            args=(trace_class, action),
            name=f"wechat-process-{action}-trace",
            daemon=True,
        ).start()


def run() -> None:
    write_event(machine_baseline())
    start_process_trace_threads()
    previous: dict[str, Any] | None = None
    logged_out_main: tuple[int, str] | None = None
    last_heartbeat = 0.0
    ip_cache: dict[str, Any] = {}
    while True:
        loop_started = time.monotonic()
        try:
            current = collect(ip_cache)
            logged_out_main, session_restored = track_account_session(logged_out_main, current)
            changed = previous is None or meaningful_key(previous) != meaningful_key(current)
            heartbeat_due = loop_started - last_heartbeat >= HEARTBEAT_SECONDS
            if changed:
                event = dict(current)
                event["event"] = "state_change"
                event["classification"] = classify(previous, current)
                if (
                    session_restored
                    and "account_session_restored_same_main_process" not in event["classification"]
                ):
                    event["classification"].append("account_session_restored_same_main_process")
                # Kept at the top level for compatibility with the original
                # analyzer and existing overnight logs.
                event["schedule"] = (current.get("safety") or {}).get("schedule")
                if previous is not None:
                    event["previous"] = {
                        "time": previous.get("time"),
                        "bridge": previous.get("bridge"),
                        "processes": previous.get("processes"),
                        "session": previous.get("session"),
                        "desktop": previous.get("desktop"),
                        "network": previous.get("network"),
                    }
                    event["recent_windows_events"] = recent_windows_events()
                write_event(event)
                last_heartbeat = loop_started
            elif heartbeat_due:
                event = dict(current)
                event["event"] = "heartbeat"
                write_event(event)
                last_heartbeat = loop_started
            previous = current
        except Exception as exc:
            write_event({"event": "monitor_error", "time": now_iso(), "error": safe_error(exc)})
        elapsed = time.monotonic() - loop_started
        time.sleep(max(1.0, POLL_SECONDS - elapsed))


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        write_event({"event": "shutdown", "time": now_iso(), "reason": "keyboard_interrupt"})
