import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import { supabase } from '../../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_KEY || ''

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const QUICK_PROMPTS = [
  '📋 צור לי רשימת קניות',
  '🌤️ מה מזג האוויר היום?',
  '📰 מה קורה בארץ עכשיו?',
  '💡 מה לעשות הלילה בתל אביב?',
  '💰 הצע לי מחיר למוצר יד שנייה',
]

async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    })
    const data = await res.json()
    if (data.answer) return `Search result: ${data.answer}`
    if (data.results?.length) {
      return data.results.slice(0, 3).map((r: any) => `${r.title}: ${r.content?.slice(0, 200)}`).join('\n\n')
    }
    return ''
  } catch {
    return ''
  }
}

function needsWebSearch(msg: string): boolean {
  const lower = msg.toLowerCase()
  const triggers = [
    'מזג אוויר', 'weather', 'חדשות', 'news', 'עכשיו', 'היום', 'now', 'today',
    'מחיר', 'price', 'כמה עולה', 'how much', 'שעות פתיחה', 'opening hours',
    'מה קורה', "what's happening", 'אירועים', 'events', 'מסעדה', 'restaurant',
    'תוצאות', 'results', 'ספורט', 'sport', 'כדורגל', 'football',
  ]
  return triggers.some(t => lower.includes(t))
}

export default function AgentScreen() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      if (profile) setUserName(profile.display_name || profile.username || '')
      loadHistory(user.id)
    })
  }, [])

  const loadHistory = async (uid: string) => {
    const { data } = await supabase.from('agent_messages').select('*').eq('user_id', uid).order('created_at', { ascending: true }).limit(50)
    if (data) setMessages(data as Message[])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }

  const send = async (text?: string) => {
    const msg = (text || draft).trim()
    if (!msg || !userId || loading) return
    setDraft('')
    setLoading(true)

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    await supabase.from('agent_messages').insert({ user_id: userId, role: 'user', content: msg })

    try {
      // Search web if needed
      let webContext = ''
      if (needsWebSearch(msg)) {
        webContext = await searchWeb(msg)
      }

      const history = [...messages, userMsg].slice(-20).map(m => ({ role: m.role, content: m.content }))

      const systemPrompt = `You are a personal AI assistant for ${userName} on Tryber — a location-based social app in Israel.

Your capabilities:
- Answer any question using your knowledge
- Search the web for current info (weather, news, prices, events)
- Create lists with checkboxes (☐ item)
- Set reminders and help plan
- Help write posts or messages
- Suggest local recommendations

${webContext ? `\nCurrent web search results for "${msg}":\n${webContext}\n\nUse this information to give an accurate, up-to-date answer.` : ''}

When creating lists use this format:
☐ Item 1
☐ Item 2

Reply in the same language as the user (Hebrew or English). Be warm, helpful, and concise.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: systemPrompt,
          messages: history,
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'מצטער, משהו השתבש. נסה שוב.'

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, assistantMsg])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
      await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply })
    } catch {
      Alert.alert('שגיאה', 'לא ניתן להתחבר לסוכן. בדוק חיבור לאינטרנט.')
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = async () => {
    if (!userId) return
    Alert.alert('מחק היסטוריה', 'למחוק את כל השיחה?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק', style: 'destructive', onPress: async () => {
        await supabase.from('agent_messages').delete().eq('user_id', userId)
        setMessages([])
      }}
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.headerAvatar}><Text style={s.headerAvatarText}>✦</Text></View>
          <View>
            <Text style={s.headerName}>הסוכן שלי</Text>
            <Text style={s.headerSub}>Claude + חיפוש אינטרנט · תמיד זמין</Text>
          </View>
        </View>
        <TouchableOpacity onPress={clearHistory}>
          <Text style={s.clearBtn}>נקה</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={[s.list, messages.length === 0 && s.listEmpty]}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>✦</Text>
              <Text style={s.emptyTitle}>הסוכן האישי שלך</Text>
              <Text style={s.emptySub}>שאל אותי כל שאלה — אני יכול לחפש באינטרנט, ליצור רשימות, לקבוע תזכורות ועוד.</Text>
              <View style={s.quickPrompts}>
                {QUICK_PROMPTS.map(p => (
                  <TouchableOpacity key={p} style={s.quickPrompt} onPress={() => send(p)}>
                    <Text style={s.quickPromptText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.role === 'user'
            return (
              <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                {!isMe && <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>}
                <View style={s.bubbleCol}>
                  <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleAgent]}>
                    <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextAgent]}>{item.content}</Text>
                  </View>
                  <Text style={[s.timeText, isMe && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                </View>
              </View>
            )
          }}
        />

        {loading && (
          <View style={s.typingRow}>
            <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>
            <View style={[s.bubble, s.bubbleAgent, s.typingBubble]}>
              <Text style={s.typingDots}>• • •</Text>
            </View>
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="שאל את הסוכן שלך..."
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]}
            onPress={() => send()}
            disabled={!draft.trim() || loading}
          >
            <Text style={s.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  headerAvatarText: { fontSize: 16, color: PURPLE, fontWeight: '700' },
  headerName: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  headerSub: { fontSize: 11, color: GRAY },
  clearBtn: { fontSize: 14, color: GRAY },
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 52, color: PURPLE, marginBottom: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  quickPrompts: { gap: 8, width: '100%' },
  quickPrompt: { backgroundColor: '#EEEDFE', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  quickPromptText: { fontSize: 14, color: PURPLE, fontWeight: '500' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  agentAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PURPLE },
  agentAvatarText: { fontSize: 13, color: PURPLE, fontWeight: '700' },
  bubbleCol: { maxWidth: '82%' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleAgent: { backgroundColor: '#EEEDFE', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextMe: { color: '#fff' },
  bubbleTextAgent: { color: '#2C2C2A' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 3, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  typingBubble: { paddingVertical: 12 },
  typingDots: { fontSize: 16, color: PURPLE, letterSpacing: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
