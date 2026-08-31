"""
wx4py bridge — lightweight HTTP wrapper for WeChat Windows automation.
Runs on 127.0.0.1:39800 so the Node.js backend can call it locally.
Auto-recovers from 6am kick-off: detects login page, clicks "进入微信".
"""
import sys
import json
import logging
import os
import socket
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s.%(msecs)03d [bridge] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
)
log = logging.getLogger(__name__)

# ── wx4py client (lazy init) ──────────────────────────────────────────
_wx = None

# ── Serial task queue (wx4py is NOT thread-safe!) ──────────────────
_tasks = {}
_tasks_lock = threading.Lock()
_task_counter = [0]
_send_queue = []            # list of (tid, fn, args, kwargs)
_queue_cond = threading.Condition()
_worker_running = True

def _start_task(fn, *args, **kwargs):
    """Enqueue fn for serial execution on single worker thread (wx4py is NOT thread-safe)."""
    with _tasks_lock:
        _task_counter[0] += 1
        tid = str(_task_counter[0])
        _tasks[tid] = {'status': 'pending', 'result': None, 'error': None}
    with _queue_cond:
        _send_queue.append((tid, fn, args, kwargs))
        _queue_cond.notify()
    return tid

def _task_worker():
    """Single-threaded worker: process send tasks one at a time."""
    global _worker_running
    log.info('[queue] Send worker thread started')
    while _worker_running:
        with _queue_cond:
            while _worker_running and not _send_queue:
                _queue_cond.wait(timeout=5)
            if not _worker_running:
                break
            if not _send_queue:
                continue
            tid, fn, args, kwargs = _send_queue.pop(0)
        # Execute task (blocks until done, no concurrency!)
        try:
            result = fn(*args, **kwargs)
            with _tasks_lock:
                _tasks[tid] = {'status': 'success', 'result': result, 'error': None}
        except Exception as e:
            with _tasks_lock:
                _tasks[tid] = {'status': 'failed', 'result': None, 'error': str(e)}
        # Small gap between tasks so WeChat can process the previous message
        time.sleep(0.5)
    log.info('[queue] Send worker thread stopped')

def get_wx():
    global _wx
    if _wx is None:
        from wx4py import WeChatClient
        log.info('Connecting to WeChat window...')
        _wx = WeChatClient(auto_connect=False)
        try:
            _wx.connect()
        except Exception as e:
            log.error(f'WeChat connect failed: {e}')
        log.info(f'Connected: {_wx.is_connected}')
    return _wx

def soft_rebind_uia():
    """
    Soft-rebind wx4py UIA session WITHOUT killing WeChat.

    Use case: after WeChat was killed+relaunched externally, or after VNC
    desktop reset, the cached UIA session inside wx4py points to stale
    HWNDs. A full disconnect+connect rebuilds the session against the
    CURRENT WeChat process while keeping WeChat running.
    """
    global _wx
    result = {'ok': False, 'before': None, 'after': None, 'hwnd': None}
    try:
        # Snapshot pre-state
        before_hwnd = None
        before_connected = False
        try:
            wx = get_wx()
            before_connected = wx.is_connected
            if hasattr(wx, '_window') and getattr(wx._window, 'hwnd', None):
                before_hwnd = wx._window.hwnd
        except Exception:
            pass
        result['before'] = {'connected': before_connected, 'hwnd': before_hwnd}

        # Force disconnect (don't kill WeChat!)
        try:
            wx = get_wx()
            try:
                wx.disconnect()
            except Exception as e:
                log.debug(f'[soft-rebind] disconnect exception (ignored): {e}')
        except Exception:
            pass

        # Drop the cached client entirely
        _wx = None

        # Re-create + re-connect
        from wx4py import WeChatClient
        new_wx = WeChatClient(auto_connect=False)
        try:
            new_wx.connect()
        except Exception as e:
            log.error(f'[soft-rebind] reconnect failed: {e}')
            return {**result, 'ok': False, 'error': str(e)}

        _wx = new_wx
        after_connected = new_wx.is_connected
        after_hwnd = None
        if hasattr(new_wx, '_window') and getattr(new_wx._window, 'hwnd', None):
            after_hwnd = new_wx._window.hwnd
        result['after'] = {'connected': after_connected, 'hwnd': after_hwnd}
        result['hwnd'] = after_hwnd
        result['ok'] = after_connected

        log.info(f'[soft-rebind] OK: before={result["before"]} → after={result["after"]}')
        return result
    except Exception as e:
        log.error(f'[soft-rebind] failed: {e}')
        return {**result, 'ok': False, 'error': str(e)}

def _is_main_window(hwnd):
    """True only for the real MAIN window. Login/QR windows can exceed 30 nodes
    (login page ~27 + popup dialog ~9 = 36), so exclude known login markers first."""
    try:
        import pythoncom; pythoncom.CoInitialize()
        import comtypes.client as cc
        import comtypes.gen.UIAutomationClient as UIA
        uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
        elem = uia.ElementFromHandle(hwnd)
        all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
        login_names = {'我知道了', '进入微信', '登录', '切换账号', '仅传输文件', '为了你的账号安全，请重新登录。'}
        for i in range(all_e.Length):
            e = all_e.GetElement(i)
            n = (e.CurrentName or '').strip()
            c = e.CurrentClassName or ''
            if n in login_names or 'LoginWindow' in c:
                return False
        return all_e.Length > 30
    except Exception:
        return False


# ── Hard recovery utilities (kill + launch, reusable from both HTTP and auto-recover) ──

def _kill_wechat():
    """Kill all WeChat processes. Returns count of killed PIDs."""
    import psutil, subprocess
    killed = 0
    # Method 1: psutil kill by known process names
    for proc in psutil.process_iter(['pid', 'name']):
        name = (proc.info['name'] or '').lower()
        if name in ('weixin.exe', 'wechatappex.exe', 'wechat.exe'):
            try:
                p = psutil.Process(proc.info['pid'])
                for child in p.children(recursive=True):
                    try: child.kill(); killed += 1
                    except: pass
                p.kill(); killed += 1
            except: pass
    # Method 2: taskkill by name for any stragglers
    for exe in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
        try:
            subprocess.run(['taskkill', '/F', '/IM', exe],
                          capture_output=True, timeout=5)
        except: pass
    time.sleep(1)
    # Follow-up kill
    for exe in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
        try:
            subprocess.run(['taskkill', '/F', '/IM', exe],
                          capture_output=True, timeout=3)
        except: pass
    log.info(f'[recover] Killed WeChat ({killed} PIDs + taskkill)')
    return killed

def _launch_wechat():
    """Launch WeChat and return True if launched successfully."""
    import os, subprocess, winreg as wr
    
    # Try known paths
    paths = []
    try:
        key = wr.OpenKey(wr.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Weixin.exe')
        p, _ = wr.QueryValueEx(key, '')
        if p: paths.append(p)
    except: pass
    
    # Auto-find from disk
    for base in [os.environ.get('ProgramFiles', 'C:\\Program Files'),
                 os.environ.get('ProgramFiles(x86)', 'C:\\Program Files (x86)'),
                 os.environ.get('LOCALAPPDATA', '')]:
        for sub in ['Tencent\\Weixin\\Weixin.exe', 'Tencent\\WeChat\\WeChat.exe',
                     'Tencent\\WeChatAppEx\\WeChatAppEx.exe']:
            fp = os.path.join(base, sub)
            if os.path.exists(fp):
                paths.append(fp)
    
    # Try shell:AppsFolder as last resort
    if not paths:
        try:
            out = subprocess.check_output(
                'powershell -NoProfile -c "Get-StartApps | Where-Object { \\$_.Name -eq \'\\u5fae\\u4fe1\' } | Select-Object -ExpandProperty AppID"',
                shell=True, encoding='gbk', errors='ignore', timeout=10
            )
            appid = out.strip()
            if appid:
                subprocess.Popen(f'explorer shell:AppsFolder\\{appid}', shell=True)
                log.info(f'[recover] Launched via shell:AppsFolder')
                return True
        except: pass
        log.warning('[recover] Could not find WeChat exe path')
        return False
    
    for exe in paths:
        if os.path.exists(exe):
            subprocess.Popen([exe], shell=True)
            log.info(f'[recover] Launched WeChat: {exe}')
            return True
    
    log.warning('[recover] No valid WeChat exe found')
    return False

def _get_wechat_ui_node_count(hwnd):
    """Quick UIA scan: return total node count, or -1 on error."""
    try:
        import pythoncom; pythoncom.CoInitialize()
        import comtypes.client as cc
        import comtypes.gen.UIAutomationClient as UIA
        uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
        elem = uia.ElementFromHandle(hwnd)
        return elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition()).Length
    except Exception:
        return -1


# ── Auto-recovery: detect login page and click "进入微信" ─────────────
AUTO_RECOVER_ENABLED = os.environ.get('ALLOW_WECHAT_AUTO_RECOVERY') == 'true'
AUTO_RECOVER_INTERVAL = 300  # check every 5min
LAST_RECOVER_ACTION = 0      # timestamp of last recovery action (cooldown)
HARD_RECOVER_ENABLED = os.environ.get('ALLOW_WECHAT_HARD_RECOVERY') == 'true'
HARD_RECOVER_COOLDOWN = 0    # separate cooldown for hard recovery (prevent kill loops)
_recover_lock = threading.Lock()  # prevent concurrent recovery threads

# ── QR live stream ────────────────────────────────────────────────────
# While WeChat shows the QR login window, capture & upload one frame every
# QR_STREAM_INTERVAL s. Node hosts a live page; the offline notice (pushed
# once by botManager with a 30min cooldown) points to that page.
QR_STREAM_INTERVAL = 30      # seconds between frames (QR refreshes ~every 2min)
_qr_stream_stop = threading.Event()
_qr_stream_thread = None
_qr_stream_lock = threading.Lock()

def _read_env_cfg():
    """Read server/.env (../.env relative to this file) → dict."""
    import os
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    cfg = {}
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    cfg[k.strip()] = v.strip()
    except Exception as e:
        log.warning(f'[qr] Cannot read .env: {e}')
    return cfg

