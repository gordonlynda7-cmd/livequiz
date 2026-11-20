/**
 * Drives the REAL action handlers against an in-memory stand-in for ActionTools,
 * so the whole game loop (and the ways to cheat it) is exercised without a deploy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { actions } from './index'

type Rec = { recordId: string; data: Record<string, unknown>; createdBy: string }

function fakeTools(userId: string, db: Map<string, Rec[]>, ai?: unknown): ActionTools {
  let n = 0
  const table = (c: string) => db.get(c) ?? db.set(c, []).get(c)!
  const okRes = <T,>(data: T): ActionResult<T> => ({ success: true, data })
  const matches = (r: Rec, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => (k === 'recordId' ? r.recordId === v : r.data[k] === v))
  return {
    create: async (c: string, data: Record<string, unknown>, id?: string) => {
      const recordId = id ?? `${c}_${++n}_${Math.random().toString(36).slice(2, 6)}`
      const t = table(c)
      const i = t.findIndex((r) => r.recordId === recordId)
      const rec = { recordId, data: { ...data }, createdBy: userId }
      if (i >= 0) t[i] = rec
      else t.push(rec)
      return okRes({ recordId })
    },
    update: async (c: string, id: string, data: Record<string, unknown>) => {
      const r = table(c).find((x) => x.recordId === id)
      if (!r) return { success: false, error: 'not found' } as ActionResult<never>
      Object.assign(r.data, data)
      return okRes({ recordId: id })
    },
    get: async (c: string, id: string) => {
      const r = table(c).find((x) => x.recordId === id)
      return r ? okRes({ record: r }) : ({ success: false, error: 'not found' } as ActionResult<never>)
    },
    query: async (c: string, o: { where?: Record<string, unknown>; limit?: number } = {}) => {
      const records = table(c).filter((r) => matches(r, o.where)).slice(0, o.limit ?? 100)
      return okRes({ records, count: records.length })
    },
    remove: async () => okRes({ recordId: '' }),
    deleteWhere: async () => okRes({ deleted: 0 }),
    integration: async () => (ai ?? { success: false, error: 'no ai' }) as ActionResult<never>,
  } as unknown as ActionTools
}

const run = (name: string, userId: string, db: Map<string, Rec[]>, params: Record<string, unknown> = {}, ai?: unknown) =>
  actions[name]({ userId, params, tools: fakeTools(userId, db, ai), env: {} as never, callerJwt: 'x' })

const QUESTIONS = [
  { prompt: 'Q1?', options: ['a', 'b', 'c', 'd'], correct: 2 },
  { prompt: 'Q2?', options: ['e', 'f', 'g', 'h'], correct: 0 },
]
type Data = { roomId: string; code: string }
const room = (db: Map<string, Rec[]>) => db.get('rooms')![0].data

describe('LiveQuiz game loop', () => {
  let db: Map<string, Rec[]>
  let roomId = ''
  let code = ''
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    db = new Map()
    const r = await run('createRoom', 'host', db, { title: 'T', seconds: 20, questions: QUESTIONS })
    expect(r.success).toBe(true)
    ;({ roomId, code } = (r as { data: Data }).data)
  })
  afterEach(() => vi.useRealTimers())

  it('never exposes the correct answer on the public room row', () => {
    expect(JSON.stringify(room(db))).not.toContain('correct')
    expect(db.get('quizkeys')).toHaveLength(2)
  })

  it('rejects invalid quizzes server-side', async () => {
    const bad = await run('createRoom', 'host', db, { questions: [{ prompt: 'x', options: ['a', 'a', 'b', 'c'], correct: 1 }] })
    expect(bad.success).toBe(false)
  })

  it('plays a full game: join, answer, score by speed, reveal, finish', async () => {
    await run('joinRoom', 'ann', db, { code, name: 'Ann' })
    await run('joinRoom', 'bob', db, { code, name: 'Bob' })
    await run('joinRoom', 'ann', db, { code, name: 'Ann' }) // idempotent rejoin
    expect(db.get('players')).toHaveLength(2)

    expect((await run('advance', 'host', db, { roomId })).success).toBe(true)
    expect(room(db).status).toBe('question')
    expect(room(db).prompt).toBe('Q1?')

    vi.setSystemTime(1_000_000 + 5_000) // Ann answers after 5s of 20s -> 500 + 375
    expect((await run('submitAnswer', 'ann', db, { roomId, choice: 2 })).success).toBe(true)
    vi.setSystemTime(1_000_000 + 10_000) // Bob answers wrong
    expect((await run('submitAnswer', 'bob', db, { roomId, choice: 1 })).success).toBe(true)
    expect(room(db).answeredCount).toBe(2)

    vi.setSystemTime(1_000_000 + 20_000)
    await run('tick', 'bob', db, { roomId })
    await run('tick', 'ann', db, { roomId }) // second tick must not double-score
    expect(room(db).status).toBe('reveal')
    expect(room(db).revealedIndex).toBe(2)
    expect(JSON.parse(room(db).distributionJson as string)).toEqual([0, 1, 1, 0])
    const score = (u: string) => db.get('players')!.find((p) => p.data.userId === u)!.data.score
    expect(score('ann')).toBe(875)
    expect(score('bob')).toBe(0)

    await run('advance', 'host', db, { roomId }) // -> Q2
    expect(room(db).prompt).toBe('Q2?')
    expect(room(db).revealedIndex).toBe(-1)
    vi.setSystemTime(1_000_000 + 20_000 + 1_000)
    await run('submitAnswer', 'bob', db, { roomId, choice: 0 }) // instant-ish -> 975
    await run('advance', 'host', db, { roomId }) // host reveals early
    expect(score('bob')).toBe(975)
    expect(score('ann')).toBe(875)
    await run('advance', 'host', db, { roomId }) // -> done
    expect(room(db).status).toBe('done')
  })

  it('blocks cheating: non-host advance, early tick, late/duplicate/invalid answers, host answering', async () => {
    await run('joinRoom', 'ann', db, { code, name: 'Ann' })
    expect((await run('advance', 'ann', db, { roomId })).success).toBe(false) // not host
    await run('advance', 'host', db, { roomId })

    await run('tick', 'ann', db, { roomId }) // timer not over: no-op
    expect(room(db).status).toBe('question')

    expect((await run('submitAnswer', 'ann', db, { roomId, choice: 9 })).success).toBe(false)
    expect((await run('submitAnswer', 'host', db, { roomId, choice: 1 })).success).toBe(false)
    expect((await run('submitAnswer', 'stranger', db, { roomId, choice: 1 })).success).toBe(false) // never joined
    expect((await run('submitAnswer', 'ann', db, { roomId, choice: 1 })).success).toBe(true)
    expect((await run('submitAnswer', 'ann', db, { roomId, choice: 2 })).success).toBe(false) // duplicate

    vi.setSystemTime(1_000_000 + 25_000)
    await run('joinRoom', 'late', db, { code, name: 'Late' })
    expect((await run('submitAnswer', 'late', db, { roomId, choice: 2 })).success).toBe(false) // past deadline
  })

  it('scores once even when several clients tick at the same instant', async () => {
    await run('joinRoom', 'ann', db, { code, name: 'Ann' })
    await run('advance', 'host', db, { roomId })
    vi.setSystemTime(1_000_000)
    await run('submitAnswer', 'ann', db, { roomId, choice: 2 }) // instant correct = 1000
    vi.setSystemTime(1_000_000 + 20_000)
    await Promise.all([1, 2, 3, 4].map(() => run('tick', 'ann', db, { roomId })))
    expect(db.get('players')![0].data.score).toBe(1000)
  })

  it('caps room size and refuses finished rooms', async () => {
    for (let i = 0; i < 30; i++) await run('joinRoom', `u${i}`, db, { code, name: `U${i}` })
    expect((await run('joinRoom', 'u31', db, { code, name: 'U31' })).success).toBe(false)
    room(db).status = 'done'
    expect((await run('joinRoom', 'someone', db, { code, name: 'S' })).success).toBe(false)
  })

  it('chat uses the server-known name, not a client-supplied one', async () => {
    await run('joinRoom', 'ann', db, { code, name: 'Ann' })
    await run('sendChat', 'ann', db, { roomId, text: 'hi', name: 'Mallory', userId: 'host' })
    const msg = db.get('chat')![0].data
    expect(msg.name).toBe('Ann')
    expect(msg.userId).toBe('ann')
  })

  it('AI drafts are validated; AI failure degrades gracefully', async () => {
    const good = { success: true, data: { choices: [{ message: { content: '```json\n' + JSON.stringify(QUESTIONS) + '\n```' } }] } }
    const notes = 'Photosynthesis converts light energy into chemical energy in plants.'
    const r = await run('generateQuestions', 'host', db, { notes, count: 2 }, good)
    expect(r.success && (r.data as { questions: unknown[] }).questions).toHaveLength(2)
    const junk = { success: true, data: { choices: [{ message: { content: 'sorry, no' } }] } }
    expect((await run('generateQuestions', 'host', db, { notes }, junk)).success).toBe(false)
    expect((await run('generateQuestions', 'host', db, { notes })).success).toBe(false) // integration down
    expect((await run('generateQuestions', 'host', db, { notes: 'short' })).success).toBe(false)
  })
})
