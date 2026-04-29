import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
  Alert, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import * as Calendar from 'expo-calendar'
import { useRouter } from 'expo-router'
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
  '📬 What did I miss?',
  '🍕 Find food near me',
  '📅 Add to my calendar',
  '⚡ Active groups nearby',
  '🌐 Search the web for me',
]

export default function AgentScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('there')
  const [teebyName, setTeebyName] = useState('Teeby')
  const [memoryFacts, setMemoryFacts] = useState<any>({})
  const [locationCtx, setLocationCtx] = useState('')
  const [coords, setCoords] = useState<{lat: number, lon: number} | null>(null)
  const listRef = useRef<FlatList>(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
    const name = profile?.display_name || profile?.username || 'there'
    setUserName(name)

    const { data: pa } = await supabase.from('personal_agents').select('*').eq('user_id', user.id).single()
    if (pa?.name) setTeebyName(pa.name)

    const { data: mem } = await supabase.from('teeby_memory').select('facts').eq('user_id', user.id).single()
    if (mem?.facts) setMemoryFacts(mem.facts)

    const { data: history } = await supabase.from('agent_messages')
      .select('*').eq('user_id', user.id)
      .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString())
      .order('created_at', { ascending: true }).limit(50)

    if (history?.length) {
      setMessages(history as Message[])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200)
    } else {
      const greeting: Message = {
        id: 'greeting', role: 'assistant',
        content: `Hey ${name}! ✦\n\nI'm ${pa?.name || 'Teeby'} — your personal AI on Tryber.\n\nHere's what I can do for you:\n🍕 Find restaurants & places nearby\n📅 Add events to your calendar\n📬 Summarize missed messages\n🌐 Search the web for anything\n✦ Post on the feed for you\n\nWhat do you need?`,
        created_at: new Date().toISOString()
      }
      setMessages([greeting])
    }

    // Get location
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
        const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        if (place) {
          const locStr = [place.name, place.street, place.city, place.country].filter(Boolean).join(', ')
          setLocationCtx(locStr)
        }
      }
    } catch {}
  }

  const webSearch = async (query: string): Promise<string> => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query,
          max_results: 5,
          search_depth: 'advanced',
          include_answer: true,
        }),
      })
      const data = await res.json()
      let result = ''
      if (data.answer) result += `Answer: ${data.answer}\n\n`
      if (data.results?.length) {
        result += data.results.slice(0, 4).map((r: any) =>
          `• ${r.title}: ${r.content?.slice(0, 300)}`
        ).join('\n\n')
      }
      return result || ''
    } catch { return '' }
  }

  const addToCalendar = async (title: string, dateStr: string, notes?: string): Promise<boolean> => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow calendar access to add events')
        return false
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
      const defaultCal = calendars.find(c => c.allowsModifications) || calendars[0]
      if (!defaultCal) return false
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return false
      await Calendar.createEventAsync(defaultCal.id, {
        title,
        startDate: date,
        endDate: new Date(date.getTime() + 60 * 60 * 1000),
        notes: notes || 'Added by Teeby on Tryber',
      })
      return true
    } catch { return false }
  }

  const publishPost = async (content: string): Promise<boolean> => {
    if (!userId) return false
    try {
      await supabase.from('posts').insert({ user_id: userId, content, likes: 0, is_anonymous: false })
      return true
    } catch { return false }
  }

  const send = async (text?: string) => {
    const msg = (text || draft).trim()
    if (!msg || !userId || loading) return
    setDraft('')
    setLoading(true)

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    await supabase.from('agent_messages').insert({ user_id: userId, role: 'user', content: msg })

    try {
      const lower = msg.toLowerCase()
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
      const dateStr = now.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

      let context = `You are ${teebyName}, a smart and proactive AI assistant in the Tryber social app.
User: ${userName} | Location: ${locationCtx || 'unknown'} | Coordinates: ${coords ? `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}` : 'unknown'}
Current time: ${timeStr} | Date: ${dateStr}

You have access to:
- Web search results (provided below when relevant)
- User's unread messages summary (provided below when relevant)
- Nearby groups on Tryber

Rules:
- Always reply in the same language as the user (Hebrew or English)
- Be direct, helpful, and proactive
- When you have search results, summarize them clearly with bullet points
- For food/places: give specific names, ratings if available, and why you recommend them
- For calendar: confirm what you'll add, then include [CALENDAR:title|ISO-date] at the end
- For posting: include [POST:content] at the end when user confirms
- Keep responses under 150 words unless listing items

`
      // Web search for location-based queries
      const needsSearch = lower.includes('food') || lower.includes('restaurant') || lower.includes('eat') ||
        lower.includes('אוכל') || lower.includes('מסעדה') || lower.includes('cafe') || lower.includes('קפה') ||
        lower.includes('find') || lower.includes('search') || lower.includes('חפש') || lower.includes('מה זה') ||
        lower.includes('what is') || lower.includes('news') || lower.includes('חדשות') || lower.includes('open') ||
        lower.includes('activity') || lower.includes('פעילות') || lower.includes('recommend') || lower.includes('המלץ')

      if (needsSearch) {
        const searchQuery = locationCtx ? `${msg} near ${locationCtx}` : msg
        const searchResult = await webSearch(searchQuery)
        if (searchResult) context += `\n🌐 Web search results for "${msg}":\n${searchResult}\n\n`
      }

      // Summary of unread
      const needsSummary = lower.includes('missed') || lower.includes('פספסתי') || lower.includes('summary') ||
        lower.includes('סכם') || lower.includes('unread') || lower.includes('לא קראתי')
      if (needsSummary) {
        const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at, groups(name)').eq('user_id', userId)
        if (myGroups?.length) {
          let summaryCtx = '\n📬 Unread messages:\n'
          let hasUnread = false
          for (const m of myGroups) {
            if (!m.last_read_at) continue
            const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', m.group_id).neq('user_id', userId).gt('created_at', m.last_read_at).limit(5)
            if (msgs?.length) {
              summaryCtx += `\n${(m as any).groups?.name}: ${msgs.map((x: any) => x.content).join(' | ')}`
              hasUnread = true
            }
          }
          if (hasUnread) context += summaryCtx + '\n\n'
          else context += '\n📬 No unread messages.\n\n'
        }
      }

      // Nearby groups
      const needsGroups = lower.includes('group') || lower.includes('קבוצה') || lower.includes('nearby') ||
        lower.includes('קרוב') || lower.includes('active') || lower.includes('פעיל')
      if (needsGroups) {
        const { data: groups } = await supabase.from('groups').select('name, status, member_count, location_name').eq('status', 'open').order('member_count', { ascending: false }).limit(5)
        if (groups?.length) {
          context += `\n⚡ Active Trybes:\n${groups.map((g: any) => `• ${g.name} — ${g.member_count} people${g.location_name ? ` @ ${g.location_name}` : ''}`).join('\n')}\n\n`
        }
      }

      // Calendar intent
      const needsCalendar = lower.includes('calendar') || lower.includes('קלנדר') || lower.includes('remind') ||
        lower.includes('תזכורת') || lower.includes('schedule') || lower.includes('event') || lower.includes('אירוע') || lower.includes('add')
      if (needsCalendar) {
        context += '\nFor calendar requests: if the user gave a title and time, add [CALENDAR:title|YYYY-MM-DDTHH:mm] at the end of your reply. Be smart about parsing dates from natural language.\n\n'
      }

      // Post intent
      const needsPost = lower.includes('post') || lower.includes('פרסם') || lower.includes('publish') || lower.includes('share on feed')
      if (needsPost) {
        context += '\nFor posting: if ready to post, include [POST:exact content to post] at the end.\n\n'
      }

      // Memory
      if (Object.keys(memoryFacts).length > 0) {
        context += `\nWhat I know about ${userName}: ${JSON.stringify(memoryFacts)}\n`
      }

      const recentMessages = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: context,
          messages: [...recentMessages, { role: 'user', content: msg }],
        }),
      })

      const data = await res.json()
      let reply = data.content?.[0]?.text?.trim() || 'Something went wrong. Try again!'

      // Handle calendar action
      const calMatch = reply.match(/\[CALENDAR:([^\|]+)\|([^\]]+)\]/)
      if (calMatch) {
        reply = reply.replace(calMatch[0], '').trim()
        const added = await addToCalendar(calMatch[1].trim(), calMatch[2].trim())
        reply += added
          ? `\n\n✅ Added "${calMatch[1].trim()}" to your calendar!`
          : `\n\n⚠️ Couldn't add to calendar. Check permissions in Settings.`
      }

      // Handle post action
      const postMatch = reply.match(/\[POST:([^\]]+)\]/)
      if (postMatch) {
        reply = reply.replace(postMatch[0], '').trim()
        const postContent = postMatch[1].trim()
        Alert.alert('Post to Feed?', postContent, [
          { text: 'Cancel', style: 'cancel' },
          { text: '✓ Post it!', onPress: async () => {
            const posted = await publishPost(postContent)
            if (posted) Alert.alert('✅ Posted!', 'Your post is live on the feed.')
          }}
        ])
        reply += '\n\n📝 Tap "Post it!" to publish.'
      }

      // Save facts to memory
      const factPatterns = [
        { key: 'job', regex: /i (work|am) (at|as|a|an) (.+?)(?:\.|,|$)/i },
        { key: 'likes', regex: /i (like|love|enjoy) (.+?)(?:\.|,|$)/i },
        { key: 'lives', regex: /i (live|am) in (.+?)(?:\.|,|$)/i },
      ]
      const newFacts: any = { ...memoryFacts }
      let factsChanged = false
      for (const { key, regex } of factPatterns) {
        const match = msg.match(regex)
        if (match && match[match.length - 1]) {
          newFacts[key] = match[match.length - 1].trim()
          factsChanged = true
        }
      }
      if (factsChanged) {
        setMemoryFacts(newFacts)
        await supabase.from('teeby_memory').upsert({ user_id: userId, facts: newFacts }, { onConflict: 'user_id' })
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: reply, created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, assistantMsg])
      await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply })
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

    } catch {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: 'Sorry, something went wrong. Try again!',
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.agentAvatar}>
            <Text style={s.agentAvatarText}>✦</Text>
          </View>
          <View>
            <Text style={s.agentName}>{teebyName}</Text>
            <Text style={s.agentSub}>{locationCtx ? `📍 ${locationCtx.split(',')[0]}` : 'Your Personal AI'}</Text>
          </View>
        </View>
        <TouchableOpacity style={s.settingsBtn} onPress={() => Alert.alert(
          `${teebyName} Info`,
          `📍 ${locationCtx || 'Location unknown'}\n🧠 ${Object.keys(memoryFacts).length} memories\n🌐 Web search: enabled\n📅 Calendar: enabled`
        )}>
          <Text style={s.settingsBtnText}>ⓘ</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.messageList}
          ListHeaderComponent={
            messages.length <= 1 ? (
              <View style={s.quickPromptsWrap}>
                {QUICK_PROMPTS.map(p => (
                  <TouchableOpacity key={p} style={s.quickPrompt} onPress={() => send(p)}>
                    <Text style={s.quickPromptText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
          ListFooterComponent={
            loading ? (
              <View style={s.typingRow}>
                <View style={s.agentAvatarSmall}><Text style={s.agentAvatarSmallText}>✦</Text></View>
                <View style={s.typingBubble}>
                  <Text style={s.typingDots}>· · ·</Text>
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user'
            return (
              <View style={[s.bubbleRow, isUser && s.bubbleRowMe]}>
                {!isUser && (
                  <View style={s.agentAvatarSmall}>
                    <Text style={s.agentAvatarSmallText}>✦</Text>
                  </View>
                )}
                <View style={s.bubbleCol}>
                  <View style={[s.bubble, isUser ? s.bubbleMe : s.bubbleThem]}>
                    <Text style={[s.bubbleText, isUser && s.bubbleTextMe]}>{item.content}</Text>
                  </View>
                  <Text style={[s.timeText, isUser && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                </View>
              </View>
            )
          }}
        />

        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Ask ${teebyName} anything...`}
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => send()}
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
    </View>
  )
}

const PURPLE = '#7F77DD'
const DARK = '#1A1A2E'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF0FF', borderWidth: 1.5, borderColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  agentAvatarText: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  agentSub: { fontSize: 11, color: '#8A8A9A' },
  settingsBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  settingsBtnText: { fontSize: 18, color: '#8A8A9A' },
  messageList: { padding: 16, gap: 12, flexGrow: 1 },
  quickPromptsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  quickPrompt: { backgroundColor: 'rgba(127,119,221,0.15)', borderWidth: 1, borderColor: '#6C63FF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  quickPromptText: { fontSize: 13, color: '#A89EF5', fontWeight: '500' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  agentAvatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#6C63FF' },
  agentAvatarSmallText: { fontSize: 12, color: PURPLE, fontWeight: '700' },
  bubbleCol: { maxWidth: '80%' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe: { backgroundColor: PURPLE, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#F0F0F8', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#EBEBEB' },
  bubbleText: { fontSize: 15, lineHeight: 22, color: '#1A1A2E' },
  bubbleTextMe: { color: '#fff' },
  timeText: { fontSize: 10, color: '#B4B2A9', marginTop: 4, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  typingBubble: { backgroundColor: '#F0F0F8', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 0.5, borderColor: '#EBEBEB' },
  typingDots: { fontSize: 18, color: PURPLE, letterSpacing: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, gap: 8, backgroundColor: '#FFFFFF', borderTopWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F0F0F8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#EBEBEB' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.3 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
