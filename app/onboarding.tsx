import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  Animated, TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Dimensions, ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const { width } = Dimensions.get('window')

type AgentMessage = {
  id: string
  text: string
  isUser: boolean
}

const STEPS = [
  'welcome',
  'name',
  'location',
  'vibe',
  'features',
  'done',
]

export default function OnboardingScreen() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [userName, setUserName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
    getLocation()
    setTimeout(() => startOnboarding(), 500)
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
    const msg: AgentMessage = { id: Date.now().toString(), text, isUser }
    setMessages(prev => [...prev, msg])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const typeMessage = async (text: string) => {
    setLoading(true)
    await new Promise(r => setTimeout(r, 800 + Math.random() * 400))
    addMessage(text, false)
    setLoading(false)
  }

  const startOnboarding = async () => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start()
    await typeMessage("היי! אני הסוכן האישי שלך ב-Tryber 👋\n\nאני כאן כדי להכיר אותך ולעזור לך להתחבר לאנשים סביבך.\n\nמה שמך?")
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
      await typeMessage(`נעים מאוד ${name}! 🙌\n\n${locationName ? `ראיתי שאתה ב${locationName} — מגניב!` : 'איפה אתה נמצא עכשיו?'}\n\nמה הביא אותך ל-Tryber?`)
      return
    }

    if (currentStep === 'location') {
      setStep(3)
      await typeMessage(`מעניין! 🔥\n\nTriyber מיועד לאנשים שרוצים להתחבר עם אנשים אמיתיים סביבם — בהופעות, שכונות, נסיעות, כל מקום.\n\nמה הוויב שלך? אתה יותר:\n\n🎵 מוזיקה והופעות\n🏙️ עירוני ושכונתי\n✈️ נסיעות והרפתקאות\n💼 עסקים ורשת מקצועית`)
      return
    }

    if (currentStep === 'vibe') {
      setStep(4)
      const vibe = text.toLowerCase()
      const aiResponse = await getAIResponse(
        `The user said their vibe is: "${text}". You're onboarding them to Tryber - an AI-powered group chat app. 
        Give them a personalized 2-3 sentence response about how Tryber fits their vibe, then mention 2 specific features they'd love. 
        Be exciting and personal. Reply in Hebrew. Max 60 words.`
      )
      await typeMessage(aiResponse || `אחלה! 🎯\n\nTriyber מושלם בשבילך. תיכף אראה לך כמה דברים שישנו לך את החיים...`)
      await new Promise(r => setTimeout(r, 1000))
      await typeMessage("⚡ **Live Trybes** — קבוצות צ'אט חיות עם אנשים שנמצאים לידך עכשיו\n\n👻 **Ghost Mode** — דבר אנונימית, גלה מי מסביב בלי לחשוף\n\n✦ **הסוכן שלך** — אני! כאן 24/7 לכל שאלה, רשימה, תזכורת\n\n🛍️ **Marketplace** — קנה ומכור עם שכנים קרובים\n\nמוכן לצאת לדרך? 🚀")
      return
    }

    if (currentStep === 'features') {
      setStep(5)
     await typeMessage(`מעולה ${userName}! 🎉 תתחיל לחקור את האפליקציה.`)
      return
    }

    // Done
    await AsyncStorage.setItem('onboarding_done', 'true')
    if (userId) await supabase.from('user_onboarding').upsert({ user_id: userId, completed: true, step: 5 })
    router.replace('/(tabs)')
  }

  const getAIResponse = async (prompt: string): Promise<string> => {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      return data.content?.[0]?.text?.trim() || ''
    } catch { return '' }
  }

  const skip = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true')
    router.replace('/(tabs)')
  }

  const currentStepName = STEPS[step]
  const showInput = ['welcome', 'name', 'location', 'vibe', 'features', 'done'].includes(currentStepName)
  const placeholder = step === 0 || step === 1 ? 'השם שלי...' :
    step === 2 ? 'ספר לי...' :
    step === 3 ? 'הוויב שלי...' : 'כתוב משהו...'

  return (
    <SafeAreaView style={s.container}>
      <TouchableOpacity style={s.skipBtn} onPress={skip}>
        <Text style={s.skipText}>דלג</Text>
      </TouchableOpacity>

      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        <View style={s.agentHeader}>
          <View style={s.agentAvatar}>
            <Text style={s.agentAvatarText}>✦</Text>
          </View>
          <View>
            <Text style={s.agentName}>Tryber Agent</Text>
            <Text style={s.agentSub}>מדריך אישי · תמיד זמין</Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={s.chat}
          contentContainerStyle={s.chatContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map(msg => (
            <View key={msg.id} style={[s.bubble, msg.isUser ? s.bubbleUser : s.bubbleAgent]}>
              {!msg.isUser && (
                <View style={s.agentAvatarSmall}>
                  <Text style={{ fontSize: 12, color: '#7F77DD', fontWeight: '700' }}>✦</Text>
                </View>
              )}
              <View style={[s.bubbleInner, msg.isUser ? s.bubbleInnerUser : s.bubbleInnerAgent]}>
                <Text style={[s.bubbleText, msg.isUser ? s.bubbleTextUser : s.bubbleTextAgent]}>
                  {msg.text}
                </Text>
              </View>
            </View>
          ))}
          {loading && (
            <View style={s.bubble}>
              <View style={s.agentAvatarSmall}>
                <Text style={{ fontSize: 12, color: '#7F77DD', fontWeight: '700' }}>✦</Text>
              </View>
              <View style={[s.bubbleInner, s.bubbleInnerAgent, { paddingVertical: 14 }]}>
                <Text style={{ fontSize: 16, color: '#7F77DD', letterSpacing: 4 }}>• • •</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {step >= 5 ? (
          <TouchableOpacity style={s.doneBtn} onPress={async () => {
            await AsyncStorage.setItem('onboarding_done', 'true')
            if (userId) await supabase.from('user_onboarding').upsert({ user_id: userId, completed: true, step: 5 })
            router.replace('/(tabs)')
          }}>
            <Text style={s.doneBtnText}>🚀 כנסו ל-Tryber</Text>
          </TouchableOpacity>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder={placeholder}
                placeholderTextColor="#B4B2A9"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                editable={!loading}
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
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F13' },
  skipBtn: { position: 'absolute', top: 56, right: 20, zIndex: 10 },
  skipText: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  content: { flex: 1, padding: 20, paddingTop: 60 },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  agentAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  agentAvatarText: { fontSize: 22, color: PURPLE, fontWeight: '700' },
  agentName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  agentSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  chat: { flex: 1 },
  chatContent: { gap: 14, paddingBottom: 16 },
  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { flexDirection: 'row-reverse' },
  bubbleAgent: {},
  agentAvatarSmall: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  bubbleInner: { maxWidth: width * 0.75, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleInnerAgent: { backgroundColor: 'rgba(127,119,221,0.15)', borderBottomLeftRadius: 4 },
  bubbleInnerUser: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextAgent: { color: '#fff' },
  bubbleTextUser: { color: '#fff' },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 12 },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  doneBtn: { backgroundColor: GREEN, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  doneBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
