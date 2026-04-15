import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleAuth = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Enter your email and password')
      return
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters')
      return
    }
    if (isSignup && !name.trim()) {
      Alert.alert('Missing info', 'Enter your name')
      return
    }

    setLoading(true)
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: name.trim() } }
        })
        if (error) throw error
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username: email.split('@')[0].toLowerCase() + '_' + Math.floor(Math.random() * 999),
            display_name: name.trim(),
          })
          router.replace('/(tabs)')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (error) throw error
        if (data.session) {
          router.replace('/(tabs)')
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.logoSection}>
          <Text style={s.logo}>trybe</Text>
          <Text style={s.tagline}>Find your people. Right here, right now.</Text>
        </View>

        <View style={s.form}>
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

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleAuth}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{isSignup ? 'Create account →' : 'Sign in →'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsSignup(!isSignup)} style={s.switchBtn}>
            <Text style={s.switchText}>
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, justifyContent: 'center', padding: 28 },
  logoSection: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 52, fontWeight: '800', color: GREEN, letterSpacing: -2 },
  tagline: { fontSize: 15, color: GRAY, marginTop: 8, textAlign: 'center' },
  form: { gap: 12 },
  input: {
    backgroundColor: '#F1EFE8', borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 14,
    fontSize: 15, color: '#2C2C2A',
  },
  btn: {
    backgroundColor: GREEN, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn: { alignItems: 'center', paddingVertical: 12 },
  switchText: { color: GREEN, fontSize: 14 },
})
