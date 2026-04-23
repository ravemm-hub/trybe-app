import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, TextInput, Alert, Linking, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Contacts from 'expo-contacts'
import * as SMS from 'expo-sms'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

const INVITE_MSG = `Hey! I'm using Tryber — The Next Generation of SocialAIsing 🚀\nJoin me here: https://ravemm-hub.github.io/trybe-app`

type Contact = {
  id: string
  name: string
  phone: string
  initials: string
  onTryber: boolean
  tryberUserId?: string
  tryberUsername?: string
}

export default function ContactsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filtered, setFiltered] = useState<Contact[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => { loadContacts() }, [])

  useEffect(() => {
    if (!search.trim()) { setFiltered(contacts); return }
    const q = search.toLowerCase()
    setFiltered(contacts.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q)))
  }, [search, contacts])

  const loadContacts = async () => {
    setLoading(true)
    try {
      const { status } = await Contacts.requestPermissionsAsync()
      if (status !== 'granted') { setPermissionDenied(true); setLoading(false); return }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        sort: Contacts.SortTypes.FirstName,
      })

      // Normalize phone numbers
      const contactList: Contact[] = []
      for (const c of data) {
        if (!c.phoneNumbers?.length || !c.name) continue
        const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
        if (!phone) continue
        const initials = c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
        contactList.push({ id: c.id || phone, name: c.name, phone, initials, onTryber: false })
      }

      // Check who's on Tryber by phone
      const phones = contactList.map(c => c.phone)
      const { data: tryberUsers } = await supabase
        .from('profiles')
        .select('id, username, display_name, phone')
        .in('phone', phones)

      const tryberMap = new Map((tryberUsers || []).map((u: any) => [u.phone, u]))

      const enriched = contactList.map(c => {
        const tryberUser = tryberMap.get(c.phone)
        return {
          ...c,
          onTryber: !!tryberUser,
          tryberUserId: tryberUser?.id,
          tryberUsername: tryberUser?.display_name || tryberUser?.username,
        }
      })

      // Sort: Tryber users first
      enriched.sort((a, b) => {
        if (a.onTryber && !b.onTryber) return -1
        if (!a.onTryber && b.onTryber) return 1
        return a.name.localeCompare(b.name)
      })

      setContacts(enriched)
      setFiltered(enriched)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }

  const inviteContact = async (contact: Contact) => {
    Alert.alert(
      `Invite ${contact.name}`,
      'How would you like to invite?',
      [
        {
          text: '💚 WhatsApp',
          onPress: () => Linking.openURL(`whatsapp://send?phone=${contact.phone}&text=${encodeURIComponent(INVITE_MSG)}`)
        },
        {
          text: '💬 SMS',
          onPress: async () => {
            const isAvailable = await SMS.isAvailableAsync()
            if (isAvailable) {
              await SMS.sendSMSAsync([contact.phone], INVITE_MSG)
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    )
  }

  const openDM = (contact: Contact) => {
    if (!contact.tryberUserId) return
    router.push({
      pathname: '/dm',
      params: { userId: contact.tryberUserId, userName: contact.tryberUsername || contact.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' }
    })
  }

  const tryberCount = contacts.filter(c => c.onTryber).length
  const notOnTryber = contacts.filter(c => !c.onTryber).length

  if (permissionDenied) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹</Text></TouchableOpacity>
          <Text style={s.title}>Contacts</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.center}>
          <Text style={s.permEmoji}>📱</Text>
          <Text style={s.permTitle}>Contacts access needed</Text>
          <Text style={s.permSub}>Allow Tryber to access your contacts to find friends</Text>
          <TouchableOpacity style={s.permBtn} onPress={() => Linking.openSettings()}>
            <Text style={s.permBtnText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹</Text></TouchableOpacity>
        <Text style={s.title}>Contacts</Text>
        <View style={{ width: 40 }} />
      </View>

      {!loading && contacts.length > 0 && (
        <View style={s.statsBar}>
          <Text style={s.statsText}>
            <Text style={{ color: GREEN, fontWeight: '700' }}>{tryberCount}</Text> on Tryber · 
            <Text style={{ color: '#888' }}> {notOnTryber} to invite</Text>
          </Text>
        </View>
      )}

      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search contacts..."
          placeholderTextColor="#B4B2A9"
        />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.loadingText}>Loading contacts...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyText}>No contacts found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.contactRow}>
              <View style={[s.avatar, item.onTryber && s.avatarOnTryber]}>
                <Text style={s.avatarText}>{item.initials}</Text>
                {item.onTryber && <View style={s.onTryberDot} />}
              </View>
              <View style={s.contactInfo}>
                <Text style={s.contactName}>{item.name}</Text>
                {item.onTryber
                  ? <Text style={s.onTryberLabel}>✦ On Tryber — @{item.tryberUsername}</Text>
                  : <Text style={s.phoneLabel}>{item.phone}</Text>
                }
              </View>
              {item.onTryber ? (
                <TouchableOpacity style={s.messageBtn} onPress={() => openDM(item)}>
                  <Text style={s.messageBtnText}>💬 Message</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.inviteBtn} onPress={() => inviteContact(item)}>
                  <Text style={s.inviteBtnText}>Invite</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  back: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  title: { fontSize: 17, fontWeight: '700', color: '#2C2C2A' },
  statsBar: { backgroundColor: '#E1F5EE', paddingHorizontal: 16, paddingVertical: 8 },
  statsText: { fontSize: 13, color: '#2C2C2A' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  list: { paddingBottom: 20 },
  loadingText: { marginTop: 16, fontSize: 14, color: GRAY },
  emptyText: { fontSize: 15, color: GRAY },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarOnTryber: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  onTryberDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: GREEN, borderWidth: 2, borderColor: '#fff' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 2 },
  onTryberLabel: { fontSize: 12, color: GREEN, fontWeight: '500' },
  phoneLabel: { fontSize: 12, color: GRAY },
  messageBtn: { backgroundColor: '#E1F5EE', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  messageBtnText: { fontSize: 13, color: GREEN, fontWeight: '600' },
  inviteBtn: { backgroundColor: '#EEEDFE', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  inviteBtnText: { fontSize: 13, color: PURPLE, fontWeight: '600' },
  separator: { height: 0.5, backgroundColor: '#E0DED8', marginLeft: 76 },
  permEmoji: { fontSize: 56, marginBottom: 16 },
  permTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  permSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  permBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
