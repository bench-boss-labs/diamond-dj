"""Google Drive end to end, against tests/fake_drive.py: python3 tests/drive_test.py [outdir]

The organizer publishes the demo team from one device; a volunteer downloads it on another,
changes a lineup, and gets the organizer's next update without losing that lineup."""
import sys, os, threading, functools, http.server, socketserver, time, json, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_drive

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
APP = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()
drive, DRV = fake_drive.start()

def account(name): urllib.request.urlopen(f'{DRV}/_account?name={name}').read()
def tree(): return json.loads(urllib.request.urlopen(f'{DRV}/_tree').read())

errors, checks = [], []
def check(name, ok):
    checks.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name)

SETUP = f"""(async () => {{
  Object.assign(settings, {{ driveApi: '{DRV}/drive/v3/', driveUpload: '{DRV}/upload/drive/v3/', driveAuth: '{DRV}/auth',
    driveClient: 'test-client', driveFolder: 'ROOTFOLDER01' }});
  await saveNow();
}})()"""

def device(b, name):
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}, bypass_csp=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{name}: {m.text}'))
    page.goto(APP)
    page.wait_for_selector('#main .empty, .upnext')
    page.evaluate(SETUP)
    return page

def drive_box(page):
    page.click('#settingsBtn')
    page.wait_for_selector('#driveBox button')

