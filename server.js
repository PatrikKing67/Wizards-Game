import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRoom, addPlayer, applyAction, finishTrick, viewFor } from './game.js';

const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/card-art.js': ['card-art.js', 'text/javascript'], '/state.js': ['state.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createGameServer({ trickDelay = 2200 } = {}) {
  const rooms = new Map();
  const timers = new Set();
  const clients = new Map();
  const publish = room => {
    for (const client of clients.get(room.code) ?? []) client.res.write(`data: ${JSON.stringify(viewFor(room, client.playerId))}\n\n`);
  };
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192) throw new Error('Request too large.');
    }
    try { return JSON.parse(text); } catch { throw new Error('Send a valid JSON request.'); }
  }
  function authenticate(req, url, room) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? (url.pathname.endsWith('/events') ? url.searchParams.get('token') : null);
    return room.players.find(player => player.token === token);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // The game is designed to run in embedded previews as well as direct tabs.
    // Keep resource restrictions, but allow the containing page to frame it.
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(res, 403, { error: 'Please use this game’s own page.' });
      if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { status: 'ok', rooms: rooms.size });
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, type] = files[url.pathname];
        const content = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (rooms.size >= 500) return reply(res, 503, { error: 'The game server is full. Please try again later.' });
        const { name, playerCount } = await body(req);
        let code;
        do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
        const { room, player } = createRoom(code, name, playerCount);
        rooms.set(code, room);
        return reply(res, 201, { code, token: player.token, state: viewFor(room, player.id) });
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|state|events|actions)$/);
      if (!match) return reply(res, 404, { error: 'Page not found.' });
      const [, code, endpoint] = match;
      const room = rooms.get(code);
      if (!room) return reply(res, 404, { error: 'Room not found. Ask your host for a new room code.' });
      if (endpoint === 'join' && req.method === 'POST') {
        const { name } = await body(req);
        const player = addPlayer(room, name);
        room.updatedAt = Date.now();
        publish(room);
        return reply(res, 201, { code, token: player.token, state: viewFor(room, player.id) });
      }
      const player = authenticate(req, url, room);
      if (!player) return reply(res, 401, { error: 'Your seat could not be verified. Rejoin from your original browser.' });
      if (endpoint === 'state' && req.method === 'GET') return reply(res, 200, viewFor(room, player.id));
      if (endpoint === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify(viewFor(room, player.id))}\n\n`);
        const client = { res, playerId: player.id };
        if (!clients.has(code)) clients.set(code, new Set());
        clients.get(code).add(client);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => {
          clearInterval(heartbeat);
          clients.get(code)?.delete(client);
          if (clients.get(code)?.size === 0) clients.delete(code);
        });
        return;
      }
      if (endpoint === 'actions' && req.method === 'POST') {
        applyAction(room, player.id, await body(req));
        publish(room);
        if (room.phase === 'trick-end') {
          const revision = room.revision;
          const timer = setTimeout(() => {
            timers.delete(timer);
            // A return to the lobby can start another game before this timer fires.
            if (room.revision !== revision) return;
            finishTrick(room);
            publish(room);
          }, trickDelay);
          timers.add(timer);
        }
        return reply(res, 200, viewFor(room, player.id));
      }
      reply(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      reply(res, 400, { error: error.message });
    }
  });
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) if (!clients.get(code)?.size && Date.now() - room.updatedAt > 12 * 60 * 60 * 1000) rooms.delete(code);
  }, 60000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); for (const timer of timers) clearTimeout(timer); });
  server.stop = () => {
    for (const group of clients.values()) for (const client of group) client.res.end();
    return new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  };
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createGameServer();
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Wizards game listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.stop(); process.exit(0); });
}
