// Run with: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');

function teamWith(n) {
  const t = M.newTeam('U13 Burlington Bees', 'U13');
  for (let i = 1; i <= n; i++) M.addPlayer(t, { first: `P${i}`, last: 'Test', number: String(i * 2) });
  return t;
}
const settings = { walkupSeconds: 15, duckLevel: 0.25, riseSeconds: 1 };

test('a new team has one lineup and new players fill it by number', () => {
  const t = M.newTeam('Bees');
  M.addPlayer(t, { first: 'B', number: '12' });
  M.addPlayer(t, { first: 'A', number: '2' });
  assert.equal(t.lineups.length, 1);
  // each new player joins the end of the order (the coach's order is kept, not re-sorted)
  assert.deepEqual(t.lineups[0].order.map(id => t.players.find(p => p.id === id).number), ['12', '2']);
  assert.deepEqual(t.lineups[0].bench, []);
});

test('a new lineup is filled with active players sorted by jersey number', () => {
  const t = M.newTeam('Bees');
  M.addPlayer(t, { first: 'C', number: '12' });
  M.addPlayer(t, { first: 'A', number: '2' });
  M.addPlayer(t, { first: 'B', number: '7', active: false });
  const l = M.addLineup(t, 'Game 2');
  const nums = l.order.map(id => t.players.find(p => p.id === id).number);
  assert.deepEqual(nums, ['2', '12']);
  assert.equal(l.bench.length, 1);
});

test('a player added later bats last in every lineup; an inactive one goes to the bench', () => {
  const t = teamWith(9);
  M.duplicateLineup(t, t.lineups[0].id, 'Tournament');
  const late = M.addPlayer(t, { first: 'Late', number: '99' });
  for (const l of t.lineups) assert.equal(l.order.at(-1), late.id);
  const away = M.addPlayer(t, { first: 'Away', number: '98', active: false });
  for (const l of t.lineups) assert.ok(l.bench.includes(away.id) && !l.order.includes(away.id));
});

test('removing a player takes them out of every lineup', () => {
  const t = teamWith(4);
  M.duplicateLineup(t, t.lineups[0].id, 'Copy');
  const gone = t.players[1].id;
  M.removePlayer(t, gone);
  for (const l of t.lineups) assert.ok(!l.order.includes(gone) && !l.bench.includes(gone));
});

test('making a player inactive benches them', () => {
  const t = teamWith(3);
  t.players[0].active = false;
  M.syncLineups(t);
  assert.ok(t.lineups[0].bench.includes(t.players[0].id));
  assert.ok(!t.lineups[0].order.includes(t.players[0].id));
});

test('reorder, move by arrows, bench and add back', () => {
  const t = teamWith(4);
  const l = t.lineups[0];
  const [a, b, c, d] = l.order;
  M.moveInOrder(l, d, 0);
  assert.deepEqual(l.order, [d, a, b, c]);
  M.moveBy(l, d, 1);
  assert.deepEqual(l.order, [a, d, b, c]);
  assert.equal(M.moveBy(l, a, -1), false, 'top player can’t move up');
  M.benchPlayer(l, b);
  assert.deepEqual(l.order, [a, d, c]);
  assert.deepEqual(l.bench, [b]);
  M.unbenchPlayer(l, b);
  assert.deepEqual(l.order, [a, d, c, b], 'added back at the end of the order');
  assert.deepEqual(l.bench, []);
});

test('auto-advance wraps from the last batter to the first', () => {
  const t = teamWith(3);
  const l = t.lineups[0];
  const [a, b, c] = l.order;
  assert.equal(M.upNextId(l, null), a);
  assert.equal(M.nextAfter(l, a), b);
  assert.equal(M.nextAfter(l, c), a);
  assert.deepEqual(M.comingUp(l, b), [c, a]);
});

test('if the up-next batter is benched, the top of the order is up next', () => {
  const t = teamWith(3);
  const l = t.lineups[0];
  const [a, b] = l.order;
  M.benchPlayer(l, b);
  assert.equal(M.upNextId(l, b), a);
  assert.equal(M.nextAfter(l, b), a);
});

test('an empty order has nobody up next', () => {
  const t = M.newTeam('Bees');
  assert.equal(M.upNextId(t.lineups[0], null), null);
  assert.deepEqual(M.comingUp(t.lineups[0], null), []);
});

