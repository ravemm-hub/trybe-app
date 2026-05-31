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

// ─── Push notifications via Expo Push API ──────────────────────────────────
// We send pushes server-side from the edge function so the client never has
// to know the recipients' push tokens (and so anonymous senders stay anonymous
// even at the network level).

async function expoPush(messages: Array<{ to: string; title: string; body: string; data?: Record<string, unknown>; sound?: string }>) {
  if (!messages.length) return
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.map(m => ({ sound: 'default', ...m }))),
    })
  } catch { /* best-effort */ }
}

// Pushes for a NEW GROUP MESSAGE — to every member except the sender + agents,
// who has a push_token, and whose last_read_at is older than the message time.
async function pushForGroupMessage(groupId: string, senderId: string, contentRaw: string, senderName: string) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return
    // Get group name + members + push tokens in one shot.
    const [{ 0: g } = { 0: null } as any, members] = await Promise.all([
      sb(`groups?id=eq.${groupId}&select=name`).then(r => r.json()),
      sb(`group_members?group_id=eq.${groupId}&select=user_id`).then(r => r.json()),
    ])
    const groupName = (g && g.name) || 'Trybe'
    const recipientIds: string[] = (members || [])
      .map((m: any) => m.user_id)
      .filter((uid: string) => uid && uid !== senderId && !AGENT_IDS.includes(uid))
    if (!recipientIds.length) return
    const profs = await sb(`profiles?id=in.(${recipientIds.join(',')})&select=id,push_token`).then(r => r.json())
    const tokens: Array<{ to: string; uid: string }> = (profs || [])
      .filter((p: any) => p.push_token && /^ExponentPushToken\[|^ExpoPushToken\[/.test(p.push_token))
      .map((p: any) => ({ to: p.push_token, uid: p.id }))
    if (!tokens.length) return
    const body = (contentRaw || '').slice(0, 140) || '📷 New message'
    await expoPush(tokens.map(t => ({
      to: t.to,
      title: senderName ? `${senderName} · ${groupName}` : groupName,
      body,
      data: { group_id: groupId, group_name: groupName, sender_id: senderId, type: 'group_message' },
    })))
  } catch { /* best-effort */ }
}

// Push for a NEW DM — to the receiver only.
async function pushForDM(senderId: string, receiverId: string, contentRaw: string, senderName: string) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return
    if (!receiverId || receiverId === senderId) return
    const profs = await sb(`profiles?id=eq.${receiverId}&select=push_token`).then(r => r.json())
    const tok = profs?.[0]?.push_token
    if (!tok || !/^ExponentPushToken\[|^ExpoPushToken\[/.test(tok)) return
    const body = (contentRaw || '').slice(0, 140) || '📷 New message'
    await expoPush([{
      to: tok,
      title: senderName || 'New message',
      body,
      data: { dm_user_id: senderId, sender_name: senderName, type: 'dm_message' },
    }])
  } catch { /* best-effort */ }
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
    let nowStr2 = ''
    try {
      nowStr2 = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'long', day: '2-digit',
        weekday: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      }).format(new Date())
    } catch { nowStr2 = new Date().toUTCString() }
    const system = 'Current date and time: ' + nowStr2 + '. Timezone: Asia/Jerusalem. ' +
      'Always answer date/time questions confidently using this — never say you do not know the date. ' +
      instructions + ' Reply in the SAME language as the group. Keep it to 1-2 short sentences. Be natural — do not greet every time.'
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
  const imageUrl: string | undefined = payload.image_url

  // Group-agent ping (sent after a group message). No prompt -> maybe make the agent reply.
  // Also fans out push notifications to all group members (except sender) in parallel.
  if (payload.group_id && !prompt) {
    const senderName = String(payload.sender_name || '').slice(0, 60)
    const senderId = String(payload.sender_id || '')
    const content = String(payload.content || '')
    await Promise.all([
      maybeGroupAgentReply(String(payload.group_id)),
      senderId ? pushForGroupMessage(String(payload.group_id), senderId, content, senderName) : Promise.resolve(),
    ])
    return json({ ok: true })
  }

  // DM push fan-out — { dm: { sender_id, receiver_id, sender_name, content } }
  if (payload.dm && !prompt) {
    const dm = payload.dm || {}
    await pushForDM(String(dm.sender_id || ''), String(dm.receiver_id || ''), String(dm.content || ''), String(dm.sender_name || '').slice(0, 60))
    return json({ ok: true })
  }

  if (!prompt) return json({ ok: true })
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Prompt too long', text: '' }, 413)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!(await rateOk(ip))) return json({ error: 'Rate limit exceeded. Try again shortly.', text: '' }, 429)

  if (!ANTHROPIC_API_KEY) return json({ error: 'Server not configured' }, 500)

  const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 200, 1), MAX_OUTPUT_TOKENS)
  // Vision: when an image URL is provided, send a multimodal user message.
  const userContent: unknown = imageUrl
    ? [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ]
    : prompt
  // Always inject the current date/time + timezone hint into the system prompt.
  // Optional payload.tz lets the client pass the device timezone (e.g. 'Asia/Jerusalem')
  // and payload.client_now lets the client pass its local clock — useful when the
  // device clock differs from server time. Without this, Claude denies knowing the
  // date/time, which is bad UX for a personal-assistant agent.
  const tz = (payload.tz || 'Asia/Jerusalem').toString()
  let nowStr = ''
  try {
    const d = payload.client_now ? new Date(payload.client_now) : new Date()
    nowStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: 'long', day: '2-digit',
      weekday: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d)
  } catch { nowStr = new Date().toUTCString() }
  const baseSys = 'Current date and time: ' + nowStr + '. Timezone: ' + tz + '. ' +
    'Always answer date/time questions confidently using this — never say you do not know the date.'
  // Internet + image search hint: when web is enabled and the user asks for an image
  // or a picture, the model should search the web, then return image URLs it finds —
  // ending its reply with `IMAGE_URL: <https://...>` on its own line so the client
  // can render the image. (Anthropic web_search returns the URLs in its tool result.)
  const imageHint = payload.web
    ? ' If the user asks for an image, picture, photo, or to "show me", use web_search to find a relevant image. After your text reply, output the direct image URLs on their own lines prefixed `IMAGE_URL: ` (one per line). Direct image URLs end in .jpg/.jpeg/.png/.webp/.gif.'
    : ''
  const finalSystem = baseSys + ' ' + (payload.system || '') + imageHint
  const reqBody: Record<string, unknown> = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    system: finalSystem,
    messages: [{ role: 'user', content: userContent }],
  }
  if (payload.web) reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]

  const text = await anthropic(reqBody)
  return json({ text })
})
