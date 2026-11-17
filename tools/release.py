"""Stamp a release: python3 tools/release.py

1. Add the new version at the top of release-notes.json (newest first). Mark small,
   behind-the-scenes fixes "quiet": true: they install by themselves with no message.
2. Run this. It writes version.js (version, build time, release notes) and, when the version
   changed, moves sw.js to a new VERSION so every device downloads the new copy.
"""
import json, os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = lambda *p: os.path.join(ROOT, *p)

notes = json.load(open(path('release-notes.json'), encoding='utf-8'))
version = notes[0]['version']
sw = open(path('sw.js'), encoding='utf-8').read()
cache = re.search(r"const VERSION = 'diamond-v(\d+)'", sw)
old = re.search(r"APP_VERSION = '([^']+)'", open(path('version.js'), encoding='utf-8').read())
n = int(cache.group(1))
if not old or old.group(1) != version:
    n += 1
    sw = sw.replace(cache.group(0), f"const VERSION = 'diamond-v{n}'")
    open(path('sw.js'), 'w', encoding='utf-8').write(sw)
build = {'version': version, 'built': time.strftime('%Y-%m-%d %H:%M'), 'cache': f'diamond-v{n}'}
open(path('version.js'), 'w', encoding='utf-8').write(
    f"window.APP_VERSION = {json.dumps(version)};\n"
    f"window.DIAMOND_BUILD = {json.dumps(build)};\n"
    f"window.DIAMOND_NOTES = {json.dumps(notes, ensure_ascii=False, separators=(',', ':'))};\n")
print(f'Diamond DJ {version} · cache diamond-v{n}')