test('duplicate lineups are independent; the last lineup can’t be deleted', () => {
  const t = teamWith(3);
  const copy = M.duplicateLineup(t, t.lineups[0].id, 'Tournament');
  M.benchPlayer(copy, copy.order[0]);
  assert.equal(t.lineups[0].order.length, 3);
  assert.equal(copy.order.length, 2);
  assert.equal(M.removeLineup(t, copy.id), true);
  assert.equal(M.removeLineup(t, t.lineups[0].id), false);
});

test('song names are split into title and artist from the file name', () => {
  const s = M.songFromFile('Walkups/Thunderstruck - AC-DC.mp3');
  assert.equal(s.title, 'Thunderstruck');
  assert.equal(s.artist, 'AC-DC');
  assert.equal(M.songFromFile('Songs/Believer.mp3').artist, '');
});

test('player status reflects song and announcement', () => {
  const lib = M.newLibrary();
  const s = M.songFromFile('Songs/A.mp3'); lib.songs.push(s);
  const p = M.newPlayer({ first: 'A' });
  assert.equal(M.playerStatus(p, lib), 'not-ready');
  p.songId = s.id;
  assert.equal(M.playerStatus(p, lib), 'no-intro');
  p.intro = { path: 'Announcements/a.mp3' };
  assert.equal(M.playerStatus(p, lib), 'ready');
  p.songId = 'missing';
  assert.equal(M.playerStatus(p, lib), 'no-song');
});

test('walk-up plan: song under the announcement, ducked', () => {
  const lib = M.newLibrary();
  const s = M.songFromFile('Songs/A.mp3'); s.start = 42; s.stop = 57; s.length = 292; lib.songs.push(s);
  const p = M.newPlayer({ first: 'Ava', songId: s.id, intro: { path: 'Announcements/ava.mp3' } });
  const plan = M.walkupPlan(p, lib, settings);
  assert.equal(plan.mode, 'under');
  assert.equal(plan.duckLevel, 0.25);
  assert.deepEqual([plan.song.start, plan.song.stop], [42, 57]);
});

test('walk-up plan: after, song only, intro only, nothing', () => {
  const lib = M.newLibrary();
  const s = M.songFromFile('Songs/A.mp3'); s.start = 10; s.length = 20; lib.songs.push(s);
  const p = M.newPlayer({ songId: s.id, intro: { path: 'x.mp3' }, entry: 'after' });
  assert.equal(M.walkupPlan(p, lib, settings).mode, 'after');
  assert.equal(M.walkupPlan(p, lib, settings).duckLevel, 1);
  assert.equal(M.walkupPlan(p, lib, settings).song.stop, 20, 'no stop point: 15 s, cut at the song’s end');
  assert.equal(M.walkupPlan({ ...p, intro: null }, lib, settings).mode, 'song');
  assert.equal(M.walkupPlan({ ...p, songId: null }, lib, settings).mode, 'intro');
  assert.equal(M.walkupPlan({ ...p, songId: null, intro: null }, lib, settings), null);
});

test('fade is never longer than the clip', () => {
  const lib = M.newLibrary();
  const s = M.songFromFile('Songs/A.mp3'); s.start = 5; s.stop = 6; s.fadeOut = 3; lib.songs.push(s);
  const plan = M.walkupPlan(M.newPlayer({ songId: s.id }), lib, settings);
  assert.equal(plan.song.fadeOut, 1);
});

test('team files are checked and repaired on open', () => {
  assert.throws(() => M.checkTeam({ hello: 1 }), /team file/);
  const t = teamWith(2);
  const json = JSON.parse(JSON.stringify(t));
  json.lineups[0].order.push('ghost');
  const back = M.checkTeam(json);
  assert.ok(!back.lineups[0].order.includes('ghost'));
  assert.equal(back.players.length, 2);
});

/* ---------------------------------------------------------------- 0.8: music categories */

function libWith(n) {
  const lib = M.newLibrary();
  for (let i = 1; i <= n; i++) { const s = M.songFromFile(`Songs/S${i}.mp3`); s.id = `s${i}`; lib.songs.push(s); }
  return lib;
}

