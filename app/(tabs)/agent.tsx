import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import * as Calendar from 'expo-calendar'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_KEY || ''
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F7FF'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp: string }

const QUICK_ACTIONS = [
  { emoji: '📍', label: 'Groups nearby' },
  { emoji: '📅', label: 'Add to calendar' },
  { emoji: '🛒', label: 'Shopping list' },
  { emoji: '🌐', label: 'Search web' },
  { emoji: '💬', label: 'Find people' },
  { emoji: '⚡', label: 'Create group' },
]

export default function AgentScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [locationCtx, setLocationCtx] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [credits, setCredits] = useState(20)
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: profile } = await supabase.from('profiles').select('display_name, username, teeby_credits').eq('id', user.id).single()
    if (profile) {
      setUserName(profile.display_name || profile.username || '')
      setCredits(profile.teeby_credits ?? 20)
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
        const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        if (place) setLocationCtx([place.city, place.district].filter(Boolean).join(', '))
      }
    } catch {}
    const { data: history } = await supabase.from('agent_messages').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(30)
    if (history?.length) {
      setMessages(history.map((m: any) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.created_at })))
    } else {
      const welcome = `שלום${userName ? ` ${userName}` : ''}! ✦ אני Teeby, הסוכן האישי שלך.\n\nאני יכול לעזור לך:\n📍 למצוא קבוצות וחברים בקרבתך\n📅 להוסיף אירועים לקלנדר\n🛒 לנהל רשימות קניות\n🌐 לחפש מידע באינטרנט\n💬 לשלוח הודעות לחברים\n⚡ ליצור קבוצות חדשות\n\nמה אעשה בשבילך?`
      addMessage('assistant', welcome)
    }
  }

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const msg: Message = { id: Date.now().toString(), role, content, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, msg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    if (userId) supabase.from('agent_messages').insert({ user_id: userId, role, content }).catch(() => {})
  }, [userId])

  const webSearch = async (query: string): Promise<string> => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: 3, search_depth: 'basic' }),
      })
      const data = await res.json()
      return data.results?.map((r: any) => `${r.title}: ${r.content}`).join('\n') || 'No results'
    } catch { return 'Search failed' }
  }

  const addToCalendar = async (title: string, dateStr: string, notes?: string): Promise<boolean> => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync()
      if (status !== 'granted') return false
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
      const defaultCal = calendars.find(c => c.allowsModifications) || calendars[0]
      if (!defaultCal) return false
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return false
      const end = new Date(date.getTime() + 60 * 60 * 1000)
      await Calendar.createEventAsync(defaultCal.id, {
        title, startDate: date, endDate: end, notes: notes || '',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      return true
    } catch { return false }
  }

  const getNearbyGroups = async (): Promise<string> => {
    try {
      if (!coords) return 'Location not available'
      const { data } = await supabase.rpc('nearby_users', { p_lat: coords.lat, p_lon: coords.lon, radius_m: 2000 })
      const { data: groups } = await supabase.from('groups').select('id, name, member_count').eq('status', 'open').limit(5)
      if (!groups?.length) return 'No open groups nearby'
      return groups.map((g: any) => `• ${g.name} (${g.member_count} members)`).join('\n')
    } catch { return 'Could not load groups' }
  }

  const sendTeebyMessage = async (userMsg: string) => {
    if (!userMsg.trim() || loading) return
    setInput('')
    setLoading(true)
    addMessage('user', userMsg)

    try {
      // Build context
      const nearbyGroups = await getNearbyGroups()
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }))

      // Check if need web search
      const needsSearch = /חפש|search|מה זה|what is|מתי|when|איפה|where|חדשות|news|מחיר|price/i.test(userMsg)
      let searchResult = ''
      if (needsSearch) {
        searchResult = await webSearch(userMsg)
      }

      const systemPrompt = `You are Teeby, a highly intelligent personal AI assistant in the Tryber social app.

USER CONTEXT:
- Name: ${userName || 'Friend'}
- Location: ${locationCtx || 'Israel'}
- Coordinates: ${coords ? `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}` : 'unknown'}
- Credits remaining: ${credits}/20
- Nearby groups: ${nearbyGroups}
${searchResult ? `- Web search results: ${searchResult}` : ''}

YOUR PERSONALITY:
- You are warm, proactive, witty and genuinely helpful
- You speak Hebrew when user speaks Hebrew, English when English
- You are like a smart friend who knows the local area well

YOUR CAPABILITIES:
1. CALENDAR: To add event respond with [CAL:title|YYYY-MM-DDTHH:MM:SS]
   Example: [CAL:ארוחת ערב|2025-05-25T19:00:00]
2. WEB SEARCH: Already done if needed - results above
3. GROUPS: Use [CREATE_GROUP:name] to help create one
4. SHOPPING LIST: Help organize lists, remember items

RESPONSE STYLE:
- Be concise but helpful (2-4 sentences max)
- Be proactive - suggest relevant actions
- Use emojis naturally
- Always end with a helpful follow-up suggestion`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: systemPrompt,
          messages: [...history, { role: 'user', content: userMsg }],
        }),
      })
      const data = await res.json()
      let reply = data.content?.[0]?.text?.trim() || 'אני לא מצליח לענות כרגע, נסה שוב.'

      // Handle calendar action
      const calMatch = reply.match(/\[CAL:([^\|]+)\|([^\]]+)\]/)
      if (calMatch) {
        const added = await addToCalendar(calMatch[1].trim(), calMatch[2].trim())
        reply = reply.replace(calMatch[0], '')
        reply += added ? '\n\n✅ הוספתי לקלנדר שלך!' : '\n\n❌ לא הצלחתי להוסיף לקלנדר. בדוק הרשאות.'
      }

      // Handle group creation
      const groupMatch = reply.match(/\[CREATE_GROUP:([^\]]+)\]/)
      if (groupMatch) {
        reply = reply.replace(groupMatch[0], '')
        reply += `\n\n⚡ [לחץ כאן ליצירת הקבוצה "${groupMatch[1].trim()}"]`
      }

      addMessage('assistant', reply.trim())

      // Update credits
      if (userId) {
        const newCredits = Math.max(0, credits - 1)
        setCredits(newCredits)
        await supabase.from('profiles').update({ teeby_credits: newCredits }).eq('id', userId)
      }
    } catch (err) {
      addMessage('assistant', 'משהו השתבש. נסה שוב בעוד רגע.')
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CARD} />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>
          <View>
            <Text style={s.agentName}>Teeby</Text>
            <Text style={s.agentSub}>{locationCtx ? `📍 ${locationCtx}` : 'Your Personal AI'}</Text>
          </View>
        </View>
        <View style={s.creditsWrap}>
          <Text style={s.creditsText}>{credits} ✦</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            messages.length === 0 ? null : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickActions} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {QUICK_ACTIONS.map(a => (
                  <TouchableOpacity key={a.label} style={s.quickBtn} onPress={() => sendTeebyMessage(a.label)}>
                    <Text style={s.quickBtnEmoji}>{a.emoji}</Text>
                    <Text style={s.quickBtnText}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )
          }
          renderItem={({ item }) => {
            const isMe = item.role === 'user'
            return (
              <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                {!isMe && <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>}
                <View style={s.bubbleCol}>
                  <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleBot]}>
                    <Text style={[s.bubbleText, isMe && s.bubbleTextMe]}>{item.content}</Text>
                  </View>
                  <Text style={[s.timeText, isMe && { textAlign: 'right' }]}>{formatTime(item.timestamp)}</Text>
                </View>
              </View>
            )
          }}
        />

        {messages.length === 0 && (
          <View style={s.emptyState}>
            <View style={s.emptyAvatar}><Text style={{ fontSize: 40, color: PRIMARY }}>✦</Text></View>
            <Text style={s.emptyTitle}>Teeby</Text>
            <Text style={s.emptySub}>Your personal AI — always here</Text>
            <View style={s.quickActionsGrid}>
              {QUICK_ACTIONS.map(a => (
                <TouchableOpacity key={a.label} style={s.quickBtnLarge} onPress={() => sendTeebyMessage(a.label)}>
                  <Text style={s.quickBtnLargeEmoji}>{a.emoji}</Text>
                  <Text style={s.quickBtnLargeText}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {loading && (
          <View style={s.typingRow}>
            <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
            <View style={[s.bubble, s.bubbleBot, { paddingVertical: 14 }]}>
              <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
            </View>
          </View>
        )}

        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Teeby anything..."
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendTeebyMessage(input)}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]}
            onPress={() => sendTeebyMessage(input)}
            disabled={!input.trim() || loading}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendIcon}>↑</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: 'rgba(108,99,255,0.08)' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentAvatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(108,99,255,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: PRIMARY },
  agentAvatarText: { fontSize: 20, color: PRIMARY, fontWeight: '700' },
  agentName: { fontSize: 17, fontWeight: '700', color: TEXT },
  agentSub: { fontSize: 11, color: GRAY, marginTop: 1 },
  creditsWrap: { backgroundColor: 'rgba(108,99,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)' },
  creditsText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  messageList: { padding: 16, gap: 12, flexGrow: 1 },
  quickActions: { marginBottom: 8 },
  quickBtn: { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: 'rgba(108,99,255,0.1)' },
  quickBtnEmoji: { fontSize: 14 },
  quickBtnText: { fontSize: 12, color: PRIMARY, fontWeight: '500' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  agentAvatarSmall: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(108,99,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)' },
  bubbleCol: { maxWidth: '78%' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: { backgroundColor: CARD, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: 'rgba(108,99,255,0.08)' },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: TEXT },
  bubbleTextMe: { color: '#fff' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 3, marginLeft: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, gap: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: 'rgba(108,99,255,0.08)' },
  input: { flex: 1, minHeight: 42, maxHeight: 100, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: 'rgba(108,99,255,0.1)' },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.35 },
  sendIcon: { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyAvatar: { width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(108,99,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY, marginBottom: 16 },
  emptyTitle: { fontSize: 28, fontWeight: '700', color: TEXT, marginBottom: 4 },
  emptySub: { fontSize: 14, color: GRAY, marginBottom: 32 },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  quickBtnLarge: { width: '45%', backgroundColor: CARD, borderRadius: 16, padding: 16, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(108,99,255,0.08)' },
  quickBtnLargeEmoji: { fontSize: 28 },
  quickBtnLargeText: { fontSize: 13, color: TEXT, fontWeight: '500', textAlign: 'center' },
})
