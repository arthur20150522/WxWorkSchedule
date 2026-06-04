"""
wx4py bridge — lightweight HTTP wrapper for WeChat Windows automation.
Runs on 127.0.0.1:39800 so the Node.js backend can call it locally.
Auto-recovers from 6am kick-off: detects login page, clicks "进入微信".
"""
import sys
import json
import logging
import socket
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='[bridge] %(message)s')
log = logging.getLogger(__name__)

# ── wx4py client (lazy init) ──────────────────────────────────────────
_wx = None

# ── Async task system ─────────────────────────────────────────────────
_tasks = {}
_tasks_lock = threading.Lock()
_task_counter = [0]

def _start_task(fn, *args, **kwargs):
    """Run fn in background, track by task_id."""
    with _tasks_lock:
        _task_counter[0] += 1
        tid = str(_task_counter[0])
        _tasks[tid] = {'status': 'pending', 'result': None, 'error': None}
    def _runner():
        try:
            result = fn(*args, **kwargs)
            with _tasks_lock:
                _tasks[tid] = {'status': 'success', 'result': result, 'error': None}
        except Exception as e:
            with _tasks_lock:
                _tasks[tid] = {'status': 'failed', 'result': None, 'error': str(e)}
    threading.Thread(target=_runner, daemon=True).start()
    return tid

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

def _is_main_window(hwnd):
    """Check if hwnd is WeChat main window (> 30 UIA elements, login page has < 25)."""
    try:
        import pythoncom; pythoncom.CoInitialize()
        import comtypes.client as cc
        import comtypes.gen.UIAutomationClient as UIA
        uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
        elem = uia.ElementFromHandle(hwnd)
        count = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition()).Length
        return count > 30
    except Exception:
        return False


# ── Auto-recovery: detect login page and click "进入微信" ─────────────
AUTO_RECOVER_ENABLED = True
AUTO_RECOVER_INTERVAL = 300  # check every 5min (don't hammer the window)

