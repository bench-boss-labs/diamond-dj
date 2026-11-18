/* Diamond DJ: the data model and the rules that don't touch the screen or the speakers.
 * Pure functions only, so they run in the browser and in Node tests (tests/model.test.js).
 *
 * Two kinds of songs (version 0.8):
 *   the common library, run by the Diamond DJ Admin, for every team:
 *     library { format:'diamond-library', version:3, songs[] (common songs), categories[] (music categories) }
 *     category { id, name, color:'#rrggbb', songIds[] (common songs in it) }
 *   each team's own, run by its team organizers:
 *     team { format:'diamond-team', version:4, id, name, short, players[], lineups[],
 *            songs[] (team songs), music:{ categoryId: [songId] } (songs the team adds), hiddenCats:[categoryId] }
 * player  { id, first, last, number, active, intro:{path}|null, songId|null, entry:'under'|'after' }
 * lineup  { id, name, order:[playerId], bench:[playerId], updated }
 * song    { id, path, title, artist, length, start, stop, fadeOut, volume, categories[] }
 * Paths on the device: common songs "Songs/<file>", team songs "Teams/<teamId>/<file>",
 * announcements "Announcements/<file>". Functions that look songs up take a pool { songs[] }:
 * the library, or poolFor(library, team) for the common songs plus that team's.
 */
'use strict';

