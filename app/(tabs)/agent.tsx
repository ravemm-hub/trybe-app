import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator,
  Alert, Modal, ScrollView,
} from 'react-native'
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
  type: 'join_group' | 'view_group' | 'view_marketplace' | 'create_group' | 'open_dm' | 'view_profile'
  label: string
  data: any
}

type Memory = {
  facts: string[]
  preferences: Record<string, string>
  name?: string
  personality?: string
}

const QUICK_PROMPTS = [
  '📍 מה קורה סביבי עכשיו?',
  '⚡ מצא לי קבוצות פעילות',
  '🤝 מצא לי אנשים מעניינים',
  '🛍️ מה יש במרקטפלייס?',
  '📋 צור לי רשימה',
  '🌤️ מה מזג האוויר?',
]

async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: 'basic', max_results: 3, include_answer: true }),
    })
    const data = await res.json()
    return data.answer || data.results?.slice(0, 2).map((r: any) => `${r.title}: ${r.content?.slice(0, 200)}`).join('\n') || ''
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

async function getNearbyUsers(lat: number, lon: number) {
  try {
    const { data } = await supabase.rpc('nearby_users', { lat, lon, radius_m: 2000 })
    return data || []
  } catch { return [] }
}

async function getMarketplace() {
  try {
    const { data } = await supabase.from('listings').select('id, title, price, location_name').eq('status', 'active').order('created_at', { ascending: false }).limit(5)
    return data || []
  } catch { return [] }
}

async function updateMemory(userId: string, newFact: string, memory: Memory) {
  const updatedFacts = [...(memory.facts || []), newFact].slice(-20)
  await supabase.from('teeby_memory').upsert({
    user_id: userId,
    facts: updatedFacts,
    preferences: memory.preferences || {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  return { ...memory, facts: updatedFacts }
}

export default function AgentScreen() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [teebyName, setTeebyName] = useState('Teeby')
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; name: string } | null>(null)
  const [memory, setMemory] = useState<Memory>({ facts: [], preferences: {} })
  const [showSettings, setShowSettings] = useState(false)
  const [newTeebyName, setNewTeebyName] = useState('Teeby')
  const [proactiveShown, setProactiveShown] = useState(false)
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

      const { data: mem } = await supabase.from('teeby_memory').select('*').eq('user_id', user.id).single()
      if (mem) setMemory({ facts: mem.facts || [], preferences: mem.preferences || {} })

      const { data: history } = await supabase.from('agent_messages').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(50)
      if (history?.length) {
        setMessages(history as Message[])
        setProactiveShown(true)
      }

      getLocationAndInit(user.id, profile?.display_name || '', !history?.length)
    })
  }, [])

  const getLocationAndInit = async (uid: string, name: string, isFirst: boolean) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = loc.coords
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude })
      const locName = [place?.city, place?.district].filter(Boolean).join(', ')
      setUserLocation({ lat: latitude, lon: longitude, name: locName })
   // Send proactive if last message was more than 3 hours ago
const lastMsg = history?.[history.length - 1]
const lastMsgTime = lastMsg ? new Date(lastMsg.created_at).getTime() : 0
const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000

