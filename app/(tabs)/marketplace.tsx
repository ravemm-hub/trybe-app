import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView,
  StatusBar, Image, RefreshControl, Pressable, TextInput, Alert,
  Modal, ScrollView, Linking, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { supabase } from '../../lib/supabase'

type Listing = {
  id: string
  user_id: string
  title: string
  description: string | null
  price: number
  currency: string
  media_url: string | null
  location_name: string | null
  status: string
  payment_bit: string | null
  payment_paybox: string | null
  payment_paypal: string | null
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export default function MarketplaceScreen() {
  const [listings, setListings] = useState<Listing[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null)

  // Form state
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
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      const enriched = await Promise.all((data || []).map(async (l: Listing) => {
        const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', l.user_id).single()
        return { ...l, profile: profile || undefined }
      }))
      setListings(enriched)
    } catch (e: any) { console.error(e.message) }
    finally { setRefreshing(false) }
  }, [])

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
    if (result.canceled || !result.assets?.[0] || !userId) return
    setUploading(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `listing_${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      const { error } = await supabase.storage.from('chat-media').upload(`listings/${filename}`, formData)
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`listings/${filename}`)
      setMediaUrl(publicUrl)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setUploading(false) }
  }

  const createListing = async () => {
    if (!title.trim() || !price) { Alert.alert('Required', 'Add title and price'); return }
    if (!userId) return
    setPosting(true)
    try {
      await supabase.from('listings').insert({
        user_id: userId,
        title: title.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        currency: 'ILS',
        media_url: mediaUrl,
        location_name: locationName || null,
        location: coords ? `POINT(${coords.lon} ${coords.lat})` : null,
        payment_bit: paymentBit.trim() || null,
        payment_paybox: paymentPaybox.trim() || null,
        payment_paypal: paymentPaypal.trim() || null,
      })
      setTitle(''); setDescription(''); setPrice(''); setMediaUrl(null)
      setPaymentBit(''); setPaymentPaybox(''); setPaymentPaypal('')
      setShowAdd(false)
      loadListings()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setPosting(false) }
  }

  const formatPrice = (price: number, currency: string) => {
    if (currency === 'ILS') return `₪${price.toLocaleString()}`
    return `$${price.toLocaleString()}`
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadListings() }} tintColor="#1D9E75" />}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🛍️</Text>
            <Text style={s.emptyTitle}>Nothing for sale yet</Text>
            <Text style={s.emptySub}>Be the first to list something in your area</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowAdd(true)}>
              <Text style={s.emptyBtnText}>+ List an item</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => setSelectedListing(item)}>
            {item.media_url ? (
              <Image source={{ uri: item.media_url }} style={s.cardImage} resizeMode="cover" />
            ) : (
              <View style={s.cardImagePlaceholder}>
                <Text style={s.cardImagePlaceholderText}>📦</Text>
              </View>
            )}
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={s.cardPrice}>{formatPrice(item.price, item.currency)}</Text>
              {item.location_name && <Text style={s.cardLocation} numberOfLines={1}>📍 {item.location_name}</Text>}
              <Text style={s.cardSeller}>{item.profile?.display_name || item.profile?.username || 'Unknown'}</Text>
            </View>
          </Pressable>
        )}
      />

      {/* Item detail modal */}
      <Modal visible={!!selectedListing} animationType="slide" onRequestClose={() => setSelectedListing(null)}>
        {selectedListing && (
          <SafeAreaView style={s.detailContainer}>
            <View style={s.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedListing(null)}>
                <Text style={s.detailBack}>‹ Back</Text>
              </TouchableOpacity>
              {selectedListing.user_id === userId && (
                <TouchableOpacity onPress={async () => {
                  await supabase.from('listings').update({ status: 'sold' }).eq('id', selectedListing.id)
                  setSelectedListing(null); loadListings()
                }}>
                  <Text style={s.markSold}>Mark as Sold</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView>
              {selectedListing.media_url ? (
                <Image source={{ uri: selectedListing.media_url }} style={s.detailImage} resizeMode="cover" />
              ) : (
                <View style={s.detailImagePlaceholder}>
                  <Text style={{ fontSize: 64 }}>📦</Text>
                </View>
              )}
              <View style={s.detailBody}>
                <Text style={s.detailTitle}>{selectedListing.title}</Text>
                <Text style={s.detailPrice}>{formatPrice(selectedListing.price, selectedListing.currency)}</Text>
                {selectedListing.location_name && (
                  <Text style={s.detailLocation}>📍 {selectedListing.location_name}</Text>
                )}
                {selectedListing.description && (
                  <Text style={s.detailDesc}>{selectedListing.description}</Text>
                )}

                <Text style={s.sectionTitle}>Pay with</Text>
                <View style={s.paymentBtns}>
                  {selectedListing.payment_bit && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#E8F4FD' }]}
                      onPress={() => Linking.openURL(`https://www.bitpay.co.il/app/payment-page/${selectedListing.payment_bit}`)}>
                      <Text style={s.payBtnEmoji}>💙</Text>
                      <Text style={s.payBtnText}>Bit</Text>
                    </TouchableOpacity>
                  )}
                  {selectedListing.payment_paybox && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#FFF0E6' }]}
                      onPress={() => Linking.openURL(`https://payboxapp.page.link/pay/${selectedListing.payment_paybox}`)}>
                      <Text style={s.payBtnEmoji}>🟠</Text>
                      <Text style={s.payBtnText}>Paybox</Text>
                    </TouchableOpacity>
                  )}
                  {selectedListing.payment_paypal && (
                    <TouchableOpacity style={[s.payBtn, { backgroundColor: '#E6F0FA' }]}
                      onPress={() => Linking.openURL(`https://paypal.me/${selectedListing.payment_paypal}`)}>
                      <Text style={s.payBtnEmoji}>💛</Text>
                      <Text style={s.payBtnText}>PayPal</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[s.payBtn, { backgroundColor: '#E8F8F0' }]}
                    onPress={() => Linking.openURL(`https://pay.google.com`)}>
                    <Text style={s.payBtnEmoji}>🟢</Text>
                    <Text style={s.payBtnText}>Google Pay</Text>
                  </TouchableOpacity>
                </View>

                <Text style={s.sectionTitle}>Delivery</Text>
                <TouchableOpacity style={s.deliveryBtn}
                  onPress={() => Linking.openURL(`https://wa.me/972?text=שלום, אני מעוניין בשליחות עבור פריט: ${selectedListing.title} ממיקום: ${selectedListing.location_name || 'ישראל'}`)}>
                  <Text style={s.deliveryBtnText}>🚚 Request delivery via WhatsApp</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.contactBtn}
                  onPress={() => Linking.openURL(`https://wa.me/?text=היי, ראיתי את המודעה שלך על ${selectedListing.title} ב-Tryber. האם זה עדיין זמין?`)}>
                  <Text style={s.contactBtnText}>💬 Contact seller via WhatsApp</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      {/* Add listing modal */}
      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <SafeAreaView style={s.addContainer}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={s.addHeader}>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <Text style={s.addCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.addTitle}>List an Item</Text>
              <TouchableOpacity onPress={createListing} disabled={posting}>
                {posting ? <ActivityIndicator color="#1D9E75" /> : <Text style={s.addPost}>Post</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.addForm} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={s.imagePickerBtn} onPress={pickImage} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator color="#1D9E75" />
                ) : mediaUrl ? (
                  <Image source={{ uri: mediaUrl }} style={s.pickedImage} resizeMode="cover" />
                ) : (
                  <View style={s.imagePickerPlaceholder}>
                    <Text style={s.imagePickerIcon}>📷</Text>
                    <Text style={s.imagePickerText}>Add photo</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={s.formLabel}>TITLE *</Text>
              <TextInput style={s.formInput} value={title} onChangeText={setTitle} placeholder="What are you selling?" placeholderTextColor="#B4B2A9" maxLength={60} />

              <Text style={s.formLabel}>PRICE (₪) *</Text>
              <TextInput style={s.formInput} value={price} onChangeText={setPrice} placeholder="0" placeholderTextColor="#B4B2A9" keyboardType="numeric" />

              <Text style={s.formLabel}>DESCRIPTION</Text>
              <TextInput style={[s.formInput, { minHeight: 80, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} placeholder="Condition, details..." placeholderTextColor="#B4B2A9" multiline maxLength={300} />

              <Text style={s.formLabel}>LOCATION</Text>
              <TextInput style={s.formInput} value={locationName} onChangeText={setLocationName} placeholder="Your city / neighborhood" placeholderTextColor="#B4B2A9" />

              <Text style={s.formLabel}>PAYMENT — add your handles</Text>
              <TextInput style={s.formInput} value={paymentBit} onChangeText={setPaymentBit} placeholder="Bit phone number" placeholderTextColor="#B4B2A9" keyboardType="phone-pad" />
              <TextInput style={[s.formInput, { marginTop: 8 }]} value={paymentPaybox} onChangeText={setPaymentPaybox} placeholder="Paybox phone number" placeholderTextColor="#B4B2A9" keyboardType="phone-pad" />
              <TextInput style={[s.formInput, { marginTop: 8 }]} value={paymentPaypal} onChangeText={setPaymentPaypal} placeholder="PayPal username" placeholderTextColor="#B4B2A9" autoCapitalize="none" />

              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  addBtn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  list: { padding: 12, gap: 10 },
  row: { gap: 10 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', overflow: 'hidden' },
  cardImage: { width: '100%', height: 160 },
  cardImagePlaceholder: { width: '100%', height: 160, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  cardImagePlaceholderText: { fontSize: 40 },
  cardBody: { padding: 10 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#2C2C2A', marginBottom: 4 },
  cardPrice: { fontSize: 16, fontWeight: '800', color: GREEN, marginBottom: 3 },
  cardLocation: { fontSize: 11, color: GRAY, marginBottom: 3 },
  cardSeller: { fontSize: 11, color: GRAY },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  detailContainer: { flex: 1, backgroundColor: '#fff' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  detailBack: { fontSize: 16, color: GREEN, fontWeight: '500' },
  markSold: { fontSize: 14, color: '#E24B4A', fontWeight: '600' },
  detailImage: { width: '100%', height: 300 },
  detailImagePlaceholder: { width: '100%', height: 200, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  detailBody: { padding: 20 },
  detailTitle: { fontSize: 22, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  detailPrice: { fontSize: 28, fontWeight: '800', color: GREEN, marginBottom: 8 },
  detailLocation: { fontSize: 14, color: GRAY, marginBottom: 12 },
  detailDesc: { fontSize: 15, color: '#444441', lineHeight: 22, marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 10, marginTop: 8 },
  paymentBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  payBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  payBtnEmoji: { fontSize: 18 },
  payBtnText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  deliveryBtn: { backgroundColor: '#E1F5EE', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 },
  deliveryBtnText: { fontSize: 15, fontWeight: '600', color: '#0F6E56' },
  contactBtn: { backgroundColor: '#F1EFE8', borderRadius: 14, padding: 16, alignItems: 'center' },
  contactBtnText: { fontSize: 15, fontWeight: '600', color: '#444441' },
  addContainer: { flex: 1, backgroundColor: '#fff' },
  addHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  addCancel: { fontSize: 16, color: GRAY },
  addTitle: { fontSize: 17, fontWeight: '700', color: '#2C2C2A' },
  addPost: { fontSize: 16, fontWeight: '700', color: GREEN },
  addForm: { padding: 20 },
  imagePickerBtn: { width: '100%', height: 200, borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  imagePickerPlaceholder: { width: '100%', height: 200, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: '#E0DED8', borderStyle: 'dashed' },
  imagePickerIcon: { fontSize: 40, marginBottom: 8 },
  imagePickerText: { fontSize: 14, color: GRAY },
  pickedImage: { width: '100%', height: 200, borderRadius: 14 },
  formLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  formInput: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
})