def signin_and_wait(page, selector, timeout=20000):
    page.wait_for_selector(selector, timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])

    # ------------------------------------------------------------ the Diamond DJ Admin publishes the common library, then the team
    org = device(b, 'organizer')
    org.evaluate('loadDemo()'); org.wait_for_selector('.upnext')
    drive_box(org)
    check('Drive section offers the first download', 'Download from Google Drive' in org.inner_text('#driveBox'))
    account('organizer')
    org.click('#drvCheck')
    signin_and_wait(org, '#driveBox:has-text("no teams in the Drive folder")')
    check('after sign-in the app comes back and checks: no teams yet', True)
    org.click('#drvCancel'); org.click('#dlgClose')
    check('Diamond DJ Admin sees Team and Admin', org.evaluate('canTeam()') and org.evaluate('canAdmin()'))
    def publish(page, view, expect=None):
        page.evaluate(f"go('{view}')")
        page.click('#pubStart')
        signin_and_wait(page, '#pubGo')
        text = page.inner_text('#pubBox')
        page.click('#pubGo')
        signin_and_wait(page, '#pubBox:has-text("Published")')
        return text
    text = publish(org, 'cpublish')
    check('common library publish sends the 6 songs: ' + text.split('\n')[1][:100], '6 files' in text)
    text = publish(org, 'publish')
    check('team publish sends the 8 announcements: ' + text.split('\n')[1][:100], '8 files' in text)
    t = tree()
    check('Drive has the library, common songs, team file and clips',
          'library.diamond.json' in t and 'Common Songs/Test Song 1 - Diamond DJ.mp3' in t and
          'U13 Bees/U13-Bees.diamond.json' in t and 'U13 Bees/Announcements/demo-1.mp3' in t and len([x for x in t if x.startswith('Common Songs/')]) == 6)

    # ------------------------------------------------------------ a volunteer downloads
    vol = device(b, 'volunteer')
    drive_box(vol)
    account('volunteer')
    vol.click('#drvCheck')
    signin_and_wait(vol, '#drvGo')
    plan = vol.inner_text('#driveBox')
    check('volunteer sees the team, pre-ticked, with 14 files to download', 'U13 Burlington Bees (demo)' in plan and '14 songs' in plan)
    vol.screenshot(path=f'{OUT}/drive-plan.png')
    vol.click('#drvGo')
    signin_and_wait(vol, '#driveBox:has-text("Up to date")')
    check('team is in use on the volunteer device', vol.evaluate("team.id") == 'demo_team' and vol.evaluate("team.players.length") == 10)
    check('the common moments came too', vol.evaluate("library.moments.length") == 11 and vol.evaluate("gameMoments().length") == 12)
    check('the empty starter team made way', vol.evaluate("Object.keys(teams).length") == 1)
    check('all 14 files stored', vol.evaluate("['Songs/Test Song 1 - Diamond DJ.mp3','Announcements/demo-8.mp3'].every(p => stored.has(p)) && stored.size") == 14)
    vol.click('#dlgClose')
    check('volunteer: no Team or Admin, only Game and Lineup', vol.evaluate("role()") == 'volunteer' and not vol.evaluate('canTeam()') and not vol.evaluate('canAdmin()'))
    vol.evaluate("go('roster')")
    check('volunteer: the Team screen is out of reach', vol.evaluate("ui.view") == 'game')
    vol.click('[data-act="walkup"]'); time.sleep(1)
    check('downloaded walk-up plays', vol.evaluate("Sound.tracks.some(t => t.kind === 'intro' && t.state === 'playing')"))
    vol.click('#stopAll')
    vol.evaluate("Model.benchPlayer(lineup(), 'demo_p3'); lineup().updated = Date.now(); saveTeam()")
    time.sleep(0.5)

    # ------------------------------------------------------------ the Admin changes the roster and a common moment, publishes both
    org.evaluate("team.players.find(p => p.id === 'demo_p1').first = 'Liv'; library.moments[0].name = 'Homer'; saveTeam(); saveLibrary()")
    time.sleep(0.4)
    text = publish(org, 'publish')
    check('second team publish sends no files again', 'Drive doesn' not in text)
    publish(org, 'cpublish')
    check('nothing duplicated in Drive', len(tree()) == len(t))

    # ------------------------------------------------------------ the volunteer updates
    vol.click('#settingsBtn'); vol.wait_for_selector('#drvCheck')
    account('volunteer')
    vol.click('#drvCheck')
    signin_and_wait(vol, '#drvGo')
    check('update needs no downloads', 'already on this device' in vol.inner_text('#driveBox'))
    vol.click('#drvGo')
    signin_and_wait(vol, '#driveBox:has-text("Up to date")')
    check('roster and common moments updated from Drive', vol.evaluate("player('demo_p1').first") == 'Liv' and vol.evaluate("library.moments[0].name") == 'Homer')
    check('the volunteer’s benched player stays benched', 'demo_p3' in vol.evaluate("lineup().bench"))

    # ------------------------------------------------------------ local roster edits are flagged before they're replaced
    vol.click('#dlgClose')
    vol.evaluate("player('demo_p2').first = 'Local'; saveTeam()")
    org.evaluate("team.players.find(p => p.id === 'demo_p4').first = 'Avery'; saveTeam()")
    time.sleep(0.4)
    publish(org, 'publish')
    vol.click('#settingsBtn'); vol.wait_for_selector('#drvCheck'); vol.click('#drvCheck'); signin_and_wait(vol, '#drvGo')
    check('volunteer is warned about changes on this device', vol.is_visible('[data-keep="demo_team"]'))
    vol.screenshot(path=f'{OUT}/drive-warn.png')
    vol.click('[data-keep="demo_team"]')
    vol.click('#drvGo'); signin_and_wait(vol, '#driveBox:has-text("Up to date")')
    check('keeping this device’s roster keeps the local name', vol.evaluate("player('demo_p2').first") == 'Local' and vol.evaluate("player('demo_p4').first") == 'Ava')

    # ------------------------------------------------------------ a team organizer: their team, not the common library
    coach = device(b, 'coach')
    drive_box(coach)
    account('coach')
    coach.click('#drvCheck'); signin_and_wait(coach, '#drvGo'); coach.click('#drvGo'); signin_and_wait(coach, '#driveBox:has-text("Up to date")')
    coach.click('#dlgClose')
    check('team organizer: Team, but no Admin', coach.evaluate("role()") == 'organizer' and coach.evaluate('canTeam()') and not coach.evaluate('canAdmin()'))
    # a team song (pitcher music), published to the team's own Team Songs folder
    coach.evaluate("go('songs')"); time.sleep(0.6)
    coach.set_input_files('[data-act="songs-add"]', os.path.join(ROOT, 'demo', 'test-song-1.mp3') if os.path.exists(os.path.join(ROOT, 'demo', 'test-song-1.mp3')) else [f for f in [os.path.join(ROOT, 'demo', x) for x in sorted(os.listdir(os.path.join(ROOT, 'demo')))] if f.endswith('.mp3')][0])
    coach.wait_for_function("team.songs.length === 1", timeout=8000)
    check('the new song is a team song', coach.evaluate("team.songs[0].path.startsWith('Teams/demo_team/') && !library.songs.some(s => s.id === team.songs[0].id)"))
    coach.evaluate("team.moments[0].songIds.push(team.songs[0].id); saveTeam()")
    time.sleep(0.4)
    text = publish(coach, 'publish')
    check('team organizer publishes the team with its team song', any(x.startswith('U13 Bees/Team Songs/') for x in tree()))
    coach.evaluate("go('cpublish')")
    check('team organizer can’t open Admin › Publish', coach.evaluate("ui.view") == 'game')
    coach.evaluate("settings.viewAs = null; Drive.state.editor = false")
    check('team organizer cannot View as an Admin', coach.evaluate("role()") == 'organizer')
    # the volunteer gets the team song
    vol.click('#dlgClose'); vol.click('#settingsBtn'); vol.wait_for_selector('#drvCheck'); vol.click('#drvCheck'); signin_and_wait(vol, '#drvGo')
    vol.click('#drvGo'); signin_and_wait(vol, '#driveBox:has-text("Up to date")')
    check('volunteer gets the team song', vol.evaluate("team.songs.length === 1 && stored.has(team.songs[0].path)"))
    # View as (the Admin trying the other roles)
    org.evaluate("settings.viewAs = 'volunteer'; render()")
    check('View as Volunteer hides Team and Admin', not org.evaluate('canTeam()') and not org.evaluate('canAdmin()'))
    org.evaluate("settings.viewAs = 'organizer'; render()")
    check('View as Team organizer: Team, no Admin', org.evaluate('canTeam()') and not org.evaluate('canAdmin()'))
    org.evaluate("settings.viewAs = null; render()")

    # ------------------------------------------------------------ teams
    vol.click('#dlgClose')
    vol.click('#teamName'); vol.wait_for_selector('#teamNew')
    vol.click('#teamNew'); vol.fill('#askInput', 'U11 Bees'); vol.click('#askOk')
    time.sleep(0.4)
    check('new team made and in use', vol.evaluate("team.name") == 'U11 Bees' and vol.evaluate("Object.keys(teams).length") == 2)
    check('header and screen switch to the new team', vol.inner_text('#teamName').lower() == 'u11 bees' and 'No players yet' in vol.inner_text('#main'))
    vol.click('#teamName'); vol.wait_for_selector('[data-team="demo_team"]')
    vol.screenshot(path=f'{OUT}/teams.png')
    vol.click('[data-team="demo_team"]'); time.sleep(0.4)
    check('switch back keeps that team’s game state', vol.evaluate("team.id") == 'demo_team' and 'demo_p3' in vol.evaluate("lineup().bench"))
    vol.reload(); vol.wait_for_selector('.upnext')
    check('teams and the team in use survive a reload', vol.evaluate("Object.keys(teams).length") == 2 and vol.evaluate("team.id") == 'demo_team')
    b.close()

print('\nconsole/page errors:', errors or 'none')
failed = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(failed)}/{len(checks)} passed')
sys.exit(1 if failed or errors else 0)
