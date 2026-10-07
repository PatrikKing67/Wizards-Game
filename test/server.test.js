import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server.js';

async function running(t, { trickDelay = 0 } = {}) {
  const server = createGameServer({ trickDelay });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, data, token, headers = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() };
  }
  return { base, api };
}

test('HTTP flow: four seats, authentication, private hands, authority, and a completed round', async t => {
  const { base, api } = await running(t);
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Wizards/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await api('/health')).data.status, 'ok');
  assert.equal((await api('/api/rooms', { name: 'Ada' }, null, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await api('/api/rooms', { name: '' })).status, 400);
  const created = await api('/api/rooms', { name: 'Ada' });
  assert.equal(created.status, 201);
  const { code } = created.data;
  const players = [created.data];
  for (const name of ['Ben', 'Cleo', 'Dara']) {
    const result = await api(`/api/rooms/${code}/join`, { name });
    assert.equal(result.status, 201);
    players.push(result.data);
  }
  assert.equal((await api(`/api/rooms/${code}/join`, { name: 'Fifth' })).status, 400);
  assert.equal((await api(`/api/rooms/${code}/state`)).status, 401);
  assert.equal((await api(`/api/rooms/${code}/state?token=${players[0].token}`)).status, 401);
  assert.equal((await api(`/api/rooms/${code}/actions`, { type: 'start' }, players[1].token)).status, 400);
  assert.equal((await api(`/api/rooms/${code}/actions`, { type: 'start' }, players[0].token)).status, 200);
  for (const player of players) {
    const view = (await api(`/api/rooms/${code}/state`, undefined, player.token)).data;
    assert.deepEqual(view.hand, [{ hidden: true }]);
    assert.deepEqual(view.legalCardIds, []);
    assert.equal(view.players[view.you].visibleCard, null);
    assert.equal(view.players.filter(p => p.visibleCard).length, 3);
    assert.equal(view.players.some(p => 'hand' in p || 'token' in p), false);
  }
  for (const player of players) assert.equal((await api(`/api/rooms/${code}/actions`, { type: 'bid', value: 0 }, player.token)).status, 200);
  let state = (await api(`/api/rooms/${code}/state`, undefined, players[0].token)).data;
  for (let i = 0; i < 4; i++) {
    const player = players[state.turn];
    const privateState = (await api(`/api/rooms/${code}/state`, undefined, player.token)).data;
    const result = await api(`/api/rooms/${code}/actions`, { type: 'play-blind' }, player.token);
    assert.equal(result.status, 200);
    state = result.data;
  }
  for (let attempt = 0; attempt < 20 && state.phase !== 'round-end'; attempt++) state = (await api(`/api/rooms/${code}/state`, undefined, players[0].token)).data;
  assert.equal(state.phase, 'round-end');
  assert.equal(state.history.length, 1);
  assert.equal(state.players.reduce((sum, p) => sum + p.tricks, 0), 1);
  assert.deepEqual(state.players.map(p => p.score).sort((a, b) => a - b), [-10, 20, 20, 20]);
  assert.equal((await api(`/api/rooms/${code}/actions`, { type: 'next-round' }, players[2].token)).status, 400);
  const next = await api(`/api/rooms/${code}/actions`, { type: 'next-round' }, players[0].token);
  assert.equal(next.data.round, 2);
  assert.equal(next.data.turn, 1);
});

test('SSE sends personalized updates to connected browsers', async t => {
  const { base, api } = await running(t);
  const { data: host } = await api('/api/rooms', { name: 'Ada' });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/rooms/${host.code}/events?token=${host.token}`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  async function update() {
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    return JSON.parse(text.split('\n\n')[0].slice(6));
  }
  assert.equal((await update()).players.length, 1);
  await api(`/api/rooms/${host.code}/join`, { name: 'Ben' });
  const joined = await update();
  assert.equal(joined.players.length, 2);
  assert.equal(joined.you, 0);
  assert.equal(joined.players[1].name, 'Ben');
  controller.abort();
});


test('HTTP room creation validates 2–5 players and broadcasts a host’s lobby size changes', async t => {
  const { api } = await running(t);
  for (const playerCount of [1, 6, 7, 2.5, '6', null]) assert.equal((await api('/api/rooms', { name: 'Ada', playerCount })).status, 400);
  for (const playerCount of [2, 3, 4, 5]) {
    const { data: host } = await api('/api/rooms', { name: 'Ada', playerCount });
    assert.equal(host.state.playerCount, playerCount);
    const { data: guest } = await api(`/api/rooms/${host.code}/join`, { name: 'Ben' });
    assert.equal((await api(`/api/rooms/${host.code}/actions`, { type: 'set-player-count', value: 5 }, guest.token)).status, 400);
    const resized = await api(`/api/rooms/${host.code}/actions`, { type: 'set-player-count', value: 5 }, host.token);
    assert.equal(resized.status, 200);
    assert.equal((await api(`/api/rooms/${host.code}/state`, undefined, guest.token)).data.playerCount, 5);
  }
});

test('returning to the lobby preserves HTTP seats and an old trick timer cannot finish a restarted game', async t => {
  const scheduled = [];
  const trickDelay = 98765;
  const nativeSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(callback, delay, ...args);
    if (delay === trickDelay) {
      scheduled.push(callback);
      clearTimeout(timer);
    }
    return timer;
  });
  const { api } = await running(t, { trickDelay });
  const { data: host } = await api('/api/rooms', { name: 'Ada', playerCount: 2 });
  const { data: guest } = await api(`/api/rooms/${host.code}/join`, { name: 'Ben' });
  const action = async (player, data) => {
    const result = await api(`/api/rooms/${host.code}/actions`, data, player.token);
    assert.equal(result.status, 200);
    return result.data;
  };
  async function playFirstRound() {
    await action(host, { type: 'start' });
    for (const player of [host, guest]) await action(player, { type: 'bid', value: 0 });
    for (const player of [host, guest]) await action(player, { type: 'play-blind' });
  }
  await playFirstRound();
  assert.equal(scheduled.length, 1);
  assert.equal((await api(`/api/rooms/${host.code}/actions`, { type: 'return-to-lobby' }, guest.token)).status, 400);
  await action(host, { type: 'return-to-lobby' });
  const lobby = (await api(`/api/rooms/${host.code}/state`, undefined, guest.token)).data;
  assert.equal(lobby.phase, 'lobby');
  assert.equal(lobby.you, 1);
  assert.equal(lobby.players.length, 2);
  assert.deepEqual(lobby.hand, []);
  await playFirstRound();
  assert.equal(scheduled.length, 2);
  const state = (await api(`/api/rooms/${host.code}/state`, undefined, host.token)).data;
  assert.equal(state.phase, 'trick-end');
  scheduled[0]();
  const afterOldTimer = (await api(`/api/rooms/${host.code}/state`, undefined, host.token)).data;
  assert.deepEqual(afterOldTimer, state, 'a previous game’s delayed callback must not advance this game');
  scheduled[1]();
  const afterCurrentTimer = (await api(`/api/rooms/${host.code}/state`, undefined, host.token)).data;
  assert.equal(afterCurrentTimer.phase, 'round-end');
  assert.equal(afterCurrentTimer.history.length, 1);
});
