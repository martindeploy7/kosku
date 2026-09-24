/* Thin fetch wrapper for the Kosku API.
 * - Same origin, session cookie (httpOnly) — no tokens in JS.
 * - Every mutating request carries `x-kosku: 1` (the server's CSRF guard).
 * - Errors surface as ApiError with the server's Indonesian message. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message)
  }
}

type Listener = (e: ApiError) => void
const authListeners = new Set<Listener>()

/** Notified on 401 (session gone) and 403 must_change_password. */
export function onAuthProblem(fn: Listener) {
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}

async function request<T>(method: string, path: string, body?: unknown, init: { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (method !== 'GET') headers['x-kosku'] = '1'

  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 'network')
  }

  if (init.raw) return res as unknown as T
  const text = await res.text()
  const data = text ? safeJson(text) : null

  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error
    const e = new ApiError(res.status, err?.message ?? `Permintaan gagal (${res.status}).`, err?.code, err?.details)
    if (res.status === 401 || (res.status === 403 && e.code === 'must_change_password')) {
      authListeners.forEach((fn) => fn(e))
    }
    throw e
  }
  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
}

/** URL of a stored file for <img>/<a>. The session cookie authorises it. */
export const fileUrl = (id: string, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`
