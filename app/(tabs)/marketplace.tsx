import { useState, useEffect } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, Alert, RefreshControl, ActivityIndicator, Modal, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../../src/constants'

const CATEGORIES = ['All', 'Items', 'Services', 'Housing', 'Jobs', 'Other']

export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [listings, setListings] = useState<any[]>([])
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<any | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [newCategory, setNewCategory] = useState('Items')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    load()
  }, [])

  const load = async () => {
    let q = supabase.from('listings').select('*, profile:profiles(id,display_name,username,avatar_char)').eq('status', 'active').order('created_at', { ascending: false }).limit(50)
    const { data } = await q
    setListings(data || [])
    setLoading(false); setRefreshing(false)
  }

  const createListing = async () => {
    if (!title.trim() || !userId) return
    setPosting(true)
    try {
      await supabase.from('listings').insert({ user_id: userId, title: title.trim(), description: description.trim() || null, price: price ? parseFloat(price) : 0, category: newCategory, status: 'active' })
      setTitle(''); setDescription(''); setPrice(''); setNewCategory('Items')
      setShowCreate(false); load()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setPosting(false) }
  }

  const filtered = category === 'All' ? listings : listings.filter(l => l.category === category)

  const fmt = (ts: string) => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.title}>Marketplace</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => setShowCreate(true)}>
          <Text style={s.createBtnText}>+ List</Text>
        </TouchableOpacity>
      </View>

      <FlatList horizontal data={CATEGORIES} keyExtractor={c => c} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
        renderItem={({ item: c }) => (
          <TouchableOpacity style={[s.catBtn, category === c && s.catBtnActive]} onPress={() => setCategory(c)}>
            <Text style={[s.catBtnText, category === c && s.catBtnTextActive]}>{c}</Text>
          </TouchableOpacity>
        )}
      />

      <FlatList data={filtered} keyExtractor={l => l.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={PRIMARY} />}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>🛍️</Text><Text style={s.emptyTitle}>Nothing listed yet</Text><TouchableOpacity style={s.emptyBtn} onPress={() => setShowCreate(true)}><Text style={s.emptyBtnText}>List something</Text></TouchableOpacity></View>}
        renderItem={({ item: l }) => (
          <TouchableOpacity style={s.card} onPress={() => setSelected(l)}>
            <View style={s.cardHeader}>
              <View style={s.sellerAvatar}>
                <Text style={s.sellerAvatarText}>{l.profile?.avatar_char || l.profile?.display_name?.[0] || '?'}</Text>
              </View>
              <View style={s.cardInfo}>
                <Text style={s.cardTitle} numberOfLines={1}>{l.title}</Text>
                <Text style={s.cardMeta}>{l.profile?.display_name || l.profile?.username} · {fmt(l.created_at)}</Text>
              </View>
              <Text style={s.cardPrice}>{l.price > 0 ? '₪' + l.price : 'Free'}</Text>
            </View>
            {l.description ? <Text style={s.cardDesc} numberOfLines={2}>{l.description}</Text> : null}
            <View style={s.cardFooter}>
              <View style={s.catTag}><Text style={s.catTagText}>{l.category}</Text></View>
              {l.user_id !== userId && (
                <TouchableOpacity style={s.dmBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: l.user_id, userName: l.profile?.display_name || 'Seller', myMode: 'lit', myAvatar: '🛍️', isAgent: '0' } })}>
                  <Text style={s.dmBtnText}>💬 Message seller</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Create listing modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New Listing</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalLabel}>TITLE *</Text>
              <TextInput style={s.modalInput} value={title} onChangeText={setTitle} placeholder="What are you selling?" placeholderTextColor={GRAY} maxLength={80} />
              <Text style={s.modalLabel}>DESCRIPTION</Text>
              <TextInput style={[s.modalInput, { minHeight: 80, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} placeholder="Details..." placeholderTextColor={GRAY} multiline maxLength={500} />
              <Text style={s.modalLabel}>PRICE (₪)</Text>
              <TextInput style={s.modalInput} value={price} onChangeText={setPrice} placeholder="Leave empty if free" placeholderTextColor={GRAY} keyboardType="numeric" />
              <Text style={s.modalLabel}>CATEGORY</Text>
              <View style={s.catRow}>
                {CATEGORIES.filter(c => c !== 'All').map(c => (
                  <TouchableOpacity key={c} style={[s.catChip, newCategory === c && s.catChipActive]} onPress={() => setNewCategory(c)}>
                    <Text style={[s.catChipText, newCategory === c && { color: '#fff' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.modalBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowCreate(false)}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, (!title.trim() || posting) && { opacity: 0.4 }]} onPress={createListing} disabled={!title.trim() || posting}>
                  {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitBtnText}>Post</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Listing detail modal */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={s.modalOverlay} onPress={() => setSelected(null)} activeOpacity={1}>
          {selected && (
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>{selected.title}</Text>
              {selected.description ? <Text style={[s.cardDesc, { marginBottom: 12 }]}>{selected.description}</Text> : null}
              <Text style={[s.cardPrice, { fontSize: 24, marginBottom: 12 }]}>{selected.price > 0 ? '₪' + selected.price : 'Free'}</Text>
              <View style={s.catTag}><Text style={s.catTagText}>{selected.category}</Text></View>
              {selected.user_id !== userId && (
                <TouchableOpacity style={[s.submitBtn, { marginTop: 16 }]} onPress={() => { setSelected(null); router.push({ pathname: '/dm', params: { userId: selected.user_id, userName: selected.profile?.display_name || 'Seller', myMode: 'lit', myAvatar: '🛍️', isAgent: '0' } }) }}>
                  <Text style={s.submitBtnText}>💬 Message seller</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  createBtn: { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  catBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  catBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  catBtnText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  catBtnTextActive: { color: '#fff' },
  card: { backgroundColor: CARD, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: BORDER },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  sellerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  sellerAvatarText: { fontSize: 18 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  cardMeta: { fontSize: 11, color: GRAY },
  cardPrice: { fontSize: 18, fontWeight: '800', color: LIVE },
  cardDesc: { fontSize: 13, color: GRAY, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  catTag: { backgroundColor: '#EEF0FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  catTagText: { fontSize: 11, color: PRIMARY, fontWeight: '600' },
  dmBtn: { backgroundColor: BG, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  dmBtnText: { fontSize: 12, color: TEXT, fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 16 },
  emptyBtn: { backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: TEXT, marginBottom: 16 },
  modalLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 6, marginTop: 14 },
  modalInput: { backgroundColor: BG, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  catChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  catChipText: { fontSize: 13, color: TEXT, fontWeight: '500' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: BG, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  cancelBtnText: { fontSize: 15, color: GRAY, fontWeight: '600' },
  submitBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: PRIMARY, alignItems: 'center' },
  submitBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
})
