import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('0')) return '972' + digits.slice(1)
    if (digits.startsWith('972')) return digits
    return '972' + digits
  }

  const sendOTP = async () => {
    if (!phone || phone.length < 9) {
      Alert.alert('Invalid number', 'Enter your Israeli phone number')
      return
    }
    setLoading(true)
    try {
      const formatted = formatPhone(phone)
      const { error } = await supabase.auth.signInWithOtp({
        phone: '+' + formatted,
      })
      if (error) throw error
      setStep('otp')
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  const verifyOTP = async () => {
    if (!otp || otp.length < 4) {
      Alert.alert('Invalid code', 'Enter the code you received')
      return
    }
    setLoading(true)
    try {
      const formatted = formatPhone(phone)
      const { data, error } = await supabase.auth.verifyOtp({
        phone: '+' + formatted,
        token: otp,
        type: 'sms',
      })
      if (error) throw error
      if (data.user) {
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', data.user.id)
          .single()
        if (!existing) {
          await supabase.from('profiles').insert({
            id: data.user.id,
            username: 'user_' + formatted.slice(-4),
            display_name: name || null,
            phone: '+' + formatted,
          })
        }
        router.replace('/(tabs)')
      }
    } catch (err: any) {
      Alert.alert('Wrong code', 'Try again or resend')
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

        {step === 'phone' ? (
          <View style={s.form}>
            <Text style={s.label}>YOUR NAME</Text>
            <TextInput
              style={s.input}
              placeholder="What should we call you?"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#B4B2A9"
              autoCapitalize="words"
            />
            <Text style={s.label}>PHONE NUMBER</Text>
            <View style={s.phoneRow}>
              <View style={s.flag}>
                <Text style={s.flagText}>🇮🇱 +972</Text>
              </View>
              <TextInput
                style={s.phoneInput}
                placeholder="05X-XXX-XXXX"
                value={phone}
                onChangeText={setPhone}
                placeholderTextColor="#B4B2A9"
                keyboardType="phone-pad"
                maxLength={11}
              />
            </View>
            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={sendOTP}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Send code →</Text>
              }
            </TouchableOpacity>
            <Text style={s.legal}>We'll send a verification code via SMS</Text>
          </View>
        ) : (
          <View style={s.form}>
            <Text style={s.label}>ENTER CODE</Text>
            <Text style={s.sentTo}>Sent to {phone}</Text>
            <TextInput
              style={[s.input, s.otpInput]}
              placeholder="• • • • • •"
              value={otp}
              onChangeText={setOtp}
              placeholderTextColor="#B4B2A9"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={verifyOTP}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Verify & enter →</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('phone')} style={s.backBtn}>
              <Text style={s.backText}>← Change number</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={sendOTP} style={s.resendBtn}>
              <Text style={s.resendText}>Resend code</Text>
            </TouchableOpacity>
          </View>
        )}
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
  form: { gap: 10 },
  label: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginTop: 8 },
  sentTo: { fontSize: 13, color: GRAY, marginBottom: 4 },
  input: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  otpInput: { fontSize: 24, textAlign: 'center', letterSpacing: 8, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', gap: 8 },
  flag: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, justifyContent: 'center' },
  flagText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  phoneInput: { flex: 1, backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  btn: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  legal: { fontSize: 12, color: GRAY, textAlign: 'center', marginTop: 4 },
  backBtn: { alignItems: 'center', paddingVertical: 8 },
  backText: { fontSize: 14, color: GRAY },
  resendBtn: { alignItems: 'center', paddingVertical: 8 },
  resendText: { fontSize: 14, color: GREEN, fontWeight: '600' },
})
