import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, makeDeck, createRoom, addPlayer, applyAction, dealRound, finishTrick, legalCards, scoreRound, trickWinner, viewFor } from '../game.js';

function fixture(playerCount = 4) {
  const { room, player: host } = createRoom('ABC234', 'Ada', playerCount);
  for (const name of ['Ben', 'Cleo', 'Dara', 'Eli', 'Faye'].slice(0, playerCount - 1)) addPlayer(room, name);
  return { room, host };
}
const card = (color, value) => ({ id: `${color}-${value}`, color, value });
const play = (player, color, value) => ({ player, card: card(color, value) });

test('deck has exactly one of each value 1–15 in each of five colors', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 75);
  assert.equal(new Set(deck.map(c => c.id)).size, 75);
  for (const color of COLORS) assert.deepEqual(deck.filter(c => c.color === color).map(c => c.value), Array.from({ length: 15 }, (_, i) => i + 1));
});

test('only the highest lead color can win without trump; highest trump overrides lead', () => {
  assert.equal(trickWinner([play(0, 'red', 4), play(1, 'blue', 15), play(2, 'red', 9), play(3, 'green', 15)], 'purple'), 2);
  assert.equal(trickWinner([play(0, 'red', 15), play(1, 'purple', 1), play(2, 'purple', 3), play(3, 'blue', 15)], 'purple'), 2);
  assert.equal(trickWinner([play(0, 'purple', 2), play(1, 'purple', 9), play(2, 'red', 15), play(3, 'purple', 4)], 'purple'), 1);
});

test('exact predictions gain 20 plus ten per trick; misses receive only the difference penalty', () => {
  assert.equal(scoreRound(0, 0), 20);
  assert.equal(scoreRound(3, 3), 50);
  assert.equal(scoreRound(2, 3), -10);
  assert.equal(scoreRound(4, 1), -30);
  assert.equal(scoreRound(0, 10), -100);
});

test('lobby requires four players and host start; extra players and late joins are rejected', () => {
  const { room, player } = createRoom('ABC234', 'Ada');
  assert.throws(() => applyAction(room, player.id, { type: 'start' }), /All 4 players/);
  for (const name of ['Ben', 'Cleo', 'Dara']) addPlayer(room, name);
  assert.throws(() => addPlayer(room, 'Fifth'), /4 players/);
  assert.throws(() => applyAction(room, room.players[1].id, { type: 'start' }), /host/);
  applyAction(room, player.id, { type: 'start' });
  assert.throws(() => addPlayer(room, 'Fifth'), /already started/);
  assert.throws(() => applyAction(room, player.id, { type: 'start' }), /already started/);
});

test('predictions enforce turns, integer bounds, and forbidden final total', () => {
  const { room, host } = fixture();
  applyAction(room, host.id, { type: 'start' });
  assert.throws(() => applyAction(room, room.players[1].id, { type: 'bid', value: 0 }), /turn/);
  for (const value of [-1, 2, 0.5, '0', null]) assert.throws(() => applyAction(room, host.id, { type: 'bid', value }), /Predict between/);
  for (let i = 0; i < 3; i++) applyAction(room, room.players[i].id, { type: 'bid', value: 0 });
  assert.equal(viewFor(room, room.players[3].id).forbiddenBid, 1);
  assert.throws(() => applyAction(room, room.players[3].id, { type: 'bid', value: 1 }), /total cannot/);
  assert.equal(room.players[3].prediction, null);
  applyAction(room, room.players[3].id, { type: 'bid', value: 0 });
  assert.equal(room.phase, 'playing');
  assert.equal(room.turn, room.first);
});

test('color forcing is enforced, including preventing trump while lead color is available', () => {
  const { room } = fixture();
  room.phase = 'playing'; room.round = 2; room.trump = 'purple'; room.turn = 1;
  room.trick = [play(0, 'red', 4)];
  room.players[1].hand = [card('red', 2), card('purple', 15)];
  assert.deepEqual(legalCards(room, 1).map(c => c.id), ['red-2']);
  assert.throws(() => applyAction(room, room.players[1].id, { type: 'play', cardId: 'purple-15' }), /must follow red/);
  assert.equal(room.players[1].hand.length, 2);
  applyAction(room, room.players[1].id, { type: 'play', cardId: 'red-2' });
  room.players[2].hand = [card('blue', 1), card('purple', 3)];
  assert.equal(legalCards(room, 2).length, 2);
  applyAction(room, room.players[2].id, { type: 'play', cardId: 'purple-3' });
  assert.equal(room.trick[2].card.color, 'purple');
  assert.throws(() => applyAction(room, room.players[3].id, { type: 'play', cardId: 'red-15' }), /not in your hand/);
});

test('private views expose only the requester’s cards, with no tokens or player IDs', () => {
  const { room, host } = fixture();
  applyAction(room, host.id, { type: 'start' });
  dealRound(room);
  const view = viewFor(room, host.id);
  assert.deepEqual(view.hand, host.hand);
  for (const player of room.players) {
    assert.equal(JSON.stringify(view).includes(player.token), false);
    assert.equal(JSON.stringify(view).includes(player.id), false);
  }
  for (const opponent of view.players.slice(1)) {
    assert.equal(opponent.cards, 2);
    assert.equal(opponent.visibleCard, null);
    assert.equal('hand' in opponent, false);
  }
  assert.throws(() => viewFor(room, 'stranger'), /not seated/);
});