def _capture_window_png(hwnd):
    """Capture the window's screen region → PNG bytes. Returns None on failure.
    Requires the window to be foreground-visible (BitBlt reads real pixels)."""
    import ctypes
    from ctypes import wintypes
    import win32gui
    try:
        from PIL import Image
    except ImportError:
        log.warning('[qr] Pillow not installed — cannot encode PNG, skipping push')
        return None
    import io

    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    # Clip to screen bounds (window may hang off-edge)
    user32 = ctypes.windll.user32
    sw = user32.GetSystemMetrics(0)
    sh = user32.GetSystemMetrics(1)
    left, top = max(0, left), max(0, top)
    right, bottom = min(sw, right), min(sh, bottom)
    w, h = right - left, bottom - top
    if w < 50 or h < 50:
        log.warning(f'[qr] Window rect too small: {w}x{h}')
        return None

    SRCCOPY = 0x00CC0020
    gdi32 = ctypes.windll.gdi32
    hdc_screen = user32.GetDC(0)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    hbm = gdi32.CreateCompatibleBitmap(hdc_screen, w, h)
    gdi32.SelectObject(hdc_mem, hbm)
    gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, left, top, SRCCOPY)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
            ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
            ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = w
    bmi.biHeight = -h  # top-down
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0
    buf = (ctypes.c_ubyte * (w * h * 4))()
    gdi32.GetDIBits(hdc_mem, hbm, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(hbm)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(0, hdc_screen)

    img = Image.frombytes('RGBA', (w, h), bytes(buf), 'raw', 'BGRA').convert('RGB')
    out = io.BytesIO()
    img.save(out, 'PNG')
    return out.getvalue()

def _qr_upload_frame(png):
    """Upload one PNG frame to the Node server (localhost). Returns resp dict."""
    import base64, urllib.request
    cfg = _read_env_cfg()
    port = cfg.get('PORT', '3000')
    secret = cfg.get('QR_PUSH_SECRET', '')
    body = json.dumps({
        'secret': secret,
        'image': base64.b64encode(png).decode(),
    }).encode('utf-8')
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/api/qr/live',
        data=body, headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def _qr_stream_worker():
    """Capture the WeChat window every QR_STREAM_INTERVAL s until stopped."""
    import ctypes, win32gui, win32con
    from wx4py.core.win32 import find_wechat_window
    while not _qr_stream_stop.is_set():
        try:
            hwnd = find_wechat_window()
            if not hwnd:
                log.info('[qr-stream] No WeChat window, retrying next tick')
            else:
                # Bring to front so BitBlt captures real pixels (VNC daemon keeps desktop alive)
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                time.sleep(0.3)
                ctypes.windll.user32.SetForegroundWindow(hwnd)
                time.sleep(0.8)
                png = _capture_window_png(hwnd)
                if png:
                    r = _qr_upload_frame(png)
                    log.info(f"[qr-stream] frame uploaded → {r.get('url', '?')}")
                else:
                    log.warning('[qr-stream] Capture failed, retrying next tick')
        except Exception as e:
            log.warning(f'[qr-stream] Upload failed: {e}')
        _qr_stream_stop.wait(QR_STREAM_INTERVAL)

def start_qr_stream():
    """Start the live QR screenshot stream (idempotent)."""
    global _qr_stream_thread
    with _qr_stream_lock:
        if _qr_stream_thread and _qr_stream_thread.is_alive():
            return
        _qr_stream_stop.clear()
        _qr_stream_thread = threading.Thread(target=_qr_stream_worker, daemon=True)
        _qr_stream_thread.start()
        log.info(f'[qr-stream] Live stream started ({QR_STREAM_INTERVAL}s/frame)')

def stop_qr_stream():
    """Stop the stream and tell Node to revoke the live page (WeChat recovered)."""
    global _qr_stream_thread
    with _qr_stream_lock:
        _qr_stream_stop.set()
        if _qr_stream_thread:
            _qr_stream_thread.join(timeout=10)
        _qr_stream_thread = None
        _qr_stream_stop.clear()
    try:
        import urllib.request
        cfg = _read_env_cfg()
        port = cfg.get('PORT', '3000')
        secret = cfg.get('QR_PUSH_SECRET', '')
        body = json.dumps({'secret': secret}).encode('utf-8')
        req = urllib.request.Request(
            f'http://127.0.0.1:{port}/api/qr/clear',
            data=body, headers={'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        log.info('[qr-stream] Live stream stopped, page revoked')
    except Exception as e:
        log.warning(f'[qr-stream] Stop/clear notification failed: {e}')


def _dismiss_wechat_update_prompt():
    """Dismiss WeChat's update prompt without ever accepting an update."""
    import ctypes
    import pythoncom
    import time
    import win32gui
    import comtypes.client as cc
    import comtypes.gen.UIAutomationClient as UIA
    from wx4py.core.win32 import find_wechat_window

    pythoncom.CoInitialize()
    candidates = []
    primary_hwnd = find_wechat_window() or 0
    if primary_hwnd:
        candidates.append(primary_hwnd)

    # WeChat can keep its main window and update window alive at the same
    # time. find_wechat_window() may return either one, so inspect every
    # visible top-level WeChat/Qt window instead of trusting the first HWND.
    def _enum_candidate(hwnd, _):
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return
            title = (win32gui.GetWindowText(hwnd) or '').strip()
            class_name = win32gui.GetClassName(hwnd) or ''
            if (title in ('\u5fae\u4fe1', 'WeChat') or '\u5fae\u4fe1' in title) and class_name.startswith('Qt'):
                if hwnd not in candidates:
                    candidates.append(hwnd)
        except Exception:
            pass

    win32gui.EnumWindows(_enum_candidate, None)
    if not candidates:
        log.info('[recover] Update preflight found no candidate WeChat windows')
        return False

    uia = cc.CreateObject(
        '{ff48dba4-60ef-4201-aa87-54103eef594e}',
        interface=UIA.IUIAutomation,
    )

    def _scan(hwnd):
        root = uia.ElementFromHandle(hwnd)
        nodes = root.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
        items = []
        names = set()
        classes = set()
        for idx in range(nodes.Length):
            node = nodes.GetElement(idx)
            name = (node.CurrentName or '').strip()
            class_name = node.CurrentClassName or ''
            items.append((node, name, class_name))
            if name:
                names.add(name)
            if class_name:
                classes.add(class_name)
        return items, names, classes

    update_hwnd = 0
    target = None
    target_name = None
    for candidate_hwnd in candidates:
        try:
            items, names, classes = _scan(candidate_hwnd)
        except Exception as scan_err:
            log.info(f'[recover] Update preflight scan failed hwnd={candidate_hwnd}: {scan_err}')
            continue
        has_new_version = any('\u65b0\u7248\u672c' in name for name in names)
        has_update = any(name == '\u66f4\u65b0' for name in names)
        has_ignore = any('\u5ffd\u7565\u672c\u6b21\u66f4\u65b0' in name for name in names)
        is_update_prompt = (
            has_new_version
            and has_update
            and ('mmui::UpdateWindow' in classes or has_ignore)
        )
        if not is_update_prompt:
            if len(items) <= 30:
                log.info(
                    f'[recover] Update preflight did not match hwnd={candidate_hwnd}: '
                    f'names={sorted(names)!r}, classes={sorted(classes)!r}'
                )
            continue
        update_hwnd = candidate_hwnd
        for preferred_name in ('\u5ffd\u7565\u672c\u6b21\u66f4\u65b0', '\u7a0d\u540e\u5904\u7406'):
            for node, name, class_name in items:
                if preferred_name in name and 'Button' in class_name:
                    target = node
                    target_name = preferred_name
                    break
            if target:
                break
        break

    if not update_hwnd:
        return False
    if not target:
        log.warning('[recover] Update prompt detected but no safe dismiss button was found')
        return False

    log.info(f'[recover] Update prompt detected; safely choosing "{target_name}"')
    invoked = False
    try:
        pattern_obj = target.GetCurrentPattern(UIA.UIA_InvokePatternId)
        if pattern_obj:
            pattern_obj.QueryInterface(UIA.IUIAutomationInvokePattern).Invoke()
            invoked = True
    except Exception as invoke_err:
        log.warning(f'[recover] Update dismiss InvokePattern failed: {invoke_err}')

    time.sleep(1)
    try:
        _, names_after, _ = _scan(update_hwnd)
    except Exception:
        names_after = set()

    # Some WeChat controls expose InvokePattern but ignore Invoke().  Only
    # fall back to a coordinate click if the verified update prompt remains.
    if any('\u65b0\u7248\u672c' in name for name in names_after):
        br = target.CurrentBoundingRectangle
        cx = (br.left + br.right) // 2
        cy = (br.top + br.bottom) // 2
        ctypes.windll.user32.SetCursorPos(cx, cy)
        ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.03)
        ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
        log.info(f'[recover] Update dismiss coordinate fallback at ({cx},{cy})')

    time.sleep(2)
    return True

def try_auto_recover():
    """Auto-recovery: reconnect wx4py if needed, then handle login page."""
    global _wx, LAST_RECOVER_ACTION
    try:
        import ctypes, win32gui, win32con, time
        from wx4py.core.win32 import find_wechat_window  # hoisted: Step 0 uses it even when Step -1 skips its own import

        # Cooldown: if we did recovery action in last 10min, skip to avoid re-triggering
        if time.time() - LAST_RECOVER_ACTION < 600:
            return

        # Lock: only one recovery thread at a time (prevents concurrent bombing)
        if not _recover_lock.acquire(blocking=False):
            log.info('[recover] Another recovery already running, skipping...')
            return

        # Handle a foreground update prompt before wx4py rebind/window
        # selection can switch focus back to the obscured main window.
        try:
            if _dismiss_wechat_update_prompt():
                LAST_RECOVER_ACTION = time.time()
                stop_qr_stream()
        except Exception as update_err:
            log.warning(f'[recover] Update prompt handling failed: {update_err}')

        # ── Step -1: Detect stale wx4py session and soft-rebind (NO KILL) ──
        # Symptom: bridge.is_connected=True, HWND is current, but click/send
        # silently fails because the cached UIA session inside wx4py points
        # to old (now-dead) HWNDs. We detect by checking if wx4py's cached
        # hwnd matches the live one — if not, soft-rebind without killing.
        try:
            wx = get_wx()
            if wx.is_connected:
                cached_hwnd = None
                try:
                    if hasattr(wx, '_window') and getattr(wx._window, 'hwnd', None):
                        cached_hwnd = wx._window.hwnd
                except Exception:
                    pass
                # Compare cached hwnd to live hwnd
                live_hwnd = 0
                try:
                    from wx4py.core.win32 import find_wechat_window
                    live_hwnd = find_wechat_window() or 0
                except Exception:
                    pass
                if cached_hwnd and live_hwnd and cached_hwnd != live_hwnd:
                    log.warning(f'[recover] Stale wx4py session: cached_hwnd={cached_hwnd}, live_hwnd={live_hwnd} → soft-rebind')
                    rebind_result = soft_rebind_uia()
                    if rebind_result.get('ok'):
                        log.info(f'[recover] Soft-rebind OK: {rebind_result}')
                    else:
                        log.warning(f'[recover] Soft-rebind failed: {rebind_result}')
                    LAST_RECOVER_ACTION = time.time()
                elif cached_hwnd and not win32gui.IsWindow(cached_hwnd):
                    log.warning(f'[recover] Cached hwnd {cached_hwnd} is dead → soft-rebind')
                    rebind_result = soft_rebind_uia()
                    if rebind_result.get('ok'):
                        log.info(f'[recover] Soft-rebind OK after dead hwnd')
                    LAST_RECOVER_ACTION = time.time()
                # else: hwnd matches → no stale session, skip
        except Exception as e:
            log.debug(f'[recover] soft-rebind check failed: {e}')

        # ── Step 0: Hard recovery for white screen (loading with ≤3 nodes) ──
        global HARD_RECOVER_COOLDOWN
        try:
            hwnd = find_wechat_window()
            if hwnd:
                node_count = _get_wechat_ui_node_count(hwnd)
                if 0 < node_count <= 3 and not _is_main_window(hwnd):
                    now = time.time()
                    if not HARD_RECOVER_ENABLED:
                        log.warning(
                            f'[recover] White screen candidate ({node_count} nodes); '
                            'hard recovery disabled — leaving WeChat running'
                        )
                    elif now - HARD_RECOVER_COOLDOWN < 1800:  # max once per 30min
                        log.info(f'[recover] White screen ({node_count} nodes) but hard-recover cooldown active, skipping')
                    else:
                        log.info(f'[recover] White screen detected ({node_count} nodes) → triggering hard recovery (kill + relaunch)')
                        LAST_RECOVER_ACTION = now
                        HARD_RECOVER_COOLDOWN = now
                        _kill_wechat()
                        time.sleep(5)
                        _launch_wechat()
                        time.sleep(20)  # wait for WeChat to fully start
                        # After hard recovery, continue to normal recover flow for login click
                elif node_count <= 3 and _is_main_window(hwnd):
                    log.info(f'[recover] Detected main window with few nodes ({node_count}), may be transient — will retry next cycle')
        except Exception as e:
            log.warning(f'[recover] White screen check failed: {e}')

        def click_at(cx, cy):
            ctypes.windll.user32.SetCursorPos(cx, cy)
            time.sleep(0.05)
            ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(0.15)

        # ── Step 0: reconnect wx4py if stale ──
        try:
            wx = get_wx()
            if not wx.is_connected:
                log.info('[recover] wx4py disconnected, attempting reconnect...')
                try:
                    wx.disconnect()
                except Exception:
                    pass
                _wx = None
                get_wx()  # will reconnect
                LAST_RECOVER_ACTION = time.time()
        except Exception:
            pass

        # ── Step 1: quick skip if wx4py already healthy ──
        try:
            wx = get_wx()
            if wx.is_connected:
                hwnd_quick = wx._window.hwnd if hasattr(wx, '_window') else 0
                # Verify hwnd is still alive (not a zombie from killed WeChat)
                if hwnd_quick and win32gui.IsWindow(hwnd_quick) and _is_main_window(hwnd_quick):
                    stop_qr_stream()  # already healthy — make sure no stream lingers
                    return  # healthy — skip recovery
        except Exception:
            pass
        # ── Step 2: find WeChat window ──
        hwnd = 0
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window() or 0
        except Exception:
            pass

        if not hwnd:
            log.debug('[recover] No WeChat window found — WeChat may not be running')
            return

        title = win32gui.GetWindowText(hwnd) or ''
        class_name = win32gui.GetClassName(hwnd) or ''
        log.info(f'[recover] WeChat: HWND={hwnd} title={title[:30]!r} class={class_name}')

        # ── Step 3: bring to foreground + let it fully render (20s) ──
        from wx4py.core.win32 import is_window_visible
        if not is_window_visible(hwnd):
            log.info('[recover] WeChat not visible, restoring...')
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.5)
        ctypes.windll.user32.SetForegroundWindow(hwnd)
        time.sleep(0.5)

        # ── Step 4: UIA scan for popup / login ──
        clicked_login = False

        try:
            import pythoncom; pythoncom.CoInitialize()
            import comtypes.client as cc
            import comtypes.gen.UIAutomationClient as UIA

            # Refresh hwnd after bring-to-front (window may have changed)
            hwnd = find_wechat_window() or hwnd

            uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
            elem = uia.ElementFromHandle(hwnd)
            all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())

            def _uia_click(e, label):
                """InvokePattern → coordinate click (VNC daemon keeps desktop active)."""
                import ctypes
                br = e.CurrentBoundingRectangle
                cx = (br.left+br.right)//2; cy = (br.top+br.bottom)//2

                # Try InvokePattern
                try:
                    pattern_obj = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
                    if pattern_obj:
                        invoke = pattern_obj.QueryInterface(UIA.IUIAutomationInvokePattern)
                        invoke.Invoke()
                        time.sleep(1)
                except Exception:
                    pass

                # Coordinate click (works because VNC daemon keeps desktop alive)
                log.info(f'[recover] Click "{label}" at ({cx},{cy})')
                click_at(cx, cy)
                time.sleep(0.5)
                ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, 0, 0)
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, win32con.KEYEVENTF_KEYUP, 0)
                return True

            def _verify_main_window():
                """Check if WeChat is now on main window (not login page)."""
                try:
                    hwnd_now = find_wechat_window()
                    return hwnd_now and _is_main_window(hwnd_now)
                except Exception:
                    return False

            # A WeChat update prompt can become the foreground WeChat window
            # immediately after login and hide the main UI from wx4py.  Dismiss
            # only the non-updating choices; never click the update button.
            update_dismissed = False
            for dismiss_name in ('忽略本次更新', '稍后处理'):
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = (e.CurrentName or '').strip()
                    if n != dismiss_name:
                        continue

                    log.info(f'[recover] WeChat update prompt detected; dismissing with "{dismiss_name}"')
                    invoked = False
                    try:
                        pattern_obj = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
                        if pattern_obj:
                            pattern_obj.QueryInterface(UIA.IUIAutomationInvokePattern).Invoke()
                            invoked = True
                    except Exception as invoke_err:
                        log.warning(f'[recover] Update dismiss InvokePattern failed: {invoke_err}')

                    if not invoked:
                        br = e.CurrentBoundingRectangle
                        click_at((br.left + br.right) // 2, (br.top + br.bottom) // 2)

                    update_dismissed = True
                    time.sleep(2)
                    hwnd = find_wechat_window() or hwnd
                    elem = uia.ElementFromHandle(hwnd)
                    all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
                    break
                if update_dismissed:
                    break

            # Check for popup with "我知道了"
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = e.CurrentName or ''; c = e.CurrentClassName or ''
                if n == '我知道了' and ('Button' in c or 'mmui' in c):
                    _uia_click(e, '我知道了')
                    time.sleep(2)
                    hwnd = find_wechat_window() or hwnd
                    elem = uia.ElementFromHandle(hwnd)
                    all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
                    break

            # ── Find "进入微信" / "登录" element ──
            login_elem = None
            for pref_class in ('mmui::XTextView', 'mmui::XOutlineButton', 'mmui::XButton'):
                if login_elem: break
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = e.CurrentName or ''; c = e.CurrentClassName or ''
                    if n in ('登录', '进入微信') and pref_class in c:
                        login_elem = e
                        break
            # Fallback: any element with matching name
            if not login_elem:
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = e.CurrentName or ''
                    if n in ('登录', '进入微信'):
                        login_elem = e
                        break

            if not login_elem:
                log.info('[recover] UIA didn\'t find login button, skipping')
                # No login button and not on main window — likely already showing
                # the QR code window (e.g. clicked in a previous cycle). Push it.
                # Guard: skip if main-window markers present (stray popup after login).
                has_main_marker = False
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = (e.CurrentName or '').strip()
                    c = e.CurrentClassName or ''
                    if n == '搜索' or 'ChatInputField' in c:
                        has_main_marker = True
                        break
                if not has_main_marker:
                    start_qr_stream()  # QR login window is up — stream it live
            else:
                br = login_elem.CurrentBoundingRectangle
                btn_cx = (br.left + br.right) // 2
                btn_cy = (br.top + br.bottom) // 2

                # Simple 2-retry coordinate click (VNC daemon keeps desktop active)
                for attempt in range(1, 3):
                    cx = btn_cx + (10 if attempt == 2 else 0)  # slight offset on retry
                    cy = btn_cy + (5 if attempt == 2 else 0)
                    log.info(f'[recover] Coordinate click attempt {attempt}/2 at ({cx},{cy})')
                    
                    # InvokePattern
                    try:
                        pattern = login_elem.GetCurrentPattern(UIA.UIA_InvokePatternId)
                        if pattern:
                            pattern.QueryInterface(UIA.IUIAutomationInvokePattern).Invoke()
                            log.info(f'[recover] InvokePattern fired')
                    except Exception:
                        pass

                    # Coordinate click (works because VNC daemon keeps desktop alive)
                    click_at(cx, cy)
                    time.sleep(0.5)
                    ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, 0, 0)
                    time.sleep(0.1)
                    ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, win32con.KEYEVENTF_KEYUP, 0)
                    time.sleep(2)

                    if _verify_main_window():
                        log.info(f'[recover] Login successful on attempt {attempt}')
                        clicked_login = True
                        break
                    
                    log.info(f'[recover] Attempt {attempt}/2 no effect, retrying...')

                if not clicked_login:
                    log.info('[recover] Both attempts failed, will retry next cycle')

        except Exception as e:
            log.warning(f'[recover] UIA scan failed: {e}')

        # ── Step 5: short wait for main window after successful login click ──
        if clicked_login:
            log.info('[recover] Login click succeeded, waiting for main window...')
            for i in range(16):  # 16 × 0.5s = 8s (shorter, retry loop already verified)
                time.sleep(0.5)
                try:
                    hwnd = find_wechat_window()
                    if hwnd and _is_main_window(hwnd):
                        log.info(f'[recover] Main window appeared: HWND={hwnd}')
                        stop_qr_stream()  # back online — revoke live page
                        if _wx is not None:
                            try:
                                _wx.disconnect()
                            except Exception:
                                pass
                        _wx = None
                        try:
                            wx_new = get_wx()
                            log.info(f'[recover] Reconnected: {wx_new.is_connected}')
                        except Exception as e:
                            log.warning(f'[recover] Reconnect failed: {e}, will retry on next request')
                        return
                except Exception:
                    pass
            log.warning('[recover] Timed out waiting for main window after successful click')
            # Clicked "进入微信" but no main window — WeChat is showing the QR
            # code (or phone-confirm page). Stream it live.
            start_qr_stream()

        # ── Step 6: no longer needed — VNC daemon keeps desktop active, coordinate clicks work.
        # This step is intentionally empty.

    except Exception as e:
        log.error(f'[recover] Error: {e}')
    finally:
        try:
            _recover_lock.release()
        except Exception:
            pass


