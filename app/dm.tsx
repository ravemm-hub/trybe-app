import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

const AGENT_IDS = [
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000002',
  'a1000001-0000-0000-0000-000000000003',
  'a1000001-0000-0000-0000-000000000019',
  'a1000001-0000-0000-0000-000000000020',
  'a1000001-0000-0000-0000-000000000026',
  'a1000001-0000-0000-0000-000000000029',
]

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''

type DmMessage = {
  id: string
  sender_id: string
  receiver_id?: string
  content: string
  created_at: string
  sender_mode: string
}

export default function DMScreen() {
  const { userId: otherUserId, userName, myMode, myAvatar, isAgent } = useLocalSearchParams<{
    userId: string; userName: string; myMode: string; myAvatar: string; isAgent: string
  }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [myId, setMyId] = useState<string | null>(null)
  const [agentTyping, setAgentTyping] = useState(false)
  const listRef = useRef<FlatList>(null)
  const talkingToAgent = isAgent === '1' || AGENT_IDS.includes(otherUserId || '')

  const loadMessages = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)
    const { data } = await supabase
      .from('dm_messages').select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true }).limit(100)
    if (data) setMessages(data as DmMessage[])
    setLoading(false)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }, [otherUserId])

  useEffect(() => { loadMessages() }, [loadMessages])

  useEffect(() => {
    if (!myId) return
    const channel = supabase.channel(`dm:${myId}:${otherUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, (payload) => {
        const msg = payload.new as DmMessage
        if ((msg.sender_id === myId && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === myId)) {
          setMessages(prev => [...prev, msg])
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [myId, otherUserId])

  const getAgentReply = async (userMessage: string) => {
    setAgentTyping(true)
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000))
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 150,
          messages: [{ role: 'user', content: `You are ${userName}, a friendly AI agent in the Tryber social app. Someone sent you: "${userMessage}". Reply naturally in the same language (Hebrew or English). Max 2 sentences. Be warm and engaging.` }],
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text?.trim()
      if (reply && myId) {
        await supabase.from('dm_messages').insert({
          sender_id: otherUserId, receiver_id: myId, content: reply, sender_mode: 'lit', receiver_mode: myMode || 'lit',
        })
      }
    } catch (e) { console.log(e) }
    finally { setAgentTyping(false) }
  }

  const sendMessage = async () => {
    if (!draft.trim() || !myId) return
    const text = draft.trim()
    setDraft('')
    await supabase.from('dm_messages').insert({
      sender_id: myId, receiver_id: otherUserId, content: text, sender_mode: myMode || 'lit', receiver_mode: 'lit',
    })
    if (talkingToAgent) getAgentReply(text)
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={[s.headerAvatar, talkingToAgent && s.headerAvatarAgent]}>
          <Text style={s.headerAvatarText}>{userName?.[0] || '?'}</Text>
        </View>
        <View style={s.headerInfo}>
          <View style={s.headerNameRow}>
            <Text style={s.headerName} numberOfLines={1}>{userName}</Text>
            {talkingToAgent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI Agent</Text></View>}
          </View>
          {talkingToAgent && <Text style={s.headerSub}>Powered by Claude · Always available</Text>}
        </View>
      </View>

      {talkingToAgent && (
        <View style={s.agentBanner}>
          <Text style={s.agentBannerText}>🤖 You're chatting with an AI agent in Tryber.</Text>
        </View>
      )}

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={s.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyEmoji}>{talkingToAgent ? '🤖' : '💬'}</Text>
                <Text style={s.emptyText}>{talkingToAgent ? `Say hi to ${userName}!` : 'Start the conversation'}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.sender_id === myId
              return (
                <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  {!isMe && (
                    <View style={[s.avatar, talkingToAgent && s.avatarAgent]}>
                      <Text style={s.avatarText}>{userName?.[0] || '?'}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    <View style={[s.bubble, isMe ? s.bubbleMe : talkingToAgent ? s.bubbleAgent : s.bubbleThem]}>
                      <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextThem]}>{item.content}</Text>
                    </View>
                    <Text style={[s.timeText, isMe && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                  </View>
                </View>
              )
            }}
          />
        )}

        {agentTyping && (
          <View style={s.typingRow}>
            <View style={[s.avatar, s.avatarAgent]}>
              <Text style={s.avatarText}>{userName?.[0] || '?'}</Text>
            </View>
            <View style={[s.bubble, s.bubbleAgent, { paddingVertical: 12 }]}>
              <Text style={s.typingDots}>• • •</Text>
            </View>
          </View>
        )}

        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={talkingToAgent ? `Ask ${userName} anything...` : 'Message...'}
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={500}
          />
          <TouchableOpacity style={[s.sendBtn, !draft.trim() && s.sendBtnOff]} onPress={sendMessage} disabled={!draft.trim()}>
            <Text style={s.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const GREEN = '#1D9E75'
const ORANGE = '#FF6B35'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: GRAY, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', gap: 10 },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  headerAvatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 2, borderColor: ORANGE },
  headerAvatarText: { fontSize: 16, fontWeight: '600' },
  headerInfo: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  agentBadge: { backgroundColor: ORANGE, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 11, color: GRAY, marginTop: 1 },
  agentBanner: { backgroundColor: '#FFF8F5', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#FFD4C2' },
  agentBannerText: { fontSize: 12, color: '#CC5500', lineHeight: 18 },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  avatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 1.5, borderColor: ORANGE },
  avatarText: { fontSize: 14, fontWeight: '600' },
  bubbleCol: { maxWidth: '75%' },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },
  bubbleMe: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#E0DED8' },
  bubbleAgent: { backgroundColor: '#FFF8F5', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#FFD4C2' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTextThem: { color: '#2C2C2A' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 3, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  typingDots: { fontSize: 16, color: ORANGE, letterSpacing: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
