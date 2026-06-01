import { supabase } from '../lib/supabase'
import { askClaude } from '../lib/claude'
import { sendDM } from './dms'
import { sendMessage } from './messages'
import { uuidv4 } from '../lib/uuid'

// ─── Teeby Tasks ────────────────────────────────────────────────────────────
// Free-form natural-language tasks the user gives Teeby anywhere in the app:
//   "Find someone in BBQ Friday who's vegetarian and ask them about the menu"
//   "Ask in all my groups if anyone has a good GPU laptop recommendation"
//   "Find someone in the music group I can chat with about jazz"
//
// We send the request to Claude with a strict action grammar; parse the
// result; show the user a confirmation card; only on confirmation do we
// actually send DMs / post in groups on their behalf.

export type TaskAction =
  | { kind: 'find_and_dm'; group_id: string; group_name: string; criteria: string; message: string }
  | { kind: 'ask_in_groups'; group_ids: string[]; group_names: string[]; message: string }
  | { kind: 'find_only'; group_id: string | null; criteria: string }
  | { kind: 'reply'; text: string }

export type GroupRef = { id: string; name: string; description: string | null }

// Load the user's own groups (id + name + description) — context for Teeby
// to map "BBQ Friday" or "music group" to a real group id.
export async function loadUserGroups(userId: string): Promise<GroupRef[]> {
  const { data: m } = await supabase.from('group_members').select('group_id').eq('user_id', userId)
  const ids = (m || []).map((r: any) => r.group_id)
  if (!ids.length) return []
  const { data: g } = await supabase.from('groups').select('id, name, description').in('id', ids)
  return (g || []) as GroupRef[]
}

function fmtGroupsForPrompt(groups: GroupRef[]): string {
  if (!groups.length) return '(none yet)'
  return groups.map(g => '- ' + g.name + (g.description ? ' — ' + g.description.slice(0, 60) : '')).join('\n')
}

// Sends the user's task to Claude with strict action grammar. Returns the
// parsed action OR a fallback "reply" wrapping Teeby's chat reply.
export async function planTask(userId: string, userName: string, request: string, locationCtx: string): Promise<TaskAction> {
  const groups = await loadUserGroups(userId)
  const groupsBlock = fmtGroupsForPrompt(groups)
  const system =
`You are Teeby, an action-taking assistant inside the Tryber social app. The user (${userName}) asked you to do something. Decide what action fits and reply with EXACTLY ONE tag — nothing else, no extra prose.

The user's groups (use the exact name when referencing):
${groupsBlock}

User's location: ${locationCtx || 'Israel'}

Available action tags (pick one):

1) Find members of ONE group matching a criteria and DM them a question:
   [FIND_AND_DM:<group name>|<short criteria, in English>|<DM body in the user's language>]
   - Use this when the user wants to TALK to specific matching people.
   - Criteria is a short English phrase ("vegetarian", "plays tennis", "lives in Tel Aviv").
   - Message body should sound like the user wrote it — friendly, 1–2 sentences.

2) Post a question in groups and aggregate answers later:
   [ASK_IN_GROUPS:<group name or "ALL">|<message body in the user's language>]
   - For "in all my groups" → use ALL.
   - Otherwise comma-separate group names: [ASK_IN_GROUPS:BBQ Friday,Music Lovers|...]
   - Message must be a clear question to the group, in the user's language.

3) Just find matching people, don't message yet:
   [FIND_ONLY:<group name or ANY>|<short criteria>]

4) Pure conversational reply (no action, just talk back):
   [REPLY:<your reply in the user's language>]

Rules:
- Output ONLY the tag. No greeting, no explanation, no commentary before or after.
- If the user names a group that isn't in their list, pick the closest match by intent. If nothing close, use REPLY to clarify.
- Keep DM/post messages SHORT (1–2 sentences, ≤ 200 chars).
- Answer in the user's language (Hebrew if they wrote in Hebrew).`

  const reply = await askClaude(request, system, 350, false)
  return parseAction(reply, groups)
}

