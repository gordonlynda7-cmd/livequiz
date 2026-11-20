/**
 * LiveQuiz server actions — the only write path for game state.
 *
 * Actions run with record-level RBAC OFF (see src/server/action-routes.ts), so
 * every handler here does its own authorization: who is the host, is the room
 * in the right phase, has the deadline passed. The caller id comes from the
 * verified JWT, never from `params`.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  MAX_PLAYERS,
  QUESTION_SECONDS,
  makeCode,
  normalizeCode,
  parseGenerated,
  pointsFor,
  validateQuestions,
} from '../lib/quiz'

type Row = Record<string, unknown>
interface RoomRow extends Row {
  code: string
  title: string
  hostId: string
  status: 'lobby' | 'question' | 'reveal' | 'done'
  questionIndex: number
  questionCount: number
  questionSeconds: number
  questionStartedAt: number
  questionEndsAt: number
}
interface KeyRow extends Row { index: number; prompt: string; optionsJson: string; correct: number }
interface PlayerRow extends Row { userId: string; name: string; score: number; lastPoints: number; lastScoredIndex: number }
interface AnswerRow extends Row { userId: string; choice: number; at: number }

class ActionError extends Error {}
const fail = (error: string): ActionResult => ({ success: false, error })

/** Unwrap a tool result or throw an ActionError carrying its human-readable message. */
function ok<T>(r: ActionResult<T>): T {
  if (!r.success) throw new ActionError(r.error)
  return r.data
}

