"""
wx4py bridge — lightweight HTTP wrapper for WeChat Windows automation.
Runs on 127.0.0.1:39800 so the Node.js backend can call it locally.
Designed for minimal resource usage (2C2G server).
"""
import sys
import json
import logging
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
    def _handle_status(self):
        try:
            wx = get_wx()
            connected = wx.is_connected
            if not connected:
                # Double-check: maybe UIA is fine but is_connected flag is stale
                try:
                    hwnd = wx._window.hwnd if hasattr(wx, '_window') and wx._window else None
                    if hwnd:
                        from wx4py.core.win32 import is_window_visible
                        if is_window_visible(hwnd):
                            connected = True
                except:
                    pass
            self._send({'connected': connected, 'error': None})
        except Exception as e:
            self._send({'connected': False, 'error': str(e)})

    def _handle_health(self):
        """Quick health: is the process alive and window exists?"""
        try:
            wx = get_wx()
            hwnd = wx._window.hwnd if hasattr(wx, '_window') and wx._window else None
            self._send({'ok': True, 'hwnd': hwnd, 'connected': wx.is_connected})
        except Exception as e:
            self._send({'ok': False, 'error': str(e)})

    def _handle_deep_health(self):
        """Deep health: can we actually interact with WeChat UI?"""
        try:
            wx = get_wx()
            # Check 1: window exists and is visible
            hwnd = wx._window.hwnd if hasattr(wx, '_window') and wx._window else None
            if not hwnd:
                self._send({'ok': False, 'reason': '无微信窗口句柄', 'stage': 'hwnd'})
                return

            from wx4py.core.win32 import is_window_visible
            if not is_window_visible(hwnd):
                self._send({'ok': False, 'reason': '微信窗口不可见(可能在托盘或锁屏)', 'stage': 'visible'})
                return

            # Check 2: try to find a basic UI element (chat list or search box)
            try:
                # Try to find the chat list — if login page, this fails
                window = wx._window
                chat_list = window.find_first('ListControl', depth=3)
                if chat_list:
                    self._send({'ok': True, 'reason': '正常', 'stage': 'chat_list'})
                    return

                # Fallback: check if there's a search box
                search_box = window.find_first('EditControl', depth=3)
                if search_box:
                    self._send({'ok': True, 'reason': '正常(搜索框)', 'stage': 'search_box'})
                    return

                # Neither found — likely login screen or frozen
                # Try to identify login screen
                qr = window.find_first('TextControl', 3)
                if qr and ('登录' in (qr.Name or '') or '二维码' in (qr.Name or '')):
                    self._send({'ok': False, 'reason': '微信登录页-需重新扫码', 'stage': 'login_page'})
                    return

                self._send({'ok': False, 'reason': '无法定位聊天列表或搜索框', 'stage': 'no_ui'})
            except Exception as e:
                self._send({'ok': False, 'reason': f'UIA查询异常: {e}', 'stage': 'uia_error'})
        except Exception as e:
            self._send({'ok': False, 'reason': f'健康检查异常: {e}', 'stage': 'fatal'})

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
    server = HTTPServer(('127.0.0.1', port), BridgeHandler)
    log.info(f'Bridge listening on 127.0.0.1:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info('Shutting down...')
        server.server_close()


if __name__ == '__main__':
    main()