def _auto_recover_loop():
    """Background thread: periodically check and recover."""
    if not AUTO_RECOVER_ENABLED:
        log.info('[recover] Background auto-recovery disabled; manual /recover remains available')
        return
    log.info(f'[recover] Auto-recovery enabled, checking every {AUTO_RECOVER_INTERVAL}s')
    while AUTO_RECOVER_ENABLED:
        time.sleep(AUTO_RECOVER_INTERVAL)
        try:
            try_auto_recover()
        except Exception as e:
            log.error(f'[recover] Loop error: {e}')


# ── @ mention send (group chats) ──────────────────────────────────────
# A real WeChat mention can only be composed by typing "@" in the group chat
# input: that pops up the member picker, and the picked member becomes a
# highlighted token. Pasting "@昵称" as plain text does NOT mention anyone.
import re as _re

_AT_MENTION_RE = _re.compile(r'@([^\s@，。,；;：:！!？?~～]+)')
_SENDKEYS_SPECIAL = set('+^%~(){}[]')


def _sendkeys_literal(edit, text):
    """Type raw text via UIA SendKeys, escaping characters with key syntax."""
    escaped = ''.join('{' + ch + '}' if ch in _SENDKEYS_SPECIAL else ch for ch in text)
    edit.SendKeys(escaped)


