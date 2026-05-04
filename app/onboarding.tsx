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

const { width } = Dimensions.get('window')
const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'

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
      {[
        { top: '15%', left: '10%', emoji: '🦊', label: 'Noa' },
        { top: '25%', right: '8%', emoji: '👾', label: 'Alex' },
        { bottom: '20%', left: '15%', emoji: '🐺', label: 'Ghost' },
        { bottom: '15%', right: '15%', emoji: '🤖', label: 'AI' },
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
  container: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginVertical: 16 },
  ring: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: TEAL },
  center: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,191,166,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: TEAL },
  centerText: { fontSize: 24 },
  user: { position: 'absolute', alignItems: 'center' },
  userDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(108,99,255,0.15)', borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  userLabel: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
})

type Message = { id: string; text: string; isUser: boolean }

export default function OnboardingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [userName, setUserName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [showRadar, setShowRadar] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    getLocation()
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start()
    setTimeout(() => addBotMessage(`Hey! I'm Teeby, your personal AI on Tryber ✦\n\nWith Tryber you can:\n⚡ Create live groups with people nearby\n📡 See who's around on Radar\n💬 Chat anonymously or openly\n✦ Ask me anything — I'm always here\n\nWhat's your name?`), 600)
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

  const addBotMessage = (text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), text, isUser: false }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const addUserMessage = (text: string) => {
    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text, isUser: true }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    addUserMessage(text)
    setLoading(true)

    try {
      if (step === 0) {
        // Name step
        const name = text.split(' ')[0]
        setUserName(name)
        if (userId) await supabase.from('profiles').update({ display_name: text }).eq('id', userId).catch(() => {})
        setStep(1)
        await new Promise(r => setTimeout(r, 800))
        addBotMessage(`Nice to meet you, ${name}! 🙌\n\n${locationName ? `I can see you're in ${locationName}!` : 'Great to have you!'}\n\nWhat brings you to Tryber? Tell me about yourself:`)

      } else if (step === 1) {
        // Vibe step
        setStep(2)
        setShowRadar(true)
        await new Promise(r => setTimeout(r, 800))
        addBotMessage(`Love it! 🔥\n\n📡 This is your Radar — see who's around you right now!\n\nPeople appear as dots on the map. You can:\n• Tap anyone to chat 💬\n• Create a group and invite nearby people ⚡\n• Go ghost mode to stay anonymous 👻\n\nTap "Explore" after to see live Radar. Ready?`)

      } else if (step === 2) {
        // Features step
        setStep(3)
        setShowRadar(false)
        await new Promise(r => setTimeout(r, 800))
        addBotMessage(`Let's go, ${userName}! 🎉\n\nTap the tabs below:\n💬 Chats — your groups & DMs\n🌐 Feed — share moments\n📡 Explore — find groups & people\n✦ Teeby — that's me, ask anything!\n\nI'm here 24/7. See you inside! 🚀`)

      } else {
        // Done
        await finishOnboarding()
      }
    } catch {
      addBotMessage(`Let's go! 🚀`)
    } finally {
      setLoading(false)
    }
  }

  const finishOnboarding = () => {
    router.replace('/(tabs)')
    AsyncStorage.setItem('onboarding_done', 'true').catch(() => {})
    if (userId) {
      try {
        supabase.from('user_onboarding').upsert({ user_id: userId, completed: true })
        supabase.from('profiles').update({ display_name: userName || undefined }).eq('id', userId)
      } catch {}
    }
  }

  const skip = () => finishOnboarding()

  const placeholder = step === 0 ? 'Your name...' : step === 1 ? 'My vibe is...' : 'Type anything...'

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
            <View key={msg.id} style={[s.bubbleWrap, msg.isUser && s.bubbleWrapMe]}>
              {!msg.isUser && (
                <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
              )}
              <View style={[s.bubble, msg.isUser ? s.bubbleMe : s.bubbleBot]}>
                <Text style={[s.bubbleText, msg.isUser && s.bubbleTextMe]}>{msg.text}</Text>
              </View>
            </View>
          ))}
          {loading && (
            <View style={s.bubbleWrap}>
              <View style={s.agentAvatarSmall}><Text style={{ fontSize: 12, color: PRIMARY, fontWeight: '700' }}>✦</Text></View>
              <View style={[s.bubble, s.bubbleBot, { paddingVertical: 14 }]}>
                <Text style={{ fontSize: 18, color: PRIMARY, letterSpacing: 4 }}>· · ·</Text>
              </View>
            </View>
          )}
          {showRadar && (
            <View style={s.radarWrap}>
              <RadarViz />
              <Text style={s.radarCaption}>People near you right now</Text>
            </View>
          )}
        </ScrollView>

        {step >= 3 ? (
          <TouchableOpacity style={[s.doneBtn, { marginBottom: insets.bottom + 8 }]} onPress={finishOnboarding}>
            <Text style={s.doneBtnText}>🚀 Enter Tryber</Text>
          </TouchableOpacity>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 20}>
            <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder={placeholder}
                placeholderTextColor="rgba(255,255,255,0.35)"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                editable={!loading}
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]}
                onPress={handleSend}
                disabled={!input.trim() || loading}
              >
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
  skipBtn: { position: 'absolute', top: 60, right: 20, zIndex: 10, padding: 8 },
  skipText: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  agentAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(108,99,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY },
  agentAvatarText: { fontSize: 20, color: PRIMARY, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  agentSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  chat: { flex: 1 },
  chatContent: { gap: 12, paddingBottom: 16 },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleWrapMe: { flexDirection: 'row-reverse' },
  agentAvatarSmall: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(108,99,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PRIMARY },
  bubble: { maxWidth: width * 0.75, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleBot: { backgroundColor: 'rgba(108,99,255,0.12)', borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.9)' },
  bubbleTextMe: { color: '#fff' },
  radarWrap: { alignItems: 'center', marginVertical: 8 },
  radarCaption: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 8 },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  doneBtn: { backgroundColor: TEAL, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  doneBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})