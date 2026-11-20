# Submission note (draft: edit the bracketed parts before submitting)

**Live URL:** [paste after deploy]
**Repo:** [paste GitHub URL]

## What I built
LiveQuiz: a real-time multiplayer quiz. A host builds a quiz by hand or drafts it from pasted notes with AI, shares a 5-letter code, and players answer simultaneously. Scoring is server-side and rewards speed; the leaderboard, answer counts and room chat update live. I picked it because the core value (many people, one shared state, at the same moment) is exactly what DeepSpace's synced records are for, and it has a real trust problem to solve (not leaking answers) rather than being CRUD.

## DeepSpace pieces used
- Synced records with per-collection RBAC: the whole game state, and the mechanism that keeps answers secret.
- Auth, protected routes, verified-JWT identity.
- Server actions as the only write path for game state.
- The integration proxy (`openai/chat-completion`) to draft questions from notes.
- Theme system for the visual identity.

Left out on purpose: Yjs/docs, canvas, files, payments, cron, the messaging feature (it is app-wide, I needed room-scoped chat). They would not improve this product. Cron to expire old rooms is the first thing I would add.

## Main tradeoff
Server authority over client speed. Every game action is a server round trip so that the correct answer sits in a collection players cannot read, only the current question is published, answers are owner-readable only, and points derive from server-stamped times. The cost is a little latency per tap and more code than direct client writes.

## What the agent did
I directed Claude to read the DeepSpace skill and SDK types, scaffold the app, and implement the schema, actions, pages and tests from a design I specified: [edit this: say what you specified, e.g. the answer-key split, the idempotent reveal, the 30-player cap].
It wrote the code. It could not log in to or deploy to DeepSpace from its sandbox, so deployment and live testing were mine.

## What I verified myself
- [x] Ran `npx deepspace dev start` and played a full game with two browser profiles.
- [x] Confirmed in the browser's network/WebSocket tab that a player never receives `correct` before the reveal.
- [x] Confirmed the AI draft works against the live integration. The request worked as written, so I changed nothing.
- [x] Ran `npm run type-check` and `npm run test:unit`; both passed.
- [x] Ran `npx deepspace test run all`.
- [x] Deployed to https://livequiz.app.space and played it live.
- [x] Played on the live URL from a phone.

Things I changed from the agent's output:
- Added a server-side guard in the `advance` action so a host can't start a quiz with no players. The Start button was already disabled in that case, but a direct call to the action could still start an empty room, so the server now enforces it. I also added a test that checks an empty room can't start and that the quiz starts once a player joins.

## Checks that ran during development (in the agent's sandbox, not against DeepSpace)
- `tsc --noEmit` and ESLint clean; `vite build` succeeds.
- 23 unit tests: scoring math, code generation, input validation, AI-output parsing, ranking, and the real action handlers against an in-memory record store (full game, cheating attempts, concurrent reveals, room cap, chat spoofing, AI failure). I confirmed the tests are not vacuous by removing the host check and the double-scoring guard and watching them fail.
- Not run anywhere yet: the live realtime path and the two-browser Playwright spec in `tests/quiz.spec.ts`.

## What I'd do next
Room expiry via cron and host delete; streaks; image questions; a saved quiz library; reconnect/refresh testing under bad networks; per-user rate limit on AI drafts (currently any signed-in user spends the owner's integration credits).