def _parse_at_segments(message):
    """Split a message into [('text', s) | ('at', nickname)] segments."""
    segments, pos = [], 0
    for m in _AT_MENTION_RE.finditer(message):
        if m.start() > pos:
            segments.append(('text', message[pos:m.start()]))
        segments.append(('at', m.group(1)))
        pos = m.end()
    if pos < len(message):
        segments.append(('text', message[pos:]))
    return segments


def _ctrl_rect(ctrl):
    try:
        r = ctrl.BoundingRectangle
        return (r.left, r.top, r.right, r.bottom)
    except Exception:
        return None


def _collect_item_containers(root, deadline, edit_rect, root_rect, max_depth=12):
    """Collect controls that look like rendered lists of named items.

    WeChat 4.x (mmui) does not always expose the '@' member picker as a
    ListControl, so accept any container with >=2 named children whose
    geometry is compatible with a picker popup near the chat input.
    """
    out = []

    def walk(ctrl, depth):
        if time.time() > deadline or depth > max_depth or len(out) >= 60:
            return
        try:
            children = ctrl.GetChildren()
        except Exception:
            return
        named = 0
        for c in children:
            try:
                if (c.Name or '').strip():
                    named += 1
                    if named >= 2:
                        break
            except Exception:
                continue
        if named >= 2:
            out.append(ctrl)
        for c in children:
            walk(c, depth + 1)

    walk(root, 0)
    return out


def _rects_overlap_h(a, b, fraction=0.4):
    """True when horizontal ranges of two rects overlap by >= fraction of b's width."""
    overlap = min(a[2], b[2]) - max(a[0], b[0])
    width = b[2] - b[0]
    return width > 0 and overlap >= width * fraction


def _score_at_popup_container(ctrl, edit_rect, root_rect, nickname):
    """Score a candidate container as the '@' member picker.

    Returns (score, matched_item). >0 means plausible picker; >=5 means a
    member matching the filter text was found inside.
    """
    rect = _ctrl_rect(ctrl)
    if not rect or not edit_rect:
        return -1, None
    l, t, r, b = rect
    if r - l < 80 or b - t < 30:
        return -1, None
    el, et, er, eb = edit_rect
    if not _rects_overlap_h(rect, edit_rect, 0.5):
        return -1, None
    # picker floats above OR below the input box, within a screen or so
    above = 0 <= et - b <= 450
    below = 0 <= t - eb <= 450
    if not (above or below):
        return -1, None
    if root_rect and (b - t) > 0.6 * (root_rect[3] - root_rect[1]):
        return -2, None

    score = 1
    identity = ''
    try:
        identity = f'{ctrl.ClassName or ""} {ctrl.AutomationId or ""}'
    except Exception:
        pass
    if any(k in identity for k in ('Member', 'Select', 'At', 'Popover', 'Popup', 'Tip')):
        score += 3

    matched = None
    best_name = None
    try:
        items = ctrl.GetChildren()
    except Exception:
        return -1, None
    for it in items:
        try:
            name = (it.Name or '').strip()
        except Exception:
            continue
        if not name:
            continue
        if nickname and nickname in name:
            if best_name is None or len(name) < len(best_name):
                best_name = name
                matched = it
    if matched is not None:
        score += 4
    return score, matched


def _find_at_member_popup(wx, edit, nickname, timeout=3.0):
    """Locate the member picker that appears after typing '@'+nickname.

    Returns (container, matched_item). Either may be None when the popup
    didn't render or nothing matched the filter text.
    """
    root = wx.chat_window.root
    edit_rect = _ctrl_rect(edit)
    root_rect = _ctrl_rect(root)
    deadline = time.time() + timeout
    best_ctrl, best_item, best_score = None, None, 0
    while time.time() < deadline:
        for ctrl in _collect_item_containers(root, deadline, edit_rect, root_rect):
            score, item = _score_at_popup_container(ctrl, edit_rect, root_rect, nickname)
            if score > best_score:
                best_ctrl, best_item, best_score = ctrl, item, score
        if best_score >= 5:  # identity/match hit — good enough, stop polling
            break
        if best_score > 0:
            break  # geometric match only; one pass is enough, don't spam UIA
        time.sleep(0.4)
    if best_ctrl is not None:
        try:
            log.info(f'[at-send] popup: type={best_ctrl.ControlTypeName} cls={best_ctrl.ClassName} '
                     f'id={best_ctrl.AutomationId} score={best_score}')
        except Exception:
            pass
    else:
        log.warning('[at-send] popup scan found no candidate container')
    return best_ctrl, best_item


def _click_list_item(item):
    for attempt in (('click', lambda: item.Click(simulateMove=False)),
                    ('click2', lambda: item.Click()),
                    ('select', lambda: item.Select())):
        label, fn = attempt
        try:
            fn()
            return True
        except Exception as e:
            log.debug(f'[at-send] {label} failed: {e}')
    return False


def _type_at_mention(wx, edit, nickname):
    """Insert one real mention into the input. Returns False only on fatal
    input errors; an unmatched nickname degrades to plain text."""
    try:
        edit.SendKeys('@')
    except Exception as e:
        log.error(f'[at-send] typing "@" failed: {e}')
        return False
    time.sleep(0.5)
    if nickname:
        try:
            _sendkeys_literal(edit, nickname)
        except Exception as e:
            log.debug(f'[at-send] typing filter "{nickname}" failed: {e}')
    time.sleep(0.5)

    lst, item = _find_at_member_popup(wx, edit, nickname)
    if lst is None or item is None:
        reason = 'popup not found' if lst is None else f'no member matches "{nickname}"'
        log.warning(f'[at-send] {reason}; keeping "@{nickname}" as plain text')
        try:
            edit.SendKeys('{Esc}')  # close picker, typed text stays
        except Exception:
            pass
        time.sleep(0.2)
        return True

    selected = '?'
    try:
        selected = (item.Name or '').strip()
    except Exception:
        pass
    ok = _click_list_item(item)
    time.sleep(0.4)
    log.info(f'[at-send] mention "{nickname}" -> selected "{selected}": {"OK" if ok else "FAIL"}')
    return ok


def send_to_with_at(wx, target, message, target_type):
    """Open a chat and send message, composing '@昵称' as real mentions.

    Only meaningful for groups (the picker never appears in contact chats —
    callers should route those to the plain send path)."""
    from wx4py.core.exceptions import TargetNotFoundError
    from wx4py.features.chat import ChatWindow

    chat = wx.chat_window
    try:
        chat._open_chat_with_status(target, target_type)
    except TargetNotFoundError:
        log.error(f'[at-send] chat not found: {target}')
        return False

    edit = chat._get_chat_input()
    if not edit:
        log.error('[at-send] chat input not found')
        return False
    # focus + clear (also removes leftovers from a previously failed attempt)
    edit = ChatWindow.prepare_input_for_paste(edit)
    if not edit:
        return False

    segments = _parse_at_segments(message)
    log.info(f'[at-send] composing {sum(1 for k, _ in segments if k == "at")} mention(s) for "{target}"')
    ok = True
    for kind, value in segments:
        if not value:
            continue
        if kind == 'text':
            # paste at cursor (end); do NOT clear — mentions must survive
            if not chat.paste_text_into_focused_input(value):
                ok = False
                break
        else:
            if not _type_at_mention(wx, edit, value):
                ok = False
                break
        time.sleep(0.15)

    if not ok:
        try:
            edit.SendKeys('{Ctrl}a')
            time.sleep(0.1)
            edit.SendKeys('{Delete}')
        except Exception:
            pass
        return False

    try:
        edit.SendKeys('{Enter}')
    except Exception:
        try:
            edit.SendKeys('{Ctrl}{Enter}')
        except Exception as e:
            log.error(f'[at-send] send failed: {e}')
            return False
    time.sleep(0.3)
    try:
        chat._remember_successful_send(target, message)
    except Exception:
        pass
    log.info(f'[at-send] sent to "{target}" with mentions')
    return True


