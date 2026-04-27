import { useState, useEffect, useRef, useCallback } from 'react'
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
  '📬 Summarize what I missed',
  '📍 What\'s happening nearby?',
  '🛒 Create a shopping list',
  '📅 Add to my calendar',
  '⚡ Find active groups',
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
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    init()
  }, [])

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
        content: `Hey ${name}! 👋 I'm ${pa?.name || 'Teeby'}, your personal AI.\n\nI can help you:\n• 📬 Summarize missed messages\n• 📅 Add events to your calendar\n• 🛒 Create shared shopping lists\n• 📍 Find people & groups nearby\n• ✦ Post on your behalf\n\nWhat can I do for you?`,
        created_at: new Date().toISOString()
      }
      setMessages([greeting])
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        if (place) setLocationCtx(`${place.city || ''}, ${place.country || ''}`)
      }
    } catch {}
  }

  const addToCalendar = async (title: string, dateStr: string) => {
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
      await Calendar.createEventAsync(defaultCal.id, {
        title,
        startDate: date,
        endDate: new Date(date.getTime() + 60 * 60 * 1000),
        notes: 'Added by Teeby on Tryber',
      })
      return true
    } catch (e) { return false }
  }

  const publishPost = async (content: string) => {
    if (!userId) return false
    try {
      await supabase.from('posts').insert({
        user_id: userId,
        content,
        likes: 0,
        is_anonymous: false,
      })
      return true
    } catch { return false }
  }

  const webSearch = async (query: string): Promise<string> => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: 3, search_depth: 'basic' }),
      })
      const data = await res.json()
      return data.results?.map((r: any) => `${r.title}: ${r.content?.slice(0, 200)}`).join('\n') || ''
    } catch { return '' }
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
      let context = `You are ${teebyName}, a helpful AI assistant in the Tryber social app. User's name: ${userName}. Location: ${locationCtx || 'unknown'}. Today: ${new Date().toLocaleDateString('en')}.\n\nYou can help with: group chats, finding people nearby, shopping lists, calendar events, posting on the feed, and summarizing missed messages.\n\nAlways reply in the same language as the user (Hebrew or English). Be concise, warm, and helpful. Max 3 sentences unless listing items.\n\n`

      // Calendar intent
      const needsCalendar = lower.includes('calendar') || lower.includes('קלנדר') || lower.includes('add event') || lower.includes('remind') || lower.includes('תזכורת') || lower.includes('הוסף') || lower.includes('schedule')
      if (needsCalendar) {
        context += 'User wants to add something to their calendar. If they gave a title and date, confirm you\'ll add it. If not, ask for details. Format: respond with [CALENDAR:title|date] at the end of your message when ready to add.\n\n'
      }

      // Shopping list intent  
      const needsShopping = lower.includes('shopping') || lower.includes('רשימת קניות') || lower.includes('קניות') || lower.includes('buy') || lower.includes('list') || lower.includes('רשימה')
      if (needsShopping) {
        context += 'User wants a shopping list. Help them create or manage it. Be practical.\n\n'
      }

      // Post intent
      const needsPost = lower.includes('post') || lower.includes('פרסם') || lower.includes('publish') || lower.includes('share') || lower.includes('שתף')
      if (needsPost) {
        context += 'User wants to post something on the feed. If they gave content, confirm with [POST:content] at end. If not, ask what to post.\n\n'
      }

      // Summary intent
      const needsSummary = lower.includes('missed') || lower.includes('פספסתי') || lower.includes('summary') || lower.includes('סכם') || lower.includes('unread')
      if (needsSummary) {
        const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at, groups(name)').eq('user_id', userId)
        if (myGroups?.length) {
          let summaryCtx = 'Unread messages from groups:\n'
          for (const m of myGroups) {
            if (!m.last_read_at) continue
            const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', m.group_id).neq('user_id', userId).gt('created_at', m.last_read_at).limit(5)
            if (msgs?.length) {
              summaryCtx += `\n${(m as any).groups?.name}: ${msgs.map((x: any) => x.content).join(' | ')}`
            }
          }
          context += summaryCtx + '\n\n'
        }
      }

      // Web search
      const needsSearch = lower.includes('what is') || lower.includes('מה זה') || lower.includes('news') || lower.includes('חדשות') || lower.includes('find') || lower.includes('search') || lower.includes('חפש')
      if (needsSearch) {
        const searchResult = await webSearch(msg)
        if (searchResult) context += `Web search results:\n${searchResult}\n\n`
      }

      // Groups context
      const needsGroups = lower.includes('group') || lower.includes('קבוצה') || lower.includes('nearby') || lower.includes('קרוב') || lower.includes('people')
      if (needsGroups) {
        const { data: groups } = await supabase.from('groups').select('name, status, member_count').eq('status', 'open').order('member_count', { ascending: false }).limit(5)
        if (groups?.length) {
          context += `Active groups nearby: ${groups.map((g: any) => `${g.name} (${g.member_count} people)`).join(', ')}\n\n`
        }
      }

      // Memory context
      if (Object.keys(memoryFacts).length > 0) {
        context += `What I know about ${userName}: ${JSON.stringify(memoryFacts)}\n\n`
      }

      // Chat history
      const recentMessages = messages.slice(-8).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: context,
          messages: [...recentMessages, { role: 'user', content: msg }],
        }),
      })

      const data = await res.json()
      let reply = data.content?.[0]?.text?.trim() || 'Sorry, I had trouble understanding that.'

      // Handle calendar action
      const calMatch = reply.match(/\[CALENDAR:(.+?)\|(.+?)\]/)
      if (calMatch) {
        reply = reply.replace(calMatch[0], '').trim()
        const added = await addToCalendar(calMatch[1], calMatch[2])
        reply += added ? `\n\n✅ Added "${calMatch[1]}" to your calendar!` : '\n\n⚠️ Couldn\'t access calendar. Check permissions.'
      }

      // Handle post action
      const postMatch = reply.match(/\[POST:(.+?)\]/)
      if (postMatch) {
        reply = reply.replace(postMatch[0], '').trim()
        Alert.alert(
          'Post to Feed?',
          postMatch[1],
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Post ✓', onPress: async () => {
              const posted = await publishPost(postMatch[1])
              if (posted) Alert.alert('✅ Posted!', 'Your post is now live on the feed.')
            }}
          ]
        )
        reply += '\n\n📝 I\'ve prepared your post — tap Post to publish it.'
      }

      // Save memory facts mentioned
      const factPatterns = [
        { key: 'name', regex: /my name is (\w+)|אני (\w+)/i },
        { key: 'job', regex: /i work (at|as|in) (.+)|אני עובד ב(.+)/i },
        { key: 'interests', regex: /i (like|love|enjoy) (.+)|אני אוהב (.+)/i },
      ]
      const newFacts: any = { ...memoryFacts }
      let factsChanged = false
      for (const { key, regex } of factPatterns) {
        const match = msg.match(regex)
        if (match) {
          newFacts[key] = match[2] || match[1]
          factsChanged = true
        }
      }
      if (factsChanged) {
        setMemoryFacts(newFacts)
        await supabase.from('teeby_memory').upsert({ user_id: userId, facts: newFacts }, { onConflict: 'user_id' })
      }

      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: reply, created_at: new Date().toISOString() }
      setMessages(prev => [...prev, assistantMsg])
      await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply })
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

    } catch (e: any) {
      const errMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Sorry, something went wrong. Try again!', created_at: new Date().toISOString() }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.agentAvatar}>
            <Text style={s.agentAvatarText}>✦</Text>
          </View>
          <View>
            <Text style={s.agentName}>{teebyName}</Text>
            <Text style={s.agentSub}>Your Personal AI · Always here</Text>
          </View>
        </View>
        <TouchableOpacity style={s.settingsBtn} onPress={() => Alert.alert(teebyName, `📍 ${locationCtx || 'Location unknown'}\n🧠 ${Object.keys(memoryFacts).length} things remembered`)}>
          <Text style={s.settingsBtnText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={
            loading ? (
              <View style={s.typingRow}>
                <View style={s.agentAvatarSmall}><Text style={s.agentAvatarSmallText}>✦</Text></View>
                <View style={s.typingBubble}>
                  <ActivityIndicator color={PURPLE} size="small" />
                </View>
              </View>
            ) : null
          }
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
            placeholder={`Ask ${teebyName}...`}
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => send()}
          />
          <TouchableOpacity style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]} onPress={() => send()} disabled={!draft.trim() || loading}>
            <Text style={s.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const PURPLE = '#7F77DD'
const GREEN = '#1D9E75'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  agentAvatarText: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  agentSub: { fontSize: 11, color: GRAY },
  settingsBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  settingsBtnText: { fontSize: 18 },
  messageList: { padding: 16, gap: 12, flexGrow: 1 },
  quickPromptsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickPrompt: { backgroundColor: '#EEEDFE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  quickPromptText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  agentAvatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  agentAvatarSmallText: { fontSize: 12, color: PURPLE, fontWeight: '700' },
  bubbleCol: { maxWidth: '78%' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe: { backgroundColor: PURPLE, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#E0DED8' },
  bubbleText: { fontSize: 15, lineHeight: 22, color: '#2C2C2A' },
  bubbleTextMe: { color: '#fff' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 4, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  typingBubble: { backgroundColor: '#fff', borderRadius: 18, padding: 12, borderWidth: 0.5, borderColor: '#E0DED8' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
