import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { normalizePhone } from '../../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY } from '../../src/constants'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { Alert.alert('Missing fields', 'Please enter email and password'); return }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) Alert.alert('Login failed', error.message)
  }

  const handleRegister = async () => {
    if (!name || !phone || !email || !password) { Alert.alert('Missing fields', 'Please fill name, phone, email and password'); return }
    setLoading(true)
    try {
      const normalizedPhone = normalizePhone(phone)
      const { data: existing } = await supabase.from('profiles').select('id').eq('phone', normalizedPhone).maybeSingle()
      if (existing) { setLoading(false); Alert.alert('Phone already registered', 'This phone number is already in use. Please sign in instead.'); return }

      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) { setLoading(false); Alert.alert('Error', error.message); return }
      if (data.user) {
        const { error: upErr } = await supabase.from('profiles').update({ display_name: name, phone: normalizedPhone }).eq('id', data.user.id)
        if (upErr) {
          setLoading(false)
          if (upErr.code === '23505' || /duplicate|unique/i.test(upErr.message)) Alert.alert('Phone already registered', 'This phone number is already in use. Please sign in instead.')
          else Alert.alert('Error', upErr.message)
          return
        }
      }
      setLoading(false)
    } catch (e: any) {
      setLoading(false)
      Alert.alert('Error', e?.message || 'Something went wrong')
    }
  }

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.inner}>
        <Text style={s.logo}>tryber</Text>
        <Text style={s.tagline}>The Next Generation of SocialAIsing</Text>

        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, mode === 'login' && s.tabActive]} onPress={() => setMode('login')}>
            <Text style={[s.tabText, mode === 'login' && s.tabTextActive]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, mode === 'register' && s.tabActive]} onPress={() => setMode('register')}>
            <Text style={[s.tabText, mode === 'register' && s.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {mode === 'register' && (
          <>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder='Your name' placeholderTextColor={GRAY} autoCorrect={false} />
            <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder='Phone (e.g. 0501234567)' placeholderTextColor={GRAY} keyboardType='phone-pad' />
          </>
        )}
        <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder='Email' placeholderTextColor={GRAY} autoCapitalize='none' keyboardType='email-address' />
        <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder='Password' placeholderTextColor={GRAY} secureTextEntry />

        <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={mode === 'login' ? handleLogin : handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color='#fff' /> : <Text style={s.btnText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  logo: { fontSize: 42, fontWeight: '800', color: PRIMARY, letterSpacing: -1, textAlign: 'center', marginBottom: 8 },
  tagline: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 40 },
  tabs: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 16, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { fontSize: 15, fontWeight: '600', color: GRAY },
  tabTextActive: { color: '#fff' },
  input: { backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(108,99,255,0.1)' },
  btn: { backgroundColor: PRIMARY, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
