import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, Alert, Modal, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { supabase } from '../src/lib/supabase'
import { sendDM, markDMRead, markDMDelivered, editDM, deleteDM, getReceiptStatus } from '../src/services/dms'
import { askClaude, translateText } from '../src/lib/claude'
import { uuidv4 } from '../src/lib/uuid'
import { useChatAttachments } from '../src/hooks/useChatAttachments'
import { MediaBubble } from '../src/components/MediaBubble'
import { MediaKind } from '../src/lib/upload'
import { getContactName } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER, AGENT_IDS, AGENTS } from '../src/constants'
import { DmMessage } from '../src/types'

const LANGS = ['English', 'Hebrew', 'Arabic', 'Russian', 'French', 'Spanish']

export default function DMScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const otherUserId = params?.userId || ''
  const initMode = params?.myMode || 'lit'
  const isAgentParam = params?.isAgent === '1'
  const listRef = useRef<FlatList>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(params?.userName || 'Chat')
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [draft, setDraft] = useState('')
  const [agentTyping, setAgentTyping] = useState(false)
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null)
  const [editingMsg, setEditingMsg] = useState<DmMessage | null>(null)
  const [translateTo, setTranslateTo] = useState<string | null>(null)
  const [showTranslate, setShowTranslate] = useState(false)
  const [selectedMsg, setSelectedMsg] = useState<DmMessage | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [translations, setTranslations] = useState<Record<string, string>>({})

  const talkingToAgent = isAgentParam || (otherUserId && AGENT_IDS.includes(otherUserId))
  const agentInfo = AGENTS.find(a => a.id === otherUserId)

  useEffect(() => {
    if (!otherUserId) { router.back(); return }
    let channel: ReturnType<typeof supabase.channel> | null = null
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setMyId(user.id)
      const uid = user.id
      // Load contact name
      getContactName(otherUserId).then(cn => { if (cn) setDisplayName(cn) })
      loadMessages(uid)
      if (!talkingToAgent) markDMDelivered(uid)

      channel = supabase.channel('dm:' + uid + ':' + otherUserId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, async ({ new: msg }) => {
          const isOurs = (msg.sender_id === uid && msg.receiver_id === otherUserId) || (msg.sender_id === otherUserId && msg.receiver_id === uid)
          if (!isOurs) return
          if (msg.sender_id === otherUserId) markDMRead(otherUserId, uid)
          setMessages(prev => { if (prev.find(m => m.id === msg.id)) return prev; return [...prev, msg as DmMessage] })
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages' }, ({ new: msg }) => {
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m))
        })
        .subscribe()
    })
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  const loadMessages = async (uid: string) => {
    try {
      const { data, error } = await supabase.from('dm_messages').select('*')
        .or('and(sender_id.eq.' + uid + ',receiver_id.eq.' + otherUserId + '),and(sender_id.eq.' + otherUserId + ',receiver_id.eq.' + uid + ')')
        .eq('deleted_for_all', false).order('created_at', { ascending: true }).limit(100)
      if (error) { console.error('DM load error:', error); return }
      if (data) {
        setMessages(data as DmMessage[])
        markDMRead(otherUserId, uid)
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
      }
    } catch (e) { console.error('DM loadMessages error:', e) }
  }

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || !myId || !otherUserId) return
    let content = draft.trim()
    setDraft('')
    if (editingMsg) {
      await editDM(editingMsg.id, myId, content)
      setEditingMsg(null)
      return
    }
    if (translateTo && !talkingToAgent) content = await translateText(content, translateTo)
    const mid = uuidv4()
    const curReply = replyTo
    const optimistic = {
      id: mid, sender_id: myId, receiver_id: otherUserId, content, sender_mode: initMode || 'lit', receiver_mode: 'lit',
      read_at: null, delivered_at: null, edited_at: null, deleted_for_all: false, is_forwarded: false,
      reply_to_id: curReply?.id || null, reply_preview: curReply?.content?.slice(0, 60) || null, created_at: new Date().toISOString(),
    } as unknown as DmMessage
    setMessages(prev => [...prev, optimistic])
    setReplyTo(null)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    const { error: sendErr } = await sendDM({ id: mid, senderId: myId, receiverId: otherUserId, content, senderMode: initMode || 'lit', replyToId: curReply?.id || null, replyPreview: curReply?.content?.slice(0, 60) || null })
    if (sendErr) setMessages(prev => prev.filter(m => m.id !== mid))
    if (talkingToAgent && agentInfo) {
      setAgentTyping(true)
      const timeout = setTimeout(() => setAgentTyping(false), 15000)
      try {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500))
        const lang = agentInfo.lang === 'he' ? 'Hebrew' : 'English'
        const reply = await askClaude('You are ' + agentInfo.name + ', ' + agentInfo.personality + '. Someone wrote: "' + content + '". Reply in ' + lang + ', 1-2 sentences, casual. You can look things up online if useful.', undefined, 150, true)
        // Agent replies are written via a SECURITY DEFINER RPC: RLS only lets you insert
        // dm_messages where sender_id = auth.uid(), and the sender here is the agent.
        if (reply) await supabase.rpc('send_agent_dm', { p_agent: otherUserId, p_receiver: myId, p_content: reply })
      } catch {}
      finally { setAgentTyping(false); clearTimeout(timeout) }
    }
  }, [draft, myId, otherUserId, replyTo, translateTo, editingMsg, talkingToAgent, agentInfo, initMode])

  const sendMediaDM = async (url: string, kind: MediaKind) => {
    if (!myId || !otherUserId) return
    const mid = uuidv4()
    const optimistic = {
      id: mid, sender_id: myId, receiver_id: otherUserId, content: '', sender_mode: initMode || 'lit', receiver_mode: 'lit',
      read_at: null, delivered_at: null, edited_at: null, deleted_for_all: false, is_forwarded: false,
      reply_to_id: null, reply_preview: null, media_url: url, media_type: kind, created_at: new Date().toISOString(),
    } as unknown as DmMessage
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    const { error: e } = await sendDM({ id: mid, senderId: myId, receiverId: otherUserId, content: '', senderMode: initMode || 'lit', mediaUrl: url, mediaType: kind })
    if (e) setMessages(prev => prev.filter(m => m.id !== mid))
  }
  const att = useChatAttachments(sendMediaDM)

  const handleLongPress = (msg: DmMessage) => { setSelectedMsg(msg); setShowMenu(true) }

  const copyMessage = async (msg: DmMessage) => {
    try { await Clipboard.setStringAsync(msg.content) } catch {}
  }

  const translateMessage = async (msg: DmMessage) => {
    if (translations[msg.id]) { setTranslations(prev => { const n = { ...prev }; delete n[msg.id]; return n }); return }
    const target = /[֐-׿]/.test(msg.content) ? 'English' : 'Hebrew'
    const t = await translateText(msg.content, target)
    if (t) setTranslations(prev => ({ ...prev, [msg.id]: t }))
  }

  const receiptIcon = (msg: DmMessage) => {
    if (msg.sender_id !== myId) return null
    const status = getReceiptStatus(msg)
    const color = status === 'read' ? LIVE : 'rgba(255,255,255,0.5)'
    return <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{status === 'sent' ? '✓' : '✓✓'}</Text>
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <View style={[s.hAvatar, talkingToAgent && s.hAvatarAgent]}>
          <Text style={s.hAvatarText}>{talkingToAgent ? '✦' : (displayName?.[0] || '?')}</Text>
        </View>
        <View style={s.hInfo}>
          <Text style={s.hName} numberOfLines={1}>{displayName}</Text>
          {talkingToAgent && <Text style={s.hSub}>AI Agent · Always on</Text>}
        </View>
        {!talkingToAgent && (
          <TouchableOpacity onPress={() => setShowTranslate(true)} style={s.translateBtn}>
            <Text style={{ fontSize: 18 }}>🌐</Text>
            {translateTo && <View style={s.translateDot} />}
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        <FlatList ref={listRef} data={messages} keyExtractor={m => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: msg }) => {
            const isMe = msg.sender_id === myId
            if (msg.deleted_for_all) return <Text style={s.deleted}>🚫 Message deleted</Text>
            return (
              <TouchableOpacity onLongPress={() => handleLongPress(msg)} activeOpacity={0.85} style={[s.msgWrap, isMe && s.msgWrapMe]}>
                {msg.reply_to_id && (
                  <View style={[s.replyBar, isMe && s.replyBarMe]}>
                    <View style={s.replyLine} />
                    <Text style={s.replyText} numberOfLines={1}>{msg.reply_preview || '...'}</Text>
                  </View>
                )}
                <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
                  {msg.media_url ? <MediaBubble url={msg.media_url} kind={msg.media_type || undefined} isMe={isMe} /> : null}
                  {msg.content ? <Text style={[s.bubbleText, isMe && s.bubbleTextMe]}>{msg.content}</Text> : null}
                  {translations[msg.id] && (
                    <Text style={[s.translated, isMe && { color: 'rgba(255,255,255,0.85)', borderTopColor: 'rgba(255,255,255,0.3)' }]}>🌐 {translations[msg.id]}</Text>
                  )}
                  <View style={s.bubbleMeta}>
                    {msg.edited_at && <Text style={[s.edited, isMe && { color: 'rgba(255,255,255,0.5)' }]}>edited</Text>}
                    <Text style={[s.time, isMe && s.timeMe]}>{new Date(msg.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</Text>
                    {receiptIcon(msg)}
                  </View>
                </View>
              </TouchableOpacity>
            )
          }}
          ListFooterComponent={agentTyping ? (
            <View style={s.msgWrap}>
              <View style={[s.bubble, s.bubbleThem, { paddingVertical: 14 }]}>
                <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
              </View>
            </View>
          ) : null}
        />

        {replyTo && (
          <View style={s.replyBarInput}>
            <View style={s.replyLine} />
            <Text style={s.replyPreviewText} numberOfLines={1}>{replyTo.content}</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}><Text style={{ fontSize: 18, color: GRAY }}>✕</Text></TouchableOpacity>
          </View>
        )}

        {att.isRecording ? (
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={s.recordBar}><View style={s.recDot} /><Text style={s.recText}>Recording voice note…</Text></View>
            <TouchableOpacity style={s.attachBtn} onPress={att.cancelRecording}><Text style={{ fontSize: 18, color: DANGER }}>✕</Text></TouchableOpacity>
            <TouchableOpacity style={s.sendBtn} onPress={att.stopAndSendRecording}><Text style={s.sendBtnText}>↑</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {translateTo && !talkingToAgent && (
              <View style={s.transIndicator}><Text style={s.transIndicatorText}>🌐 → {translateTo}</Text></View>
            )}
            <TouchableOpacity style={s.attachBtn} onPress={att.openMenu} disabled={att.uploading}>
              {att.uploading ? <ActivityIndicator color={PRIMARY} size="small" /> : <Text style={s.attachIcon}>＋</Text>}
            </TouchableOpacity>
            <TextInput style={s.input} value={draft} onChangeText={setDraft}
              placeholder={editingMsg ? 'Edit message...' : 'Message...'}
              placeholderTextColor={GRAY} multiline returnKeyType="send" onSubmitEditing={sendMessage} />
            <TouchableOpacity style={[s.sendBtn, !draft.trim() && s.sendBtnOff]} onPress={sendMessage} disabled={!draft.trim()}>
              <Text style={s.sendBtnText}>{editingMsg ? '✓' : '↑'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showTranslate} transparent animationType="slide" onRequestClose={() => setShowTranslate(false)}>
        <TouchableOpacity style={s.modalOverlay} onPress={() => setShowTranslate(false)} activeOpacity={1}>
          <View style={s.translateSheet}>
            <Text style={s.translateTitle}>Translate to:</Text>
            <TouchableOpacity style={[s.translateOpt, !translateTo && s.translateOptActive]} onPress={() => { setTranslateTo(null); setShowTranslate(false) }}>
              <Text style={[s.translateOptText, !translateTo && { color: '#fff' }]}>Off</Text>
            </TouchableOpacity>
            {LANGS.map(lang => (
              <TouchableOpacity key={lang} style={[s.translateOpt, translateTo === lang && s.translateOptActive]} onPress={() => { setTranslateTo(lang); setShowTranslate(false) }}>
                <Text style={[s.translateOptText, translateTo === lang && { color: '#fff' }]}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={s.menuOverlay} onPress={() => setShowMenu(false)} activeOpacity={1}>
          <View style={s.menu}>
            {[
              { icon: '↩️', label: 'Reply', onPress: () => { setReplyTo(selectedMsg!); setShowMenu(false) } },
              { icon: '📋', label: 'Copy', onPress: () => { copyMessage(selectedMsg!); setShowMenu(false) } },
              { icon: '🌐', label: translations[selectedMsg?.id || ''] ? 'Original' : 'Translate', onPress: () => { const m = selectedMsg!; setShowMenu(false); translateMessage(m) } },
              ...(selectedMsg?.sender_id === myId ? [
                { icon: '✏️', label: 'Edit', onPress: () => { setEditingMsg(selectedMsg!); setDraft(selectedMsg!.content); setShowMenu(false) } },
                { icon: '🗑️', label: 'Delete', onPress: () => { setShowMenu(false); Alert.alert('Delete', 'Delete for everyone?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteDM(selectedMsg!.id, myId!) }]) } },
              ] : [
                { icon: '🚩', label: 'Report', onPress: () => setShowMenu(false) },
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
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  hAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: BORDER },
  hAvatarAgent: { backgroundColor: '#EEF0FF', borderColor: PRIMARY },
  hAvatarText: { fontSize: 18 },
  hInfo: { flex: 1 },
  hName: { fontSize: 16, fontWeight: '700', color: TEXT },
  hSub: { fontSize: 11, color: LIVE },
  translateBtn: { padding: 8, position: 'relative' },
  translateDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY },
  deleted: { fontSize: 13, color: GRAY, fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },
  msgWrap: { marginVertical: 2, paddingHorizontal: 12, alignItems: 'flex-start' },
  msgWrapMe: { alignItems: 'flex-end' },
  replyBar: { flexDirection: 'row', gap: 6, marginBottom: 4, maxWidth: '80%', backgroundColor: 'rgba(108,99,255,0.06)', borderRadius: 8, padding: 6 },
  replyBarMe: { alignSelf: 'flex-end' },
  replyLine: { width: 3, backgroundColor: PRIMARY, borderRadius: 2 },
  replyText: { fontSize: 12, color: GRAY, flex: 1 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleThem: { backgroundColor: CARD, borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: BORDER },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21, color: TEXT },
  bubbleTextMe: { color: '#fff' },
  translated: { fontSize: 14, lineHeight: 20, color: GRAY, marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: BORDER, fontStyle: 'italic' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, justifyContent: 'flex-end' },
  edited: { fontSize: 10, color: GRAY },
  time: { fontSize: 10, color: GRAY },
  timeMe: { color: 'rgba(255,255,255,0.6)' },
  replyBarInput: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(108,99,255,0.06)', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  replyPreviewText: { flex: 1, fontSize: 13, color: GRAY },
  transIndicator: { backgroundColor: '#EEF0FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', marginLeft: 12, marginBottom: 4 },
  transIndicatorText: { fontSize: 11, color: PRIMARY, fontWeight: '600' },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  translateSheet: { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
  translateTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 8 },
  translateOpt: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: BG },
  translateOptActive: { backgroundColor: PRIMARY },
  translateOptText: { fontSize: 15, color: TEXT, fontWeight: '500' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  menu: { backgroundColor: CARD, borderRadius: 20, padding: 16, width: 280, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  menuItem: { width: '23%', alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: BG },
  menuIcon: { fontSize: 22, marginBottom: 4 },
  menuLabel: { fontSize: 10, color: TEXT, fontWeight: '500' },
})
