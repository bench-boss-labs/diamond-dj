/* Diamond DJ 0.9: the team's look, Admin › Teams (and Add a team), Admin › People and access,
 * and a player's own part of a walk-up song.
 *
 * Loaded before app.js; everything here runs only when app.js calls it, so it can use app.js's
 * state (team, teams, library, settings, ui) and helpers ($, esc, toast, openDialog, go…).
 */
'use strict';

/* ==================================================================== THE TEAM'S LOOK */

// the header: the team's main colour behind it, a stripe in its second colour, its logo
function applyLook() {
  const head = document.querySelector('.head');
  if (!head || !team) return;
  // the Admin screen is about every team, so it keeps the Diamond DJ header
  const c = ADMIN_VIEWS.includes(ui.view) ? {} : team.colors || {};
  head.classList.toggle('team-look', !!c.main);
  head.classList.toggle('team-light', !!c.main && Model.isLight(c.main));
  head.style.setProperty('--team-main', c.main || '');
  head.style.setProperty('--team-accent', c.accent || 'transparent');
  const logo = ADMIN_VIEWS.includes(ui.view) ? null : team.logo;
  head.classList.toggle('has-team-logo', !!logo);
  const img = head.querySelector('.logo');
  const src = logo || 'icons/logo.png';
  if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
}

