// Supabase Edge Function: quick-endpoint
// 1) Claude proxy: POST { prompt, system?, max_tokens?, model?, web? } -> { text }
//    (keeps ANTHROPIC_API_KEY server-side; per-IP rate limit + size caps; optional web search)
// 2) Group-agent trigger: POST { group_id } (no prompt) -> generates an AI reply in that
//    group (when an agent is enabled) and inserts it via the service role. Fire-and-forget ping.
// 3) Teeby DM with list context: POST { prompt, system, teeby_dm, user_id } -> { text, list_id? }
//    Teeby can detect list-creation intent and auto-create a shared list in DB.
// 4) List creation: POST { list_action:'create', user_id, list_data:{...} } -> { list_id }

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

const VALID_LIST_TYPES = ['shopping', 'tasks', 'cooking', 'trip', 'party', 'other']

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

// Service-role REST helper (bypasses RLS) for server-side DB writes.
function sb(path: string, init?: RequestInit) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
}

// Create a shared list and return its ID. Used by Teeby list creation flow.
async function createList(userId: string, ld: any): Promise<string | null> {
  try {
    const rawItems: string[] = Array.isArray(ld.items) ? ld.items : []
    const items = rawItems.map((text: string, i: number) => ({
      id: crypto.randomUUID(), text: String(text).slice(0, 200), done: false, position: i,
    }))
    const row = {
      title: String(ld.title || 'My list').slice(0, 80),
      type: VALID_LIST_TYPES.includes(ld.type) ? ld.type : 'shopping',
      owner_id: userId,
      members: [userId],
      items,
      teeby_summary: String(ld.summary || '').slice(0, 300),
      created_by: userId,
    }
    const res = await sb('shared_lists', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    const data = await res.json()
    return data?.[0]?.id || null
  } catch { return null }
}

// ─── Push notifications via Expo Push API ──────────────────────────────────

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

async function pushForGroupMessage(groupId: string, senderId: string, contentRaw: string, senderName: string) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return
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
    if (AGENT_IDS.includes(last.user_id)) return
    if (last.type && last.type !== 'text') return

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
    const system =
`Current date and time: ${nowStr2}. Timezone: Asia/Jerusalem.
Always answer date/time questions confidently using this — never say you do not know the date.
${instructions}
Style: friendly, witty, a bit playful and flirtatious when it fits — never crude.
Language: reply in the SAME language as the group (Hebrew, English, Arabic, …).
Length: 1-2 short sentences. Don't greet every time.
If someone asks about a place (restaurant, bar, café, museum, beach…), drop a Google Maps link of the form:
https://www.google.com/maps/search/?api=1&query=<URL-encoded place + city>
Put a tiny 1-line description above it and the link on its own line. The client will auto-render the URL as tappable.`
    const reply = await anthropic({ model: DEFAULT_MODEL, max_tokens: 200, system, messages: [{ role: 'user', content: history }] })
    if (!reply) return

    await sb('messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ group_id: groupId, user_id: GROUP_AGENT_ID, type: 'text', content: reply, sender_mode: 'lit' }),
    })
  } catch { /* best-effort */ }
}

