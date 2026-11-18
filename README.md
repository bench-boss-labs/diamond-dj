# Diamond DJ

Walk-up songs and game music for youth baseball and softball volunteers, built for an
Android tablet (phones and iPad work too). It runs in the browser, installs to the home
screen, and plays everything from the device, so no wifi is needed at the field.

First team: U13 Burlington Bees. Design spec and mockups live in the claude.ai project "Diamond DJ".

## Roles (version 0.6, screens from 0.7)

| Role | Google Drive sharing | Sees in Settings › Manage |
| --- | --- | --- |
| Diamond DJ Admin | Editor on the Diamond DJ folder | Lineups, **Team setup** (any team), **Admin** |
| Team organizer | Editor on their team's folder | Lineups, **Team setup** |
| Volunteer | Viewer on their team's folder and the Diamond DJ folder | Lineups |

Roles are read at Check for updates. A device that has never checked Drive can set everything up.
The Admin can try the other roles with Settings › Advanced › View as.

- **Team setup:** Roster & walk-ups, Team songs, Music (add team songs to a category, hide one),
  Team info, Publish (the team file, team songs, announcements).
- **Admin:** Common songs, Music categories (name, colour, order, common songs), Publish (the common library).

## What it does (version 0.8)

- **Game** (the only main screen): team, Lock, Help and Settings at the top. Big "Up next" card with
  **Play walkup** (announcement, then the song) and **Skip**; the batting order auto-advances and
  wraps. Tap any batter to play them; press and hold to make them up next. Pick the lineup and
  **Edit order** above the batting order; **New game** (tap twice) goes back to batter 1.
- **Music** on the Game screen (phones: the Music tab): colour-coded categories (Warm-up, Pitchers,
  Crowd favourites, Post-game celebrations to start). Each shows **Shuffle** (a song not played yet
  this game) and a button per song: tap to play, tap again to fade. Played songs are dimmed. Clips
  under 5 s play over the music. A category's common songs come first, then the team's own.
- **Settings**: Manage (Lineups, Team setup, Admin by role), then Updates, Sound, This device and
  Advanced (View as, backup file).
- **Lineups**: saved lineups (new, duplicate, rename, delete, use for the game); drag or arrows to
  reorder; Bench and Add back.
- **Roster**: players (first, last, number, active), an announcement clip and a walk-up song each,
  song comes in under or after the announcement, **Test walkup**, readiness at a glance.
- **Songs**: add MP3s from the device, waveform with start and stop points, Play / Set start here /
  Set stop here / Hear the clip, exact seconds, fade and volume; add a song to music categories.
- **Lock**: hides Settings (and so all setup). The Game screen, Edit order and Help stay open.
  Press and hold 1.5 s to unlock.
- Phones: the Game screen has Walk-ups and Music tabs and shows the next 3 batters; setup lists open
  one item at a time; dialogs open full screen. Tablets show walk-ups and Music side by side.
- **Several teams**: the team button at the top left switches teams, makes a new one or removes one
  from the device. Each team keeps its own roster, lineups, music and game; common songs are shared.
- **Google Drive** (Settings): volunteers sign in with Google and tap **Check for updates** to get
  the teams they run, downloading only new or changed songs. Organizers (Editor access) get
  **Publish to Drive**. Lineups changed on a device are never overwritten by an update.
- **Help** (the ? at the top, open even when locked): game-day checklist, common questions, a
  section for organizers, **What's new** and **App history**, and a link to the **full guide**
  (`guide/`, a separate page that also works offline).
- **Install** (top of Settings): one tap where Chrome offers it, otherwise the steps for
  that device (Android, Samsung Internet, iPad/iPhone, computer).
- **New versions**: "A new version is ready" with what's in it, Update now and Later, shown only
  when nothing is playing. Quiet releases switch over by themselves. Once after an update:
  "Diamond DJ updated to x.y.z · See what's new".
- Offline install (service worker), screen kept awake during play where supported.

**Full guide:** https://scalisec.github.io/diamond-dj/guide/

## Google Drive

```
Diamond DJ/                      (shared person by person; see Roles)
├── library.diamond.json         the common library: common songs (titles, cut points) and music categories
├── Common Songs/…mp3            the common songs' files
└── U13 Bees/                    one folder per team (made by the first Publish)
    ├── U13-Bees.diamond.json    roster, walk-ups, team songs, the team's music, lineups
    ├── Team Songs/…mp3          songs only this team uses (pitcher music, favourites)
    └── Announcements/…mp3       one clip per player
```

The folder id is `DRIVE.folder` in `js/drive.js`. Publishing never deletes anything in Drive, and
the team file is replaced only after every song and clip uploaded.

**One-time Google Cloud setup** (organizer, about 10 minutes):

1. console.cloud.google.com > project list > **New project** "Diamond DJ".
2. APIs & Services > Library > **Google Drive API** > Enable.
3. Google Auth Platform > Get started: app name "Diamond DJ", your email, Audience **External**.
4. Audience > **Test users**: add your Google account and each volunteer's (up to 100).
5. Data Access > Add scopes: `.../auth/drive.readonly` and `.../auth/drive`.
6. Clients > Create client > **Web application**. Authorized JavaScript origin
   `https://scalisec.github.io`; redirect URI `https://scalisec.github.io/diamond-dj/`.
7. Put the client ID in `DRIVE.clientId` in `js/drive.js` (or paste it on a device in Settings >
   Drive connection) and publish.

While the app is in Testing mode Google shows "Google hasn't verified this app": tap Continue.

## Try it

Any static web server works. On a computer:

```
python3 -m http.server 8000
```

Open http://localhost:8000 and tap **Load the demo team** (9 made-up players, test-tone songs and
chime announcements).

## Hosting

GitHub Pages: Settings > Pages > Deploy from a branch > `main` / root.

## Releasing a version

1. Add the version at the top of `release-notes.json` (newest first), with `new`, `improved` or
   `fixed` notes written for volunteers. Mark small behind-the-scenes fixes `"quiet": true`.
2. `python3 tools/release.py` writes `version.js` (version, build time, notes) and moves `sw.js`
   to a new `VERSION`, so every device downloads the new copy.
3. Update Help (`openHelp` in `js/app.js`) and `guide/index.html` if what volunteers do changed.
4. Run the tests, commit, push, and keep a `release-x.y.z` branch as a restore point.

## Tests

```
node --test tests/model.test.js     # batting order, lineups, roster sync, walk-up plan
python3 tests/smoke.py [outdir]     # headless Chromium walk-through of the main flows (needs Playwright)
python3 tests/drive_test.py [outdir] # two devices against a stand-in for Google Drive (tests/fake_drive.py)
python3 tests/help_test.py [outdir]  # Help, install, new-version banner, quiet release, guide offline
```

## Code

Plain HTML, CSS and JavaScript, no libraries.

| File | What it is |
| --- | --- |
| `js/model.js` | Data model and rules (pure, tested in Node) |
| `js/store.js` | IndexedDB: `kv` (team, library, game state) and `audio` (files by path) |
| `js/audio.js` | Web Audio engine: fades, ducking, the two-track walk-up, playlists, previews, waveforms |
| `js/drive.js` | Google sign-in, Check for updates, Publish to Drive |
| `js/app.js` | The screens, in sections marked with `====` banners |
| `app.css` | Bees navy and gold, light background for sun |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline install |
| `release-notes.json`, `version.js`, `tools/release.py` | What's new in each version, and the build stamp shown in Help |
| `guide/` | The full guide page |
| `demo/` | Demo team and generated test audio |
