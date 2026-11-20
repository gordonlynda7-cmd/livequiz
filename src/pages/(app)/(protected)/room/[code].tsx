/**
 * One page, four phases (lobby -> question -> reveal -> done), two views (host / player).
 * The room row is the single source of truth: every client renders from it, and every
 * state change is a server action, so the phases cannot drift between devices.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useAuthProfileReady, useQuery } from 'deepspace'
import { Button, buttonVariants, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '@/lib/api'
import { normalizeCode } from '@/lib/quiz'
import { Leaderboard, usePlayers, type Player } from '@/components/quiz/Leaderboard'
import { Chat } from '@/components/quiz/Chat'

interface Room {
  code: string
  title: string
  hostId: string
  status: 'lobby' | 'question' | 'reveal' | 'done'
  questionIndex: number
  questionCount: number
  questionSeconds: number
  questionStartedAt: number
  questionEndsAt: number
  prompt: string
  optionsJson: string
  answeredCount: number
  revealedIndex: number
  distributionJson: string
}
interface Answer {
  choice: number
}

const OPTION_STYLE = [
  { bg: 'bg-rose-500', icon: '▲' },
  { bg: 'bg-sky-500', icon: '◆' },
  { bg: 'bg-amber-500', icon: '●' },
  { bg: 'bg-emerald-600', icon: '■' },
]

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export default function RoomPage() {
  const { code: rawCode } = useParams()
  const code = normalizeCode(rawCode ?? '')
  const { userId } = useAuth()
  const { user } = useAuthProfileReady({ requireUser: true })
  const [joinError, setJoinError] = useState<string | null>(null)

  const { records, status } = useQuery<Room>('rooms', { where: { code } })
  const roomRec = records[0]
  const room = roomRec?.data
  const roomId = roomRec?.recordId

  const displayName = user?.name || user?.email?.split('@')[0] || 'Player'
  useEffect(() => {
    if (!code || !userId || !user) return
    let cancelled = false
    callAction('joinRoom', { code, name: displayName }).then((r) => {
      if (!cancelled) setJoinError(r.ok ? null : r.error)
    })
    return () => {
      cancelled = true
    }
  }, [code, userId, user, displayName])

  if (status === 'loading') return <Centered>Loading room…</Centered>
  if (!room || !roomId) {
    return (
      <Centered>
        <p className="text-lg font-semibold">No room “{code}”</p>
        <p className="text-sm text-muted-foreground">Check the code and try again.</p>
        <Link to="/home" className={cn(buttonVariants(), 'mt-4')}>
          Back
        </Link>
      </Centered>
    )
  }
  if (joinError && room.hostId !== userId) {
    return (
      <Centered>
        <p className="text-lg font-semibold">Can’t join this room</p>
        <p className="text-sm text-muted-foreground">{joinError}</p>
        <Link to="/home" className={cn(buttonVariants(), 'mt-4')}>
          Back
        </Link>
      </Centered>
    )
  }

  return <RoomView room={room} roomId={roomId} meId={userId} isHost={room.hostId === userId} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">{children}</div>
}

function RoomView({ room, roomId, meId, isHost }: { room: Room; roomId: string; meId: string | null; isHost: boolean }) {
  const { players } = usePlayers(roomId)
  const { error } = useToast()
  const [busy, setBusy] = useState(false)

  async function advance() {
    setBusy(true)
    const r = await callAction('advance', { roomId })
    setBusy(false)
    if (!r.ok) error('Could not continue', r.error)
  }

  const progress = room.status === 'lobby' ? 'Lobby' : `Question ${room.questionIndex + 1} of ${room.questionCount}`

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_20rem]" data-testid="room">
      <section className="space-y-5">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{room.title}</h1>
            <p className="text-sm text-muted-foreground">
              {progress} · {players.length} player{players.length === 1 ? '' : 's'}
              {isHost && ' · you are the host'}
            </p>
          </div>
          <span className="rounded-lg bg-secondary px-3 py-1 font-mono text-lg font-bold tracking-[0.25em]" data-testid="room-code">
            {room.code}
          </span>
        </header>

        {room.status === 'lobby' && <Lobby room={room} players={players} isHost={isHost} busy={busy} onStart={advance} />}
        {room.status === 'question' && (
          <QuestionView room={room} roomId={roomId} isHost={isHost} playerCount={players.length} busy={busy} onSkip={advance} />
        )}
        {room.status === 'reveal' && (
          <RevealView room={room} roomId={roomId} meId={meId} isHost={isHost} players={players} busy={busy} onNext={advance} />
        )}
        {room.status === 'done' && <DoneView players={players} meId={meId} />}
      </section>

      <aside className="space-y-3">
        {room.status !== 'done' && room.status !== 'reveal' && (
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Standings</h2>
            <Leaderboard players={players} meId={meId} limit={5} />
          </div>
        )}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Room chat</h2>
        <Chat roomId={roomId} meId={meId} />
      </aside>
    </div>
  )
}

function Lobby({
  room,
  players,
  isHost,
  busy,
  onStart,
}: {
  room: Room
  players: Player[]
  isHost: boolean
  busy: boolean
  onStart: () => void
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">Join at this page with code</p>
      <p className="font-mono text-6xl font-black tracking-[0.3em]">{room.code}</p>
      <div className="flex flex-wrap justify-center gap-2" data-testid="lobby-players">
        {players.length === 0 && <span className="text-sm text-muted-foreground">Waiting for players…</span>}
        {players.map((p) => (
          <span key={p.userId} className="rounded-full bg-secondary px-3 py-1 text-sm font-medium">
            {p.name}
          </span>
        ))}
      </div>
      {isHost ? (
        <Button size="lg" onClick={onStart} disabled={busy || players.length === 0} data-testid="start-game">
          {players.length === 0 ? 'Waiting for a player' : `Start with ${players.length}`}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the host to start…</p>
      )}
    </div>
  )
}

function QuestionView({
  room,
  roomId,
  isHost,
  playerCount,
  busy,
  onSkip,
}: {
  room: Room
  roomId: string
  isHost: boolean
  playerCount: number
  busy: boolean
  onSkip: () => void
}) {
  const now = useNow()
  const { error } = useToast()
  const options = useMemo(() => parse<string[]>(room.optionsJson, []), [room.optionsJson])
  const [picked, setPicked] = useState<number | null>(null)
  const { records } = useQuery<Answer>('answers', { where: { roomId, questionIndex: room.questionIndex } })
  const mine = records[0]?.data.choice ?? picked

  const total = Math.max(1, room.questionEndsAt - room.questionStartedAt)
  const remainingMs = Math.max(0, room.questionEndsAt - now)
  const expired = remainingMs === 0

  // Reset the optimistic pick when the question changes.
  useEffect(() => setPicked(null), [room.questionIndex])

  // When time is up, ask the server to close the question. Every client does this (with jitter),
  // the server re-checks the clock and is idempotent, and we retry in case our clock runs fast.
  const retry = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!expired) return
    const first = setTimeout(() => void callAction('tick', { roomId }), Math.random() * 1200)
    retry.current = setInterval(() => void callAction('tick', { roomId }), 2500)
    return () => {
      clearTimeout(first)
      if (retry.current) clearInterval(retry.current)
    }
  }, [expired, roomId, room.questionIndex])

  async function answer(choice: number) {
    if (mine !== null && mine !== undefined) return
    setPicked(choice)
    const r = await callAction('submitAnswer', { roomId, choice })
    if (!r.ok) {
      setPicked(null)
      error('Answer not recorded', r.error)
    }
  }

  const locked = mine !== null && mine !== undefined
  return (
    <div className="space-y-4">
      <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-linear"
          style={{ width: `${(remainingMs / total) * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{Math.ceil(remainingMs / 1000)}s left</span>
        <span data-testid="answered-count">
          {room.answeredCount} / {playerCount} answered
        </span>
      </div>
      <h2 className="rounded-2xl border border-border bg-card p-6 text-center text-2xl font-semibold" data-testid="question-prompt">
        {room.prompt}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((text, i) => (
          <button
            key={i}
            type="button"
            data-testid={`option-${i}`}
            disabled={isHost || locked || expired}
            onClick={() => answer(i)}
            className={cn(
              'flex items-center gap-3 rounded-2xl px-5 py-5 text-left text-lg font-semibold text-white shadow-sm transition',
              OPTION_STYLE[i].bg,
              (isHost || locked || expired) && mine !== i && 'opacity-40',
              mine === i && 'ring-4 ring-foreground/70',
              !(isHost || locked || expired) && 'hover:scale-[1.01] active:scale-[0.99]',
            )}
          >
            <span aria-hidden className="text-2xl">
              {OPTION_STYLE[i].icon}
            </span>
            {text}
          </button>
        ))}
      </div>
      {locked && !isHost && <p className="text-center text-sm text-muted-foreground">Locked in. Waiting for the reveal…</p>}
      {isHost && (
        <div className="text-center">
          <Button variant="outline" onClick={onSkip} disabled={busy}>
            Reveal now
          </Button>
        </div>
      )}
    </div>
  )
}

function RevealView({
  room,
  roomId,
  meId,
  isHost,
  players,
  busy,
  onNext,
}: {
  room: Room
  roomId: string
  meId: string | null
  isHost: boolean
  players: Player[]
  busy: boolean
  onNext: () => void
}) {
  const options = parse<string[]>(room.optionsJson, [])
  const dist = parse<number[]>(room.distributionJson, [0, 0, 0, 0])
  const max = Math.max(1, ...dist)
  const { records } = useQuery<Answer>('answers', { where: { roomId, questionIndex: room.questionIndex } })
  const mineChoice = records[0]?.data.choice
  const me = players.find((p) => p.userId === meId)
  const last = room.questionIndex + 1 >= room.questionCount

  let verdict: string | null = null
  if (!isHost) {
    if (mineChoice === undefined) verdict = 'No answer this round'
    else if (mineChoice === room.revealedIndex) verdict = `Correct! +${me?.lastPoints ?? 0}`
    else verdict = 'Not this time'
  }

  return (
    <div className="space-y-5">
      <h2 className="rounded-2xl border border-border bg-card p-5 text-center text-xl font-semibold">{room.prompt}</h2>
      {verdict && (
        <p
          data-testid="verdict"
          className={cn(
            'text-center text-2xl font-bold',
            mineChoice === room.revealedIndex ? 'text-emerald-500' : 'text-muted-foreground',
          )}
        >
          {verdict}
        </p>
      )}
      <div className="space-y-2">
        {options.map((text, i) => {
          const correct = i === room.revealedIndex
          return (
            <div
              key={i}
              data-testid={`reveal-${i}`}
              data-correct={correct}
              className={cn(
                'relative overflow-hidden rounded-xl border px-4 py-3',
                correct ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-card opacity-80',
              )}
            >
              <div
                className={cn('absolute inset-y-0 left-0 opacity-20', OPTION_STYLE[i].bg)}
                style={{ width: `${((dist[i] ?? 0) / max) * 100}%` }}
              />
              <div className="relative flex items-center gap-3">
                <span aria-hidden>{OPTION_STYLE[i].icon}</span>
                <span className="flex-1 font-medium">
                  {text}
                  {correct && <span className="ml-2 text-sm font-semibold text-emerald-500">✓ correct</span>}
                  {mineChoice === i && <span className="ml-2 text-xs text-muted-foreground">your pick</span>}
                </span>
                <span className="tabular-nums text-sm text-muted-foreground">{dist[i] ?? 0}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Top players</h3>
        <Leaderboard players={players} meId={meId} limit={5} showDelta />
      </div>
      {isHost ? (
        <div className="text-center">
          <Button size="lg" onClick={onNext} disabled={busy} data-testid="next-question">
            {last ? 'Finish quiz' : 'Next question'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Waiting for the host…</p>
      )}
    </div>
  )
}

function DoneView({ players, meId }: { players: Player[]; meId: string | null }) {
  return (
    <div className="space-y-4" data-testid="done">
      <h2 className="text-center text-3xl font-black">Final standings</h2>
      <Leaderboard players={players} meId={meId} />
      <div className="text-center">
        <Link to="/home" className={buttonVariants({ variant: 'outline' })}>
          Back home
        </Link>
      </div>
    </div>
  )
}
