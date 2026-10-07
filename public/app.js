import { wizardArt, ranks } from './card-art.js';
import { latestState } from './state.js';

const app = document.querySelector('#app');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');
const colors = ['red', 'gold', 'green', 'blue', 'purple'];
const symbols = { red: '♨', gold: '☀', green: '❧', blue: '≋', purple: '✦' };
const names = { red: 'Red', gold: 'Gold', green: 'Green', blue: 'Blue', purple: 'Purple' };
let seat = null;
let state = null;
let events = null;
let connected = false;
let pending = false;
let noticeTimer;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = n => n > 0 ? `+${n}` : String(n);

function savedSeat() {
  try {
    const stored = JSON.parse(sessionStorage.getItem('wizards-seat') ?? 'null');
    if (stored?.code && stored?.token) return stored;
  } catch { /* Embedded browsers may deny all access to session storage. */ }
  const token = new URLSearchParams(location.hash.slice(1)).get('seat');
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  return token && /^[a-f0-9-]{36}$/.test(token) && code && /^[A-Z2-9]{6}$/.test(code) ? { code, token } : null;
}

function rememberSeat(currentSeat) {
  let stored = false;
  try { sessionStorage.setItem('wizards-seat', JSON.stringify(currentSeat)); stored = true; } catch { /* Use this tab's private URL fragment instead. */ }
  // Fragments are never sent to the server and are excluded from invite links.
  history.replaceState({}, '', `?room=${currentSeat.code}${stored ? '' : `#seat=${currentSeat.token}`}`);
}

function forgetSeat() {
  try { sessionStorage.removeItem('wizards-seat'); } catch { /* Storage is optional. */ }
  history.replaceState({}, '', location.pathname + location.search);
}

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.className = error ? 'notice error' : 'notice';
  noticeTimer = setTimeout(() => { notice.textContent = ''; notice.className = ''; }, 6500);
}