# ── UIA debug probe (dump tree around the chat input while typing '@') ───
def _ctrl_name(ctrl, attr):
    try:
        v = getattr(ctrl, attr)
        return v() if callable(v) else v
    except Exception:
        return None


def _dump_uia_region(root, region, skip_rect, max_depth=14, max_nodes=600):
    """Depth-first dump of controls intersecting screen-rect `region`.

    WindowControl nodes are always kept (mmui popovers may sit outside the
    region); `skip_rect` excludes the main window itself from a desktop scan.
    """
    nodes = []

    def include(rect, ctrl_type):
        if ctrl_type == 'WindowControl':
            return True
        if rect is None or region is None:
            return True
        l, t, r, b = rect
        return not (r <= region[0] or l >= region[2] or b <= region[1] or t >= region[3])

    def walk(ctrl, depth):
        if depth > max_depth or len(nodes) >= max_nodes:
            return
        ctype = _ctrl_name(ctrl, 'ControlTypeName') or ''
        rect = _ctrl_rect(ctrl)
        if skip_rect and rect and rect == skip_rect:
            return
        if include(rect, ctype):
            nodes.append({
                'd': depth,
                'type': ctype,
                'cls': _ctrl_name(ctrl, 'ClassName'),
                'aid': _ctrl_name(ctrl, 'AutomationId'),
                'name': (_ctrl_name(ctrl, 'Name') or '')[:40],
                'rect': rect,
            })
        try:
            children = ctrl.GetChildren()
        except Exception:
            return
        for ch in children:
            walk(ch, depth + 1)

    walk(root, 0)
    return nodes


def _dump_input_value(edit):
    try:
        return edit.GetValuePattern().Value
    except Exception:
        return None


