"""
VNC Keep-Alive Daemon — raw socket, no dependencies.
Connects to TightVNC server on localhost:5900 and keeps desktop session active.
"""
import socket
import time
import logging
import sys

logging.basicConfig(level=logging.INFO, format='[vnc-daemon] %(message)s', stream=sys.stdout)
log = logging.getLogger(__name__)

VNC_HOST = '127.0.0.1'
VNC_PORT = 5900

def rfb_handshake(sock):
    """Perform minimal RFB handshake to make TightVNC start rendering."""
    # 1. Read server version
    data = sock.recv(12)
    if not data.startswith(b'RFB '):
        raise Exception(f'Not an RFB server: {data[:20]}')
    server_ver = data.decode('ascii').strip()
    log.info(f'Server version: {server_ver}')

    # 2. Send client version
    sock.sendall(b'RFB 003.008\n')

    # 3. Read security types
    n = sock.recv(1)[0]
    sec_types = sock.recv(n)
    log.info(f'Security types: {list(sec_types)}')

    # 4. Choose "None" (1) if available, else first
    chosen = 1 if 1 in sec_types else sec_types[0]
    sock.sendall(bytes([chosen]))
    log.info(f'Chose security: {chosen}')

    # 5. Read security result
    result = sock.recv(4)
    if result != b'\x00\x00\x00\x00':
        reason_len = int.from_bytes(sock.recv(4), 'big')
        reason = sock.recv(reason_len).decode()
        raise Exception(f'Security failed: {reason}')

    # 6. Send shared flag
    sock.sendall(b'\x01')

    # 7. Read ServerInit (framebuffer info)
    fb_data = sock.recv(24)
    w = int.from_bytes(fb_data[0:2], 'big')
    h = int.from_bytes(fb_data[2:4], 'big')
    name_len = int.from_bytes(fb_data[20:24], 'big')
    name = sock.recv(name_len).decode('ascii', errors='ignore')
    log.info(f'Desktop: {w}x{h} "{name}"')
    return True

def main():
    retry_delay = 10
    while True:
        sock = None
        try:
            log.info(f'Connecting to {VNC_HOST}:{VNC_PORT}...')
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((VNC_HOST, VNC_PORT))
            sock.settimeout(30)
            
            rfb_handshake(sock)
            log.info('VNC connected — desktop session is now ACTIVE')

            # Keep connection alive with periodic pixel requests
            while True:
                try:
                    sock.settimeout(30)
                    # Send FramebufferUpdateRequest
                    sock.sendall(b'\x03\x01\x00\x00\x00\x00\x00\x00\x00\x00')
                    data = sock.recv(4096)
                    if not data:
                        raise Exception('Connection closed by server')
                    time.sleep(30)
                except socket.timeout:
                    # Normal — just means no screen changes
                    continue

        except Exception as e:
            log.warning(f'VNC error: {e}, reconnecting in {retry_delay}s...')
        finally:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass

        time.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, 300)

if __name__ == '__main__':
    main()
