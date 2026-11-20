/** Home: join a room with a code, or go host one. */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Input, buttonVariants } from '@/components/ui'
import { cn } from '@/lib/utils'
import { normalizeCode } from '@/lib/quiz'

export default function HomePage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const clean = normalizeCode(code)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-14">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-black tracking-tight">Quiz your people. Live.</h1>
        <p className="mx-auto max-w-md text-muted-foreground">
          Host a quiz, share a 5-letter code, and watch scores move as everyone answers at once.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="space-y-3 rounded-2xl border border-border bg-card p-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (clean.length === 5) navigate(`/room/${clean}`)
          }}
        >
          <h2 className="text-lg font-semibold">Join a game</h2>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            maxLength={8}
            aria-label="Room code"
            data-testid="join-code"
            className="text-center font-mono text-2xl tracking-[0.3em]"
          />
          <Button type="submit" className="w-full" disabled={clean.length !== 5} data-testid="join-submit">
            Join
          </Button>
        </form>

        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-lg font-semibold">Host a game</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Write questions by hand, or paste your notes and let AI draft them for you to edit.
            </p>
          </div>
          <Link to="/host" className={cn(buttonVariants(), 'w-full')} data-testid="host-cta">
            Create a quiz
          </Link>
        </div>
      </div>
    </div>
  )
}