/** Turn thrown ActionErrors into clean failures; log anything unexpected. */
function guard(fn: ActionHandler<Env>): ActionHandler<Env> {
  return async (ctx) => {
    try {
      return await fn(ctx)
    } catch (e) {
      if (e instanceof ActionError) return fail(e.message)
      console.error('[livequiz] action crashed', e)
      return fail('Something went wrong. Please try again.')
    }
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

async function loadRoom(tools: ActionTools, roomId: string) {
  const { record } = ok(await tools.get<RoomRow>('rooms', roomId))
  return { id: record.recordId, room: record.data }
}

async function loadKey(tools: ActionTools, roomId: string, index: number) {
  const { records } = ok(await tools.query<KeyRow>('quizkeys', { where: { roomId, index }, limit: 1 }))
  const key = records[0]?.data
  if (!key) throw new ActionError('Question not found.')
  return key
}

async function beginQuestion(tools: ActionTools, roomId: string, room: RoomRow, index: number) {
  const key = await loadKey(tools, roomId, index)
  const now = Date.now()
  // Only the prompt and options are copied to the public room row. `correct` never leaves quizkeys.
  ok(
    await tools.update('rooms', roomId, {
      status: 'question',
      questionIndex: index,
      prompt: key.prompt,
      optionsJson: key.optionsJson,
      questionStartedAt: now,
      questionEndsAt: now + (room.questionSeconds || QUESTION_SECONDS) * 1000,
      answeredCount: 0,
      revealedIndex: -1,
      distributionJson: '',
    }),
  )
}

/**
 * Close the question: score it, publish the answer, flip the phase.
 *
 * Idempotent on purpose. `tick` fires from every connected client when the timer
 * ends, so several reveals can race. Points are a pure function of the stored
 * answer times, and a player is only credited while `lastScoredIndex < index`,
 * so a second pass writes the same values or skips.
 */
async function revealQuestion(tools: ActionTools, roomId: string, room: RoomRow) {
  const index = room.questionIndex
  const key = await loadKey(tools, roomId, index)
  const { records: answerRecs } = ok(
    await tools.query<AnswerRow>('answers', { where: { roomId, questionIndex: index }, limit: 500 }),
  )
  const { records: playerRecs } = ok(await tools.query<PlayerRow>('players', { where: { roomId }, limit: 500 }))

  const byUser = new Map(answerRecs.map((a) => [a.data.userId, a.data]))
  const distribution = [0, 0, 0, 0]
  for (const a of answerRecs) if (a.data.choice >= 0 && a.data.choice < 4) distribution[a.data.choice]++

  for (const p of playerRecs) {
    const answer = byUser.get(p.data.userId)
    if (!answer) {
      if (p.data.lastPoints !== 0) ok(await tools.update('players', p.recordId, { lastPoints: 0 }))
      continue
    }
    if (p.data.lastScoredIndex >= index) continue
    const points = pointsFor(
      answer.choice === key.correct,
      answer.at,
      room.questionStartedAt,
      room.questionEndsAt,
    )
    ok(
      await tools.update('players', p.recordId, {
        score: p.data.score + points,
        lastPoints: points,
        lastScoredIndex: index,
      }),
    )
  }

  ok(
    await tools.update('rooms', roomId, {
      status: 'reveal',
      revealedIndex: key.correct,
      distributionJson: JSON.stringify(distribution),
      answeredCount: answerRecs.length,
    }),
  )
}

export const actions: Record<string, ActionHandler<Env>> = {
  /** Host creates a room + its hidden answer key. */
  createRoom: guard(async ({ userId, params, tools }) => {
    const title = str(params.title, 60) || 'Untitled quiz'
    const checked = validateQuestions(params.questions)
    if (!checked.ok) return fail(checked.error)
    const seconds = Math.min(60, Math.max(5, Math.round(Number(params.seconds) || QUESTION_SECONDS)))

    let code = ''
    for (let i = 0; i < 6 && !code; i++) {
      const candidate = makeCode()
      const { count } = ok(await tools.query('rooms', { where: { code: candidate }, limit: 1 }))
      if (count === 0) code = candidate
    }
    if (!code) return fail('Could not allocate a room code. Try again.')

    const { recordId: roomId } = ok(
      await tools.create('rooms', {
        code,
        title,
        hostId: userId,
        status: 'lobby',
        questionIndex: -1,
        questionCount: checked.questions.length,
        questionSeconds: seconds,
        questionStartedAt: 0,
        questionEndsAt: 0,
        prompt: '',
        optionsJson: '[]',
        answeredCount: 0,
        revealedIndex: -1,
        distributionJson: '',
      }),
    )
    for (let i = 0; i < checked.questions.length; i++) {
      const q = checked.questions[i]
      ok(
        await tools.create('quizkeys', {
          roomId,
          hostId: userId,
          index: i,
          prompt: q.prompt,
          optionsJson: JSON.stringify(q.options),
          correct: q.correct,
        }),
      )
    }
    return { success: true, data: { roomId, code } }
  }),

  /** Idempotent: safe to call on every page load (React StrictMode calls effects twice). */
  joinRoom: guard(async ({ userId, params, tools }) => {
    const code = normalizeCode(String(params.code ?? ''))
    const { records } = ok(await tools.query<RoomRow>('rooms', { where: { code }, limit: 1 }))
    const found = records[0]
    if (!found) return fail('No room with that code.')
    const roomId = found.recordId
    if (found.data.hostId === userId) return { success: true, data: { roomId, role: 'host' } }
    if (found.data.status === 'done') return fail('That game has finished.')

    const playerId = `${roomId}-${userId}`
    const existing = await tools.get('players', playerId)
    if (!existing.success) {
      const { records: current } = ok(await tools.query('players', { where: { roomId }, limit: MAX_PLAYERS }))
      if (current.length >= MAX_PLAYERS) return fail(`This room is full (${MAX_PLAYERS} players).`)
      ok(
        await tools.create(
          'players',
          {
            roomId,
            userId,
            name: str(params.name, 24) || 'Player',
            score: 0,
            lastPoints: 0,
            lastScoredIndex: -1,
          },
          playerId,
        ),
      )
    }
    return { success: true, data: { roomId, role: 'player' } }
  }),

  /** Host-only: lobby -> Q1, question -> reveal (skip the timer), reveal -> next / done. */
  advance: guard(async ({ userId, params, tools }) => {
    const roomId = String(params.roomId ?? '')
    const { room } = await loadRoom(tools, roomId)
    if (room.hostId !== userId) return fail('Only the host can do that.')

    if (room.status === 'lobby') {
      await beginQuestion(tools, roomId, room, 0)
    } else if (room.status === 'question') {
      await revealQuestion(tools, roomId, room)
    } else if (room.status === 'reveal') {
      const next = room.questionIndex + 1
      if (next >= room.questionCount) ok(await tools.update('rooms', roomId, { status: 'done' }))
      else await beginQuestion(tools, roomId, room, next)
    }
    return { success: true, data: {} }
  }),

  /**
   * Any signed-in client calls this when its local timer hits zero. The server
   * re-checks the clock, so a fast or hostile client cannot end a question early,
   * and a host who closed their tab cannot strand the room.
   */
  tick: guard(async ({ params, tools }) => {
    const roomId = String(params.roomId ?? '')
    const { room } = await loadRoom(tools, roomId)
    if (room.status === 'question' && Date.now() >= room.questionEndsAt) {
      await revealQuestion(tools, roomId, room)
    }
    return { success: true, data: {} }
  }),

  submitAnswer: guard(async ({ userId, params, tools }) => {
    const roomId = String(params.roomId ?? '')
    const choice = Number(params.choice)
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return fail('Invalid choice.')
    const { room } = await loadRoom(tools, roomId)
    if (room.hostId === userId) return fail('The host cannot answer.')
    if (room.status !== 'question') return fail('No question is open.')
    const now = Date.now()
    if (now > room.questionEndsAt + 1500) return fail('Time is up.') // small grace for latency

    const player = await tools.get('players', `${roomId}-${userId}`)
    if (!player.success) return fail('Join the room first.')

    const index = room.questionIndex
    const { count: already } = ok(
      await tools.query('answers', { where: { roomId, questionIndex: index, userId }, limit: 1 }),
    )
    if (already > 0) return fail('You already answered.')

    ok(await tools.create('answers', { roomId, questionIndex: index, userId, choice, at: now }))

    const { records } = ok(await tools.query('answers', { where: { roomId, questionIndex: index }, limit: 500 }))
    ok(await tools.update('rooms', roomId, { answeredCount: records.length }))
    return { success: true, data: {} }
  }),

  /** Chat goes through the server so `name` and `userId` cannot be spoofed. */
  sendChat: guard(async ({ userId, params, tools }) => {
    const roomId = String(params.roomId ?? '')
    const message = str(params.text, 280)
    if (!message) return fail('Say something first.')
    await loadRoom(tools, roomId)
    let name = 'Host'
    const player = await tools.get<PlayerRow>('players', `${roomId}-${userId}`)
    if (player.success) name = player.data.record.data.name
    ok(await tools.create('chat', { roomId, userId, name, text: message }))
    return { success: true, data: {} }
  }),

  /** AI draft of questions from pasted notes. Output is validated like human input. */
  generateQuestions: guard(async ({ params, tools }) => {
    const notes = str(params.notes, 6000)
    if (notes.length < 20) return fail('Paste a few sentences of notes first.')
    const count = Math.min(10, Math.max(3, Math.round(Number(params.count) || 5)))

    const res = await tools.integration<{ choices?: Array<{ message?: { content?: string } }> }>(
      'openai/chat-completion',
      {
        messages: [
          {
            role: 'system',
            content:
              'You write multiple-choice quiz questions. Reply with ONLY a JSON array, no prose. ' +
              'Each item: {"prompt": string, "options": [4 distinct short strings], "correct": 0-3 index of the right option}. ' +
              'Spread the correct index across positions. Base every question only on the notes.',
          },
          { role: 'user', content: `Write ${count} questions from these notes:\n\n${notes}` },
        ],
      },
    )
    if (!res.success) return fail(`AI is unavailable right now (${res.error}). You can still write questions by hand.`)
    const content = res.data.choices?.[0]?.message?.content ?? ''
    const parsed = parseGenerated(content)
    if (!parsed.ok) return fail(`${parsed.error} Try again, or edit by hand.`)
    return { success: true, data: { questions: parsed.questions } }
  }),
}
