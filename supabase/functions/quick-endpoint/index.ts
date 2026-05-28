// Supabase Edge Function: quick-endpoint
// Claude proxy so the ANTHROPIC_API_KEY stays server-side (never shipped in the app bundle).
// - POST { prompt, system?, max_tokens?, model? } -> { text }
// - POST {} (or no prompt) -> { ok: true }  (used as a lightweight ping after sending messages)
// Protections: per-IP rate limit (DB-backed, fail-open) + per-request caps on prompt size / max_tokens.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const MAX_PROMPT_CHARS = 8000
const MAX_OUTPUT_TOKENS = 1024
const RATE_PER_MIN = 30 // requests per minute per IP

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// DB-backed sliding limiter. Fails OPEN (returns true) if anything goes wrong, so the
// app never breaks just because the limiter is unavailable.
async function rateOk(ip: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true
  const bucket = ip + ':' + Math.floor(Date.now() / 60000)
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/edge_rate_hit', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_bucket: bucket, p_limit: RATE_PER_MIN }),
    })
    if (!res.ok) return true
    return (await res.json()) === true
  } catch {
    return true
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: { prompt?: string; system?: string; max_tokens?: number; model?: string; web?: boolean } = {}
  try {
    payload = await req.json()
  } catch {
    return json({ ok: true })
  }

  const prompt = (payload.prompt ?? '').trim()
  if (!prompt) return json({ ok: true })
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Prompt too long', text: '' }, 413)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!(await rateOk(ip))) return json({ error: 'Rate limit exceeded. Try again shortly.', text: '' }, 429)

  if (!ANTHROPIC_API_KEY) return json({ error: 'Server not configured' }, 500)

  const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 200, 1), MAX_OUTPUT_TOKENS)

  const reqBody: Record<string, unknown> = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    system: payload.system || undefined,
    messages: [{ role: 'user', content: prompt }],
  }
  // Give Teeby/agents live internet access (Anthropic server-side web search).
  if (payload.web) reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    })
    const data = await res.json()
    if (!res.ok) return json({ error: data?.error?.message || 'Claude error', text: '' }, 502)
    // With tools the content array can hold multiple blocks; concatenate the text ones.
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      : ''
    return json({ text })
  } catch (e) {
    return json({ error: String(e), text: '' }, 502)
  }
})
