/* Diamond DJ: Google Drive (sign-in, Check for updates, Publish to Drive).
 *
 * The team's Drive folder ("Diamond DJ") is shared person by person. Drive decides who can
 * download (Viewer) and who can publish (Editor); the app never stores a password.
 *
 *   Diamond DJ/
 *   ├── library.diamond.json        every song's title and cut points (all teams)
 *   ├── Shared Songs/…mp3           each song once, whichever teams use it
 *   └── U13 Bees/                   one folder per team
 *       ├── U13-Bees.diamond.json   roster, team songs, music, lineups
 *       └── Announcements/…mp3      one clip per player
 *
 * On the device a song lives at "Songs/<file>" and a clip at "Announcements/<file>";
 * Drive.state.files remembers which Drive file (id and md5) each one came from, so updates
 * download only what is new or changed.
 */
'use strict';

const DRIVE = {
  folder: '1MxthsfclhrkPxi8diFOQOhvwj9OZA0Go', // the "Diamond DJ" folder
  clientId: '102151904195-r85e2dru4p965se44seqo6tt2jk829bn.apps.googleusercontent.com', // Google OAuth client (Web application), Diamond DJ Cloud project
  api: 'https://www.googleapis.com/drive/v3/',
  upload: 'https://www.googleapis.com/upload/drive/v3/',
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  scope: 'https://www.googleapis.com/auth/drive.readonly',
  writeScope: 'https://www.googleapis.com/auth/drive',
  songsFolder: 'Common Songs',
  teamSongsFolder: 'Team Songs',
  libraryFile: 'library.diamond.json',
  clipsFolder: 'Announcements',
};
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

/* Google's full-page sign-in (a redirect, not a pop-up: pop-ups are unreliable in home-screen
   apps). Google sends the person back with a one-hour access token, kept on this device only. */
