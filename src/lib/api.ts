import { getAuthToken } from 'deepspace'

export type ActionOutcome<T> = { ok: true; data: T } | { ok: false; error: string }

/** POST to a worker action (src/actions/index.ts) with the signed-in user's JWT. */
export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionOutcome<T>> {
  try {
    const token = await getAuthToken()
    if (!token) return { ok: false, error: 'Please sign in first.' }
    const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as
      | { success: true; data: T }
      | { success: false; error?: string }
      | { error?: string }
      | null
    if (body && 'success' in body && body.success) return { ok: true, data: body.data }
    const error = body && 'error' in body && body.error ? body.error : `Request failed (${res.status})`
    return { ok: false, error }
  } catch {
    return { ok: false, error: 'Network problem. Check your connection and retry.' }
  }
}
