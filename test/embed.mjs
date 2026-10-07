import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createGameServer } from '../server.js';

// A different host and port reproduce a game opened inside an external preview.
export async function verifyEmbeddedGame(browser, gameUrl) {
  const wrapper = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Embedded game test</title><iframe id="game" title="Wizards" sandbox="allow-scripts allow-same-origin allow-forms" src="${gameUrl}" width="1200" height="1000"></iframe>`);
  });
  await new Promise(resolve => wrapper.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext();
  let page;
  const errors = [];
  try {
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://localhost:${wrapper.address().port}`);
    const frame = page.frameLocator('#game');
    await frame.getByRole('heading', { name: 'Know your hand. Call your fate.' }).waitFor({ timeout: 10000 });
    await frame.getByLabel('YOUR NAME', { exact: true }).fill('Embedded wizard');
    await frame.getByRole('button', { name: 'Create a room' }).click();
    await frame.getByRole('heading', { name: 'Around the table' }).waitFor({ timeout: 10000 });
    await frame.getByText('Table connected', { exact: true }).waitFor();
    const code = await frame.locator('.room-code-box strong').textContent();
    const gameFrame = page.frames().find(candidate => candidate.url().startsWith(gameUrl));
    await gameFrame.goto(gameFrame.url());
    await frame.getByRole('heading', { name: 'Around the table' }).waitFor();
    assert.equal(await frame.locator('.room-code-box strong').textContent(), code);
    assert.deepEqual(errors, []);
    console.log('PASS: cross-site sandboxed iframe loads, creates a room, receives live updates, and reconnects after reloading the game frame.');
  } catch (error) {
    await page?.screenshot({ path: '/tmp/wizards-embed-error.png', fullPage: true });
    throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}`);
  } finally {
    await context.close();
    await new Promise(resolve => { wrapper.close(resolve); wrapper.closeIdleConnections(); });
  }
}

if (process.argv[1]?.endsWith('/embed.mjs')) {
  const server = createGameServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    await verifyEmbeddedGame(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser?.close();
    await server.stop();
  }
}
