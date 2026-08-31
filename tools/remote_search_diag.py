"""Diagnose group search: /search?q=<name>&type=group with the target from the
Node db, plus /search-dump for the same keyword. ASCII-only stdout."""
import io
import json
import sys
import urllib.parse
import urllib.request

REPO = r'C:\Users\Administrator\WxWorkSchedule'
NODE_DB = REPO + r'\server\db.json'
OUT = r'C:\Users\Administrator\at_search_diag.json'

db = json.load(open(NODE_DB, encoding='utf-8'))
group = None
for rec in db.get('liveLogs') or []:
    if rec.get('targetType') == 'group' and '@' in (rec.get('content') or ''):
        group = rec.get('targetName')
print('TARGET_LEN', len(group))

out = {}
for q, t, label in [(group, 'group', 'exact_group'),
                    (group[:2], 'all', 'prefix2_all')]:
    url = 'http://127.0.0.1:39800/search?' + urllib.parse.urlencode({'q': q, 'type': t})
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            out[label] = json.loads(r.read())
    except Exception as e:
        out[label] = {'error': str(e)}

dump_url = 'http://127.0.0.1:39800/search-dump?keyword=' + urllib.parse.quote(group)
try:
    with urllib.request.urlopen(dump_url, timeout=90) as r:
        out['search_dump'] = json.loads(r.read())
except Exception as e:
    out['search_dump'] = {'error': str(e)}

io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))
for label in ('exact_group', 'prefix2_all'):
    v = out.get(label) or {}
    if isinstance(v, dict) and 'results' in v:
        names = [(x.get('name'), x.get('type'), x.get('category')) for x in v['results']]
        print(label, 'count=', len(names), 'ascii=', str(names)[:200])
    else:
        print(label, 'keys=', list(v.keys()) if isinstance(v, dict) else type(v).__name__,
              str(v)[:120])
print('DUMP_KEYS', list((out.get('search_dump') or {}).keys()))
