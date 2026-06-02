import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Alert, Modal, ScrollView, Image,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { uuidv4 } from '../src/lib/uuid'
import { getEnrichedContacts, EnrichedContact } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../src/constants'

// List type metadata — emoji + label for each supported list type.
const LIST_TYPES: Record<string, { emoji: string; label: string }> = {
  shopping: { emoji: '🛒', label: 'Shopping list' },
  tasks:    { emoji: '✅', label: 'To-do list' },
  cooking:  { emoji: '🍳', label: 'Recipe / ingredients' },
  trip:     { emoji: '✈️', label: 'Trip plan' },
  party:    { emoji: '🎉', label: 'Party checklist' },
  other:    { emoji: '📋', label: 'List' },
}

type ListItem = { id: string; text: string; done: boolean; position?: number }
type MemberProfile = { id: string; display_name: string | null; username: string | null; avatar_url: string | null }

export default function SharedListScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()

  // Support two entry points:
  //   1. Teeby card → { listId }  (new — load by id)
  //   2. Legacy DM button → { userId, userName }  (kept for compat)
  const listIdParam: string | null = params?.listId || null
  const legacyUserId: string | null = params?.userId || null
  const legacyUserName: string = params?.userName || 'someone'

  const [myId, setMyId] = useState<string | null>(null)
  const [listId, setListId] = useState<string | null>(listIdParam)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<string>('shopping')
  const [items, setItems] = useState<ListItem[]>([])
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showShareModal, setShowShareModal] = useState(false)
  const [contacts, setContacts] = useState<EnrichedContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const loadList = useCallback(async (lid: string, uid: string) => {
    const { data } = await supabase.from('shared_lists').select('*').eq('id', lid).single()
    if (!data) return
    setTitle(data.title || 'My list')
    setType(data.type || 'shopping')
    setItems(Array.isArray(data.items) ? data.items : [])

    // Load member profiles
    const memberIds: string[] = data.members || data.dm_between || []
    if (memberIds.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('id, display_name, username, avatar_url')
        .in('id', memberIds)
      setMembers((profs || []) as MemberProfile[])
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.back(); return }
      setMyId(user.id)

      let lid = listId
      if (!lid && legacyUserId) {
        // Legacy: find or create a list for this DM pair
        const { data: existing } = await supabase.from('shared_lists').select('*')
          .contains('dm_between', [user.id, legacyUserId]).order('created_at', { ascending: true }).limit(1)
        let row: any = existing?.[0]
        if (!row) {
          const { data: created } = await supabase.from('shared_lists')
            .insert({ dm_between: [user.id, legacyUserId], title: 'Shopping list', type: 'shopping', items: [], created_by: user.id, owner_id: user.id, members: [user.id, legacyUserId] })
            .select().single()
          row = created
        }
        if (row) { setListId(row.id); lid = row.id }
      }

      if (!lid) { setLoading(false); return }
      await loadList(lid, user.id)

      // Realtime subscription
      channelRef.current = supabase.channel('list:' + lid)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_lists', filter: 'id=eq.' + lid },
          ({ new: r }: any) => {
            if (Array.isArray(r.items)) setItems(r.items)
            if (r.title) setTitle(r.title)
            if (r.type) setType(r.type)
          })
        .subscribe()
      setLoading(false)
    })
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [])

  // Persist items + optional title/type update to DB
  const persist = async (nextItems: ListItem[], nextTitle?: string, nextType?: string) => {
    setItems(nextItems)
    if (!listId) return
    const update: any = { items: nextItems, updated_at: new Date().toISOString() }
    if (nextTitle !== undefined) update.title = nextTitle
    if (nextType !== undefined) update.type = nextType
    try { await supabase.from('shared_lists').update(update).eq('id', listId) } catch {}
  }

  const addItem = () => {
    if (!draft.trim()) return
    const next = [...items, { id: uuidv4(), text: draft.trim(), done: false, position: items.length }]
    persist(next)
    setDraft('')
  }
  const toggle = (id: string) => persist(items.map(i => i.id === id ? { ...i, done: !i.done } : i))
  const remove = (id: string) => persist(items.filter(i => i.id !== id))

  const saveTitle = async () => {
    if (!titleDraft.trim()) { setEditingTitle(false); return }
    const t = titleDraft.trim().slice(0, 80)
    setTitle(t); setEditingTitle(false)
    await persist(items, t)
  }

  // Share modal — load contacts who are on Tryber
  const openShare = async () => {
    setShowShareModal(true)
    if (contacts.length) return
    setContactsLoading(true)
    const all = await getEnrichedContacts()
    setContacts(all.filter(c => c.onTryber && c.tryberUserId && !members.some(m => m.id === c.tryberUserId)))
    setContactsLoading(false)
  }

  const addMember = async (contact: EnrichedContact) => {
    if (!listId || !contact.tryberUserId) return
    await supabase.rpc('add_list_member', { p_list: listId, p_user: contact.tryberUserId })
    // Refresh member list
    const { data: profs } = await supabase.from('profiles').select('id, display_name, username, avatar_url').eq('id', contact.tryberUserId).single()
    if (profs) setMembers(prev => [...prev, profs as MemberProfile])
    setContacts(prev => prev.filter(c => c.tryberUserId !== contact.tryberUserId))
    Alert.alert('Shared!', `${contact.name} has been added to this list.`)
  }

  const meta = LIST_TYPES[type] || LIST_TYPES.other
  const remaining = items.filter(i => !i.done).length
  const done = items.filter(i => i.done).length

  if (loading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <ActivityIndicator color={PRIMARY} style={{ flex: 1 }} />
      </View>
    )
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {editingTitle ? (
            <TextInput
              style={s.titleInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
              onBlur={saveTitle}
              onSubmitEditing={saveTitle}
              autoFocus
              maxLength={80}
            />
          ) : (
            <TouchableOpacity onPress={() => { setTitleDraft(title); setEditingTitle(true) }}>
              <Text style={s.hName} numberOfLines={1}>{meta.emoji} {title}</Text>
            </TouchableOpacity>
          )}
          <Text style={s.hSub}>
            {remaining > 0 ? `${remaining} left` : done > 0 ? '✅ All done!' : 'Empty list'}
            {' · '}{members.length} {members.length === 1 ? 'person' : 'people'}
          </Text>
        </View>
        <TouchableOpacity style={s.shareBtn} onPress={openShare}>
          <Text style={s.shareBtnText}>＋ Share</Text>
        </TouchableOpacity>
      </View>

      {/* Member avatars row */}
      {members.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.memberRow} contentContainerStyle={{ padding: 8, gap: 8 }}>
          {members.map(m => {
            const initials = (m.display_name || m.username || '?')[0].toUpperCase()
            return (
              <View key={m.id} style={s.memberBubble}>
                {m.avatar_url
                  ? <Image source={{ uri: m.avatar_url }} style={s.memberImg} />
                  : <Text style={s.memberInitial}>{initials}</Text>}
              </View>
            )
          })}
        </ScrollView>
      )}

      {/* Items list */}
      <FlatList
        data={[...items.filter(i => !i.done), ...items.filter(i => i.done)]}
        keyExtractor={i => i.id}
        style={{ flex: 1 }}
        contentContainerStyle={items.length === 0 ? { flex: 1 } : { paddingVertical: 4 }}
        ListEmptyComponent={(
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>{meta.emoji}</Text>
            <Text style={s.emptyTitle}>List is empty</Text>
            <Text style={s.emptySub}>Add your first item below — everyone in this list will see it instantly.</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[s.row, item.done && s.rowDone]}>
            <TouchableOpacity style={[s.check, item.done && s.checkOn]} onPress={() => toggle(item.id)}>
              {item.done && <Text style={s.checkMark}>✓</Text>}
            </TouchableOpacity>
            <Text style={[s.itemText, item.done && s.itemStrike]} numberOfLines={2}>{item.text}</Text>
            <TouchableOpacity onPress={() => remove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.del}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Input bar */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Add to ${meta.label.toLowerCase()}…`}
            placeholderTextColor={GRAY}
            returnKeyType="done"
            onSubmitEditing={addItem}
          />
          <TouchableOpacity style={[s.addBtn, !draft.trim() && { opacity: 0.35 }]} onPress={addItem} disabled={!draft.trim()}>
            <Text style={s.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Share modal — pick a contact to add */}
      <Modal visible={showShareModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowShareModal(false)}>
        <View style={[s.modal, { paddingTop: insets.top + 16 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Share list</Text>
            <TouchableOpacity onPress={() => setShowShareModal(false)}>
              <Text style={s.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalSub}>Add a contact who's on Tryber. They'll be able to view and edit this list in real-time.</Text>
          {contactsLoading
            ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 32 }} />
            : contacts.length === 0
              ? (
                <View style={s.noContacts}>
                  <Text style={s.noContactsText}>All your Tryber contacts are already in this list, or you have no Tryber contacts yet.</Text>
                </View>
              )
              : (
                <FlatList
                  data={contacts}
                  keyExtractor={c => c.id}
                  contentContainerStyle={{ padding: 16, gap: 10 }}
                  renderItem={({ item: c }) => (
                    <TouchableOpacity style={s.contactRow} onPress={() => addMember(c)}>
                      <View style={s.contactAvatar}>
                        <Text style={{ fontSize: 18 }}>{c.initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.contactName}>{c.name}</Text>
                        <Text style={s.contactPhone}>{c.phone}</Text>
                      </View>
                      <View style={s.addChip}>
                        <Text style={s.addChipText}>＋ Add</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              )
          }
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  hName: { fontSize: 16, fontWeight: '700', color: TEXT },
  hSub: { fontSize: 11, color: GRAY, marginTop: 1 },
  titleInput: { fontSize: 16, fontWeight: '700', color: TEXT, borderBottomWidth: 1.5, borderColor: PRIMARY, paddingVertical: 2 },
  shareBtn: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#EEF0FF', borderRadius: 14, borderWidth: 1, borderColor: PRIMARY },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: PRIMARY },

  memberRow: { maxHeight: 60, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  memberBubble: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5, borderColor: PRIMARY },
  memberImg: { width: '100%', height: '100%' },
  memberInitial: { fontSize: 16, fontWeight: '700', color: PRIMARY },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  rowDone: { opacity: 0.55 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: LIVE, borderColor: LIVE },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  itemText: { flex: 1, fontSize: 15, color: TEXT },
  itemStrike: { textDecorationLine: 'line-through', color: GRAY },
  del: { fontSize: 16, color: GRAY, paddingHorizontal: 4 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 20 },

  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: -2 },

  modal: { flex: 1, backgroundColor: BG },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: BORDER },
  modalTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  modalClose: { fontSize: 15, color: PRIMARY, fontWeight: '600' },
  modalSub: { fontSize: 13, color: GRAY, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, lineHeight: 18 },
  noContacts: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  noContactsText: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 20 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: BORDER },
  contactAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  contactName: { fontSize: 15, fontWeight: '600', color: TEXT },
  contactPhone: { fontSize: 12, color: GRAY, marginTop: 1 },
  addChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#EEF0FF', borderRadius: 12, borderWidth: 1, borderColor: PRIMARY },
  addChipText: { fontSize: 12, fontWeight: '700', color: PRIMARY },
})
