import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, StatusBar,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const PRIMARY = '#6C63FF'
const BG = '#F8F7FF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

export default function LoginScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleAuth = async () => {
    if (!email.trim() || !password) { Alert.alert('Missing info', 'Enter your email and password'); return }
    if (password.length < 6) { Alert.alert('Password too short', 'At least 6 characters'); return }
    if (isSignup && !name.trim()) { Alert.alert('Missing info', 'Enter your name'); return }
    if (isSignup && !phone.trim()) { Alert.alert('Missing info', 'Phone number is required to find friends'); return }

    setLoading(true)
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password,
          options: { data: { full_name: name.trim() } }
        })
        if (error) throw error
        if (data.user) {
          const username = email.split('@')[0].toLowerCase() + '_' + Math.floor(Math.random() * 999)
          await supabase.from('profiles').upsert({
            id: data.user.id, username,
            display_name: name.trim(),
            phone: phone.trim() || null,
          })
          router.replace('/onboarding')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(), password,
        })
        if (error) throw error
        if (data.session) router.replace('/(tabs)')
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <View style={s.logoSection}>
          <Text style={s.logo}>try<Text style={s.logoAccent}>ber</Text></Text>
          <Text style={s.tagline}>The Next Generation of SocialAIsing</Text>
          <View style={s.tagRow}>
            <View style={s.tag}><Text style={s.tagText}>⚡ Live Groups</Text></View>
            <View style={s.tag}><Text style={s.tagText}>👻 Ghost Mode</Text></View>
            <View style={s.tag}><Text style={s.tagText}>✦ AI Agent</Text></View>
          </View>
        </View>

        <View style={s.form}>
          <Text style={s.formTitle}>{isSignup ? 'Create account' : 'Welcome back'}</Text>

          {isSignup && (
            <TextInput style={s.input} placeholder="Your name" value={name} onChangeText={setName} placeholderTextColor="#B4B2A9" autoCapitalize="words" maxLength={30} />
          )}

          <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} placeholderTextColor="#B4B2A9" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

          <TextInput style={s.input} placeholder="Password (min 6 characters)" value={password} onChangeText={setPassword} placeholderTextColor="#B4B2A9" secureTextEntry />

          {isSignup && (
            <TextInput style={s.input} placeholder="Phone number (e.g. +972...)" value={phone} onChangeText={setPhone} placeholderTextColor="#B4B2A9" keyboardType="phone-pad" maxLength={20} />
          )}

          <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleAuth} disabled={loading} activeOpacity={0.85}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{isSignup ? '🚀 Join Tryber' : 'Sign in →'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsSignup(!isSignup)} style={s.switchBtn}>
            <Text style={s.switchText}>
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>Tryber © 2026 · All languages supported 🌍</Text>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logoSection: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 52, fontWeight: '700', color: TEXT, letterSpacing: -2, marginBottom: 8 },
  logoAccent: { color: PRIMARY },
  tagline: { fontSize: 14, color: GRAY, marginBottom: 16, textAlign: 'center', letterSpacing: 0.3 },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { backgroundColor: 'rgba(108,99,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(108,99,255,0.15)' },
  tagText: { fontSize: 12, color: PRIMARY, fontWeight: '500' },
  form: { backgroundColor: '#fff', borderRadius: 20, padding: 24, gap: 12, shadowColor: PRIMARY, shadowOpacity: 0.06, shadowRadius: 16, elevation: 3, borderWidth: 1, borderColor: 'rgba(108,99,255,0.08)' },
  formTitle: { fontSize: 22, fontWeight: '700', color: TEXT, marginBottom: 4 },
  input: { backgroundColor: BG, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: 'rgba(108,99,255,0.1)' },
  btn: { backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn: { alignItems: 'center', paddingVertical: 8 },
  switchText: { color: PRIMARY, fontSize: 14, fontWeight: '500' },
  footer: { textAlign: 'center', fontSize: 12, color: GRAY, marginTop: 32 },
})
