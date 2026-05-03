import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Pressable, RefreshControl, ActivityIndicator,
  Alert, Linking, TextInput,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Contacts from 'expo-contacts'
import { useRouter } from 'expo-router'
import { saveContactPhoneMap } from '../../lib/contactNames'


const INVITE_MSG = `Hey! Join me on Tryber 🚀\nDownload: https://ravemm-hub.github.io/trybe-app`
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F9FD'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'
const RED = '#FF3B30'

type ChatItem = {
  id: string; type: 'group' | 'dm'; name: string; avatar: string
  last_message: string | null; last_message_at: string | null; unread: number
  status?: string; member_count?: number; min_members?: number
  is_private?: boolean; other_user_id?: string
}

type Contact = {
  id: string; name: string; phone: string; initials: string
  onTryber: boolean; tryberUserId?: string; tryberUsername?: string; avatar_char?: string
}

export default function ChatsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [activeTab, setActiveTab] = useState<'trybes' | 'chats'>('trybes')
  const [groups, setGroups] = useState<ChatItem[]>([])
  const [dms, setDms] = useState<ChatItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data: memberData } = await supabase.from('group_members').select('group_id, last_read_at, groups(*)').eq('user_id', user.id)
      const groupItems: ChatItem[] = []
      for (const m of memberData || []) {
        const g = (m as any).groups
        if (!g || g.status === 'archived') continue
        const { data: msgs } = await supabase.from('messages').select('content, created_at').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)
        let unread = 0
        if (m.last_read_at) {
          const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('group_id', g.id).neq('user_id', user.id).gt('created_at', m.last_read_at)
          unread = count || 0
        }
        groupItems.push({ id: g.id, type: 'group', name: g.name, avatar: g.is_private ? '🔒' : '⚡', last_message: msgs?.[0]?.content || null, last_message_at: msgs?.[0]?.created_at || g.created_at, unread, status: g.status, member_count: g.member_count, min_members: g.min_members, is_private: g.is_private })
      }
      groupItems.sort((a, b) => new Date(b.last_message_at || '').getTime() - new Date(a.last_message_at || '').getTime())
      setGroups(groupItems)
      const { data: dmData } = await supabase.from('dm_messages').select('*').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).order('created_at', { ascending: false })
      const dmMap = new Map<string, any>()
      for (const dm of dmData || []) {
        const otherId = dm.sender_id === user.id ? dm.receiver_id : dm.sender_id
        if (!dmMap.has(otherId)) dmMap.set(otherId, dm)
      }
      const dmItems: ChatItem[] = []
      for (const [otherId, lastDm] of dmMap.entries()) {
        const { data: p } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', otherId).single()
        const name = p?.display_name || p?.username || 'Unknown'
        dmItems.push({ id: `dm_${otherId}`, type: 'dm', name, avatar: p?.avatar_char || name[0] || '?', last_message: lastDm.content, last_message_at: lastDm.created_at, unread: 0, other_user_id: otherId })
      }
      setDms(dmItems)
    } catch (err: any) { console.error(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  const loadContacts = useCallback(async () => {
    if (contactsLoaded) return
    setContactsLoading(true)
    try {
      const { status } = await Contacts.requestPermissionsAsync()
      if (status !== 'granted') { setContactsLoading(false); return }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], sort: Contacts.SortTypes.FirstName })
      const contactList: Contact[] = []
      for (const c of data) {
        if (!c.phoneNumbers?.length || !c.name) continue
        const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
        if (!phone) continue
        const initials = c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
        contactList.push({ id: c.id || phone, name: c.name, phone, initials, onTryber: false })
      }
      if (contactList.length > 0) {
        // Save phone→name mapping for later use in chat
        await saveContactPhoneMap(contactList)
        const phones = contactList.map(c => c.phone)
        // Also try with +972 prefix normalization
        const phonesNormalized = phones.map(p => p.startsWith('0') ? '+972' + p.slice(1) : p)
        const allPhones = [...new Set([...phones, ...phonesNormalized])]
        const { data: tryberUsers } = await supabase.from('profiles').select('id, username, display_name, phone, avatar_char').in('phone', allPhones)
        const tryberMap = new Map()
        for (const u of tryberUsers || []) {
          if (u.phone) {
            tryberMap.set(u.phone, u)
            // Also map normalized version
            if (u.phone.startsWith('0')) tryberMap.set('+972' + u.phone.slice(1), u)
            if (u.phone.startsWith('+972')) tryberMap.set('0' + u.phone.slice(4), u)
          }
        }
        const enriched = contactList.map(c => {
          const t = tryberMap.get(c.phone) || tryberMap.get(c.phone.startsWith('0') ? '+972' + c.phone.slice(1) : c.phone)
          return { ...c, onTryber: !!t, tryberUserId: t?.id, tryberUsername: t?.display_name || t?.username, avatar_char: t?.avatar_char }
        })
        enriched.sort((a, b) => a.onTryber === b.onTryber ? a.name.localeCompare(b.name) : a.onTryber ? -1 : 1)
        setContacts(enriched)
      }
      setContactsLoaded(true)
    } catch {} finally { setContactsLoading(false) }
  }, [contactsLoaded])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (activeTab === 'chats') loadContacts() }, [activeTab])
  useEffect(() => {
    const channel = supabase.channel('chats-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => loadAll())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAll])

  const markGroupRead = async (groupId: string) => {
    if (!userId) return
    await supabase.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', groupId).eq('user_id', userId)
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, unread: 0 } : g))
  }

  const leaveGroup = (item: ChatItem) => {
    Alert.alert('Leave group', `Leave "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        await supabase.from('group_members').delete().eq('group_id', item.id).eq('user_id', userId)
        setGroups(prev => prev.filter(g => g.id !== item.id))
      }}
    ])
  }

  const inviteContact = (contact: Contact) => {
    Alert.alert(`Invite ${contact.name}`, '', [
      { text: '💚 WhatsApp', onPress: () => Linking.openURL(`whatsapp://send?phone=${contact.phone}&text=${encodeURIComponent(INVITE_MSG)}`) },
      { text: '💬 SMS', onPress: () => Linking.openURL(`sms:${contact.phone}?body=${encodeURIComponent(INVITE_MSG)}`) },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  const totalUnread = groups.reduce((sum, i) => sum + i.unread, 0)
  const filteredContacts = contacts.filter(c => !contactSearch.trim() || c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch))

  const renderGroupRow = (item: ChatItem) => {
    const hasUnread = item.unread > 0
    const isOpen = item.status === 'open'
    return (
      <Pressable style={s.row} onPress={() => { markGroupRead(item.id); if (isOpen) router.push({ pathname: '/chat', params: { id: item.id, name: item.name, members: item.member_count?.toString() || '0' } }); else router.push({ pathname: '/lobby', params: { id: item.id, name: item.name } }) }} onLongPress={() => Alert.alert(item.name, '', [{ text: '🚪 Leave', style: 'destructive', onPress: () => leaveGroup(item) }, { text: 'Cancel', style: 'cancel' }])}>
        <View style={[s.avatar, { backgroundColor: '#EEF0FF' }]}>
          <Text style={s.avatarText}>{item.avatar}</Text>
          {isOpen && <View style={s.liveDot} />}
        </View>
        <View style={s.rowInfo}>
          <View style={s.rowTop}>
            <Text style={[s.rowName, hasUnread && s.rowNameBold]} numberOfLines={1}>{item.name}</Text>
            {item.last_message_at && <Text style={[s.rowTime, hasUnread && { color: PRIMARY }]}>{formatTime(item.last_message_at)}</Text>}
          </View>
          <View style={s.rowBottom}>
            <Text style={[s.rowLastMsg, hasUnread && s.rowLastMsgBold]} numberOfLines={1}>{item.last_message || (isOpen ? '🟢 Live now' : `⏳ ${item.member_count}/${item.min_members} to unlock`)}</Text>
            {hasUnread && <View style={s.unreadBadge}><Text style={s.unreadBadgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
          </View>
        </View>
      </Pressable>
    )
  }

  const renderDMRow = (item: ChatItem) => (
    <Pressable style={s.row} onPress={() => router.push({ pathname: '/dm', params: { userId: item.other_user_id, userName: item.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
      <View style={[s.avatar, { backgroundColor: '#E8F5F3' }]}>
        <Text style={s.avatarText}>{item.avatar}</Text>
      </View>
      <View style={s.rowInfo}>
        <View style={s.rowTop}>
          <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
          {item.last_message_at && <Text style={s.rowTime}>{formatTime(item.last_message_at)}</Text>}
        </View>
        <Text style={s.rowLastMsg} numberOfLines={1}>{item.last_message || 'Start chatting'}</Text>
      </View>
    </Pressable>
  )

  const chatsData = [
    ...dms.map(d => ({ type: 'dm' as const, data: d })),
    { type: 'divider' as const },
    { type: 'search' as const },
    ...filteredContacts.map(c => ({ type: 'contact' as const, data: c })),
  ]

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CARD} />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.logo}>tryber</Text>
          {totalUnread > 0 && <View style={s.totalUnread}><Text style={s.totalUnreadText}>{totalUnread > 99 ? '99+' : totalUnread}</Text></View>}
        </View>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
          <Text style={s.createBtnText}>+ Trybe</Text>
        </TouchableOpacity>
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, activeTab === 'trybes' && s.tabBtnActive]} onPress={() => setActiveTab('trybes')}>
          <Text style={[s.tabBtnText, activeTab === 'trybes' && s.tabBtnTextActive]}>⚡ Trybes {groups.length > 0 ? `(${groups.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, activeTab === 'chats' && s.tabBtnActive]} onPress={() => setActiveTab('chats')}>
          <Text style={[s.tabBtnText, activeTab === 'chats' && s.tabBtnTextActive]}>💬 Chats {dms.length > 0 ? `(${dms.length})` : ''}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={PRIMARY} size="large" /></View>
      ) : activeTab === 'trybes' ? (
        <FlatList
          data={groups}
          keyExtractor={i => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll() }} tintColor={PRIMARY} />}
          contentContainerStyle={groups.length === 0 ? s.listEmpty : { paddingVertical: 8 }}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>⚡</Text>
              <Text style={s.emptyTitle}>No trybes yet</Text>
              <Text style={s.emptySub}>Join groups on Explore or create your own</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(tabs)/explore')}>
                <Text style={s.emptyBtnText}>📡 Explore Trybes</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => renderGroupRow(item)}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      ) : (
        <FlatList
          data={chatsData}
          keyExtractor={(item, i) => item.type === 'dm' ? item.data.id : item.type === 'contact' ? item.data.id : `${item.type}_${i}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll() }} tintColor={PRIMARY} />}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            if (item.type === 'dm') return renderDMRow(item.data)
            if (item.type === 'divider') return (
              <View style={s.sectionDivider}>
                <Text style={s.sectionDividerText}>{contactsLoading ? 'Loading contacts...' : `Contacts · ${contacts.filter(c => c.onTryber).length} on Tryber`}</Text>
              </View>
            )
            if (item.type === 'search') return (
              <View style={s.searchRow}>
                <TextInput style={s.searchInput} value={contactSearch} onChangeText={setContactSearch} placeholder="Search contacts..." placeholderTextColor="#B4B2A9" />
              </View>
            )
            if (item.type === 'contact') {
              const c = item.data
              return (
                <View style={s.contactRow}>
                  <View style={[s.avatar, c.onTryber ? { backgroundColor: '#E8F5F3', borderWidth: 2, borderColor: TEAL } : { backgroundColor: '#F0F0F8' }]}>
                    <Text style={s.avatarText}>{c.avatar_char || c.initials}</Text>
                    {c.onTryber && <View style={[s.liveDot, { backgroundColor: TEAL }]} />}
                  </View>
                  <View style={s.rowInfo}>
                    <Text style={s.rowName}>{c.name}</Text>
                    <Text style={[s.rowLastMsg, c.onTryber && { color: TEAL }]}>{c.onTryber ? '✦ On Tryber' : c.phone}</Text>
                  </View>
                  {c.onTryber ? (
                    <TouchableOpacity style={s.contactActionBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: c.tryberUserId, userName: c.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
                      <Text style={s.contactActionText}>Message</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[s.contactActionBtn, { backgroundColor: '#F0F0F8' }]} onPress={() => inviteContact(c)}>
                      <Text style={[s.contactActionText, { color: PRIMARY }]}>Invite</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            }
            return null
          }}
          ItemSeparatorComponent={({ leadingItem }) => leadingItem?.type === 'divider' || leadingItem?.type === 'search' ? null : <View style={s.separator} />}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { fontSize: 28, fontWeight: '900', color: PRIMARY, letterSpacing: -1 },
  totalUnread: { backgroundColor: RED, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  totalUnreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  createBtn: { backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: CARD, paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: '#F0F0F8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: PRIMARY },
  tabBtnText: { fontSize: 13, fontWeight: '700', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 12 },
  emptyEmoji: { fontSize: 52, marginBottom: 8 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
  emptyBtn: { backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20, width: '100%', alignItems: 'center' },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarText: { fontSize: 24 },
  liveDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: TEAL, borderWidth: 2, borderColor: CARD },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { fontSize: 15, fontWeight: '600', color: TEXT, flex: 1 },
  rowNameBold: { fontWeight: '800' },
  rowTime: { fontSize: 11, color: GRAY },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLastMsg: { fontSize: 13, color: GRAY, flex: 1 },
  rowLastMsgBold: { color: TEXT, fontWeight: '600' },
  unreadBadge: { backgroundColor: PRIMARY, borderRadius: 12, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  separator: { height: 0.5, backgroundColor: '#EBEBEB', marginLeft: 80 },
  sectionDivider: { backgroundColor: '#F0F0F8', paddingHorizontal: 16, paddingVertical: 8 },
  sectionDividerText: { fontSize: 12, color: GRAY, fontWeight: '600', letterSpacing: 0.3 },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  searchInput: { backgroundColor: '#F0F0F8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD },
  contactActionBtn: { backgroundColor: '#E8F5F3', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  contactActionText: { fontSize: 13, color: TEAL, fontWeight: '700' },
})
