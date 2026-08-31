"""Force show all mmui windows (fixes VNC disconnect hiding)."""
import win32gui, ctypes

def cb(h, _):
    c = win32gui.GetClassName(h)
    if 'mmui' in c or 'Qt5' in c:
        t = win32gui.GetWindowText(h)[:30]
        was_vis = win32gui.IsWindowVisible(h)
        ctypes.windll.user32.ShowWindow(h, 9)  # SW_RESTORE
        ctypes.windll.user32.SetForegroundWindow(h)
        print(f"HWND={h} class={c[:30]} title={t} was_visible={was_vis}")
    return True

CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
ctypes.windll.user32.EnumWindows(CB(cb), 0)
print("done")