# ── HTTP handler ──────────────────────────────────────────────────────
class BridgeHandler(BaseHTTPRequestHandler):

    def _send(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _parse_path(self):
        parsed = urlparse(self.path)
        return parsed.path, parse_qs(parsed.query)

    # ── routing ───────────────────────────────────────────────────
    def do_GET(self):
        path, qs = self._parse_path()
        try:
            if path == '/status':
                self._handle_status()
            elif path == '/search':
                self._handle_search(qs)
            elif path == '/groups':
                self._handle_groups()
            elif path == '/contacts':
                self._handle_contacts()
            elif path == '/health':
                self._handle_health()
            elif path == '/deep-health':
                self._handle_deep_health()
            elif path == '/recover':
                self._handle_recover()
            elif path == '/dismiss-update':
                self._handle_dismiss_update()
            elif path == '/dump-uia':
                self._handle_dump_uia()
            elif path == '/wechat-status':
                self._handle_wechat_status()
            elif path == '/wechat-diag':
                self._handle_wechat_diag()
            elif path == '/find-wechat':
                self._handle_find_wechat()
            elif path == '/soft-rebind-uia':
                self._handle_soft_rebind()
            elif path == '/search-dump':
                self._handle_search_dump()
            elif path.startswith('/task/'):
                self._handle_task_status(path)
            else:
                self._send({'error': 'not found'}, 404)
        except Exception as e:
            log.error(f'GET {path}: {e}')
            self._send({'error': str(e)}, 500)

    def do_POST(self):
        path, _ = self._parse_path()
        body = self._read_body()
        try:
            if path == '/send':
                self._handle_send(body)
            elif path == '/batch-send':
                self._handle_batch_send(body)
            elif path == '/wechat-kill':
                self._handle_wechat_kill()
            elif path == '/wechat-launch':
                self._handle_wechat_launch()
            elif path == '/soft-rebind-uia':
                self._handle_soft_rebind()
            elif path == '/debug/at-probe':
                self._handle_debug_at_probe(body)
            else:
                self._send({'error': 'not found'}, 404)
        except Exception as e:
            log.error(f'POST {path}: {e}')
            self._send({'error': str(e)}, 500)

    # ── handlers ──────────────────────────────────────────────────
    def _check_wechat_ui_state(self, hwnd):
        """Real UIA scan: what is WeChat actually showing? Returns (state, detail)."""
        import pythoncom
        pythoncom.CoInitialize()
        import comtypes.client as cc
        import comtypes.gen.UIAutomationClient as UIA
        
        try:
            uia = cc.CreateObject(
                '{ff48dba4-60ef-4201-aa87-54103eef594e}',
                interface=UIA.IUIAutomation,
            )
            elem = uia.ElementFromHandle(hwnd)
            condition = uia.CreateTrueCondition()
            all_e = elem.FindAll(UIA.TreeScope_Subtree, condition)
            
            names = set()
            class_names = set()
            
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = (e.CurrentName or '').strip()
                c = e.CurrentClassName or ''
                if n: names.add(n)
                if c: class_names.add(c)
            
            # Check for known states
            if '我知道了' in names:
                return ('popup', '有"你已退出微信"弹窗，需点击"我知道了"')
            if '登录' in names or '进入微信' in names:
                btn = '登录' if '登录' in names else '进入微信'
                return ('login', f'登录页面，需点击"{btn}"按钮')
            if '搜索' in names or 'mmui::ChatInputField' in class_names:
                return ('ok', '正常 — 主界面已就绪')
            if '确认登录' in names or '正在登录' in names:
                return ('waiting', '等待手机确认登录')
            if '切换账号' in names or '添加账号' in names:
                return ('login', '登录页面（账号选择）')
            
            # Heuristic: low node count on mmui window = login or transition
            total = all_e.Length
            if total < 30:
                # Check what the nodes are
                if any('Login' in c for c in class_names):
                    return ('login', f'登录页面: {total}个节点')
                if any('MainWindow' in c for c in class_names):
                    return ('loading', f'主窗口加载中: {total}个节点 (可能刚登录)')
                return ('unknown', f'未知状态: {total}个节点, 元素: {sorted(names)[:10]}')
            
            return ('unknown', f'无法判断状态: {total}个节点')
        except Exception as e:
            # COM/UIA failed (likely session isolation) — fallback to win32gui only
            import win32gui
            try:
                title = win32gui.GetWindowText(hwnd) or ''
                class_name = win32gui.GetClassName(hwnd) or ''
                visible = win32gui.IsWindowVisible(hwnd)
                if not visible:
                    return ('not_running', '微信窗口不可见（VNC可能断开）')
                if '登录' in title or 'Login' in class_name:
                    return ('login', f'登录页面（win32 fallback）: {title}')
                if 'MainWindow' in class_name:
                    return ('ok', '正常 — 主界面已就绪（win32 fallback）')
                return ('ok', f'窗口存在（win32 fallback）: {title}')
            except:
                return ('fatal', str(e))
    
    def _get_wechat_hwnd(self):
        """Get WeChat window HWND, trying multiple approaches."""
        # Approach 1: use wx4py's find_wechat_window (handles WeChatAppEx.exe)
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            if hwnd:
                return hwnd
        except Exception:
            pass

        # Approach 2: fallback to wx4py client's cached hwnd
        try:
            wx = get_wx()
            if wx.is_connected:
                hwnd = wx._window.hwnd
                if hwnd:
                    return hwnd
                # hwnd is 0 but claims connected — force reconnect
                log.info('[hwnd] wx4py connected but hwnd=0, forcing reconnect...')
                wx.disconnect()
                global _wx
                _wx = None
                wx2 = get_wx()
                return wx2._window.hwnd or 0
        except Exception:
            pass

        return 0
    
    def _handle_status(self):
        try:
            hwnd = self._get_wechat_hwnd()
            if not hwnd:
                self._send({'connected': False, 'error': '微信未运行', 'state': 'not_running'})
                return
            
            state, detail = self._check_wechat_ui_state(hwnd)
            
            if state == 'ok':
                self._send({'connected': True, 'error': None, 'state': state, 'detail': detail, 'hwnd': hwnd})
            else:
                self._send({'connected': False, 'error': detail, 'state': state, 'detail': detail, 'hwnd': hwnd})
        except Exception as e:
            self._send({'connected': False, 'error': str(e), 'state': 'fatal'})
    
    def _handle_health(self):
        """Quick health: is the process alive and window exists?"""
        try:
            wx = get_wx()
            hwnd = self._get_wechat_hwnd()
            self._send({'ok': bool(hwnd), 'hwnd': hwnd, 'connected': wx.is_connected})
        except Exception as e:
            self._send({'ok': False, 'error': str(e)})
    
    def _handle_deep_health(self):
        """Deep health: real UIA scan for accurate WeChat state."""
        try:
            hwnd = self._get_wechat_hwnd()
            if not hwnd:
                self._send({'ok': False, 'reason': '无微信窗口句柄', 'stage': 'hwnd'})
                return
            
            state, detail = self._check_wechat_ui_state(hwnd)
            
            if state == 'ok':
                self._send({'ok': True, 'reason': detail, 'stage': 'ok'})
            elif state == 'loading':
                self._send({'ok': False, 'reason': detail, 'stage': 'loading'})
            elif state == 'waiting':
                self._send({'ok': False, 'reason': detail, 'stage': 'waiting'})
            elif state in ('popup', 'login'):
                self._send({'ok': False, 'reason': detail, 'stage': state})
                # Recovery is handled by the 5-min background loop (no auto-trigger here)
            else:
                self._send({'ok': False, 'reason': detail, 'stage': 'unknown'})
                # Recovery is handled by the 5-min background loop (no auto-trigger here)
        except Exception as e:
            self._send({'ok': False, 'reason': f'健康检查异常: {e}', 'stage': 'fatal'})

    def _handle_recover(self):
        """Manual trigger: run auto-recovery now (bypasses cooldown, respects lock)."""
        try:
            global LAST_RECOVER_ACTION
            LAST_RECOVER_ACTION = 0  # reset cooldown for manual trigger
            threading.Thread(target=try_auto_recover, daemon=True).start()
            self._send({'ok': True, 'message': '恢复已触发'})
        except Exception as e:
            self._send({'ok': False, 'error': str(e)})

    def _handle_dismiss_update(self):
        """Synchronously dismiss only a verified WeChat update prompt."""
        try:
            dismissed = _dismiss_wechat_update_prompt()
            self._send({'ok': dismissed, 'dismissed': dismissed})
        except Exception as e:
            log.warning(f'[recover] Manual update dismiss failed: {e}')
            self._send({'ok': False, 'dismissed': False, 'error': str(e)})

    def _handle_dump_uia(self):
        """Dump all UIA element names for debugging login page."""
        try:
            import pythoncom; pythoncom.CoInitialize()
            import comtypes.client as cc
            import comtypes.gen.UIAutomationClient as UIA

            hwnd = self._get_wechat_hwnd()
            if not hwnd:
                self._send({'error': '无微信窗口'})
                return

            uia_obj = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
            elem = uia_obj.ElementFromHandle(hwnd)
            all_e = elem.FindAll(UIA.TreeScope_Subtree, uia_obj.CreateTrueCondition())

            elements = []
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = (e.CurrentName or '').strip()
                c = e.CurrentClassName or ''
                ct = e.CurrentControlType if hasattr(e, 'CurrentControlType') else 0
                try:
                    br = e.CurrentBoundingRectangle
                    rect = [br.left, br.top, br.right - br.left, br.bottom - br.top]
                except:
                    rect = None
                try:
                    pi = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
                    has_invoke = bool(pi)
                except:
                    has_invoke = False
                if n or c:
                    elements.append({
                        'idx': i, 'name': n, 'class': c,
                        'controlType': ct, 'hasInvoke': has_invoke, 'rect': rect
                    })

            self._send({
                'hwnd': hwnd,
                'total': all_e.Length,
                'elements': elements
            })
        except Exception as e:
            self._send({'error': str(e)})

    def _check_wechat_process(self):
        """Check if WeChat is running. Fast path: WinAPI GetWindowThreadProcessId."""
        import ctypes
        running = False
        pids = []
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            if hwnd:
                pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value:
                    running = True
                    pids.append(pid.value)
        except Exception:
            pass
        return running, pids

    def _handle_wechat_status(self):
        """GET /wechat-status — check if WeChat process is running."""
        try:
            running, pids = self._check_wechat_process()
            self._send({'running': running, 'pidCount': len(pids), 'pids': pids})
        except Exception as e:
            self._send({'error': str(e)})

    def _handle_wechat_diag(self):
        """GET /wechat-diag — diagnostic: try every method to find/kill WeChat."""
        import subprocess, time, os
        result = {'methods': []}
        
        # Method A: tasklist
        try:
            out = subprocess.check_output('tasklist /FO CSV', shell=True, encoding='gbk', errors='ignore')
            wechat_lines = [l for l in out.split('\n') if 'WeChatAppEx' in l]
            result['methods'].append({
                'name': 'tasklist', 'found': len(wechat_lines) > 0,
                'detail': f'{len(wechat_lines)} WeChatAppEx lines' if wechat_lines else 'none found',
            })
        except Exception as e:
            result['methods'].append({'name': 'tasklist', 'found': False, 'error': str(e)})
        
        # Method B: psutil
        try:
            import psutil
            procs = []
            for p in psutil.process_iter(['name', 'pid']):
                if 'wechat' in (p.info['name'] or '').lower():
                    procs.append({'pid': p.pid, 'name': p.info['name']})
            result['methods'].append({
                'name': 'psutil', 'found': len(procs) > 0,
                'detail': f'{len(procs)} processes', 'processes': procs
            })
        except Exception as e:
            result['methods'].append({'name': 'psutil', 'found': False, 'error': str(e)})
        
        # Method C: wx4py window
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            import win32gui
            title = win32gui.GetWindowText(hwnd) if hwnd else ''
            result['methods'].append({
                'name': 'wx4py window', 'found': bool(hwnd),
                'hwnd': hwnd, 'title': title
            })
        except Exception as e:
            result['methods'].append({'name': 'wx4py window', 'found': False, 'error': str(e)})
        
        # Method D: WinAPI GetWindowThreadProcessId
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            if hwnd:
                import ctypes
                pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                proc_info = {'name': 'WinAPI PID', 'found': True, 'hwnd': hwnd, 'pid': pid.value}
                
                # Try psutil by this PID
                try:
                    import psutil
                    proc = psutil.Process(pid.value)
                    proc_info['process_name'] = proc.name()
                    proc_info['children'] = len(proc.children(recursive=True))
                except Exception as e2:
                    proc_info['psutil_error'] = str(e2)
                
                result['methods'].append(proc_info)
            else:
                result['methods'].append({'name': 'WinAPI PID', 'found': False})
        except Exception as e:
            result['methods'].append({'name': 'WinAPI PID', 'error': str(e)})
        
        result['conclusion'] = 'running' if result['methods'][2]['found'] else 'not_found'
        self._send(result)

    def _handle_wechat_kill(self):
        """POST /wechat-kill — kill WeChat via all known methods."""
        import subprocess, time
        try:
            running, pids = self._check_wechat_process()
            if not running:
                self._send({'success': True, 'killed': 0, 'message': '微信进程未运行'})
                return
            
            killed = 0
            
            # Method 1: kill by PID (from window handle) + children
            for pid in pids:
                try:
                    import psutil
                    proc = psutil.Process(pid)
                    for child in proc.children(recursive=True):
                        try:
                            child.kill()
                            killed += 1
                        except Exception:
                            pass
                    proc.kill()
                    killed += 1
                except Exception:
                    pass
            
            # Method 2: kill by known exe names
            for exe in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
                try:
                    subprocess.run(['taskkill', '/F', '/IM', exe],
                                  capture_output=True, encoding='gbk', errors='ignore',
                                  timeout=5)
                except Exception:
                    pass

            # Follow-up: kill any that restarted
            time.sleep(1)
            for exe in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
                try:
                    subprocess.run(['taskkill', '/F', '/IM', exe],
                                  capture_output=True, encoding='gbk', errors='ignore',
                                  timeout=3)
                except Exception:
                    pass

            log.info(f'[wechat-ctrl] Killed WeChat ({killed} by PID + taskkill by name)')
            self._send({'success': True, 'killed': killed, 'message': f'微信进程已关闭（终止 {killed} 个PID + taskkill）'})
        except Exception as e:
            self._send({'success': False, 'error': str(e)})

    def _find_wechat_exe(self):
        """Find WeChat executable path. Try multiple approaches."""
        import os, winreg as wr
        
        # Method 1: ask psutil for running WeChat process path
        try:
            import psutil
            for proc in psutil.process_iter(['name', 'exe']):
                name = (proc.info['name'] or '').lower()
                if name in ('weixin.exe', 'wechatappex.exe', 'wechat.exe'):
                    exe = proc.info['exe']
                    if exe and os.path.exists(exe):
                        return exe
        except Exception:
            pass
        
        # Method 2: Get path from currently running WeChat via WinAPI
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            if hwnd:
                import ctypes
                pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value:
                    try:
                        import psutil
                        exe = psutil.Process(pid.value).exe()
                        if exe and os.path.exists(exe):
                            return exe
                    except Exception:
                        pass
        except Exception:
            pass
        
        # Method 3: Common install paths
        for base in [
            r'C:\Program Files\Tencent\Weixin',
            r'C:\Program Files\Tencent\WeChat',
            r'C:\Program Files (x86)\Tencent\Weixin',
            r'C:\Program Files (x86)\Tencent\WeChat',
            os.path.expandvars(r'%LOCALAPPDATA%\Tencent\WeChat'),
        ]:
            for name in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
                p = os.path.join(base, name)
                if os.path.exists(p):
                    return p
        
        # Method 4: Registry
        for key_path in [
            r'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\WeChat',
            r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\WeChat',
        ]:
            try:
                key = wr.OpenKey(wr.HKEY_LOCAL_MACHINE, key_path)
                for val_name in ['DisplayIcon', 'InstallLocation']:
                    try:
                        val = wr.QueryValueEx(key, val_name)[0]
                        val = val.replace(',0', '').strip('"')
                        if val.endswith('.exe') and os.path.exists(val):
                            return val
                        for name in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
                            p = os.path.join(val, name)
                            if os.path.exists(p):
                                return p
                    except Exception:
                        pass
            except Exception:
                pass
        
        # Method 5: Start Menu shortcut
        import glob
        for pattern in [
            r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\**\WeChat*.lnk',
            os.path.expandvars(r'%APPDATA%\Microsoft\Windows\Start Menu\Programs\**\WeChat*.lnk'),
        ]:
            for lnk in glob.glob(pattern, recursive=True):
                return lnk  # subprocess.Popen can run .lnk files directly
        
        # Method 5: PowerShell Get-StartApps (finds Store apps + non-standard paths)
        import subprocess
        try:
            out = subprocess.check_output(
                'powershell -NoProfile -c "Get-StartApps | Where-Object { $_.Name -like \'*微信*\' -or $_.Name -like \'*WeChat*\' } | ConvertTo-Json"',
                shell=True, encoding='gbk', errors='ignore', timeout=10
            )
            import json
            apps = json.loads(out) if out.strip() else []
            if isinstance(apps, dict):
                apps = [apps]
            for app in apps:
                appid = app.get('AppID', '')
                if appid.endswith('.exe') and os.path.exists(appid):
                    return appid
                # Store app: try shell:AppsFolder launch
                if '{' in appid:
                    # Can't get exe path for Store apps, but can launch via appid
                    return None  # We'll handle Store apps differently
        except Exception:
            pass
        
        return None

    def _handle_wechat_launch(self):
        """POST /wechat-launch — launch WeChat."""
        import subprocess
        try:
            running, _ = self._check_wechat_process()
            if running:
                self._send({'success': True, 'launched': False, 'message': '微信已在运行'})
                return

            # Try to find and launch exe
            exe = self._find_wechat_exe()
            if exe:
                subprocess.Popen([exe], shell=True)
                log.info(f'[wechat-ctrl] Launched WeChat: {exe}')
                self._send({'success': True, 'launched': True, 'path': exe})
                return

            # Fallback: try explorer shell:AppsFolder with dynamic AppID
            import subprocess, json
            try:
                out = subprocess.check_output(
                    'powershell -NoProfile -c "Get-StartApps | Where-Object { \$_.Name -eq \'微信\' } | Select-Object -ExpandProperty AppID"',
                    shell=True, encoding='gbk', errors='ignore', timeout=10
                )
                appid = out.strip()
                if appid:
                    subprocess.Popen(f'explorer shell:AppsFolder\\{appid}', shell=True)
                    log.info(f'[wechat-ctrl] Launched WeChat via shell:AppsFolder ({appid[:50]})')
                    self._send({'success': True, 'launched': True, 'path': f'shell:AppsFolder\\{appid[:50]}'})
                    return
            except Exception:
                pass

            self._send({'success': False, 'error': '找不到微信程序路径'})
        except Exception as e:
            self._send({'success': False, 'error': str(e)})

    def _handle_soft_rebind(self):
        """POST /soft-rebind-uia — rebuild wx4py UIA session without killing WeChat."""
        try:
            result = soft_rebind_uia()
            status = 200 if result.get('ok') else 500
            self._send(result, status)
        except Exception as e:
            log.error(f'soft-rebind handler: {e}')
            self._send({'ok': False, 'error': str(e)}, 500)

    def _handle_search_dump(self):
        """
        GET /search-dump?keyword=xxx — click search box, type keyword, then dump UIA.
        Used to debug what popup/result list structure WeChat actually shows.
        """
        try:
            from urllib.parse import urlparse, parse_qs
            query = urlparse(self.path).query
            params = parse_qs(query)
            keyword = params.get('keyword', ['测试'])[0]

            import pythoncom; pythoncom.CoInitialize()
            import comtypes.client as cc
            import comtypes.gen.UIAutomationClient as UIA
            import time as t

            hwnd = self._get_wechat_hwnd()
            if not hwnd:
                self._send({'error': 'no wechat hwnd'}); return

            uia_obj = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
            root = uia_obj.ElementFromHandle(hwnd)

            def find_by_name(elem, name_substr):
                cond = uia_obj.CreatePropertyCondition(
                    UIA.UIA_NamePropertyId,
                    uia_obj.CreateVariant(name_substr).GetElement()
                ) if False else None
                # Use the simpler approach: iterate all
                all_e = elem.FindAll(UIA.TreeScope_Subtree, uia_obj.CreateTrueCondition())
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = (e.CurrentName or '')
                    if name_substr in n:
                        return e
                return None

            def find_by_class(elem, class_name):
                cond = uia_obj.CreatePropertyCondition(UIA.UIA_ClassNamePropertyId, class_name)
                return elem.FindFirst(UIA.TreeScope_Subtree, cond)

            # Step 1: find search field
            search_field = find_by_class(root, 'mmui::XSearchField')
            if not search_field:
                # try by name
                search_field = find_by_name(root, '搜索')
            if not search_field:
                self._send({'error': 'no search field found'}); return

            # Step 2: click + type
            try:
                ip = search_field.GetCurrentPattern(UIA.UIA_InvokePatternId)
                if ip: ip.Invoke()
            except Exception:
                pass
            t.sleep(0.3)
            try:
                search_field.SetFocus()
            except Exception:
                pass
            t.sleep(0.3)

            # Clear: Ctrl+A then Delete
            try:
                vp = search_field.GetCurrentPattern(UIA.UIA_ValuePatternId)
                if vp:
                    vp.SetValue('')
            except Exception:
                pass
            t.sleep(0.2)

            # Type the keyword
            try:
                vp = search_field.GetCurrentPattern(UIA.UIA_ValuePatternId)
                if vp:
                    vp.SetValue(keyword)
                else:
                    # fallback SendKeys via Win32
                    import win32api, win32con
                    for ch in keyword:
                        win32api.SendMessage(hwnd, win32con.WM_CHAR, ord(ch), 0)
            except Exception as e:
                log.warning(f'search-dump type error: {e}')
            t.sleep(1.5)  # wait for results

            # Step 3: dump full UIA
            all_e = root.FindAll(UIA.TreeScope_Subtree, uia_obj.CreateTrueCondition())
            elements = []
            seen_classes = {}
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = (e.CurrentName or '').strip()
                c = e.CurrentClassName or ''
                ct = e.CurrentControlType if hasattr(e, 'CurrentControlType') else 0
                try:
                    br = e.CurrentBoundingRectangle
                    rect = [br.left, br.top, br.right - br.left, br.bottom - br.top]
                except:
                    rect = None
                try:
                    pi = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
                    has_invoke = bool(pi)
                except:
                    has_invoke = False
                if n or c:
                    elements.append({
                        'idx': i, 'name': n, 'class': c,
                        'controlType': ct, 'hasInvoke': has_invoke, 'rect': rect
                    })
                    seen_classes[c] = seen_classes.get(c, 0) + 1

            self._send({
                'hwnd': hwnd,
                'keyword': keyword,
                'total': len(elements),
                'seen_classes': seen_classes,
                'elements': elements
            })
        except Exception as e:
            import traceback
            self._send({'error': str(e), 'trace': traceback.format_exc()}, 500)

    def _handle_find_wechat(self):
        """GET /find-wechat — debug: report all path search attempts."""
        import os, winreg, glob, subprocess
        result = {'steps': []}

        # Step 1: psutil (running process)
        try:
            import psutil
            procs = [(p.pid, p.name(), p.exe()) for p in psutil.process_iter(['name','exe'])
                     if (p.info['name'] or '').lower() in ('weixin.exe','wechatappex.exe','wechat.exe')]
            result['steps'].append({'step': 'psutil', 'found': len(procs), 'procs': procs})
        except Exception as e:
            result['steps'].append({'step': 'psutil', 'error': str(e)})

        # Step 2: WinAPI window PID exe
        try:
            from wx4py.core.win32 import find_wechat_window
            hwnd = find_wechat_window()
            if hwnd:
                import ctypes
                pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                try:
                    import psutil
                    exe = psutil.Process(pid.value).exe()
                    result['steps'].append({'step': 'WinAPI', 'hwnd': hwnd, 'pid': pid.value, 'exe': exe})
                except Exception as e2:
                    result['steps'].append({'step': 'WinAPI', 'hwnd': hwnd, 'pid': pid.value, 'error': str(e2)})
            else:
                result['steps'].append({'step': 'WinAPI', 'found': False, 'reason': 'no hwnd'})
        except Exception as e:
            result['steps'].append({'step': 'WinAPI', 'error': str(e)})

        # Step 3: Common paths
        found_paths = []
        for base in [
            r'C:\Program Files\Tencent\WeChat',
            r'C:\Program Files (x86)\Tencent\WeChat',
            os.path.expandvars(r'%LOCALAPPDATA%\Tencent\WeChat'),
        ]:
            for name in ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe']:
                p = os.path.join(base, name)
                if os.path.exists(p):
                    found_paths.append(p)
        result['steps'].append({'step': 'common_paths', 'found': found_paths})

        # Step 4: where command
        wheres = {}
        for exe in ['Weixin', 'WeChat', 'WeChatAppEx']:
            try:
                out = subprocess.check_output(f'where {exe}', shell=True, encoding='gbk', errors='ignore')
                wheres[exe] = out.strip()
            except:
                wheres[exe] = 'not found'
        result['steps'].append({'step': 'where', 'results': wheres})

        self._send(result)

    def _handle_task_status(self, path):
        """GET /task/<id> — poll async task result."""
        tid = path.split('/')[-1]
        with _tasks_lock:
            task = _tasks.get(tid)
        if task is None:
            self._send({'error': 'task not found'}, 404)
        else:
            self._send({'task_id': tid, **task})

    def _handle_search(self, qs):
        q = qs.get('q', [''])[0]
        target_type = qs.get('type', ['all'])[0]  # 'group', 'contact', or 'all'
        if not q:
            self._send({'results': []})
            return

        wx = get_wx()
        raw = wx.chat_window.search(q)

        # raw is dict: {category_name: [SearchResult, ...]}
        # SearchResult has .name and .type (uiautomation objects or strings)
        results = []
        for category, items in raw.items():
            for item in items:
                try:
                    name = str(item.name) if hasattr(item, 'name') else str(item)
                    itype = str(item.type) if hasattr(item, 'type') else 'unknown'
                except Exception:
                    name = str(item)
                    itype = 'unknown'

                # Filter by requested type (best-effort: group items usually come
                # under a "群聊" category and contacts under "联系人")
                if target_type == 'group' and '群' not in category:
                    continue
                if target_type == 'contact' and '联系人' not in category:
                    continue

                results.append({
                    'id': name,
                    'name': name,
                    'type': 'group' if '群' in category else 'contact',
                    'category': category
                })

        self._send({'results': results})

    def _handle_groups(self):
        """Get all groups by scanning chat list with common chars."""
        wx = get_wx()
        # wx4py doesn't have a direct "list all groups" API.
        # Search with letters + digits + common Chinese chars as a heuristic scan.
        scan_chars = ['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
                      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                      '技', '项', '工', '学', '交', '通', '活', '开', '产', '设',
                      '运', '管', '市', '创', '投', '教', '健', '娱', '生', '美',
                      '游', '音', '读', '摄', '宠', '汽', '房', '财', '电', '直',
                      '医', '法', '金', '设', '家', '车', '食', '旅', '运', '研']
        seen = set()
        groups = []
        for ch in scan_chars:
            try:
                raw = wx.chat_window.search(ch)
                for category, items in raw.items():
                    for item in items:
                        try:
                            name = str(item.name) if hasattr(item, 'name') else str(item)
                        except Exception:
                            continue
                        if name in seen:
                            continue
                        seen.add(name)
                        if '群' in category:
                            groups.append({
                                'id': name,
                                'topic': name,
                                'memberCount': 0  # wx4py can't get count without opening group
                            })
            except Exception:
                continue

        self._send(groups)

    def _handle_contacts(self):
        """Get all contacts by scanning chat list."""
        wx = get_wx()
        scan_chars = ['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
                      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                      '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
                      '徐', '孙', '马', '胡', '朱', '郭', '何', '罗', '高', '林']
        seen = set()
        contacts = []
        for ch in scan_chars:
            try:
                raw = wx.chat_window.search(ch)
                for category, items in raw.items():
                    for item in items:
                        try:
                            name = str(item.name) if hasattr(item, 'name') else str(item)
                        except Exception:
                            continue
                        if name in seen:
                            continue
                        seen.add(name)
                        if '联系人' in category:
                            contacts.append({
                                'id': name,
                                'name': name,
                                'type': 'individual'
                            })
            except Exception:
                continue

        self._send(contacts)

    def _handle_debug_at_probe(self, body):
        """Debug: open a chat, type '@' (+optional filter), dump nearby UIA tree.

        Body: {target, target_type?, mention?}. Nothing is ever sent — the
        picker is dismissed with Esc and the input cleared afterwards.
        Runs synchronously by polling the serial task queue (UIA not thread-safe).
        """
        target = body.get('target', '')
        target_type = body.get('target_type', 'group')
        mention = body.get('mention', '')
        if not target:
            self._send({'success': False, 'error': 'target required'}, 400)
            return

        def _do():
            from wx4py.features.chat import ChatWindow
            wx = get_wx()
            chat = wx.chat_window
            try:
                chat._open_chat_with_status(target, target_type)
            except Exception as e:
                return {'ok': False, 'error': f'open_chat: {e}'}
            edit = chat._get_chat_input()
            if not edit:
                return {'ok': False, 'error': 'no chat input'}
            edit = ChatWindow.prepare_input_for_paste(edit)
            if not edit:
                return {'ok': False, 'error': 'prepare input failed'}

            er = _ctrl_rect(edit)
            if not er:
                return {'ok': False, 'error': 'no input rect'}
            region = (er[0] - 80, er[1] - 600, er[2] + 80, er[3] + 260)
            root_rect = _ctrl_rect(chat.root)

            out = {
                'ok': True,
                'target': target,
                'region': region,
                'input_value_before': _dump_input_value(edit),
            }
            try:
                edit.SendKeys('@')
                time.sleep(1.2)
            except Exception as e:
                out['sendkeys_error'] = str(e)
                return out
            out['input_value_at'] = _dump_input_value(edit)
            out['after_at'] = _dump_uia_region(chat.root, region, None)

            # top-level windows of other popups (owned windows are desktop
            # siblings of the main window, not descendants of it)
            try:
                desktop = chat.root.GetParentControl()
                out['desktop_windows'] = _dump_uia_region(desktop, region, skip_rect=root_rect, max_depth=6)
            except Exception as e:
                out['desktop_windows_error'] = str(e)

            if mention:
                try:
                    _sendkeys_literal(edit, mention)
                    time.sleep(1.2)
                    out['input_value_filtered'] = _dump_input_value(edit)
                    out['filtered'] = _dump_uia_region(chat.root, region, None)
                    # how would the current finder judge this state?
                    lst, item = _find_at_member_popup(wx, edit, mention, timeout=2.0)
                    out['finder_verdict'] = {
                        'found': lst is not None,
                        'matched': item is not None,
                        'selected_name': (item.Name or '').strip() if item is not None else None,
                        'container_class': (lst.ClassName if lst is not None else None),
                    }
                except Exception as e:
                    out['filter_error'] = str(e)

            try:
                edit.SendKeys('{Esc}')
                time.sleep(0.2)
                edit.SendKeys('{Ctrl}a')
                time.sleep(0.1)
                edit.SendKeys('{Delete}')
            except Exception as e:
                out['cleanup_error'] = str(e)
            return out

        tid = _start_task(_do)
        log.info(f'[at-probe] queued for "{target}" task={tid}')
        deadline = time.time() + 90
        while time.time() < deadline:
            with _tasks_lock:
                task = _tasks.get(tid)
            if task['status'] == 'success':
                self._send(task['result'] or {'ok': True})
                return
            if task['status'] == 'failed':
                self._send({'ok': False, 'error': task['error']}, 500)
                return
            time.sleep(0.5)
        self._send({'ok': False, 'error': 'probe timeout'}, 504)

    def _handle_send(self, body):
        target = body.get('target', '')
        message = body.get('message', '')
        target_type = body.get('target_type', body.get('targetType', 'contact'))

        if not target or not message:
            self._send({'success': False, 'error': 'target and message required'}, 400)
            return

        # Ensure WeChat window is visible + wx4py connection is healthy
        def _do_send():
            import win32gui, win32con, time as t
            wx = get_wx()
            # Pre-check: reconnect wx4py if stale
            if not wx.is_connected:
                log.info(f'[send] wx4py not connected, attempting reconnect...')
                try: wx.disconnect()
                except: pass
                global _wx; _wx = None
                wx = get_wx()
                if not wx.is_connected:
                    log.error('[send] wx4py still not connected after reconnect')
                    return False
            # Restore the live window before validating the cached UIA session.
            # A manual re-login can replace the main HWND while wx4py continues
            # to report is_connected=True for the old, dead window.
            live_hwnd = 0
            try:
                from wx4py.core.win32 import find_wechat_window
                live_hwnd = find_wechat_window() or 0
                if live_hwnd:
                    is_iconic = win32gui.IsIconic(live_hwnd)
                    is_visible = win32gui.IsWindowVisible(live_hwnd)
                    if is_iconic:
                        log.info(f'[send] restoring minimized window for {target}...')
                        win32gui.ShowWindow(live_hwnd, win32con.SW_RESTORE)
                        t.sleep(0.5)
                    elif not is_visible:
                        log.info(f'[send] showing hidden window for {target}...')
                        win32gui.ShowWindow(live_hwnd, win32con.SW_SHOW)
                        t.sleep(0.5)
                    win32gui.SetForegroundWindow(live_hwnd)
                    t.sleep(0.3)
            except Exception as e:
                log.debug(f'[send] window restore error: {e}')

            # Rebind only when the live window is demonstrably the logged-in
            # main UI.  Never let a scheduled send click a login/security page.
            cached_hwnd = 0
            try:
                if hasattr(wx, '_window'):
                    cached_hwnd = getattr(wx._window, 'hwnd', 0) or 0
            except Exception:
                pass
            if live_hwnd and cached_hwnd and live_hwnd != cached_hwnd:
                if not _is_main_window(live_hwnd):
                    log.error(
                        f'[send] stale UIA session but live HWND is not a verified main window; '
                        f'refusing rebind: cached={cached_hwnd}, live={live_hwnd}'
                    )
                    return False
                log.info(f'[send] stale UIA session detected; safe-rebinding cached={cached_hwnd}, live={live_hwnd}')
                rebind = soft_rebind_uia()
                if not rebind.get('ok'):
                    log.error(f'[send] safe-rebind failed: {rebind.get("error") or "not connected"}')
                    return False
                wx = get_wx()

            # Group messages containing "@昵称" compose real mentions through
            # the member picker; everything else goes the plain-text route.
            use_at = target_type == 'group' and '@' in message

            def _dispatch(client):
                if use_at:
                    return send_to_with_at(client, target, message, target_type)
                return client.chat_window.send_to(target, message, target_type=target_type)

            ok = _dispatch(wx)
            log.info(f'[send] to [{target_type}] {target}{" (at)" if use_at else ""}: {"OK" if ok else "FAIL"}')
            # Retry once if first attempt failed (window may need to settle)
            if not ok:
                log.info(f'[send] retrying [{target_type}] {target} in 2s...')
                t.sleep(2)
                wx = get_wx()
                ok2 = _dispatch(wx)
                log.info(f'[send] retry to [{target_type}] {target}: {"OK" if ok2 else "FAIL"}')
                ok = ok2
            return ok

        tid = _start_task(_do_send)
        log.info(f'[send] queued [{target_type}] {target}: {message[:20]}... task={tid}')
        self._send({'success': True, 'queued': True, 'task_id': tid})

    def _handle_batch_send(self, body):
        targets = body.get('targets', [])
        message = body.get('message', '')
        target_type = body.get('target_type', body.get('targetType', 'contact'))

        if not targets or not message:
            self._send({'success': False, 'error': 'targets and message required'}, 400)
            return

        wx = get_wx()
        log.info(f'Batch send to {len(targets)} {target_type}s')
        result = wx.chat_window.batch_send(targets, message, target_type=target_type)
        self._send({'success': True, 'results': result})

    def log_message(self, format, *args):
        """Suppress default http.server access logs (use our logger instead)."""
        pass


def _graceful_shutdown():
    """Release resources without killing WeChat. Just null the wx4py reference."""
    global _wx, _worker_running
    _worker_running = False
    with _queue_cond:
        _queue_cond.notify_all()
    # NEVER call _wx.disconnect() — wx4py's COM cleanup crashes WeChat.
    # Just drop the reference; new bridge instance will create fresh client.
    _wx = None

def main():
    import atexit
    atexit.register(_graceful_shutdown)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 39800
    # Start send worker thread (serial queue — wx4py is NOT thread-safe)
    worker_thread = threading.Thread(target=_task_worker, daemon=True)
    worker_thread.start()
    # Start auto-recovery background thread
    recover_thread = threading.Thread(target=_auto_recover_loop, daemon=True)
    recover_thread.start()
    server = HTTPServer(('127.0.0.1', port), BridgeHandler)
    server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    log.info(f'Bridge listening on 127.0.0.1:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info('Shutting down...')
        _graceful_shutdown()
    finally:
        _graceful_shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