(function (root) {
  const FORMAT_TEAM = 'diamond-team';
  const FORMAT_LIBRARY = 'diamond-library';

  let idCounter = 0;
  function uid(prefix) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${rand}${(idCounter++).toString(36)}`;
  }

  /* ------------------------------------------------------------ teams and players */

  function newTeam(name, short) {
    const team = { format: FORMAT_TEAM, version: 4, id: uid('t'), name, short: short || name, players: [], lineups: [], songs: [], music: {}, hiddenCats: [],
      colors: { main: null, accent: null }, logo: null };
    team.lineups.push(newLineup('Default'));
    return team;
  }

  /* ------------------------------------------------------------ music categories (0.8)
     The common library has the categories (Warm-up, Pitchers…) and their common songs; a team adds
     its own songs to a category (team.music) and can hide a category it doesn't use. */

  const CAT_COLORS = ['#1E56B8', '#0B2447', '#F5B700', '#2E7D46', '#B42318', '#6B3FA0', '#E8702A', '#0E7C86'];
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));

  function newCategory(fields = {}) {
    return {
      id: fields.id || uid('c'),
      name: String(fields.name || 'New category'),
      color: hexOk(fields.color) ? fields.color : CAT_COLORS[0],
      songIds: Array.isArray(fields.songIds) ? fields.songIds.map(String) : [],
    };
  }

  function defaultCategories() {
    return [['c_warmup', 'Warm-up', '#1E56B8'], ['c_pitchers', 'Pitchers', '#0B2447'], ['c_crowd', 'Crowd favourites', '#F5B700'], ['c_postgame', 'Post-game celebrations', '#2E7D46']]
      .map(([id, name, color]) => newCategory({ id, name, color }));
  }

  function removeSongEverywhere(team, songId) {
    for (const p of team.players) if (p.songId === songId) p.songId = null;
    for (const k of Object.keys(team.music || {})) team.music[k] = team.music[k].filter(id => id !== songId);
  }

  /* The categories a team's Game screen shows (not hidden), each with the common songs then the
     team's own. Copies; common: how many of songIds are common songs. */
  function gameMusic(library, team) {
    const hidden = new Set(team.hiddenCats || []);
    return (library.categories || []).filter(c => !hidden.has(c.id)).map(c => {
      const mine = ((team.music || {})[c.id] || []).filter(id => !c.songIds.includes(id));
      return { ...c, songIds: [...c.songIds, ...mine], common: c.songIds.length };
    });
  }

  /* The songs a team can use: the common library's and its own. */
  function poolFor(library, team) { return { songs: (library.songs || []).concat((team && team.songs) || []) }; }

  /* Shuffle: a song from the category not played yet this game (all of them once each has played).
     state: { played: [songId] } (kept on the device, cleared by New game). rand: 0..1 (tests pass their own). */
  function pickShuffle(category, pool, state, rand = Math.random) {
    const ids = category.songIds.filter(id => findSong(pool, id));
    if (!ids.length) return null;
    const played = new Set(state.played || []);
    let left = ids.filter(id => !played.has(id));
    if (!left.length) left = ids;
    return left[Math.min(left.length - 1, Math.floor(rand() * left.length))];
  }

  function notePlayed(state, songId) {
    state.played = state.played || [];
    if (!state.played.includes(songId)) state.played.push(songId);
    return state;
  }

  /* The playback window for a song: its start point to its stop point,
     or to the end of the song when it has no stop point. */
  function clipOf(song) {
    const start = Math.max(0, song.start || 0);
    const stop = song.stop != null && song.stop > start ? song.stop : null;
    const end = stop ?? (song.length || null);
    return { path: song.path, start, stop, fadeOut: song.fadeOut ?? 2, volume: song.volume ?? 1, length: end != null ? end - start : null };
  }

  function newPlayer(fields = {}) {
    return {
      id: uid('p'),
      first: (fields.first || '').trim(),
      last: (fields.last || '').trim(),
      number: String(fields.number ?? '').trim(),
      active: fields.active !== false,
      intro: fields.intro || null,
      songId: fields.songId || null,
      entry: fields.entry === 'after' ? 'after' : 'under',
      clip: cleanClip(fields.clip),
    };
  }
  // this player's own part of the walk-up song (0.9): { start, stop|null } in seconds, or null for the song's own
  function cleanClip(c) {
    if (!c || typeof c !== 'object' || !isFinite(+c.start)) return null;
    const start = Math.max(0, +c.start);
    const stop = c.stop != null && isFinite(+c.stop) && +c.stop > start ? +c.stop : null;
    return { start, stop };
  }

  /* ------------------------------------------------------------ the team's look (0.9)
     colors.main is the header behind the team's name; the logo is a small picture kept in the team file. */
  const TEAM_COLORS = ['#0B2447', '#1E56B8', '#B42318', '#2E7D46', '#6B3FA0', '#E8702A', '#0E7C86', '#111111', '#F5B700', '#FFFFFF'];
  function cleanLook(t) {
    const c = t.colors && typeof t.colors === 'object' ? t.colors : {};
    t.colors = { main: hexOk(c.main) ? c.main.toUpperCase() : null, accent: hexOk(c.accent) ? c.accent.toUpperCase() : null };
    t.logo = typeof t.logo === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(t.logo) && t.logo.length < 400000 ? t.logo : null;
  }
  // dark writing on a light colour, light writing on a dark one
  function isLight(hex) {
    if (!hexOk(hex)) return false;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
  }

  function playerName(p) {
    return [p.first, p.last].filter(Boolean).join(' ') || 'New player';
  }

  // jersey numbers sort as numbers ("2" before "12"); blanks last
  function byNumber(a, b) {
    const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
    const ia = isNaN(na), ib = isNaN(nb);
    if (ia !== ib) return ia ? 1 : -1;
    if (!ia && na !== nb) return na - nb;
    return playerName(a).localeCompare(playerName(b));
  }

  /* Ready = has a walk-up song that exists and an announcement. */
  function playerStatus(player, library) {
    const song = player.songId ? findSong(library, player.songId) : null;
    const hasSong = !!song, hasIntro = !!(player.intro && player.intro.path);
    if (hasSong && hasIntro) return 'ready';
    if (hasSong) return 'no-intro';
    if (hasIntro) return 'no-song';
    return 'not-ready';
  }

  function addPlayer(team, fields) {
    const p = newPlayer(fields);
    team.players.push(p);
    syncLineups(team);
    return p;
  }

  function removePlayer(team, playerId) {
    team.players = team.players.filter(p => p.id !== playerId);
    syncLineups(team);
  }

  /* ------------------------------------------------------------ lineups */

  function newLineup(name, order = [], bench = []) {
    return { id: uid('l'), name: name || 'Lineup', order: [...order], bench: [...bench], updated: Date.now() };
  }

  /* Keeps every lineup consistent with the roster:
     - removed players disappear;
     - inactive players move to the bench;
     - players a lineup has never seen join the end of its order (inactive ones, its bench);
       an empty lineup is filled by jersey number. */
  function syncLineups(team) {
    const byId = new Map(team.players.map(p => [p.id, p]));
    const active = team.players.filter(p => p.active).sort(byNumber).map(p => p.id);
    for (const l of team.lineups) {
      const before = JSON.stringify([l.order, l.bench]);
      const seen = new Set();
      l.order = l.order.filter(id => byId.has(id) && !seen.has(id) && seen.add(id));
      l.bench = l.bench.filter(id => byId.has(id) && !seen.has(id) && seen.add(id));
      const inactive = l.order.filter(id => !byId.get(id).active);
      l.order = l.order.filter(id => byId.get(id).active);
      l.bench.push(...inactive);
      const missing = team.players.filter(p => !seen.has(p.id)).sort(byNumber).map(p => p.id);
      // youth teams bat everyone: new active players join the end of the order, ready to bat
      l.order.push(...missing.filter(id => active.includes(id)));
      l.bench.push(...missing.filter(id => !active.includes(id)));
      if (JSON.stringify([l.order, l.bench]) !== before) l.updated = Date.now();
    }
    if (team.lineups.length === 0) {
      team.lineups.push(newLineup('Default', active, team.players.filter(p => !p.active).map(p => p.id)));
    }
    return team;
  }

  function findLineup(team, id) {
    return team.lineups.find(l => l.id === id) || team.lineups[0] || null;
  }

  function duplicateLineup(team, id, name) {
    const src = findLineup(team, id);
    const copy = newLineup(name || `${src.name} copy`, src.order, src.bench);
    team.lineups.splice(team.lineups.indexOf(src) + 1, 0, copy);
    return copy;
  }

  function addLineup(team, name) {
    const l = newLineup(name || `Lineup ${team.lineups.length + 1}`);
    team.lineups.push(l);
    syncLineups(team); // fills the order with active players by number
    return l;
  }

  function removeLineup(team, id) {
    if (team.lineups.length <= 1) return false; // always keep one
    team.lineups = team.lineups.filter(l => l.id !== id);
    return true;
  }

  function touch(l) { l.updated = Date.now(); return l; }

  function moveInOrder(lineup, playerId, toIndex) {
    const from = lineup.order.indexOf(playerId);
    if (from < 0) return false;
    const to = Math.max(0, Math.min(lineup.order.length - 1, toIndex));
    if (from === to) return false;
    lineup.order.splice(from, 1);
    lineup.order.splice(to, 0, playerId);
    touch(lineup);
    return true;
  }

  function moveBy(lineup, playerId, delta) {
    const i = lineup.order.indexOf(playerId);
    return i >= 0 && moveInOrder(lineup, playerId, i + delta);
  }

  function benchPlayer(lineup, playerId) {
    const i = lineup.order.indexOf(playerId);
    if (i < 0) return false;
    lineup.order.splice(i, 1);
    if (!lineup.bench.includes(playerId)) lineup.bench.push(playerId);
    touch(lineup);
    return true;
  }

  function unbenchPlayer(lineup, playerId) {
    const i = lineup.bench.indexOf(playerId);
    if (i < 0) return false;
    lineup.bench.splice(i, 1);
    lineup.order.push(playerId);
    touch(lineup);
    return true;
  }

  /* ------------------------------------------------------------ batting order (auto-advance) */

  /* Who is up next. `upNext` is a player id kept on the device. If that player is no longer
     batting (benched or removed), the batter who was after them takes over: we can't know
     that any more, so fall back to the top of the order. */
  function upNextId(lineup, upNext) {
    if (!lineup || lineup.order.length === 0) return null;
    return lineup.order.includes(upNext) ? upNext : lineup.order[0];
  }

  function nextAfter(lineup, playerId) {
    if (!lineup || lineup.order.length === 0) return null;
    const i = lineup.order.indexOf(playerId);
    if (i < 0) return lineup.order[0];
    return lineup.order[(i + 1) % lineup.order.length];
  }

  /* The batters after `upNext`, in order, wrapping round, not repeating `upNext`. */
  function comingUp(lineup, upNext) {
    const first = upNextId(lineup, upNext);
    if (!first) return [];
    const i = lineup.order.indexOf(first);
    return [...lineup.order.slice(i + 1), ...lineup.order.slice(0, i)];
  }

  function battingSlot(lineup, playerId) {
    const i = lineup ? lineup.order.indexOf(playerId) : -1;
    return i < 0 ? null : i + 1;
  }

  /* ------------------------------------------------------------ library */

  function newLibrary() { return { format: FORMAT_LIBRARY, version: 3, songs: [], categories: defaultCategories() }; }

  function findSong(library, id) { return library.songs.find(s => s.id === id) || null; }

  function songFromFile(path, fields = {}) {
    const base = path.split('/').pop().replace(/\.[^.]+$/, '');
    // "Title - Artist" is the common way people name walk-up files
    const parts = base.split(/\s+-\s+/);
    return {
      id: uid('s'),
      path,
      title: fields.title || parts[0].trim() || base,
      artist: fields.artist ?? (parts.length > 1 ? parts.slice(1).join(' - ').trim() : ''),
      length: fields.length || 0,
      start: 0,
      stop: null,
      fadeOut: 2,
      volume: 1,
      categories: [],
    };
  }

  function songLabel(song) {
    return song ? [song.title, song.artist].filter(Boolean).join(' · ') : '';
  }

  function songsUsing(team, songId) {
    return team.players.filter(p => p.songId === songId);
  }

  /* ------------------------------------------------------------ the walk-up plan */

  /* Everything the audio engine needs to play one walk-up, worked out ahead of time.
     settings: { walkupSeconds, duckLevel, riseSeconds } */
  function walkupPlan(player, library, settings) {
    const song = player.songId ? findSong(library, player.songId) : null;
    const intro = player.intro && player.intro.path ? player.intro : null;
    if (!song && !intro) return null;
    let songPart = null;
    if (song) {
      const own = cleanClip(player.clip);
      const start = own ? own.start : Math.max(0, song.start || 0);
      let stop = own ? (own.stop ?? start + settings.walkupSeconds) : song.stop != null && song.stop > start ? song.stop : start + settings.walkupSeconds;
      if (song.length && stop > song.length) stop = song.length;
      songPart = {
        songId: song.id,
        path: song.path,
        start,
        stop,
        fadeOut: Math.max(0, Math.min(song.fadeOut ?? 2, stop - start)),
        volume: song.volume ?? 1,
      };
    }
    const under = !!(intro && songPart && player.entry !== 'after');
    return {
      playerId: player.id,
      intro: intro ? { path: intro.path } : null,
      song: songPart,
      mode: !intro ? 'song' : !songPart ? 'intro' : under ? 'under' : 'after',
      duckLevel: under ? settings.duckLevel : 1,
      riseSeconds: settings.riseSeconds,
    };
  }

  /* ------------------------------------------------------------ files: backup and checks */

  function checkTeam(obj) {
    if (!obj || obj.format !== FORMAT_TEAM || !Array.isArray(obj.players) || !Array.isArray(obj.lineups)) {
      throw new Error('This isn’t a Diamond DJ team file.');
    }
    obj.songs = Array.isArray(obj.songs) ? obj.songs.filter(s => s && s.id && s.path).map(s => ({ ...songFromFile(s.path), ...s })) : [];
    // version 4 (0.8): key moments are gone; songs the team adds to music categories, categories it hides
    const ids = v => (Array.isArray(v) ? v.map(String) : []);
    obj.music = obj.music && typeof obj.music === 'object' ? Object.fromEntries(Object.entries(obj.music).map(([k, v]) => [k, ids(v)])) : {};
    obj.hiddenCats = ids(obj.hiddenCats);
    delete obj.moments; delete obj.hidden; delete obj.extra;
    obj.version = 4;
    cleanLook(obj);
    obj.players = obj.players.map(p => ({ ...newPlayer(p), id: String(p.id || uid('p')) }));
    obj.lineups = obj.lineups.map(l => ({
      id: String(l.id || uid('l')), name: String(l.name || 'Lineup'),
      order: Array.isArray(l.order) ? l.order.map(String) : [],
      bench: Array.isArray(l.bench) ? l.bench.map(String) : [],
      updated: Number(l.updated) || Date.now(),
    }));
    syncLineups(obj);
    return obj;
  }

  function checkLibrary(obj) {
    if (!obj || obj.format !== FORMAT_LIBRARY || !Array.isArray(obj.songs)) {
      throw new Error('This isn’t a Diamond DJ song library.');
    }
    obj.songs = obj.songs.filter(s => s && s.id && s.path).map(s => ({ ...songFromFile(s.path), ...s }));
    // version 3 (0.8): music categories instead of key moments
    obj.categories = Array.isArray(obj.categories) ? obj.categories.map(newCategory) : defaultCategories();
    delete obj.moments;
    obj.version = 3;
    return obj;
  }

  /* ------------------------------------------------------------ Google Drive: what syncs and how it merges */

  /* The part of a team the organizer publishes and an update replaces: name, roster, moments.
     Lineups are separate: they belong to whoever is running the game. */
  function setupOf(team) {
    return { name: team.name, short: team.short, players: team.players, songs: team.songs, music: team.music, hiddenCats: team.hiddenCats,
      colors: team.colors, logo: team.logo };
  }
  // a short fingerprint, to tell whether a device changed the setup since it last synced
  function fingerprint(obj) {
    const s = JSON.stringify(obj);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  const setupPrint = team => fingerprint(setupOf(team));
  function libraryPrint(library, songIds) {
    const ids = [...songIds].sort();
    return fingerprint(ids.map(id => findSong(library, id)).filter(Boolean));
  }

  /* Every song a team uses: walk-ups, its team songs and music, and (given the library) the categories it shows. */
  function teamSongIds(team, library) {
    const ids = new Set();
    for (const p of team.players) if (p.songId) ids.add(p.songId);
    if (library) for (const c of gameMusic(library, team)) for (const id of c.songIds) ids.add(id);
    for (const v of Object.values(team.music || {})) for (const id of v) ids.add(id);
    for (const s of team.songs || []) ids.add(s.id);
    return ids;
  }

  /* An update from Drive meets this device's copy of the team.
     - keepSetup false: roster, moments and name come from Drive; true: this device's stay.
     - lineups: Drive's lineups are added; a lineup this device changed since `lastSync` is kept as
       it is; otherwise Drive's version replaces it only if Drive's is newer; this device's own
       lineups stay.
     The result's lineups are made consistent with its roster. */
  function mergeTeam(local, remote, { lastSync = 0, keepSetup = false } = {}) {
    if (!local) return checkTeam(JSON.parse(JSON.stringify(remote)));
    const base = keepSetup ? local : remote;
    const out = JSON.parse(JSON.stringify({ ...base, id: local.id || remote.id }));
    const lineups = local.lineups.map(l => ({ ...l, order: [...l.order], bench: [...l.bench] }));
    for (const r of remote.lineups || []) {
      const i = lineups.findIndex(l => l.id === r.id);
      if (i < 0) lineups.push({ ...r, order: [...r.order], bench: [...r.bench] });
      // kept if this device changed it since the last sync; otherwise Drive's wins only if it's newer
      else if (!(lineups[i].updated > lastSync) && r.updated > lineups[i].updated) lineups[i] = { ...r, order: [...r.order], bench: [...r.bench] };
    }
    out.lineups = lineups;
    return checkTeam(out);
  }

  /* Songs from Drive's library replace this device's copy of the same song (unless keepLocal);
     songs only this device has stay. */
  function mergeLibrary(local, remote, { keepLocal = false } = {}) {
    const out = newLibrary();
    const byId = new Map();
    for (const s of remote.songs || []) byId.set(s.id, s);
    for (const s of local.songs || []) if (!byId.has(s.id) || keepLocal) byId.set(s.id, s);
    out.songs = [...byId.values()].map(s => ({ ...s }));
    out.categories = JSON.parse(JSON.stringify(keepLocal || !Array.isArray(remote.categories) ? (local.categories || []) : remote.categories));
    return checkLibrary(out);
  }

  /* Common songs a team uses that the published library doesn't have yet. */
  function commonSongsMissing(team, local, remote) {
    const have = new Set((remote && remote.songs || []).map(s => s.id));
    return [...teamSongIds(team, local)].map(id => findSong(local, id)).filter(s => s && !have.has(s.id));
  }

  /* Where a file on this device lives in the Drive folder. */
  function drivePathFor(localPath, teamFolderName) {
    if (localPath.startsWith('Songs/')) return 'Common Songs/' + localPath.slice(6);
    if (localPath.startsWith('Teams/')) return `${teamFolderName}/Team Songs/${localPath.split('/').slice(2).join('/')}`;
    if (localPath.startsWith('Announcements/')) return `${teamFolderName}/${localPath}`;
    return null;
  }
  const fileName = path => path.split('/').pop();

  /* Who has what, from Google Drive sharing (0.9).
     rootPerms: the Diamond DJ folder's sharing; teams: [{ id, name, folderId, perms }] for each team folder.
     Sharing on the Diamond DJ folder reaches everything inside it, so:
       Editor of the Diamond DJ folder = Diamond DJ Admin
       Viewer of the Diamond DJ folder = can get the common songs and every team (volunteers)
       Editor of a team's folder (and not an Admin) = that team's organizer
     Also: people on a team folder who aren't on the Diamond DJ folder (they can't get the common
     songs), and "anyone with the link" sharing, which should be off. */
  const EDIT_ROLES = ['owner', 'organizer', 'fileOrganizer', 'writer'];
  function accessFrom(rootPerms, teams) {
    const person = p => p.type === 'user' || p.type === 'group';
    const email = p => String(p.emailAddress || '').toLowerCase();
    const edits = p => EDIT_ROLES.includes(p.role);
    const root = (rootPerms || []).filter(person);
    const onRoot = new Map(root.map(p => [email(p), p]));
    const open = (rootPerms || []).filter(p => p.type === 'anyone' || p.type === 'domain').map(perm => ({ where: null, perm }));
    const rootIds = new Set((rootPerms || []).map(p => p.id));
    const out = (teams || []).map(t => {
      const perms = t.perms || [];
      for (const perm of perms) if ((perm.type === 'anyone' || perm.type === 'domain') && !rootIds.has(perm.id)) open.push({ where: t.id, perm });
      const organizers = perms.filter(p => person(p) && edits(p) && !(onRoot.has(email(p)) && edits(onRoot.get(email(p)))));
      const viewersOnly = perms.filter(p => person(p) && !edits(p) && !onRoot.has(email(p)));
      const noCommon = organizers.concat(viewersOnly).filter(p => !onRoot.has(email(p)));
      return { id: t.id, name: t.name, folderId: t.folderId, organizers, viewersOnly, noCommon };
    });
    return { admins: root.filter(edits), viewers: root.filter(p => !edits(p)), teams: out, open };
  }
  const emailOk = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(String(e || '').trim());

  const teamSongPath = (teamId, name) => `Teams/${teamId}/${name}`;

  const api = {
    uid, newTeam, newPlayer, playerName, byNumber, playerStatus, addPlayer, removePlayer,
    newLineup, syncLineups, findLineup, duplicateLineup, addLineup, removeLineup,
    moveInOrder, moveBy, benchPlayer, unbenchPlayer,
    upNextId, nextAfter, comingUp, battingSlot,
    newLibrary, findSong, songFromFile, songLabel, songsUsing,
    walkupPlan, checkTeam, checkLibrary,
    CAT_COLORS, newCategory, defaultCategories, removeSongEverywhere, pickShuffle, notePlayed, clipOf,
    setupOf, fingerprint, setupPrint, libraryPrint, teamSongIds, mergeTeam, mergeLibrary, commonSongsMissing, drivePathFor,
    gameMusic, poolFor, fileName, teamSongPath,
    TEAM_COLORS, cleanLook, isLight, cleanClip, accessFrom, emailOk,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof self !== 'undefined' ? self : this);
