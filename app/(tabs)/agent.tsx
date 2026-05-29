import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { supabase } from '../../src/lib/supabase'
import { askClaude } from '../../src/lib/claude'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../../src/constants'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }

export default function AgentScreen() {
  const insets = useSafeAreaInsets()
  const listRef = useRef<FlatList>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [credits, setCredits] = useState(20)
  const [locationCtx, setLocationCtx] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: p } = await supabase.from('profiles').select('display_name, teeby_credits, teeby_credits_reset_at').eq('id', user.id).single()
    if (p) {
      setUserName(p.display_name || '')
      // Reset daily credits at the start of a new local day, tracked server-side (cross-device).
      const today = new Date().toDateString()
      const lastReset = p.teeby_credits_reset_at ? new Date(p.teeby_credits_reset_at).toDateString() : null
      let creditsVal = p.teeby_credits ?? 20
      if (lastReset !== today) {
        creditsVal = 20
        await supabase.from('profiles').update({ teeby_credits: 20, teeby_credits_reset_at: new Date().toISOString() }).eq('id', user.id)
      }
      setCredits(creditsVal)
    }
    const { data: msgs } = await supabase.from('agent_messages').select('*').eq('user_id', user.id).order('created_at', { ascending: true }).limit(60)
    if (msgs) setMessages(msgs)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
        const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        if (place) setLocationCtx([place.city, place.country].filter(Boolean).join(', '))
      }
    } catch {}
  }

  const send = useCallback(async () => {
    if (!draft.trim() || loading || !userId || credits <= 0) return
    const text = draft.trim()
    setDraft('')
    const tempMsg: Msg = { id: 'temp_' + Date.now(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tempMsg])
    setLoading(true)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    try {
      const { data: saved } = await supabase.from('agent_messages').insert({ user_id: userId, role: 'user', content: text }).select().single()
      if (saved) setMessages(prev => prev.map(m => m.id === tempMsg.id ? saved : m))
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      history.push({ role: 'user', content: text })
      const system = 'You are Teeby, a highly intelligent personal AI in the Tryber social app.\nUser: ' + userName + ' | Location: ' + (locationCtx || 'Israel') + ' | Credits: ' + credits + '/20\nYou can search the web for current info, prices, news, places, images or links — include helpful links when relevant.\nAlways respond in the SAME language the user writes in.\nBe warm, proactive, witty. 2-4 sentences max. Use emojis naturally.\nFor calendar: respond with [CAL:title|YYYY-MM-DDTHH:MM:SS]\nFor creating group: respond with [CREATE_GROUP:name]'
      const reply = await askClaude(history.map(m => m.role + ': ' + m.content).join('\n'), system, 400, true)
      if (!reply) throw new Error('No reply')
      const { data: savedReply } = await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: reply }).select().single()
      if (savedReply) setMessages(prev => [...prev, savedReply])
      const newCredits = credits - 1
      setCredits(newCredits)
      await supabase.from('profiles').update({ teeby_credits: newCredits }).eq('id', userId)
    } catch {
      setMessages(prev => [...prev, { id: 'err_' + Date.now(), role: 'assistant', content: 'Connection error. Try again! 🔄', created_at: new Date().toISOString() }])
    } finally {
      setLoading(false)
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [draft, loading, userId, credits, messages, userName, locationCtx])

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.agentInfo}>
          <View style={s.avatar}><Text style={s.avatarText}>✦</Text></View>
          <View>
            <Text style={s.agentName}>Teeby</Text>
            <View style={s.liveRow}><View style={s.liveDot} /><Text style={s.liveTxt}>Online</Text></View>
          </View>
        </View>
        <View style={s.creditsBadge}><Text style={s.creditsText}>{credits}/20 ✦</Text></View>
      </View>

      <FlatList ref={listRef} data={messages} keyExtractor={m => m.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) => (
          <View style={[s.msgWrap, m.role === 'user' && s.msgWrapMe]}>
            {m.role === 'assistant' && <View style={s.smallAvatar}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>}
            <View style={[s.bubble, m.role === 'user' ? s.bubbleMe : s.bubbleBot]}>
              <Text style={[s.bubbleText, m.role === 'user' && s.bubbleTextMe]}>{m.content}</Text>
              <Text style={[s.bubbleTime, m.role === 'user' && s.bubbleTimeMe]}>{fmt(m.created_at)}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={loading ? (
          <View style={s.msgWrap}>
            <View style={s.smallAvatar}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
            <View style={[s.bubble, s.bubbleBot, { paddingVertical: 14 }]}>
              <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
            </View>
          </View>
        ) : null}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}>
        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {credits <= 0
            ? <View style={s.noCredits}><Text style={s.noCreditsText}>✦ Daily credits used. Resets at midnight.</Text></View>
            : <>
                <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Ask Teeby anything..." placeholderTextColor={GRAY} multiline returnKeyType="send" onSubmitEditing={send} editable={!loading} />
                <TouchableOpacity style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]} onPress={send} disabled={!draft.trim() || loading}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendBtnText}>↑</Text>}
                </TouchableOpacity>
              </>
          }
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  agentInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY },
  avatarText: { fontSize: 18, color: PRIMARY, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: TEXT },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE },
  liveTxt: { fontSize: 11, color: LIVE, fontWeight: '500' },
  creditsBadge: { backgroundColor: '#EEF0FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  creditsText: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  msgWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 12 },
  msgWrapMe: { flexDirection: 'row-reverse' },
  smallAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PRIMARY },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: { backgroundColor: CARD, borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: BORDER },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: TEXT },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: GRAY, marginTop: 4, textAlign: 'right' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.6)' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, maxHeight: 100, borderWidth: 1, borderColor: BORDER },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  noCredits: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  noCreditsText: { fontSize: 13, color: GRAY },
})
