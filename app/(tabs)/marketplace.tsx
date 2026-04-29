import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Image, RefreshControl, Pressable, TextInput, Alert,
  Modal, ScrollView, Linking, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F9FD'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

const DELIVERY_SERVICES = [
  { name: 'iShip', url: 'https://www.iship.co.il', emoji: '📦' },
  { name: 'Shippify', url: 'https://shippify.co.il', emoji: '🚚' },
  { name: 'Lalamove', url: 'https://www.lalamove.com/il', emoji: '🏍️' },
  { name: 'Yango Delivery', url: 'https://delivery.yango.com/il', emoji: '🚗' },
]

type Listing = {
  id: string; user_id: string; title: string; description: string | null
  price: number; currency: string; media_url: string | null
  location_name: string | null; status: string
  payment_bit: string | null; payment_paybox: string | null; payment_paypal: string | null
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

type Offer = {
  id: string; listing_id: string; buyer_id: string; seller_id: string
  amount: number; status: 'pending' | 'accepted' | 'rejected' | 'countered'
  counter_amount: number | null; created_at: string
  buyer_profile?: { display_name: string | null; username: string }
}

export default function MarketplaceScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [listings, setListings] = useState<Listing[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [myOffers, setMyOffers] = useState<Offer[]>([])
  const [offerAmount, setOfferAmount] = useState('')
  const [showOfferInput, setShowOfferInput] = useState(false)
  const [counterAmount, setCounterAmount] = useState('')
  const [showCounter, setShowCounter] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [locationName, setLocationName] = useState('')
  const [paymentBit, setPaymentBit] = useState('')
  const [paymentPaybox, setPaymentPaybox] = useState('')
  const [paymentPaypal, setPaymentPaypal] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadListings() }
    })
    getLocation()
  }, [])

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      if (place) setLocationName([place.city, place.district].filter(Boolean).join(', '))
    } catch {}
  }

  const loadListings = useCallback(async () => {
    try {
      const { data } = await supabase.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(50)
      const enriched = await Promise.all((data || []).map(async (l: Listing) => {
        const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', l.user_id).single()
        return { ...l, profile: profile || undefined }
      }))
      setListings(enriched)
    } catch (e: any) { console.error(e.message) }
    finally { setRefreshing(false) }
  }, [])

  const loadOffers = async (listingId: string) => {
    const { data } = await supabase.from('listing_offers').select('*').eq('listing_id', listingId)
    if (!data) return
    const enriched = await Promise.all(data.map(async (o: Offer) => {
      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', o.buyer_id).single()
      return { ...o, buyer_profile: profile || undefined }
    }))
    setOffers(enriched)
    setMyOffers(enriched.filter((o: Offer) => o.buyer_id === userId))
  }

  const openListing = async (listing: Listing) => {
    setSelectedListing(listing)
    await loadOffers(listing.id)
  }

  const sendOffer = async () => {
    if (!offerAmount || !userId || !selectedListing) return
    const amount = parseFloat(offerAmount)
    if (isNaN(amount) || amount <= 0) { Alert.alert('Invalid amount'); return }
    await supabase.from('listing_offers').insert({ listing_id: selectedListing.id, buyer_id: userId, seller_id: selectedListing.user_id, amount, status: 'pending' })
    setOfferAmount(''); setShowOfferInput(false)
    await loadOffers(selectedListing.id)
    Alert.alert('✓ Offer sent!', `Your offer of ₪${amount} was sent.`)
  }

  const respondToOffer = async (offerId: string, action: 'accepted' | 'rejected') => {
    await supabase.from('listing_offers').update({ status: action }).eq('id', offerId)
    if (selectedListing) await loadOffers(selectedListing.id)
    if (action === 'accepted') {
      await supabase.from('listings').update({ status: 'sold' }).eq('id', selectedListing?.id)
      setSelectedListing(null); loadListings()
      Alert.alert('🤝 Deal closed!')
    }
  }

  const sendCounter = async (offerId: string) => {
    if (!counterAmount) return
    const amount = parseFloat(counterAmount)
    if (isNaN(amount)) return
    await supabase.from('listing_offers').update({ status: 'countered', counter_amount: amount }).eq('id', offerId)
    setShowCounter(null); setCounterAmount('')
    if (selectedListing) await loadOffers(selectedListing.id)
  }

  const openDMWithSeller = (listing: Listing) => {
    if (!listing.profile) return
    router.push({ pathname: '/dm', params: { userId: listing.user_id, userName: listing.profile.display_name || listing.profile.username, myMode: 'lit', myAvatar: '🛍️', isAgent: '0' } })
  }

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `listing_${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      await supabase.storage.from('chat-media').upload(`listings/${filename}`, formData)
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`listings/${filename}`)
      setMediaUrl(publicUrl)
      if (asset.base64) {
        setAnalyzing(true)
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: asset.base64 } }, { type: 'text', text: 'What is this item and what price (₪) would you suggest for selling it second-hand in Israel? Reply in Hebrew.' }] }] }),
          })
          const data = await res.json()
          const suggestion = data.content?.[0]?.text?.trim()
          if (suggestion) Alert.alert('🤖 AI Price Suggestion', suggestion)
        } catch {}
        finally { setAnalyzing(false) }
      }
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setUploading(false) }
  }

  const createListing = async () => {
    if (!title.trim()) { Alert.alert('Required', 'Add a title'); return }
    if (!price || isNaN(parseFloat(price))) { Alert.alert('Required', 'Add a valid price'); return }
    if (!userId) return
    setPosting(true)
    try {
      await supabase.from('listings').insert({ user_id: userId, title: title.trim(), description: description.trim() || null, price: parseFloat(price), currency: 'ILS', media_url: mediaUrl, location_name: locationName || null, location: coords ? `POINT(${coords.lon} ${coords.lat})` : null, payment_bit: paymentBit.trim() || null, payment_paybox: paymentPaybox.trim() || null, payment_paypal: paymentPaypal.trim() || null })
      setTitle(''); setDescription(''); setPrice(''); setMediaUrl(null)
      setPaymentBit(''); setPaymentPaybox(''); setPaymentPaypal('')
      setShowAdd(false); loadListings()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setPosting(false) }
  }

  const formatPrice = (p: number) => `₪${p.toLocaleString()}`
  const isOwner = selectedListing?.user_id === userId

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CARD} />
      <View style={s.header}>
        <Text style={s.title}>Marketplace 🛍️</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={s.addBtnText}>+ Sell</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={listings}
        keyExtractor={l => l.id}
        numColumns={2}
        columnWrapperStyle={s.row}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadListings() }} tintColor={PRIMARY} />}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🛍️</Text>
            <Text style={s.emptyTitle}>Nothing for sale yet</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowAdd(true)}>
              <Text style={s.emptyBtnText}>+ List an item</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => openListing(item)}>
            {item.media_url
              ? <Image source={{ uri: item.media_url }} style={s.cardImage} resizeMode="cover" />
              : <View style={s.cardImagePlaceholder}><Text style={{ fontSize: 36 }}>🛒</Text></View>
            }
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={s.cardPrice}>{formatPrice(item.price)}</Text>
              {item.location_name && <Text style={s.cardLocation} numberOfLines={1}>📍 {item.location_name}</Text>}
              <View style={s.sellerRow}>
                <Text style={s.sellerText}>{item.profile?.display_name || item.profile?.username || 'Unknown'}</Text>
              </View>
            </View>
          </Pressable>
        )}
      />

      {/* Detail Modal */}
      <Modal visible={!!selectedListing} animationType="slide" onRequestClose={() => setSelectedListing(null)}>
        {selectedListing && (
          <View style={[s.detailContainer, { paddingTop: insets.top }]}>
            <View style={s.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedListing(null)}>
                <Text style={s.detailBack}>‹ Back</Text>
              </TouchableOpacity>
              {isOwner && (
                <TouchableOpacity onPress={async () => {
                  await supabase.from('listings').update({ status: 'sold' }).eq('id', selectedListing.id)
                  setSelectedListing(null); loadListings()
                }}>
                  <Text style={s.markSold}>Mark Sold</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView>
              {selectedListing.media_url
                ? <Image source={{ uri: selectedListing.media_url }} style={s.detailImage} resizeMode="cover" />
                : <View style={s.detailImagePlaceholder}><Text style={{ fontSize: 64 }}>🛒</Text></View>
              }
              <View style={s.detailBody}>
                <Text style={s.detailTitle}>{selectedListing.title}</Text>
                <Text style={s.detailPrice}>{formatPrice(selectedListing.price)}</Text>
                {selectedListing.location_name && <Text style={s.detailLocation}>📍 {selectedListing.location_name}</Text>}
                {selectedListing.description && <Text style={s.detailDesc}>{selectedListing.description}</Text>}

                <View style={s.sellerCard}>
                  <View style={s.sellerAvatar}>
                    <Text style={{ fontSize: 20 }}>{selectedListing.profile?.avatar_char || selectedListing.profile?.display_name?.[0] || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sellerName}>{selectedListing.profile?.display_name || selectedListing.profile?.username}</Text>
                    <Text style={s.sellerLabel}>Seller</Text>
                  </View>
                  {!isOwner && (
                    <TouchableOpacity style={s.msgSellerBtn} onPress={() => openDMWithSeller(selectedListing)}>
                      <Text style={s.msgSellerText}>💬 Message</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!isOwner && (
                  <>
                    <Text style={s.sectionTitle}>MAKE AN OFFER</Text>
                    {myOffers.length > 0 ? (
                      myOffers.map(offer => (
                        <View key={offer.id} style={s.offerCard}>
                          <Text style={s.offerText}>Your offer: {formatPrice(offer.amount)}</Text>
                          {offer.status === 'pending' && <Text style={s.offerStatus}>⏳ Waiting for seller</Text>}
                          {offer.status === 'accepted' && <Text style={[s.offerStatus, { color: TEAL }]}>✓ Accepted!</Text>}
                          {offer.status === 'rejected' && <Text style={[s.offerStatus, { color: '#FF3B30' }]}>✗ Rejected</Text>}
                          {offer.status === 'countered' && offer.counter_amount && (
                            <>
                              <Text style={[s.offerStatus, { color: '#FF9500' }]}>Counter: {formatPrice(offer.counter_amount)}</Text>
                              <View style={s.offerActions}>
                                <TouchableOpacity style={s.offerAcceptBtn} onPress={() => respondToOffer(offer.id, 'accepted')}>
                                  <Text style={s.offerAcceptText}>Accept ✓</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={s.offerRejectBtn} onPress={() => respondToOffer(offer.id, 'rejected')}>
                                  <Text style={s.offerRejectText}>Decline</Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          )}
                        </View>
                      ))
                    ) : showOfferInput ? (
                      <View style={s.offerInputRow}>
                        <TextInput style={s.offerInput} value={offerAmount} onChangeText={setOfferAmount} placeholder={`e.g. ${Math.round(selectedListing.price * 0.8)}`} placeholderTextColor="#B4B2A9" keyboardType="numeric" autoFocus />
                        <TouchableOpacity style={s.offerSendBtn} onPress={sendOffer}>
                          <Text style={s.offerSendText}>Send</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={s.makeOfferBtn} onPress={() => setShowOfferInput(true)}>
                        <Text style={s.makeOfferText}>💰 Make an offer</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {isOwner && offers.length > 0 && (
                  <>
                    <Text style={s.sectionTitle}>OFFERS ({offers.length})</Text>
                    {offers.map(offer => (
                      <View key={offer.id} style={s.offerCard}>
                        <Text style={s.offerText}>{offer.buyer_profile?.display_name || 'Buyer'}: {formatPrice(offer.amount)}</Text>
                        {offer.status === 'pending' && (
                          showCounter === offer.id ? (
                            <View style={s.offerInputRow}>
                              <TextInput style={s.offerInput} value={counterAmount} onChangeText={setCounterAmount} placeholder="Counter..." placeholderTextColor="#B4B2A9" keyboardType="numeric" autoFocus />
                              <TouchableOpacity style={s.offerSendBtn} onPress={() => sendCounter(offer.id)}>
                                <Text style={s.offerSendText}>Send</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <View style={s.offerActions}>
                              <TouchableOpacity style={s.offerAcceptBtn} onPress={() => respondToOffer(offer.id, 'accepted')}>
                                <Text style={s.offerAcceptText}>Accept ✓</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[s.offerAcceptBtn, { backgroundColor: '#FF9500' }]} onPress={() => setShowCounter(offer.id)}>
                                <Text style={s.offerAcceptText}>Counter</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={s.offerRejectBtn} onPress={() => respondToOffer(offer.id, 'rejected')}>
                                <Text style={s.offerRejectText}>Decline</Text>
                              </TouchableOpacity>
                            </View>
                          )
                        )}
                        {offer.status === 'accepted' && <Text style={[s.offerStatus, { color: TEAL }]}>✓ Accepted</Text>}
                        {offer.status === 'countered' && <Text style={[s.offerStatus, { color: '#FF9500' }]}>Counter sent: {formatPrice(offer.counter_amount || 0)}</Text>}
                      </View>
                    ))}
                  </>
                )}

                <Text style={s.sectionTitle}>PAY WITH</Text>
                <View style={s.paymentBtns}>
                  {selectedListing.payment_bit && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#E8F4FD' }]} onPress={() => Linking.openURL(`https://www.bitpay.co.il/app/payment-page/${selectedListing.payment_bit}`)}>
                      <Text style={s.payBtnEmoji}>💸</Text><Text style={s.payBtnText}>Bit</Text>
                    </TouchableOpacity>
                  )}
                  {selectedListing.payment_paybox && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#FFF0E6' }]} onPress={() => Linking.openURL(`https://payboxapp.page.link/pay/${selectedListing.payment_paybox}`)}>
                      <Text style={s.payBtnEmoji}>📱</Text><Text style={s.payBtnText}>Paybox</Text>
                    </TouchableOpacity>
                  )}
                  {selectedListing.payment_paypal && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#E6F0FA' }]} onPress={() => Linking.openURL(`https://paypal.me/${selectedListing.payment_paypal}`)}>
                      <Text style={s.payBtnEmoji}>💳</Text><Text style={s.payBtnText}>PayPal</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={s.sectionTitle}>DELIVERY</Text>
                {DELIVERY_SERVICES.map(d => (
                  <TouchableOpacity key={d.name} style={s.deliveryBtn} onPress={() => Linking.openURL(d.url)}>
                    <Text style={s.deliveryEmoji}>{d.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.deliveryName}>{d.name}</Text>
                      <Text style={s.deliverySub}>Tap to open</Text>
                    </View>
                    <Text style={s.deliveryArrow}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Add Modal */}
      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={[s.addContainer, { paddingTop: insets.top }]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={s.addHeader}>
              <TouchableOpacity onPress={() => setShowAdd(false)}><Text style={s.addCancel}>Cancel</Text></TouchableOpacity>
              <Text style={s.addTitle}>List an Item</Text>
              <TouchableOpacity onPress={createListing} disabled={posting}>
                {posting ? <ActivityIndicator color={PRIMARY} /> : <Text style={s.addPost}>Post</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.addForm} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={s.imagePickerBtn} onPress={pickImage} disabled={uploading || analyzing}>
                {uploading || analyzing ? (
                  <View style={s.imagePickerPlaceholder}>
                    <ActivityIndicator color={PRIMARY} size="large" />
                    <Text style={s.imagePickerText}>{analyzing ? '🤖 Analyzing...' : 'Uploading...'}</Text>
                  </View>
                ) : mediaUrl ? (
                  <Image source={{ uri: mediaUrl }} style={s.pickedImage} resizeMode="cover" />
                ) : (
                  <View style={s.imagePickerPlaceholder}>
                    <Text style={s.imagePickerIcon}>📷</Text>
                    <Text style={s.imagePickerText}>Add Photo</Text>
                    <Text style={s.imagePickerSub}>AI will suggest a price 🤖</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={s.formLabel}>TITLE *</Text>
              <TextInput style={s.formInput} value={title} onChangeText={setTitle} placeholder="What are you selling?" placeholderTextColor="#B4B2A9" maxLength={60} />

              <Text style={s.formLabel}>PRICE ₪ *</Text>
              <TextInput style={s.formInput} value={price} onChangeText={t => setPrice(t.replace(/[^0-9.]/g, ''))} placeholder="e.g. 150" placeholderTextColor="#B4B2A9" keyboardType="numeric" />

              <Text style={s.formLabel}>DESCRIPTION</Text>
              <TextInput style={[s.formInput, { minHeight: 80, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} placeholder="Condition, details..." placeholderTextColor="#B4B2A9" multiline maxLength={300} />

              <Text style={s.formLabel}>LOCATION</Text>
              <TextInput style={s.formInput} value={locationName} onChangeText={setLocationName} placeholder="Your city / neighborhood" placeholderTextColor="#B4B2A9" />

              <Text style={s.formLabel}>PAYMENT (optional)</Text>
              <TextInput style={s.formInput} value={paymentBit} onChangeText={setPaymentBit} placeholder="💸 Bit phone number" placeholderTextColor="#B4B2A9" keyboardType="phone-pad" />
              <TextInput style={[s.formInput, { marginTop: 8 }]} value={paymentPaybox} onChangeText={setPaymentPaybox} placeholder="📱 Paybox phone number" placeholderTextColor="#B4B2A9" keyboardType="phone-pad" />
              <TextInput style={[s.formInput, { marginTop: 8 }]} value={paymentPaypal} onChangeText={setPaymentPaypal} placeholder="💳 PayPal username" placeholderTextColor="#B4B2A9" autoCapitalize="none" />
              <View style={{ height: 60 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  addBtn: { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  list: { padding: 12, paddingBottom: 20 },
  row: { gap: 10, marginBottom: 10 },
  card: { flex: 1, backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardImage: { width: '100%', height: 160 },
  cardImagePlaceholder: { width: '100%', height: 160, backgroundColor: '#F0F0F8', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 10 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: TEXT, marginBottom: 4 },
  cardPrice: { fontSize: 17, fontWeight: '800', color: PRIMARY, marginBottom: 3 },
  cardLocation: { fontSize: 11, color: GRAY, marginBottom: 4 },
  sellerRow: { flexDirection: 'row', alignItems: 'center' },
  sellerText: { fontSize: 11, color: GRAY },
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 20 },
  emptyBtn: { backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  detailContainer: { flex: 1, backgroundColor: CARD },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  detailBack: { fontSize: 16, color: PRIMARY, fontWeight: '600' },
  markSold: { fontSize: 14, color: '#FF3B30', fontWeight: '600' },
  detailImage: { width: '100%', height: 300 },
  detailImagePlaceholder: { width: '100%', height: 200, backgroundColor: '#F0F0F8', alignItems: 'center', justifyContent: 'center' },
  detailBody: { padding: 20 },
  detailTitle: { fontSize: 24, fontWeight: '800', color: TEXT, marginBottom: 8 },
  detailPrice: { fontSize: 32, fontWeight: '900', color: PRIMARY, marginBottom: 8 },
  detailLocation: { fontSize: 14, color: GRAY, marginBottom: 12 },
  detailDesc: { fontSize: 15, color: TEXT, lineHeight: 22, marginBottom: 20 },
  sellerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: BG, borderRadius: 14, padding: 14, marginBottom: 16 },
  sellerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  sellerName: { fontSize: 15, fontWeight: '700', color: TEXT },
  sellerLabel: { fontSize: 12, color: GRAY },
  msgSellerBtn: { backgroundColor: '#EEF0FF', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  msgSellerText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 10, marginTop: 16 },
  offerCard: { backgroundColor: BG, borderRadius: 14, padding: 14, marginBottom: 8 },
  offerText: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 6 },
  offerStatus: { fontSize: 13, color: GRAY },
  offerActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  offerAcceptBtn: { flex: 1, backgroundColor: TEAL, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  offerAcceptText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  offerRejectBtn: { flex: 1, backgroundColor: '#F0F0F8', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  offerRejectText: { color: GRAY, fontWeight: '600', fontSize: 13 },
  makeOfferBtn: { backgroundColor: '#EEF0FF', borderRadius: 14, padding: 14, alignItems: 'center' },
  makeOfferText: { fontSize: 15, fontWeight: '600', color: PRIMARY },
  offerInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  offerInput: { flex: 1, backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: '#EBEBEB' },
  offerSendBtn: { backgroundColor: TEAL, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  offerSendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  paymentBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  payBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  payBtnEmoji: { fontSize: 18 },
  payBtnText: { fontSize: 13, fontWeight: '600', color: TEXT },
  deliveryBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: BG, borderRadius: 14, padding: 14, marginBottom: 8 },
  deliveryEmoji: { fontSize: 24 },
  deliveryName: { fontSize: 14, fontWeight: '600', color: TEXT },
  deliverySub: { fontSize: 12, color: GRAY },
  deliveryArrow: { fontSize: 20, color: GRAY },
  addContainer: { flex: 1, backgroundColor: CARD },
  addHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  addCancel: { fontSize: 16, color: GRAY },
  addTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  addPost: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  addForm: { padding: 20 },
  imagePickerBtn: { width: '100%', height: 180, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  imagePickerPlaceholder: { width: '100%', height: 180, backgroundColor: '#F0F0F8', alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1.5, borderColor: '#EBEBEB', borderStyle: 'dashed', gap: 6 },
  imagePickerIcon: { fontSize: 36 },
  imagePickerText: { fontSize: 14, color: GRAY, fontWeight: '500' },
  imagePickerSub: { fontSize: 12, color: PRIMARY },
  pickedImage: { width: '100%', height: 180 },
  formLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  formInput: { backgroundColor: BG, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: '#EBEBEB' },
})
