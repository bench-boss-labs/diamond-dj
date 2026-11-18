/* Diamond DJ: the screens.
 *
 * Sections (search for the ==== banners):
 *   1. STATE AND SAVING
 *   2. HELPERS
 *   3. GAME
 *   4. LINEUP (and the order editor used on Game › Edit order)
 *   5. ROSTER
 *   6. SONGS AND THE CLIP EDITOR
 *   7. SETTINGS, DEMO, BACKUP
 *   8. NOW PLAYING
 *   9. EVENTS AND STARTUP
 *  10. MUSIC (colour-coded categories on Game; set up in Team setup › Music and Admin › Music)
 *  11. LOCK
 *  12. HELP, INSTALL, UPDATES (release notes, install button, new-version messages)
 */
'use strict';

/* ==================================================================== 1. STATE AND SAVING */

const DEFAULTS = {
  fadeSeconds: 2.5,    // Fade out, and what a new sound does to the one playing
  walkupSeconds: 15,   // walk-up length when a song has no stop point
  duckLevel: 0.25,     // song volume under the announcement
  riseSeconds: 1,      // how fast the song comes up when the announcement ends
  playlistXfade: 4,    // overlap between songs in a playlist
  layerSeconds: 5,     // clips shorter than this (sound effects) play over the music
  masterVolume: 1,
  locked: false,       // Lock: hides setup screens and settings on this device
  viewAs: null,        // Diamond DJ Admin trying another role's screens: 'organizer' | 'volunteer'
  openGroup: 'updates', // the Settings group left open last time
};

let teams = {};          // every team on this device, by id
let team = null;         // the team in use (one of `teams`)
let library = null;      // Model library: songs shared by every team on this device
// game state per team on this device: lineup in use, who's up next, songs played this game
const newGameState = () => ({ lineupId: null, upNext: null, lastPlayed: null, played: [], cursors: {} });
let games = {};
let game = newGameState();
let settings = { ...DEFAULTS };
const stored = new Set(); // paths of audio files on this device

const ui = { view: 'game', playerId: null, songId: null, lineupId: null, songQuery: '', gameTab: 'walkups', catId: null,
  phoneDetail: false, showAllBatters: false };
const TEAM_VIEWS = ['roster', 'songs', 'music', 'teaminfo', 'publish'];   // the Team screen (team organizers)
const ADMIN_VIEWS = ['csongs', 'cmusic', 'cpublish'];                         // the Admin screen (Diamond DJ Admin)
const SETUP_VIEWS = TEAM_VIEWS.concat(ADMIN_VIEWS);
// Songs and Music show the team's own on the Team screen, the common library's on the Admin screen
const commonScope = () => ADMIN_VIEWS.includes(ui.view);

const timers = {};
function later(key, fn, ms = 300) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
const SAVERS = {
  team: () => Store.set('teams', teams).then(() => Store.set('currentTeam', team.id)),
  library: () => Store.set('library', library),
  game: () => { games[team.id] = game; return Store.set('games', games); },
  settings: () => Store.set('settings', settings),
};
const saveTeam = () => later('team', () => SAVERS.team().catch(saveFailed));
const saveLibrary = () => later('library', () => SAVERS.library().catch(saveFailed));
const saveGame = () => later('game', () => SAVERS.game().catch(saveFailed));
const saveSettings = () => later('settings', () => SAVERS.settings().catch(saveFailed));
// save anything waiting, now (before leaving the page for Google's sign-in)
async function saveNow() {
  for (const k of Object.keys(SAVERS)) clearTimeout(timers[k]);
  await Promise.all(Object.values(SAVERS).map(f => f().catch(() => {})));
}

/* Switch the device to another team: its roster, lineups, music and game state. */
function useTeam(id) {
  if (!teams[id]) return;
  if (team) games[team.id] = game;
  team = teams[id];
  game = { ...newGameState(), ...(games[id] || {}) };
  if (!Model.findLineup(team, game.lineupId)) game.lineupId = team.lineups[0].id;
  ui.playerId = ui.catId = ui.lineupId = null;
  saveTeam(); saveGame();
}
function addTeam(t, { use = true } = {}) {
  teams[t.id] = t;
  if (use) useTeam(t.id);
  saveTeam();
  return t;
}
function saveFailed(e) { console.error(e); toast('Couldn’t save on this device. Check the storage space.'); }

function lineup() {
  const l = Model.findLineup(team, game.lineupId);
  if (l && game.lineupId !== l.id) game.lineupId = l.id;
  return l;
}
const player = id => team.players.find(p => p.id === id) || null;
const pool = () => Model.poolFor(library, team);   // the songs this team can use: common and its own
const song = id => (id ? Model.findSong(pool(), id) : null);
const songsHere = () => (commonScope() ? library.songs : team.songs);
const gameCats = () => Model.gameMusic(library, team);
const saveBoth = () => { saveLibrary(); saveTeam(); };

/* Roles, from Google Drive sharing (read at Check for updates):
   admin: can change the Diamond DJ folder · organizer: can change this team's folder · volunteer: can only view.
   A device that has never checked Drive, and a team made on this device, can be set up here.
   The Diamond DJ Admin can "view as" a team organizer or volunteer to try their screens. */
const RANK = { volunteer: 0, organizer: 1, admin: 2 };
function realRole(t = team) {
  if (!Drive.state.lastCheck || Drive.state.editor) return 'admin';
  if (!Drive.state.teams[t.id] || Drive.state.roles[t.id]) return 'organizer';
  return 'volunteer';
}
function role(t = team) {
  const r = realRole(t), v = settings.viewAs;
  return v && RANK[v] < RANK[r] ? v : r;
}
const ROLE_NAME = { admin: 'Diamond DJ Admin', organizer: 'Team organizer', volunteer: 'Volunteer' };
const canTeam = () => RANK[role()] >= 1;
const canAdmin = () => role() === 'admin';

/* ==================================================================== 2. HELPERS */

const $ = sel => document.querySelector(sel);
const main = $('#main');

/* Phones get their own layouts (narrow screens); tablets and computers keep the side-by-side ones. */
const phoneQuery = matchMedia('(max-width: 640px)');
const phone = () => phoneQuery.matches;
// on a phone, list screens (Roster, Songs, Music) show the list, or one item full screen
const BACK_LABEL = { roster: 'Roster', songs: 'Team songs', music: 'Music', csongs: 'Common songs', cmusic: 'Music categories' };
function backBar(title) {
  return `<div class="phone-back"><button class="back-btn" data-act="phone-back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>${BACK_LABEL[ui.view]}</button>
    <span class="back-title">${esc(title)}</span></div>`;
}
const listMode = () => (phone() && !ui.phoneDetail ? 'phone-list' : 'phone-detail');

/* A short menu of actions (phones use these instead of rows of buttons). */
function openMenu(title, items) {
  openDialog(title, `<div class="list menu">${items.map((it, i) => it ? `<button class="btn big ${it.cls || ''}" data-menu="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>` : '').join('')}</div>`);
  $('#dlgBody').onclick = e => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const it = items[+b.dataset.menu];
    if (it.keepOpen) return it.run(b);
    dlgOnClose = () => it.run(b); // after the menu has closed, so a follow-up dialog can open
    closeDialog();
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mmss(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
const secs = t => (t == null ? '' : (Math.round(t * 10) / 10).toFixed(1));
function clipText(s) {
  if (!s) return '';
  const end = s.stop != null && s.stop > s.start ? s.stop : null;
  return end != null ? `${mmss(s.start)}–${mmss(end)}` : `from ${mmss(s.start)} for ${settings.walkupSeconds} s`;
}
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  later('toast', () => { t.hidden = true; }, ms);
}
const PLAY_ICON = '<svg class="play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/></svg>';
const STATUS_TEXT = { 'ready': 'Ready', 'no-intro': 'No announcement', 'no-song': 'No song', 'not-ready': 'Not ready' };

/* "Tap again to confirm" buttons: no pop-ups for volunteers. */
function armed(btn, label = 'Tap again to confirm') {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; } }, 3500);
  return false;
}

/* The one dialog, reused for settings, pickers, the order editor and questions. */
const dlg = $('#dlg');
let dlgOnClose = null;
function openDialog(title, html, onClose = null) {
  $('#dlgBody').onclick = null; // a dialog's own click handler (Teams) never outlives it
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = html;
  dlgOnClose = onClose;
  if (!dlg.open) dlg.showModal();
}
function closeDialog() { if (dlg.open) dlg.close(); }
dlg.addEventListener('close', () => { const f = dlgOnClose; dlgOnClose = null; if (f) f(); });
$('#dlgClose').addEventListener('click', closeDialog);

function askText(title, label, value, okLabel = 'Save') {
  return new Promise(resolve => {
    let answer = null;
    openDialog(title, `
      <label class="field">${esc(label)}<input type="text" id="askInput" value="${esc(value)}" autocomplete="off"></label>
      <div class="row"><button class="btn primary" id="askOk">${esc(okLabel)}</button><button class="btn" id="askCancel">Cancel</button></div>`,
      () => resolve(answer));
    const input = $('#askInput');
    input.focus(); input.select();
    const ok = () => { answer = input.value.trim(); closeDialog(); };
    $('#askOk').onclick = ok;
    input.onkeydown = e => { if (e.key === 'Enter') ok(); };
    $('#askCancel').onclick = closeDialog;
  });
}