def try_auto_recover():
    """Auto-recovery: reconnect wx4py if needed, then handle login page."""
    global _wx
    try:
        import ctypes, win32gui, win32con, time

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
        except Exception:
            pass

        # ── Step 1: quick skip if wx4py already healthy ──
        try:
            wx = get_wx()
            if wx.is_connected:
                hwnd_quick = wx._window.hwnd if hasattr(wx, '_window') else 0
                if hwnd_quick and _is_main_window(hwnd_quick):
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
                """Try InvokePattern first. If unresponsive after 3s, fall back to coordinate click."""
                import ctypes
                # Step A: try InvokePattern
                try:
                    pattern_obj = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
                    if pattern_obj:
                        invoke = pattern_obj.QueryInterface(UIA.IUIAutomationInvokePattern)
                        invoke.Invoke()
                        log.info(f'[recover] InvokePattern clicked "{label}"')
                        # Quick check: did the click have any effect?
                        time.sleep(3)
                        try:
                            hwnd2 = find_wechat_window()
                            if hwnd2 and _is_main_window(hwnd2):
                                log.info(f'[recover] InvokePattern worked — main window detected')
                                return True
                        except Exception:
                            pass
                        log.info(f'[recover] InvokePattern had no visible effect, trying coordinate click...')
                except Exception:
                    pass
                
                # Step B: fallback — coordinate click + Enter key combo
                br = e.CurrentBoundingRectangle
                cx = (br.left+br.right)//2; cy = (br.top+br.bottom)//2
                log.info(f'[recover] Coordinate click "{label}" at ({cx},{cy})')
                click_at(cx, cy)
                time.sleep(1)
                # Also send Enter as backup
                ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, 0, 0)
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, win32con.KEYEVENTF_KEYUP, 0)
                return True

            # Check for popup with "我知道了"
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = e.CurrentName or ''; c = e.CurrentClassName or ''
                if n == '我知道了' and ('Button' in c or 'mmui' in c):
                    _uia_click(e, '我知道了')
                    time.sleep(2)
                    # Re-scan after dismissing popup (window layout changes)
                    hwnd = find_wechat_window() or hwnd
                    elem = uia.ElementFromHandle(hwnd)
                    all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
                    break

            # Check for "进入微信" / "登录" button
            # Prefer XTextView (inner text) over XOutlineButton (outer frame)
            found = False
            for pref_class in ('mmui::XTextView', 'mmui::XOutlineButton', 'mmui::XButton'):
                if found: break
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = e.CurrentName or ''
                    c = e.CurrentClassName or ''
                    if n in ('登录', '进入微信') and pref_class in c:
                        _uia_click(e, n)
                        clicked_login = True
                        found = True
                        break
            # Fallback: any element with matching name
            if not found:
                for i in range(all_e.Length):
                    e = all_e.GetElement(i)
                    n = e.CurrentName or ''
                    if n in ('登录', '进入微信'):
                        _uia_click(e, n)
                        clicked_login = True
                        break

        except Exception as e:
            log.warning(f'[recover] UIA scan failed: {e}')

        # ── Step 5: wait for main window after login click (up to 25s) ──
        if clicked_login:
            log.info('[recover] Waiting for WeChat main window after login click...')
            for i in range(50):  # 50 × 0.5s = 25s
                time.sleep(0.5)
                try:
                    hwnd = find_wechat_window()
                    if hwnd and _is_main_window(hwnd):
                        log.info(f'[recover] Main window appeared: HWND={hwnd}')
                        # Reconnect wx4py client to new main window
                        if _wx is not None:
                            try:
                                _wx.disconnect()
                            except Exception:
                                pass
                        _wx = None
                        # Trigger fresh connection immediately
                        try:
                            wx_new = get_wx()
                            log.info(f'[recover] Reconnected: {wx_new.is_connected}')
                        except Exception as e:
                            log.warning(f'[recover] Reconnect failed: {e}, will retry on next request')
                            return
                except Exception:
                    pass
                if i % 10 == 0:
                    log.debug(f'[recover] Still waiting for main window ({i * 0.5:.0f}s)...')
            log.warning('[recover] Timed out waiting for main window')

        # ── Step 6: Win32 keyboard fallback (PostMessage — works without foreground) ──
        if not clicked_login:
            log.info('[recover] UIA didn\'t click login, trying Win32 fallback...')
            # PostMessage sends keystrokes directly to the window, no foreground needed
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            time.sleep(0.3)
            # Send Enter via PostMessage (session-independent)
            ctypes.windll.user32.PostMessageW(hwnd, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
            time.sleep(0.1)
            ctypes.windll.user32.PostMessageW(hwnd, win32con.WM_KEYUP, win32con.VK_RETURN, 0)
            time.sleep(2)
            # Second Enter (in case first dismissed a popup)
            ctypes.windll.user32.PostMessageW(hwnd, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
            time.sleep(0.1)
            ctypes.windll.user32.PostMessageW(hwnd, win32con.WM_KEYUP, win32con.VK_RETURN, 0)
            log.info('[recover] Win32 PostMessage Enter × 2 sent')

    except Exception as e:
        log.error(f'[recover] Error: {e}')


def _auto_recover_loop():
    """Background thread: periodically check and recover."""
    log.info(f'[recover] Auto-recovery enabled, checking every {AUTO_RECOVER_INTERVAL}s')
    while AUTO_RECOVER_ENABLED:
        time.sleep(AUTO_RECOVER_INTERVAL)
        try:
            try_auto_recover()
        except Exception as e:
            log.error(f'[recover] Loop error: {e}')


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
            elif path == '/dump-uia':
                self._handle_dump_uia()
            elif path == '/wechat-status':
                self._handle_wechat_status()
            elif path == '/wechat-diag':
                self._handle_wechat_diag()
            elif path == '/find-wechat':
                self._handle_find_wechat()
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
                # Auto-trigger recovery for popup/login
                threading.Thread(target=try_auto_recover, daemon=True).start()
                log.info(f'[recover] Auto-triggered for {state}: {detail}')
            else:
                self._send({'ok': False, 'reason': detail, 'stage': 'unknown'})
                # Still try recovery for unknown states
                threading.Thread(target=try_auto_recover, daemon=True).start()
                log.info(f'[recover] Auto-triggered for unknown: {detail}')
        except Exception as e:
            self._send({'ok': False, 'reason': f'健康检查异常: {e}', 'stage': 'fatal'})

    def _handle_recover(self):
        """Manual trigger: run auto-recovery now."""
        try:
            threading.Thread(target=try_auto_recover, daemon=True).start()
            self._send({'ok': True, 'message': '恢复已触发'})
        except Exception as e:
            self._send({'ok': False, 'error': str(e)})

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

    def _handle_send(self, body):
        target = body.get('target', '')
        message = body.get('message', '')
        target_type = body.get('target_type', body.get('targetType', 'contact'))

        if not target or not message:
            self._send({'success': False, 'error': 'target and message required'}, 400)
            return

        # Ensure WeChat window is visible (tray -> restore) before send
        def _do_send():
            import win32gui, win32con, time as t
            try:
                hwnd = self._get_wechat_hwnd()
                if hwnd and not win32gui.IsWindowVisible(hwnd):
                    log.info(f'[send] restoring window for {target}...')
                    win32gui.ShowWindow(hwnd, win32con.SW_SHOWNOACTIVATE)
                    t.sleep(1)
            except Exception as e:
                log.debug(f'[send] window restore error: {e}')
            wx = get_wx()
            ok = wx.chat_window.send_to(target, message, target_type=target_type)
            log.info(f'[send] to [{target_type}] {target}: {"OK" if ok else "FAIL"}')
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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 39800
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
        server.server_close()


if __name__ == '__main__':
    main()
