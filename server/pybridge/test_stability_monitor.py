from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from stability_monitor import (
    classify,
    interpret_uia_state,
    pm2_safety_snapshot,
    track_account_session,
)


def snapshot(
    *,
    state: str = "ok",
    pid: int | None = 100,
    created: str = "2026-08-30T01:00:00+08:00",
    session: int = 2,
    public_ip: str = "203.0.113.10",
    primary: tuple[int, int] = (1920, 1080),
    schedule_enabled: bool = False,
    treekill: bool = False,
) -> dict:
    processes = [] if pid is None else [{"pid": pid, "name": "weixin.exe", "created": created}]
    return {
        "bridge": {
            "reachable": True,
            "connected": state == "ok",
            "state": state,
            "detail": state,
            "hwnd": 123 if pid is not None else 0,
        },
        "processes": processes,
        "session": {"active_console_id": session, "monitor_session_id": session},
        "desktop": {
            "primary": list(primary),
            "virtual": [0, 0, *primary],
            "monitor_count": 1,
            "remote_session": False,
        },
        "network": {"local_ip": "10.0.0.5", "public_ip": {"value": public_ip}},
        "safety": {
            "schedule": {
                "enabled": schedule_enabled,
                "killTime": "03:00",
                "launchTime": "06:00",
                "process_kill_gate": False,
                "hard_recovery_gate": False,
            },
            "pm2_bridge": {"saved": True, "treekill": treekill},
        },
    }


class ClassificationTests(unittest.TestCase):
    def test_same_main_process_logout_is_account_session_event(self) -> None:
        reasons = classify(snapshot(state="ok"), snapshot(state="popup"))
        self.assertIn("account_session_logout_same_main_process", reasons)
        self.assertNotIn("wechat_process_stopped", reasons)
        self.assertNotIn("wechat_main_process_changed", reasons)

    def test_same_main_process_reauthentication_is_account_session_event(self) -> None:
        reasons = classify(snapshot(state="popup"), snapshot(state="ok"))
        self.assertIn("account_session_restored_same_main_process", reasons)
        self.assertNotIn("wechat_process_stopped", reasons)
        self.assertNotIn("wechat_main_process_changed", reasons)

    def test_reauthentication_survives_transient_unknown_ui_state(self) -> None:
        logged_out_main, restored = track_account_session(None, snapshot(state="popup"))
        self.assertFalse(restored)
        logged_out_main, restored = track_account_session(
            logged_out_main, snapshot(state="unknown")
        )
        self.assertFalse(restored)
        logged_out_main, restored = track_account_session(logged_out_main, snapshot(state="ok"))
        self.assertTrue(restored)
        self.assertIsNone(logged_out_main)

    def test_process_stop_is_local_process_event(self) -> None:
        reasons = classify(snapshot(), snapshot(pid=None, state="not_running"))
        self.assertIn("wechat_process_stopped", reasons)
        self.assertNotIn("account_session_logout_same_main_process", reasons)

    def test_process_replacement_is_not_tencent_same_pid_signal(self) -> None:
        reasons = classify(
            snapshot(pid=100),
            snapshot(pid=200, created="2026-08-30T03:00:00+08:00", state="login"),
        )
        self.assertIn("wechat_main_process_changed", reasons)
        self.assertNotIn("account_session_logout_same_main_process", reasons)

    def test_environment_changes_are_attributed_separately(self) -> None:
        reasons = classify(
            snapshot(),
            snapshot(session=3, public_ip="203.0.113.11", primary=(1024, 768)),
        )
        self.assertIn("windows_session_changed", reasons)
        self.assertIn("display_topology_changed", reasons)
        self.assertIn("network_identity_changed", reasons)

    def test_safety_configuration_drift_is_attributed(self) -> None:
        reasons = classify(snapshot(), snapshot(schedule_enabled=True, treekill=True))
        self.assertIn("safety_configuration_changed", reasons)

    def test_pm2_snapshot_extracts_only_non_secret_safety_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dump = [
                {
                    "name": "wx-bridge",
                    "treekill": False,
                    "pm_exec_path": r"C:\Python314\python.exe",
                    "exec_interpreter": "none",
                    "env": {
                        "JWT_SECRET": "must-not-leak",
                        "username": "a",
                        "USERNAME": "b",
                        "ALLOW_WECHAT_AUTO_RECOVERY": "false",
                        "ALLOW_WECHAT_HARD_RECOVERY": "false",
                    },
                }
            ]
            Path(temp_dir, "dump.pm2").write_text(json.dumps(dump), encoding="utf-8")
            with patch.dict(os.environ, {"PM2_HOME": temp_dir}):
                result = pm2_safety_snapshot()

        self.assertEqual(result["treekill"], False)
        self.assertEqual(result["script"], r"C:\Python314\python.exe")
        self.assertEqual(result["auto_recovery_gate"], False)
        self.assertEqual(result["hard_recovery_gate"], False)
        self.assertEqual(result["schedule_process_kill_gate"], False)
        self.assertNotIn("env", result)
        self.assertNotIn("must-not-leak", json.dumps(result))

    def test_security_logout_prompt_is_preserved_without_other_ui_text(self) -> None:
        state, detail = interpret_uia_state(
            {"为了你的账号安全，请重新登录。", "我知道了", "联系人甲"},
            {"mmui::XTextView"},
            36,
        )
        self.assertEqual(state, "popup")
        self.assertEqual(detail, "为了你的账号安全，请重新登录。")
        self.assertNotIn("联系人甲", detail)


if __name__ == "__main__":
    unittest.main()