const Auth = {
  KEY: 'diamond.google',
  PENDING: 'diamond.signin',
  clientId() { return String(settings.driveClient || DRIVE.clientId || '').trim(); },
  enabled() { return !!this.clientId(); },
  canRedirect() { return location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname); },
  redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  _entry() {
    try { const t = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (t && t.exp > Date.now() + 60000) return t; } catch (e) {}
    return null;
  },
  token() { return this._entry()?.token || null; },
  canWrite() { return String(this._entry()?.scope || '').split(/\s+/).includes(DRIVE.writeScope); },
  forget() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  async signIn(resume, { chooseAccount = false, write = false } = {}) {
    const state = Model.uid('s') + Model.uid('s');
    try { localStorage.setItem(this.PENDING, JSON.stringify({ state, resume, at: Date.now() })); } catch (e) {}
    const u = new URL(settings.driveAuth || DRIVE.auth);
    const q = { client_id: this.clientId(), redirect_uri: this.redirectUri(), response_type: 'token',
      scope: write ? `${DRIVE.scope} ${DRIVE.writeScope}` : DRIVE.scope, include_granted_scopes: 'true', state };
    if (chooseAccount) q.prompt = 'select_account';
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    await saveNow(); // nothing waiting to be saved is lost while we're away at Google
    location.assign(u.toString());
  },
  // at start-up: picks up "#access_token=…" (or "#error=…") from Google
  consume() {
    const h = location.hash;
    if (!/[#&](access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(this.PENDING) || 'null'); localStorage.removeItem(this.PENDING); } catch (e) {}
    if (!pending || pending.state !== p.get('state') || Date.now() - pending.at > 30 * 60000) return { error: 'state' };
    if (p.get('error')) return { error: p.get('error'), resume: pending.resume };
    const ttl = +p.get('expires_in') || 3600;
    try { localStorage.setItem(this.KEY, JSON.stringify({ token: p.get('access_token'), scope: p.get('scope') || '', exp: Date.now() + ttl * 1000 })); } catch (e) {}
    return { ok: true, resume: pending.resume };
  },
};

const Drive = {
  // editor: this account can change the Diamond DJ folder (Diamond DJ Admin). roles: team id → true when it can change that team's folder.
  state: { editor: false, account: '', lastCheck: 0, library: null, teams: {}, files: {}, roles: {} },

  async load() {
    const s = await Store.get('drive');
    if (s) this.state = { ...this.state, ...s, teams: s.teams || {}, files: s.files || {}, roles: s.roles || {} };
  },
  save() { return Store.set('drive', this.state).catch(e => console.warn(e)); },

  folderId() {
    const v = String(settings.driveFolder || '').trim();
    const m = v.match(/folders\/([\w-]{10,})/) || v.match(/[?&]id=([\w-]{10,})/) || v.match(/^([\w-]{10,})$/);
    return m ? m[1] : DRIVE.folder;
  },
  ready() { return !!this.folderId() && Auth.enabled() && Auth.canRedirect(); },

  /* ------------------------------------------------------------ talking to Drive */
  url(base, path, params = {}) {
    const u = new URL(path, base);
    u.searchParams.set('supportsAllDrives', 'true');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  },
  api(path, params) { return this.url(settings.driveApi || DRIVE.api, path, params); },
  up(path, params) { return this.url(settings.driveUpload || DRIVE.upload, path, params); },
  async call(method, url, body, headers = {}) {
    const t = Auth.token();
    if (!t) throw new Error('drive:signin');
    let r;
    try { r = await fetch(url, { method, body, cache: 'no-store', headers: { ...headers, Authorization: 'Bearer ' + t } }); }
    catch (e) { throw new Error('drive:offline'); }
    if (r.status === 401) { Auth.forget(); throw new Error('drive:signin'); }
    if (!r.ok) {
      let reason = '';
      try { const j = await r.json(); reason = j.error?.errors?.[0]?.reason || j.error?.status || ''; } catch (e) {}
      throw new Error(`drive:${r.status}:${reason}`);
    }
    return r;
  },
  get(path, params) { return this.call('GET', this.api(path, params)); },
  async json(path, params) { return (await this.get(path, params)).json(); },
  async list(folderId) {
    const out = [];
    let token = '';
    do {
      const p = { q: `'${folderId}' in parents and trashed = false`, pageSize: '1000', includeItemsFromAllDrives: 'true',
        fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,capabilities(canAddChildren))' };
      if (token) p.pageToken = token;
      const j = await this.json('files', p);
      out.push(...(j.files || []));
      token = j.nextPageToken || '';
    } while (token);
    return out;
  },
  download(id) { return this.get('files/' + id, { alt: 'media' }); },
  async createFolder(name, parent) {
    return (await this.call('POST', this.api('files', { fields: 'id,name' }), JSON.stringify({ name, parents: [parent], mimeType: FOLDER_TYPE }),
      { 'Content-Type': 'application/json; charset=UTF-8' })).json();
  },
  // a new file in two steps: Google gives an upload address, then the bytes go there
  async uploadNew(name, parent, blob, type) {
    const init = await this.call('POST', this.up('files', { uploadType: 'resumable', fields: 'id,name,size,md5Checksum,modifiedTime' }),
      JSON.stringify({ name, parents: [parent] }), { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type });
    const loc = init.headers.get('Location');
    if (!loc) throw new Error('drive:upload');
    return (await this.call('PUT', loc, blob, { 'Content-Type': type })).json();
  },
  // new contents for an existing file (Drive keeps the earlier one in its version history)
  async replace(id, blob, type) {
    return (await this.call('PATCH', this.up('files/' + id, { uploadType: 'media', fields: 'id,name,size,md5Checksum,modifiedTime' }), blob, { 'Content-Type': type })).json();
  },

  /* ------------------------------------------------------------ reading the folder */

  /* Everything in the Diamond DJ folder that matters: who may change what, the common library
     and its songs, and each team (its file, team songs and announcement clips). */
  async scan(say = () => {}) {
    if (navigator.onLine === false) throw new Error('drive:offline');
    say('Looking at the Google Drive folder…');
    const root = await this.json('files/' + this.folderId(), { fields: 'id,name,capabilities(canAddChildren)' });
    this.state.editor = !!root.capabilities?.canAddChildren;
    try { this.state.account = (await this.json('about', { fields: 'user(emailAddress)' })).user?.emailAddress || ''; } catch (e) {}
    const top = await this.list(root.id);
    const songsFolder = top.find(f => f.mimeType === FOLDER_TYPE && f.name === DRIVE.songsFolder) || null;
    const songFiles = new Map((songsFolder ? await this.list(songsFolder.id) : []).filter(f => f.mimeType !== FOLDER_TYPE).map(f => [f.name, f]));
    const libFile = top.find(f => f.name === DRIVE.libraryFile) || null;
    const libData = libFile ? Model.checkLibrary(await (await this.download(libFile.id)).json()) : null;
    const remoteTeams = [];
    const roles = {};
    for (const folder of top.filter(f => f.mimeType === FOLDER_TYPE && f !== songsFolder)) {
      say(`Reading ${folder.name}…`);
      const inside = await this.list(folder.id);
      const file = inside.filter(f => /\.diamond\.json$/i.test(f.name)).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
      if (!file) continue;
      let data;
      try { data = Model.checkTeam(await (await this.download(file.id)).json()); } catch (e) { continue; }
      const sub = name => inside.find(f => f.mimeType === FOLDER_TYPE && f.name === name) || null;
      const files = async folder => new Map((folder ? await this.list(folder.id) : []).filter(f => f.mimeType !== FOLDER_TYPE).map(f => [f.name, f]));
      const clipsFolder = sub(DRIVE.clipsFolder), teamSongsFolder = sub(DRIVE.teamSongsFolder);
      const editor = !!folder.capabilities?.canAddChildren;
      roles[data.id] = editor;
      remoteTeams.push({ folder, file, data, editor, clipsFolder, clipFiles: await files(clipsFolder), teamSongsFolder, teamSongFiles: await files(teamSongsFolder) });
    }
    this.state.roles = roles;
    this.save();
    return { root, editor: this.state.editor, songsFolder, songFiles, libFile, libData, teams: remoteTeams };
  },

  /* What an update would do for the chosen teams: which files to download, and which teams
     have changes on this device that the update would replace. */
  plan(remote, chosenIds) {
    const items = [], missing = [];
    const want = (path, file) => {
      if (!file) { missing.push(path); return; }
      const have = this.state.files[path];
      if (stored.has(path) && have && have.md5 === (file.md5Checksum || '') && have.id === file.id) return;
      if (!items.some(i => i.path === path)) items.push({ path, id: file.id, md5: file.md5Checksum || '', size: +file.size || 0 });
    };
    const teamsPlan = [];
    for (const r of remote.teams.filter(r => chosenIds.includes(r.data.id))) {
      const local = teams[r.data.id];
      const st = this.state.teams[r.data.id];
      const changed = !local || !st || st.modifiedTime !== r.file.modifiedTime;
      const localEdits = !!(local && st && Model.setupPrint(local) !== st.setupPrint);
      teamsPlan.push({ id: r.data.id, name: r.data.name, changed, localEdits, onDevice: !!local });
      const lib = remote.libData || library;
      for (const id of Model.teamSongIds(r.data, lib)) {
        const own = Model.findSong({ songs: r.data.songs }, id);
        if (own) { want(own.path, r.teamSongFiles.get(Model.fileName(own.path))); continue; }
        const s = Model.findSong(lib, id) || Model.findSong(library, id);
        if (s) want(s.path, remote.songFiles.get(Model.fileName(s.path)));
      }
      for (const p of r.data.players) if (p.intro && p.intro.path) want(p.intro.path, r.clipFiles.get(p.intro.path.replace(/^Announcements\//, '')));
    }
    return { items, missing, teams: teamsPlan, bytes: items.reduce((n, i) => n + i.size, 0) };
  },

  /* Download the plan's files (three at a time), then bring in the teams and the library. */
  async apply(remote, plan, { keepSetup = {}, say = () => {}, meter = () => {}, stopped = () => false } = {}) {
    let done = 0, bytes = 0;
    const failed = [];
    const queue = [...plan.items];
    const worker = async () => {
      while (queue.length && !stopped()) {
        const it = queue.shift();
        try {
          const blob = await (await this.download(it.id)).blob();
          await storeFile(it.path, blob);
          this.state.files[it.path] = { id: it.id, md5: it.md5, size: it.size };
          if (++done % 5 === 0) this.save();
        } catch (e) {
          if (e.message === 'drive:signin' || e.message === 'drive:offline') { queue.length = 0; throw e; }
          failed.push(it.path);
        }
        bytes += it.size;
        meter(plan.bytes ? bytes / plan.bytes : (done + failed.length) / plan.items.length);
        say(`Downloaded ${done} of ${plan.items.length}${plan.bytes ? ` (${mb(bytes)} of ${mb(plan.bytes)})` : ''}…`);
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); }
    finally { await this.save(); }
    if (stopped()) return { stopped: true, done, failed };

    // the songs' titles and cut points, then each team
    if (remote.libData) {
      library = Model.mergeLibrary(library, remote.libData, { keepLocal: !!keepSetup.common });
      this.state.library = { fileId: remote.libFile.id, modifiedTime: remote.libFile.modifiedTime, print: Model.fingerprint(library), lastSync: Date.now() };
      saveLibrary();
    }
    for (const tp of plan.teams) {
      const r = remote.teams.find(x => x.data.id === tp.id);
      const st = this.state.teams[tp.id];
      const merged = Model.mergeTeam(teams[tp.id] || null, r.data, { lastSync: st?.lastSync || 0, keepSetup: !!keepSetup[tp.id] });
      teams[tp.id] = merged;
      if (team && team.id === tp.id) team = merged;
      this.state.teams[tp.id] = {
        folderId: r.folder.id, folderName: r.folder.name, fileId: r.file.id, modifiedTime: r.file.modifiedTime,
        setupPrint: keepSetup[tp.id] && st ? st.setupPrint : Model.setupPrint(merged), lastSync: Date.now(),
      };
    }
    this.state.lastCheck = Date.now();
    await this.save();
    saveTeam();
    return { stopped: false, done, failed };
  },

  /* ------------------------------------------------------------ publishing */

  // a file on this device that Drive may not have yet: compare with what Drive has under that name
  async consider(uploads, notOnDevice, path, name, inDrive, folder) {
    if (!stored.has(path)) { notOnDevice.push(path); return; }
    const blob = await Store.audio.get(path);
    const have = this.state.files[path];
    if (inDrive && ((have && have.id === inDrive.id && have.md5 === (inDrive.md5Checksum || '')) || (!have && +inDrive.size === blob.size))) {
      this.state.files[path] = { id: inDrive.id, md5: inDrive.md5Checksum || '', size: +inDrive.size || blob.size };
      return;
    }
    uploads.push({ path, name, folder, replaceId: inDrive ? inDrive.id : null, size: blob.size });
  },
  async sendFiles(uploads, folders, { say, meter, bytes }) {
    let sent = 0, n = 0;
    for (const u of uploads) {
      say(`Sending ${++n} of ${uploads.length}: ${u.name}`);
      const blob = await Store.audio.get(u.path);
      const type = blob.type || 'audio/mpeg';
      const r = u.replaceId ? await this.replace(u.replaceId, blob, type) : await this.uploadNew(u.name, (await folders[u.folder]()).id, blob, type);
      this.state.files[u.path] = { id: r.id, md5: r.md5Checksum || '', size: +r.size || blob.size };
      sent += u.size;
      meter(bytes ? sent / bytes : n / uploads.length);
    }
    await this.save();
  },
  json2blob: obj => new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }),

  /* Publishing one team (its team organizers, or the Diamond DJ Admin): the team file, its team
     songs and announcements. The common library isn't touched. */
  async publishPlan(t, say = () => {}) {
    const remote = await this.scan(say);
    const existing = remote.teams.find(r => r.data.id === t.id) || null;
    if (existing ? !existing.editor && !remote.editor : !remote.editor) throw new Error('drive:noteditor');
    const st = this.state.teams[t.id];
    const folderName = existing ? existing.folder.name : (t.short || t.name || 'Team').replace(/[\\/]+/g, '-').trim();
    const uploads = [], notOnDevice = [];
    for (const s of t.songs) await this.consider(uploads, notOnDevice, s.path, Model.fileName(s.path), existing && existing.teamSongFiles.get(Model.fileName(s.path)), 'teamSongs');
    for (const p of t.players) {
      if (!p.intro || !p.intro.path) continue;
      const name = p.intro.path.replace(/^Announcements\//, '');
      await this.consider(uploads, notOnDevice, p.intro.path, name, existing && existing.clipFiles.get(name), 'clips');
    }
    // someone else published this team since this device last got it
    const since = !!(existing && st && st.modifiedTime && st.modifiedTime !== existing.file.modifiedTime);
    const needsCommon = Model.commonSongsMissing(t, library, remote.libData || { songs: [] });
    return { kind: 'team', remote, team: t, existing, folderName, uploads, notOnDevice, firstTime: !existing, since, needsCommon,
      bytes: uploads.reduce((n, u) => n + u.size, 0) };
  },

  async publish(plan, { say = () => {}, meter = () => {} } = {}) {
    const { remote, team: t } = plan;
    let teamFolder = plan.existing ? plan.existing.folder : null;
    const folderFor = () => teamFolder ? teamFolder : this.createFolder(plan.folderName, remote.root.id).then(f => (teamFolder = f));
    let teamSongs = plan.existing && plan.existing.teamSongsFolder, clips = plan.existing && plan.existing.clipsFolder;
    const folders = {
      teamSongs: async () => teamSongs || (teamSongs = await this.createFolder(DRIVE.teamSongsFolder, (await folderFor()).id)),
      clips: async () => clips || (clips = await this.createFolder(DRIVE.clipsFolder, (await folderFor()).id)),
    };
    // the music first: if any of it fails, the team file isn't replaced, so nobody gets a
    // team pointing at songs that aren't there
    await this.sendFiles(plan.uploads, folders, { say, meter, bytes: plan.bytes });
    say('Sending the team…');
    const fileName = `${plan.folderName.replace(/\s+/g, '-')}.diamond.json`;
    const r = plan.existing ? await this.replace(plan.existing.file.id, this.json2blob(t), 'application/json')
      : await this.uploadNew(fileName, (await folderFor()).id, this.json2blob(t), 'application/json');
    this.state.teams[t.id] = {
      folderId: (await folderFor()).id, folderName: teamFolder.name || plan.folderName, fileId: r.id, modifiedTime: r.modifiedTime || '',
      setupPrint: Model.setupPrint(t), lastSync: Date.now(),
    };
    this.state.roles[t.id] = true;
    await this.save();
    return { sent: plan.uploads.length };
  },

  /* Publishing the common library (Diamond DJ Admin): every common song and music category on this device. */
  async publishCommonPlan(say = () => {}) {
    const remote = await this.scan(say);
    if (!remote.editor) throw new Error('drive:noteditor');
    const uploads = [], notOnDevice = [];
    for (const s of library.songs) await this.consider(uploads, notOnDevice, s.path, Model.fileName(s.path), remote.songFiles.get(Model.fileName(s.path)), 'songs');
    const st = this.state.library;
    const since = !!(remote.libFile && st && st.modifiedTime && st.modifiedTime !== remote.libFile.modifiedTime);
    const removed = remote.libData ? remote.libData.songs.filter(s => !Model.findSong(library, s.id)) : [];
    return { kind: 'common', remote, uploads, notOnDevice, since, removed, firstTime: !remote.libFile, bytes: uploads.reduce((n, u) => n + u.size, 0) };
  },

  async publishCommon(plan, { say = () => {}, meter = () => {} } = {}) {
    const { remote } = plan;
    let songs = remote.songsFolder;
    await this.sendFiles(plan.uploads, { songs: async () => songs || (songs = await this.createFolder(DRIVE.songsFolder, remote.root.id)) }, { say, meter, bytes: plan.bytes });
    say('Sending the common library…');
    const r = remote.libFile ? await this.replace(remote.libFile.id, this.json2blob(library), 'application/json')
      : await this.uploadNew(DRIVE.libraryFile, remote.root.id, this.json2blob(library), 'application/json');
    this.state.library = { fileId: r.id, modifiedTime: r.modifiedTime || '', print: Model.fingerprint(library), lastSync: Date.now() };
    await this.save();
    return { sent: plan.uploads.length };
  },

  /* Has this device changed the common library since it last synced? */
  commonEdits() {
    const st = this.state.library;
    return st && st.print ? Model.fingerprint(library) !== st.print : null;
  },

  /* Has this device changed the team since it last synced (or never synced it)? */
  localEdits(t) {
    const st = this.state.teams[t.id];
    return st ? Model.setupPrint(t) !== st.setupPrint : null;
  },
};

function mb(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB'; }

/* Plain words for what went wrong. */
function driveError(e) {
  const m = String(e && e.message || e);
  if (m === 'drive:offline') return 'No internet connection. Try again on wifi.';
  if (m === 'drive:signin') return 'Google sign-in has expired. Tap the button again to sign in.';
  if (m === 'drive:noteditor') return 'This Google account can view the team folder but not change it. Ask the organizer for Editor access.';
  if (/^drive:404/.test(m)) return 'The team’s Google Drive folder wasn’t found. Check that it’s shared with this Google account.';
  if (/^drive:403/.test(m)) return 'Google says this account can’t open the team folder. Ask the organizer to share it with you.';
  if (/^drive:(429|5\d\d)/.test(m)) return 'Google Drive is busy. Wait a minute and try again.';
  console.warn(e);
  return 'Something went wrong talking to Google Drive. Try again.';
}
