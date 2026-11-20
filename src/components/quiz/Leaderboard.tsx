import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import { cn } from '@/lib/utils'
import { rankPlayers } from '@/lib/quiz'

export interface Player {
  userId: string
  name: string
  score: number
  lastPoints: number
}

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

export function usePlayers(roomId: string | undefined) {
  const { records, status } = useQuery<Player>('players', { where: { roomId: roomId ?? '__none__' } })
  return { players: useMemo(() => records.map((r) => r.data), [records]), status }
}

export function Leaderboard({
  players,
  meId,
  limit,
  showDelta,
}: {
  players: Player[]
  meId?: string | null
  limit?: number
  showDelta?: boolean
}) {
  const ranked = rankPlayers(players).slice(0, limit ?? players.length)
  if (ranked.length === 0) {
    return <p className="text-sm text-muted-foreground">No players yet.</p>
  }
  return (
    <ol className="space-y-2" data-testid="leaderboard">
      {ranked.map(({ rank, item }) => (
        <li
          key={item.userId}
          className={cn(
            'flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5',
            item.userId === meId && 'border-primary ring-1 ring-primary',
          )}
        >
          <span className="w-8 text-center text-lg font-bold tabular-nums">{MEDAL[rank] ?? rank}</span>
          <span className="flex-1 truncate font-medium">
            {item.name}
            {item.userId === meId && <span className="ml-2 text-xs text-muted-foreground">you</span>}
          </span>
          {showDelta && item.lastPoints > 0 && (
            <span className="text-sm font-medium text-emerald-500 tabular-nums">+{item.lastPoints}</span>
          )}
          <span className="w-16 text-right font-semibold tabular-nums">{item.score}</span>
        </li>
      ))}
    </ol>
  )
}