test('the common library starts with four empty music categories; a new team adds none of its own', () => {
  const lib = M.newLibrary();
  assert.deepEqual(lib.categories.map(c => c.name), ['Warm-up', 'Pitchers', 'Crowd favourites', 'Post-game celebrations']);
  assert.ok(lib.categories.every(c => c.songIds.length === 0 && /^#[0-9A-F]{6}$/i.test(c.color)));
  const t = M.newTeam('Bees');
  assert.deepEqual([t.songs, t.music, t.hiddenCats, 'moments' in t], [[], {}, [], false]);
  assert.equal(M.gameMusic(lib, t).length, 4);
});

test('older files: key moments are dropped, a library gets the categories once', () => {
  const old = JSON.parse(JSON.stringify(teamWith(2)));
  Object.assign(old, { version: 3, moments: [{ id: 'm1', name: 'Home Run', songIds: [] }], hidden: ['x'], extra: { x: ['a'] } });
  const t = M.checkTeam(old);
  assert.deepEqual([t.version, t.music, t.hiddenCats, 'moments' in t, 'extra' in t], [4, {}, [], false, false]);
  const lib = M.checkLibrary({ format: 'diamond-library', version: 2, songs: [], moments: [{ id: 'm', name: 'Home Run' }] });
  assert.deepEqual([lib.version, lib.categories.length, 'moments' in lib], [3, 4, false]);
  assert.equal(M.checkLibrary({ format: 'diamond-library', version: 3, songs: [], categories: [] }).categories.length, 0);
});

test('a category: common songs then the team’s own; hidden ones are left out', () => {
  const lib = M.newLibrary();
  const [warm, pitch] = lib.categories;
  warm.songIds = ['c1', 'c2'];
  const t = M.newTeam('Bees');
  t.music = { [warm.id]: ['t1', 'c1'] };
  t.hiddenCats = [pitch.id];
  const g = M.gameMusic(lib, t);
  assert.deepEqual(g[0].songIds, ['c1', 'c2', 't1']);
  assert.equal(g[0].common, 2);
  assert.ok(!g.some(c => c.id === pitch.id));
  assert.deepEqual(warm.songIds, ['c1', 'c2']); // the library itself is untouched
});

test('Shuffle skips songs already played this game, then starts over; ignores deleted songs', () => {
  const pool = { songs: ['s1', 's2', 's3'].map(id => ({ ...M.songFromFile(`Songs/${id}.mp3`), id })) };
  const cat = M.newCategory({ songIds: ['s1', 's2', 's3', 'gone'] });
  const state = { played: [] };
  const seen = [];
  for (let i = 0; i < 3; i++) { const id = M.pickShuffle(cat, pool, state, () => 0); seen.push(id); M.notePlayed(state, id); }
  assert.deepEqual(seen.sort(), ['s1', 's2', 's3']);
  assert.ok(['s1', 's2', 's3'].includes(M.pickShuffle(cat, pool, state, () => 0.5)));
  assert.equal(M.pickShuffle(M.newCategory(), pool, state), null);
});

test('deleting a song removes it from players and the team’s music', () => {
  const t = teamWith(1);
  t.players[0].songId = 's1';
  t.music = { c: ['s1', 's3'] };
  M.removeSongEverywhere(t, 's1');
  assert.equal(t.players[0].songId, null);
  assert.deepEqual(t.music.c, ['s3']);
});

test('a song plays its clip: start to stop, or to the end of the song', () => {
  const s = M.songFromFile('Songs/A.mp3'); s.start = 10; s.length = 200;
  assert.deepEqual([M.clipOf(s).stop, M.clipOf(s).length], [null, 190]);
  s.stop = 25;
  assert.deepEqual([M.clipOf(s).stop, M.clipOf(s).length], [25, 15]);
});

/* ---------------------------------------------------------------- Phase 3: Drive merge */

test('first download takes the team from Drive as it is', () => {
  const remote = JSON.parse(JSON.stringify(teamWith(3)));
  const t = M.mergeTeam(null, remote);
  assert.equal(t.players.length, 3);
  assert.equal(t.lineups[0].order.length, 3);
});

test('an update replaces the roster but keeps a lineup this device changed since the last sync', () => {
  const remote = teamWith(3);
  const local = JSON.parse(JSON.stringify(remote));
  const lastSync = Date.now();
  // this device reorders its lineup after syncing
  local.lineups[0].order.reverse(); local.lineups[0].updated = lastSync + 1000;
  // the organizer adds a player and a new lineup, and changes a name
  const r = JSON.parse(JSON.stringify(remote));
  const added = M.addPlayer(r, { first: 'New', number: '99' });
  r.players[0].first = 'Renamed';
  r.lineups.push(M.newLineup('Tournament', r.lineups[0].order));
  const out = M.mergeTeam(local, r, { lastSync });
  assert.equal(out.players.length, 4);
  assert.equal(out.players[0].first, 'Renamed');
  assert.deepEqual(out.lineups[0].order.slice(0, 3), [...remote.lineups[0].order].reverse(), 'local order kept');
  assert.equal(out.lineups[0].order.at(-1), added.id, 'new player joins the kept lineup');
  assert.ok(out.lineups.some(l => l.name === 'Tournament'), 'Drive’s new lineup arrives');
});

test('a lineup this device did not touch takes Drive’s version', () => {
  const remote = teamWith(3);
  const local = JSON.parse(JSON.stringify(remote));
  local.lineups[0].updated = 1;
  const r = JSON.parse(JSON.stringify(remote));
  r.lineups[0].order.reverse();
  const out = M.mergeTeam(local, r, { lastSync: 10 });
  assert.deepEqual(out.lineups[0].order, r.lineups[0].order);
});

test('keepSetup keeps this device’s roster and still brings new lineups', () => {
  const remote = teamWith(2);
  const local = JSON.parse(JSON.stringify(remote));
  local.players[0].first = 'Mine';
  const r = JSON.parse(JSON.stringify(remote));
  r.players[0].first = 'Theirs';
  r.lineups.push(M.newLineup('Extra', r.lineups[0].order));
  const out = M.mergeTeam(local, r, { lastSync: Date.now(), keepSetup: true });
  assert.equal(out.players[0].first, 'Mine');
  assert.equal(out.lineups.length, 2);
});

test('setup fingerprint ignores lineups and changes with the roster', () => {
  const t = teamWith(2);
  const a = M.setupPrint(t);
  M.benchPlayer(t.lineups[0], t.lineups[0].order[0]);
  assert.equal(M.setupPrint(t), a);
  t.players[0].first = 'Changed';
  assert.notEqual(M.setupPrint(t), a);
});

test('library: Drive wins for the same song, this device’s own songs stay', () => {
  const local = libWith(2); local.songs[0].start = 5;
  const remote = libWith(1); remote.songs[0].start = 42;
  const out = M.mergeLibrary(local, remote);
  assert.equal(out.songs.length, 2);
  assert.equal(M.findSong(out, 's1').start, 42);
  assert.equal(M.findSong(M.mergeLibrary(local, remote, { keepLocal: true }), 's1').start, 5);
});

test('the songs a team can use, and common songs not published yet', () => {
  const lib = M.newLibrary();
  const t = M.newTeam('Bees');
  t.songs = [{ ...M.songFromFile('Teams/x/Oklahoma.mp3'), id: 't2' }];
  lib.songs = [{ ...M.songFromFile('Songs/C.mp3'), id: 'c1' }];
  lib.categories[0].songIds = ['c1'];
  const pool = M.poolFor(lib, t);
  assert.ok(M.findSong(pool, 't2') && M.findSong(pool, 'c1'));
  assert.deepEqual(M.commonSongsMissing(t, lib, { songs: [] }).map(s => s.id), ['c1']);
  assert.deepEqual(M.commonSongsMissing(t, lib, lib), []);
});

test('songs a team uses, and where files live in Drive', () => {
  const t = teamWith(1);
  t.players[0].songId = 'a';
  t.music = { x: ['b', 'a'] };
  assert.deepEqual([...M.teamSongIds(t)].sort(), ['a', 'b']);
  const lib = M.newLibrary(); lib.categories[0].songIds = ['d'];
  assert.deepEqual([...M.teamSongIds(t, lib)].sort(), ['a', 'b', 'd']);
  t.hiddenCats = [lib.categories[0].id];
  assert.ok(!M.teamSongIds(t, lib).has('d'));
  assert.equal(M.drivePathFor('Songs/X - Y.mp3', 'U13 Bees'), 'Common Songs/X - Y.mp3');
  assert.equal(M.drivePathFor('Teams/t_1/Oklahoma.mp3', 'U13 Bees'), 'U13 Bees/Team Songs/Oklahoma.mp3');
  assert.equal(M.drivePathFor('Announcements/p_1-ava.mp3', 'U13 Bees'), 'U13 Bees/Announcements/p_1-ava.mp3');
});

test('a lineup changed here before the last sync survives the next update if Drive’s is older', () => {
  const remote = teamWith(3);
  remote.lineups[0].updated = 100;
  const local = JSON.parse(JSON.stringify(remote));
  M.benchPlayer(local.lineups[0], local.lineups[0].order[0]); local.lineups[0].updated = 200;
  const out = M.mergeTeam(local, JSON.parse(JSON.stringify(remote)), { lastSync: 300 });
  assert.equal(out.lineups[0].bench.length, 1);
});