// Build a common date/time prefix for system prompts.
function buildBaseSys(tz: string, clientNow?: string): string {
  let nowStr = ''
  try {
    const d = clientNow ? new Date(clientNow) : new Date()
    nowStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: 'long', day: '2-digit',
      weekday: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d)
  } catch { nowStr = new Date().toUTCString() }
  return 'Current date and time: ' + nowStr + '. Timezone: ' + tz +
    '. Always answer date/time questions confidently using this — never say you do not know the date.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let payload: any = {}
  try { payload = await req.json() } catch { return json({ ok: true }) }

  const prompt = (payload.prompt ?? '').trim()
  const imageUrl: string | undefined = payload.image_url

  // ── Group-agent ping (sent after a group message) ──────────────────────────
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

  // ── DM push fan-out ────────────────────────────────────────────────────────
  if (payload.dm && !prompt) {
    const dm = payload.dm || {}
    await pushForDM(String(dm.sender_id || ''), String(dm.receiver_id || ''), String(dm.content || ''), String(dm.sender_name || '').slice(0, 60))
    return json({ ok: true })
  }

  // ── Direct list creation (no Claude needed) ────────────────────────────────
  if (payload.list_action === 'create' && payload.user_id && payload.list_data) {
    const listId = await createList(String(payload.user_id), payload.list_data)
    return json({ list_id: listId })
  }

  if (!prompt) return json({ ok: true })
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Prompt too long', text: '' }, 413)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (!(await rateOk(ip))) return json({ error: 'Rate limit exceeded. Try again shortly.', text: '' }, 429)
  if (!ANTHROPIC_API_KEY) return json({ error: 'Server not configured' }, 500)

  const tz = (payload.tz || 'Asia/Jerusalem').toString()
  const baseSys = buildBaseSys(tz, payload.client_now)
  const imageHint = payload.web
    ? ' If the user asks for an image, picture, photo, or to "show me", use web_search to find a relevant image. After your text reply, output the direct image URLs on their own lines prefixed `IMAGE_URL: ` (one per line). Direct image URLs end in .jpg/.jpeg/.png/.webp/.gif.'
    : ''

  // ── Teeby DM — list-aware mode ─────────────────────────────────────────────
  // When the app sends teeby_dm:true + user_id, we:
  //   1. Fetch the user's recent lists for context.
  //   2. Tell Claude it can output CREATE_LIST:{json} or OPEN_LIST:<uuid>.
  //   3. Parse those markers, create/reference the list, strip markers from reply.
  //   4. Return { text, list_id }.
  if (payload.teeby_dm && payload.user_id && prompt) {
    const userId = String(payload.user_id)

    // Fetch user's recent lists for Teeby memory.
    let listsCtx = ''
    try {
      const lr = await sb(`shared_lists?owner_id=eq.${userId}&order=updated_at.desc&limit=6&select=id,title,type,teeby_summary`)
      const lists = await lr.json()
      if (Array.isArray(lists) && lists.length) {
        listsCtx = '\n\nUser\'s existing lists (Teeby memory):\n' +
          lists.map((l: any) => `- "${l.title}" [${l.type}] (ID:${l.id})${l.teeby_summary ? ' — ' + l.teeby_summary : ''}`).join('\n')
        listsCtx += '\nIf the user asks to continue or update an existing list, output OPEN_LIST: <id> instead of creating a new one.'
      }
    } catch { /* non-fatal */ }

    const listInstructions = `

You are Teeby, the friendly Tryber social-app assistant.
When the user asks you to create ANY kind of list (shopping list, grocery, to-do, tasks, recipe / cooking ingredients, trip plan, party checklist, packing list, etc.):
  1. Write a warm, friendly reply with the list items as bullet points (•).
  2. At the very end of your response, on its own line, output EXACTLY:
     CREATE_LIST: {"title":"...","type":"shopping|tasks|cooking|trip|party|other","items":["item1","item2",...],"summary":"one-sentence context"}
  3. After that, ask if they want to share the list with someone.

The CREATE_LIST line is INVISIBLE to the user — never mention or explain it.
Supported types: shopping, tasks, cooking, trip, party, other.
${listsCtx}`

    const finalSys = baseSys + ' ' + (payload.system || '') + listInstructions + imageHint
    const maxTok = Math.min(Math.max(Number(payload.max_tokens) || 350, 1), MAX_OUTPUT_TOKENS)
    const reqBody: Record<string, unknown> = {
      model: payload.model || DEFAULT_MODEL,
      max_tokens: maxTok,
      system: finalSys,
      messages: [{ role: 'user', content: prompt }],
    }
    if (payload.web) reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]

    let rawReply = await anthropic(reqBody)

    // Parse CREATE_LIST marker (greedy to handle multiline JSON)
    let listId: string | null = null
    const createMatch = rawReply.match(/CREATE_LIST:\s*(\{[\s\S]*?\})\s*$/m)
    if (createMatch) {
      rawReply = rawReply.replace(/CREATE_LIST:\s*\{[\s\S]*?\}\s*$/m, '').trim()
      try {
        const ld = JSON.parse(createMatch[1])
        listId = await createList(userId, ld)
      } catch { /* JSON parse failed — skip */ }
    }

    // Parse OPEN_LIST marker (reference an existing list)
    if (!listId) {
      const openMatch = rawReply.match(/OPEN_LIST:\s*([0-9a-f-]{36})/i)
      if (openMatch) {
        rawReply = rawReply.replace(/OPEN_LIST:\s*[0-9a-f-]{36}/i, '').trim()
        listId = openMatch[1]
      }
    }

    return json({ text: rawReply, list_id: listId })
  }

  // ── Standard Claude proxy ──────────────────────────────────────────────────
  const maxTokens = Math.min(Math.max(Number(payload.max_tokens) || 200, 1), MAX_OUTPUT_TOKENS)
  const userContent: unknown = imageUrl
    ? [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ]
    : prompt
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
