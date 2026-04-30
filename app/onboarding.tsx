import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Dimensions, ScrollView, StatusBar,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const { width, height } = Dimensions.get('window')
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'

type Message = { id: string; text: string; isUser: boolean }
const STEPS = ['welcome', 'name', 'location', 'vibe', 'features', 'done']

// Radar visualization component
function RadarViz() {
  const pulse1 = useRef(new Animated.Value(0)).current
  const pulse2 = useRef(new Animated.Value(0)).current
  const pulse3 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animate = (val: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2000, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start()
    }
    animate(pulse1, 0)
    animate(pulse2, 600)
    animate(pulse3, 1200)
  }, [])

  const pulseStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.2, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) }],
  })

  return (
    <View style={rv.container}>
      <Animated.View style={[rv.ring, pulseStyle(pulse1)]} />
      <Animated.View style={[rv.ring, pulseStyle(pulse2)]} />
      <Animated.View style={[rv.ring, pulseStyle(pulse3)]} />
      <View style={rv.center}>
        <Text style={rv.centerText}>📡</Text>
      </View>
      {/* Fake nearby users */}
      {[
        { top: '20%', left: '15%', emoji: '🦊', label: 'Ghost' },
        { top: '30%', right: '12%', emoji: '👾', label: 'Alex' },
        { bottom: '25%', left: '20%', emoji: '🐺', label: 'Anon' },
        { bottom: '20%', right: '18%', emoji: '🤖', label: 'AI' },
      ].map((u, i) => (
        <View key={i} style={[rv.user, { top: u.top as any, left: u.left as any, right: u.right as any, bottom: u.bottom as any }]}>
          <View style={rv.userDot}><Text style={{ fontSize: 16 }}>{u.emoji}</Text></View>
          <Text style={rv.userLabel}>{u.label}</Text>
        </View>
      ))}
    </View>
  )
}

const rv = StyleSheet.create({
  container: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginVertical: 20 },
  ring: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: TEAL },
  center: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,191,166,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: TEAL },
  centerText: { fontSize: 24 },
  user: { position: 'absolute', alignItems: 'center' },
  userDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(108,99,255,0.2)', borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  userLabel: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
})