for (const count of [2, 3, 4, 5]) test(`a complete ${count}-player ten-round game deals, rotates, scores, and rematches`, () => {
  const { room, host } = fixture(count);
  let seed = 371;
  const random = max => { seed = seed * 48271 % 2147483647; return seed % max; };
  applyAction(room, host.id, { type: 'start' }, random);
  const totals = Array(count).fill(0);
  for (let round = 1; round <= 10; round++) {
    assert.equal(room.round, round);
    assert.equal(room.first, (round - 1) % count);
    assert.equal(room.turn, room.first);
    assert.equal(COLORS.includes(room.trump), true);
    const dealt = room.players.flatMap(p => p.hand);
    assert.equal(dealt.length, round * count);
    assert.equal(new Set(dealt.map(c => c.id)).size, dealt.length);
    for (let i = 0; i < count; i++) {
      const current = room.players[room.turn];
      const forbidden = viewFor(room, current.id).forbiddenBid;
      let value = (round + i) % (round + 1);
      if (value === forbidden) value = (value + 1) % (round + 1);
      applyAction(room, current.id, { type: 'bid', value }, random);
    }
    assert.notEqual(room.players.reduce((sum, p) => sum + p.prediction, 0), round);
    assert.equal(room.turn, room.first);
    for (let t = 0; t < round; t++) {
      for (let i = 0; i < count; i++) {
        const index = room.turn;
        const chosen = legalCards(room, index)[0];
        applyAction(room, room.players[index].id, round === 1 ? { type: 'play-blind' } : { type: 'play', cardId: chosen.id });
      }
      assert.equal(room.phase, 'trick-end');
      assert.equal(room.turn, trickWinner(room.trick, room.trump));
      assert.throws(() => applyAction(room, room.players[room.turn].id, { type: 'play', cardId: 'red-1' }), /turn/);
      const winner = room.turn;
      finishTrick(room);
      if (t + 1 < round) assert.equal(room.turn, winner);
    }
    assert.equal(room.players.reduce((sum, p) => sum + p.tricks, 0), round);
    assert.equal(room.history.length, round);
    for (let i = 0; i < count; i++) {
      const p = room.players[i];
      totals[i] += scoreRound(p.prediction, p.tricks);
      assert.equal(p.score, totals[i]);
      assert.equal(p.hand.length, 0);
    }
    assert.equal(room.phase, round === 10 ? 'finished' : 'round-end');
    if (round < 10) applyAction(room, host.id, { type: 'next-round' }, random);
  }
  applyAction(room, host.id, { type: 'rematch' }, random);
  assert.equal(room.round, 1);
  assert.equal(room.history.length, 0);
  assert.deepEqual(room.players.map(p => p.score), Array(count).fill(0));
});


test('player count must be an integer between 2 and 5; host can resize a lobby without ejecting players', () => {
  for (const count of [1, 6, 7, 2.5, '4', null]) assert.throws(() => createRoom('ABC234', 'Ada', count), /between 2 and 5/);
  const { room, player: host } = createRoom('ABC234', 'Ada', 2);
  const guest = addPlayer(room, 'Ben');
  assert.throws(() => applyAction(room, guest.id, { type: 'set-player-count', value: 5 }), /host/);
  applyAction(room, host.id, { type: 'set-player-count', value: 5 });
  assert.equal(room.playerCount, 5);
  addPlayer(room, 'Cleo');
  assert.throws(() => applyAction(room, host.id, { type: 'set-player-count', value: 2 }), /cannot remove/);
  assert.equal(room.playerCount, 5);
  applyAction(room, host.id, { type: 'set-player-count', value: 3 });
  applyAction(room, host.id, { type: 'start' });
  assert.throws(() => applyAction(room, host.id, { type: 'set-player-count', value: 5 }), /before the game/);
});

for (const count of [2, 3, 4, 5]) test(`${count}-player blind round never exposes an unplayed own card, and shows every opponent card`, () => {
  const { room, host } = fixture(count);
  applyAction(room, host.id, { type: 'start' });
  for (const [index, player] of room.players.entries()) {
    const view = viewFor(room, player.id);
    assert.equal(view.blindRound, true);
    assert.deepEqual(view.hand, [{ hidden: true }]);
    assert.equal(view.players[index].visibleCard, null);
    assert.deepEqual(view.legalCardIds, []);
    assert.equal(JSON.stringify(view).includes(JSON.stringify(player.hand[0].id)), false);
    for (let other = 0; other < count; other++) if (other !== index) assert.deepEqual(view.players[other].visibleCard, room.players[other].hand[0]);
  }
  for (const player of room.players) applyAction(room, player.id, { type: 'bid', value: 0 });
  const ownCard = { ...host.hand[0] };
  assert.throws(() => applyAction(room, host.id, { type: 'play', cardId: ownCard.id }), /face down/);
  assert.deepEqual(viewFor(room, host.id).legalCardIds, []);
  assert.equal(viewFor(room, host.id).canPlayBlind, true);
  assert.equal(JSON.stringify(viewFor(room, host.id)).includes(JSON.stringify(ownCard.id)), false);
  applyAction(room, host.id, { type: 'play-blind' });
  assert.deepEqual(room.trick[0].card, ownCard);
  assert.deepEqual(viewFor(room, host.id).hand, []);
  assert.deepEqual(viewFor(room, host.id).trick[0].card, ownCard);
  dealRound(room);
  const normal = viewFor(room, host.id);
  assert.equal(normal.blindRound, false);
  assert.equal(normal.hand.length, 2);
  assert.equal(normal.hand.every(card => card.id && !card.hidden), true);
  assert.equal(normal.players.every(player => player.visibleCard === null), true);
});
