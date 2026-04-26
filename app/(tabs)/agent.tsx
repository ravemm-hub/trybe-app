import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
  Alert, Modal, ScrollView, Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_KEY || ''

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  actions?: Action[]
}

type Action = {
  type: 'join_group' | 'view_marketplace' | 'create_group' | 'open_dm'
  label: string
  data: any
}

const QUICK_PROMPTS = [
 
  '📬 סכם מה פספסתי בקבוצות',
  '📍 מה קורה סביבי עכשיו?',
  '⚡ מצא לי קבוצות פעילות',
  '🛍️ מה יש במרקטפלייס?',
  '📋 צור לי רשימה',
]

async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: 'basic', max_results: 3, include_answer: true }),
    })
    const data = await res.json()
    return data.answer || ''
  } catch { return '' }
}

async function getNearbyGroups(lat: number, lon: number) {
  try {
    const { data } = await supabase.rpc('nearby_groups', { lat, lon, radius_m: 10000 })
    if (data?.length) return data
    const { data: all } = await supabase.from('groups').select('*').neq('status', 'archived').order('member_count', { ascending: false }).limit(5)
    return all || []
  } catch { return [] }
}

async function getMarketplace() {
  try {
    const { data } = await supabase.from('listings').select('id, title, price, location_name').eq('status', 'active').order('created_at', { ascending: false }).limit(5)
    return data || []
  } catch { return [] }
}

