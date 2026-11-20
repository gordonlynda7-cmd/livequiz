# LiveQuiz

A real-time multiplayer quiz on DeepSpace. A host builds a quiz (by hand, or by pasting notes and letting AI draft the questions), shares a five-letter code, and players answer at the same time on their own devices. Scores are computed on the server and the leaderboard moves live.

**Live:** `https://<name>.app.space` (add after deploy)

## How a game works

1. **Host** creates a quiz at `/host`. Each question has four options and one correct answer. Optionally paste notes and click *Draft with AI*; the draft lands in the editor for review.
2. **Players** enter the code on `/home` (or open `/room/CODE`). They appear in the lobby instantly.
3. Host starts. Everyone sees the question and a countdown. Players tap an option. Faster correct answers earn more (500 to 1000).
4. When the timer ends (or the host reveals early) the server scores the round, shows the correct answer and how everyone voted, and updates standings.
5. After the last question: final standings. A chat panel runs alongside the whole game.

## DeepSpace pieces used, and why

| Piece | Where | Why it earns its place |
| --- | --- | --- |
| Synced records (`RecordRoom`, `useQuery`) with per-collection RBAC | `src/schemas/quiz-schema.ts` | The whole game is a few records every client subscribes to. No custom WebSocket code. The permissions are what keep answers secret. |
| Auth + protected routes + verified JWT | `(app)/(protected)/`, `src/lib/api.ts` | Players are real accounts. The caller id used by every server check comes from the JWT, never from request params. |
| Server actions | `src/actions/index.ts` | Authoritative game logic: host-only transitions, deadlines, one answer per player, scoring. Clients cannot write game state directly. |
| Integration proxy (`openai/chat-completion`) | `generateQuestions` action | Drafts questions from pasted notes. Output is parsed and validated exactly like hand-written input, and failure falls back to manual entry. |
| Theme system | `src/themes.css` (`arcade`) | Own look instead of the scaffold placeholder. |

## Main tradeoff

**Server authority over a snappier client.** Every state change is a round trip to a server action instead of a direct client write. That costs a little latency per tap, but it is what makes the game honest: the correct answer lives in a collection no player can read (`quizkeys`), only the *current* question is copied to the public room row, answers are readable only by their owner, and points come from server-stamped times. A client-write design would have been less code, but any player could read the key or write their own score.

Smaller tradeoffs, all deliberate:
- **Timer is client-rendered, server-enforced.** Clients count down locally; when theirs hits zero they all call `tick`, and the server re-checks its own clock and is idempotent (covered by a concurrency test). A host who closes their tab cannot strand the room.
- **Room cap of 30.** One reveal does one write per player and Workers limit subrequests per invocation. 30 keeps it safely under.
- **Chat is a plain collection, not the messaging feature.** The messaging feature is app-wide channels; I needed room-scoped chat, and writes go through an action so names cannot be spoofed.
- **Did not use:** Yjs/collaborative docs, canvas, files/R2, payments, cron. None of them improve a live quiz. Cron for expiring old rooms is the first thing I'd add.

## What the agent did vs. what I checked

See `SUBMISSION_NOTE.md`.

## Not finished / next

- Expire and delete old rooms (cron), and let a host delete a room.
- Host cannot also play; hosting is a presenter role.
- Streak bonuses, image questions, saved quiz library.
- AI endpoint request shape was taken from the SDK docs, not the live catalog; confirm with `npx deepspace integrations info openai/chat-completion`.

## Run it

```bash
npm i                      # needs Node 22.15+ and npm 11.6+
npx deepspace auth login
npx deepspace app init
npx deepspace dev start
npx deepspace test run all # unit tests + the two-user e2e (needs 2 test accounts)
npx deepspace deploy
```
