"""
VNC Keep-Alive Daemon — keeps TightVNC desktop session active.
Uses pure Python DES for VNC Auth (type 2).
"""
import socket, time, logging, sys, struct

logging.basicConfig(level=logging.INFO, format='[vnc-daemon] %(message)s', stream=sys.stdout)
log = logging.getLogger(__name__)

VNC_HOST = '127.0.0.1'
VNC_PORT = 15900

# TightVNC password hex from registry: HKLM\SOFTWARE\TightVNC\Server\Password
_PASSWORD_HEX = 'BF26C63F7ED99324'

# DES tables (standard)
IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]
FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]
PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]
PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]
SBOX = [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
        [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
        [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
        [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
        [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
        [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
        [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
        [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]]
P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]
E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1]
ROT = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1]

def _des_crypt(block8, key8, encrypt=True):
    """DES block cipher: 8 byte block, 8 byte key."""
    keys = _make_subkeys(struct.unpack('>Q', key8)[0])
    if not encrypt:
        keys = keys[::-1]
    x = struct.unpack('>Q', block8)[0]
    x = _permute(x, IP, 64)
    L = (x >> 32) & 0xFFFFFFFF
    R = x & 0xFFFFFFFF
    for k in keys:
        t = R
        R = L ^ _f(R, k)
        L = t
    return struct.pack('>Q', _permute((R << 32) | L, FP, 64))

def _make_subkeys(raw_key):
    """Generate 16 DES subkeys from 64-bit raw key."""
    k = _permute(raw_key, PC1, 64)
    C = (k >> 28) & 0x0FFFFFFF
    D = k & 0x0FFFFFFF
    keys = []
    for rot in ROT:
        C = ((C << rot) | (C >> (28 - rot))) & 0x0FFFFFFF
        D = ((D << rot) | (D >> (28 - rot))) & 0x0FFFFFFF
        keys.append(_permute((C << 28) | D, PC2, 56))
    return keys

def _f(R, K):
    """DES F-function."""
    e = _permute(R, E, 32)
    x = e ^ K
    out = 0
    for i in range(8):
        chunk = (x >> (42 - i * 6)) & 0x3F
        row = ((chunk >> 4) & 2) | (chunk & 1)
        col = (chunk >> 1) & 0xF
        out = (out << 4) | SBOX[i][row * 16 + col]
    return _permute(out, P, 32)

def _permute(x, table, nbits):
    y = 0
    for i, pos in enumerate(table):
        if x & (1 << (nbits - pos)):
            y |= 1 << (len(table) - 1 - i)
    return y

def decrypt_tightvnc_password():
    """Decrypt TightVNC stored password (DES ECB with zero key)."""
    enc = bytes.fromhex(_PASSWORD_HEX)
    zero_key = b'\x00' * 8
    dec = _des_crypt(enc, zero_key, encrypt=False)
    return dec.rstrip(b'\x00').decode('latin-1')

def vnc_auth(sock, password):
    """VNC Auth type 2: encrypt 16-byte challenge with password as DES key."""
    c = b''
    while len(c) < 16:
        c += sock.recv(16 - len(c))
    pw = password[:8].encode('latin-1').ljust(8, b'\x00')
    key = bytes(_revbits(b) for b in pw)
    resp = _des_crypt(c[:8], key) + _des_crypt(c[8:16], key)
    sock.sendall(resp)
    r = sock.recv(4)
    if r != b'\x00\x00\x00\x00':
        n = int.from_bytes(sock.recv(4), 'big')
        raise Exception(f'Auth failed: {sock.recv(n).decode()}')
    return True

def _revbits(b):
    return sum(((b >> j) & 1) << (7 - j) for j in range(8))

def main():
    log.info(f'Decrypting TightVNC password...')
    try:
        password = decrypt_tightvnc_password()
        log.info(f'Password decrypted (len={len(password)})')
    except Exception as e:
        log.error(f'Decrypt failed: {e}, trying empty password')
        password = ''
    
    delay = 10
    while True:
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((VNC_HOST, VNC_PORT))
            sock.settimeout(30)
            
            # RFB handshake
            ver = b''
            while b'\n' not in ver:
                ver += sock.recv(1)
            sock.sendall(b'RFB 003.008\n')
            
            n = sock.recv(1)[0]
            types = list(sock.recv(n))
            
            if 2 in types:
                sock.sendall(b'\x02')
                vnc_auth(sock, password)
                log.info('VNC Auth OK')
            elif 1 in types:
                sock.sendall(b'\x01')
                sock.recv(4)
            else:
                raise Exception(f'Security: {types}')
            
            sock.sendall(b'\x01')
            fb = b''
            while len(fb) < 24:
                fb += sock.recv(24 - len(fb))
            nl = int.from_bytes(fb[20:24], 'big')
            name = b''
            while len(name) < nl:
                name += sock.recv(nl - len(name))
            
            w = int.from_bytes(fb[0:2], 'big')
            h = int.from_bytes(fb[2:4], 'big')
            log.info(f'VNC CONNECTED — Desktop {w}x{h} ACTIVE')
            
            # ── Fix: Set desktop size if server reports 0×0 ──
            if w == 0 or h == 0:
                DESKTOP_W = 1920
                DESKTOP_H = 1080
                log.info(f'VNC desktop is {w}x{h} — requesting {DESKTOP_W}x{DESKTOP_H}...')
                # SetDesktopSize message (type 251)
                msg = struct.pack('!BxHHBx', 251, DESKTOP_W, DESKTOP_H, 1)
                msg += struct.pack('!IhhhhI', 0, 0, 0, DESKTOP_W, DESKTOP_H, 0)
                sock.sendall(msg)
                # Read updated framebuffer info
                time.sleep(1)
                try:
                    sock.settimeout(5)
                    fb2 = b''
                    while len(fb2) < 24:
                        fb2 += sock.recv(24 - len(fb2))
                    new_w = int.from_bytes(fb2[0:2], 'big')
                    new_h = int.from_bytes(fb2[2:4], 'big')
                    log.info(f'VNC desktop now: {new_w}x{new_h}')
                except Exception as e:
                    log.warning(f'Failed to read new desktop size: {e}')
            
            delay = 10  # reset delay
            
            # Keep alive loop
            while True:
                try:
                    sock.settimeout(30)
                    sock.sendall(b'\x03\x01\x00\x00\x00\x00\x00\x00\x00\x00')
                    sock.recv(4096)
                    time.sleep(30)
                except socket.timeout:
                    continue
                
        except Exception as e:
            log.warning(f'{e}, retry {delay}s')
        finally:
            if sock:
                try: sock.close()
                except: pass
        
        time.sleep(delay)
        delay = min(delay * 2, 300)

if __name__ == '__main__':
    main()
