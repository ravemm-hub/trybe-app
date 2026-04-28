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
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const GRAY = '#8A8A9A'
const TEXT = '#1A1A2E'

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
  const [otherProfile, setOtherProfile] = useState<any>(null)
  const [agentTyping, setAgentTyping] = useState(false)
  const listRef = useRef<FlatList>(null)
  const talkingToAgent = isAgent === '1' || AGENT_IDS.includes(otherUserId || '')

  const loadMessages = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)

    // Load other user's profile
    if (!talkingToAgent) {
      const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', otherUserId).single()
      if (profile) setOtherProfile(profile)
    }

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
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500))
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 200,
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
  const tempMsg: DmMessage = {
    id: `temp_${Date.now()}`,
    sender_id: myId,
    receiver_id: otherUserId,
    content: text,
    created_at: new Date().toISOString(),
    sender_mode: myMode || 'lit',
  }
  setMessages(prev => [...prev, tempMsg])
  setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
  const { error } = await supabase.from('dm_messages').insert({
    sender_id: myId, receiver_id: otherUserId, content: text,
    sender_mode: myMode || 'lit', receiver_mode: 'lit',
  })
  if (error) setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
  if (!error && talkingToAgent) getAgentReply(text)
}
  
   

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

  const displayName = talkingToAgent ? userName : (otherProfile?.display_name || otherProfile?.username || userName)
  const avatarChar = talkingToAgent ? '🤖' : (otherProfile?.avatar_char || displayName?.[0] || '?')

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={[s.headerAvatar, talkingToAgent && s.headerAvatarAgent]}>
          <Text style={s.headerAvatarText}>{avatarChar}</Text>
        </View>
        <View style={s.headerInfo}>
          <View style={s.headerNameRow}>
            <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
            {talkingToAgent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI</Text></View>}
          </View>
          <Text style={s.headerSub}>{talkingToAgent ? 'Powered by Claude · Always available' : 'Direct Message'}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={PRIMARY} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={s.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyEmoji}>{talkingToAgent ? '✦' : '👋'}</Text>
                <Text style={s.emptyTitle}>{talkingToAgent ? `Chat with ${displayName}` : `Say hi to ${displayName}!`}</Text>
                <Text style={s.emptyText}>{talkingToAgent ? 'Your personal AI is ready' : 'Start the conversation'}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.sender_id === myId
              return (
                <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  {!isMe && (
                    <View style={[s.avatar, talkingToAgent && s.avatarAgent]}>
                      <Text style={s.avatarText}>{avatarChar}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    <View style={[s.bubble, isMe ? s.bubbleMe : talkingToAgent ? s.bubbleAgent : s.bubbleThem]}>
                      <Text style={[s.bubbleText, isMe && s.bubbleTextMe]}>{item.content}</Text>
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
              <Text style={s.avatarText}>✦</Text>
            </View>
            <View style={[s.bubble, s.bubbleAgent, { paddingVertical: 12 }]}>
              <Text style={s.typingDots}>· · ·</Text>
            </View>
          </View>
        )}

        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={talkingToAgent ? `Ask ${displayName}...` : `Message ${displayName}...`}
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FD' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT },
  emptyText: { fontSize: 14, color: GRAY, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#EBEBEB', gap: 10 },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  headerAvatarAgent: { backgroundColor: '#EEF0FF', borderWidth: 2, borderColor: PRIMARY },
  headerAvatarText: { fontSize: 20 },
  headerInfo: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName: { fontSize: 16, fontWeight: '700', color: TEXT },
  agentBadge: { backgroundColor: PRIMARY, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 11, color: GRAY, marginTop: 1 },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  avatarAgent: { backgroundColor: '#EEF0FF', borderWidth: 1.5, borderColor: PRIMARY },
  avatarText: { fontSize: 16, fontWeight: '600', color: PRIMARY },
  bubbleCol: { maxWidth: '75%' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#EBEBEB' },
  bubbleAgent: { backgroundColor: '#EEF0FF', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: TEXT },
  bubbleTextMe: { color: '#fff' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 4, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  typingDots: { fontSize: 18, color: PRIMARY, letterSpacing: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#EBEBEB' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F0F0F8', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.35 },
  sendIcon: { color: '#fff', fontSize: 20, fontWeight: '700' },
})