// a small square for a team: its logo, or its initials on its colour
function teamBadge(t, size = 40) {
  const c = (t.colors && t.colors.main) || '#0B2447';
  const initials = (t.short || t.name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '?';
  return `<span class="team-badge" style="width:${size}px;height:${size}px;background:${t.logo ? '#fff' : c};color:${Model.isLight(c) && !t.logo ? '#0B1730' : '#fff'};font-size:${Math.round(size * 0.36)}px">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : esc(initials)}</span>`;
}

// a picture file → a small PNG kept in the team file (so it travels with the team, no extra download)
async function logoFrom(file) {
  if (!/^image\//.test(file.type)) throw new Error('not an image');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w0 = img.naturalWidth || 192, h0 = img.naturalHeight || 192, k = Math.min(1, 192 / Math.max(w0, h0));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

function lookHtml(t) {
  const c = t.colors || {};
  const sw = (key, x) => `<button type="button" class="swatch-btn ${x === c[key] ? 'on' : ''}" data-look="${key}" data-color="${x}" style="background:${x}" aria-label="Colour ${x}" aria-pressed="${x === c[key]}"></button>`;
  const light = c.main && Model.isLight(c.main);
  return `<div class="look-preview ${light ? 'light' : ''}" style="background:${c.main || '#0B2447'};box-shadow:inset 0 -5px 0 ${c.accent || 'transparent'}">
      ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : '<img src="icons/logo.png" alt="">'}<span>${esc(t.short || t.name || 'Team')}</span><i>How the top of the screen looks</i></div>
    <div class="field">Logo<div class="row">
      <label class="btn small file-btn">${t.logo ? 'Choose a different picture' : 'Choose a picture'}<input type="file" accept="image/*" data-look="logo"></label>
      ${t.logo ? '<button type="button" class="btn small danger" data-look="logo-remove">Remove</button>' : ''}</div>
      <span class="hint">A square PNG with a see-through background looks best. It’s made small and kept with the team.</span></div>
    <div class="field">Header colour<div class="row swatches">${Model.TEAM_COLORS.map(x => sw('main', x)).join('')}
      <label class="swatch-btn custom" title="Another colour" aria-label="Another colour"><input type="color" data-look="main-custom" value="${c.main || '#0B2447'}">+</label>
      ${c.main ? '<button type="button" class="btn small" data-look="main-clear">Diamond DJ navy</button>' : ''}</div></div>
    <div class="field">Stripe under the header<div class="row swatches">${Model.TEAM_COLORS.map(x => sw('accent', x)).join('')}
      <label class="swatch-btn custom" title="Another colour" aria-label="Another colour"><input type="color" data-look="accent-custom" value="${c.accent || '#F5B700'}">+</label>
      ${c.accent ? '<button type="button" class="btn small" data-look="accent-clear">No stripe</button>' : ''}</div></div>
    <p class="hint">Buttons keep the Diamond DJ blue and gold, so they look the same for every team.</p>`;
}

// wire up a look editor inside box; changed() runs after every change
function bindLook(box, t, changed) {
  const redo = () => { box.innerHTML = lookHtml(t); bindLook(box, t, changed); changed(); };
  box.onclick = e => {
    const b = e.target.closest('button[data-look]');
    if (!b) return;
    const k = b.dataset.look;
    t.colors = t.colors || { main: null, accent: null };
    if (k === 'main' || k === 'accent') t.colors[k] = b.dataset.color;
    if (k === 'main-clear') t.colors.main = null;
    if (k === 'accent-clear') t.colors.accent = null;
    if (k === 'logo-remove') t.logo = null;
    redo();
  };
  box.onchange = async e => {
    const k = e.target.dataset.look;
    if (k === 'main-custom' || k === 'accent-custom') { t.colors[k.split('-')[0]] = e.target.value.toUpperCase(); return redo(); }
    if (k === 'logo' && e.target.files[0]) {
      try { t.logo = await logoFrom(e.target.files[0]); redo(); }
      catch (err) { toast('That picture couldn’t be used. Try a PNG or JPG.'); }
    }
  };
}

/* ==================================================================== ADMIN › TEAMS */

const aui = { teamId: null, filter: 'all' };
function teamStatus(t) {
  const e = Drive.localEdits(t);
  return e === null ? 'new' : e ? 'changed' : 'ok';
}
const TEAM_STATE_TEXT = { new: 'Not published yet', changed: 'Changes to publish', ok: 'Published' };

function renderAdminTeams() {
  const all = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
  if (!all.find(t => t.id === aui.teamId)) aui.teamId = phone() ? null : (team && team.id);
  const shown = all.filter(t => aui.filter === 'all' || (aui.filter === 'changes' ? teamStatus(t) !== 'ok' : teamStatus(t) === 'new'));
  const count = s => all.filter(t => teamStatus(t) === s).length;
  const players = all.reduce((n, t) => n + t.players.length, 0);
  const tile = (n, label, cls = '') => `<div class="tile ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const people = peo.data ? peo.data.access : null;
  const orgs = t => { const a = people && people.teams.find(x => x.id === t.id); return a ? a.organizers : null; };
  const item = t => {
    const s = teamStatus(t);
    return `<button class="item team-item ${t.id === aui.teamId ? 'sel' : ''}" data-ateam="${esc(t.id)}">${teamBadge(t, 40)}
      <span class="grow"><span class="name">${esc(t.name)}</span><span class="sub">${t.players.length} player${t.players.length === 1 ? '' : 's'} · ${t.songs.length} team song${t.songs.length === 1 ? '' : 's'}</span></span>
      <span class="pill st-${s}">${TEAM_STATE_TEXT[s]}</span></button>`;
  };
  const t = teams[aui.teamId];
  let detail = '<div class="empty"><p>Choose a team to see it here.</p></div>';
  if (t) {
    const st = Drive.state.teams[t.id];
    const s = teamStatus(t);
    const o = orgs(t);
    const when = st && st.lastSync ? new Date(st.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    detail = `<section class="panel stack" style="gap:16px">${backBar(t.name)}
      <div class="team-detail-head">${teamBadge(t, 64)}<div class="grow"><h2>${esc(t.name)}</h2><span class="hint">Short name ${esc(t.short || t.name)}${t.id === team.id ? ' · in use on this device' : ''}</span></div>
        <span class="pill st-${s}">${TEAM_STATE_TEXT[s]}</span></div>
      <div class="look-preview small ${t.colors && t.colors.main && Model.isLight(t.colors.main) ? 'light' : ''}" style="background:${(t.colors && t.colors.main) || '#0B2447'};box-shadow:inset 0 -5px 0 ${(t.colors && t.colors.accent) || 'transparent'}">
        <img src="${esc(t.logo || 'icons/logo.png')}" alt=""><span>${esc(t.short || t.name)}</span></div>
      <dl class="facts">
        <div><dt>Players</dt><dd>${t.players.length} (${t.players.filter(p => p.songId).length} with a walk-up song)</dd></div>
        <div><dt>Team songs</dt><dd>${t.songs.length}</dd></div>
        <div><dt>Lineups</dt><dd>${t.lineups.length}</dd></div>
        <div><dt>Published</dt><dd>${when ? esc(when) : 'Not from this device'}</dd></div>
        <div><dt>Team organizers</dt><dd>${o ? (o.length ? esc(o.map(p => p.emailAddress || p.displayName).join(', ')) : 'None yet') : '<button class="link-btn" data-ago="cpeople">See People and access</button>'}</dd></div>
      </dl>
      <div class="row wrap">
        <button class="btn navy" data-aopen="roster">Team setup</button>
        <button class="btn" data-aopen="teaminfo">Name, logo and colours</button>
        <button class="btn" data-aopen="publish">${s === 'ok' ? 'Publish' : 'Publish now'}</button>
        <button class="btn" data-ago="cpeople">Who has access</button>
        ${st ? `<a class="btn" href="https://drive.google.com/drive/folders/${esc(st.folderId)}" target="_blank" rel="noopener">Open in Google Drive</a>` : ''}
      </div>
      ${t.id !== team.id ? '<p class="hint">Team setup and Publish switch this device to the team.</p>' : ''}
    </section>`;
  }
  main.innerHTML = `<div class="stack admin-teams">
    <div class="tiles">${tile(all.length, `team${all.length === 1 ? '' : 's'} on this device`)}${tile(players, 'players')}${tile(count('ok'), 'published')}${tile(count('changed') + count('new'), 'with changes to publish', count('changed') + count('new') ? 'warn-tile' : '')}</div>
    <div class="cols ${listMode()}">
      <aside class="stack"><div class="row"><span class="section-title">Teams</span><span class="spacer"></span><button class="btn primary small" id="addTeam">+ Add a team</button></div>
        <div class="seg small" role="group" aria-label="Show">${[['all', 'All'], ['changes', 'Changes to publish'], ['new', 'Not published']].map(([k, l]) => `<button data-afilter="${k}" aria-pressed="${aui.filter === k}">${l}</button>`).join('')}</div>
        <div class="list">${shown.map(item).join('') || '<p class="hint">No teams here.</p>'}</div>
        <p class="hint">Teams someone else published show up here after Settings › Updates › Check for updates.</p></aside>
      ${detail}</div></div>`;
  main.querySelector('.admin-teams').onclick = e => {
    const b = e.target.closest('[data-ateam],[data-afilter],[data-aopen],[data-ago],#addTeam');
    if (!b) return;
    if (b.id === 'addTeam') return openAddTeam();
    if (b.dataset.afilter) { aui.filter = b.dataset.afilter; return render(); }
    if (b.dataset.ateam) { aui.teamId = b.dataset.ateam; ui.phoneDetail = true; return render(); }
    if (b.dataset.ago) return go(b.dataset.ago);
    if (b.dataset.aopen) {
      if (aui.teamId !== team.id) { Sound.fadeAll(); useTeam(aui.teamId); toast(`Now using ${team.name}.`); }
      return go(b.dataset.aopen);
    }
  };
}

/* ---------------- Add a team: 1 name and look · 2 how it starts · 3 who has access */
let wiz = null;
function openAddTeam() {
  wiz = { step: 1, t: Model.newTeam('', ''), start: 'empty', copyFrom: team.id, people: [{ email: '', role: 'organizer' }] };
  wiz.t.short = '';
  paintWizard();
}
function paintWizard() {
  const { t, step } = wiz;
  const others = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
  const steps = ['Name and look', 'How it starts', 'Who has access'];
  const head = `<ol class="wiz-steps">${steps.map((s, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><b>${i + 1}</b>${s}</li>`).join('')}</ol>`;
  let body = '';
  if (step === 1) body = `<div class="grid2"><label class="field">Team name<input type="text" id="wzName" value="${esc(t.name)}" placeholder="e.g. U11 Hornets" autocomplete="off"></label>
      <label class="field">Short name (top of the screen)<input type="text" id="wzShort" value="${esc(t.short)}" maxlength="16" placeholder="${esc(t.name || 'Hornets')}" autocomplete="off"></label></div>
    <div id="wzLook" class="stack look-box">${lookHtml(t)}</div>`;
  if (step === 2) body = `<div class="list choice">
      <label class="item"><input type="radio" name="wzStart" value="empty" ${wiz.start === 'empty' ? 'checked' : ''}><span class="grow"><span class="name">Start empty</span>
        <span class="sub">No players or team songs yet. The common songs and music categories are there from the start.</span></span></label>
      ${others.length ? `<label class="item"><input type="radio" name="wzStart" value="copy" ${wiz.start === 'copy' ? 'checked' : ''}><span class="grow"><span class="name">Copy the music from another team</span>
        <span class="sub">Its team songs (with their start and stop points) and the songs it added to music categories. Players and lineups aren’t copied.</span>
        <select id="wzFrom">${others.map(o => `<option value="${esc(o.id)}" ${o.id === wiz.copyFrom ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></span></label>` : ''}
    </div>`;
  if (step === 3) body = `<p>Add the team’s organizers and volunteers. Google emails each of them a link.</p>
    <div class="stack" id="wzPeople">${wiz.people.map((p, i) => `<div class="row person-row">
      <input type="email" data-wp="${i}" value="${esc(p.email)}" placeholder="name@gmail.com" autocomplete="off" aria-label="Email address">
      <select data-wr="${i}" aria-label="Role"><option value="organizer" ${p.role === 'organizer' ? 'selected' : ''}>Team organizer</option><option value="volunteer" ${p.role === 'volunteer' ? 'selected' : ''}>Volunteer</option></select>
      <button type="button" class="btn small" data-wx="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
    <button type="button" class="btn outline small" id="wzMore">+ Add someone</button>
    <p class="hint"><b>Team organizer</b>: Editor on the team’s Google Drive folder (changes and publishes the team). <b>Volunteer</b>: runs the music on game day.
      Everyone also gets Viewer on the Diamond DJ folder, so they get the common songs. You can leave this empty and add people later in Admin › People.</p>
    ${Drive.ready() ? '<p class="hint">Done publishes the new team, which makes its Google Drive folder, then shares it.</p>' : '<p class="hint">Google Drive isn’t available here, so the team is made on this device only and the people wait until it’s published.</p>'}`;
  openDialog('Add a team', `<div class="stack wizard">${head}${body}
    <p class="wiz-error" id="wzError" hidden></p>
    <div class="row"><button type="button" class="btn" id="wzBack">${step === 1 ? 'Cancel' : 'Back'}</button><span class="spacer"></span>
      <button type="button" class="btn primary" id="wzNext">${step === 3 ? 'Make the team' : 'Next'}</button></div></div>`,
    () => document.body.classList.remove('wizard-open'));
  document.body.classList.add('wizard-open');
  if (step === 1) {
    $('#wzName').oninput = e => { t.name = e.target.value; $('#wzError').hidden = true; repaintPreview(); };
    $('#wzShort').oninput = e => { t.short = e.target.value; repaintPreview(); };
    bindLook($('#wzLook'), t, () => {});
    $('#wzName').focus();
  }
  if (step === 2) {
    for (const r of document.querySelectorAll('[name="wzStart"]')) r.onchange = () => { wiz.start = r.value; };
    if ($('#wzFrom')) $('#wzFrom').onchange = e => { wiz.copyFrom = e.target.value; wiz.start = 'copy'; paintWizard(); };
  }
  if (step === 3) {
    $('#wzPeople').oninput = e => { if (e.target.dataset.wp) wiz.people[+e.target.dataset.wp].email = e.target.value.trim(); };
    $('#wzPeople').onchange = e => { if (e.target.dataset.wr) wiz.people[+e.target.dataset.wr].role = e.target.value; };
    $('#wzPeople').onclick = e => { const x = e.target.closest('[data-wx]'); if (x) { wiz.people.splice(+x.dataset.wx, 1); paintWizard(); } };
    $('#wzMore').onclick = () => { wiz.people.push({ email: '', role: 'volunteer' }); paintWizard(); document.querySelector(`[data-wp="${wiz.people.length - 1}"]`).focus(); };
  }
  $('#wzBack').onclick = () => { if (wiz.step === 1) return closeDialog(); wiz.step--; paintWizard(); };
  $('#wzNext').onclick = () => wizardNext();
}
function repaintPreview() {
  const p = document.querySelector('#wzLook .look-preview span');
  if (p) p.textContent = wiz.t.short || wiz.t.name || 'Team';
}
function wizError(msg) { const el = $('#wzError'); el.textContent = msg; el.hidden = false; }
async function wizardNext() {
  const { t } = wiz;
  if (wiz.step === 1) {
    t.name = t.name.trim(); t.short = (t.short || '').trim() || t.name;
    if (!t.name) return wizError('Give the team a name.');
    if (Object.values(teams).some(o => o.name.toLowerCase() === t.name.toLowerCase())) return wizError(`There’s already a team called ${t.name}.`);
    wiz.step = 2; return paintWizard();
  }
  if (wiz.step === 2) { wiz.step = 3; return paintWizard(); }
  const people = wiz.people.filter(p => p.email);
  const bad = people.find(p => !Model.emailOk(p.email));
  if (bad) return wizError(`“${bad.email}” doesn’t look like an email address.`);
  // make the team
  if (wiz.start === 'copy' && teams[wiz.copyFrom]) {
    const src = teams[wiz.copyFrom];
    for (const s of src.songs) {
      const path = Model.teamSongPath(t.id, Model.fileName(s.path));
      const blob = await Store.audio.get(s.path).catch(() => null);
      if (blob) await storeFile(path, blob);
      t.songs.push({ ...JSON.parse(JSON.stringify(s)), path });
    }
    t.music = JSON.parse(JSON.stringify(src.music || {}));
    t.hiddenCats = [...(src.hiddenCats || [])];
  }
  Model.checkTeam(t);
  Sound.fadeAll();
  addTeam(t);
  for (const p of people) queueAccess({ op: 'add', email: p.email, role: p.role, teamId: t.id });
  closeDialog();
  aui.teamId = t.id;
  if (Drive.ready()) {
    go('publish');
    pui.note = people.length ? `Publish ${t.name} to make its Google Drive folder; then it’s shared with ${people.length} ${people.length === 1 ? 'person' : 'people'}.` : '';
    startPublish('team');
  } else {
    go('cteams');
    toast(`${t.name} added. Publish it to share it with the team.`);
  }
}

/* ==================================================================== ADMIN › PEOPLE AND ACCESS */

const peo = { phase: 'idle', data: null, note: '', addRole: 'volunteer', addTeam: '' };

// sharing waiting for a team to be published (its folder doesn't exist yet), or for a sign-in
function queueAccess(job) {
  Drive.state.pending = (Drive.state.pending || []).filter(j => !(j.email.toLowerCase() === job.email.toLowerCase() && j.teamId === job.teamId));
  Drive.state.pending.push(job);
  Drive.save();
}
const pendingFor = teamId => (Drive.state.pending || []).filter(j => !teamId || j.teamId === teamId);

function shareMessage(role, t) {
  const app = location.origin + location.pathname.replace(/index\.html$/, '');
  const what = role === 'admin' ? 'as a Diamond DJ Admin' : role === 'organizer' ? `as a team organizer for ${t ? t.name : 'a team'}` : `as a volunteer${t ? ` for ${t.name}` : ''}`;
  return `You’ve been added to Diamond DJ ${what}. Open ${app} on your phone or tablet, tap Settings › Updates › Check for updates, and sign in with this Google account.`;
}

/* Share with one person. Organizers: Editor on the team folder, Viewer on the Diamond DJ folder
   (one email, from the team folder). Volunteers: Viewer on the Diamond DJ folder. Admins: Editor on it. */
async function grant(job, rootPerms) {
  const root = Drive.folderId();
  const t = job.teamId ? teams[job.teamId] : null;
  const onRoot = (rootPerms || []).find(p => String(p.emailAddress || '').toLowerCase() === job.email.toLowerCase());
  if (job.role === 'admin') {
    if (onRoot && onRoot.role !== 'reader' && onRoot.role !== 'commenter') return;
    return onRoot ? Drive.setRole(root, onRoot.id, 'writer') : Drive.share(root, job.email, 'writer', shareMessage('admin'));
  }
  if (job.role === 'organizer') {
    const folder = job.folderId || (Drive.state.teams[job.teamId] || {}).folderId;
    if (!folder) throw new Error('drive:nofolder');
    await Drive.share(folder, job.email, 'writer', shareMessage('organizer', t));
    if (!onRoot) await Drive.share(root, job.email, 'reader', '', { notify: false });
    return;
  }
  if (!onRoot) await Drive.share(root, job.email, 'reader', shareMessage('volunteer', t));
}

// run the sharing that's waiting (for one team, or all); returns how many were shared
async function runPending(teamId, say = () => {}) {
  const jobs = pendingFor(teamId).filter(j => j.role !== 'organizer' || (Drive.state.teams[j.teamId] || {}).folderId);
  if (!jobs.length) return 0;
  say('Sharing with the team…');
  let rootPerms = await Drive.permissions(Drive.folderId());
  let n = 0;
  for (const j of jobs) {
    say(`Sharing with ${j.email}…`);
    await grant(j, rootPerms);
    Drive.state.pending = Drive.state.pending.filter(x => x !== j);
    n++;
    rootPerms = await Drive.permissions(Drive.folderId());
  }
  await Drive.save();
  return n;
}

async function loadPeople() {
  if (!Drive.ready()) return;
  if (!Auth.token() || !Auth.canWrite()) { peo.phase = 'busy'; peo.note = 'Signing in to Google…'; paintPeople(); return Auth.signIn('people', { write: true }); }
  peo.phase = 'busy'; peo.note = 'Reading who has access…'; paintPeople();
  try {
    if (pendingFor().length) await runPending(null, t => { peo.note = t; paintPeople(); });
    const a = await Drive.access(t => { peo.note = t; const el = $('#peoSay'); if (el) el.textContent = t; });
    peo.data = { ...a, access: Model.accessFrom(a.rootPerms, a.teams) };
    peo.phase = 'idle'; peo.note = '';
  } catch (e) { peopleFailed(e); return; }
  paintPeople();
}
function peopleFailed(e) {
  peo.phase = 'idle';
  if (e && e.message === 'drive:signin') { peo.note = 'Signing in to Google…'; paintPeople(); return Auth.signIn('people', { write: true }); }
  peo.note = e && e.message === 'drive:noteditor' ? 'Only a Diamond DJ Admin (Editor on the Diamond DJ folder) can see and change who has access.'
    : e && /^drive:400/.test(e.message) ? 'Google didn’t accept that. Check the email address and try again.'
    : e && e.message === 'drive:nofolder' ? 'That team isn’t published yet. Publish it first; the sharing waits until then.' : driveError(e);
  paintPeople();
  toast(peo.note, 6000);
}
async function changeAccess(label, fn) {
  peo.phase = 'busy'; peo.note = label; paintPeople();
  try { await fn(); } catch (e) { return peopleFailed(e); }
  await loadPeople();
}

function renderPeople() {
  main.innerHTML = `<div class="stack people-page"><div class="row"><span class="section-title">People and access</span><span class="spacer"></span>
      <button class="btn small" id="peoRefresh">${peo.data ? 'Refresh' : 'See who has access'}</button></div>
    <p class="hint">Who can use Diamond DJ comes from Google Drive sharing. Changes here change the sharing straight away (Google emails people you add).</p>
    <div id="peoBox" class="stack"></div></div>`;
  $('#peoRefresh').onclick = () => loadPeople();
  paintPeople();
  if (!peo.data && peo.phase === 'idle' && !peo.note && Auth.token() && Auth.canWrite()) loadPeople();
}

function paintPeople() {
  const box = $('#peoBox');
  if (!box) return;
  const rb = $('#peoRefresh');
  if (rb) { rb.hidden = !peo.data || peo.phase === 'busy'; rb.textContent = 'Refresh'; }
  if (peo.phase === 'busy') { box.innerHTML = `<div class="panel"><p class="hint" id="peoSay">${esc(peo.note)}</p><div class="bar busy"><i></i></div></div>`; return; }
  const waiting = pendingFor();
  const waitingHtml = waiting.length ? `<div class="panel stack"><b>Waiting to be shared</b>${waiting.map(j => `<div class="person"><span class="grow">${esc(j.email)}<span class="sub">${j.role === 'organizer' ? 'Team organizer' : j.role === 'admin' ? 'Diamond DJ Admin' : 'Volunteer'}${teams[j.teamId] ? ' · ' + esc(teams[j.teamId].name) : ''}${j.role === 'organizer' && !(Drive.state.teams[j.teamId] || {}).folderId ? ' · after the team is published' : ''}</span></span>
      <button class="btn small" data-unqueue="${esc(j.email)}|${esc(j.teamId || '')}">Cancel</button></div>`).join('')}</div>` : '';
  if (!Drive.ready()) {
    box.innerHTML = `${waitingHtml}<p class="hint">Open Diamond DJ from its web address or home-screen icon to see who has access.</p>`;
    return bindPeople(box);
  }
  if (!peo.data) {
    box.innerHTML = `${peo.note ? `<p class="hint">${esc(peo.note)}</p>` : ''}${waitingHtml}
      <div class="panel stack"><p>Sign in with the Google account that’s an Editor on the Diamond DJ folder to see everyone who has access, add people and change roles.</p>
      <div class="row"><button class="btn navy big" id="peoLoad">See who has access</button></div></div>`;
    $('#peoLoad').onclick = () => loadPeople();
    bindPeople(box);
    return;
  }
  const { access, teams: folders, root, when } = peo.data;
  const me = String(Drive.state.account || '').toLowerCase();
  const who = p => `<span class="grow"><b>${esc(p.displayName || p.emailAddress)}</b>${p.emailAddress && p.displayName ? `<span class="sub">${esc(p.emailAddress)}</span>` : ''}</span>`;
  const isMe = p => String(p.emailAddress || '').toLowerCase() === me;
  const teamOf = f => teams[f.id] || null;
  const badge = f => teamOf(f) ? teamBadge(teamOf(f), 32) : teamBadge({ name: f.name }, 32);
  const warn = [];
  for (const o of access.open) {
    const where = o.where ? (folders.find(f => f.id === o.where) || {}) : null;
    warn.push(`<div class="warn"><b>${where ? esc(where.name) : 'The Diamond DJ folder'} can be opened by ${o.perm.type === 'anyone' ? 'anyone with the link' : `anyone at ${esc(o.perm.domain || 'your organization')}`}.</b>
      Diamond DJ works best when only the people you add can open it.
      <div class="row"><button class="btn navy small" data-restrict="${esc(where ? where.folderId : root.id)}|${esc(o.perm.id)}">Make it private</button></div></div>`);
  }
  for (const t of access.teams) for (const p of t.noCommon) {
    warn.push(`<div class="warn"><b>${esc(p.emailAddress || p.displayName)} can’t get the common songs.</b> They’re on ${esc(t.name)} but not on the Diamond DJ folder.
      <div class="row"><button class="btn navy small" data-fixroot="${esc(p.emailAddress)}">Fix: add as Viewer</button></div></div>`);
  }
  const adminRows = access.admins.map(p => `<div class="person">${who(p)}<span class="pill">${p.role === 'owner' ? 'Owner' : 'Admin'}</span>
      ${p.role === 'owner' ? '' : `<button class="btn small" data-demote="${esc(p.id)}">Make volunteer</button><button class="btn small danger" data-remove-root="${esc(p.id)}" ${isMe(p) ? 'disabled title="That’s you"' : ''}>Remove</button>`}</div>`).join('');
  const teamOpts = folders.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  const volRows = access.viewers.map(p => `<div class="person">${who(p)}
      ${folders.length ? `<select data-promote="${esc(p.emailAddress)}" aria-label="Make team organizer"><option value="">Make team organizer of…</option>${teamOpts}</select>` : ''}
      <button class="btn small" data-make-admin="${esc(p.id)}">Make Admin</button>
      <button class="btn small danger" data-remove-root="${esc(p.id)}">Remove</button></div>`).join('');
  const teamCards = access.teams.map(t => {
    const f = folders.find(x => x.id === t.id);
    return `<div class="panel stack team-access"><div class="row">${badge(f)}<b class="grow">${esc(t.name)}</b>
        <a class="btn small" href="https://drive.google.com/drive/folders/${esc(f.folderId)}" target="_blank" rel="noopener">Open folder</a></div>
      ${t.organizers.length ? t.organizers.map(p => `<div class="person">${who(p)}<span class="pill">Team organizer</span>
        <button class="btn small danger" data-remove-org="${esc(f.folderId)}|${esc(p.id)}">Remove as organizer</button></div>`).join('') : '<p class="hint">No team organizers yet. Diamond DJ Admins can always change the team.</p>'}
      ${t.viewersOnly.length ? `<span class="sub">Can view only this team’s folder: ${esc(t.viewersOnly.map(p => p.emailAddress).join(', '))}</span>` : ''}</div>`;
  }).join('');
  box.innerHTML = `${warn.join('')}${waitingHtml}
    <div class="panel stack add-person"><b>Add someone</b>
      <div class="row wrap"><input type="email" id="peoEmail" placeholder="name@gmail.com" autocomplete="off" aria-label="Email address">
        <select id="peoRole" aria-label="Role"><option value="volunteer">Volunteer</option>${folders.map(f => `<option value="org:${esc(f.id)}">Team organizer · ${esc(f.name)}</option>`).join('')}<option value="admin">Diamond DJ Admin</option></select>
        <button class="btn primary" id="peoAdd">Add</button></div>
      <span class="hint">Google emails them a link with how to get started.</span></div>
    <div class="panel stack"><b>Diamond DJ Admins</b><span class="sub">Editor on the Diamond DJ folder: change the common songs, every team and who has access.</span>${adminRows}</div>
    ${teamCards}
    <div class="panel stack"><b>Volunteers · ${access.viewers.length}</b><span class="sub">Viewer on the Diamond DJ folder: get the common songs and any team at Check for updates, and run the music.</span>
      ${volRows || '<p class="hint">Nobody yet.</p>'}</div>
    <p class="hint">Read ${esc(new Date(when).toLocaleTimeString([], { timeStyle: 'short' }))}. Owner and sharing changes can also be made in Google Drive.</p>`;
  bindPeople(box);
}

function bindPeople(box) {
  const root = Drive.folderId();
  box.onclick = async e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.unqueue) {
      const [email, teamId] = d.unqueue.split('|');
      Drive.state.pending = pendingFor().filter(j => !(j.email === email && (j.teamId || '') === teamId));
      Drive.save(); return paintPeople();
    }
    if (b.id === 'peoAdd') {
      const email = $('#peoEmail').value.trim(), r = $('#peoRole').value;
      if (!Model.emailOk(email)) { toast('Type the person’s email address.'); return $('#peoEmail').focus(); }
      const f = r.startsWith('org:') ? peo.data.teams.find(x => x.id === r.slice(4)) : null;
      const job = { op: 'add', email, role: f ? 'organizer' : r, teamId: f ? f.id : null, folderId: f ? f.folderId : null };
      return changeAccess(`Sharing with ${email}…`, () => grant(job, peo.data.rootPerms));
    }
    if (d.restrict) { if (!armed(b, 'Tap again: make private')) return; const [fid, pid] = d.restrict.split('|'); return changeAccess('Turning off link sharing…', () => Drive.unshare(fid, pid)); }
    if (d.fixroot) return changeAccess(`Adding ${d.fixroot}…`, () => Drive.share(root, d.fixroot, 'reader', shareMessage('volunteer')));
    if (d.makeAdmin) { if (!armed(b, 'Tap again: make Admin')) return; return changeAccess('Changing the role…', () => Drive.setRole(root, d.makeAdmin, 'writer')); }
    if (d.demote) { if (!armed(b, 'Tap again')) return; return changeAccess('Changing the role…', () => Drive.setRole(root, d.demote, 'reader')); }
    if (d.removeOrg) { if (!armed(b, 'Tap again to remove')) return; const [fid, pid] = d.removeOrg.split('|'); return changeAccess('Removing…', () => Drive.unshare(fid, pid)); }
    if (d.removeRoot) {
      if (!armed(b, 'Tap again to remove')) return;
      const p = peo.data.rootPerms.find(x => x.id === d.removeRoot);
      return changeAccess('Removing…', async () => {
        // off every team folder they were added to, then off the Diamond DJ folder
        // (Google uses the same id for a person on every file; what they got from the Diamond DJ
        // folder can't be removed from a team folder, so that one just fails quietly)
        for (const f of peo.data.teams) {
          const own = f.perms.find(x => String(x.emailAddress || '').toLowerCase() === String(p.emailAddress || '').toLowerCase() && x.role !== p.role);
          if (own) await Drive.unshare(f.folderId, own.id).catch(() => {});
        }
        await Drive.unshare(root, p.id);
      });
    }
  };
  box.onchange = e => {
    const s = e.target.closest('[data-promote]');
    if (!s || !s.value) return;
    const f = peo.data.teams.find(x => x.id === s.value);
    changeAccess(`Making ${s.dataset.promote} a team organizer…`, () => grant({ op: 'add', email: s.dataset.promote, role: 'organizer', teamId: f.id, folderId: f.folderId }, peo.data.rootPerms));
  };
}

/* ==================================================================== A PLAYER'S OWN PART OF THE SONG */

function openPlayerClip(p, s) {
  const own = Model.cleanClip(p.clip);
  const songStop = s.stop != null && s.stop > s.start ? s.stop : s.start + settings.walkupSeconds;
  let start = own ? own.start : s.start || 0;
  let len = Math.round(((own ? (own.stop ?? start + settings.walkupSeconds) : songStop) - start) * 2) / 2;
  const max = s.length || 600;
  openDialog(`${Model.playerName(p)}’s part of ${s.title}`, `<div class="stack">
    <p class="hint">The song is shared, so its own start and stop stay as they are for everyone else. This changes only where it plays for ${esc(p.first || Model.playerName(p))}.</p>
    <div class="grid2"><label class="field">Start at (seconds)<input type="number" id="pcStart" min="0" max="${max}" step="0.5" value="${start}" inputmode="decimal"></label>
      <label class="field">Play for (seconds)<input type="number" id="pcLen" min="2" max="60" step="0.5" value="${len}" inputmode="decimal"></label></div>
    <p class="hint" id="pcText"></p>
    <div class="row wrap"><button class="btn" id="pcListen">${PLAY_ICON}Listen</button><span class="spacer"></span>
      ${own ? '<button class="btn" id="pcReset">Use the song’s own part</button>' : ''}<button class="btn primary" id="pcSave">Save</button></div></div>`, () => { Sound.stopPreview && Sound.stopPreview(); render(); });
  const read = () => {
    start = Math.max(0, Math.min(max - 1, +$('#pcStart').value || 0));
    len = Math.max(2, Math.min(60, +$('#pcLen').value || settings.walkupSeconds));
    $('#pcText').textContent = `Plays ${mmss(start)}–${mmss(Math.min(max, start + len))} (the song’s own part is ${mmss(s.start || 0)}–${mmss(songStop)}).`;
  };
  read();
  $('#pcStart').oninput = read; $('#pcLen').oninput = read;
  $('#pcListen').onclick = () => { read(); Sound.unlock(); Sound.playOne({ path: s.path, start, stop: Math.min(max, start + len), fadeOut: Math.min(s.fadeOut ?? 2, len), level: s.volume ?? 1, label: `Listen · ${s.title}`, kind: 'sound' }).catch(() => toast('That song isn’t on this device.')); };
  $('#pcSave').onclick = () => { read(); p.clip = { start, stop: Math.min(max, start + len) }; saveTeam(); closeDialog(); toast(`Saved ${Model.playerName(p)}’s part.`); };
  if ($('#pcReset')) $('#pcReset').onclick = () => { p.clip = null; saveTeam(); closeDialog(); toast('Back to the song’s own part.'); };
}
