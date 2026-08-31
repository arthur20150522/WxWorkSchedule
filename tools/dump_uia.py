"""Dump all UIA element names on WeChat window."""
import pythoncom; pythoncom.CoInitialize()
import comtypes.client as cc
import comtypes.gen.UIAutomationClient as UIA

try:
    from wx4py.core.win32 import find_wechat_window
    hwnd = find_wechat_window()
except:
    hwnd = 0

if not hwnd:
    print("No WeChat window found")
    exit()

uia = cc.CreateObject('{ff48dba4-60ef-4201-aa87-54103eef594e}', interface=UIA.IUIAutomation)
elem = uia.ElementFromHandle(hwnd)
all_e = elem.FindAll(UIA.TreeScope_Subtree, uia.CreateTrueCondition())

print(f"HWND={hwnd}, Total elements: {all_e.Length}")
for i in range(all_e.Length):
    e = all_e.GetElement(i)
    n = (e.CurrentName or '').strip()
    c = e.CurrentClassName or ''
    t = e.CurrentControlType if hasattr(e, 'CurrentControlType') else '?'
    try:
        pi = e.GetCurrentPattern(UIA.UIA_InvokePatternId)
        has_invoke = "INVOKE_OK" if pi else "NO_INVOKE"
    except:
        has_invoke = "NO_INVOKE"
    try:
        br = e.CurrentBoundingRectangle
        pos = f"({br.left},{br.top}) {br.right-br.left}x{br.bottom-br.top}"
    except:
        pos = "NO_RECT"
    if n or c:
        print(f"  [{i}] name={n[:50]!r} class={c[:40]!r} type={t} invoke={has_invoke} rect={pos}")
