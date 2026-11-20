/** Quiz builder. Questions are validated again on the server before anything is stored. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button, Input, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '@/lib/api'
import { MAX_QUESTIONS, QUESTION_SECONDS, type QuizQuestion } from '@/lib/quiz'

const blank = (): QuizQuestion => ({ prompt: '', options: ['', '', '', ''], correct: 0 })

export default function HostPage() {
  const navigate = useNavigate()
  const { error, success } = useToast()
  const [title, setTitle] = useState('')
  const [seconds, setSeconds] = useState(QUESTION_SECONDS)
  const [questions, setQuestions] = useState<QuizQuestion[]>([blank()])
  const [notes, setNotes] = useState('')
  const [count, setCount] = useState(5)
  const [drafting, setDrafting] = useState(false)
  const [creating, setCreating] = useState(false)

  const patch = (i: number, next: Partial<QuizQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...next } : q)))
  const setOption = (i: number, o: number, value: string) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, options: q.options.map((x, k) => (k === o ? value : x)) } : q)))

  async function draft() {
    setDrafting(true)
    const r = await callAction<{ questions: QuizQuestion[] }>('generateQuestions', { notes, count })
    setDrafting(false)
    if (!r.ok) return error('AI draft failed', r.error)
    // Replace the untouched starter question, otherwise append.
    setQuestions((qs) => {
      const onlyBlank = qs.length === 1 && !qs[0].prompt
      return [...(onlyBlank ? [] : qs), ...r.data.questions].slice(0, MAX_QUESTIONS)
    })
    success('Drafted', 'Review each question and check the marked answers.')
  }

  async function create() {
    setCreating(true)
    const r = await callAction<{ code: string }>('createRoom', { title, seconds, questions })
    setCreating(false)
    if (!r.ok) return error('Could not create the room', r.error)
    navigate(`/room/${r.data.code}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-3xl font-black tracking-tight">New quiz</h1>

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" maxLength={60} aria-label="Quiz title" data-testid="quiz-title" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Input type="number" min={5} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Seconds per question" />
          sec
        </label>
      </div>

      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold">
          <Sparkles className="size-4" /> Draft questions from my notes (AI)
        </summary>
        <div className="mt-3 space-y-3">
          <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste study notes or a passage. Questions will be based only on this." maxLength={6000} aria-label="Notes" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Questions
              <Input type="number" min={3} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-20" />
            </label>
            <Button onClick={draft} loading={drafting} disabled={notes.trim().length < 20}>
              Draft with AI
            </Button>
          </div>
        </div>
      </details>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={i} className="space-y-3 rounded-2xl border border-border bg-card p-4" data-testid={`question-${i}`}>
            <div className="flex items-start gap-2">
              <span className="mt-2 text-sm font-bold text-muted-foreground">{i + 1}.</span>
              <Textarea rows={2} value={q.prompt} onChange={(e) => patch(i, { prompt: e.target.value })} placeholder="Question" maxLength={240} aria-label={`Question ${i + 1}`} />
              <Button variant="ghost" size="icon" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} disabled={questions.length === 1} aria-label={`Delete question ${i + 1}`}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((o, k) => (
                <label key={k} className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5', q.correct === k ? 'border-emerald-500 bg-emerald-500/10' : 'border-border')}>
                  <input type="radio" name={`correct-${i}`} checked={q.correct === k} onChange={() => patch(i, { correct: k })} aria-label={`Option ${k + 1} is correct`} />
                  <input
                    value={o}
                    onChange={(e) => setOption(i, k, e.target.value)}
                    placeholder={`Option ${k + 1}`}
                    maxLength={120}
                    aria-label={`Question ${i + 1} option ${k + 1}`}
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
                  />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => setQuestions((qs) => [...qs, blank()])} disabled={questions.length >= MAX_QUESTIONS}>
          <Plus className="size-4" /> Add question
        </Button>
        <Button size="lg" onClick={create} loading={creating} data-testid="create-room">
          Create room
        </Button>
      </div>
    </div>
  )
}