if (!proactiveShown && lastMsgTime < threeHoursAgo) {
  setProactiveShown(true)
  await sendProactiveWelcome(uid, name, latitude, longitude, locName)
} 
    } catch {}
  }

  const sendProactiveWelcome = async (uid: string, name: string, lat: number, lon: number, locName: string) => {
    await new Promise(r => setTimeout(r, 1500))
    const [groups, users, listings] = await Promise.all([
      getNearbyGroups(lat, lon),
      getNearbyUsers(lat, lon),
      getMarketplace(),
    ])

    const actions: Action[] = []
    let text = `היי${name ? ` ${name}` : ''}! אני ${teebyName}, הסוכן האישי שלך 👋\n\n`

    if (locName) text += `📍 ראיתי שאתה ב**${locName}**\n\n`

    const openGroups = groups.filter((g: any) => g.status === 'open')
    const lobbyGroups = groups.filter((g: any) => g.status === 'lobby')

    if (openGroups.length > 0) {
      text += `⚡ יש ${openGroups.length} קבוצות פעילות עכשיו:\n`
      openGroups.slice(0, 3).forEach((g: any) => {
        text += `• **${g.name}** — ${g.member_count} אנשים${g.location_name ? ` @ ${g.location_name}` : ''}\n`
        actions.push({ type: 'join_group', label: `⚡ ${g.name}`, data: g })
      })
      text += '\n'
    } else if (lobbyGroups.length > 0) {
      text += `🔮 יש ${lobbyGroups.length} קבוצות בלובי שמחכות לאנשים\n\n`
      lobbyGroups.slice(0, 2).forEach((g: any) => {
        actions.push({ type: 'join_group', label: `🔮 ${g.name}`, data: g })
      })
    }

    if (users.length > 0) {
      text += `👥 יש ${users.length} אנשים עם Radar פעיל קרוב אליך\n\n`
    }

    if (listings.length > 0) {
      text += `🛍️ יש ${listings.length} מוצרים חדשים במרקטפלייס\n`
      actions.push({ type: 'view_marketplace', label: '🛍️ ראה מרקטפלייס', data: {} })
    }

    text += '\nאיך אני יכול לעזור?'

    const msg: Message = { id: Date.now().toString(), role: 'assistant', content: text, created_at: new Date().toISOString(), actions }
    setMessages([msg])
    await supabase.from('agent_messages').insert({ user_id: uid, role: 'assistant', content: text })
  }

  const handleAction = (action: Action) => {
    if (action.type === 'join_group' || action.type === 'view_group') {
      const g = action.data
      router.push({ pathname: g.status === 'open' ? '/chat' : '/lobby', params: { id: g.id, name: g.name, members: g.member_count?.toString() || '0' } })
    } else if (action.type === 'view_marketplace') {
      router.push('/(tabs)/marketplace')
    } else if (action.type === 'create_group') {
      router.push('/create')
    } else if (action.type === 'open_dm') {
      router.push({ pathname: '/dm', params: action.data })
    }
  }

  const saveTeebyName = async () => {
    if (!userId || !newTeebyName.trim()) return
    await supabase.from('profiles').update({ teeby_name: newTeebyName.trim() }).eq('id', userId)
    setTeebyName(newTeebyName.trim())
    setShowSettings(false)
    Alert.alert('✓ נשמר', `הסוכן שלך נקרא עכשיו ${newTeebyName}`)
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
      const needsGroups = lower.includes('קבוצ') || lower.includes('group') || lower.includes('סביב') || lower.includes('nearby') || lower.includes('לידי') || lower.includes('מה קורה')
      const needsWeb = lower.includes('מזג') || lower.includes('weather') || lower.includes('חדשות') || lower.includes('news') || lower.includes('מחיר') || lower.includes('price') || lower.includes('היום') || lower.includes('עכשיו')
      const needsMarket = lower.includes('מרקט') || lower.includes('קנ') || lower.includes('מכיר') || lower.includes('market') || lower.includes('מוצר')
      const needsMatch = lower.includes('הכר') || lower.includes('חבר') || lower.includes('אנשים') || lower.includes('meet') || lower.includes('people')

      let context = ''
      const actions: Action[] = []

      if (needsGroups) {
        const groups = userLocation ? await getNearbyGroups(userLocation.lat, userLocation.lon) : await getNearbyGroups(32.08, 34.78)
        if (groups.length) {
          context += `\nקבוצות זמינות:\n${groups.map((g: any) => `- ${g.name} (${g.member_count} אנשים, ${g.status === 'open' ? 'פעיל' : 'לובי'}${g.location_name ? `, ${g.location_name}` : ''})`).join('\n')}`
          groups.slice(0, 3).forEach((g: any) => actions.push({ type: 'join_group', label: `⚡ ${g.name}`, data: g }))
        } else {
          actions.push({ type: 'create_group', label: '⚡ הקם קבוצה חדשה', data: {} })
        }
      }

      if (needsMarket) {
        const listings = await getMarketplace()
        if (listings.length) {
          context += `\nמוצרים במרקטפלייס:\n${listings.map((l: any) => `- ${l.title}: ₪${l.price}${l.location_name ? ` (${l.location_name})` : ''}`).join('\n')}`
          actions.push({ type: 'view_marketplace', label: '🛍️ פתח מרקטפלייס', data: {} })
        }
      }

      if (needsMatch && userLocation) {
        const users = await getNearbyUsers(userLocation.lat, userLocation.lon)
        if (users.length) context += `\nאנשים קרובים עם Radar פעיל: ${users.length} אנשים`
      }

      if (needsWeb) {
        const result = await searchWeb(msg)
        if (result) context += `\nתוצאת חיפוש: ${result}`
      }

      const memoryContext = memory.facts.length > 0 ? `\nמה שאני זוכר עליך:\n${memory.facts.slice(-10).join('\n')}` : ''

      const history = [...messages, userMsg].slice(-15).map(m => ({ role: m.role, content: m.content }))

      const systemPrompt = `אתה ${teebyName}, הסוכן האישי של ${userName || 'היוזר'} באפליקציית Tryber — רשת חברתית מבוססת AI.

The Next Generation of SocialAIsing.

${memoryContext}
${userLocation ? `מיקום היוזר: ${userLocation.name}` : ''}
${context ? `\nמידע בזמן אמת:${context}` : ''}

תפקידך:
- להיות חבר חכם שמכיר את האפליקציה לעומק
- לייזום שיחות, לחבר אנשים, למצוא הזדמנויות
- לזכור כל מה שהיוזר מספר לך
- להציע פעולות ספציפיות — לא רק המלצות
- לפעול בשם היוזר כשמתאים
- כשמכווין לקבוצה — לתאר מה קורה בפנים

כשמשתמש מספר משהו אישי (תחביבים, עבודה, מיקום, העדפות) — זכור את זה.

ענה בעברית (אלא אם כתבו אנגלית). היה קצר, חם, ויזום. מקסימום 4-5 משפטים.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: systemPrompt, messages: history }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'מצטער, נסה שוב.'

      // Extract and save memory
      if (msg.length > 20) {
        const factRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 60,
            messages: [{ role: 'user', content: `Extract ONE key personal fact from this message (or return "none"): "${msg}". Format: short fact about the user. Examples: "אוהב מוזיקת ג'אז", "גר בתל אביב", "מחפש דירה". Reply in Hebrew or "none".` }]
          }),
        })
        const factData = await factRes.json()
        const fact = factData.content?.[0]?.text?.trim()
        if (fact && fact !== 'none' && fact.length < 50) {
          const updatedMem = await updateMemory(userId, fact, memory)
          setMemory(updatedMem)
        }
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        created_at: new Date().toISOString(),
        actions: actions.length > 0 ? actions : undefined,
      }
      setMessages(prev => [...prev, assistantMsg])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
      await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply })
    } catch {
      Alert.alert('שגיאה', 'לא ניתן להתחבר ל-Teeby. בדוק חיבור לאינטרנט.')
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = async () => {
    if (!userId) return
    Alert.alert('נקה היסטוריה', 'למחוק את כל השיחה? הזיכרון של Teeby ישמר.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק', style: 'destructive', onPress: async () => {
        await supabase.from('agent_messages').delete().eq('user_id', userId)
        setMessages([])
        setProactiveShown(false)
        if (userLocation) sendProactiveWelcome(userId, userName, userLocation.lat, userLocation.lon, userLocation.name)
      }}
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity style={s.headerLeft} onPress={() => setShowSettings(true)}>
          <View style={s.headerAvatar}><Text style={s.headerAvatarText}>✦</Text></View>
          <View>
            <View style={s.headerNameRow}>
              <Text style={s.headerName}>{teebyName}</Text>
              <Text style={s.headerEdit}>✏️</Text>
            </View>
            <Text style={s.headerSub}>{userLocation?.name || 'מאתר מיקום...'} · פעיל</Text>
          </View>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {memory.facts.length > 0 && (
            <View style={s.memoryBadge}>
              <Text style={s.memoryBadgeText}>🧠 {memory.facts.length}</Text>
            </View>
          )}
          <TouchableOpacity onPress={clearHistory}>
            <Text style={s.clearBtn}>נקה</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <SafeAreaView style={s.settingsModal}>
          <View style={s.settingsHeader}>
            <TouchableOpacity onPress={() => setShowSettings(false)}><Text style={s.settingsCancel}>ביטול</Text></TouchableOpacity>
            <Text style={s.settingsTitle}>הגדרות {teebyName}</Text>
            <TouchableOpacity onPress={saveTeebyName}><Text style={s.settingsSave}>שמור</Text></TouchableOpacity>
          </View>
          <ScrollView style={s.settingsBody}>
            <Text style={s.settingsLabel}>שם הסוכן שלך</Text>
            <TextInput style={s.settingsInput} value={newTeebyName} onChangeText={setNewTeebyName} placeholder="Teeby" maxLength={20} />
            <Text style={s.settingsHint}>כך הסוכן יופיע בכל מקום באפליקציה</Text>

            {memory.facts.length > 0 && (
              <>
                <Text style={s.settingsLabel}>מה {teebyName} זוכר עליך ({memory.facts.length})</Text>
                {memory.facts.map((fact, i) => (
                  <View key={i} style={s.factRow}>
                    <Text style={s.factEmoji}>🧠</Text>
                    <Text style={s.factText}>{fact}</Text>
                  </View>
                ))}
                <TouchableOpacity style={s.clearMemoryBtn} onPress={async () => {
                  if (!userId) return
                  await supabase.from('teeby_memory').update({ facts: [] }).eq('user_id', userId)
                  setMemory({ facts: [], preferences: {} })
                  Alert.alert('✓', 'הזיכרון נמחק')
                }}>
                  <Text style={s.clearMemoryBtnText}>🗑️ מחק זיכרון</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
              <Text style={s.emptyTitle}>{teebyName} — הסוכן שלך</Text>
              <Text style={s.emptySub}>מאתר מיקום ומחפש מה קורה סביבך...</Text>
              <ActivityIndicator color={PURPLE} style={{ marginTop: 20 }} />
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.role === 'user'
            return (
              <View style={s.msgGroup}>
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
              </View>
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
          <View style={s.quickPromptsBar}>
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
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`שאל את ${teebyName}...`}
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={1000}
          />
          <TouchableOpacity style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]} onPress={() => send()} disabled={!draft.trim() || loading}>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  headerAvatarText: { fontSize: 16, color: PURPLE, fontWeight: '700' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerName: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  headerEdit: { fontSize: 12 },
  headerSub: { fontSize: 11, color: GRAY },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memoryBadge: { backgroundColor: '#EEEDFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  memoryBadgeText: { fontSize: 11, color: PURPLE, fontWeight: '600' },
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
  clearMemoryBtn: { marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: '#FFF0EB', alignItems: 'center' },
  clearMemoryBtnText: { fontSize: 14, color: '#E24B4A', fontWeight: '600' },
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 52, color: PURPLE, marginBottom: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
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
  quickPromptsBar: { borderTopWidth: 0.5, borderColor: '#E0DED8' },
  quickPrompt: { backgroundColor: '#EEEDFE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  quickPromptText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
