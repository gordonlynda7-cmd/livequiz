/**
 * Pure game rules, shared by the worker (authoritative) and the UI (display).
 * No DeepSpace imports on purpose: everything here is unit-tested in isolation.
 */

export const MAX_PLAYERS = 30 // keeps one reveal under the Workers subrequest budget
export const MAX_QUESTIONS = 20
export const OPTION_COUNT = 4
export const QUESTION_SECONDS = 20
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export interface QuizQuestion {
  prompt: string
  options: string[]
  correct: number
}

/** 500 for being right, up to +500 for speed. Wrong or late-by-a-lot = 0 / floor. */
export function pointsFor(
  correct: boolean,
  answeredAt: number,
  startedAt: number,
  endsAt: number,
): number {
  if (!correct) return 0
  const total = Math.max(1, endsAt - startedAt)
  const remaining = Math.min(total, Math.max(0, endsAt - answeredAt))
  return 500 + Math.round((500 * remaining) / total)
}

export function makeCode(rand: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 5; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]
  return out
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
}

type Validated = { ok: true; questions: QuizQuestion[] } | { ok: false; error: string }

/** Server-side gate for anything that becomes a quiz. Never trust the client shape. */
export function validateQuestions(input: unknown): Validated {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Add at least one question.' }
  if (input.length > MAX_QUESTIONS) return { ok: false, error: `Max ${MAX_QUESTIONS} questions.` }
  const questions: QuizQuestion[] = []
  for (let i = 0; i < input.length; i++) {
    const q = input[i] as Partial<QuizQuestion> | null
    const n = i + 1
    const prompt = typeof q?.prompt === 'string' ? q.prompt.trim() : ''
    if (!prompt || prompt.length > 240) return { ok: false, error: `Question ${n}: prompt must be 1-240 characters.` }
    if (!Array.isArray(q?.options) || q.options.length !== OPTION_COUNT)
      return { ok: false, error: `Question ${n}: needs exactly ${OPTION_COUNT} options.` }
    const options = q.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
    if (options.some((o) => !o || o.length > 120))
      return { ok: false, error: `Question ${n}: every option must be 1-120 characters.` }
    if (new Set(options.map((o) => o.toLowerCase())).size !== OPTION_COUNT)
      return { ok: false, error: `Question ${n}: options must be different.` }
    const correct = q.correct
    if (!Number.isInteger(correct) || (correct as number) < 0 || (correct as number) >= OPTION_COUNT)
      return { ok: false, error: `Question ${n}: pick the correct answer.` }
    questions.push({ prompt, options, correct: correct as number })
  }
  return { ok: true, questions }
}

/** LLMs wrap JSON in prose and code fences. Pull out the array and validate it. */
export function parseGenerated(text: string): Validated {
  const stripped = text.replace(/```(?:json)?/gi, '')
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  if (start === -1 || end <= start) return { ok: false, error: 'The AI reply had no question list.' }
  try {
    const raw = JSON.parse(stripped.slice(start, end + 1)) as Array<Record<string, unknown>>
    const mapped = raw.map((q) => ({
      prompt: q.prompt ?? q.question,
      options: q.options ?? q.choices,
      correct: typeof q.correct === 'number' ? q.correct : q.answer,
    }))
    return validateQuestions(mapped)
  } catch {
    return { ok: false, error: 'The AI reply was not valid JSON.' }
  }
}

export interface Ranked<T> {
  rank: number
  item: T
}

/** Score desc, name as tiebreak; equal scores share a rank (1, 2, 2, 4). */
export function rankPlayers<T extends { score: number; name: string }>(players: T[]): Ranked<T>[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return sorted.map((item, i) => {
    const firstWithScore = sorted.findIndex((p) => p.score === item.score)
    return { rank: firstWithScore + 1, item }
  })
}
