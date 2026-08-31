"""Check remote WeChat window state via win32gui + UIA."""
import pythoncom; pythoncom.CoInitialize()
import win32gui, ctypes, comtypes.client as cc, comtypes.gen.UIAutomationClient as UIA

# Find all mmui windows
print("=== WeChat windows ===")
def cb(h, _):
    t = win32gui.GetWindowText(h); c = win32gui.GetClassName(h)
    if 'mmui' in c or 'Qt5' in c or 'Weixin' in t:
        print(f"HWND={h} title='{t[:40]}' class='{c[:40]}' vis={win32gui.IsWindowVisible(h)}")
    return True
CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
ctypes.windll.user32.EnumWindows(CB(cb), 0)

# Find first visible mmui window for UIA scan
target = 0
def cb2(h, _):
    global target
    t = win32gui.GetWindowText(h); c = win32gui.GetClassName(h)
    if 'mmui' in c and win32gui.IsWindowVisible(h) and target == 0:
        target = h
    return True
CB2 = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
ctypes.windll.user32.EnumWindows(CB2(cb2), 0)

if target:
    uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
    e = uia.ElementFromHandle(target)
    c = uia.CreateTrueCondition()
    a = e.FindAll(5, c)
    print(f"\n=== UIA tree: {a.Length} nodes, FW={e.CurrentFrameworkId} ===")
    for i in range(a.Length):
        elem = a.GetElement(i)
        print(f"  [{i}] name='{elem.CurrentName}' class='{elem.CurrentClassName}' type={elem.CurrentControlType}")
else:
    print("No visible mmui window found!")
