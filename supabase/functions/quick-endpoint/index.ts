// Supabase Edge Function: quick-endpoint
// Claude proxy so the ANTHROPIC_API_KEY stays server-side (never shipped in the app bundle).
// - POST { prompt, system?, max_tokens?, model? } -> { text }
// - POST {} (or no prompt) -> { ok: true }  (used as a lightweight ping after sending messages)

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: { prompt?: string; system?: string; max_tokens?: number; model?: string } = {}
  try {
    payload = await req.json()
  } catch {
    return json({ ok: true })
  }

  const prompt = (payload.prompt ?? '').trim()
  if (!prompt) return json({ ok: true })

  if (!ANTHROPIC_API_KEY) return json({ error: 'Server not configured' }, 500)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: payload.model || DEFAULT_MODEL,
        max_tokens: payload.max_tokens ?? 200,
        system: payload.system || undefined,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) return json({ error: data?.error?.message || 'Claude error', text: '' }, 502)
    const text = data?.content?.[0]?.text?.trim() ?? ''
    return json({ text })
  } catch (e) {
    return json({ error: String(e), text: '' }, 502)
  }
})
