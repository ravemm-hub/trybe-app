import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native'
import { supabase } from '../../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
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
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .single()
      if (profile) setUserName(profile.display_name || profile.username || '')
      loadHistory(user.id)
    })
  }, [])

  const loadHistory = async (uid: string) => {
    const { data } = await supabase
      .from('agent_messages')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })
      .limit(50)
    if (data) setMessages(data as Message[])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }

  const send = async () => {
    if (!draft.trim() || !userId || loading) return
    const text = draft.trim()
    setDraft('')
    setLoading(true)

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

    await supabase.from('agent_messages').insert({
      user_id: userId, role: 'user', content: text,
    })

    try {
      const history = [...messages, userMsg].slice(-20).map(m => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: `You are a personal AI assistant for ${userName} on the Tryber app — a location-based social network. You help with reminders, lists, questions, and anything they need. Be warm, concise, and helpful. Reply in the same language as the user (Hebrew or English). You can remember context from this conversation.`,
          messages: history,
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'Sorry, something went wrong.'

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, assistantMsg])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

      await supabase.from('agent_messages').insert({
        user_id: userId, role: 'assistant', content: reply,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.headerAvatar}>
          <Text style={s.headerAvatarText}>✦</Text>
        </View>
        <View style={s.headerInfo}>
          <Text style={s.headerName}>My Agent</Text>
          <Text style={s.headerSub}>Powered by Claude · Always available</Text>
        </View>
        <View style={s.onlineDot} />
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
              <Text style={s.emptyTitle}>Your personal agent</Text>
              <Text style={s.emptySub}>Ask me anything — reminders, recommendations, lists, questions. I remember our conversations.</Text>
              <View style={s.suggestions}>
                {['Remind me to call mom tomorrow', 'What should I do in Tel Aviv tonight?', 'Make a shopping list'].map(s2 => (
                  <TouchableOpacity key={s2} style={s.suggestion} onPress={() => setDraft(s2)}>
                    <Text style={s.suggestionText}>{s2}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.role === 'user'
            return (
              <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                {!isMe && (
                  <View style={s.agentAvatar}>
                    <Text style={s.agentAvatarText}>✦</Text>
                  </View>
                )}
                <View style={s.bubbleCol}>
                  <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleAgent]}>
                    <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextAgent]}>
                      {item.content}
                    </Text>
                  </View>
                  <Text style={[s.timeText, isMe && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                </View>
              </View>
            )
          }}
        />

        {loading && (
          <View style={s.typingRow}>
            <View style={s.agentAvatar}>
              <Text style={s.agentAvatarText}>✦</Text>
            </View>
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
            placeholder="Ask your agent anything..."
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={1000}
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnOff]}
            onPress={send}
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', gap: 12 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  headerAvatarText: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  headerSub: { fontSize: 11, color: GRAY },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 56, color: PURPLE, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  suggestions: { gap: 8, width: '100%' },
  suggestion: { backgroundColor: '#EEEDFE', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  suggestionText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  agentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PURPLE },
  agentAvatarText: { fontSize: 14, color: PURPLE, fontWeight: '700' },
  bubbleCol: { maxWidth: '80%' },
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
