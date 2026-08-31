"""Capture screen on Windows using ctypes/GDI — no PowerShell needed."""
import ctypes
from ctypes import wintypes
import os

# GDI constants
SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0

# Get screen dimensions
user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

width = user32.GetSystemMetrics(0)
height = user32.GetSystemMetrics(1)

# Create DCs
hdc_screen = user32.GetDC(0)
hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
hbm = gdi32.CreateCompatibleBitmap(hdc_screen, width, height)
gdi32.SelectObject(hdc_mem, hbm)

# Copy screen
gdi32.BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, SRCCOPY)

# Get bitmap bits
class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]

bmi = BITMAPINFOHEADER()
bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bmi.biWidth = width
bmi.biHeight = -height  # top-down
bmi.biPlanes = 1
bmi.biBitCount = 32
bmi.biCompression = 0

buf_size = width * height * 4
buf = (ctypes.c_ubyte * buf_size)()
gdi32.GetDIBits(hdc_mem, hbm, 0, height, buf, ctypes.byref(bmi), DIB_RGB_COLORS)

# Cleanup
gdi32.DeleteObject(hbm)
gdi32.DeleteDC(hdc_mem)
user32.ReleaseDC(0, hdc_screen)

# Save as BMP then convert to PNG (if PIL available)
out_path = r"C:\Users\Administrator\Desktop\screenshot.png"
try:
    from PIL import Image
    img = Image.frombytes("RGBA", (width, height), bytes(buf), "raw", "BGRA")
    img.save(out_path, "PNG")
    print(f"SCREENSHOT_SAVED: {out_path} ({width}x{height})")
except ImportError:
    # Fallback: save raw BMP
    bmp_path = r"C:\Users\Administrator\Desktop\screenshot.bmp"
    with open(bmp_path, "wb") as f:
        # BMP header
        file_size = 54 + buf_size
        f.write(b"BM")
        f.write(file_size.to_bytes(4, "little"))
        f.write(b"\x00\x00\x00\x00")  # reserved
        f.write((54).to_bytes(4, "little"))  # offset
        # DIB header
        f.write((40).to_bytes(4, "little"))
        f.write(width.to_bytes(4, "little"))
        f.write((-height).to_bytes(4, "little"))
        f.write((1).to_bytes(2, "little"))
        f.write((32).to_bytes(2, "little"))
        f.write((0).to_bytes(4, "little"))  # BI_RGB
        f.write(buf_size.to_bytes(4, "little"))
        f.write((0).to_bytes(4, "little")) * 4  # resolution + colors
        f.write(bytes(buf))
    print(f"SCREENSHOT_SAVED_BMP: {bmp_path} ({width}x{height})")
