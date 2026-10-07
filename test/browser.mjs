import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createGameServer } from '../server.js';
import { verifyEmbeddedGame } from './embed.mjs';

const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const server = createGameServer({ trickDelay: 30 });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  await verifyEmbeddedGame(browser, base);
  const failures = [];
  for (const count of process.env.WIZARDS_BROWSER_COUNTS ? process.env.WIZARDS_BROWSER_COUNTS.split(',').map(Number) : [2, 3, 4, 5]) {
    const pages = [];
    const contexts = [];
    const liveMessages = new Map();
    for (let i = 0; i < count; i++) {
      const context = await browser.newContext({ viewport: i === count - 1 ? { width: 390, height: 844 } : { width: 1360, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      const recent = [];
      liveMessages.set(page, recent);
      const network = await context.newCDPSession(page);
      await network.send('Network.enable');
      network.on('Network.eventSourceMessageReceived', event => {
        const view = JSON.parse(event.data);
        recent.push({ revision: view.revision, phase: view.phase });
        if (recent.length > 12) recent.shift();
      });
      // Deliver trick-completion HTTP responses after the newer live state.
      await page.route(/\/api\/rooms\/[A-Z2-9]{6}\/actions$/, async route => {
        const response = await route.fetch();
        const view = await response.json();
        if (view.phase === 'trick-end') await new Promise(resolve => setTimeout(resolve, 120));
        await route.fulfill({ response });
      });
      page.on('pageerror', error => failures.push(error.message));
      pages.push(page);
    }
    const names = ['Ada', 'Ben', 'Cleo', 'Dara', 'Eli', 'Faye'];
    await pages[0].goto(base);
    await pages[0].getByRole('heading', { name: 'Know your hand. Call your fate.' }).waitFor();
    await pages[0].screenshot({ path: '/tmp/wizards-landing.png', fullPage: true });
    await pages[0].getByLabel('YOUR NAME', { exact: true }).fill(names[0]);
    await pages[0].getByLabel('PLAYERS AT YOUR TABLE').selectOption(String(count));
    await pages[0].getByRole('button', { name: 'Create a room' }).click();
    await pages[0].getByRole('heading', { name: 'Around the table' }).waitFor();
    const code = await pages[0].locator('.room-code-box strong').textContent();
    assert.equal((await getState(pages[0])).playerCount, count);
    const otherSize = count === 5 ? 2 : 5;
    await clickAction(pages[0], pages[0].getByRole('button', { name: `Set table to ${otherSize} players`, exact: true }));
    await clickAction(pages[0], pages[0].getByRole('button', { name: `Set table to ${count} players`, exact: true }));
    await pages[0].getByRole('button', { name: 'Back to lobby' }).click();
    await pages[0].getByLabel('YOUR NAME', { exact: true }).waitFor();
    for (let i = 1; i < count; i++) {
      await pages[i].goto(`${base}/?room=${code}`);
      await pages[i].getByLabel('YOUR NAME', { exact: true }).fill(names[i]);
      await pages[i].getByRole('button', { name: 'Join room' }).click();
      await pages[i].getByRole('heading', { name: 'Around the table' }).waitFor();
    }
    assert.equal(await pages[0].locator('.landing').isVisible(), true, 'live joins must not replace the opening page');
    await pages[0].getByRole('button', { name: 'Return to game' }).click();
    await pages[0].getByText(`${count} / ${count} seated`).waitFor();
    assert.equal(await pages[count - 1].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile lobby should fit the screen');
    await pages[0].screenshot({ path: '/tmp/wizards-lobby.png', fullPage: true });
    console.log(`PASS: ${count} browsers create and join one room, including a mobile viewport.`);

    async function getState(page) {
      return page.evaluate(async () => {
        const seat = JSON.parse(sessionStorage.getItem('wizards-seat'));
        const response = await fetch(`/api/rooms/${seat.code}/state`, { headers: { Authorization: `Bearer ${seat.token}` } });
        return response.json();
      });
    }
    async function clickAction(page, locator) {
      try {
        const [response] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/actions') && response.request().method() === 'POST'),
          locator.click()
        ]);
        assert.equal(response.status(), 200);
        return response.json();
      } catch (error) {
        await page.screenshot({ path: '/tmp/wizards-browser-failure.png', fullPage: true });
        console.log('Click failure:', await page.evaluate(() => ({
          connection: document.querySelector('#connection').textContent,
          headline: document.querySelector('.game-headline')?.textContent,
          revision: document.querySelector('#app').dataset.revision,
          pending: document.querySelector('#app').dataset.pending,
          cards: [...document.querySelectorAll('.hand button')].map(card => ({ label: card.getAttribute('aria-label'), disabled: card.disabled, x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y }))
        })));
        const serverState = await getState(page);
        console.log('Server state:', { turn: serverState.turn, phase: serverState.phase, revision: serverState.revision, round: serverState.round, tricks: serverState.players.map(p => p.tricks) });
        console.log('Recent live messages:', liveMessages.get(page), 'Browser errors:', failures);
        throw error;
      }
    }
    let state = await clickAction(pages[0], pages[0].getByRole('button', { name: 'Deal the first round' }));
    for (const index of [0, count - 1]) {
      const page = pages[index];
      const before = await getState(page);
      await page.getByRole('button', { name: 'Back to lobby' }).click();
      await page.getByRole('heading', { name: 'Know your hand. Call your fate.' }).waitFor();
      assert.equal(await page.getByLabel('YOUR NAME', { exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Create a room' }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Join room' }).isVisible(), true);
      assert.deepEqual(await getState(page), before, 'opening the name page preserves the game');
      assert.equal(await pages[index === 0 ? count - 1 : 0].locator('.game-view').isVisible(), true, 'other players stay at the table');
      await page.reload();
      await page.getByLabel('YOUR NAME', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('YOUR NAME', { exact: true }).inputValue(), names[index]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'opening page fits on mobile');
      if (count === 5 && index === count - 1) await page.screenshot({ path: '/tmp/wizards-lobby-home-mobile.png', fullPage: true });
      if (index === 0) await page.getByRole('button', { name: 'Return to game' }).click();
      else await page.getByRole('button', { name: 'Join room' }).click();
      await page.locator('.hand .card-back').waitFor();
      assert.deepEqual(await getState(page), before, 'resume restores the original seat and hand');
    }
    console.log(`PASS: ${count}-player back to name page, reload, preserved game, and seat recovery.`);
    await pages[count - 1].reload();
    await pages[count - 1].locator('.hand-card').first().waitFor();
    assert.equal((await getState(pages[count - 1])).you, count - 1, 'reload should keep the original seat');
    assert.equal((await getState(pages[count - 1])).players.length, count);
    console.log('PASS: reloading reconnects to the same seat and private hand.');

    const rounds = count === 2 || count === 5 ? 10 : 2;
    for (let round = 1; round <= rounds; round++) {
      assert.equal(state.round, round);
      assert.equal(state.first, (round - 1) % count);
      const hands = await Promise.all(pages.map(getState));
      for (let i = 0; i < count; i++) {
        assert.equal(hands[i].hand.length, round);
        assert.equal(hands[i].you, i);
        assert.equal(hands[i].players.some(player => 'hand' in player), false);
      }
      if (round === 1) {
        for (let i = 0; i < count; i++) {
          assert.deepEqual(hands[i].hand, [{ hidden: true }]);
          assert.deepEqual(hands[i].legalCardIds, []);
          assert.equal(hands[i].players[i].visibleCard, null);
          await pages[i].locator('.hand .card-back').waitFor();
          assert.equal(await pages[i].locator('.opponent-card').count(), count - 1);
          assert.equal(await pages[i].locator('.hand [data-color]').count(), 0);
          assert.equal(await pages[i].locator('.hand [data-card]').count(), 0);
        }
        if (count === 5) {
          await pages[0].screenshot({ path: '/tmp/wizards-five-blind.png', fullPage: true });
          await pages[count - 1].screenshot({ path: '/tmp/wizards-five-blind-mobile.png', fullPage: true });
        }
      } else {
        assert.equal(new Set(hands.flatMap(view => view.hand.map(card => card.id))).size, round * count);
        for (let i = 0; i < count; i++) {
          assert.equal(hands[i].players.every(player => player.visibleCard === null), true);
          await pages[i].locator('.hand [data-card]').first().waitFor();
          assert.equal(await pages[i].locator('.opponent-card').count(), 0);
          assert.equal(await pages[i].locator('.hand .card-back').count(), 0);
        }
      }
      assert.equal(await pages[count - 1].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const page of pages) assert.equal(await page.locator('.card-bottom').evaluateAll(numbers => numbers.every(number => getComputedStyle(number).transform === 'none')), true, 'the lower number on every card is upright');

      if (round === 4 && count === 5) {
        await pages[0].screenshot({ path: '/tmp/wizards-five-table.png', fullPage: true });
        await pages[count - 1].screenshot({ path: '/tmp/wizards-five-mobile.png', fullPage: true });
        assert.equal(await pages[count - 1].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile game should fit the screen');
      }
      for (let i = 0; i < count; i++) {
        const page = pages[state.turn];
        await page.locator('[data-bid="0"]:not([disabled])').waitFor();
        if (round === 1 && i === count - 1) assert.equal(await page.locator('[data-bid="1"]').isDisabled(), true, 'forbidden prediction is disabled');
        state = await clickAction(page, page.locator('[data-bid="0"]'));
      }
      for (let trick = 0; trick < round; trick++) {
        let lastActor;
        for (let i = 0; i < count; i++) {
          const page = pages[state.turn];
          lastActor = page;
          const privateState = await getState(page);
          if (round === 1) {
            assert.equal(privateState.canPlayBlind, true);
            state = await clickAction(page, page.getByRole('button', { name: 'Play your face-down card' }));
            assert.ok(state.trick.at(-1).card.id);
          } else {
            const chosen = privateState.legalCardIds[0];
            assert.ok(chosen, 'the current player must have a legal card');
            state = await clickAction(page, page.locator(`[data-card="${chosen}"]:not([disabled])`));
          }
          if (count === 5 && round === 4 && trick === 0 && i === 4) await pages[count - 1].screenshot({ path: '/tmp/wizards-five-playing-mobile.png', fullPage: true });
        }
        const expectedPhase = trick + 1 === round ? (round === 10 ? 'finished' : 'round-end') : 'playing';
        const deadline = Date.now() + 10000;
        while (true) {
          state = await getState(pages[0]);
          if (state.round === round && state.phase === expectedPhase && state.players.reduce((sum, player) => sum + player.tricks, 0) === trick + 1) break;
          assert.ok(Date.now() < deadline, `Round ${round}, trick ${trick + 1} did not complete; phase ${state.phase}`);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await lastActor.waitForFunction(() => document.querySelector('#app').dataset.pending === 'false');
        assert.ok(Number(await lastActor.locator('#app').getAttribute('data-revision')) >= state.revision, 'a delayed action response must preserve the newer live turn');
      }
      assert.equal(state.phase, round === 10 ? 'finished' : 'round-end');
      assert.equal(state.history.length, round);
      for (let i = 0; i < count; i++) {
        const view = await getState(pages[i]);
        assert.deepEqual(view.players, state.players);
        assert.deepEqual(view.history, state.history);
      }
      console.log(`PASS: ${count} players, round ${round}, ${round * count} card plays, ${count} matching scoreboards.`);
      if (round < rounds) state = await clickAction(pages[0], pages[0].getByRole('button', { name: `Deal round ${round + 1}` }));
    }
    if (rounds === 10) {
      await pages[0].getByRole('heading', { name: 'The cards have spoken.' }).waitFor();
      assert.equal(await pages[0].locator('.score-table tbody tr').count(), 11);
      state = await clickAction(pages[0], pages[0].getByRole('button', { name: 'Play again' }));
      assert.equal(state.round, 1);
      assert.deepEqual(state.players.map(player => player.score), Array(count).fill(0));
      assert.deepEqual(state.hand, [{ hidden: true }]);
    }
    await pages[count - 1].getByRole('button', { name: 'How to play' }).click();
    assert.equal(await pages[count - 1].locator('#rules-dialog').isVisible(), true);
    await pages[count - 1].getByRole('button', { name: 'Close rules' }).click();
    assert.deepEqual(failures, [], 'no uncaught browser errors');
    console.log(`PASS: ${count}-player blind round, privacy, reload, mobile layout, and ${rounds} rounds.`);
    const previousRoom = await getState(pages[count - 1]);
    await pages[0].getByRole('link', { name: 'Wizards home' }).click();
    await pages[0].getByLabel('YOUR NAME', { exact: true }).fill('New host');
    await pages[0].getByLabel('PLAYERS AT YOUR TABLE').selectOption('2');
    await pages[0].getByRole('button', { name: 'Create a room' }).click();
    await pages[0].getByRole('heading', { name: 'Around the table' }).waitFor();
    const newCode = await pages[0].locator('.room-code-box strong').textContent();
    assert.notEqual(newCode, code);
    assert.deepEqual(await getState(pages[count - 1]), previousRoom, 'creating a new table preserves the previous room');
    await pages[count - 1].getByRole('button', { name: 'Back to lobby' }).click();
    await pages[count - 1].getByLabel('YOUR NAME', { exact: true }).fill('New guest');
    await pages[count - 1].getByLabel('ROOM CODE', { exact: true }).fill(newCode);
    await pages[count - 1].getByRole('button', { name: 'Join room' }).click();
    await pages[count - 1].getByRole('heading', { name: 'Around the table' }).waitFor();
    assert.equal((await getState(pages[count - 1])).code, newCode);
    console.log('PASS: opening page can create another room and join a different room.');
    for (const context of contexts) await context.close();
  }
  assert.deepEqual(failures, []);
  console.log(process.env.WIZARDS_BROWSER_COUNTS ? 'PASS: selected player counts and no browser errors.' : 'PASS: all player counts, full two- and five-player games, and no browser errors.');
} finally {
  await browser?.close();
  await server.stop();
}
