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
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const context = await browser.newContext({ viewport: i === 3 ? { width: 390, height: 844 } : { width: 1360, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    pages.push(page);
  }
  const names = ['Ada', 'Ben', 'Cleo', 'Dara'];
  await pages[0].goto(base);
  await pages[0].getByRole('heading', { name: 'Know your hand. Call your fate.' }).waitFor();
  await pages[0].screenshot({ path: '/tmp/wizards-landing.png', fullPage: true });
  await pages[0].getByLabel('YOUR NAME', { exact: true }).fill(names[0]);
  await pages[0].getByRole('button', { name: 'Create a room' }).click();
  await pages[0].getByRole('heading', { name: 'Around the table' }).waitFor();
  const code = await pages[0].locator('.room-code-box strong').textContent();
  for (let i = 1; i < 4; i++) {
    await pages[i].goto(`${base}/?room=${code}`);
    await pages[i].getByLabel('YOUR NAME', { exact: true }).fill(names[i]);
    await pages[i].getByRole('button', { name: 'Join room' }).click();
    await pages[i].getByRole('heading', { name: 'Around the table' }).waitFor();
  }
  await pages[0].getByText('4 / 4 seated').waitFor();
  assert.equal(await pages[3].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile lobby should fit the screen');
  await pages[0].screenshot({ path: '/tmp/wizards-lobby.png', fullPage: true });
  console.log('PASS: four browsers create and join one room, including a mobile viewport.');

  async function getState(page) {
    return page.evaluate(async () => {
      const seat = JSON.parse(sessionStorage.getItem('wizards-seat'));
      const response = await fetch(`/api/rooms/${seat.code}/state`, { headers: { Authorization: `Bearer ${seat.token}` } });
      return response.json();
    });
  }
  async function clickAction(page, locator) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().method() === 'POST');
    await locator.click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    return response.json();
  }
  let state = await clickAction(pages[0], pages[0].getByRole('button', { name: 'Deal the first round' }));
  await pages[3].reload();
  await pages[3].locator('.hand-card').first().waitFor();
  assert.equal((await getState(pages[3])).you, 3, 'reload should keep the original seat');
  assert.equal((await getState(pages[3])).players.length, 4);
  console.log('PASS: reloading reconnects to the same seat and private hand.');

  for (let round = 1; round <= 10; round++) {
    assert.equal(state.round, round);
    assert.equal(state.first, (round - 1) % 4);
    const hands = await Promise.all(pages.map(getState));
    for (let i = 0; i < 4; i++) {
      assert.equal(hands[i].hand.length, round);
      assert.equal(hands[i].you, i);
      assert.equal(hands[i].players.some(player => 'hand' in player), false);
    }
    assert.equal(new Set(hands.flatMap(view => view.hand.map(card => card.id))).size, round * 4);
    if (round === 4) {
      await pages[0].screenshot({ path: '/tmp/wizards-table.png', fullPage: true });
      await pages[3].screenshot({ path: '/tmp/wizards-mobile.png', fullPage: true });
      assert.equal(await pages[3].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile game should fit the screen');
    }
    for (let i = 0; i < 4; i++) {
      const page = pages[state.turn];
      await page.locator('[data-bid="0"]:not([disabled])').waitFor();
      if (round === 1 && i === 3) assert.equal(await page.locator('[data-bid="1"]').isDisabled(), true, 'forbidden prediction is disabled');
      state = await clickAction(page, page.locator('[data-bid="0"]'));
    }
    for (let trick = 0; trick < round; trick++) {
      for (let i = 0; i < 4; i++) {
        const page = pages[state.turn];
        const privateState = await getState(page);
        const chosen = privateState.legalCardIds[0];
        assert.ok(chosen, 'the current player must have a legal card');
        state = await clickAction(page, page.locator(`[data-card="${chosen}"]:not([disabled])`));
      }
      await pages[0].waitForFunction(async () => {
        const seat = JSON.parse(sessionStorage.getItem('wizards-seat'));
        const result = await fetch(`/api/rooms/${seat.code}/state`, { headers: { Authorization: `Bearer ${seat.token}` } });
        return (await result.json()).phase !== 'trick-end';
      });
      state = await getState(pages[0]);
    }
    assert.equal(state.phase, round === 10 ? 'finished' : 'round-end');
    assert.equal(state.history.length, round);
    for (let i = 0; i < 4; i++) {
      const view = await getState(pages[i]);
      assert.deepEqual(view.players, state.players);
      assert.deepEqual(view.history, state.history);
    }
    console.log(`PASS: round ${round}, ${round * 4} card plays, four matching scoreboards.`);
    if (round < 10) state = await clickAction(pages[0], pages[0].getByRole('button', { name: `Deal round ${round + 1}` }));
  }
  await pages[0].getByRole('heading', { name: 'The cards have spoken.' }).waitFor();
  assert.equal(await pages[0].locator('.score-table tbody tr').count(), 11);
  state = await clickAction(pages[0], pages[0].getByRole('button', { name: 'Play again' }));
  assert.equal(state.round, 1);
  assert.deepEqual(state.players.map(player => player.score), [0, 0, 0, 0]);
  await pages[3].getByRole('button', { name: 'How to play' }).click();
  assert.equal(await pages[3].locator('dialog').isVisible(), true);
  await pages[3].getByRole('button', { name: 'Close rules' }).click();
  assert.deepEqual(failures, [], 'no uncaught browser errors');
  console.log('PASS: ten-round browser game, winner screen, rematch, rules dialog, and no browser errors.');
} finally {
  await browser?.close();
  await server.stop();
}
