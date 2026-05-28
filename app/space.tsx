import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { askClaude } from '../src/lib/claude'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../src/constants'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }

export default function SpaceScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const spaceId = params?.id || ''
  const title = params?.title || 'Space'
  const emoji = params?.emoji || '✦'
  const listRef = useRef<FlatList>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!spaceId) { router.back(); return }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      loadMessages()
    })
  }, [])

  const loadMessages = async () => {
    try {
      const { data } = await supabase.from('teeby_space_messages')
        .select('*').eq('space_id', spaceId).order('created_at', { ascending: true }).limit(100)
      if (data) setMessages(data as Msg[])
    } catch {}
    setLoading(false)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }

  const send = useCallback(async () => {
    if (!draft.trim() || sending || !userId) return
    const text = draft.trim()
    setDraft('')
    const tempMsg: Msg = { id: 'temp_' + Date.now(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tempMsg])
    setSending(true)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    try {
      const { data: saved } = await supabase.from('teeby_space_messages')
        .insert({ space_id: spaceId, role: 'user', content: text }).select().single()
      if (saved) setMessages(prev => prev.map(m => m.id === tempMsg.id ? saved : m))

      const history = messages.slice(-10).map(m => m.role + ': ' + m.content).join('\n')
      const system = 'You are Teeby, a focused personal AI assistant inside a private Tryber "Space" dedicated to one topic: "' + title + '".\n'
        + 'Stay on this topic. Be warm, proactive and concise (2-4 sentences). Use emojis naturally. Always respond in the SAME language the user writes in.'
      const prompt = (history ? history + '\n' : '') + 'user: ' + text
      const reply = await askClaude(prompt, system, 400, true)
      if (!reply) throw new Error('No reply')
      const { data: savedReply } = await supabase.from('teeby_space_messages')
        .insert({ space_id: spaceId, role: 'assistant', content: reply }).select().single()
      if (savedReply) setMessages(prev => [...prev, savedReply])
    } catch {
      setMessages(prev => [...prev, { id: 'err_' + Date.now(), role: 'assistant', content: 'Connection error. Try again! 🔄', created_at: new Date().toISOString() }])
    } finally {
      setSending(false)
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [draft, sending, userId, messages, spaceId, title])

  const fmt = (ts: string) => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <View style={s.avatar}><Text style={s.avatarText}>{emoji}</Text></View>
        <View style={s.hInfo}>
          <Text style={s.hName} numberOfLines={1}>{title}</Text>
          <View style={s.liveRow}><View style={s.liveDot} /><Text style={s.liveTxt}>Teeby Space</Text></View>
        </View>
      </View>

      {loading
        ? <ActivityIndicator color={PRIMARY} style={{ flex: 1 }} />
        : <FlatList ref={listRef} data={messages} keyExtractor={m => m.id}
            contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>{emoji}</Text>
                <Text style={s.emptyTitle}>{title}</Text>
                <Text style={s.emptySub}>Ask Teeby anything about this topic ✦</Text>
              </View>
            }
            renderItem={({ item: m }) => (
              <View style={[s.msgWrap, m.role === 'user' && s.msgWrapMe]}>
                {m.role === 'assistant' && <View style={s.smallAvatar}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>}
                <View style={[s.bubble, m.role === 'user' ? s.bubbleMe : s.bubbleBot]}>
                  <Text style={[s.bubbleText, m.role === 'user' && s.bubbleTextMe]}>{m.content}</Text>
                  <Text style={[s.bubbleTime, m.role === 'user' && s.bubbleTimeMe]}>{fmt(m.created_at)}</Text>
                </View>
              </View>
            )}
            ListFooterComponent={sending ? (
              <View style={s.msgWrap}>
                <View style={s.smallAvatar}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
                <View style={[s.bubble, s.bubbleBot, { paddingVertical: 14 }]}>
                  <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
                </View>
              </View>
            ) : null}
          />
      }

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}>
        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Message Teeby..." placeholderTextColor={GRAY} multiline returnKeyType="send" onSubmitEditing={send} editable={!sending} />
          <TouchableOpacity style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnOff]} onPress={send} disabled={!draft.trim() || sending}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendBtnText}>↑</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: PRIMARY },
  avatarText: { fontSize: 18 },
  hInfo: { flex: 1 },
  hName: { fontSize: 16, fontWeight: '700', color: TEXT },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE },
  liveTxt: { fontSize: 11, color: LIVE, fontWeight: '500' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 48, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
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
})