async function request(path, data) {
  const headers = {};
  if (seat) headers.Authorization = `Bearer ${seat.token}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Something went wrong. Please try again.');
  return result;
}

function cardMarkup(card, { playable = false, disabled = false, decorative = false } = {}) {
  if (card.hidden) {
    const inside = '<span class="back-sigil">✦<span>☾</span>✦</span><span class="back-label">YOUR FATE IS HIDDEN</span>';
    return `<button class="card hand-card card-back" data-action="play-blind" ${disabled ? 'disabled' : ''} aria-label="Play your face-down card" title="Your card stays hidden until you play it">${inside}</button>`;
  }
  const tier = Math.ceil(card.value / 3);
  const inside = `<span class="card-corner">${card.value}<small>${symbols[card.color]}</small></span>${wizardArt(card.value)}<span class="card-rank">${ranks[card.value - 1]}</span><span class="card-color">${names[card.color]}</span><span class="card-bottom">${card.value}</span>`;
  const label = `${names[card.color]} ${card.value}`;
  return playable ? `<button class="card hand-card" data-color="${card.color}" data-tier="${tier}" data-card="${card.id}" ${disabled ? 'disabled' : ''} aria-label="Play ${label}" title="${disabled ? 'Wait for your turn, or follow the first color' : `Play ${label}`}">${inside}</button>` : `<div class="card" data-color="${card.color}" data-tier="${tier}" ${decorative ? 'aria-hidden="true"' : `aria-label="${label}"`}>${inside}</div>`;
}

function landing() {
  const invitedCode = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) ?? '';
  app.innerHTML = `<section class="landing">
    <div class="hero"><span class="eyebrow"><span class="tiny-star">✦</span> A GAME OF FORESIGHT</span><h1>Know your hand.<br>Call your <em>fate.</em></h1><p>Two to five wizards at one table. Predict the tricks you’ll win, follow the colors, and make every card count.</p>
      <div class="hero-cards">${cardMarkup({ color: 'blue', value: 9 }, { decorative: true })}${cardMarkup({ color: 'purple', value: 15 }, { decorative: true })}${cardMarkup({ color: 'gold', value: 7 }, { decorative: true })}<span class="orbit-star">✧</span></div>
      <div class="hero-stats"><div><strong>75</strong><span>CARDS</span></div><div><strong>5</strong><span>COLORS</span></div><div><strong>10</strong><span>ROUNDS</span></div></div>
    </div>
    <section class="entry-panel"><span class="eyebrow">TAKE YOUR SEAT</span><h2>The table awaits.</h2><p>Bring your friends. A good prediction starts with good company.</p>
      <form id="create-form"><label for="player-name">YOUR NAME</label><input id="player-name" name="name" maxlength="24" placeholder="What shall we call you?" autocomplete="nickname" required><label class="player-count-label" for="player-count">PLAYERS AT YOUR TABLE</label><select id="player-count" name="playerCount">${[2, 3, 4, 5].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n} players</option>`).join('')}</select><button class="primary" type="submit">Create a room <span>→</span></button></form>
      <div class="divider"><span>OR JOIN YOUR FRIENDS</span></div>
      <form id="join-form"><label for="room-code">ROOM CODE</label><div class="join-row"><input id="room-code" name="code" maxlength="6" minlength="6" pattern="[A-Za-z2-9]{6}" placeholder="ABC123" value="${escape(invitedCode)}" autocomplete="off" required><button class="secondary" type="submit">Join room →</button></div></form>
      <div class="entry-foot"><span>✧</span> No account. Just cards and company.</div>
    </section>
  </section>`;
  document.querySelector('#create-form').addEventListener('submit', event => { event.preventDefault(); enter(false); });
  document.querySelector('#join-form').addEventListener('submit', event => { event.preventDefault(); enter(true); });
  document.querySelector('#room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase(); });
}

async function enter(join) {
  const nameInput = document.querySelector('#player-name');
  if (!nameInput.reportValidity() || pending) return;
  const code = document.querySelector('#room-code').value.trim().toUpperCase();
  pending = true;
  document.querySelectorAll('form button').forEach(button => { button.disabled = true; });
  try {
    const result = await request(join ? `/api/rooms/${code}/join` : '/api/rooms', { name: nameInput.value.trim(), ...(!join ? { playerCount: Number(document.querySelector('#player-count').value) } : {}) });
    seat = { code: result.code, token: result.token };
    rememberSeat(seat);
    state = result.state;
    subscribe();
  } catch (error) { notify(error.message, true); }
  finally {
    pending = false;
    if (state) render();
    else document.querySelectorAll('form button').forEach(button => { button.disabled = false; });
  }
}

function subscribe() {
  events?.close();
  connected = false;
  connection.textContent = 'Connecting…';
  connection.classList.remove('live');
  events = new EventSource(`/api/rooms/${seat.code}/events?token=${encodeURIComponent(seat.token)}`);
  events.onmessage = event => {
    state = latestState(state, JSON.parse(event.data));
    connected = true;
    connection.textContent = 'Table connected';
    connection.classList.add('live');
    render();
  };
  events.onerror = () => {
    connected = false;
    connection.textContent = 'Reconnecting…';
    connection.classList.remove('live');
    render();
  };
}

async function action(data) {
  if (pending || !connected) return;
  pending = true;
  render();
  try { state = latestState(state, await request(`/api/rooms/${seat.code}/actions`, data)); }
  catch (error) { notify(error.message, true); }
  finally { pending = false; render(); }
}

async function copyInvite() {
  const link = `${location.origin}/?room=${seat.code}`;
  try { await navigator.clipboard.writeText(link); notify('Invite link copied. Send it to your friends.'); }
  catch { notify(`Share room code ${seat.code} with your friends.`); }
}

function lobby() {
  app.innerHTML = `<section class="lobby-view"><div class="lobby-intro"><span class="eyebrow">YOUR PRIVATE TABLE</span><h1>A place for<br>${state.playerCount} <em>wizards.</em></h1><p>Share your room code or invite link.<br>Once everyone is seated, the host can deal.</p><div class="room-code-box"><span class="eyebrow">ROOM CODE</span><strong>${state.code}</strong><button class="secondary" data-copy>Copy invite →</button></div><p class="subtle">${location.hash.includes('seat=') ? 'Keep this preview open to hold your seat. Refreshing the containing page may reset it.' : 'Keep this tab to hold your seat. Refreshing will reconnect you.'}</p></div>
    <section class="lobby-panel"><div class="panel-heading"><h2>Around the table</h2><span class="pill">${state.players.length} / ${state.playerCount} seated</span></div><div class="lobby-count"><span class="eyebrow">TABLE SIZE</span><div class="size-options">${[2, 3, 4, 5].map(n => `<button data-size="${n}" class="size-option ${n === state.playerCount ? 'selected' : ''}" ${!state.isHost || n < state.players.length || pending || !connected ? 'disabled' : ''} aria-label="Set table to ${n} players" aria-pressed="${n === state.playerCount}">${n}</button>`).join('')}</div></div><div class="lobby-seats">${Array.from({ length: state.playerCount }, (_, i) => {
      const player = state.players[i];
      return `<div class="lobby-seat ${player ? '' : 'empty'}"><span class="avatar">${player ? escape(player.name.slice(0, 1).toUpperCase()) : '✧'}</span><div><strong>${player ? escape(player.name) : 'An open seat'}</strong><small>${player ? `${i === state.you ? 'You · ' : ''}${i === 0 ? 'Host' : 'Ready to play'}` : 'Waiting for a friend…'}</small></div><span class="seat-check">${player ? '✓' : '—'}</span></div>`;
    }).join('')}</div>${state.isHost ? `<button class="primary" data-action="start" ${state.players.length < state.playerCount || pending || !connected ? 'disabled' : ''}>Deal the first round <span>→</span></button><p class="center-note">${state.players.length < state.playerCount ? `${state.playerCount - state.players.length} more ${state.playerCount - state.players.length === 1 ? 'wizard' : 'wizards'} needed to begin` : `All ${state.playerCount} wizards are ready.`}</p>` : '<div class="waiting-note">Your seat is saved. Waiting for the host to deal.</div>'}</section></section>`;
}

function positionFor(index) {
  const layouts = {
    2: ['south', 'north'],
    3: ['south', 'north-west', 'north-east'],
    4: ['south', 'west', 'north', 'east'],
    5: ['south', 'west', 'north-west', 'north-east', 'east']
  };
  return layouts[state.playerCount][(index - state.you + state.playerCount) % state.playerCount];
}

function seatMarkup(index) {
  const position = positionFor(index);
  const player = state.players[index];
  const active = state.turn === index && ['bidding', 'playing'].includes(state.phase);
  return `<div class="table-seat ${position} ${active ? 'active' : ''}"><span class="avatar">${escape(player.name.slice(0, 1).toUpperCase())}</span><div><strong>${escape(player.name)}${index === state.you ? ' <span class="you-label">YOU</span>' : ''}</strong><small>${signed(player.score)} pts · ${player.tricks} / ${player.prediction ?? '—'} tricks</small></div>${active ? '<span class="turn-dot" aria-label="Current turn"></span>' : ''}</div>`;
}

function blindReadout() {
  const others = state.players.filter((p, index) => index !== state.you && p.visibleCard);
  if (!others.length) return '';
  return `<section class="blind-readout" aria-label="Other players’ first-round cards"><div><span class="eyebrow">THE BLIND ROUND</span><h4>Their cards. Your guess.</h4><p>Everyone sees your card.<br> You see everyone else’s.</p></div><div class="opponent-cards">${others.map(p => `<div class="opponent-card">${cardMarkup(p.visibleCard)}<span>${escape(p.name)}</span></div>`).join('')}</div></section>`;
}

function scoreTable(full = false) {
  const rows = full ? state.history : state.history.slice(-1);
  return `<div class="score-scroll"><table class="score-table"><caption class="sr-only">Scores by round</caption><thead><tr><th scope="col">Round</th>${state.players.map(p => `<th scope="col">${escape(p.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row.round}</th>${row.scores.map(s => `<td><strong class="${s.delta < 0 ? 'negative' : 'positive'}">${signed(s.delta)}</strong><small>${s.tricks} won / ${s.prediction} predicted</small></td>`).join('')}</tr>`).join('')}<tr class="total"><th scope="row">Total</th>${state.players.map(p => `<td>${signed(p.score)}</td>`).join('')}</tr></tbody></table></div>`;
}

function game() {
  const me = state.players[state.you];
  const myTurn = state.turn === state.you;
  const isSummary = ['round-end', 'finished'].includes(state.phase);
  let title, subtitle;
  if (state.phase === 'bidding') {
    title = myTurn ? 'What does your hand promise?' : `${escape(state.players[state.turn].name)} is predicting.`;
    subtitle = state.blindRound ? 'Blind round: see everyone else’s card and guess your own fate.' : myTurn ? 'Choose how many tricks you think you’ll win.' : 'Study your cards. Your prediction comes next.';
  } else if (state.phase === 'trick-end') {
    title = `${escape(state.players[state.lastTrick.winner].name)} takes the trick.`;
    subtitle = 'The winner will lead the next trick.';
  } else if (isSummary) {
    title = state.phase === 'finished' ? 'The cards have spoken.' : `Round ${state.round}, in the books.`;
    subtitle = state.phase === 'finished' ? 'Ten rounds of foresight. Here’s where everyone stands.' : 'Exact predictions pay. Every missed trick has a price.';
  } else {
    title = myTurn ? 'Your turn. Make it count.' : `${escape(state.players[state.turn].name)} is playing.`;
    const lead = state.trick[0]?.card.color;
    subtitle = state.blindRound ? `Your card stays face down until you play it. ${names[state.trump]} is trump.` : lead ? `Follow ${names[lead]} if you have it. ${names[state.trump]} is trump.` : `${myTurn ? 'Choose a color to lead.' : 'Waiting for the first card.'} ${names[state.trump]} is trump.`;
  }
  app.innerHTML = `<section class="game-view"><div class="game-top"><div><span class="eyebrow">ROOM ${state.code}</span><h2>Round ${state.round}<span class="round-total"> / 10</span></h2></div><div class="game-meta"><span class="trump-chip" data-color="${state.trump}"><span>${symbols[state.trump]}</span><span><small>TRUMP COLOR</small>${names[state.trump]}</span></span><button class="text-button" data-copy>Invite →</button>${state.isHost ? `<button class="secondary lobby-return" data-lobby ${pending || !connected ? 'disabled' : ''}>Back to lobby</button>` : ''}</div></div>
    <div class="game-headline"><h3>${title}</h3><p>${subtitle}</p></div>
    ${isSummary ? summary() : `${state.blindRound ? blindReadout() : ''}<div class="play-layout"><div class="table-wrap"><div class="card-table" data-count="${state.playerCount}"><span class="table-watermark">✦<small>WIZARDS</small></span>
      ${state.players.map((_, index) => seatMarkup(index)).join('')}
      <div class="trick-cards">${state.trick.map(play => {
        return `<div class="played-card" data-position="${positionFor(play.player)}">${cardMarkup(play.card)}<span>${escape(state.players[play.player].name)}</span></div>`;
      }).join('')}</div>
      ${state.phase === 'bidding' ? '<div class="table-empty"><span>✧</span>Before the first card,<br>make your prediction.</div>' : state.trick.length === 0 ? '<div class="table-empty"><span>✧</span>A fresh trick awaits.</div>' : ''}
    </div></div><aside class="round-panel"><span class="eyebrow">THE PREDICTIONS</span><div class="prediction-list">${state.players.map((p, i) => `<div class="prediction-row ${i === state.turn ? 'current' : ''}"><span>${escape(p.name)}${i === state.you ? '<small>YOU</small>' : ''}</span><strong>${p.prediction ?? '—'}<small>${state.phase === 'bidding' ? 'predicted' : `${p.tricks} won`}</small></strong></div>`).join('')}</div><div class="prediction-total"><span>Total predicted</span><strong>${state.players.reduce((sum, p) => sum + (p.prediction ?? 0), 0)} <small>/ ${state.round}</small></strong></div><p class="side-note">The total must be different from ${state.round}. Someone’s fate is a little uncertain.</p>${state.lastTrick ? `<div class="last-winner"><span>LAST TRICK</span><strong>${escape(state.players[state.lastTrick.winner].name)} won</strong></div>` : ''}</aside></div>
    ${state.phase === 'bidding' && myTurn ? `<section class="bid-panel"><div><span class="eyebrow">YOUR CALL</span><h3>How many tricks?</h3></div><div class="bid-options">${Array.from({ length: state.round + 1 }, (_, bid) => `<button class="bid-button" data-bid="${bid}" ${bid === state.forbiddenBid || pending || !connected ? 'disabled' : ''} aria-label="Predict ${bid} tricks${bid === state.forbiddenBid ? ' (forbidden total)' : ''}">${bid}${bid === state.forbiddenBid ? '<small>blocked</small>' : ''}</button>`).join('')}</div>${state.forbiddenBid !== null && state.forbiddenBid >= 0 && state.forbiddenBid <= state.round ? `<p class="bid-explanation">${state.forbiddenBid} is unavailable: it would make the total equal ${state.round}.</p>` : ''}</section>` : ''}
    <section class="hand-section"><div class="hand-heading"><div><span class="eyebrow">YOUR HAND</span><span>${state.hand.length} ${state.hand.length === 1 ? 'card' : 'cards'} · ${me.prediction === null ? 'prediction pending' : `${me.tricks} won / ${me.prediction} predicted`}</span></div><span class="hand-hint">${state.blindRound ? 'Your first card is hidden from you.' : state.phase === 'bidding' ? 'Read your hand before you call.' : myTurn && state.phase === 'playing' ? 'Select a highlighted card to play.' : 'Your cards are visible only to you.'}</span></div><div class="hand">${state.hand.map(card => cardMarkup(card, { playable: true, disabled: pending || !connected || (card.hidden ? !state.canPlayBlind : !state.legalCardIds.includes(card.id)) })).join('')}</div></section>`}
    ${state.history.length && !isSummary ? `<details class="history"><summary>Score history <span>→</span></summary>${scoreTable(true)}</details>` : ''}</section>`;
}

function summary() {
  const finished = state.phase === 'finished';
  const high = Math.max(...state.players.map(p => p.score));
  const winners = state.players.filter(p => p.score === high);
  const last = state.history.at(-1).scores[state.you];
  return `<section class="summary-panel"><div class="summary-heading"><span class="summary-symbol">${finished ? '♛' : '✦'}</span><div><span class="eyebrow">${finished ? winners.length > 1 ? 'A SHARED VICTORY' : 'THE WINNING WIZARD' : last.prediction === last.tricks ? 'PERFECTLY PREDICTED' : 'A TWIST OF FATE'}</span><h3>${finished ? winners.map(p => escape(p.name)).join(' & ') : `${signed(last.delta)} points this round`}</h3><p>${finished ? `${signed(high)} points · Highest total wins` : `You predicted ${last.prediction} and won ${last.tricks} ${last.tricks === 1 ? 'trick' : 'tricks'}.`}</p></div></div>${scoreTable(finished)}<div class="summary-actions">${state.isHost ? `<button class="primary" data-action="${finished ? 'rematch' : 'next-round'}" ${pending || !connected ? 'disabled' : ''}>${finished ? 'Play again' : `Deal round ${state.round + 1}`} <span>→</span></button>` : '<p>Waiting for the host to deal.</p>'}<span>${finished ? `Same ${state.playerCount} wizards. A new chance at fate.` : 'The first predictor moves one seat each round.'}</span></div></section>`;
}

function render() {
  if (!state) return;
  app.dataset.revision = String(state.revision);
  app.dataset.pending = String(pending);
  if (state.phase === 'lobby') lobby(); else game();
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', copyInvite));
  document.querySelectorAll('[data-lobby]').forEach(button => button.addEventListener('click', () => document.querySelector('#lobby-dialog').showModal()));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action({ type: button.dataset.action })));
  document.querySelectorAll('[data-bid]').forEach(button => button.addEventListener('click', () => action({ type: 'bid', value: Number(button.dataset.bid) })));
  document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => action({ type: 'set-player-count', value: Number(button.dataset.size) })));
  document.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => action({ type: 'play', cardId: button.dataset.card })));
}

document.querySelector('#rules-open').addEventListener('click', () => document.querySelector('#rules-dialog').showModal());
document.querySelector('#rules-close').addEventListener('click', () => document.querySelector('#rules-dialog').close());
document.querySelector('#lobby-cancel').addEventListener('click', () => document.querySelector('#lobby-dialog').close());
document.querySelector('#lobby-confirm').addEventListener('click', () => {
  document.querySelector('#lobby-dialog').close();
  action({ type: 'return-to-lobby' });
});

async function initialize() {
  try {
    const stored = savedSeat();
    const requestedCode = new URLSearchParams(location.search).get('room');
    if (stored?.code && stored?.token && (!requestedCode || requestedCode.toUpperCase() === stored.code)) {
      seat = stored;
      state = await request(`/api/rooms/${seat.code}/state`);
      subscribe();
      render();
      return;
    }
  } catch { forgetSeat(); notify('Your old room is no longer available. Create or join a new table.'); }
  seat = null;
  landing();
}
initialize();
