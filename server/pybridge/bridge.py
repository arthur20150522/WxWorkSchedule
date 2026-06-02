"""
wx4py bridge — lightweight HTTP wrapper for WeChat Windows automation.
Runs on 127.0.0.1:39800 so the Node.js backend can call it locally.
Auto-recovers from 6am kick-off: detects login page, clicks "进入微信".
"""
import sys
import json
import logging
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='[bridge] %(message)s')
log = logging.getLogger(__name__)

# ── wx4py client (lazy init) ──────────────────────────────────────────
_wx = None

def get_wx():
    global _wx
    if _wx is None or not _wx.is_connected:
        from wx4py import WeChatClient
        log.info('Connecting to WeChat window...')
        _wx = WeChatClient(auto_connect=True)
        log.info(f'Connected: {_wx.is_connected}')
    return _wx


# ── Auto-recovery: detect login page and click "进入微信" ─────────────
AUTO_RECOVER_ENABLED = True
AUTO_RECOVER_INTERVAL = 300  # 5 minutes

def try_auto_recover():
    """Pure Win32 recovery: dismiss popups then click login — no COM/UIA needed, works cross-session."""
    try:
        import ctypes, win32gui, win32con, time
        
        def click_at(cx, cy):
            ctypes.windll.user32.SetCursorPos(cx, cy)
            time.sleep(0.05)
            ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(0.03)
            ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(0.15)
        
        # ── Find WeChat HWND via win32gui (works cross-session) ──
        hwnd = 0
        def find_wechat(h, _):
            nonlocal hwnd
            c = win32gui.GetClassName(h)
            if 'mmui' in c and win32gui.IsWindowVisible(h):
                hwnd = h; return False
            return True
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        ctypes.windll.user32.EnumWindows(CB(find_wechat), 0)
        
        if not hwnd:
            log.debug('[recover] No visible WeChat window')
            return
        
        title = win32gui.GetWindowText(hwnd) or ''
        class_name = win32gui.GetClassName(hwnd) or ''
        log.info(f'[recover] WeChat: HWND={hwnd} title={title} class={class_name}')
        
        # ── Strategy: use UIA first (if available), then pure Win32 fallback ──
        try_clicked = False
        
        # Try UIA FindAll first (requires same session)
        try:
            import pythoncom; pythoncom.CoInitialize()
            import comtypes.client as cc
            import comtypes.gen.UIAutomationClient as UIA
            uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
            elem = uia.ElementFromHandle(hwnd)
            all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())
            
            # Step A: dismiss "我知道了" popup
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = e.CurrentName or ''; c = e.CurrentClassName or ''
                if n == '我知道了' and ('Button' in c or 'mmui' in c):
                    br = e.CurrentBoundingRectangle
                    cx = (br.left+br.right)//2; cy = (br.top+br.bottom)//2
                    log.info(f'[recover] UIA: click "我知道了" at ({cx},{cy})')
                    click_at(cx, cy); time.sleep(1)
                    break
            
            # Step B: click "进入微信" / "登录"
            for i in range(all_e.Length):
                e = all_e.GetElement(i)
                n = e.CurrentName or ''
                if n in ('登录', '进入微信'):
                    br = e.CurrentBoundingRectangle
                    cx = (br.left+br.right)//2; cy = (br.top+br.bottom)//2
                    log.info(f'[recover] UIA: click "{n}" at ({cx},{cy})')
                    click_at(cx, cy)
                    try_clicked = True
                    break
        except Exception as e:
            log.debug(f'[recover] UIA failed (expected if session mismatch): {e}')
        
        # ── Pure Win32 fallback: Tab + Enter ──
        if not try_clicked and ('登录' in title or 'Login' in class_name or 'MainWindow' not in class_name):
            log.info('[recover] Using Win32 Tab+Enter fallback...')
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            time.sleep(0.5)
            # Try clicking center first (often the login button is there)
            rect = win32gui.GetWindowRect(hwnd)
            cx = (rect[0]+rect[2])//2; cy = (rect[1]+rect[3])//2
            click_at(cx, cy + 50)  # slightly below center
            time.sleep(0.5)
            # Tab to navigate + Enter
            for _ in range(8):
                ctypes.windll.user32.keybd_event(0x09, 0, 0, 0); time.sleep(0.15)
                ctypes.windll.user32.keybd_event(0x09, 0, win32con.KEYEVENTF_KEYUP, 0); time.sleep(0.1)
            ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, 0, 0); time.sleep(0.1)
            ctypes.windll.user32.keybd_event(win32con.VK_RETURN, 0, win32con.KEYEVENTF_KEYUP, 0)
            log.info('[recover] Tab+Enter sent')
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
        """Get WeChat window HWND. Use win32gui first (works across sessions), then uiautomation."""
        # Strategy 1: win32gui EnumWindows (works even in session 0)
        import win32gui, ctypes
        result = [0]
        def cb(h, _):
            c = win32gui.GetClassName(h)
            if 'mmui' in c and win32gui.IsWindowVisible(h):
                result[0] = h; return False
            return True
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        ctypes.windll.user32.EnumWindows(CB(cb), 0)
        if result[0]:
            return result[0]
        # Strategy 2: wx4py uiautomation (only works in console session)
        try:
            wx = get_wx()
            if wx.is_connected:
                return wx._window.hwnd
        except:
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
            
            from wx4py.core.win32 import is_window_visible
            if not is_window_visible(hwnd):
                self._send({'ok': False, 'reason': '微信窗口不可见', 'stage': 'visible'})
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
        target_type = body.get('targetType', 'contact')  # 'group' or 'contact'

        if not target or not message:
            self._send({'success': False, 'error': 'target and message required'}, 400)
            return

        wx = get_wx()
        log.info(f'Send to [{target_type}] {target}: {message[:50]}...')

        # Ensure window is visible before sending
        try:
            if hasattr(wx, '_window') and wx._window:
                hwnd = wx._window.hwnd
                if hwnd:
                    from wx4py.core.win32 import is_window_visible
                    import win32gui, win32con
                    visible = is_window_visible(hwnd)
                    log.info(f'[window] before send: visible={visible}')
                    if not visible:
                        log.info('[window] force-restoring window...')
                        # Pull out of tray with SW_SHOW
                        win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
                        win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW)
                        win32gui.SetForegroundWindow(hwnd)
                        win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                            win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                        log.info(f'[window] force-restore result: visible={is_window_visible(hwnd)}')
        except Exception as e:
            log.warning(f'[window] pre-send window check failed: {e}')

        ok = wx.chat_window.send_to(target, message, target_type=target_type)

        # Log window state after
        try:
            if hasattr(wx, '_window') and wx._window:
                hwnd = wx._window.hwnd
                if hwnd:
                    log.info(f'[window] after send: visible={is_window_visible(hwnd)}')
        except:
            pass

        self._send({'success': ok})

    def _handle_batch_send(self, body):
        targets = body.get('targets', [])
        message = body.get('message', '')
        target_type = body.get('targetType', 'group')

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
    log.info(f'Bridge listening on 127.0.0.1:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info('Shutting down...')
        server.server_close()


if __name__ == '__main__':
    main()
