import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, Alert, Modal, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { supabase } from '../src/lib/supabase'
import { sendMessage, editMessage, deleteMessage, markGroupRead } from '../src/services/messages'
import { translateText } from '../src/lib/claude'
import { uuidv4 } from '../src/lib/uuid'
import { useChatAttachments } from '../src/hooks/useChatAttachments'
import { MediaBubble } from '../src/components/MediaBubble'
import { MediaKind } from '../src/lib/upload'
import { getContactNameMap } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER, AGENT_IDS } from '../src/constants'
import { Message } from '../src/types'

export default function ChatScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { id, name, members } = useLocalSearchParams<any>()
  const listRef = useRef<FlatList>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [senderMode, setSenderMode] = useState<'lit' | 'ghost'>('lit')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [memberCount, setMemberCount] = useState(parseInt(members) || 0)
  const [groupDesc, setGroupDesc] = useState('')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [contactNames, setContactNames] = useState<Record<string, string>>({})
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  const [forwardGroups, setForwardGroups] = useState<any[]>([])
  const [forwarding, setForwarding] = useState(false)

  useEffect(() => {
    getContactNameMap().then(setContactNames)
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data: member } = await supabase.from('group_members').select('role').eq('group_id', id).eq('user_id', user.id).single()
      if (member?.role === 'admin') setIsAdmin(true)
      const { data: g } = await supabase.from('groups').select('description, member_count').eq('id', id).single()
      if (g) { setGroupDesc(g.description || ''); if (g.member_count != null) setMemberCount(g.member_count) }
      loadMessages()
      markGroupRead(id, user.id)
    })

    const channel = supabase.channel('group:' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'group_id=eq.' + id }, async ({ new: msg }) => {
        const { data: full } = await supabase.from('messages').select('*, profile:profiles(id,display_name,username,avatar_char,ghost_name)').eq('id', msg.id).single()
        if (full) setMessages(prev => { if (prev.find(m => m.id === full.id)) return prev; return [...prev, full as Message] })
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'group_id=eq.' + id }, ({ new: msg }) => {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  const loadMessages = useCallback(async () => {
    const { data } = await supabase.from('messages')
      .select('*, profile:profiles(id,display_name,username,avatar_char,ghost_name)')
      .eq('group_id', id).eq('deleted_for_all', false)
      .order('created_at', { ascending: true }).limit(100)
    if (data) setMessages(data as Message[])
    setLoading(false)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }, [id])

  const send = async () => {
    if (!draft.trim() || !userId) return
    const text = draft.trim()
    setDraft('')
    if (editingMsg) {
      try { await editMessage(editingMsg.id, userId, text) } catch {}
      setEditingMsg(null)
      return
    }
    const mid = uuidv4()
    const curReply = replyTo
    const optimistic = {
      id: mid, group_id: id, user_id: userId, type: 'text', content: text, media_url: null,
      sender_mode: senderMode, reply_to_id: curReply?.id || null, reply_preview: curReply?.content?.slice(0, 60) || null,
      edited_at: null, deleted_for_all: false, is_forwarded: false, poll_id: null, created_at: new Date().toISOString(),
    } as unknown as Message
    setMessages(prev => [...prev, optimistic])
    setReplyTo(null)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    const err = await sendMessage({ id: mid, groupId: id, userId, content: text, senderMode, replyToId: curReply?.id || null, replyPreview: curReply?.content?.slice(0, 60) || null })
    if (err) setMessages(prev => prev.filter(m => m.id !== mid))
  }

  const sendMedia = async (url: string, kind: MediaKind) => {
    if (!userId) return
    const mid = uuidv4()
    const optimistic = {
      id: mid, group_id: id, user_id: userId, type: kind, content: '', media_url: url,
      sender_mode: senderMode, reply_to_id: null, reply_preview: null,
      edited_at: null, deleted_for_all: false, is_forwarded: false, poll_id: null, created_at: new Date().toISOString(),
    } as unknown as Message
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    const err = await sendMessage({ id: mid, groupId: id, userId, content: '', senderMode, mediaUrl: url, kind })
    if (err) setMessages(prev => prev.filter(m => m.id !== mid))
  }
  const att = useChatAttachments(sendMedia)

  const handleLongPress = (msg: Message) => { setSelectedMsg(msg); setShowMenu(true) }

  const copyMessage = async (msg: Message) => {
    try { await Clipboard.setStringAsync(msg.content) } catch {}
  }

  const translateMessage = async (msg: Message) => {
    if (translations[msg.id]) { setTranslations(prev => { const n = { ...prev }; delete n[msg.id]; return n }); return }
    const target = /[֐-׿]/.test(msg.content) ? 'English' : 'Hebrew'
    const t = await translateText(msg.content, target)
    if (t) setTranslations(prev => ({ ...prev, [msg.id]: t }))
  }

  const reportMessage = async (msg: Message) => {
    if (!userId) return
    try {
      await supabase.from('message_reports').insert({ message_id: msg.id, reporter_id: userId, group_id: id, reason: 'inappropriate' })
      Alert.alert('Reported', 'Thanks — our team will review this message.')
    } catch { Alert.alert('Error', 'Could not submit the report.') }
  }

  const openForward = async (msg: Message) => {
    if (!userId) return
    setForwardMsg(msg)
    setForwardGroups([])
    try {
      const { data: memberships } = await supabase.from('group_members').select('group_id').eq('user_id', userId)
      const ids = (memberships || []).map((m: any) => m.group_id).filter((gid: string) => gid !== id)
      if (ids.length) {
        const { data: gs } = await supabase.from('groups').select('id, name').in('id', ids)
        setForwardGroups(gs || [])
      }
    } catch {}
  }

  const forwardTo = async (group: any) => {
    if (!userId || !forwardMsg) return
    setForwarding(true)
    try {
      await sendMessage({ groupId: group.id, userId, content: forwardMsg.content, senderMode: 'lit', isForwarded: true })
      setForwardMsg(null)
      Alert.alert('Forwarded', 'Message sent to ' + group.name + '.')
    } catch { Alert.alert('Error', 'Could not forward the message.') }
    finally { setForwarding(false) }
  }

  const blockUser = (msg: Message) => {
    if (!userId || !msg.user_id) return
    Alert.alert('Block user', "Block this member from the Trybe?", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try {
          await supabase.from('group_blocks').insert({ group_id: id, blocked_user_id: msg.user_id, blocked_by: userId })
          Alert.alert('Blocked', 'This member has been blocked from the Trybe.')
        } catch { Alert.alert('Error', 'Could not block this member.') }
      } },
    ])
  }

  const isAgent = (uid: string | null) => uid ? AGENT_IDS.includes(uid) : false
  const isWithin15Min = (ts: string) => Date.now() - new Date(ts).getTime() < 15 * 60 * 1000
  const fmt = (ts: string) => new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <TouchableOpacity style={s.hInfo} activeOpacity={0.6} onPress={() => router.push({ pathname: '/group-settings', params: { id, name } })}>
          <Text style={s.hName} numberOfLines={1}>{name}</Text>
          <Text style={s.hSub} numberOfLines={1}>{memberCount} members{groupDesc ? ' · ' + groupDesc : ' · ⚙️ settings'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.modeBtn} onPress={() => router.push({ pathname: '/group-settings', params: { id, name } })}>
          <Text style={s.modeBtnText}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.modeBtn, senderMode === 'ghost' && s.modeBtnGhost]} onPress={() => setSenderMode(m => m === 'lit' ? 'ghost' : 'lit')}>
          <Text style={s.modeBtnText}>{senderMode === 'ghost' ? '👻' : '🔥'}</Text>
        </TouchableOpacity>
      </View>

      {loading
        ? <View style={{ flex: 1 }} />
        : <FlatList ref={listRef} data={messages} keyExtractor={m => m.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item: msg }) => {
              const isMe = msg.user_id === userId
              const isGhost = msg.sender_mode === 'ghost'
              const agentMsg = isAgent(msg.user_id)
              if (msg.type === 'system') return <View style={s.systemMsg}><Text style={s.systemText}>{msg.content}</Text></View>
              if (msg.deleted_for_all) return (
                <View style={[s.msgWrap, isMe && s.msgWrapMe]}>
                  <Text style={s.deleted}>🚫 Message deleted</Text>
                </View>
              )
              const displayName = isGhost && !isMe
                ? '👻 ' + ((msg.profile as any)?.ghost_name || 'Anonymous')
                : (contactNames[msg.user_id || ''] || msg.profile?.display_name || msg.profile?.username || 'User')
              return (
                <TouchableOpacity onLongPress={() => handleLongPress(msg)} activeOpacity={0.85} style={[s.msgWrap, isMe && s.msgWrapMe]}>
                  {!isMe && (
                    <View style={[s.avatar, agentMsg && s.avatarAgent]}>
                      <Text style={s.avatarText}>{isGhost ? '👻' : (msg.profile?.avatar_char || displayName[0] || '?')}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    {!isMe && <Text style={[s.senderName, agentMsg && s.senderNameAgent]}>{displayName}{agentMsg ? ' ✦' : ''}</Text>}
                    {msg.reply_to_id && (
                      <View style={[s.replyPreview, isMe && s.replyPreviewMe]}>
                        <View style={s.replyLine} />
                        <Text style={s.replyText} numberOfLines={1}>{msg.reply_preview || '...'}</Text>
                      </View>
                    )}
                    {msg.is_forwarded && <Text style={s.forwarded}>↪️ Forwarded</Text>}
                    <View style={[s.bubble, isMe ? (isGhost ? s.bubbleMeGhost : s.bubbleMe) : agentMsg ? s.bubbleAgent : s.bubbleThem]}>
                      {msg.media_url ? <MediaBubble url={msg.media_url} kind={msg.type} isMe={isMe} /> : null}
                      {msg.content ? <Text style={[s.bubbleText, isMe && s.bubbleTextMe]}>{msg.content}</Text> : null}
                      {translations[msg.id] && (
                        <Text style={[s.translated, isMe && { color: 'rgba(255,255,255,0.85)', borderTopColor: 'rgba(255,255,255,0.3)' }]}>🌐 {translations[msg.id]}</Text>
                      )}
                      <View style={s.bubbleMeta}>
                        {msg.edited_at && <Text style={[s.edited, isMe && { color: 'rgba(255,255,255,0.5)' }]}>edited</Text>}
                        <Text style={[s.time, isMe && s.timeMe]}>{fmt(msg.created_at)}</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              )
            }}
          />
      }

      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={s.menuOverlay} onPress={() => setShowMenu(false)} activeOpacity={1}>
          <View style={s.menu}>
            {[
              { icon: '↩️', label: 'Reply', onPress: () => { setReplyTo(selectedMsg!); setShowMenu(false) } },
              { icon: '📋', label: 'Copy', onPress: () => { copyMessage(selectedMsg!); setShowMenu(false) } },
              { icon: '📤', label: 'Forward', onPress: () => { const m = selectedMsg!; setShowMenu(false); openForward(m) } },
              { icon: '🌐', label: translations[selectedMsg?.id || ''] ? 'Original' : 'Translate', onPress: () => { const m = selectedMsg!; setShowMenu(false); translateMessage(m) } },
              ...(selectedMsg?.user_id === userId ? [
                ...(isWithin15Min(selectedMsg?.created_at || '') ? [{ icon: '✏️', label: 'Edit', onPress: () => { setEditingMsg(selectedMsg!); setDraft(selectedMsg!.content); setShowMenu(false) } }] : []),
                { icon: '🗑️', label: 'Delete', onPress: () => { setShowMenu(false); Alert.alert('Delete', 'Delete for everyone?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(selectedMsg!.id, userId!) }]) } },
              ] : [
                { icon: '🚩', label: 'Report', onPress: () => { const m = selectedMsg!; setShowMenu(false); reportMessage(m) } },
                ...(isAdmin ? [{ icon: '🚫', label: 'Block', onPress: () => { const m = selectedMsg!; setShowMenu(false); blockUser(m) } }] : []),
              ]),
            ].map(item => (
              <TouchableOpacity key={item.label} style={s.menuItem} onPress={item.onPress}>
                <Text style={s.menuIcon}>{item.icon}</Text>
                <Text style={s.menuLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!forwardMsg} transparent animationType="slide" onRequestClose={() => setForwardMsg(null)}>
        <View style={s.fwdOverlay}>
          <View style={[s.fwdSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={s.fwdHeader}>
              <Text style={s.fwdTitle}>Forward to…</Text>
              <TouchableOpacity onPress={() => setForwardMsg(null)}><Text style={s.fwdClose}>✕</Text></TouchableOpacity>
            </View>
            {forwardMsg && <Text style={s.fwdPreview} numberOfLines={2}>{forwardMsg.content}</Text>}
            <FlatList data={forwardGroups} keyExtractor={g => g.id} style={{ maxHeight: 300 }}
              contentContainerStyle={forwardGroups.length === 0 ? { paddingVertical: 24 } : {}}
              ListEmptyComponent={<Text style={s.fwdEmpty}>No other Trybes to forward to.</Text>}
              renderItem={({ item: g }) => (
                <TouchableOpacity style={s.fwdRow} onPress={() => forwardTo(g)} disabled={forwarding}>
                  <View style={s.fwdAvatar}><Text style={{ fontSize: 18 }}>{g.name?.[0] || '⚡'}</Text></View>
                  <Text style={s.fwdName} numberOfLines={1}>{g.name}</Text>
                  <Text style={s.fwdArrow}>›</Text>
                </TouchableOpacity>
              )} />
          </View>
        </View>
      </Modal>

      {replyTo && (
        <View style={s.replyBarInput}>
          <View style={s.replyLine} />
          <Text style={s.replyPreviewInputText} numberOfLines={1}>{replyTo.content}</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}><Text style={{ fontSize: 18, color: GRAY }}>✕</Text></TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        {att.isRecording ? (
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={s.recordBar}><View style={s.recDot} /><Text style={s.recText}>Recording voice note…</Text></View>
            <TouchableOpacity style={s.attachBtn} onPress={att.cancelRecording}><Text style={{ fontSize: 18, color: DANGER }}>✕</Text></TouchableOpacity>
            <TouchableOpacity style={s.sendBtn} onPress={att.stopAndSendRecording}><Text style={s.sendBtnText}>↑</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TouchableOpacity style={s.attachBtn} onPress={att.openMenu} disabled={att.uploading}>
              {att.uploading ? <ActivityIndicator color={PRIMARY} size="small" /> : <Text style={s.attachIcon}>＋</Text>}
            </TouchableOpacity>
            <TextInput style={s.input} value={draft} onChangeText={setDraft}
              placeholder={editingMsg ? 'Edit message...' : (senderMode === 'ghost' ? '👻 Anonymous message...' : 'Message...')}
              placeholderTextColor={GRAY} multiline returnKeyType="send" onSubmitEditing={send} />
            <TouchableOpacity style={[s.sendBtn, !draft.trim() && s.sendBtnOff]} onPress={send} disabled={!draft.trim()}>
              <Text style={s.sendBtnText}>{editingMsg ? '✓' : '↑'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  hInfo: { flex: 1 },
  hName: { fontSize: 16, fontWeight: '700', color: TEXT },
  hSub: { fontSize: 11, color: GRAY },
  modeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  modeBtnGhost: { backgroundColor: '#F0F0F0' },
  modeBtnText: { fontSize: 18 },
  systemMsg: { alignItems: 'center', paddingVertical: 8 },
  systemText: { fontSize: 12, color: GRAY, backgroundColor: 'rgba(0,0,0,0.04)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  deleted: { fontSize: 13, color: GRAY, fontStyle: 'italic', textAlign: 'center', paddingVertical: 4 },
  msgWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2, paddingHorizontal: 12 },
  msgWrapMe: { flexDirection: 'row-reverse' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  avatarAgent: { backgroundColor: '#EEF0FF', borderColor: PRIMARY },
  avatarText: { fontSize: 14 },
  bubbleCol: { maxWidth: '78%' },
  senderName: { fontSize: 11, fontWeight: '600', color: GRAY, marginBottom: 2 },
  senderNameAgent: { color: PRIMARY },
  replyPreview: { flexDirection: 'row', gap: 4, marginBottom: 4, backgroundColor: 'rgba(108,99,255,0.06)', borderRadius: 8, padding: 6 },
  replyPreviewMe: { alignSelf: 'flex-end' },
  replyLine: { width: 3, backgroundColor: PRIMARY, borderRadius: 2 },
  replyText: { fontSize: 11, color: GRAY, flex: 1 },
  forwarded: { fontSize: 11, color: GRAY, marginBottom: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleThem: { backgroundColor: CARD, borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: BORDER },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleMeGhost: { backgroundColor: '#9B9B9B', borderBottomRightRadius: 4 },
  bubbleAgent: { backgroundColor: '#EEF0FF', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: 'rgba(108,99,255,0.2)' },
  bubbleText: { fontSize: 15, lineHeight: 21, color: TEXT },
  bubbleTextMe: { color: '#fff' },
  translated: { fontSize: 14, lineHeight: 20, color: GRAY, marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: BORDER, fontStyle: 'italic' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, justifyContent: 'flex-end' },
  edited: { fontSize: 10, color: GRAY },
  time: { fontSize: 10, color: GRAY },
  timeMe: { color: 'rgba(255,255,255,0.6)' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  menu: { backgroundColor: CARD, borderRadius: 20, padding: 16, width: 280, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  menuItem: { width: '23%', alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: BG },
  menuIcon: { fontSize: 22, marginBottom: 4 },
  menuLabel: { fontSize: 10, color: TEXT, fontWeight: '500' },
  fwdOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  fwdSheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12 },
  fwdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  fwdTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  fwdClose: { fontSize: 18, color: GRAY, paddingHorizontal: 6 },
  fwdPreview: { fontSize: 13, color: GRAY, fontStyle: 'italic', backgroundColor: BG, borderRadius: 10, padding: 10, marginBottom: 10 },
  fwdEmpty: { fontSize: 14, color: GRAY, textAlign: 'center' },
  fwdRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderColor: BORDER },
  fwdAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  fwdName: { flex: 1, fontSize: 15, fontWeight: '600', color: TEXT },
  fwdArrow: { fontSize: 20, color: GRAY },
  replyBarInput: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(108,99,255,0.06)', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  replyPreviewInputText: { flex: 1, fontSize: 13, color: GRAY },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, maxHeight: 100, borderWidth: 1, borderColor: BORDER },
  attachBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  attachIcon: { fontSize: 24, color: PRIMARY, fontWeight: '700', marginTop: -2 },
  recordBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: BORDER },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: DANGER },
  recText: { fontSize: 14, color: TEXT },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
})