export default function OnboardingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [userName, setUserName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [showRadar, setShowRadar] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    getLocation()
    setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start()
      startOnboarding()
    }, 500)
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

  const addMessage = (text: string, isUser: boolean) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), text, isUser }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const typeMessage = async (text: string) => {
    setLoading(true)
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
    addMessage(text, false)
    setLoading(false)
  }

  const startOnboarding = async () => {
    await typeMessage(`Hey! I'm Teeby, your personal AI on Tryber ✦\n\nWith Tryber you can:\n⚡ Create live groups with people near you\n📡 See who's around on Radar\n💬 Chat anonymously or openly\n✦ Ask me anything — I'm always here\n\nWhat's your name?`)
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    addMessage(text, true)
    const currentStep = STEPS[step]

    if (currentStep === 'welcome' || currentStep === 'name') {
      const name = text.split(' ')[0]
      setUserName(name)
      if (userId) await supabase.from('profiles').update({ display_name: text }).eq('id', userId)
      setStep(2)
      await typeMessage(`Nice to meet you, ${name}! 🙌\n\n${locationName ? `I can see you're in ${locationName}!` : 'Great!'}\n\nWhat brings you to Tryber?`)
      return
    }

    if (currentStep === 'location') {
      setStep(3)
      await typeMessage(`Love it! 🔥\n\nTryber connects you with people nearby in real-time.\n\nWhat's your vibe? Tell me about yourself:`)
      return
    }

    if (currentStep === 'vibe') {
      setStep(4)
      setShowRadar(true)
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: `User said their vibe is: "${text}". Give a warm 1-2 sentence response about how Tryber fits them. Reply in same language. Max 30 words.` }] }),
        })
        const data = await res.json()
        const aiReply = data.content?.[0]?.text?.trim()
        await typeMessage(aiReply || `Perfect! Tryber is made for you. 🎯`)
      } catch {
        await typeMessage(`Perfect! Tryber is made for you. 🎯`)
      }
      await new Promise(r => setTimeout(r, 800))
      await typeMessage(`📡 This is your Radar!\n\nRight now I can see people near you. You can:\n• Tap anyone to chat with them 💬\n• Create a group and invite nearby people ⚡\n• Go ghost mode to stay anonymous 👻\n\nTry it — tap "Explore" → enable Radar to see who's around you live.\n\nReady to start?`)
      return
    }

    if (currentStep === 'features') {
      setStep(5)
      setShowRadar(false)
      await typeMessage(`Let's go, ${userName}! 🎉\n\nTap the tabs below to explore:\n💬 Chats • 🌐 Feed • 📡 Explore • ✦ Teeby`)
      return
    }

    await AsyncStorage.setItem('onboarding_done', 'true')
    if (userId) await supabase.from('user_onboarding').upsert({ user_id: userId, completed: true, step: 5 })
    router.replace('/(tabs)')
  }

  const skip = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true')
    router.replace('/(tabs)')
  }

  const placeholder = step <= 1 ? 'Your name...' : step === 2 ? 'Tell me...' : step === 3 ? 'My vibe is...' : 'Type here...'

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <TouchableOpacity style={s.skipBtn} onPress={skip}>
        <Text style={s.skipText}>Skip</Text>
      </TouchableOpacity>

      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        <View style={s.agentHeader}>
          <View style={s.agentAvatar}><Text style={s.agentAvatarText}>✦</Text></View>
          <View>
            <Text style={s.agentName}>Teeby</Text>
            <Text style={s.agentSub}>Your Personal AI · Always here</Text>
          </View>
        </View>

        <ScrollView ref={scrollRef} style={s.chat} contentContainerStyle={s.chatContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {messages.map(msg => (
            <View key={msg.id} style={[s.bubble, msg.isUser ? s.bubbleUser : s.bubbleAgent]}>
              {!msg.isUser && <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>}
              <View style={[s.bubbleInner, msg.isUser ? s.bubbleInnerUser : s.bubbleInnerAgent]}>
                <Text style={[s.bubbleText, msg.isUser && s.bubbleTextUser]}>{msg.text}</Text>
              </View>
            </View>
          ))}
          {loading && (
            <View style={s.bubble}>
              <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
              <View style={[s.bubbleInner, s.bubbleInnerAgent, { paddingVertical: 14 }]}>
                <Text style={{ fontSize: 16, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
              </View>
            </View>
          )}
          {showRadar && (
            <View style={s.radarContainer}>
              <RadarViz />
              <Text style={s.radarCaption}>People near you right now</Text>
            </View>
          )}
        </ScrollView>

        {step >= 5 ? (
          <TouchableOpacity style={[s.doneBtn, { marginBottom: insets.bottom + 8 }]} onPress={async () => {
            await AsyncStorage.setItem('onboarding_done', 'true')
            if (userId) await supabase.from('user_onboarding').upsert({ user_id: userId, completed: true, step: 5 })
            router.replace('/(tabs)')
          }}>
            <Text style={s.doneBtnText}>🚀 Enter Tryber</Text>
          </TouchableOpacity>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 20}>
            <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
              <TextInput style={s.input} value={input} onChangeText={setInput} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.3)" returnKeyType="send" onSubmitEditing={handleSend} editable={!loading} autoCorrect={false} />
              <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]} onPress={handleSend} disabled={!input.trim() || loading}>
                <Text style={s.sendBtnText}>↑</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  skipBtn: { position: 'absolute', top: 60, right: 20, zIndex: 10 },
  skipText: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  agentAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(108,99,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY },
  agentAvatarText: { fontSize: 20, color: PRIMARY, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  agentSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  chat: { flex: 1 },
  chatContent: { gap: 12, paddingBottom: 16 },
  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { flexDirection: 'row-reverse' },
  bubbleAgent: {},
  agentAvatarSmall: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(108,99,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PRIMARY },
  bubbleInner: { maxWidth: width * 0.75, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleInnerAgent: { backgroundColor: 'rgba(108,99,255,0.12)', borderBottomLeftRadius: 4 },
  bubbleInnerUser: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.9)' },
  bubbleTextUser: { color: '#fff' },
  radarContainer: { alignItems: 'center', marginVertical: 8 },
  radarCaption: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 8 },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  doneBtn: { backgroundColor: TEAL, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  doneBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
