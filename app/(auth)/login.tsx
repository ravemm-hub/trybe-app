import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../src/lib/supabase'
import { normalizePhone } from '../../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY } from '../../src/constants'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [e164, setE164] = useState('')
  const [normalized, setNormalized] = useState('')

  const sendCode = async () => {
    const norm = normalizePhone(phone.trim())
    if (!/^0\d{8,9}$/.test(norm)) { Alert.alert('Invalid number', 'Enter a valid mobile number, e.g. 0501234567'); return }
    const e = '+972' + norm.slice(1)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: e })
    setLoading(false)
    if (error) { Alert.alert('Could not send code', error.message); return }
    setE164(e); setNormalized(norm); setCode(''); setStep('code')
  }

  const verify = async () => {
    if (code.trim().length < 4) return
    setLoading(true)
    const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token: code.trim(), type: 'sms' })
    if (error) { setLoading(false); Alert.alert('Wrong or expired code', error.message); return }
    const uid = data.user?.id
    if (uid) {
      const updates: any = { phone: normalized }
      if (name.trim()) updates.display_name = name.trim()
      try { await supabase.from('profiles').update(updates).eq('id', uid) } catch {}
      try { await AsyncStorage.setItem('onboarding_done', '1') } catch {}
    }
    setLoading(false)
    // _layout's onAuthStateChange navigates into the app once the session is set.
  }

  const resend = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 })
    setLoading(false)
    Alert.alert(error ? 'Error' : 'Code sent', error ? error.message : 'A new code is on its way.')
  }

  return (
    <KeyboardAvoidingView style={[s.container, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <Text style={s.logo}>tryber</Text>
        <Text style={s.tagline}>The next generation of social ✦</Text>

        {step === 'phone' ? (
          <>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name (new here? add it)" placeholderTextColor={GRAY} autoCorrect={false} />
            <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="Phone — e.g. 0501234567" placeholderTextColor={GRAY} keyboardType="phone-pad" autoFocus />
            <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={sendCode} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send code by SMS</Text>}
            </TouchableOpacity>
            <Text style={s.hint}>We'll text you a one-time code. No password needed.</Text>
          </>
        ) : (
          <>
            <Text style={s.codeLabel}>Enter the 6-digit code sent to {e164}</Text>
            <TextInput style={[s.input, s.codeInput]} value={code} onChangeText={setCode} placeholder="••••••" placeholderTextColor={GRAY} keyboardType="number-pad" maxLength={6} autoFocus textAlign="center" />
            <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={verify} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify & enter</Text>}
            </TouchableOpacity>
            <View style={s.codeFooter}>
              <TouchableOpacity onPress={() => { setStep('phone'); setCode('') }}><Text style={s.link}>‹ Change number</Text></TouchableOpacity>
              <TouchableOpacity onPress={resend} disabled={loading}><Text style={s.link}>Resend code</Text></TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  logo: { fontSize: 42, fontWeight: '800', color: PRIMARY, letterSpacing: -1, textAlign: 'center', marginBottom: 8 },
  tagline: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(108,99,255,0.1)' },
  codeInput: { fontSize: 28, fontWeight: '800', letterSpacing: 10, color: TEXT },
  codeLabel: { fontSize: 14, color: TEXT, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: PRIMARY, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: GRAY, textAlign: 'center', marginTop: 16 },
  codeFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  link: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
})
