import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

async function registerForPushNotifications(userId: string) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') return

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: 'f39665fe-cfb2-460a-bfa6-826d501d7333',
    })

    await supabase.from('profiles').update({ push_token: token.data }).eq('id', userId)
  } catch (err) {
    console.log('Push token error:', err)
  }
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (session?.user) {
        registerForPushNotifications(session.user.id)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    const inAuth = segments[0] === '(auth)'
    const inOnboarding = segments[0] === 'onboarding'

    const navigate = async () => {
      if (!session && !inAuth && !inOnboarding) {
        const done = await AsyncStorage.getItem('onboarding_done')
        if (!done) {
          router.replace('/onboarding')
        } else {
          router.replace('/(auth)/login')
        }
      } else if (session && (inAuth || inOnboarding)) {
        router.replace('/(tabs)')
      }
    }
    navigate()
  }, [session, segments, router])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="create" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="lobby" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="dm" options={{ animation: 'slide_from_right' }} />
    </Stack>
  )
}