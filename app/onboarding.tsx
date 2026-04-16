import { useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  Dimensions, Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

const { width } = Dimensions.get('window')

const SLIDES = [
  {
    emoji: '⚡️',
    title: 'Drop a Trybe',
    subtitle: 'Create or join live group chats with people around you — at concerts, airports, neighborhoods, anywhere.',
    color: '#1D9E75',
    bg: '#E1F5EE',
  },
  {
    emoji: '📡',
    title: 'Radar On',
    subtitle: 'See who\'s nearby. Chat as yourself or go Ghost with an anonymous avatar. Your choice.',
    color: '#7F77DD',
    bg: '#EEEDFE',
  },
  {
    emoji: '✦',
    title: 'Your AI Agent',
    subtitle: 'A personal assistant that remembers everything, sets reminders, and helps you navigate the app.',
    color: '#FF6B35',
    bg: '#FFF0EB',
  },
  {
    emoji: '🌐',
    title: 'Live Feed',
    subtitle: 'See what\'s happening around you. Post moments, follow people, stay in the loop.',
    color: '#1D9E75',
    bg: '#E1F5EE',
  },
]

export default function OnboardingScreen() {
  const router = useRouter()
  const [current, setCurrent] = useState(0)

  const next = async () => {
    if (current < SLIDES.length - 1) {
      setCurrent(current + 1)
    } else {
      await AsyncStorage.setItem('onboarding_done', 'true')
      router.replace('/(auth)/login')
    }
  }

  const skip = async () => {
    await AsyncStorage.setItem('onboarding_done', 'true')
    router.replace('/(auth)/login')
  }

  const slide = SLIDES[current]

  return (
    <SafeAreaView style={[s.container, { backgroundColor: slide.bg }]}>
      <TouchableOpacity style={s.skipBtn} onPress={skip}>
        <Text style={s.skipText}>Skip</Text>
      </TouchableOpacity>

      <View style={s.content}>
        <View style={[s.emojiCircle, { backgroundColor: slide.color + '20', borderColor: slide.color + '40' }]}>
          <Text style={s.emoji}>{slide.emoji}</Text>
        </View>

        <Text style={[s.title, { color: slide.color }]}>{slide.title}</Text>
        <Text style={s.subtitle}>{slide.subtitle}</Text>

        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[s.dot, { backgroundColor: i === current ? slide.color : slide.color + '30' }]}
            />
          ))}
        </View>
      </View>

      <View style={s.bottom}>
        <TouchableOpacity style={[s.nextBtn, { backgroundColor: slide.color }]} onPress={next}>
          <Text style={s.nextBtnText}>
            {current === SLIDES.length - 1 ? "Let's go →" : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  skipBtn: { alignSelf: 'flex-end', padding: 20 },
  skipText: { fontSize: 15, color: '#888780', fontWeight: '500' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emojiCircle: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', borderWidth: 2, marginBottom: 40 },
  emoji: { fontSize: 64 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16, letterSpacing: -0.5 },
  subtitle: { fontSize: 17, color: '#444441', textAlign: 'center', lineHeight: 26, marginBottom: 40 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { padding: 32 },
  nextBtn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  nextBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
