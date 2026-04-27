import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, StatusBar,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

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
            id: data.user.id,
            username,
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
          <View style={s.logoWrap}>
            <Text style={s.logoMain}>try</Text>
            <View style={s.logoBadge}><Text style={s.logoAI}>AI</Text></View>
            <Text style={s.logoMain}>ber</Text>
          </View>
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
            <TextInput
              style={s.input}
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#B4B2A9"
              autoCapitalize="words"
              maxLength={30}
            />
          )}

          <TextInput
            style={s.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            placeholderTextColor="#B4B2A9"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={s.input}
            placeholder="Password (min 6 characters)"
            value={password}
            onChangeText={setPassword}
            placeholderTextColor="#B4B2A9"
            secureTextEntry
          />

          {isSignup && (
            <TextInput
              style={s.input}
              placeholder="Phone number (optional, e.g. +972...)"
              value={phone}
              onChangeText={setPhone}
              placeholderTextColor="#B4B2A9"
              keyboardType="phone-pad"
              maxLength={20}
            />
          )}

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleAuth}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{isSignup ? '🚀 Join Tryber' : '→ Sign in'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsSignup(!isSignup)} style={s.switchBtn}>
            <Text style={s.switchText}>
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>The Next Generation of SocialAIsing 🤖</Text>
      </KeyboardAvoidingView>
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logoSection: { alignItems: 'center', marginBottom: 40 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  logoMain: { fontSize: 52, fontWeight: '900', color: '#1A1A2E', letterSpacing: -2 },
  logoBadge: { backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 2, marginBottom: 8 },
  logoAI: { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  tagline: { fontSize: 14, color: GRAY, marginBottom: 16, textAlign: 'center', letterSpacing: 0.3 },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { backgroundColor: '#EEEDFE', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  tagText: { fontSize: 12, color: PURPLE, fontWeight: '600' },
  form: { backgroundColor: '#fff', borderRadius: 24, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 4 },
  formTitle: { fontSize: 22, fontWeight: '800', color: '#1A1A2E', marginBottom: 4 },
  input: { backgroundColor: '#F7F6F3', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, fontSize: 15, color: '#2C2C2A', borderWidth: 1, borderColor: '#EEEDE8' },
  btn: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  switchBtn: { alignItems: 'center', paddingVertical: 8 },
  switchText: { color: GREEN, fontSize: 14, fontWeight: '500' },
  footer: { textAlign: 'center', fontSize: 12, color: '#C5C3BC', marginTop: 32, marginBottom: 16 },
})
