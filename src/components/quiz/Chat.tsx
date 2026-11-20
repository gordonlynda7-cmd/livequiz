import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'deepspace'
import { Button, Input, useToast } from '@/components/ui'
import { callAction } from '@/lib/api'

interface Msg {
  userId: string
  name: string
  text: string
}

export function Chat({ roomId, meId }: { roomId: string; meId?: string | null }) {
  const { records } = useQuery<Msg>('chat', { where: { roomId }, orderBy: 'createdAt', orderDir: 'asc', limit: 100 })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const { error } = useToast()
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [records.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const r = await callAction('sendChat', { roomId, text: body })
    setSending(false)
    if (r.ok) setText('')
    else error('Message not sent', r.error)
  }

  return (
    <div className="flex h-72 flex-col rounded-xl border border-border bg-card" data-testid="room-chat">
      <div className="flex-1 space-y-1.5 overflow-y-auto p-3 text-sm">
        {records.length === 0 && <p className="text-muted-foreground">Say hi to the room.</p>}
        {records.map((m) => (
          <p key={m.recordId} className="break-words">
            <span className={m.data.userId === meId ? 'font-semibold text-primary' : 'font-semibold'}>{m.data.name}</span>{' '}
            <span className="text-foreground/90">{m.data.text}</span>
          </p>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-border p-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Message" aria-label="Chat message" />
        <Button type="submit" disabled={!text.trim() || sending}>
          Send
        </Button>
      </form>
    </div>
  )
}