function parseAction(raw: string, groups: GroupRef[]): TaskAction {
  // Find first [TAG:...] block (the LLM might add stray text — be lenient).
  const m = raw.match(/\[(FIND_AND_DM|ASK_IN_GROUPS|FIND_ONLY|REPLY):([\s\S]+?)\]/i)
  if (!m) return { kind: 'reply', text: raw.trim() || "I'm not sure what to do — try rephrasing?" }

  const tag = m[1].toUpperCase()
  const inside = m[2].trim()

  const findGroup = (name: string): GroupRef | null => {
    const t = name.trim().toLowerCase()
    return groups.find(g => g.name.toLowerCase() === t)
        || groups.find(g => g.name.toLowerCase().includes(t))
        || groups.find(g => t.includes(g.name.toLowerCase()))
        || null
  }

  if (tag === 'FIND_AND_DM') {
    const parts = inside.split('|')
    const gname = (parts[0] || '').trim()
    const criteria = (parts[1] || '').trim()
    const message = (parts.slice(2).join('|') || '').trim()
    const g = findGroup(gname)
    if (!g) return { kind: 'reply', text: `I couldn't find a group called "${gname}" in your Trybes.` }
    return { kind: 'find_and_dm', group_id: g.id, group_name: g.name, criteria, message }
  }

  if (tag === 'ASK_IN_GROUPS') {
    const parts = inside.split('|')
    const which = (parts[0] || '').trim()
    const message = (parts.slice(1).join('|') || '').trim()
    let group_ids: string[]
    let group_names: string[]
    if (which.toUpperCase() === 'ALL') {
      group_ids = groups.map(g => g.id); group_names = groups.map(g => g.name)
    } else {
      const matched = which.split(',').map(s => findGroup(s)).filter((x): x is GroupRef => !!x)
      group_ids = matched.map(g => g.id); group_names = matched.map(g => g.name)
    }
    if (!group_ids.length) return { kind: 'reply', text: "I couldn't find any of those groups in your Trybes." }
    return { kind: 'ask_in_groups', group_ids, group_names, message }
  }

  if (tag === 'FIND_ONLY') {
    const parts = inside.split('|')
    const gname = (parts[0] || '').trim()
    const criteria = (parts.slice(1).join('|') || '').trim()
    let group_id: string | null = null
    if (gname && gname.toUpperCase() !== 'ANY') {
      const g = findGroup(gname); group_id = g?.id || null
    }
    return { kind: 'find_only', group_id, criteria }
  }

  // REPLY fallback
  return { kind: 'reply', text: inside }
}

// ─── Execution helpers (called only after explicit user confirmation) ───────

// Resolve which members of a group match a criteria. We pull every member's
// bio/display_name/username and let Claude grade them (so the criteria can be
// fuzzy: "vegetarian", "plays tennis", "from Tel Aviv").
export async function findMembersMatching(groupId: string, criteria: string, maxResults = 5): Promise<{ id: string; name: string; bio: string | null }[]> {
  const { data: m } = await supabase.from('group_members').select('user_id').eq('group_id', groupId)
  const ids = (m || []).map((r: any) => r.user_id)
  if (!ids.length) return []
  const { data: profiles } = await supabase.from('profiles').select('id, display_name, username, bio').in('id', ids)
  const list = (profiles || []).map((p: any) => ({ id: p.id, name: p.display_name || p.username || 'User', bio: p.bio || null }))
  if (!list.length) return []

  // Ask Claude to pick up to maxResults best matches as a JSON id array.
  const prompt = `Criteria: "${criteria}"\n\nMembers:\n${list.map(m => '- ' + m.id + ' :: ' + m.name + (m.bio ? ' :: ' + m.bio.slice(0, 80) : '')).join('\n')}\n\nReturn ONLY a JSON array of up to ${maxResults} member ids (strings) that best match the criteria, in best-fit order. If no one fits, return [].`
  const reply = await askClaude(prompt, 'You are a careful matchmaker. Return JSON only.', 200, false)
  let chosen: string[] = []
  try {
    const j = JSON.parse(reply.match(/\[[\s\S]*?\]/)?.[0] || '[]')
    if (Array.isArray(j)) chosen = j.map(String).filter(id => list.find(m => m.id === id))
  } catch {}
  return chosen.map(id => list.find(m => m.id === id)!).filter(Boolean).slice(0, maxResults)
}

// Sends a DM from `userId` to each recipient, using the existing sendDM
// service (which also fires the push notification via the edge function).
export async function executeFindAndDM(userId: string, action: Extract<TaskAction, { kind: 'find_and_dm' }>): Promise<{ sent: number; recipients: { id: string; name: string }[] }> {
  const matches = await findMembersMatching(action.group_id, action.criteria, 5)
  let sent = 0
  for (const r of matches) {
    try {
      await sendDM({ id: uuidv4(), senderId: userId, receiverId: r.id, content: action.message, senderMode: 'lit', receiverMode: 'lit' })
      sent++
    } catch {}
  }
  return { sent, recipients: matches.map(r => ({ id: r.id, name: r.name })) }
}

// Posts the user's message in each chosen group via the existing sendMessage
// service (which triggers group-agent + push fan-out).
export async function executeAskInGroups(userId: string, action: Extract<TaskAction, { kind: 'ask_in_groups' }>): Promise<{ posted: number }> {
  let posted = 0
  for (const gid of action.group_ids) {
    try {
      await sendMessage({ id: uuidv4(), groupId: gid, userId, content: action.message, senderMode: 'lit' })
      posted++
    } catch {}
  }
  return { posted }
}
