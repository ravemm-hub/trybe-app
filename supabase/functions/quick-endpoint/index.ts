// Supabase Edge Function: quick-endpoint
// 1) Claude proxy: POST { prompt, system?, max_tokens?, model?, web? } -> { text }
//    (keeps ANTHROPIC_API_KEY server-side; per-IP rate limit + size caps; optional web search)
// 2) Group-agent trigger: POST { group_id } (no prompt) -> generates an AI reply in that
//    group (when an agent is enabled) and inserts it via the service role. Fire-and-forget ping.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const MAX_PROMPT_CHARS = 8000
const MAX_OUTPUT_TOKENS = 1024
const RATE_PER_MIN = 30

const AGENT_IDS = [
  'a1000001-0000-0000-0000-000000000001', 'a1000001-0000-0000-0000-000000000002',
  'a1000001-0000-0000-0000-000000000003', 'a1000001-0000-0000-0000-000000000019',
  'a1000001-0000-0000-0000-000000000020', 'a1000001-0000-0000-0000-000000000026',
  'a1000001-0000-0000-0000-000000000029',
]
const GROUP_AGENT_ID = AGENT_IDS[0]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

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
  } catch { return true }
}

async function anthropic(body: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return ''
    return Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      : ''
  } catch { return '' }
}

// Service-role REST helper (bypasses RLS) for the group-agent feature.
function sb(path: string, init?: RequestInit) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
}

async function maybeGroupAgentReply(groupId: string) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) return
    const gaRes = await sb(`group_agents?group_id=eq.${groupId}&enabled=is.true&select=instructions&limit=1`)
    const ga = await gaRes.json()
    if (!Array.isArray(ga) || ga.length === 0) return
    const instructions = ga[0].instructions || 'You are a friendly AI member of this group.'

    const mRes = await sb(`messages?group_id=eq.${groupId}&deleted_for_all=is.false&order=created_at.desc&limit=8&select=user_id,content,type`)
    const msgs = await mRes.json()
    if (!Array.isArray(msgs) || msgs.length === 0) return
    const last = msgs[0]
    if (AGENT_IDS.includes(last.user_id)) return        // never reply to an agent (avoids loops)
    if (last.type && last.type !== 'text') return         // skip media/system messages

    const history = msgs.slice().reverse()
      .map((x: any) => (AGENT_IDS.includes(x.user_id) ? 'assistant' : 'user') + ': ' + (x.content || ''))
      .join('\n')
    const system = instructions + ' Reply in the SAME language as the group. Keep it to 1-2 short sentences. Be natural — do not greet every time.'
    const reply = await anthropic({ model: DEFAULT_MODEL, max_tokens: 200, system, messages: [{ role: 'user', content: history }] })
    if (!reply) return

    await sb('messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ group_id: groupId, user_id: GROUP_AGENT_ID, type: 'text', content: reply, sender_mode: 'lit' }),
    })
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: any = {}
  try { payload = await req.json() } catch { return json({ ok: true }) }

  const prompt = (payload.prompt ?? '').trim()

  // Group-agent ping (sent after a group message). No prompt -> maybe make the agent reply.
  if (payload.group_id && !prompt) {
    await maybeGroupAgentReply(String(payload.group_id))
    return json({ ok: true })
  }

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
  if (payload.web) reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]

  const text = await anthropic(reqBody)
  return json({ text })
})
