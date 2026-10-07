import { randomInt, randomUUID } from 'node:crypto';

export const COLORS = ['red', 'gold', 'green', 'blue', 'purple'];
export const PLAYER_COUNT = 4;

export function makeDeck() {
  return COLORS.flatMap(color => Array.from({ length: 15 }, (_, i) => ({ id: `${color}-${i + 1}`, color, value: i + 1 })));
}

export function shuffle(deck, random = randomInt) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function scoreRound(prediction, tricks) {
  return prediction === tricks ? 20 + 10 * tricks : -10 * Math.abs(prediction - tricks);
}

export function trickWinner(trick, trump) {
  const lead = trick[0].card.color;
  const eligible = trick.some(play => play.card.color === trump) ? trump : lead;
  return trick.filter(play => play.card.color === eligible).reduce((best, play) => play.card.value > best.card.value ? play : best).player;
}

export function legalCards(room, index) {
  const hand = room.players[index].hand;
  const lead = room.trick[0]?.card.color;
  const matching = hand.filter(card => card.color === lead);
  return matching.length ? matching : hand;
}

export function createRoom(code, name) {
  const room = { code, phase: 'lobby', round: 0, players: [], host: null, first: 0, turn: null, trump: null, trick: [], lastTrick: null, history: [], message: '', updatedAt: Date.now() };
  const player = addPlayer(room, name);
  room.host = player.id;
  return { room, player };
}

export function addPlayer(room, name) {
  if (room.phase !== 'lobby') throw new Error('This game has already started. Rejoin using your original browser.');
  if (room.players.length >= PLAYER_COUNT) throw new Error('This room already has four players.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24) throw new Error('Choose a name between 1 and 24 characters.');
  const player = { id: randomUUID(), token: randomUUID(), name: name.trim(), hand: [], prediction: null, tricks: 0, score: 0 };
  room.players.push(player);
  return player;
}

export function dealRound(room, random = randomInt) {
  room.round++;
  room.first = (room.round - 1) % PLAYER_COUNT;
  room.turn = room.first;
  room.trump = COLORS[random(COLORS.length)];
  room.phase = 'bidding';
  room.trick = [];
  room.lastTrick = null;
  const deck = shuffle(makeDeck(), random);
  for (const player of room.players) {
    player.hand = [];
    player.prediction = null;
    player.tricks = 0;
  }
  for (let i = 0; i < room.round; i++) {
    for (const player of room.players) player.hand.push(deck.pop());
  }
  for (const player of room.players) player.hand.sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.value - b.value);
  room.message = `Round ${room.round}: ${room.players[room.first].name} predicts first.`;
}

export function applyAction(room, playerId, action, random = randomInt) {
  const index = room.players.findIndex(player => player.id === playerId);
  if (index === -1) throw new Error('You are not seated in this room.');
  if (!action || typeof action.type !== 'string') throw new Error('Choose a valid action.');
  const player = room.players[index];
  if (action.type === 'start') {
    if (playerId !== room.host) throw new Error('Only the host can start the game.');
    if (room.phase !== 'lobby') throw new Error('The game has already started.');
    if (room.players.length !== PLAYER_COUNT) throw new Error('Four players must join before the game starts.');
    dealRound(room, random);
  } else if (action.type === 'bid') {
    if (room.phase !== 'bidding' || room.turn !== index) throw new Error('Wait for your prediction turn.');
    const bid = action.value;
    if (!Number.isInteger(bid) || bid < 0 || bid > room.round) throw new Error(`Predict between 0 and ${room.round} tricks.`);
    const previous = room.players.filter(p => p.prediction !== null);
    if (previous.length === PLAYER_COUNT - 1 && previous.reduce((sum, p) => sum + p.prediction, 0) + bid === room.round) throw new Error('The prediction total cannot equal the number of tricks this round.');
    player.prediction = bid;
    if (previous.length === PLAYER_COUNT - 1) {
      room.phase = 'playing';
      room.turn = room.first;
      room.message = `${room.players[room.first].name} leads the first trick.`;
    } else room.turn = (index + 1) % PLAYER_COUNT;
  } else if (action.type === 'play') {
    if (room.phase !== 'playing' || room.turn !== index) throw new Error('Wait for your turn to play.');
    const card = player.hand.find(card => card.id === action.cardId);
    if (!card) throw new Error('That card is not in your hand.');
    if (!legalCards(room, index).includes(card)) throw new Error(`You must follow ${room.trick[0].card.color} because you have that color.`);
    player.hand.splice(player.hand.indexOf(card), 1);
    room.trick.push({ player: index, card });
    if (room.trick.length === PLAYER_COUNT) {
      const winner = trickWinner(room.trick, room.trump);
      room.players[winner].tricks++;
      room.lastTrick = { plays: [...room.trick], winner };
      room.turn = winner;
      room.message = `${room.players[winner].name} wins the trick.`;
      room.phase = 'trick-end';
    } else room.turn = (index + 1) % PLAYER_COUNT;
  } else if (action.type === 'next-round') {
    if (playerId !== room.host) throw new Error('Only the host can deal the next round.');
    if (room.phase !== 'round-end') throw new Error('Finish this round first.');
    dealRound(room, random);
  } else if (action.type === 'rematch') {
    if (playerId !== room.host) throw new Error('Only the host can start a rematch.');
    if (room.phase !== 'finished') throw new Error('Finish the game first.');
    room.round = 0;
    room.history = [];
    for (const player of room.players) player.score = 0;
    dealRound(room, random);
  } else throw new Error('Unknown action.');
  room.updatedAt = Date.now();
}

export function finishTrick(room) {
  if (room.phase !== 'trick-end') return;
  room.trick = [];
  if (room.players.every(player => player.hand.length === 0)) {
    const scores = room.players.map(player => {
      const delta = scoreRound(player.prediction, player.tricks);
      player.score += delta;
      return { prediction: player.prediction, tricks: player.tricks, delta, total: player.score };
    });
    room.history.push({ round: room.round, trump: room.trump, scores });
    room.phase = room.round === 10 ? 'finished' : 'round-end';
    room.turn = null;
    room.message = room.phase === 'finished' ? 'Ten rounds. The scores are in.' : `Round ${room.round} complete. Time to compare predictions.`;
  } else {
    room.phase = 'playing';
    room.message = `${room.players[room.turn].name} leads the next trick.`;
  }
  room.updatedAt = Date.now();
}

export function viewFor(room, playerId) {
  const index = room.players.findIndex(player => player.id === playerId);
  if (index === -1) throw new Error('You are not seated in this room.');
  const predicted = room.players.filter(p => p.prediction !== null);
  const forbiddenBid = room.phase === 'bidding' && predicted.length === PLAYER_COUNT - 1 ? room.round - predicted.reduce((sum, p) => sum + p.prediction, 0) : null;
  return {
    code: room.code, phase: room.phase, round: room.round, first: room.first, turn: room.turn, trump: room.trump,
    trick: room.trick, lastTrick: room.lastTrick, history: room.history, message: room.message,
    you: index, isHost: room.host === playerId, forbiddenBid,
    players: room.players.map(p => ({ name: p.name, prediction: p.prediction, tricks: p.tricks, score: p.score, cards: p.hand.length })),
    hand: room.players[index].hand,
    legalCardIds: room.phase === 'playing' && room.turn === index ? legalCards(room, index).map(card => card.id) : []
  };
}
