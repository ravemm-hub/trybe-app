import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, Alert, RefreshControl, ActivityIndicator, Modal, ScrollView, Image, KeyboardAvoidingView, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { uploadMedia, pickImageAsset } from '../../src/lib/upload'
import { askClaude } from '../../src/lib/claude'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../../src/constants'

const MAX_PHOTOS = 8

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
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [detailIndex, setDetailIndex] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    load()
  }, [])

  // Reload when returning to this tab so freshly-listed items show up.
  useFocusEffect(useCallback(() => { load() }, []))

  const load = async () => {
    let q = supabase.from('listings').select('*, profile:profiles(id,display_name,username,avatar_char)').eq('status', 'active').order('created_at', { ascending: false }).limit(50)
    const { data } = await q
    setListings(data || [])
    setLoading(false); setRefreshing(false)
  }

  const createListing = async () => {
    if (!title.trim()) return
    if (!userId) { Alert.alert('Sign in required', 'Your session expired — please sign in again.'); return }
    setPosting(true)
    const { error } = await supabase.from('listings').insert({
      user_id: userId, title: title.trim(), description: description.trim() || null,
      price: price ? parseFloat(price) : 0, category: newCategory, status: 'active',
      // Back-compat: keep first photo in media_url; full gallery in media_urls jsonb.
      media_url: mediaUrls[0] || null, media_urls: mediaUrls.length ? mediaUrls : null,
    })
    setPosting(false)
    if (error) { Alert.alert('Could not create listing', error.message); return }
    setTitle(''); setDescription(''); setPrice(''); setNewCategory('Items'); setMediaUrls([])
    setShowCreate(false); load()
  }

  const pickMedia = async () => {
    if (!userId) return
    if (mediaUrls.length >= MAX_PHOTOS) {
      Alert.alert('Max photos reached', 'You can add up to ' + MAX_PHOTOS + ' photos per listing.')
      return
    }
    const asset = await pickImageAsset()
    if (!asset) return
    setUploadingMedia(true)
    const url = await uploadMedia(asset.uri, 'image', asset.ext)
    setUploadingMedia(false)
    if (url) setMediaUrls(prev => [...prev, url])
    else Alert.alert('Upload failed', 'Could not upload the image.')
  }

  const removeMedia = (idx: number) => {
    setMediaUrls(prev => prev.filter((_, i) => i !== idx))
  }

  const aiSuggest = async () => {
    const firstImage = mediaUrls[0] || null
    if (!firstImage && !title.trim()) { Alert.alert('Add an image or a title first', 'Teeby needs something to work with ✦'); return }
    setAiBusy(true)
    const cats = CATEGORIES.filter(c => c !== 'All').join(', ')
    const prompt = firstImage
      ? `Identify the product in the image. Suggest a realistic title (3-6 words), one-sentence description, a fair price in ILS, and one category from: ${cats}. Reply ONLY as compact JSON: {"title":"...","description":"...","price":NUMBER,"category":"..."}`
      : `User is listing for sale: "${title.trim()}". Suggest a fair price in ILS, a one-sentence description, and one category from: ${cats}. Reply ONLY as compact JSON: {"title":"...","description":"...","price":NUMBER,"category":"..."}`
    const reply = await askClaude(prompt, 'You are a marketplace assistant. Be precise and honest about prices in ILS.', 300, true, firstImage || undefined)
    setAiBusy(false)
    try {
      const m = reply.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('no json')
      const j = JSON.parse(m[0])
      if (j.title) setTitle(String(j.title))
      if (j.description) setDescription(String(j.description))
      if (j.price != null) setPrice(String(j.price))
      if (j.category && CATEGORIES.includes(j.category)) setNewCategory(j.category)
    } catch { Alert.alert("Couldn't read Teeby's suggestion", 'Try again or fill it in manually.') }
  }

  // Returns the gallery for a listing — prefers new media_urls array, falls back to media_url.
  const galleryOf = (l: any): string[] => {
    if (Array.isArray(l?.media_urls) && l.media_urls.length) return l.media_urls.filter(Boolean)
    if (l?.media_url) return [l.media_url]
    return []
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
        renderItem={({ item: l }) => {
          const photos = galleryOf(l)
          return (
            <TouchableOpacity style={s.card} onPress={() => { setSelected(l); setDetailIndex(0) }}>
              {photos.length > 0 && (
                <View style={{ position: 'relative' }}>
                  <Image source={{ uri: photos[0] }} style={s.thumb} resizeMode="cover" />
                  {photos.length > 1 && (
                    <View style={s.photoCountBadge}>
                      <Text style={s.photoCountText}>📷 {photos.length}</Text>
                    </View>
                  )}
                </View>
              )}
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
                  <TouchableOpacity style={s.dmBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: l.user_id, userName: l.profile?.display_name || 'Seller', myMode: 'lit', theirMode: 'lit', myAvatar: '🛍️', isAgent: '0' } })}>
                    <Text style={s.dmBtnText}>💬 Message seller</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )
        }}
      />

      {/* Create listing modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior="padding" keyboardVerticalOffset={0}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New Listing</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalLabel}>PHOTOS ({mediaUrls.length}/{MAX_PHOTOS})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {mediaUrls.map((url, i) => (
                  <View key={url + i} style={s.galleryItem}>
                    <Image source={{ uri: url }} style={s.galleryImg} resizeMode="cover" />
                    <TouchableOpacity style={s.galleryRemove} onPress={() => removeMedia(i)}>
                      <Text style={s.galleryRemoveText}>✕</Text>
                    </TouchableOpacity>
                    {i === 0 && <View style={s.galleryMainBadge}><Text style={s.galleryMainBadgeText}>Main</Text></View>}
                  </View>
                ))}
                {mediaUrls.length < MAX_PHOTOS && (
                  <TouchableOpacity style={s.galleryAdd} onPress={pickMedia} disabled={uploadingMedia}>
                    {uploadingMedia
                      ? <ActivityIndicator color={PRIMARY} />
                      : <>
                          <Text style={s.galleryAddPlus}>＋</Text>
                          <Text style={s.galleryAddText}>{mediaUrls.length === 0 ? 'Add photo' : 'Add another'}</Text>
                        </>}
                  </TouchableOpacity>
                )}
              </ScrollView>

              <View style={s.titleRow}>
                <Text style={s.modalLabel}>TITLE *</Text>
                <TouchableOpacity style={s.aiChip} onPress={aiSuggest} disabled={aiBusy}>
                  {aiBusy ? <ActivityIndicator color={PRIMARY} size="small" /> : <Text style={s.aiChipText}>✦ Teeby suggest</Text>}
                </TouchableOpacity>
              </View>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Listing detail modal */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={s.detailOverlay}>
          <View style={s.detailCard}>
            <TouchableOpacity style={s.detailClose} onPress={() => setSelected(null)}>
              <Text style={s.detailCloseText}>✕</Text>
            </TouchableOpacity>
            {selected && (() => {
              const photos = galleryOf(selected)
              const w = Dimensions.get('window').width - 32
              return (
                <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                  {photos.length > 0 && (
                    <View>
                      <ScrollView
                        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={(e) => setDetailIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
                        style={{ width: w, height: 260, borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}
                      >
                        {photos.map((u, i) => (
                          <Image key={u + i} source={{ uri: u }} style={{ width: w, height: 260 }} resizeMode="cover" />
                        ))}
                      </ScrollView>
                      {photos.length > 1 && (
                        <View style={s.dotRow}>
                          {photos.map((_, i) => (
                            <View key={i} style={[s.dot, i === detailIndex && s.dotActive]} />
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  <Text style={[s.modalTitle, { marginTop: 12 }]}>{selected.title}</Text>
                  <Text style={[s.cardPrice, { fontSize: 26, marginBottom: 10 }]}>{selected.price > 0 ? '₪' + selected.price : 'Free'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <View style={s.sellerAvatar}>
                      <Text style={s.sellerAvatarText}>{selected.profile?.avatar_char || selected.profile?.display_name?.[0] || '?'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle}>{selected.profile?.display_name || selected.profile?.username || 'Seller'}</Text>
                      <Text style={s.cardMeta}>{fmt(selected.created_at)}</Text>
                    </View>
                    <View style={s.catTag}><Text style={s.catTagText}>{selected.category}</Text></View>
                  </View>
                  {selected.description ? <Text style={[s.cardDesc, { fontSize: 14, lineHeight: 20, marginBottom: 16 }]}>{selected.description}</Text> : null}
                  {selected.user_id !== userId && (
                    <TouchableOpacity style={[s.submitBtn, { marginTop: 4 }]} onPress={() => { setSelected(null); router.push({ pathname: '/dm', params: { userId: selected.user_id, userName: selected.profile?.display_name || 'Seller', myMode: 'lit', theirMode: 'lit', myAvatar: '🛍️', isAgent: '0' } }) }}>
                      <Text style={s.submitBtnText}>💬 Message seller</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              )
            })()}
          </View>
        </View>
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
  thumb: { width: '100%', height: 160, borderRadius: 12, marginBottom: 8 },
  photoCountBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  photoCountText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  galleryItem: { position: 'relative', width: 120, height: 120, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  galleryImg: { width: 120, height: 120 },
  galleryRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  galleryRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  galleryMainBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: PRIMARY, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  galleryMainBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  galleryAdd: { width: 120, height: 120, borderRadius: 12, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed' as any },
  galleryAddPlus: { fontSize: 30, color: PRIMARY, fontWeight: '700', marginBottom: 2 },
  galleryAddText: { fontSize: 11, color: GRAY, fontWeight: '600' },
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  detailCard: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 14, maxHeight: '92%' },
  detailClose: { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  detailCloseText: { fontSize: 18, color: TEXT, fontWeight: '700' },
  dotRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BORDER },
  dotActive: { backgroundColor: PRIMARY, width: 18 },
  photoBox: { width: '100%', height: 140, borderRadius: 12, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  photoPlaceholder: { fontSize: 15, color: GRAY, fontWeight: '600' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  aiChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#EEF0FF', borderWidth: 1, borderColor: PRIMARY },
  aiChipText: { fontSize: 12, color: PRIMARY, fontWeight: '700' },
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
