import { useState, useEffect, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, KeyboardAvoidingView, Platform, ScrollView, Animated } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { supabase } from '../src/lib/supabase'
import { askClaude } from '../src/lib/claude'
import { normalizePhone } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER } from '../src/constants'

type Step = 'welcome' | 'name' | 'phone' | 'vibe' | 'done'

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [step, setStep] = useState<Step>('welcome')
  const [messages, setMessages] = useState<{ role: 'assistant' | 'user'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [locationName, setLocationName] = useState('')
  const [typing, setTyping] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start()
    setTimeout(() => startOnboarding(), 500)
    getLocation()
  }, [])

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      if (place) setLocationName([place.city, place.country].filter(Boolean).join(', '))
    } catch {}
  }

  const addMsg = (role: 'assistant' | 'user', text: string) => {
    setMessages(prev => [...prev, { role, text }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const typeMsg = async (text: string) => {
    setTyping(true)
    await new Promise(r => setTimeout(r, 600))
    setTyping(false)
    addMsg('assistant', text)
  }

  const startOnboarding = async () => {
    await typeMsg('Hey! 👋 I\'m Teeby, your personal AI on Tryber ✦\n\nI\'ll help you connect with people nearby, join groups, and get things done.\n\nWhat\'s your name?')
    setStep('name')
  }

  const handleName = async () => {
    if (!input.trim()) return
    const n = input.trim()
    setName(n)
    addMsg('user', n)
    setInput('')
    await typeMsg('Nice to meet you, ' + n + '! 🙌' + (locationName ? '\n\nI can see you\'re in ' + locationName + '!' : '') + '\n\nWhat\'s your phone number? (So friends can find you)')
    setStep('phone')
  }

  const handlePhone = async () => {
    if (!input.trim()) return
    const p = normalizePhone(input.trim())
    setPhone(p)
    addMsg('user', input.trim())
    setInput('')
    await typeMsg('Perfect! 📱\n\nTell me a bit about yourself — what are you into? What brings you to Tryber?')
    setStep('vibe')
  }

  const handleVibe = async () => {
    if (!input.trim()) return
    const vibe = input.trim()
    addMsg('user', vibe)
    setInput('')
    setTyping(true)
    const aiReply = await askClaude('User named ' + name + ' said about themselves: "' + vibe + '". Write a warm, fun 1-sentence response and tell them Tryber is perfect for them. Max 20 words.', undefined, 60)
    setTyping(false)
    await typeMsg((aiReply || 'Tryber is made for you! 🎯') + '\n\nLet\'s get you set up. Creating your account...')
    setStep('done')
    await createAccount()
  }

  const createAccount = async () => {
    try {
      if (phone) {
        const { data: existing } = await supabase.from('profiles').select('id').eq('phone', phone).maybeSingle()
        if (existing) {
          await typeMsg('Looks like that phone is already on Tryber! 📱\n\nLet me take you to sign in.')
          setTimeout(() => router.replace('/(auth)/login'), 1500)
          return
        }
      }
      const email = phone
        ? phone + '@tryber.app'
        : name.toLowerCase().replace(/\s+/g, '.') + '.' + Date.now() + '@tryber.app'
      const password = Math.random().toString(36).substring(2, 14)
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error || !data.user) { await typeMsg('Hmm, something went wrong. Please try again!'); return }
      await supabase.from('profiles').update({ display_name: name, phone: phone || null }).eq('id', data.user.id)
      await AsyncStorage.setItem('onboarding_done', '1')
      await typeMsg('You\'re all set, ' + name + '! ✦\n\nWelcome to Tryber 🚀')
      setTimeout(() => router.replace('/(tabs)'), 1500)
    } catch {
      await typeMsg('Something went wrong. Let\'s try the regular sign up!')
      setTimeout(() => router.replace('/(auth)/login'), 1500)
    }
  }

  const handleSend = () => {
    if (step === 'name') handleName()
    else if (step === 'phone') handlePhone()
    else if (step === 'vibe') handleVibe()
  }

  const skipPhone = async () => {
    addMsg('user', 'Skip')
    setInput('')
    await typeMsg('No problem! You can add your phone later in Profile.\n\nTell me a bit about yourself:')
    setStep('vibe')
  }

  return (
    <Animated.View style={[s.container, { paddingTop: insets.top, opacity: fadeAnim }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.logo}>tryber</Text>
        <Text style={s.logoSub}>✦ AI-powered social</Text>
      </View>

      <ScrollView ref={scrollRef} style={s.messages} contentContainerStyle={{ padding: 16, gap: 10 }} showsVerticalScrollIndicator={false}>
        {messages.map((m, i) => (
          <View key={i} style={[s.msgWrap, m.role === 'user' && s.msgWrapMe]}>
            {m.role === 'assistant' && (
              <View style={s.teebyAvatar}><Text style={{ fontSize: 14, color: PRIMARY, fontWeight: '800' }}>✦</Text></View>
            )}
            <View style={[s.bubble, m.role === 'user' ? s.bubbleMe : s.bubbleBot]}>
              <Text style={[s.bubbleText, m.role === 'user' && { color: '#fff' }]}>{m.text}</Text>
            </View>
          </View>
        ))}
        {typing && (
          <View style={s.msgWrap}>
            <View style={s.teebyAvatar}><Text style={{ fontSize: 14, color: PRIMARY, fontWeight: '800' }}>✦</Text></View>
            <View style={[s.bubble, s.bubbleBot, { paddingVertical: 14 }]}>
              <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {step !== 'welcome' && step !== 'done' && (
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TextInput style={s.input} value={input} onChangeText={setInput}
              placeholder={step === 'name' ? 'Your name...' : step === 'phone' ? '0501234567' : 'Tell me about yourself...'}
              placeholderTextColor={GRAY} keyboardType={step === 'phone' ? 'phone-pad' : 'default'}
              returnKeyType="send" onSubmitEditing={handleSend} autoFocus multiline={step === 'vibe'} />
            <TouchableOpacity style={[s.sendBtn, !input.trim() && s.sendBtnOff]} onPress={handleSend} disabled={!input.trim()}>
              <Text style={s.sendBtnText}>↑</Text>
            </TouchableOpacity>
          </View>
          {step === 'phone' && (
            <TouchableOpacity style={s.skipBtn} onPress={skipPhone}>
              <Text style={s.skipBtnText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>
      )}

      {step === 'welcome' && (
        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={s.startBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={s.startBtnText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { alignItems: 'center', paddingVertical: 16, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  logo: { fontSize: 32, fontWeight: '800', color: PRIMARY, letterSpacing: -0.5 },
  logoSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  messages: { flex: 1 },
  msgWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgWrapMe: { flexDirection: 'row-reverse' },
  teebyAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: PRIMARY },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: { backgroundColor: CARD, borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: BORDER },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: TEXT },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, maxHeight: 100, borderWidth: 1, borderColor: BORDER },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  skipBtn: { alignItems: 'center', paddingVertical: 10, backgroundColor: CARD },
  skipBtnText: { fontSize: 13, color: GRAY },
  startBtn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  startBtnText: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
})
