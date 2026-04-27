import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
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

async function updateBadge(userId: string) {
  try {
    const { data: myGroups } = await supabase
      .from('group_members').select('group_id, last_read_at').eq('user_id', userId)
    let count = 0
    for (const m of myGroups || []) {
      const lastRead = m.last_read_at || new Date(0).toISOString()
      const { count: c } = await supabase.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', m.group_id).neq('user_id', userId).gt('created_at', lastRead)
      count += c || 0
    }
    await Notifications.setBadgeCountAsync(count)
  } catch {}
}

async function checkTeebyProactive(userId: string) {
  try {
    const { data: lastMsg } = await supabase
      .from('agent_messages').select('created_at').eq('user_id', userId).eq('role', 'assistant')
      .order('created_at', { ascending: false }).limit(1)

    const lastTime = lastMsg?.[0] ? new Date(lastMsg[0].created_at).getTime() : 0
    if (lastTime > Date.now() - 60 * 60 * 1000) return

    const { data: profile } = await supabase
      .from('profiles').select('display_name, teeby_name').eq('id', userId).single()

    const userName = profile?.display_name || ''
    const { data: groups } = await supabase
      .from('groups').select('id, name, member_count').eq('status', 'open')
      .order('member_count', { ascending: false }).limit(3)

    let text = `Hey${userName ? ` ${userName}` : ''}! 👋 `
    if (groups?.length) {
      text += `There are ${groups.length} active groups right now:\n`
      groups.forEach((g: any) => { text += `⚡ ${g.name} — ${g.member_count} people\n` })
      text += '\nWant me to find something near you?'
    } else {
      text += `I'm here whenever you need me. Ask me anything! ✦`
    }

    await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: text })
  } catch (err) {
    console.log('Teeby proactive error:', err)
  }
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        registerForPushNotifications(session.user.id)
        checkTeebyProactive(session.user.id)
        updateBadge(session.user.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (session?.user) {
        registerForPushNotifications(session.user.id)
        updateBadge(session.user.id)
      } else {
        Notifications.setBadgeCountAsync(0)
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
        if (!done) router.replace('/onboarding')
        else router.replace('/(auth)/login')
      } else if (session && (inAuth || inOnboarding)) {
        router.replace('/(tabs)')
      }
    }
    navigate()
  }, [session, segments, router])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)/login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="create" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="lobby" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="dm" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="contacts" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="radar" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