async function storeFile(path, blob) {
  await Store.audio.put(path, blob);
  stored.add(path);
  Sound.forget(path);
}
async function dropFileIfUnused(path) {
  if (!path) return;
  const used = library.songs.some(s => s.path === path) || Object.values(teams).some(t => t.songs.some(s => s.path === path) || t.players.some(p => p.intro && p.intro.path === path));
  if (used) return;
  await Store.audio.remove(path).catch(() => {});
  stored.delete(path);
  Sound.forget(path);
}
const safeName = name => name.replace(/[\\/:*?"<>|]+/g, '_').slice(-120);

/* ==================================================================== 3. GAME */

function batterTags(l) {
  const first = Model.upNextId(l, game.upNext);
  const coming = Model.comingUp(l, game.upNext);
  const tags = new Map();
  if (first) tags.set(first, 'Up next');
  if (coming[0]) tags.set(coming[0], 'On deck');
  if (coming[1]) tags.set(coming[1], 'In the hole');
  return { first, tags };
}

function playingPlayerId() {
  const t = Sound.playing().find(t => t.kind === 'walkup' || t.kind === 'intro');
  return t && t.state === 'playing' ? t.playerId : null;
}

function renderGame() {
  const tabs = [['walkups', 'Walk-ups'], ['music', 'Music']]
    .map(([k, label]) => `<button data-act="game-tab" data-tab="${k}" aria-pressed="${ui.gameTab === k}">${label}</button>`).join('');
  main.innerHTML = `<div class="game-wrap" data-tab="${ui.gameTab}">
    <div class="seg phone-tabs" role="group" aria-label="Show">${tabs}</div>
    <div class="cols game-cols">
      <section class="stack" data-gtab="walkups">${walkupsHtml()}</section>
      <section class="stack" data-gtab="music">${musicHtml()}</section>
    </div></div>`;
}

function walkupsHtml() {
  const l = lineup();
  if (!team.players.length) {
    return `<div class="empty"><p><b>No players yet.</b></p><p>Add the team in Roster, or try the app with the demo team.</p>
      <div class="row" style="justify-content:center">${settings.locked || !canTeam() ? '' : '<button class="btn primary" data-act="go" data-view="roster">Set up the roster</button>'}</div></div>`;
  }
  const { first, tags } = batterTags(l);
  const p = player(first);
  const playingId = playingPlayerId();
  const lineupOptions = team.lineups.map(x => `<option value="${esc(x.id)}" ${x.id === l.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

  const card = p ? (() => {
    const s = song(p.songId);
    const meta = s ? `${esc(Model.songLabel(s))} · ${Math.round(Model.walkupPlan(p, pool(), settings).song.stop - Model.walkupPlan(p, pool(), settings).song.start)} s clip` : '<span class="status no-song">No walk-up song</span>';
    const status = Model.playerStatus(p, pool());
    return `<div class="upnext">
      <div class="who"><div class="big-num">${esc(p.number || '–')}</div>
        <div class="stack" style="gap:0">
          <span class="eyebrow">Up next · batting ${Model.battingSlot(l, p.id)}</span>
          <span class="player">${esc(Model.playerName(p))}</span>
          <span class="meta">${meta}${status === 'no-intro' ? ' · <span class="status no-intro">no announcement</span>' : ''}</span>
        </div></div>
      <div class="row"><button class="play-walkup" data-act="walkup" ${status === 'not-ready' ? 'disabled' : ''}>${PLAY_ICON}Play walkup</button>
        <button class="btn skip" data-act="skip">Skip</button></div>
      ${phone() ? '' : '<p class="hint">Plays the announcement, then the song, and moves to the next batter.</p>'}
    </div>`;
  })() : `<div class="empty"><b>Nobody is in the batting order.</b><br>Add players back from the bench in Lineup.</div>`;

  // phones show the next three batters after the card, unless the volunteer asks for all of them
  const compact = phone() && !ui.showAllBatters;
  const shown = compact ? Model.comingUp(l, game.upNext).slice(0, 3) : l.order;
  const rows = shown.map(id => {
    const i = l.order.indexOf(id);
    const q = player(id);
    const s = song(q.songId);
    const status = Model.playerStatus(q, pool());
    const tag = id === playingId ? 'Playing' : (tags.get(id) || '');
    return `<button class="item ${id === first ? 'sel' : ''} ${id === playingId ? 'playing' : ''} ${status === 'not-ready' ? 'not-ready' : ''}" data-act="batter" data-id="${esc(id)}">
      <span class="slot">${i + 1}</span><span class="num">${esc(q.number || '–')}</span>
      <span class="grow"><span class="name">${esc(Model.playerName(q))}</span><span class="sub">${s ? esc(Model.songLabel(s)) : `<span class="status ${status}">${STATUS_TEXT[status]}</span>`}</span></span>
      <span class="tag">${esc(tag)}</span></button>`;
  }).join('');

  return `<div class="row"><span class="section-title">Batting order</span><span class="spacer"></span>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Lineup</span>
          <select id="gameLineup" style="height:40px;font-size:15px;width:auto">${lineupOptions}</select></label></div>
      ${card}
      ${phone() ? '' : `<div class="row"><button class="btn" data-act="edit-order">Edit order</button><button class="btn" data-act="top">Start from batter 1</button>
        <button class="btn" data-act="new-game">New game</button></div>`}
      <div class="list order">${rows}</div>
      ${phone() ? `<div class="row phone-row">
        <button class="btn" data-act="show-batters">${ui.showAllBatters ? 'Show fewer' : `Show all ${l.order.length} batters`}</button>
        <button class="btn" data-act="edit-order">Edit order</button></div>
        ${ui.showAllBatters ? '<div class="row phone-row"><button class="btn" data-act="top">Start from batter 1</button><button class="btn" data-act="new-game">New game</button></div>' : ''}` : ''}
      <p class="hint">Tap a player to play them · press and hold to make them up next${l.bench.length ? `<br>On the bench: ${l.bench.map(id => esc(Model.playerName(player(id)))).join(', ')}` : ''}</p>`;
}

async function playBatter(id) {
  const l = lineup();
  const p = player(id);
  if (!p) return;
  game.upNext = Model.nextAfter(l, id);
  game.lastPlayed = id;
  saveGame();
  const plan = Model.walkupPlan(p, pool(), settings);
  if (!plan) { toast(`${Model.playerName(p)} has no song or announcement yet.`); render(); return; }
  const label = `#${p.number} ${Model.playerName(p)}`.replace(/^# /, '');
  render();
  try {
    await Sound.walkup(plan, label, { playerId: id });
  } catch (e) {
    console.warn(e);
    toast(e && e.message === 'missing' ? `The file for ${Model.playerName(p)} isn’t on this device.` : 'That didn’t play. Try again.');
  }
}

/* ==================================================================== 4. LINEUP */

function orderEditor(l) {
  const first = Model.upNextId(l, game.upNext);
  const usedInGame = l.id === game.lineupId;
  const rows = l.order.map((id, i) => {
    const p = player(id), s = song(p.songId);
    return `<div class="edit-row ${usedInGame && id === first ? 'up' : ''}" data-id="${esc(id)}">
      <button class="handle" data-drag="${esc(id)}" aria-label="Drag to reorder ${esc(Model.playerName(p))}">${GRIP_ICON}</button>
      <span class="slot">${i + 1}</span><span class="num dark">${esc(p.number || '–')}</span>
      <span class="grow"><span class="name">${esc(Model.playerName(p))}</span><span class="sub">${s ? esc(Model.songLabel(s)) : ''}</span></span>
      <button class="btn small square" data-act="lu-up" data-id="${esc(id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small square" data-act="lu-down" data-id="${esc(id)}" aria-label="Move down" ${i === l.order.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small" data-act="lu-bench" data-id="${esc(id)}">Bench</button>
    </div>`;
  }).join('');
  const bench = l.bench.map(id => `<button class="chip" data-act="lu-unbench" data-id="${esc(id)}">#${esc(player(id).number)} ${esc(Model.playerName(player(id)))} · Add back</button>`).join('');
  return `<div class="stack order-wrap" data-lineup="${esc(l.id)}">
    <div class="list order-edit">${rows || '<p class="hint">Nobody is batting. Add players back from the bench.</p>'}</div>
    <div class="bench"><b>Bench today</b>${bench || '<span class="hint">Nobody on the bench.</span>'}</div></div>`;
}

function renderLineup() {
  const l = Model.findLineup(team, ui.lineupId || game.lineupId);
  ui.lineupId = l.id;
  const list = team.lineups.map(x => `<button class="item ${x.id === l.id ? 'sel' : ''}" data-act="lu-pick" data-id="${esc(x.id)}">
      <span class="grow"><span class="name">${esc(x.name)}</span><span class="sub">${x.order.length} batting${x.bench.length ? ` · ${x.bench.length} bench` : ''}</span></span>
      ${x.id === game.lineupId ? '<span class="pill">In use</span>' : ''}</button>`).join('');
  if (phone()) {
    const opts = team.lineups.map(x => `<option value="${esc(x.id)}" ${x.id === l.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    main.innerHTML = `<section class="stack">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-end">
        <label class="field" style="flex:1">Lineup<select id="luSelect">${opts}</select></label>
        <button class="btn square big-menu" data-act="lu-menu" aria-label="More lineup actions">⋯</button></div>
      <div class="row">${l.id === game.lineupId ? '<span class="pill">In use on Game</span>' : '<button class="btn gold small" data-act="lu-use">Use for the game</button>'}
        <span class="hint">Drag ⋮⋮ to reorder</span></div>
      ${team.players.length ? orderEditor(l) : '<div class="empty">Add players in <b>Roster</b> first.</div>'}
    </section>`;
    return;
  }
  main.innerHTML = `<div class="cols lineup-cols">
    <aside class="stack">
      <span class="section-title">Saved lineups</span>
      <div class="list">${list}</div>
      <div class="row"><button class="btn outline" data-act="lu-new">+ New</button><button class="btn" data-act="lu-dup">Duplicate</button></div>
      <p class="hint">Each lineup keeps its own order and bench. Duplicate one for a tournament or a doubleheader.</p>
    </aside>
    <section class="stack">
      <div class="row"><span class="lineup-title">${esc(l.name)}</span>
        ${l.id === game.lineupId ? '<span class="pill">In use on the Game screen</span>' : '<button class="btn gold" data-act="lu-use">Use for the game</button>'}
        <span class="spacer"></span>
        <button class="btn" data-act="lu-rename">Rename</button>
        <button class="btn danger" data-act="lu-delete" ${team.lineups.length < 2 ? 'disabled' : ''}>Delete</button></div>
      <p class="hint">Drag the handle to reorder, or use the arrows. Bench takes a player out for today. Changes save as you go.</p>
      ${team.players.length ? orderEditor(l) : '<div class="empty">Add players in <b>Roster</b> first.</div>'}
    </section></div>`;
}

function lineupFor(el) {
  const box = el.closest('[data-lineup]');
  return Model.findLineup(team, box ? box.dataset.lineup : ui.lineupId);
}
// redraw the rows and bench in place: the list element itself stays, so a drag in progress keeps going
function refreshOrderEditors() {
  for (const wrap of document.querySelectorAll('.order-wrap')) {
    const tmp = document.createElement('div');
    tmp.innerHTML = orderEditor(Model.findLineup(team, wrap.dataset.lineup));
    wrap.querySelector('.order-edit').innerHTML = tmp.querySelector('.order-edit').innerHTML;
    wrap.querySelector('.bench').innerHTML = tmp.querySelector('.bench').innerHTML;
  }
}

/* Drag to reorder: the list captures the pointer, and the dragged player moves to whichever
   row the finger is over. Works with mouse, finger and pen. */
let drag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-drag]');
  if (!h) return;
  const box = h.closest('.order-edit');
  e.preventDefault();
  drag = { id: h.dataset.drag, box, l: lineupFor(box) };
  box.setPointerCapture(e.pointerId);
  box.querySelector(`.edit-row[data-id="${CSS.escape(drag.id)}"]`).classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  const rows = [...drag.box.querySelectorAll('.edit-row')];
  const over = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
  if (!over || over.dataset.id === drag.id) return;
  const to = drag.l.order.indexOf(over.dataset.id);
  if (Model.moveInOrder(drag.l, drag.id, to)) {
    refreshOrderEditors();
    drag.box.querySelector(`.edit-row[data-id="${CSS.escape(drag.id)}"]`).classList.add('dragging');
  }
});
function endDrag() {
  if (!drag) return;
  drag = null;
  saveTeam();
  refreshOrderEditors();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

function openOrderDialog() {
  const l = lineup();
  openDialog(`Edit order · ${l.name}`, `<p class="hint">Drag the handle<span class="wide-only"> or use the arrows</span> to move a batter. Changes save as you go.</p>${orderEditor(l)}`, () => render());
}

function deleteLineup() {
  const wasInUse = ui.lineupId === game.lineupId;
  Model.removeLineup(team, ui.lineupId);
  if (wasInUse) { game.lineupId = team.lineups[0].id; game.upNext = null; saveGame(); }
  ui.lineupId = null; saveTeam(); render();
}

/* ==================================================================== 5. ROSTER */

function rosterList() {
  const players = [...team.players].sort(Model.byNumber);
  return players.map(p => {
    const st = Model.playerStatus(p, pool());
    return `<button class="item ${p.id === ui.playerId ? 'sel' : ''}" data-act="pick-player" data-id="${esc(p.id)}">
      <span class="num">${esc(p.number || '–')}</span>
      <span class="grow"><span class="name">${esc(Model.playerName(p))}</span>${p.active ? '' : '<span class="sub">Not active</span>'}</span>
      <span class="status ${st}">${STATUS_TEXT[st]}</span></button>`;
  }).join('');
}

function renderRoster() {
  if (ui.playerId && !player(ui.playerId)) ui.playerId = null;
  if (!ui.playerId && team.players.length) ui.playerId = [...team.players].sort(Model.byNumber)[0].id;
  const p = player(ui.playerId);
  let editor = '<div class="empty"><p><b>No players yet.</b></p><p>Tap <b>+ Add player</b> to start the roster.</p></div>';
  if (p) {
    const s = song(p.songId);
    const introOk = p.intro && stored.has(p.intro.path);
    const songOk = s && stored.has(s.path);
    editor = `<section class="panel stack" style="gap:18px">${backBar(`#${p.number} ${Model.playerName(p)}`.replace(/^# /, ''))}
      <div class="player-head"><div class="big-num" id="phNum">${esc(p.number || '–')}</div><h2 id="phName">${esc(Model.playerName(p))}</h2>
        <span class="spacer"></span><button class="btn primary big" data-act="test-walkup" ${p.intro || s ? '' : 'disabled'}>${PLAY_ICON}Test walkup</button></div>
      <div class="grid2 name-fields">
        <label class="field">First name<input type="text" data-pf="first" value="${esc(p.first)}" autocomplete="off"></label>
        <label class="field">Last name<input type="text" data-pf="last" value="${esc(p.last)}" autocomplete="off"></label>
        <label class="field">Number<input type="text" inputmode="numeric" data-pf="number" value="${esc(p.number)}" autocomplete="off" maxlength="3"></label>
      </div>
      <div class="slots">
        <div class="slotcard ${p.intro && !introOk ? 'missing' : ''}">
          <span class="k">1 · Announcement</span>
          ${p.intro ? `<span class="v">${esc(p.intro.name || p.intro.path.split('/').pop())}</span>${introOk ? '' : '<span class="status no-song">File not on this device</span>'}` : '<span class="v none">None yet</span><span class="hint">An audio clip like “Now batting, number 7…”</span>'}
          <div class="row">
            ${p.intro ? `<button class="btn small" data-act="listen-intro" ${introOk ? '' : 'disabled'}>Listen</button>` : ''}
            <label class="btn small file-btn">${p.intro ? 'Choose a different clip' : 'Choose a clip'}<input type="file" accept="audio/*,.mp3,.m4a,.wav" data-act="intro-file"></label>
            ${p.intro ? '<button class="btn small danger" data-act="intro-remove">Remove</button>' : ''}
          </div>
        </div>
        <div class="slotcard song ${s && !songOk ? 'missing' : ''}">
          <span class="k">2 · Walk-up song</span>
          ${s ? `<span class="v">${esc(Model.songLabel(s))} <span class="pill ${team.songs.includes(s) ? '' : 'common-pill'}">${team.songs.includes(s) ? 'Team song' : 'Common'}</span></span><span class="hint">Plays ${clipText(s)}, fades out over ${secs(s.fadeOut)} s</span>${songOk ? '' : '<span class="status no-song">File not on this device</span>'}` : '<span class="v none">None yet</span>'}
          <div class="row">
            <button class="btn small" data-act="choose-song">${s ? 'Change song' : 'Choose a song'}</button>
            ${s ? `${team.songs.includes(s) || canAdmin() ? '<button class="btn small" data-act="edit-clip">Edit start and stop</button>' : ''}<button class="btn small danger" data-act="song-remove">Remove</button>` : ''}
          </div>
        </div>
      </div>
      <div class="band"><b>Song comes in</b>
        <div class="seg" role="group" aria-label="Song comes in">
          <button data-act="entry" data-v="under" aria-pressed="${p.entry !== 'after'}">Under the announcement</button>
          <button data-act="entry" data-v="after" aria-pressed="${p.entry === 'after'}">After it</button>
        </div>
        <span class="hint">${p.entry === 'after' ? 'The song starts when the announcement ends.' : 'The song plays quietly, then rises when the announcement ends.'}</span></div>
      <div class="row"><label class="check"><input type="checkbox" data-pf="active" ${p.active ? 'checked' : ''}>Active player</label>
        <span class="hint">Inactive players stay on the roster but sit on every bench.</span>
        <span class="spacer"></span><button class="btn danger" data-act="player-remove">Remove from team</button></div>
      <div class="phone-sticky"><button class="btn primary big" data-act="test-walkup" ${p.intro || s ? '' : 'disabled'}>${PLAY_ICON}Test walkup</button></div>
    </section>`;
  }
  main.innerHTML = `<div class="cols roster-cols ${listMode()}">
    <aside class="stack"><span class="section-title">Roster · ${team.players.length}</span>
      <div class="list" id="rosterList">${rosterList()}</div>
      <button class="btn outline big" data-act="player-add">+ Add player</button></aside>
    ${editor}</div>`;
}

function openSongPicker(p) {
  const items = [...pool().songs].sort((a, b) => a.title.localeCompare(b.title)).map(s => `
    <button class="item ${s.id === p.songId ? 'sel' : ''}" data-pick-song="${esc(s.id)}">
      <span class="grow"><span class="name">${esc(Model.songLabel(s))}</span><span class="sub">${clipText(s)}${Model.songsUsing(team, s.id).length ? ' · walk-up for ' + esc(Model.songsUsing(team, s.id).map(Model.playerName).join(', ')) : ''}</span></span></button>`).join('');
  openDialog(`Walk-up song for ${Model.playerName(p)}`, `
    <input class="search" type="search" id="pickSearch" placeholder="Search songs" autocomplete="off">
    <div class="list pick-list" id="pickList">${items || '<p class="hint">No songs on this device yet.</p>'}</div>
    <label class="btn outline file-btn">+ Add a new song file<input type="file" accept="audio/*,.mp3,.m4a,.wav" id="pickFile"></label>`, () => render());
  $('#pickSearch').oninput = e => {
    const q = e.target.value.toLowerCase();
    for (const b of document.querySelectorAll('[data-pick-song]')) b.hidden = !b.textContent.toLowerCase().includes(q);
  };
  $('#pickList').onclick = e => {
    const b = e.target.closest('[data-pick-song]');
    if (!b) return;
    p.songId = b.dataset.pickSong; saveTeam(); closeDialog();
  };
  $('#pickFile').onchange = async e => {
    const added = await addSongFiles([...e.target.files]);
    if (added[0]) { p.songId = added[0].id; saveTeam(); closeDialog(); toast('Song added. Set its start point in Songs.'); }
  };
}

/* ==================================================================== 6. SONGS AND THE CLIP EDITOR */

async function addSongFiles(files) {
  const added = [];
  let replaced = 0;
  for (const f of files) {
    if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(f.name)) continue;
    // common songs (Admin screen) or this team's own (Team screen, and the walk-up picker)
    const path = commonScope() ? `Songs/${safeName(f.name)}` : Model.teamSongPath(team.id, safeName(f.name));
    await storeFile(path, f);
    const length = await Sound.measure(f);
    let s = songsHere().find(x => x.path === path);
    if (s) { s.length = length; replaced++; delete peaksCache[s.id]; }
    else { s = Model.songFromFile(path, { length }); songsHere().push(s); }
    added.push(s);
  }
  saveBoth();
  if (replaced) toast(`${replaced} song${replaced > 1 ? 's were' : ' was'} already here: the file was updated and the cut points kept.`);
  return added;
}

const peaksCache = {};
const edit = { songId: null, cursor: 0, track: null, raf: 0 };

function renderSongs() {
  if (ui.songId && !song(ui.songId)) ui.songId = null;
  if (ui.songId && !songsHere().some(x => x.id === ui.songId)) ui.songId = null;
  if (!ui.songId && songsHere().length) ui.songId = [...songsHere()].sort((a, b) => a.title.localeCompare(b.title))[0].id;
  const s = song(ui.songId);
  if (edit.songId !== ui.songId) { Sound.stopPreview(); edit.songId = ui.songId; edit.cursor = s ? s.start : 0; }
  const q = ui.songQuery.toLowerCase();
  const list = [...songsHere()].sort((a, b) => a.title.localeCompare(b.title))
    .filter(x => !q || `${x.title} ${x.artist} ${Model.songsUsing(team, x.id).map(Model.playerName).join(' ')}`.toLowerCase().includes(q))
    .map(x => {
      const users = Model.songsUsing(team, x.id);
      return `<button class="item ${x.id === ui.songId ? 'sel' : ''} ${stored.has(x.path) ? '' : 'missing'}" data-act="pick-song" data-id="${esc(x.id)}">
        <span class="grow"><span class="name">${esc(Model.songLabel(x))}</span>
        <span class="sub">${stored.has(x.path) ? '' : 'File not on this device · '}${clipText(x)}${users.length ? ' · ' + esc(users.map(u => '#' + u.number + ' ' + u.first).join(', ')) : ''}</span></span></button>`;
    }).join('');

  let editor = `<div class="empty"><p><b>No songs yet.</b></p><p>Tap <b>+ Add songs from this device</b> and pick MP3 files. You can pick several at once.</p></div>`;
  if (s) {
    const users = Model.songsUsing(team, s.id);
    editor = `<section class="panel stack" style="gap:16px">${backBar(s.title)}
      <div class="grid2">
        <label class="field">Title<input type="text" data-sf="title" value="${esc(s.title)}" autocomplete="off"></label>
        <label class="field">Artist<input type="text" data-sf="artist" value="${esc(s.artist)}" autocomplete="off"></label>
      </div>
      <div class="wave" id="wave" aria-label="Waveform. Tap to move the play point."><canvas id="waveCanvas"></canvas><span class="wave-clock" id="waveClock">${mmss(edit.cursor)}</span><div class="loading" id="waveMsg">${stored.has(s.path) ? 'Reading the song…' : 'This song’s file isn’t on this device.'}</div></div>
      <div class="row clip-btns">
        <button class="btn primary big" data-act="pv-toggle" id="pvToggle" ${stored.has(s.path) ? '' : 'disabled'}>${PLAY_ICON}<span>Play</span></button>
        <button class="btn gold big" data-act="set-start">Set start here</button>
        <button class="btn gold big" data-act="set-stop">Set stop here</button>
        <button class="btn outline big" data-act="pv-clip" ${stored.has(s.path) ? '' : 'disabled'}>Hear the clip</button>
        <span class="spacer"></span><span class="clock" id="clock">${mmss(edit.cursor)}</span>
      </div>
      <div class="grid4">
        ${stepper('Start (seconds)', 'start', secs(s.start))}
        ${stepper('Stop (seconds)', 'stop', s.stop == null ? '' : secs(s.stop), 'none')}
        ${stepper('Fade out (seconds)', 'fadeOut', secs(s.fadeOut))}
        ${stepper('Volume (%)', 'volume', Math.round((s.volume ?? 1) * 100))}
      </div>
      <p class="hint">Plays ${clipText(s)}${s.length ? ` of ${mmss(s.length)}` : ''}. ${s.stop == null ? `With no stop point a walk-up plays for ${settings.walkupSeconds} seconds.` : ''}</p>
      <div class="row"><b>Music categories</b>
        ${songCats(s).map(c => `<button class="chip on" data-act="sc-remove" data-id="${esc(c.id)}" aria-label="Remove from ${esc(c.name)}">${esc(c.name)} ✕</button>`).join('')}
        <button class="chip add" data-act="sc-add">+ Add to a music category</button></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:12px">
        <span class="hint">${users.length ? 'Walk-up for <b>' + esc(users.map(Model.playerName).join(', ')) + '</b>' : 'Not anyone’s walk-up yet.'}</span>
        <span class="spacer"></span>
        <label class="btn file-btn wide-only">Choose a different file<input type="file" accept="audio/*,.mp3,.m4a,.wav" data-act="song-file" id="songFile"></label>
        <button class="btn danger wide-only" data-act="song-delete">Delete song</button>
        <button class="btn square phone-only" data-act="song-menu" aria-label="More song actions">\u22ef</button>
      </div>
    </section>`;
  }
  main.innerHTML = `<div class="cols wide-left ${listMode()}">
    <aside class="stack">
      <input class="search" type="search" id="songSearch" placeholder="Search songs or players" value="${esc(ui.songQuery)}" autocomplete="off" aria-label="Search songs">
      <div class="list" id="songList">${list || (songsHere().length ? '<p class="hint">No songs match.</p>' : `<p class="hint">${commonScope() ? 'No common songs yet.' : `No ${esc(team.short || team.name)} songs yet: pitcher music, team favourites, anything only this team uses.`}</p>`)}</div>
      <label class="btn outline big file-btn">+ Add ${commonScope() ? 'common' : 'team'} songs<input type="file" multiple accept="audio/*,.mp3,.m4a,.wav" data-act="songs-add"></label>
      <span class="hint">${songsHere().length} ${commonScope() ? 'common songs, for every team' : `${esc(team.short || team.name)} song${songsHere().length === 1 ? '' : 's'}`}. ${commonScope() ? '' : `Common songs (${library.songs.length}) are looked after by the Diamond DJ Admin; use them for walk-ups and music too.`}</span>
    </aside>${editor}</div>`;
  if (s && stored.has(s.path)) loadWave(s);
}

function stepper(label, key, value, placeholder = '') {
  return `<label class="field">${esc(label)}<span class="stepper">
    <button type="button" data-act="step" data-k="${key}" data-d="-1" aria-label="Less">−</button>
    <input type="text" inputmode="decimal" data-sf="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}">
    <button type="button" data-act="step" data-k="${key}" data-d="1" aria-label="More">+</button></span></label>`;
}

async function loadWave(s) {
  try {
    if (!peaksCache[s.id]) peaksCache[s.id] = (await Store.get('peaks:' + s.id)) || null;
    if (!peaksCache[s.id]) {
      peaksCache[s.id] = await Sound.peaks(s.path, 600);
      if (peaksCache[s.id]) Store.set('peaks:' + s.id, peaksCache[s.id]).catch(() => {});
    }
    const pk = peaksCache[s.id];
    if (pk && !s.length) { s.length = pk.duration; saveBoth(); }
    const msg = $('#waveMsg'); if (msg) msg.hidden = !!pk;
    drawWave();
  } catch (e) {
    console.warn(e);
    const msg = $('#waveMsg'); if (msg) msg.textContent = 'Couldn’t read this song. You can still type start and stop times.';
  }
}

function drawWave() {
  const c = $('#waveCanvas'), s = song(ui.songId);
  if (!c || !s) return;
  const pk = peaksCache[s.id];
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!pk) return;
  const dur = pk.duration || s.length || 1;
  const x = t => (t / dur) * w;
  const stop = s.stop != null && s.stop > s.start ? s.stop : Math.min(dur, s.start + settings.walkupSeconds);
  const n = pk.values.length, bw = w / n, pad = 14;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * dur;
    const v = Math.max(0.03, pk.values[i]);
    const bh = v * (h - pad * 2);
    g.fillStyle = t >= s.start && t <= stop ? '#F5B700' : '#3E5F96';
    g.fillRect(i * bw, h / 2 - bh / 2, Math.max(1, bw - 0.6), bh);
  }
  const marker = (t, text, top) => {
    g.fillStyle = '#F5B700';
    g.fillRect(x(t) - 1.5, 4, 3, h - 8);
    g.font = '700 13px Barlow, sans-serif';
    const tw = g.measureText(text).width + 14;
    const lx = Math.min(w - tw - 2, x(t) + 5);
    g.fillRect(lx, top ? 6 : h - 26, tw, 20);
    g.fillStyle = '#0B2447';
    g.fillText(text, lx + 7, top ? 21 : h - 11);
  };
  marker(s.start, `Start ${mmss(s.start)}`, true);
  marker(stop, `${s.stop == null ? 'Ends' : 'Stop'} ${mmss(stop)}`, false);
  const at = edit.track && edit.track.state !== 'done' ? edit.track.time : edit.cursor;
  g.fillStyle = '#FFFFFF';
  g.fillRect(x(at) - 1, 0, 2, h);
}

function previewTick() {
  cancelAnimationFrame(edit.raf);
  const step = () => {
    const t = edit.track;
    if (t && t.state !== 'done') edit.cursor = t.time;
    const t10 = mmss(edit.cursor) + '.' + Math.floor((edit.cursor % 1) * 10);
    const clock = $('#clock'); if (clock) clock.textContent = t10;
    const wc = $('#waveClock'); if (wc) wc.textContent = t10;
    const btn = $('#pvToggle');
    if (btn) btn.querySelector('span').textContent = t && t.state === 'playing' ? 'Pause' : 'Play';
    drawWave();
    if (t && t.state !== 'done') edit.raf = requestAnimationFrame(step);
    else edit.track = null;
  };
  step();
}

async function previewFrom(at, clip = false) {
  const s = song(ui.songId);
  if (!s) return;
  Sound.fadeAll(0.3);
  const opts = clip ? { stop: s.stop != null && s.stop > s.start ? s.stop : s.start + settings.walkupSeconds, fadeOut: s.fadeOut, level: s.volume } : { level: s.volume };
  try {
    edit.track = await Sound.preview(s.path, at, opts);
    previewTick();
  } catch (e) { toast('That song couldn’t play on this device.'); }
}

function setSongField(s, key, raw) {
  const v = parseFloat(String(raw).replace(',', '.'));
  if (key === 'stop' && (raw === '' || raw == null)) { s.stop = null; return; }
  if (!isFinite(v)) return;
  const len = s.length || peaksCache[s.id]?.duration || Infinity;
  if (key === 'start') s.start = Math.max(0, Math.min(v, len - 0.5));
  if (key === 'stop') s.stop = v <= s.start ? null : Math.min(v, len);
  if (key === 'fadeOut') s.fadeOut = Math.max(0, Math.min(10, v));
  if (key === 'volume') s.volume = Math.max(0.05, Math.min(1.5, v / 100));
  if (s.stop != null && s.stop <= s.start) s.stop = null;
}

function deletePrompt(s) {
  const n = Model.songsUsing(team, s.id).length;
  return n ? `Tap again: also removes it from ${n} player${n > 1 ? 's' : ''}` : 'Tap again to delete';
}
async function deleteSong(s) {
  for (const t of Object.values(teams)) Model.removeSongEverywhere(t, s.id);
  for (const c of library.categories) c.songIds = c.songIds.filter(x => x !== s.id);
  library.songs = library.songs.filter(x => x.id !== s.id);
  team.songs = team.songs.filter(x => x.id !== s.id);
  delete peaksCache[s.id]; Store.remove('peaks:' + s.id).catch(() => {});
  saveLibrary(); saveTeam();
  await dropFileIfUnused(s.path);
  ui.songId = null; ui.phoneDetail = false; render();
}

/* ==================================================================== 7. SETTINGS, DEMO, BACKUP */

function openSettings() {
  const row = (label, key, min, max, step, fmt) => `<div class="setting"><span>${label}</span>
    <input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" aria-label="${esc(label)}"><output data-out="${key}">${fmt(settings[key])}</output></div>`;
  // Manage (by role) first, then four groups that open and close: Updates, Sound, This device, Advanced
  const teamDirty = Drive.localEdits(team) !== false && (team.players.length || team.songs.length || Object.keys(team.music).length);
  const commonDirty = !!Drive.commonEdits() || (Drive.commonEdits() === null && library.songs.length > 0);
  const manageRow = (view, icon, title, sub, dot) => `<button class="manage-row" data-go="${view}">
      <span class="manage-icon">${icon}</span><span class="grow"><b>${title}</b><span class="sub">${sub}</span>${dot ? `<span class="manage-dot">${dot}</span>` : ''}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`;
  const group = (key, title, summary, body) => `<details class="set-group" data-group="${key}" ${(settings.openGroup || 'updates') === key ? 'open' : ''}>
      <summary><span class="grow"><b>${title}</b><span class="sub">${summary}</span></span><span class="plus" aria-hidden="true"></span></summary>
      <div class="set-body">${body}</div></details>`;
  const when = Drive.state.lastCheck ? new Date(Drive.state.lastCheck).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const ICON_LINEUPS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
  openDialog('Settings', `
    <div class="manage">
      <span class="section-title">Manage</span>
      ${manageRow('lineup', ICON_LINEUPS, 'Lineups', `${esc(lineup().name)} is in use · ${team.lineups.length} saved`)}
      ${canTeam() ? manageRow('roster', ICON_TEAM, 'Team setup', `${esc(team.short || team.name)}: roster, walk-ups, team songs, music`, teamDirty ? 'Changes to publish' : '') : ''}
      ${canAdmin() ? manageRow('csongs', ICON_ADMIN, 'Admin', 'Common songs and music categories for every team', commonDirty ? 'Changes to publish' : '') : ''}
    </div>
    <span class="section-title">Settings</span>
    ${group('updates', 'Updates', when ? `Last checked ${esc(when)}` : 'Get the roster and songs from Google Drive', `<div id="driveBox" class="stack"></div>
      <p class="hint">On this device you’re <b>${ROLE_NAME[role()]}</b>${settings.viewAs ? ' (View as, under Advanced)' : ''}${Drive.state.account ? ` · ${esc(Drive.state.account)}` : ''}.
      ${!Drive.state.lastCheck ? 'Everything can be set up here until this device checks Google Drive; roles come from Drive sharing after that.' : ''}</p>`)}
    ${group('sound', 'Sound', 'Fades, walk-up length, the announcement mix', `
      ${row('Fade-out length', 'fadeSeconds', 0.5, 8, 0.5, v => v + ' s')}
      ${row('Walk-up length when a song has no stop point', 'walkupSeconds', 5, 30, 1, v => v + ' s')}
      ${row('Song volume under the announcement', 'duckLevel', 0, 0.6, 0.05, v => Math.round(v * 100) + '%')}
      ${row('Song comes up after the announcement over', 'riseSeconds', 0.2, 3, 0.1, v => (+v).toFixed(1) + ' s')}
`)}
    ${group('device', 'This device', `${installed() ? 'Installed' : 'Not installed'} · version ${esc(window.APP_VERSION || '')}`, `
      <div id="installBox" class="stack"></div>
      <p class="hint" id="setStorage">Checking storage…</p>
      <div class="row"><span class="hint">Diamond DJ ${esc(versionText())}</span><button class="btn small" id="setHelp">Help and what's new</button></div>`)}
    ${group('advanced', 'Advanced', 'View as, backup', `
      ${RANK[realRole()] >= 1 ? `<label class="field">View as (try another role’s screens on this device)<select id="setViewAs">
        <option value="">Myself: ${ROLE_NAME[realRole()]}</option>${realRole() === 'admin' ? `<option value="organizer" ${settings.viewAs === 'organizer' ? 'selected' : ''}>Team organizer</option>` : ''}
        <option value="volunteer" ${settings.viewAs === 'volunteer' ? 'selected' : ''}>Volunteer</option></select></label>` : ''}
      <p class="hint">A backup file has the roster, lineups, song names and cut points (not the music).</p>
      <div class="row"><button class="btn" id="setSave">Save a backup</button>
        <label class="btn file-btn">Open a backup<input type="file" accept=".json,application/json" id="setOpen"></label></div>`)}`, () => render());

  for (const d of document.querySelectorAll('.set-group')) d.addEventListener('toggle', () => {
    if (!d.open) return;
    settings.openGroup = d.dataset.group; saveSettings();
    for (const o of document.querySelectorAll('.set-group')) if (o !== d) o.open = false;
  });
  for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => { const v = b.dataset.go; closeDialog(); go(v); };
  paintDrive();
  paintInstall();
  $('#setHelp').onclick = () => openHelp('news');
  if ($('#setViewAs')) $('#setViewAs').onchange = e => { settings.viewAs = e.target.value || null; saveSettings(); closeDialog(); toast(settings.viewAs ? `Viewing as ${ROLE_NAME[settings.viewAs]}. Change it back in Settings › Advanced.` : 'Back to your own role.'); };
  for (const r of document.querySelectorAll('[data-set]')) {
    r.oninput = () => {
      const k = r.dataset.set;
      settings[k] = parseFloat(r.value);
      document.querySelector(`[data-out="${k}"]`).textContent =
        k === 'duckLevel' ? Math.round(settings[k] * 100) + '%' : k === 'riseSeconds' ? settings[k].toFixed(1) + ' s' : settings[k] + ' s';
      Sound.settings.fadeSeconds = settings.fadeSeconds;
      saveSettings();
    };
  }
  $('#setSave').onclick = saveBackup;
  $('#setOpen').onchange = e => openBackup(e.target.files[0]);
  Store.usage().then(u => {
    const el = $('#setStorage'); if (!el) return;
    el.textContent = `${stored.size} audio file${stored.size === 1 ? '' : 's'} on this device` +
      (u && u.usage ? ` · about ${(u.usage / 1e6).toFixed(0)} MB used of ${(u.quota / 1e9).toFixed(1)} GB available to the app` : '');
  });
}

function newGame() {
  const l = lineup();
  game.upNext = l.order[0] || null;
  game.lastPlayed = null;
  game.played = [];
  game.cursors = {};
  saveGame();
  toast('New game: back to batter 1, and every song can play again.');
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function saveBackup() {
  const name = (team.short || team.name || 'team').replace(/[^\w-]+/g, '-');
  download(`${name}.diamond.json`, JSON.stringify({ format: 'diamond-backup', version: 1, saved: new Date().toISOString(), team, library }, null, 1));
}

async function openBackup(file) {
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    const t = Model.checkTeam(obj.team || obj);
    if (obj.library) library = Model.mergeLibrary(library, Model.checkLibrary(obj.library));
    delete games[t.id];
    addTeam(t);
    saveLibrary();
    closeDialog();
    toast(`Opened ${team.name}. Songs whose files aren’t on this device are marked.`);
  } catch (e) {
    toast(e.message || 'That file couldn’t be opened.');
  }
}

async function loadDemo() {
  toast('Loading the demo team…', 10000);
  try {
    const res = await fetch('demo/demo.json');
    if (!res.ok) throw new Error('offline');
    const demo = await res.json();
    for (const f of demo.files) {
      if (stored.has(f.path)) continue;
      const r = await fetch('demo/' + f.file);
      if (!r.ok) throw new Error('offline');
      await storeFile(f.path, await r.blob());
    }
    library = Model.mergeLibrary(library, Model.checkLibrary(demo.library));
    delete games[demo.team.id];
    // the demo is a team of its own; an untouched empty team made at first start makes way for it
    if (!team.players.length && Object.keys(teams).length === 1 && !Drive.state.teams[team.id]) delete teams[team.id];
    addTeam(Model.checkTeam(demo.team));
    ui.songId = null;
    saveLibrary();
    closeDialog();
    toast('Demo team loaded. Tap Play walkup to try it.');
  } catch (e) {
    console.warn(e);
    toast('The demo needs an internet connection the first time.');
  }
  render();
}

/* ==================================================================== 8. NOW PLAYING */

const KIND = { walkup: 'Walkup', intro: 'Announcement', preview: 'Preview', sound: 'Playing', playlist: 'Playlist' };
let lastPlayingSig = '';
function renderDock() {
  const all = Sound.tracks.filter(t => t.state !== 'done');
  const t = all.find(t => t.kind === 'walkup' && t.state === 'playing') || all.find(t => t.kind === 'intro')
    || all.find(t => t.state === 'playing' && t.kind !== 'preview') || all[0];
  const info = $('#dockInfo');
  if (!t) {
    if (!info.querySelector('.dock-idle')) info.innerHTML = '<span class="dock-idle">Nothing playing</span>';
  } else {
    const from = t.kind === 'preview' || t.kind === 'intro' ? 0 : t.start;
    const total = Math.max(0.1, (t.kind === 'preview' ? t.duration : t.end) - from);
    const el = Math.max(0, t.time - from);
    info.innerHTML = `<div class="np-line"><span class="np-kind">${KIND[t.kind] || 'Playing'}${t.state === 'fading' ? ' · fading' : ''}</span>
      <span class="np-name">${esc(t.label)}</span><span class="np-time">${mmss(el)} / ${mmss(total)}</span></div>
      <div class="bar"><i style="width:${Math.min(100, (el / total) * 100).toFixed(1)}%"></i></div>`;
  }
  // re-draw the game list when who's playing changes
  const pm = playingMusic();
  const sig = String(playingPlayerId()) + [...pm.songs].join(',') + '|' + [...pm.shuffles].join(',');
  if (sig !== lastPlayingSig) { lastPlayingSig = sig; if (ui.view === 'game' && !dlg.open) renderGame(); }
}

/* ==================================================================== 10. MUSIC (categories) */
/* The Game screen's Music: colour-coded categories (Warm-up, Pitchers…). Each shows a Shuffle
   button (a song not played yet this game) and a button per song: tap to play, tap again to fade.
   Categories and their common songs belong to the common library (Admin › Music); a team adds
   its own songs to them and can hide one it doesn't use (Team setup › Music). */

const findCat = id => library.categories.find(c => c.id === id) || null;
const lightColor = hex => { const n = parseInt(String(hex).slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 160; };
const onColor = hex => (lightColor(hex) ? '#0B2447' : '#FFFFFF');
const ICON_SHUFFLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';

function playingMusic() {
  const live = Sound.playing().filter(t => t.musicId && (t.state === 'playing' || t.state === 'loading'));
  return { songs: new Set(live.map(t => t.musicId)), shuffles: new Set(live.filter(t => t.shuffleCat).map(t => t.shuffleCat)) };
}

function musicHtml() {
  const cats = gameCats();
  if (!cats.length) return '<span class="section-title">Music</span><p class="hint">No music categories yet.</p>';
  const cur = cats.find(c => c.id === ui.catId) || cats[0];
  ui.catId = cur.id;
  const live = playingMusic(), played = new Set(game.played || []);
  const songs = cur.songIds.map(song).filter(Boolean);
  const chips = cats.map(c => `<button class="cat-chip" data-act="cat" data-id="${esc(c.id)}" aria-pressed="${c === cur}" style="--c:${esc(c.color)};--fg:${onColor(c.color)}">
      <i></i><span>${esc(c.name)}</span><em>${c.songIds.filter(id => song(id)).length}</em></button>`).join('');
  const style = `--c:${esc(cur.color)};--fg:${onColor(cur.color)}`;
  const left = songs.filter(s => !played.has(s.id)).length;
  const shuffleOn = live.shuffles.has(cur.id);
  const shuffle = songs.length > 1 ? `<button class="mpad shuffle ${shuffleOn ? 'on' : ''}" data-act="shuffle" data-id="${esc(cur.id)}" style="${style}">
      <span class="mpad-name">${ICON_SHUFFLE}Shuffle</span><span class="mpad-meta">${shuffleOn ? 'Playing · tap to fade' : `${left || songs.length} of ${songs.length} not played yet`}</span></button>` : '';
  const pad = s => {
    const on = live.songs.has(s.id) && !shuffleOn, was = played.has(s.id);
    return `<button class="mpad ${on ? 'on' : ''} ${was && !on ? 'played' : ''} ${stored.has(s.path) ? '' : 'missing'}" data-act="music" data-id="${esc(s.id)}" style="${style}">
      <span class="mpad-name">${esc(s.title)}</span><span class="mpad-meta">${on ? 'Playing · tap to fade' : esc(s.artist || '')}</span>${was && !on ? '<span class="mpad-tag">Played</span>' : ''}</button>`;
  };
  return `<div class="row"><span class="section-title">Music</span><span class="spacer"></span><span class="hint">Tap to play · tap again to fade</span></div>
    <div class="cat-chips" role="group" aria-label="Music categories">${chips}</div>
    ${songs.length ? `<div class="mpads">${shuffle}${songs.map(pad).join('')}</div>`
      : `<p class="hint">No songs in ${esc(cur.name)} yet.${canTeam() && !settings.locked ? ' Add some in Settings › Team setup › Music.' : ''}</p>`}`;
}

async function playMusic(s, cat, shuffleCat = null) {
  Model.notePlayed(game, s.id);
  saveGame();
  const c = Model.clipOf(s);
  const layer = c.length != null && c.length < settings.layerSeconds; // a short clip plays over the music
  try {
    await Sound.playOne({ path: c.path, start: c.start, stop: c.stop, fadeOut: c.fadeOut, level: c.volume, label: `${cat.name} · ${s.title}`, kind: 'sound', musicId: s.id, shuffleCat }, { layer });
  } catch (e) {
    console.warn(e);
    toast('That song’s file isn’t on this device.');
  }
}
function tapMusic(songId) {
  const live = playingMusic();
  if (live.songs.has(songId)) { for (const t of Sound.tracks) if (t.musicId === songId) t.fade(settings.fadeSeconds); return; }
  const s = song(songId), cat = gameCats().find(c => c.id === ui.catId);
  if (s && cat) playMusic(s, cat);
}
function tapShuffle(catId) {
  if (playingMusic().shuffles.has(catId)) { for (const t of Sound.tracks) if (t.shuffleCat === catId) t.fade(settings.fadeSeconds); return; }
  const cat = gameCats().find(c => c.id === catId);
  const id = cat && Model.pickShuffle(cat, pool(), game);
  if (!id) return toast(`${cat ? cat.name : 'This category'} has no songs yet.`);
  playMusic(song(id), cat, catId);
}

/* ---------------- setting up Music: Admin › Music (categories and common songs), Team setup › Music */
function catList() {
  return library.categories.map(c => {
    const mine = (team.music[c.id] || []).length, hidden = team.hiddenCats.includes(c.id);
    const sub = commonScope() ? `${c.songIds.length} song${c.songIds.length === 1 ? '' : 's'}`
      : hidden ? `Hidden on ${esc(team.short || team.name)}` : `${c.songIds.length} common${mine ? ` + ${mine} team` : ''}`;
    return `<button class="item ${c.id === ui.catId ? 'sel' : ''} ${hidden && !commonScope() ? 'hidden-moment' : ''}" data-act="pick-cat" data-id="${esc(c.id)}">
      <span class="swatch" style="background:${esc(c.color)}"></span><span class="grow"><span class="name">${esc(c.name)}</span></span><span class="sub">${sub}</span></button>`;
  }).join('') || '<p class="hint">No categories yet.</p>';
}
function catSongRows(c, list, editable, kind) {
  return list.map(song).filter(Boolean).map((s, i, all) => `<div class="edit-row"><span class="grow"><span class="name">${esc(Model.songLabel(s))}</span>
      <span class="sub">${kind === 'team' && !team.songs.includes(s) ? 'Common song' : kind === 'team' ? 'Team song' : 'Common song'}${stored.has(s.path) ? '' : ' · file not on this device'}</span></span>
      <button class="btn small" data-act="listen" data-id="${esc(s.id)}">Listen</button>
      ${editable ? `<button class="btn small square" data-act="cs-up" data-list="${kind}" data-id="${esc(s.id)}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button class="btn small square" data-act="cs-down" data-list="${kind}" data-id="${esc(s.id)}" aria-label="Move down" ${i < all.length - 1 ? '' : 'disabled'}>↓</button>
        <button class="btn small square danger" data-act="cs-remove" data-list="${kind}" data-id="${esc(s.id)}" aria-label="Remove from ${esc(c.name)}">✕</button>`
        : '<span class="lock-mark" role="img" aria-label="Set by the Diamond DJ Admin"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>'}</div>`).join('');
}
function renderMusicSetup() {
  const admin = commonScope();
  if (!findCat(ui.catId)) ui.catId = library.categories.length ? library.categories[0].id : null;
  const c = findCat(ui.catId);
  const aside = `<aside class="stack">
      <span class="section-title">${admin ? 'Music categories' : `Music on ${esc(team.short || team.name)}`}</span>
      <p class="hint">${admin ? 'For every team. Each category is a colour-coded group of songs on the Game screen.' : 'Categories come from the Diamond DJ Admin. Tap one to add your team’s songs to it, or hide it.'}</p>
      <div class="list">${catList()}</div>
      ${admin ? '<button class="btn outline big" data-act="cat-new">+ New category</button>' : ''}</aside>`;
  let editor = '<div class="empty"><p><b>No categories yet.</b></p></div>';
  if (c && admin) {
    const i = library.categories.indexOf(c);
    editor = `<section class="panel stack" style="gap:16px">${backBar(c.name)}
      <label class="field">Category name<input type="text" data-cf="name" value="${esc(c.name)}" autocomplete="off"></label>
      <div class="field">Colour<div class="row swatches">${Model.CAT_COLORS.map(x => `<button class="swatch-btn ${x === c.color ? 'on' : ''}" data-act="cat-color" data-color="${x}" style="background:${x}" aria-label="Colour ${x}" aria-pressed="${x === c.color}"></button>`).join('')}</div></div>
      <div class="stack"><div class="row"><b>Common songs · ${c.songIds.length}</b><span class="spacer"></span><button class="btn outline" data-act="cs-add">+ Add songs</button></div>
        <div class="list">${catSongRows(c, c.songIds, true, 'common') || '<p class="hint">None yet. Teams can add their own too.</p>'}</div></div>
      <div class="row"><button class="btn" data-act="cat-move" data-dir="-1" ${i ? '' : 'disabled'}>Move earlier</button><button class="btn" data-act="cat-move" data-dir="1" ${i < library.categories.length - 1 ? '' : 'disabled'}>Move later</button>
        <span class="spacer"></span><button class="btn danger" data-act="cat-delete">Delete category</button></div>
    </section>`;
  } else if (c) {
    const shown = !team.hiddenCats.includes(c.id), mine = team.music[c.id] || [];
    editor = `<section class="panel stack" style="gap:16px">${backBar(c.name)}
      <div class="row"><span class="swatch big" style="background:${esc(c.color)}"></span><span class="lineup-title">${esc(c.name)}</span></div>
      <label class="check"><input type="checkbox" data-act="cat-show" ${shown ? 'checked' : ''}>Show ${esc(c.name)} on ${esc(team.short || team.name)}’s Game screen</label>
      <div class="stack"><b>Common songs · ${c.songIds.length}</b><div class="list">${catSongRows(c, c.songIds, false, 'common') || '<p class="hint">None.</p>'}</div></div>
      <div class="stack"><div class="row"><b>${esc(team.short || team.name)} songs · ${mine.length}</b><span class="spacer"></span><button class="btn outline" data-act="cs-add">+ Add songs</button></div>
        <div class="list">${catSongRows(c, mine, true, 'team') || '<p class="hint">None yet. They show after the common songs.</p>'}</div></div>
    </section>`;
  }
  main.innerHTML = `<div class="cols wide-left ${listMode()}">${aside}${editor}</div>`;
}
const catSongs = (c, kind) => (kind === 'common' ? c.songIds : (team.music[c.id] = team.music[c.id] || []));
function openCatSongPicker(c) {
  const admin = commonScope();
  openToggleList(`Songs in ${c.name}`,
    () => (admin ? library.songs : [...team.songs, ...library.songs.filter(s => !c.songIds.includes(s.id))])
      .slice().sort((a, b) => a.title.localeCompare(b.title)).map(s => ({ id: s.id, name: Model.songLabel(s), sub: admin ? '' : team.songs.includes(s) ? 'Team song' : 'Common song' })),
    id => catSongs(c, admin ? 'common' : 'team').includes(id),
    id => { const l = catSongs(c, admin ? 'common' : 'team'); const k = l.indexOf(id); if (k >= 0) l.splice(k, 1); else l.push(id); });
}
// Songs screen: which categories a song is in (common ones on the Admin screen, the team's on Team setup)
const songCats = s => library.categories.filter(c => catSongs(c, commonScope() ? 'common' : 'team').includes(s.id));
function openSongCatPicker(s) {
  const kind = commonScope() ? 'common' : 'team';
  openToggleList(`Categories with ${s.title}`,
    () => library.categories.map(c => ({ id: c.id, name: c.name, sub: '' })),
    id => catSongs(findCat(id), kind).includes(s.id),
    id => { const l = catSongs(findCat(id), kind); const k = l.indexOf(s.id); if (k >= 0) l.splice(k, 1); else l.push(s.id); });
}

function openToggleList(title, items, isOn, toggle) {
  const html = () => items().map(it => `<button class="item" data-tog="${esc(it.id)}" aria-pressed="${isOn(it.id)}">
      <span class="tick" aria-hidden="true">${isOn(it.id) ? '✓' : ''}</span>
      <span class="grow"><span class="name">${esc(it.name)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span></button>`).join('')
    || '<p class="hint">Nothing here yet.</p>';
  openDialog(title, `<input class="search" type="search" id="togSearch" placeholder="Search" autocomplete="off">
    <div class="list pick-list" id="togList">${html()}</div>`, () => render());
  const filter = () => {
    const q = $('#togSearch').value.toLowerCase();
    for (const b of document.querySelectorAll('[data-tog]')) b.hidden = !b.textContent.toLowerCase().includes(q);
  };
  $('#togSearch').oninput = filter;
  $('#togList').onclick = e => {
    const b = e.target.closest('[data-tog]');
    if (!b) return;
    toggle(b.dataset.tog);
    saveBoth();
    $('#togList').innerHTML = html();
    filter();
  };
}


/* ==================================================================== 11. LOCK */

function applyLock() {
  document.body.classList.toggle('locked', !!settings.locked);
  const btn = $('#lockBtn');
  btn.setAttribute('aria-pressed', String(!!settings.locked));
  btn.querySelector('span').textContent = settings.locked ? 'Hold to unlock' : 'Lock';
  btn.setAttribute('aria-label', settings.locked ? 'Locked. Press and hold to unlock.' : 'Lock the setup screens');
}

function setLocked(on) {
  settings.locked = on;
  saveSettings();
  if (on) { closeDialog(); if (SETUP_VIEWS.includes(ui.view)) ui.view = 'game'; }
  applyLock();
  render();
  toast(on ? 'Locked. Game and Lineup stay open. Press and hold the lock for a second and a half to unlock.' : 'Unlocked.');
}

(() => {
  const btn = $('#lockBtn');
  let hold = null;
  btn.addEventListener('click', () => {
    if (btn.dataset.justUnlocked) { delete btn.dataset.justUnlocked; return; } // the end of the hold, not a new tap
    if (!settings.locked) setLocked(true);
    else toast('Press and hold the lock for a second and a half to unlock.');
  });
  btn.addEventListener('pointerdown', () => {
    if (!settings.locked) return;
    btn.classList.add('holding');
    hold = setTimeout(() => { btn.classList.remove('holding'); btn.dataset.justUnlocked = '1'; setLocked(false); }, 1500);
  });
  const cancel = () => { clearTimeout(hold); btn.classList.remove('holding'); };
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('contextmenu', e => e.preventDefault());
})();

/* ==================================================================== 12. TEAMS AND GOOGLE DRIVE (screens) */

function openTeams() {
  const list = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
    const st = Drive.state.teams[t.id];
    return `<div class="row team-row">
      <button class="item ${t.id === team.id ? 'sel' : ''}" data-team="${esc(t.id)}" style="flex:1">
        <span class="grow"><span class="name">${esc(t.name)}</span>
        <span class="sub">${t.players.length} player${t.players.length === 1 ? '' : 's'}${st ? ' · from Google Drive' : ''}</span></span>
        ${t.id === team.id ? '<span class="pill">In use</span>' : ''}</button>
      ${t.id !== team.id && !settings.locked ? `<button class="btn small danger" data-remove-team="${esc(t.id)}">Remove</button>` : ''}</div>`;
  }).join('');
  openDialog('Teams on this device', `
    <p class="hint">Tap a team to use it. Each team keeps its own roster, lineups, music and game.</p>
    <div class="list">${list}</div>
    ${settings.locked ? '' : `<div class="row"><button class="btn outline" id="teamNew">+ New team</button>
      <button class="btn" id="teamDrive">Get teams from Google Drive</button></div>
      <p class="hint">Removing a team takes it off this device only. Songs other teams use stay.</p>`}`, () => render());
  $('#dlgBody').onclick = async e => {
    const pick = e.target.closest('[data-team]');
    if (pick) { Sound.fadeAll(); useTeam(pick.dataset.team); closeDialog(); toast(`Now using ${team.name}.`); return; }
    const rm = e.target.closest('[data-remove-team]');
    if (rm) {
      if (!armed(rm, 'Tap again to remove')) return;
      const t = teams[rm.dataset.removeTeam];
      delete teams[t.id]; delete games[t.id]; delete Drive.state.teams[t.id];
      Drive.save(); saveTeam(); saveGame();
      for (const p of t.players) if (p.intro) await dropFileIfUnused(p.intro.path);
      toast(`${t.name} removed from this device.`);
      return openTeams();
    }
    if (e.target.id === 'teamNew') {
      const name = await askText('New team', 'Team name', '', 'Create');
      if (name) { addTeam(Model.newTeam(name, name)); toast(`${name} created. Add players in Roster.`); }
      return render();
    }
    if (e.target.id === 'teamDrive') { closeDialog(); openSettings(); return startCheck(); }
  };
}

const dui = { phase: 'idle', remote: null, plan: null, chosen: [], keep: {}, stop: false, note: '', pub: null };

function paintDrive() {
  const box = $('#driveBox');
  if (!box) return;
  const when = Drive.state.lastCheck ? new Date(Drive.state.lastCheck).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const conn = `<details class="howto"><summary>Drive connection (organizer)</summary>
      <label class="field">Google Drive folder link<input type="url" id="drvFolder" value="${esc(settings.driveFolder || '')}" placeholder="Leave blank to use the Diamond DJ folder" autocomplete="off" spellcheck="false"></label>
      <label class="field">Google sign-in client ID<input type="text" id="drvClient" value="${esc(settings.driveClient || '')}" placeholder="${DRIVE.clientId ? 'Leave blank to use the built-in one' : 'Paste the client ID from Google Cloud'}" autocomplete="off" spellcheck="false"></label>
      <p class="hint">These change this device only. Share the folder with each volunteer’s Google account: Viewer to download, Editor to publish.</p></details>`;
  if (dui.phase === 'busy') {
    box.innerHTML = `<p class="hint" id="drvSay">${esc(dui.note)}</p><div class="bar"><i id="drvMeter" style="width:0%"></i></div>
      ${dui.canStop ? '<div class="row"><button class="btn" id="drvStop">Stop</button></div>' : ''}`;
    if (dui.canStop) $('#drvStop').onclick = () => { dui.stop = true; $('#drvSay').textContent = 'Stopping after the files in progress…'; };
    return;
  }
  if (dui.phase === 'plan') {
    const p = dui.plan;
    const rows = dui.remote.teams.map(r => {
      const local = teams[r.data.id], st = Drive.state.teams[r.data.id];
      const status = !local ? 'Not on this device' : st && st.modifiedTime === r.file.modifiedTime ? 'On this device · up to date' : 'On this device · changes in Drive';
      return `<label class="check"><input type="checkbox" data-pick-team="${esc(r.data.id)}" ${dui.chosen.includes(r.data.id) ? 'checked' : ''}>
        <span>${esc(r.data.name)}<br><small class="hint">${status}</small></span></label>`;
    }).join('') || '<p class="hint">There are no teams in the Drive folder yet. The organizer publishes one from their device.</p>';
    const commonKeep = realRole() === 'admin' && Drive.commonEdits() ? `<div class="warn">
        <b>The common library was changed on this device</b> and those changes aren’t published. Updating replaces this device’s common songs and music categories with Drive’s.
        <label class="check"><input type="checkbox" data-keep="common" ${dui.keep.common ? 'checked' : ''}>Keep this device’s common songs and music categories</label></div>` : '';
    const keeps = commonKeep + p.teams.filter(t => t.localEdits).map(t => `<div class="warn">
        <b>${esc(t.name)} was changed on this device</b> since it last came from Drive. Updating replaces its roster, team songs and music with Drive’s. Lineups changed here are always kept.
        <label class="check"><input type="checkbox" data-keep="${esc(t.id)}" ${dui.keep[t.id] ? 'checked' : ''}>Keep this device’s roster, team songs and music for ${esc(t.name)}</label></div>`).join('');
    const summary = !dui.chosen.length ? 'Pick at least one team.'
      : p.items.length ? `${p.items.length} song${p.items.length === 1 ? '' : 's'} and announcement${p.items.length === 1 ? '' : 's'} to download (${mb(p.bytes)}).`
      : 'All the songs are already on this device.';
    box.innerHTML = `<b>Teams in Google Drive</b>${rows}${keeps}
      <p>${summary}${p.missing.length ? ` <span class="hint">${p.missing.length} file${p.missing.length === 1 ? ' is' : 's are'} missing from Drive and will show as not on this device.</span>` : ''}</p>
      ${p.bytes > 300e6 ? '<p class="hint">That’s a big download: use good wifi and keep the app open until it finishes.</p>' : ''}
      <div class="row"><button class="btn primary" id="drvGo" ${dui.chosen.length ? '' : 'disabled'}>${p.items.length ? 'Download now' : 'Update'}</button><button class="btn" id="drvCancel">Cancel</button></div>`;
    for (const c of box.querySelectorAll('[data-pick-team]')) c.onchange = () => {
      dui.chosen = [...box.querySelectorAll('[data-pick-team]:checked')].map(x => x.dataset.pickTeam);
      dui.plan = Drive.plan(dui.remote, dui.chosen);
      paintDrive();
    };
    for (const c of box.querySelectorAll('[data-keep]')) c.onchange = () => { dui.keep[c.dataset.keep] = c.checked; };
    $('#drvGo').onclick = runDownload;
    $('#drvCancel').onclick = () => { dui.phase = 'idle'; paintDrive(); };
    return;
  }
  // idle
  if (!Auth.enabled()) {
    box.innerHTML = `<p class="hint">Google sign-in isn’t set up on this copy yet. Once the organizer adds the sign-in client ID, this is where you get the team’s newest roster, lineups, music and songs.</p>${conn}`;
  } else if (!Auth.canRedirect()) {
    box.innerHTML = `<p class="hint">Open Diamond DJ from its web address (or the home-screen icon) to use Google Drive.</p>${conn}`;
  } else {
    box.innerHTML = `<p class="hint">Gets the newest roster, lineups, music and songs from the team’s Google Drive folder and keeps them on this device, so games don’t need wifi. Sign in with the Google account the organizer shared the folder with.</p>
      <div class="row"><button class="btn primary" id="drvCheck">${Drive.state.lastCheck ? 'Check for updates' : 'Download from Google Drive'}</button>
        <button class="btn" id="drvSwitch">Switch Google account</button></div>
      ${dui.note ? `<p class="hint">${esc(dui.note)}</p>` : ''}
      <p class="hint">${when ? `Last checked ${esc(when)}` : 'Not checked yet on this device'}${Drive.state.account ? ` · ${esc(Drive.state.account)}` : ''}</p>
      ${canTeam() ? `<p class="hint">To send changes to everyone: <b>${canAdmin() ? 'Settings › Team setup › Publish, or Settings › Admin › Publish' : 'Settings › Team setup › Publish'}</b>.</p>` : ''}
      ${conn}`;
    $('#drvCheck').onclick = startCheck;
    $('#drvSwitch').onclick = () => { Auth.forget(); Auth.signIn('check', { chooseAccount: true }); };
  }
  const f = $('#drvFolder'), c = $('#drvClient');
  f.onchange = () => { settings.driveFolder = f.value.trim(); saveSettings(); };
  c.onchange = () => { settings.driveClient = c.value.trim(); saveSettings(); paintDrive(); };
}

function busy(note, canStop = false) { dui.phase = 'busy'; dui.note = note; dui.canStop = canStop; dui.stop = false; paintDrive(); }
const say = t => { dui.note = t; const el = $('#drvSay'); if (el) el.textContent = t; };
const meter = f => { const el = $('#drvMeter'); if (el) el.style.width = Math.min(100, f * 100).toFixed(1) + '%'; };
function failed(e) {
  dui.phase = 'idle';
  dui.note = driveError(e);
  if (e && e.message === 'drive:signin') { dui.note = 'Signing in to Google…'; paintDrive(); return Auth.signIn('check'); }
  paintDrive();
  toast(dui.note, 6000);
}

async function startCheck() {
  dui.resume = 'check';
  if (!Auth.token()) { busy('Signing in to Google…'); return Auth.signIn('check'); }
  busy('Looking at the Google Drive folder…');
  try {
    dui.remote = await Drive.scan(say);
    const ids = dui.remote.teams.map(r => r.data.id);
    dui.chosen = ids.filter(id => teams[id]);
    if (!dui.chosen.length && ids.length === 1) dui.chosen = ids;
    dui.keep = {};
    dui.plan = Drive.plan(dui.remote, dui.chosen);
    dui.phase = 'plan';
    paintDrive();
  } catch (e) { failed(e); }
}

async function runDownload() {
  const { remote, plan } = dui;
  busy('Starting the download…', true);
  try {
    const firstTeams = !Object.values(Drive.state.teams).length;
    const r = await Drive.apply(remote, plan, { keepSetup: dui.keep, say, meter, stopped: () => dui.stop });
    if (r.stopped) { dui.phase = 'idle'; dui.note = `Stopped after ${r.done} file${r.done === 1 ? '' : 's'}. Tap Check for updates to carry on.`; return paintDrive(); }
    // first download on a device: switch to the team that came from Drive
    if (firstTeams && plan.teams[0] && (!team.players.length || !teams[team.id])) {
      const starter = team;
      useTeam(plan.teams[0].id);
      if (!starter.players.length && !Drive.state.teams[starter.id] && starter.id !== team.id) { delete teams[starter.id]; saveTeam(); }
    } else if (teams[team.id]) useTeam(team.id); // refresh the team in use
    renderNav();
    if (!dlg.open) render();
    dui.phase = 'idle';
    dui.note = `Up to date. ${r.done ? `${r.done} file${r.done === 1 ? '' : 's'} downloaded.` : ''}${r.failed.length ? ` ${r.failed.length} couldn’t be downloaded; try again later.` : ''}`;
    paintDrive();
    toast(dui.note);
  } catch (e) { failed(e); }
}

async function startPublish(kind = pui.kind || 'team') {
  pui.kind = kind;
  const resume = kind === 'common' ? 'publish-common' : 'publish';
  if (!Auth.token() || !Auth.canWrite()) { pBusy('Signing in to Google…'); return Auth.signIn(resume, { write: true }); }
  pBusy('Checking what Drive has…');
  try {
    pui.plan = kind === 'common' ? await Drive.publishCommonPlan(pSay) : await Drive.publishPlan(team, pSay);
    pui.phase = 'plan';
    paintPublish();
  } catch (e) { pFailed(e); }
}

async function runPublish() {
  const common = pui.kind === 'common';
  pBusy('Publishing…');
  try {
    const r = common ? await Drive.publishCommon(pui.plan, { say: pSay, meter: pMeter }) : await Drive.publish(pui.plan, { say: pSay, meter: pMeter });
    pui.phase = 'idle';
    pui.note = `Published ${common ? 'the common library' : team.name}${r.sent ? ` and ${r.sent} file${r.sent === 1 ? '' : 's'}` : ''}. ${common ? 'Every team' : 'Everyone on the team'} gets it with Check for updates.`;
    render();
    toast(pui.note);
  } catch (e) { pFailed(e); }
}

/* Coming back from Google's sign-in page: carry on with what the person was doing. */
function resumeAfterSignIn() {
  const r = Auth.consume();
  if (!r) return false;
  if (settings.locked && r.resume) { toast('Unlock first to use Google Drive.'); return true; }
  if (String(r.resume).startsWith('publish')) {
    ui.view = r.resume === 'publish-common' ? 'cpublish' : 'publish';
    pui.kind = r.resume === 'publish-common' ? 'common' : 'team';
    render();
    if (r.error) { pui.note = r.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in didn’t finish. Try again.'; return paintPublish() || true; }
    startPublish(pui.kind);
    return true;
  }
  openSettings();
  if (r.error) {
    dui.note = r.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in didn’t finish. Try again.';
    paintDrive();
    return true;
  }
  startCheck();
  return true;
}

/* ==================================================================== 9. EVENTS AND STARTUP */

function render() {
  if ((settings.locked && SETUP_VIEWS.includes(ui.view)) || (TEAM_VIEWS.includes(ui.view) && !canTeam()) || (ADMIN_VIEWS.includes(ui.view) && !canAdmin())) ui.view = 'game';
  renderNav();
  $('#teamName').textContent = team.short || team.name || 'Diamond DJ';
  if (!['songs', 'csongs'].includes(ui.view)) { Sound.stopPreview(); edit.songId = null; }
  ({ game: renderGame, lineup: renderLineup, roster: renderRoster, songs: renderSongs, music: renderMusicSetup, teaminfo: renderTeamInfo,
    publish: () => renderPublish('team'), csongs: renderSongs, cmusic: renderMusicSetup, cpublish: () => renderPublish('common') })[ui.view]();
}

/* The header: Game and Lineup for everyone; Team (team organizers) and Admin (Diamond DJ Admin)
   open their own screens, each with a way back to the game. */
const ICON_TEAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M18 15c2 .5 3 2 3 5"/></svg>';
const ICON_ADMIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/></svg>';
function renderNav() {
  const ws = TEAM_VIEWS.includes(ui.view) ? 'team' : ADMIN_VIEWS.includes(ui.view) ? 'admin' : '';
  document.body.classList.toggle('ws-team', ws === 'team');
  document.body.classList.toggle('ws-admin', ws === 'admin');
  document.body.classList.toggle('ws-lineup', ui.view === 'lineup');
  const tab = (v, label, badge) => `<button data-view="${v}"${ui.view === v ? ' aria-current="page"' : ''}>${label}${badge ? '<span class="tab-dot" aria-label="not published"></span>' : ''}</button>`;
  const teamDirty = Drive.localEdits(team) !== false && (team.players.length || team.songs.length || Object.keys(team.music).length);
  const commonDirty = !!Drive.commonEdits() || (Drive.commonEdits() === null && library.songs.length > 0);
  let html;
  if (ws === 'team') html = `<button class="ws-back" data-view="game"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Game</button>
    <div class="tab-group"><span class="group-label in-game">Team · ${esc(team.short || team.name)}</span><div class="group game ws-tabs">
      ${tab('roster', 'Roster<span class="wide-only">&nbsp;&amp; walk-ups</span>')}${tab('songs', 'Team songs')}${tab('music', 'Music')}${tab('teaminfo', 'Team info')}${tab('publish', 'Publish', teamDirty)}</div></div>`;
  else if (ws === 'admin') html = `<button class="ws-back" data-view="game"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Game</button>
    <div class="tab-group"><span class="group-label in-game">Diamond DJ Admin · all teams</span><div class="group game ws-tabs">
      ${tab('csongs', 'Common songs')}${tab('cmusic', 'Music categories')}${tab('cpublish', 'Publish', commonDirty)}</div></div>`;
  else if (ui.view === 'lineup') html = `<button class="ws-back" data-view="game"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Game</button>
    <span class="ws-title">Lineups</span>`;
  // the Game screen: nothing here. Lineups, Team and Admin are in Settings › Manage
  else html = '';
  $('#nav').innerHTML = html;
}

/* ---------------- Team screen › Team info */
function renderTeamInfo() {
  const st = Drive.state.teams[team.id];
  const r = role();
  main.innerHTML = `<div class="cols">
    <section class="panel stack" style="gap:14px"><span class="section-title">Team info</span>
      <div class="grid2"><label class="field">Team name<input type="text" id="tiName" value="${esc(team.name)}" autocomplete="off"></label>
        <label class="field">Short name (top of the screen)<input type="text" id="tiShort" value="${esc(team.short || '')}" maxlength="16" autocomplete="off"></label></div>
      <p class="hint">Changes save on this device as you type. <b>Publish</b> sends them to every device on the team.</p>
    </section>
    <section class="panel stack" style="gap:12px"><span class="section-title">People and roles</span>
      <p>On this device you’re <b>${ROLE_NAME[r]}</b>${settings.viewAs ? ' (viewing as, from Settings)' : ''}.</p>
      <p class="hint">Roles come from Google Drive sharing of ${st ? `the team’s folder, <b>${esc(st.folderName)}</b>` : 'the team’s folder (made the first time the team is published)'}: <b>Editor</b> = team organizer, <b>Viewer</b> = volunteer. Volunteers also need <b>Viewer</b> on the Diamond DJ folder for the common songs.</p>
      ${st ? `<div class="row"><a class="btn" href="https://drive.google.com/drive/folders/${esc(st.folderId)}" target="_blank" rel="noopener">Open the team’s folder in Google Drive</a></div>` : ''}
    </section></div>`;
  $('#tiName').oninput = e => { team.name = e.target.value; saveTeam(); };
  $('#tiShort').oninput = e => { team.short = e.target.value; saveTeam(); $('#teamName').textContent = team.short || team.name || 'Diamond DJ'; };
}

/* ---------------- Team screen › Publish, and Admin › Publish (the common library) */
const pui = { kind: null, phase: 'idle', plan: null, note: '' };
function renderPublish(kind) {
  if (pui.kind !== kind && pui.phase !== 'busy') { pui.kind = kind; pui.phase = 'idle'; pui.plan = null; pui.note = ''; }
  const common = kind === 'common';
  main.innerHTML = `<div class="stack publish-page">
    <span class="section-title">${common ? 'Publish the common library' : `Publish ${esc(team.name)}`}</span>
    <p class="hint">${common ? 'Sends the common songs and music categories on this device to Google Drive. Every team gets them at its next Check for updates.'
      : `Sends ${esc(team.short || team.name)}’s roster, walk-ups, team songs, music and lineups on this device to the team’s Google Drive folder. Everyone on the team gets them at their next Check for updates; lineups a volunteer changed on game day stay theirs.`}
      Nothing in Drive is deleted, and Drive keeps earlier versions.</p>
    <div class="panel stack" id="pubBox"></div></div>`;
  paintPublish();
}
function paintPublish() {
  const box = $('#pubBox');
  if (!box) return;
  const common = pui.kind === 'common';
  if (pui.phase === 'busy') {
    box.innerHTML = `<p class="hint" id="pubSay">${esc(pui.note)}</p><div class="bar"><i id="pubMeter" style="width:0%"></i></div>`;
    return;
  }
  if (pui.phase === 'plan') {
    const p = pui.plan;
    const n = p.uploads.length;
    box.innerHTML = `<b>${common ? 'The common library' : esc(team.name)}</b>
      <p>Sends ${common ? `${library.songs.length} common song${library.songs.length === 1 ? '' : 's'} and ${library.categories.length} music categories` : `the roster, ${team.songs.length} team song${team.songs.length === 1 ? '' : 's'} and ${team.lineups.length} lineup${team.lineups.length === 1 ? '' : 's'}`}${n ? `, with ${n} file${n === 1 ? '' : 's'} Drive doesn’t have yet (${mb(p.bytes)})` : ''}.
        ${p.firstTime && !common ? `A new folder, <b>${esc(p.folderName)}</b>, is made for the team.` : ''}</p>
      ${p.since ? `<div class="warn"><b>Someone published ${common ? 'the common library' : 'this team'} after this device last got it.</b> Get the latest first, so your publish doesn’t undo their changes.
        <div class="row"><button class="btn navy" id="pubLatest">Get latest first</button></div></div>` : ''}
      ${p.needsCommon && p.needsCommon.length ? `<div class="warn"><b>${p.needsCommon.length} common song${p.needsCommon.length === 1 ? ' isn’t' : 's aren’t'} in the published common library yet</b> (${esc(p.needsCommon.slice(0, 3).map(s => s.title).join(', '))}${p.needsCommon.length > 3 ? '…' : ''}), so other devices won’t have ${p.needsCommon.length === 1 ? 'it' : 'them'}. The Diamond DJ Admin publishes the common library first (Admin › Publish).</div>` : ''}
      ${p.removed && p.removed.length ? `<p class="hint">${p.removed.length} song${p.removed.length === 1 ? ' that’s' : 's that are'} in Drive’s common library ${p.removed.length === 1 ? 'isn’t' : 'aren’t'} on this device and will be left out of it (the files stay in Drive).</p>` : ''}
      ${p.notOnDevice.length ? `<p class="hint">${p.notOnDevice.length} file${p.notOnDevice.length === 1 ? ' isn’t' : 's aren’t'} on this device, so ${p.notOnDevice.length === 1 ? 'it' : 'they'} can’t be sent.</p>` : ''}
      <div class="row"><button class="btn navy" id="pubGo">${p.since ? 'Publish anyway' : 'Publish now'}</button><button class="btn" id="pubCancel">Cancel</button></div>`;
    $('#pubGo').onclick = runPublish;
    $('#pubCancel').onclick = () => { pui.phase = 'idle'; paintPublish(); };
    if ($('#pubLatest')) $('#pubLatest').onclick = () => { pui.phase = 'idle'; openSettings(); startCheck(); };
    return;
  }
  const edits = common ? Drive.commonEdits() : Drive.localEdits(team);
  const st = common ? Drive.state.library : Drive.state.teams[team.id];
  const when = st && st.lastSync ? new Date(st.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const status = edits === null ? 'Not published from this device yet.' : edits ? 'This device has changes that aren’t in Drive yet.' : 'Drive already has everything on this device.';
  const ready = Auth.enabled() && Auth.canRedirect();
  box.innerHTML = `<p><b>${status}</b>${when ? `<br><span class="hint">Last published or updated here ${esc(when)}</span>` : ''}</p>
    ${pui.note ? `<p class="hint">${esc(pui.note)}</p>` : ''}
    ${ready ? `<div class="row"><button class="btn navy big" id="pubStart">${common ? 'Publish the common library' : `Publish ${esc(team.short || team.name)}`}</button></div>
      <p class="hint">You’ll see what will be sent before anything goes.</p>` : '<p class="hint">Open Diamond DJ from its web address or home-screen icon to publish.</p>'}`;
  if ($('#pubStart')) $('#pubStart').onclick = () => startPublish(pui.kind);
}
const pSay = t => { pui.note = t; const el = $('#pubSay'); if (el) el.textContent = t; };
const pMeter = f => { const el = $('#pubMeter'); if (el) el.style.width = Math.min(100, f * 100).toFixed(1) + '%'; };
function pBusy(note) { pui.phase = 'busy'; pui.note = note; paintPublish(); }
function pFailed(e) {
  pui.phase = 'idle';
  pui.note = driveError(e);
  if (e && e.message === 'drive:signin') { pui.note = 'Signing in to Google…'; paintPublish(); return Auth.signIn(pui.kind === 'common' ? 'publish-common' : 'publish', { write: true }); }
  paintPublish();
  toast(pui.note, 6000);
}

function go(view) {
  ui.view = view;
  ui.phoneDetail = false;
  main.scrollTop = 0;
  render();
}

document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) go(b.dataset.view);
});

// long press on a batter: make them up next without playing
let press = null;
main.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-act="batter"]');
  if (!b) return;
  press = { id: b.dataset.id, fired: false, x: e.clientX, y: e.clientY };
  press.timer = setTimeout(() => {
    press.fired = true;
    game.upNext = press.id; saveGame();
    toast(`${Model.playerName(player(press.id))} is up next.`);
    renderGame();
  }, 650);
});
main.addEventListener('pointermove', e => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) clearTimeout(press.timer);
});
const endPress = () => { if (press) clearTimeout(press.timer); };
main.addEventListener('pointerup', endPress);
main.addEventListener('pointercancel', endPress);
main.addEventListener('contextmenu', e => { if (e.target.closest('[data-act="batter"]')) e.preventDefault(); });

async function onAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  const act = b.dataset.act, id = b.dataset.id;
  Sound.unlock();
  const l = act.startsWith('lu-') ? lineupFor(b) : null;
  const p = player(ui.playerId), s = song(ui.songId);
  switch (act) {
    /* game */
    case 'walkup': return playBatter(Model.upNextId(lineup(), game.upNext));
    case 'skip': game.upNext = Model.nextAfter(lineup(), Model.upNextId(lineup(), game.upNext)); saveGame(); return render();
    case 'batter': if (press && press.fired && press.id === id) { press = null; return; } return playBatter(id);
    case 'top': game.upNext = lineup().order[0] || null; saveGame(); return render();
    case 'edit-order': return openOrderDialog();
    case 'new-game': if (!armed(b, 'Tap again: new game')) return; newGame(); return render();
    case 'game-tab': ui.gameTab = b.dataset.tab; return render();
    /* music */
    case 'cat': ui.catId = id; return renderGame();
    case 'music': return tapMusic(id);
    case 'shuffle': return tapShuffle(id);
    case 'pick-cat': ui.catId = id; ui.phoneDetail = true; main.scrollTop = 0; return render();
    case 'cat-new': {
      const c = Model.newCategory({ color: Model.CAT_COLORS[library.categories.length % Model.CAT_COLORS.length] });
      library.categories.push(c); ui.catId = c.id; ui.phoneDetail = true; saveLibrary(); render();
      const f = $('[data-cf="name"]'); if (f) { f.focus(); f.select(); } return;
    }
    case 'cat-color': findCat(ui.catId).color = b.dataset.color; saveLibrary(); return render();
    case 'cat-move': {
      const l = library.categories, i = l.indexOf(findCat(ui.catId)), j = i + Number(b.dataset.dir);
      if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]]; saveLibrary(); return render();
    }
    case 'cat-delete': {
      if (!armed(b, 'Tap again to delete')) return;
      library.categories = library.categories.filter(c => c.id !== ui.catId);
      ui.catId = null; ui.phoneDetail = false; saveLibrary(); return render();
    }
    case 'cs-add': return openCatSongPicker(findCat(ui.catId));
    case 'cs-remove': case 'cs-up': case 'cs-down': {
      const l = catSongs(findCat(ui.catId), b.dataset.list), i = l.indexOf(id);
      if (act === 'cs-remove') l.splice(i, 1);
      else { const j = i + (act === 'cs-up' ? -1 : 1); if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; }
      saveBoth(); return render();
    }
    case 'listen': {
      const x = song(id), c = Model.clipOf(x);
      return Sound.playOne({ path: c.path, start: c.start, stop: c.stop, fadeOut: c.fadeOut, level: c.volume, label: `Listen · ${x.title}`, kind: 'sound' })
        .catch(() => toast('That song’s file isn’t on this device.'));
    }
    case 'sc-add': return openSongCatPicker(s);
    case 'sc-remove': { const l = catSongs(findCat(id), commonScope() ? 'common' : 'team'); l.splice(l.indexOf(s.id), 1); saveBoth(); return render(); }
    case 'go': return go(b.dataset.view);
    case 'load-demo': return loadDemo();
    /* lineups */
    case 'lu-up': Model.moveBy(l, id, -1); saveTeam(); return refreshOrderEditors();
    case 'lu-down': Model.moveBy(l, id, 1); saveTeam(); return refreshOrderEditors();
    case 'lu-bench': Model.benchPlayer(l, id); saveTeam(); return refreshOrderEditors();
    case 'lu-unbench': Model.unbenchPlayer(l, id); saveTeam(); return refreshOrderEditors();
    case 'lu-pick': ui.lineupId = id; return render();
    case 'lu-menu': {
      const cur = Model.findLineup(team, ui.lineupId);
      const act = name => () => { const el = document.createElement('button'); el.dataset.act = name; onAction({ target: el }); };
      return openMenu(cur.name, [
        { label: '+ New lineup', run: act('lu-new') },
        { label: 'Duplicate', run: act('lu-dup') },
        { label: 'Rename', run: act('lu-rename') },
        cur.id === game.lineupId ? null : { label: 'Use for the game', cls: 'gold', run: act('lu-use') },
        { label: 'Delete this lineup', cls: 'danger', disabled: team.lineups.length < 2, keepOpen: true,
          run: b => { if (!armed(b, 'Tap again to delete')) return; closeDialog(); deleteLineup(); } },
      ]);
    }
    case 'phone-back': ui.phoneDetail = false; Sound.stopPreview(); return render();
    case 'show-batters': ui.showAllBatters = !ui.showAllBatters; return render();
    case 'lu-use': game.lineupId = ui.lineupId; game.upNext = null; saveGame(); toast('The Game screen now uses this lineup, from batter 1.'); return render();
    case 'lu-new': {
      const name = await askText('New lineup', 'Name', `Game ${team.lineups.length + 1}`, 'Create');
      if (!name) return;
      ui.lineupId = Model.addLineup(team, name).id; saveTeam(); return render();
    }
    case 'lu-dup': {
      const src = Model.findLineup(team, ui.lineupId);
      const name = await askText('Duplicate lineup', 'Name for the copy', `${src.name} copy`, 'Duplicate');
      if (!name) return;
      ui.lineupId = Model.duplicateLineup(team, src.id, name).id; saveTeam(); return render();
    }
    case 'lu-rename': {
      const cur = Model.findLineup(team, ui.lineupId);
      const name = await askText('Rename lineup', 'Name', cur.name);
      if (name) { cur.name = name; saveTeam(); }
      return render();
    }
    case 'lu-delete': {
      if (!armed(b, 'Tap again to delete')) return;
      return deleteLineup();
    }
    /* roster */
    case 'pick-player': ui.playerId = id; ui.phoneDetail = true; main.scrollTop = 0; return render();
    case 'player-add': {
      const np = Model.addPlayer(team, { first: '', last: '', number: '' });
      ui.playerId = np.id; ui.phoneDetail = true; saveTeam(); render();
      return document.querySelector('[data-pf="first"]').focus();
    }
    case 'player-remove': {
      if (!armed(b, `Tap again to remove ${p.first || 'this player'}`)) return;
      const intro = p.intro && p.intro.path;
      Model.removePlayer(team, p.id); ui.playerId = null; saveTeam();
      await dropFileIfUnused(intro);
      return render();
    }
    case 'entry': p.entry = b.dataset.v; saveTeam(); return render();
    case 'listen-intro': return Sound.playOne({ path: p.intro.path, label: Model.playerName(p), kind: 'intro' }).catch(() => toast('That clip couldn’t play.'));
    case 'intro-remove': { const old = p.intro.path; p.intro = null; saveTeam(); await dropFileIfUnused(old); return render(); }
    case 'choose-song': return openSongPicker(p);
    case 'song-remove': p.songId = null; saveTeam(); return render();
    case 'edit-clip': ui.songId = p.songId; go(team.songs.some(x => x.id === p.songId) ? 'songs' : 'csongs'); ui.phoneDetail = true; return render();
    case 'test-walkup': {
      const plan = Model.walkupPlan(p, pool(), settings);
      if (plan) Sound.walkup(plan, `Test · ${Model.playerName(p)}`, { playerId: p.id }).catch(() => toast('A file for this player isn’t on this device.'));
      return;
    }
    /* songs */
    case 'pick-song': ui.songId = id; ui.phoneDetail = true; main.scrollTop = 0; return render();
    case 'pv-toggle':
      if (edit.track && edit.track.state === 'playing') { edit.cursor = edit.track.time; Sound.stopPreview(); edit.track = null; return previewTick(); }
      return previewFrom(edit.cursor >= (s.length || Infinity) - 0.5 ? 0 : edit.cursor);
    case 'pv-clip': return previewFrom(s.start, true);
    case 'set-start': setSongField(s, 'start', edit.cursor); saveBoth(); return refreshSongEditor();
    case 'set-stop':
      if (edit.cursor <= s.start + 0.5) return toast('The stop point has to be after the start point.');
      setSongField(s, 'stop', edit.cursor); saveBoth(); return refreshSongEditor();
    case 'step': {
      const k = b.dataset.k, d = +b.dataset.d;
      const cur = k === 'volume' ? Math.round(s.volume * 100) : k === 'stop' ? (s.stop ?? Math.min(s.length || 1e9, s.start + settings.walkupSeconds)) : s[k];
      setSongField(s, k, cur + d * (k === 'volume' ? 10 : 0.5));
      saveBoth(); return refreshSongEditor();
    }
    case 'song-delete': {
      if (!armed(b, deletePrompt(s))) return;
      return deleteSong(s);
    }
    case 'song-menu':
      return openMenu(s.title, [
        { label: 'Choose a different file', run: () => $('#songFile').click() },
        { label: 'Delete song', cls: 'danger', keepOpen: true, run: x => { if (armed(x, deletePrompt(s))) { closeDialog(); deleteSong(s); } } },
      ]);
  }
}
main.addEventListener('click', onAction);
$('#dlgBody').addEventListener('click', onAction);

function refreshSongEditor() {
  const s = song(ui.songId);
  if (!s) return;
  for (const inp of document.querySelectorAll('[data-sf]')) {
    if (inp === document.activeElement) continue;
    const k = inp.dataset.sf;
    inp.value = k === 'volume' ? Math.round(s.volume * 100) : k === 'stop' ? (s.stop == null ? '' : secs(s.stop)) : k === 'title' || k === 'artist' ? s[k] : secs(s[k]);
  }
  const hint = document.querySelector('.grid4 + .hint');
  if (hint) hint.innerHTML = `Plays ${clipText(s)}${s.length ? ` of ${mmss(s.length)}` : ''}. ${s.stop == null ? `With no stop point a walk-up plays for ${settings.walkupSeconds} seconds.` : ''}`;
  drawWave();
  const item = document.querySelector(`#songList [data-id="${CSS.escape(s.id)}"] .sub`);
  if (item) item.textContent = clipText(s);
}

// typing in fields
main.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.pf && t.type !== 'checkbox') {
    const p = player(ui.playerId);
    p[t.dataset.pf] = t.value;
    saveTeam();
    $('#phName').textContent = Model.playerName(p);
    $('#phNum').textContent = p.number || '–';
    $('#rosterList').innerHTML = rosterList();
  }
  if (t.id === 'songSearch') {
    ui.songQuery = t.value;
    const pos = t.selectionStart;
    renderSongs();
    const again = $('#songSearch'); again.focus(); again.setSelectionRange(pos, pos);
  }
  if (t.dataset.sf === 'title' || t.dataset.sf === 'artist') {
    const s = song(ui.songId); s[t.dataset.sf] = t.value; saveBoth();
    const item = document.querySelector(`#songList [data-id="${CSS.escape(s.id)}"] .name`);
    if (item) item.textContent = Model.songLabel(s);
  }
  if (t.dataset.cf === 'name') {
    const c = findCat(ui.catId); c.name = t.value; saveLibrary();
    const item = document.querySelector(`[data-act="pick-cat"][data-id="${CSS.escape(c.id)}"] .name`);
    if (item) item.textContent = c.name;
  }
});

main.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'luSelect') { ui.lineupId = t.value; return render(); }
  if (t.dataset.act === 'cat-show') { const cid = ui.catId; team.hiddenCats = t.checked ? team.hiddenCats.filter(x => x !== cid) : [...team.hiddenCats, cid]; saveTeam(); return render(); }
  if (t.id === 'gameLineup') { game.lineupId = t.value; game.upNext = null; saveGame(); return render(); }
  if (t.dataset.pf === 'active') {
    const p = player(ui.playerId); p.active = t.checked; Model.syncLineups(team); saveTeam(); return render();
  }
  if (t.dataset.sf && !['title', 'artist'].includes(t.dataset.sf)) {
    const s = song(ui.songId); setSongField(s, t.dataset.sf, t.value); saveBoth(); return refreshSongEditor();
  }
  if (t.dataset.act === 'intro-file' && t.files[0]) {
    const p = player(ui.playerId);
    const f = t.files[0];
    const old = p.intro && p.intro.path;
    const path = `Announcements/${p.id}-${safeName(f.name)}`;
    await storeFile(path, f);
    p.intro = { path, name: f.name };
    saveTeam();
    if (old && old !== path) await dropFileIfUnused(old);
    toast('Announcement added.');
    return render();
  }
  if (t.dataset.act === 'songs-add' && t.files.length) {
    toast('Adding songs…', 20000);
    const added = await addSongFiles([...t.files]);
    if (added.length) { ui.songId = added[0].id; toast(`${added.length} song${added.length > 1 ? 's' : ''} added.`); }
    else toast('Those files aren’t songs this app can play.');
    return render();
  }
  if (t.dataset.act === 'song-file' && t.files[0]) {
    const s = song(ui.songId);
    const f = t.files[0];
    const old = s.path;
    const path = commonScope() ? `Songs/${safeName(f.name)}` : Model.teamSongPath(team.id, safeName(f.name));
    if (path !== old && songsHere().some(x => x.path === path)) { toast('Another song already uses that file.'); return; }
    await storeFile(path, f);
    s.path = path; s.length = await Sound.measure(f);
    delete peaksCache[s.id]; Store.remove('peaks:' + s.id).catch(() => {});
    if (s.start > s.length) s.start = 0;
    if (s.stop != null && s.stop > s.length) s.stop = null;
    saveBoth();
    if (old !== path) await dropFileIfUnused(old);
    toast('File replaced. Check the start point.');
    return render();
  }
});

// tap or drag on the waveform moves the play point
main.addEventListener('pointerdown', e => {
  const w = e.target.closest('#wave');
  if (!w) return;
  const s = song(ui.songId), pk = s && peaksCache[s.id];
  if (!pk) return;
  const seek = ev => {
    const r = w.getBoundingClientRect();
    edit.cursor = Math.max(0, Math.min(pk.duration, ((ev.clientX - r.left) / r.width) * pk.duration));
    if (edit.track && edit.track.state === 'playing') edit.track.seek(edit.cursor);
    previewTick();
  };
  seek(e);
  w.setPointerCapture(e.pointerId);
  w.onpointermove = ev => { if (ev.buttons || ev.pointerType === 'touch') seek(ev); };
  w.onpointerup = () => { w.onpointermove = null; };
});
window.addEventListener('resize', () => later('wave', drawWave, 100));
phoneQuery.addEventListener('change', () => { if (!drag && !dlg.open) render(); });

// dock
$('#fadeAll').addEventListener('click', () => Sound.fadeAll(settings.fadeSeconds));
$('#stopAll').addEventListener('click', () => Sound.stopAll());
$('#master').addEventListener('input', e => { settings.masterVolume = +e.target.value; Sound.setMaster(settings.masterVolume); saveSettings(); });
$('#settingsBtn').addEventListener('click', openSettings);
$('#helpBtn').addEventListener('click', () => openHelp());
$('#teamName').addEventListener('click', openTeams);
let dockFrame = 0;
Sound.onChange(() => { if (!dockFrame) dockFrame = requestAnimationFrame(() => { dockFrame = 0; renderDock(); }); });

// keep the screen on during a game (where the browser supports it)
let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

/* ==================================================================== 12. HELP, INSTALL, UPDATES */

/* Release notes: release-notes.json, built into version.js as DIAMOND_NOTES by tools/release.py. Newest first. */
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const Notes = {
  TAG: { new: 'New', improved: 'Better', fixed: 'Fixed' },
  list() { return window.DIAMOND_NOTES || []; },
  date(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } },
  // versions after `from`, up to and including `to`
  between(list, from, to) { return (list || []).filter(n => (!from || cmpVer(n.version, from) > 0) && (!to || cmpVer(n.version, to) <= 0)); },
  items(n) { return `<ul class="rn">${n.notes.map(i => `<li><span class="rn-tag ${esc(i.type)}">${esc(this.TAG[i.type] || i.type)}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`; },
  html(list) { return list.map(n => (list.length > 1 ? `<p class="rn-head">Version ${esc(n.version)} · ${esc(this.date(n.date))}</p>` : '') + this.items(n)).join(''); },
  ver(n, open) {
    return `<details class="rn-ver"${open ? ' open' : ''}><summary>Version ${esc(n.version)} · ${esc(this.date(n.date))}${n.version === window.APP_VERSION ? ' <small>(this version)</small>' : ''}</summary>${this.items(n)}</details>`;
  },
};

// "Version 0.5.0 · built 2026-11-17 09:40": what to read out to the organizer over the phone
function versionText() {
  const B = window.DIAMOND_BUILD || {};
  return `Version ${window.APP_VERSION || ''}${B.built ? ` · built ${B.built}` : ''}`;
}

/* Install. Chrome on Android (and on computers) offers a one-tap install through
   `beforeinstallprompt`; Safari on iPad and iPhone doesn't, so they get the steps. */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; paintInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Diamond DJ is on your home screen. Open it from the Bees icon from now on.', 6000); paintInstall(); });
const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
function deviceKind() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Android/.test(ua)) return /Chrome/.test(ua) && !/EdgA|OPR|Firefox/.test(ua) ? 'android' : 'android-other';
  return /Chrome|Edg/.test(ua) ? 'computer' : 'other';
}
const INSTALL_STEPS = {
  android: `<ol class="steps"><li>Tap Chrome's menu <b>⋮</b> (top right).</li><li>Tap <b>Add to Home screen</b> (it may say <b>Install app</b>), then <b>Install</b>.</li>
    <li>Open Diamond DJ from the Bees icon from now on.</li></ol>
    <p class="hint">If it says the app is already installed but it won't open, choose <b>Create shortcut</b> instead: it works the same way.</p>`,
  samsung: `<ol class="steps"><li>Tap the menu <b>≡</b> (bottom right).</li><li>Tap <b>Add page to</b>, then <b>Home screen</b>.</li>
    <li>Open Diamond DJ from the Bees icon from now on.</li></ol><p class="hint">Chrome works best: open the web address in Chrome if you can.</p>`,
  ios: `<ol class="steps"><li>Tap <b>Share</b> (the square with an arrow, at the top on iPad, at the bottom on iPhone).</li>
    <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Always open Diamond DJ from that icon: Safari can clear a website's saved songs if it isn't on the Home Screen.</li></ol>`,
  'ios-other': `<p>On iPad and iPhone, apps go on the Home Screen from <b>Safari</b>. Open this web address in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>`,
  'android-other': `<p>Open this web address in <b>Chrome</b>, then tap Chrome's menu <b>⋮</b> › <b>Add to Home screen</b>.</p>`,
  computer: `<p>Click the install icon at the right end of the address bar, or the browser menu <b>⋮</b> › <b>Cast, save and share</b> › <b>Install page as app</b>.</p>`,
  other: `<p>Open this web address in <b>Chrome</b> (Android or computer) or <b>Safari</b> (iPad, iPhone), then add it to the home screen from the browser's menu.</p>`,
};
function paintInstall(steps = false) {
  const box = $('#installBox');
  if (!box) return;
  if (installed()) { box.innerHTML = '<p class="ok-line">✓ Installed. Diamond DJ is opening from its home-screen icon.</p>'; return; }
  box.innerHTML = `<div class="row"><button class="btn primary" id="setInstall">Install Diamond DJ</button></div>
    <p class="hint">Puts the app on the home screen with the Bees icon. It opens full screen and works without wifi.</p>
    ${steps ? `<div class="install-steps">${INSTALL_STEPS[deviceKind()]}</div>` : ''}`;
  $('#setInstall').onclick = async () => {
    if (!installPrompt) return paintInstall(true);
    const p = installPrompt; installPrompt = null;
    try {
      await p.prompt();
      const r = await p.userChoice;
      if (r && r.outcome !== 'accepted') paintInstall(true);
    } catch (e) { paintInstall(true); }
  };
}

/* Help: short answers here; every question, step by step, in the full guide (guide/index.html). */
function openHelp(section) {
  const list = Notes.list();
  const lastCheck = Drive.state.lastCheck ? new Date(Drive.state.lastCheck).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';
  const q = (title, body) => `<details class="faq"><summary>${title}</summary><div>${body}</div></details>`;
  openDialog('Help', `
    <p class="version-line">${esc(versionText())}</p>
    <a class="guide-link" href="guide/" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/></svg>
      <span><b>Full guide</b><small>Every question, step by step, for tablets, phones and iPad. Opens in your browser, even without wifi.</small></span>
      <svg class="out" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg></a>

    <h3>Game day</h3>
    <ol class="steps">
      <li>At home on wifi: <b>Settings › Check for updates</b>, so you have the newest roster, lineups and songs.</li>
      <li>At the field: connect the speaker first (Bluetooth or cable), then open Diamond DJ from its icon.</li>
      <li>On <b>Game</b>, check the lineup at the top and tap <b>New game</b> (twice) so every song can play again.</li>
      <li>When a batter walks up, tap <b>Play walkup</b>: the announcement, then their song. The order moves to the next batter by itself. <b>Skip</b> passes over someone.</li>
      <li>Batter not in order? Tap anyone in the list to play them. Press and hold a name to make them up next.</li>
      <li><b>Music</b> (Warm-up, Pitchers, Crowd favourites…): tap a category, then a song to play it; tap it again to fade out. <b>Shuffle</b> picks one not played yet this game.</li>
      <li><b>Fade out</b> when play starts. <b>Stop</b> cuts everything at once.</li>
      <li>Tap <b>Lock</b> so nobody changes the setup by accident. Game and Lineup stay open. Press and hold the lock for 1.5 seconds to unlock.</li>
    </ol>

    <h3>Common questions</h3>
    ${q('Nothing plays.', `<p>Check the tablet's volume, the <b>Volume</b> slider at the bottom, and that the speaker is connected. A batter marked <b>Not ready</b> has no announcement or song on this device yet: tap <b>Settings › Check for updates</b> on wifi.</p>`)}
    ${q('A batter says “No announcement”.', `<p>Their song still plays, with no announcement first. The clip is added in <b>Roster</b> (tap the player, then <b>Choose a clip</b>), or comes with <b>Check for updates</b> once the organizer publishes it.</p>`)}
    ${q('The batting order changed (someone is late, sick or leaving early).', `<p>On <b>Game</b>, tap <b>Edit order</b>: drag a batter to move them, or tap <b>Bench</b> to take them out (and <b>Add back</b> when they arrive). It saves as you go. Saved lineups for other games are in <b>Settings › Lineups</b>.</p>`)}
    ${q('The wrong song or player played.', `<p>Tap <b>Fade out</b>, then tap the right batter in the list. To put the order back where it should be, press and hold the batter who should be up next.</p>`)}
    ${q('A music category is empty.', `<p>It has no songs yet. A team organizer adds them in <b>Settings › Team setup › Music</b>; the Diamond DJ Admin adds common ones in <b>Settings › Admin › Music categories</b>.</p>`)}
    ${q('Settings is gone.', `<p>The app is locked. Press and hold the lock button at the top for a second and a half.</p>`)}
    ${q('The screen turns off during the game.', `<p>Diamond DJ keeps the screen on while it's open where the device allows. If it still turns off: <b>Android:</b> Settings › Display › Screen timeout › the longest time. <b>iPad / iPhone:</b> Settings › Display &amp; Brightness › Auto-Lock › Never.</p>`)}
    ${q('How do I put it on the home screen?', `<p><b>Settings › This device › Install Diamond DJ</b>. If your device can't do it in one tap, it shows you the steps. Then always open it from the Bees icon.</p>`)}
    ${q('It says “A new version of Diamond DJ is ready”.', `<p>Tap <b>Update now</b> when nothing is playing. Your teams, lineups and songs stay. <b>Later</b> keeps this version until the app is opened again. Small fixes install by themselves; the screen may blink for a second.</p>`)}
    ${q('The wrong team is showing.', `<p>Tap the team name at the top left and pick your team. Missing? Tap <b>Settings › Check for updates</b> and tick it.</p>`)}
    ${q('Will Check for updates undo my lineup?', `<p>No. A lineup changed on this device is kept. Roster and music changes made on this device are flagged first, so you can choose to keep them.</p>`)}

    <div ${Drive.state.editor ? '' : 'hidden'}>
    <h3>For organizers</h3>
    ${q('How do I send changes to every device?', `<p><b>Settings › Team setup › Publish</b> (and, for the common songs and music categories, <b>Settings › Admin › Publish</b>). It lists what will be sent (new songs, announcement clips, the team file) before anything goes. Volunteers get it the next time they tap <b>Check for updates</b>. Nothing in Drive is deleted, and Drive keeps earlier versions.</p>`)}
    ${q('How do I add a volunteer?', `<p>Share the <b>Diamond DJ</b> Google Drive folder with their Google account as <b>Viewer</b> (or <b>Editor</b> for someone who will publish). While the app is in testing, also add them in Google Cloud (Diamond DJ project › Google Auth Platform › Audience › <b>Test users</b>).</p>`)}
    ${q('How do I add a song or set where it starts?', `<p><b>Songs › Add songs</b> and pick MP3s. Tap a song, play it, then <b>Set start here</b> at the catchy part and <b>Set stop here</b> where it should end. Link it to a player in <b>Roster</b>, then publish.</p>`)}
    </div>

    <details id="whatsNew" class="whats-new" ${list.length ? '' : 'hidden'} ${section === 'news' ? 'open' : ''}><summary>What's new</summary>
      ${list.slice(0, 3).map((n, i) => Notes.ver(n, i === 0)).join('')}
      ${list.length > 3 ? '<p class="hint"><a href="#appHistory" id="toHistory">Every past update</a></p>' : ''}</details>
    ${list.length > 3 ? `<details id="appHistory" class="whats-new"><summary>App history: every update</summary>${list.map(n => Notes.ver(n, false)).join('')}</details>` : ''}
    <p class="hint">Still stuck? Send your organizer the version line at the top and what happened.</p>
    <p class="hint about">Diamond DJ ${esc(versionText())} · ${esc(team.name)} · Last Drive check: ${esc(lastCheck)}</p>`);
  const th = $('#toHistory');
  if (th) th.onclick = e => { e.preventDefault(); $('#appHistory').open = true; $('#appHistory').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  if (section === 'news') setTimeout(() => $('#whatsNew').scrollIntoView({ block: 'start' }), 0);
}

/* Updates. A new version downloads in the background (sw.js). Offer it with a banner, but never
   while something is playing or Drive is downloading. "Later" keeps this version until the app is
   next opened. A quiet release (small fixes) switches over by itself when it can't get in the way. */
const appQuiet = () => !Sound.playing().some(t => t.state !== 'done') && dui.phase !== 'busy';
function placeBar(el) {
  const dock = $('.dock');
  const at = () => { el.style.bottom = `${Math.round(innerHeight - dock.getBoundingClientRect().top + 10)}px`; };
  at(); addEventListener('resize', at);
}
const Update = {
  async ready() {
    if (this.shown) return;
    clearTimeout(this._w);
    if (!appQuiet()) { this._w = setTimeout(() => this.ready(), 2000); return; }
    this.shown = true;
    let fresh = [];
    try { fresh = Notes.between(await (await fetch('release-notes.json', { cache: 'no-cache' })).json(), window.APP_VERSION); } catch (e) {}
    $('#updateVer').textContent = fresh.length ? ` (version ${fresh[0].version})` : '';
    $('#updateNotes').hidden = !fresh.length;
    $('#updateNotesList').innerHTML = Notes.html(fresh);
    $('#newsBar').hidden = true; // one message at a time
    const el = $('#updateBar'); el.hidden = false; placeBar(el);
    $('#updateNow').onclick = async () => {
      $('#updateNow').disabled = true; $('#updateNow').textContent = 'Updating…';
      Sound.stopAll();
      await saveNow().catch(() => {});
      location.reload();
    };
    $('#updateLater').onclick = () => { el.hidden = true; };
  },
  quiet() {
    if (this.shown) return; // a banner for a bigger update is up: that one wins
    this.pending = true;
    if (Date.now() - Seen.at < 20000 && !Seen.touched) this.applyQuiet();
  },
  async applyQuiet() {
    if (!this.pending || this.shown || this._going || !appQuiet() || dlg.open || drag) return;
    this._going = true;
    await saveNow().catch(() => {});
    location.reload();
  },
};
// when the app was last opened or brought back on screen, and whether it's been touched since
const Seen = { at: Date.now(), touched: false };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  Seen.at = Date.now(); Seen.touched = false;
  Update.applyQuiet();
});
document.addEventListener('pointerdown', () => { Seen.touched = true; }, { capture: true });

/* Once, right after an update: "Diamond DJ updated to 0.5.0 · See what's new". Not on a brand-new
   install, not for quiet releases, and not while coming back from Google sign-in. */
const News = {
  KEY: 'diamond.seenVersion',
  check({ signingIn, existing }) {
    let seen = null;
    try { seen = localStorage.getItem(this.KEY); } catch (e) {}
    if (!seen && existing) seen = '0.4.0'; // set up before versions were tracked
    if (!seen || cmpVer(window.APP_VERSION, seen) <= 0) return this.mark();
    if (signingIn) return;
    const fresh = Notes.between(Notes.list(), seen, window.APP_VERSION).filter(n => !n.quiet);
    if (!fresh.length) return this.mark();
    const show = () => {
      if (!appQuiet() || dlg.open) { setTimeout(show, 2000); return; }
      this.mark();
      if (!$('#updateBar').hidden) return; // an even newer version is waiting: that message wins
      const el = $('#newsBar'); $('#newsVer').textContent = window.APP_VERSION; el.hidden = false; placeBar(el);
      $('#newsSee').onclick = () => { el.hidden = true; openHelp('news'); };
      $('#newsOk').onclick = () => { el.hidden = true; };
    };
    setTimeout(show, 1200);
  },
  mark() { try { localStorage.setItem(this.KEY, window.APP_VERSION); } catch (e) {} },
};

function startUpdates() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  const hadCopy = !!navigator.serviceWorker.controller; // not on the very first install
  navigator.serviceWorker.addEventListener('message', e => {
    if (!hadCopy || !e.data) return;
    if (e.data.type === 'diamond-updated') Update.ready();
    if (e.data.type === 'diamond-updated-quiet') Update.quiet();
  });
  // look for a new version each time the app is opened or comes back on screen (at most once a minute)
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    let last = 0;
    const check = () => { if (navigator.onLine !== false && Date.now() - last > 60000) { last = Date.now(); reg.update().catch(() => {}); } };
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }).catch(e => console.warn('Offline copy not installed', e));
}

async function start() {
  Sound.setLoader(path => Store.audio.get(path));
  let cur = null, existing = false;
  try {
    let ts, oneTeam, lib, gs, oneGame, st, paths;
    [ts, cur, oneTeam, lib, gs, oneGame, st, paths] = await Promise.all([Store.get('teams'), Store.get('currentTeam'),
      Store.get('team'), Store.get('library'), Store.get('games'), Store.get('game'), Store.get('settings'), Store.audio.paths()]);
    settings = { ...DEFAULTS, ...(st || {}) };
    library = lib ? Model.checkLibrary(lib) : Model.newLibrary();
    paths.forEach(p => stored.add(p));
    games = gs || {};
    existing = !!(ts || oneTeam);
    for (const raw of Object.values(ts || {})) { const t = Model.checkTeam(raw); teams[t.id] = t; }
    if (!ts && oneTeam) { // version 0.2 kept one team: carry it (and its game state) over
      const t = Model.checkTeam(oneTeam);
      teams[t.id] = t;
      if (oneGame) games[t.id] = oneGame;
    }
    await Drive.load();
  } catch (e) {
    console.error(e);
    library = library || Model.newLibrary();
    toast('This browser can’t save on the device. Open the app from its web address or the home-screen icon.', 8000);
  }
  if (!Object.keys(teams).length) { const t = Model.newTeam('U13 Burlington Bees', 'U13 Bees'); teams[t.id] = t; }
  useTeam(teams[cur] ? cur : Object.keys(teams)[0]);
  Sound.settings.fadeSeconds = settings.fadeSeconds;
  Sound.setMaster(settings.masterVolume);
  $('#master').value = settings.masterVolume;
  applyLock();
  render();
  renderDock();
  const signingIn = resumeAfterSignIn(); // back from Google's sign-in page?
  keepAwake();
  Store.persist();
  News.check({ signingIn, existing });
  startUpdates();
}
start();
