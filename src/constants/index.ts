export const PRIMARY = '#6C63FF'
export const BG = '#F8F7FF'
export const CARD = '#FFFFFF'
export const TEXT = '#1A1A2E'
export const GRAY = '#8A8A9A'
export const BORDER = 'rgba(108,99,255,0.08)'
export const LIVE = '#00BFA6'
export const DANGER = '#FF3B30'
export const SUPABASE_URL = 'https://vytkiwibuohtcmjmslkh.supabase.co'
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5dGtpd2lidW9odGNtam1zbGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODIwNDUsImV4cCI6MjA5MDk1ODA0NX0.jgggUmp5stzW-9QKLjtrVJdQE4MBbKaFLuySZjgi-ds'
export const EDGE_URL = SUPABASE_URL + '/functions/v1/quick-endpoint'
export const EDGE_AUTH = 'Bearer ' + SUPABASE_ANON
export const EAS_PROJECT_ID = 'f39665fe-cfb2-460a-bfa6-826d501d7333'
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
export const AGENT_IDS = ['a1000001-0000-0000-0000-000000000001','a1000001-0000-0000-0000-000000000002','a1000001-0000-0000-0000-000000000003','a1000001-0000-0000-0000-000000000019','a1000001-0000-0000-0000-000000000020','a1000001-0000-0000-0000-000000000026','a1000001-0000-0000-0000-000000000029']

export type Agent = { id: string; name: string; personality: string; lang: 'he' | 'en' }

export const AGENTS: Agent[] = [
  { id: 'a1000001-0000-0000-0000-000000000001', name: 'Teeby', personality: 'the friendly, witty Tryber guide who loves helping people connect', lang: 'en' },
  { id: 'a1000001-0000-0000-0000-000000000002', name: 'Maya', personality: 'a warm, upbeat local who knows all the fun spots', lang: 'he' },
  { id: 'a1000001-0000-0000-0000-000000000003', name: 'Noa', personality: 'a chill, sarcastic friend who keeps it real', lang: 'he' },
  { id: 'a1000001-0000-0000-0000-000000000019', name: 'Alex', personality: 'an energetic events buddy who is always planning something', lang: 'en' },
  { id: 'a1000001-0000-0000-0000-000000000020', name: 'Sam', personality: 'a thoughtful, curious conversationalist', lang: 'en' },
  { id: 'a1000001-0000-0000-0000-000000000026', name: 'Lior', personality: 'a playful matchmaker who loves introducing people', lang: 'he' },
  { id: 'a1000001-0000-0000-0000-000000000029', name: 'Dana', personality: 'a supportive, encouraging cheerleader', lang: 'he' },
]

export const INVITE_MSG = 'Join me on Tryber ✦ — the next generation of social. Find people nearby, join Trybes, and chat with AI. Download: https://tryber.app'
