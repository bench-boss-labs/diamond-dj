"""Help, install, release notes and new-version messages: python3 tests/help_test.py [outdir]

Serves a copy of the app on localhost (so the offline copy installs), then publishes a pretend
next version into that copy and checks the "new version" banner, a quiet release, the one-time
"updated" note, and that the full guide opens with no internet."""
import sys, os, shutil, tempfile, threading, functools, http.server, socketserver, time, json, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
SITE = tempfile.mkdtemp()
shutil.copytree(ROOT, os.path.join(SITE, 'diamond-dj'), ignore=shutil.ignore_patterns('.git', 'tests'))
APPDIR = os.path.join(SITE, 'diamond-dj')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=SITE))
APP = f'http://localhost:{srv.server_address[1]}/diamond-dj/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

def release(version, text, quiet=False):
    """What tools/release.py does, in the served copy: a new top note, version.js and sw.js VERSION."""
    p = lambda f: os.path.join(APPDIR, f)
    notes = json.load(open(p('release-notes.json')))
    notes.insert(0, {'version': version, 'date': '2026-12-01', **({'quiet': True} if quiet else {}), 'notes': [{'type': 'fixed', 'text': text}]})
    json.dump(notes, open(p('release-notes.json'), 'w'))
    sw = open(p('sw.js')).read()
    n = int(re.search(r"diamond-v(\d+)", sw).group(1)) + 1
    open(p('sw.js'), 'w').write(re.sub(r"diamond-v\d+", f'diamond-v{n}', sw, count=1))
    open(p('version.js'), 'w').write(f"window.APP_VERSION = {json.dumps(version)};\nwindow.DIAMOND_BUILD = {json.dumps({'version': version, 'built': 'test'})};\nwindow.DIAMOND_NOTES = {json.dumps(notes)};\n")

errors, checks = [], []
def check(name, ok):
    checks.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name)

def visible(page, sel):
    return page.is_visible(sel)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}, bypass_csp=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    page.goto(APP)
    page.wait_for_selector('#main .empty, .upnext')
    page.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller', timeout=15000)
    check('offline copy installed on first open', True)
    page.reload(); page.wait_for_selector('#main .empty, .upnext')  # opened again, from the offline copy
    check('no "updated" note on a brand-new install', not visible(page, '#newsBar') and page.evaluate("localStorage.getItem('diamond.seenVersion')") == page.evaluate('APP_VERSION'))

    # ------------------------------------------------ Help
    page.click('#helpBtn'); page.wait_for_selector('.guide-link')
    body = page.inner_text('#dlgBody')
    check('Help: version line first', body.startswith('Version ' + page.evaluate('APP_VERSION')))
    check('Help: full guide link', page.get_attribute('.guide-link', 'href') == 'guide/')
    check('Help: game day steps and questions', 'Play walkup' in body and page.locator('.faq').count() >= 10)
    check('Help: What’s new lists this version', '(this version)' in page.text_content('#whatsNew'))
    check('Help: organizer section hidden for volunteers', 'For organizers' not in body)
    page.click('summary:has-text("Nothing plays")')
    page.screenshot(path=f'{OUT}/help.png')
    page.click('#dlgClose')

    # Help stays open when locked
    page.click('#lockBtn'); time.sleep(0.3)
    check('locked: Help still there, Settings hidden', visible(page, '#helpBtn') and not visible(page, '#settingsBtn'))
    page.evaluate("setLocked(false)")

    # ------------------------------------------------ Install (headless Chromium never offers the prompt: steps instead)
    page.click('#settingsBtn'); page.click('[data-group="device"] summary'); page.wait_for_selector('#setInstall')
    check('Settings: Install button and version', visible(page, '#setInstall') and 'Version ' in page.inner_text('#dlgBody'))
    page.click('#setInstall')
    check('no install prompt: shows the steps', visible(page, '.install-steps'))
    # a one-tap prompt when Chrome offers it
    page.evaluate("""(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); })()""")
    page.click('#setInstall'); time.sleep(0.3)
    check('install prompt used when offered', page.evaluate('window.__prompted === true') and not visible(page, '.install-steps'))
    page.screenshot(path=f'{OUT}/settings-install.png')
    page.click('#setHelp'); time.sleep(0.3)
    check('Settings › Help and what’s new opens What’s new', page.evaluate("document.getElementById('whatsNew').open"))
    page.click('#dlgClose')

    # ------------------------------------------------ a new version: banner, waits while playing
    page.evaluate('loadDemo()'); page.wait_for_selector('.upnext')
    page.click('[data-act="walkup"]'); time.sleep(0.5)
    release('9.9.0', 'A pretend fix for the test.')
    page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
    time.sleep(3)
    check('no banner while a walk-up plays', not visible(page, '#updateBar'))
    page.click('#stopAll')
    page.wait_for_selector('#updateBar', state='visible', timeout=15000)
    check('banner names the new version', '9.9.0' in page.inner_text('#updateBar'))
    page.click('#updateNotes summary')
    check('banner shows what’s new', 'A pretend fix' in page.inner_text('#updateBar'))
    page.screenshot(path=f'{OUT}/update-bar.png')
    page.click('#updateNow')
    page.wait_for_function("window.APP_VERSION === '9.9.0'", timeout=15000)
    page.wait_for_selector('.upnext')
    check('Update now: new version running, team kept', page.evaluate('team.players.length') == 10)
    page.wait_for_selector('#newsBar', state='visible', timeout=8000)
    check('one-time "updated" note', '9.9.0' in page.inner_text('#newsBar'))
    page.click('#newsSee'); time.sleep(0.3)
    check('See what’s new opens Help at What’s new', page.evaluate("document.getElementById('whatsNew').open") and 'A pretend fix' in page.inner_text('#whatsNew'))
    page.click('#dlgClose')
    page.reload(); page.wait_for_selector('.upnext'); time.sleep(1.5)
    check('the note shows only once', not visible(page, '#newsBar'))

    # ------------------------------------------------ a quiet release switches over by itself
    release('9.9.1', 'A small quiet fix.', quiet=True)
    page.reload(); page.wait_for_selector('.upnext')   # opened, not touched: the quiet update applies
    page.wait_for_function("window.APP_VERSION === '9.9.1'", timeout=20000)
    time.sleep(1.5)
    check('quiet release: switched over with no banner or note', not visible(page, '#updateBar') and not visible(page, '#newsBar'))
    page.click('#helpBtn'); page.wait_for_selector('#whatsNew')
    check('quiet release still listed in What’s new', 'A small quiet fix' in page.text_content('#whatsNew'))
    page.click('#dlgClose')

    # ------------------------------------------------ the guide opens with no internet
    ctx.set_offline(True)
    g = ctx.new_page()
    g.goto(APP + 'guide/')
    check('guide opens offline', 'Diamond DJ guide' in g.title() and g.locator('section').count() > 30)
    links = g.eval_on_selector_all('nav.toc a', 'as => as.map(a => a.getAttribute("href").slice(1))')
    ids = set(g.eval_on_selector_all('section[id]', 'ss => ss.map(s => s.id)'))
    check(f'every guide question links to its answer ({len(links)})', links and all(l in ids for l in links))
    g.screenshot(path=f'{OUT}/guide.png', full_page=False)
    g.set_viewport_size({'width': 390, 'height': 800})
    check('guide: no sideways scrolling on a phone', g.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    g.screenshot(path=f'{OUT}/guide-phone.png')
    b.close()

shutil.rmtree(SITE, ignore_errors=True)
print('\nconsole/page errors:', errors or 'none')
failed = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(failed)}/{len(checks)} passed')
sys.exit(1 if failed or errors else 0)
