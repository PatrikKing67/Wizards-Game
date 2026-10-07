# Wizards

A 2–5-player multiplayer browser card game. Choose the table size, create a private room, share its invite link or six-character code, and play ten rounds with friends. Round 1 is blind: each browser sees opponents’ cards but not its own until played. From round 2 onward, each browser sees only its own hand. The server deals, validates actions, resolves tricks, and calculates scores.

## Development

Requires Node.js 22 or newer. No application runtime dependencies, database, or credentials are needed.

```sh
cd /workspace/Wizards-Game
npm ci --cache /workspace/.cache/wizards-npm
npm start
```

The server listens on port 3000 on all interfaces. Set `PORT` or `HOST` to override this. `npm run dev` restarts the server when source files change. There is no separate frontend build: the server serves the HTML, CSS, and JavaScript in `public/`.

For multiplayer, all players must open the same reachable server. Each tab holds its seat in session storage, so you can also test using one tab per player. Refreshing reconnects to the same seat. Keep the original tab open for the duration of the game.

An embedded preview must load the running server's page, together with its styles, scripts, and API. Opening `public/index.html` by itself in a file preview does not start the game server. The cloud onboarding UI does not provide a supported localhost web preview.

For previews connected to a running server, if the browser denies session storage, the game retains the seat in a private URL fragment, which is excluded from invite links and server requests. Reloading that game frame reconnects; refreshing the containing page may reset the frame URL and lose the seat. Keep the preview open during play, or use a separate browser tab.

## Online play

Online multiplayer requires a reachable Node web service serving this repository. A static HTML file preview or static-site host cannot run the room API.

`render.yaml` prepares a single-service Render deployment, using the Node version tested in this environment. Publishing the code to GitHub and creating the hosted service require your hosting account. No service has been deployed by adding this configuration.

1. Publish the project files to the selected GitHub repository.
2. In Render, create a Blueprint from that repository and review the service defined by `render.yaml`. Alternatively, create a Node web service manually with build command `npm ci --omit=dev`, start command `npm start`, and health-check path `/health`.
3. Open the service's assigned HTTPS address. You should see the styled Wizards landing page with name, Create a room, and Join room controls.
4. Verify the selected number of separate browser sessions can join one room, start, predict, and play a round before sharing the service with friends.

Run one instance: rooms currently live in that process's memory. Free hosting can suspend idle services, which clears active rooms when the server restarts. Public-host validation is still required after deployment.

## Rules

- Choose 2–5 players when creating a room (default four); the host can resize the lobby before starting without removing joined players. There are 75 distinct cards: values 1–15 in red, gold, green, blue, and purple.
- Ten rounds. Each player receives as many cards as the round number. The deck is freshly shuffled each round. Trump is chosen randomly and can repeat across rounds.
- In round 1, your own card is face down until played and everyone else’s unplayed card is visible. Your card ID, color, and value are not sent to your browser before play. Predict and then play the single hidden card using the blind-play button. Normal private hands return in round 2.
- Players predict tricks in seat order. The first predictor rotates one seat each round, starting with the host in round 1.
- The final predictor cannot choose a number that makes the total predictions equal the round number. Predictions are visible to everyone.
- The first predictor leads the first trick. Players must follow the lead color when they have it; otherwise, they may play any card, including trump.
- The highest trump wins. Without trump, the highest card in the lead color wins. The winner leads the next trick.
- An exact prediction earns `20 + 10 × tricks won`. An incorrect prediction loses `10 × abs(prediction − tricks won)`, with no additional trick points.
- Highest total after round 10 wins; tied players share the victory. The host can start a rematch.

## Validation

```sh
npm test
npm run test:browser
```

`npm test` runs the game engine and HTTP/SSE integration tests, including a full ten-round game at every size from 2–5 players, forced color, trump, scoring, lobby resizing, authentication, and blind-card privacy.

`npm run test:browser` starts an isolated server on a temporary port. It first checks that a sandboxed cross-site embedded preview can load the game, create a room, receive live updates, and reconnect. It then runs the blind first round and normal second round at every table size, plus full ten-round games at both two and five players through independent Chromium sessions, including a mobile viewport and reload recovery. It closes the test server afterward. It uses system Chromium when available; set `CHROMIUM_PATH` to another executable, or install Playwright's Chromium with `npx playwright install chromium`. It writes screenshots to `/tmp/wizards-*.png`.

For a running server, `/health` reports readiness. A useful functional check is to open 2–5 tabs, create/join the same room, predict, play a trick, and verify all scoreboards agree.

## Prototype scope

Rooms live in server memory: a server restart clears them. Unused rooms expire after 12 hours. There are no accounts, bots, spectator seats, or mid-game player replacement yet. A disconnected player retains their seat and can reconnect using the original tab. Room codes and seat tokens provide casual room access; this version has not been deployed as a public service.

## Files

- `game.js`: game rules, variable table size, blind-round privacy, and personalized state.
- `server.js`: HTTP room actions, private live updates with Server-Sent Events, static assets. Live states carry a revision number so delayed action responses cannot overwrite a newer turn.
- `public/`: browser lobby, table, predictions, scoreboards, and rules. `card-art.js` draws scalable wizard portraits: ranks rise from Initiate to Grand Wizard, adding staffs, runes, embroidered robes, halos, wings, and crowns.
- `test/`: engine, server, and browser checks.

Cloud tasks already run in an isolated environment. Use the existing checkout; do not create a Git worktree unless explicitly requested.