async function updateMemory(userId: string, newFact: string, currentFacts: string[]) {
  const updatedFacts = [...currentFacts, newFact].slice(-20)
  await supabase.from('teeby_memory').upsert({
    user_id: userId, facts: updatedFacts, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  return updatedFacts
}

export default function AgentScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [teebyName, setTeebyName] = useState('Teeby')
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; name: string } | null>(null)
  const [memoryFacts, setMemoryFacts] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [newTeebyName, setNewTeebyName] = useState('Teeby')
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data: profile } = await supabase.from('profiles').select('display_name, username, teeby_name').eq('id', user.id).single()
      if (profile) {
        setUserName(profile.display_name || profile.username || '')
        setTeebyName(profile.teeby_name || 'Teeby')
        setNewTeebyName(profile.teeby_name || 'Teeby')
      }
      const { data: mem } = await supabase.from('teeby_memory').select('facts').eq('user_id', user.id).single()
      if (mem?.facts) setMemoryFacts(mem.facts)
       const { data: history } = await supabase.from('agent_messages').select('*').eq('user_id', user.id).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()).order('created_at', { ascending: true }).limit(50)
      if (history?.length) {
        setMessages(history as Message[])
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200)
      }
      getLocation(user.id, profile?.display_name || '', history?.length || 0)
    })
  }, [])

  const getLocation = async (uid: string, name: string, historyLen: number) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = loc.coords
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude })
      const locName = [place?.city, place?.district].filter(Boolean).join(', ')
      setUserLocation({ lat: latitude, lon: longitude, name: locName })

      // Check last message time — send proactive if >3 hours or first time
      const { data: lastMsg } = await supabase.from('agent_messages').select('created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)
      const lastTime = lastMsg?.[0] ? new Date(lastMsg[0].created_at).getTime() : 0
    const oneHourAgo = Date.now() - 60 * 60 * 1000
if (lastTime < oneHourAgo) {
  await sendProactive(uid, name, latitude, longitude, locName)
} 
    } catch {}
  }

  const sendProactive = async (uid: string, name: string, lat: number, lon: number, locName: string) => {
    await new Promise(r => setTimeout(r, 1500))
    const [groups, listings] = await Promise.all([getNearbyGroups(lat, lon), getMarketplace()])
    const actions: Action[] = []
    let text = `Hey${name ? ` ${name}` : ''}! 👋 I'm ${teebyName}, your personal agent.\n\n`
    if (locName) text += `📍 I see you're in **${locName}**\n\n`
    const openGroups = groups.filter((g: any) => g.status === 'open')
    if (openGroups.length > 0) {
      text += `⚡ ${openGroups.length} active groups right now:\n`
      openGroups.slice(0, 3).forEach((g: any) => {
        text += `• **${g.name}** — ${g.member_count} people${g.location_name ? ` @ ${g.location_name}` : ''}\n`
        actions.push({ type: 'join_group', label: `⚡ ${g.name}`, data: g })
      })
      text += '\n'
    } else {
      text += `No active groups nearby yet — want to start one?\n\n`
      actions.push({ type: 'create_group', label: '⚡ Create a Trybe', data: {} })
    }
    if (listings.length > 0) {
      text += `🛍️ ${listings.length} new listings in the marketplace`
      actions.push({ type: 'view_marketplace', label: '🛍️ Open Marketplace', data: {} })
    }
    text += '\n\nHow can I help?'
    const msg: Message = { id: Date.now().toString(), role: 'assistant', content: text, created_at: new Date().toISOString(), actions }
    setMessages(prev => [...prev, msg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200)
    await supabase.from('agent_messages').insert({ user_id: uid, role: 'assistant', content: text })
  }

  const handleAction = (action: Action) => {
    if (action.type === 'join_group') {
      const g = action.data
      router.push({ pathname: g.status === 'open' ? '/chat' : '/lobby', params: { id: g.id, name: g.name, members: g.member_count?.toString() || '0' } })
    } else if (action.type === 'view_marketplace') {
      router.push('/(tabs)/marketplace')
    } else if (action.type === 'create_group') {
      router.push('/create')
    }
  }

  const deleteMessage = async (msgId: string) => {
    await supabase.from('agent_messages').delete().eq('id', msgId)
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }

  const saveTeebyName = async () => {
    if (!userId || !newTeebyName.trim()) return
    await supabase.from('profiles').update({ teeby_name: newTeebyName.trim() }).eq('id', userId)
    setTeebyName(newTeebyName.trim())
    setShowSettings(false)
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
     const needsSummary = lower.includes('פספסתי') || lower.includes('missed') || lower.includes('סכם') || lower.includes('summary') || lower.includes('unread')
if (needsSummary && userId) {
  const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at, groups(name)').eq('user_id', userId)
  if (myGroups?.length) {
    let summaryContext = 'Unread messages summary:\n'
    for (const m of myGroups) {
      if (!m.last_read_at) continue
      const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', m.group_id).neq('user_id', userId).gt('created_at', m.last_read_at).limit(5)
      if (msgs?.length) {
        summaryContext += `\n${(m as any).groups?.name}: ${msgs.map((msg: any) => msg.content).join(' | ')}`
      }
    }
    context += summaryContext
  }
}
 const needsGroups = lower.includes('group') || lower.includes('קבוצ') || lower.includes('near') || lower.includes('סביב') || lower.includes('happening')
      const needsWeb = lower.includes('weather') || lower.includes('מזג') || lower.includes('news') || lower.includes('חדשות') || lower.includes('today') || lower.includes('היום')
      const needsMarket = lower.includes('market') || lower.includes('מרקט') || lower.includes('buy') || lower.includes('sell')
      let context = ''
      const actions: Action[] = []
      if (needsGroups) {
        const groups = userLocation ? await getNearbyGroups(userLocation.lat, userLocation.lon) : await getNearbyGroups(32.08, 34.78)
        if (groups.length) {
          context += `\nAvailable groups:\n${groups.map((g: any) => `- ${g.name} (${g.member_count} people, ${g.status}${g.location_name ? `, ${g.location_name}` : ''})`).join('\n')}`
          groups.slice(0, 3).forEach((g: any) => actions.push({ type: 'join_group', label: `⚡ ${g.name}`, data: g }))
        } else {
          actions.push({ type: 'create_group', label: '⚡ Create group', data: {} })
        }
      }
      if (needsMarket) {
        const listings = await getMarketplace()
        if (listings.length) {
          context += `\nMarketplace: ${listings.map((l: any) => `${l.title}: ₪${l.price}`).join(', ')}`
          actions.push({ type: 'view_marketplace', label: '🛍️ Open Marketplace', data: {} })
        }
      }
      if (needsWeb) {
        const result = await searchWeb(msg)
        if (result) context += `\nWeb: ${result}`
      }
      const memCtx = memoryFacts.length > 0 ? `\nWhat I remember about you:\n${memoryFacts.slice(-8).join('\n')}` : ''
      const history = [...messages, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: `You are ${teebyName}, the personal AI agent for ${userName || 'the user'} on Tryber — The Next Generation of SocialAIsing.
${memCtx}
${userLocation ? `User location: ${userLocation.name}` : ''}
${context ? `\nReal-time data:${context}` : ''}
Be proactive, warm, and concise (max 4 sentences). Suggest actions. Reply in same language as user.`,
          messages: history,
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'Sorry, try again.'
      if (msg.length > 20) {
        const factRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 50,
            messages: [{ role: 'user', content: `Extract one personal fact from: "${msg}". Return just the fact or "none". Example: "likes jazz music". Keep it very short.` }]
          }),
        })
        const factData = await factRes.json()
        const fact = factData.content?.[0]?.text?.trim()
        if (fact && fact !== 'none' && fact.length < 60) {
          const updated = await updateMemory(userId, fact, memoryFacts)
          setMemoryFacts(updated)
        }
      }
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: reply, created_at: new Date().toISOString(), actions: actions.length > 0 ? actions : undefined }
      setMessages(prev => [...prev, assistantMsg])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
      await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply })
    } catch { Alert.alert('Error', 'Could not reach Teeby.') }
    finally { setLoading(false) }
  }

  const clearHistory = async () => {
    if (!userId) return
    Alert.alert('Clear history', 'Delete all messages? Memory is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await supabase.from('agent_messages').delete().eq('user_id', userId)
        setMessages([])
      }}
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity style={s.headerLeft} onPress={() => setShowSettings(true)}>
          <View style={s.headerAvatar}><Text style={s.headerAvatarText}>✦</Text></View>
          <View>
            <View style={s.headerNameRow}>
              <Text style={s.headerName}>{teebyName}</Text>
              <Text style={{ fontSize: 11 }}>✏️</Text>
            </View>
            <Text style={s.headerSub}>{userLocation?.name || 'Locating...'} · Active</Text>
          </View>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {memoryFacts.length > 0 && (
            <View style={s.memBadge}><Text style={s.memBadgeText}>🧠 {memoryFacts.length}</Text></View>
          )}
          <TouchableOpacity onPress={clearHistory}>
            <Text style={s.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <View style={[s.settingsModal, { paddingTop: insets.top }]}>
          <View style={s.settingsHeader}>
            <TouchableOpacity onPress={() => setShowSettings(false)}><Text style={s.settingsCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.settingsTitle}>Agent Settings</Text>
            <TouchableOpacity onPress={saveTeebyName}><Text style={s.settingsSave}>Save</Text></TouchableOpacity>
          </View>
          <ScrollView style={s.settingsBody}>
            <Text style={s.settingsLabel}>AGENT NAME</Text>
            <TextInput style={s.settingsInput} value={newTeebyName} onChangeText={setNewTeebyName} placeholder="Teeby" maxLength={20} />
            <Text style={s.settingsHint}>This is how your agent appears everywhere in the app</Text>
            {memoryFacts.length > 0 && (
              <>
                <Text style={s.settingsLabel}>WHAT {teebyName.toUpperCase()} REMEMBERS ({memoryFacts.length})</Text>
                {memoryFacts.map((fact, i) => (
                  <View key={i} style={s.factRow}>
                    <Text style={s.factEmoji}>🧠</Text>
                    <Text style={s.factText}>{fact}</Text>
                  </View>
                ))}
                <TouchableOpacity style={s.clearMemBtn} onPress={async () => {
                  if (!userId) return
                  await supabase.from('teeby_memory').update({ facts: [] }).eq('user_id', userId)
                  setMemoryFacts([])
                  setShowSettings(false)
                }}>
                  <Text style={s.clearMemBtnText}>🗑️ Clear memory</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={[s.list, messages.length === 0 && s.listEmpty]}
          
          
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>✦</Text>
              <Text style={s.emptyTitle}>{teebyName} — Your Agent</Text>
              <Text style={s.emptySub}>Scanning what's around you...</Text>
              <ActivityIndicator color={PURPLE} style={{ marginTop: 20 }} />
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.role === 'user'
            return (
              <Pressable
                onLongPress={() => {
                  Alert.alert('Message', '', [
                    { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(item.id) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }}
                style={s.msgGroup}
              >
                <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  {!isMe && <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>}
                  <View style={s.bubbleCol}>
                    <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleAgent]}>
                      <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextAgent]}>{item.content}</Text>
                    </View>
                    <Text style={[s.timeText, isMe && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                  </View>
                </View>
                {!isMe && item.actions && item.actions.length > 0 && (
                  <View style={s.actionsRow}>
                    {item.actions.map((action, i) => (
                      <TouchableOpacity key={i} style={s.actionBtn} onPress={() => handleAction(action)}>
                        <Text style={s.actionBtnText}>{action.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Pressable>
            )
          }}
        />

        {loading && (
          <View style={s.typingRow}>
            <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>
            <View style={[s.bubble, s.bubbleAgent, { paddingVertical: 12 }]}>
              <Text style={{ fontSize: 16, color: PURPLE, letterSpacing: 4 }}>• • •</Text>
            </View>
          </View>
        )}

        {messages.length <= 1 && (
          <FlatList
            data={QUICK_PROMPTS}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
            keyExtractor={p => p}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.quickPrompt} onPress={() => send(item)}>
                <Text style={s.quickPromptText}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Ask ${teebyName}...`}
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={1000}
          />
          <TouchableOpacity style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]} onPress={() => send()} disabled={!draft.trim() || loading}>
            <Text style={s.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  headerAvatarText: { fontSize: 16, color: PURPLE, fontWeight: '700' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerName: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  headerSub: { fontSize: 11, color: GRAY },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memBadge: { backgroundColor: '#EEEDFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  memBadgeText: { fontSize: 11, color: PURPLE, fontWeight: '600' },
  clearBtn: { fontSize: 14, color: GRAY },
  settingsModal: { flex: 1, backgroundColor: '#fff' },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  settingsCancel: { fontSize: 16, color: GRAY },
  settingsTitle: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  settingsSave: { fontSize: 16, fontWeight: '700', color: GREEN },
  settingsBody: { padding: 20 },
  settingsLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 20 },
  settingsInput: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  settingsHint: { fontSize: 12, color: GRAY, marginTop: 6 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F1EFE8', borderRadius: 10, padding: 10, marginBottom: 6 },
  factEmoji: { fontSize: 16 },
  factText: { fontSize: 14, color: '#2C2C2A', flex: 1 },
  clearMemBtn: { marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: '#FFF0EB', alignItems: 'center' },
  clearMemBtnText: { fontSize: 14, color: '#E24B4A', fontWeight: '600' },
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 52, color: PURPLE, marginBottom: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY },
  msgGroup: { gap: 8 },
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
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginLeft: 38 },
  actionBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: PURPLE },
  actionBtnText: { fontSize: 13, color: PURPLE, fontWeight: '600' },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  quickPrompt: { backgroundColor: '#EEEDFE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  quickPromptText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
