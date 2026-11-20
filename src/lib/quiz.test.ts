import { describe, expect, it } from 'vitest'
import {
  makeCode,
  normalizeCode,
  parseGenerated,
  pointsFor,
  rankPlayers,
  validateQuestions,
} from './quiz'

const q = (over: Record<string, unknown> = {}) => ({
  prompt: 'Capital of France?',
  options: ['Paris', 'Rome', 'Madrid', 'Berlin'],
  correct: 0,
  ...over,
})

describe('pointsFor', () => {
  it('gives 0 for wrong answers', () => expect(pointsFor(false, 1000, 0, 20000)).toBe(0))
  it('gives 1000 for an instant correct answer', () => expect(pointsFor(true, 0, 0, 20000)).toBe(1000))
  it('gives 750 at the halfway point', () => expect(pointsFor(true, 10000, 0, 20000)).toBe(750))
  it('floors at 500 when late, never negative', () => expect(pointsFor(true, 25000, 0, 20000)).toBe(500))
})

describe('codes', () => {
  it('makes 5 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
  })
  it('normalizes pasted codes', () => expect(normalizeCode(' ab-c12xyz ')).toBe('ABC12'))
})

describe('validateQuestions', () => {
  it('accepts a good question', () => expect(validateQuestions([q()]).ok).toBe(true))
  it('rejects empty and oversized sets', () => {
    expect(validateQuestions([]).ok).toBe(false)
    expect(validateQuestions(Array.from({ length: 21 }, () => q())).ok).toBe(false)
  })
  it('rejects duplicate options', () =>
    expect(validateQuestions([q({ options: ['A', 'a', 'B', 'C'] })]).ok).toBe(false))
  it('rejects a missing or out-of-range answer', () => {
    expect(validateQuestions([q({ correct: undefined })]).ok).toBe(false)
    expect(validateQuestions([q({ correct: 4 })]).ok).toBe(false)
  })
  it('rejects wrong option count', () =>
    expect(validateQuestions([q({ options: ['A', 'B', 'C'] })]).ok).toBe(false))
})

describe('parseGenerated', () => {
  const payload = JSON.stringify([q()])
  it('parses fenced JSON with chatter around it', () =>
    expect(parseGenerated('Sure!\n```json\n' + payload + '\n```\nEnjoy').ok).toBe(true))
  it('maps question/choices/answer aliases', () => {
    const r = parseGenerated(
      JSON.stringify([{ question: 'Q?', choices: ['a', 'b', 'c', 'd'], answer: 2 }]),
    )
    expect(r.ok && r.questions[0].correct).toBe(2)
  })
  it('fails cleanly on garbage', () => {
    expect(parseGenerated('no json here').ok).toBe(false)
    expect(parseGenerated('[{oops').ok).toBe(false)
  })
})

describe('rankPlayers', () => {
  it('shares rank on ties and sorts by score', () => {
    const ranked = rankPlayers([
      { name: 'b', score: 100 },
      { name: 'a', score: 100 },
      { name: 'c', score: 300 },
      { name: 'd', score: 50 },
    ])
    expect(ranked.map((r) => [r.item.name, r.rank])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 2],
      ['d', 4],
    ])
  })
})
