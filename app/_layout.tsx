import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../src/lib/supabase'
import { registerPushToken, setupNotificationTap } from '../src/lib/push'
import { loadAndMatchContacts, loadContactNamesFromDB } from '../src/lib/contacts'
import type { Session } from '@supabase/supabase-js'

async function checkTeebyProactive(userId: string) {
  try {
    const { data: last } = await supabase.from('agent_messages')
      .select('created_at').eq('user_id', userId).eq('role', 'assistant')
      .order('created_at', { ascending: false }).limit(1)
    if (last?.[0] && Date.now() - new Date(last[0].created_at).getTime() < 3600000) return
    const { data: p } = await supabase.from('profiles').select('display_name').eq('id', userId).single()
    const { data: groups } = await supabase.from('groups').select('name, member_count')
      .eq('status', 'open').order('member_count', { ascending: false }).limit(3)
    const name = p?.display_name || ''
    let text = 'Hey' + (name ? ' ' + name : '') + '! 👋 '
    if (groups?.length) {
      text += 'There are ' + groups.length + ' active groups now:\n'
      groups.forEach((g: any) => { text += '⚡ ' + g.name + ' — ' + g.member_count + ' people\n' })
      text += '\nWant me to find something nearby?'
    } else {
      text += 'I am here whenever you need me. Ask me anything! ✦'
    }
    await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: text })
  } catch {}
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    setupNotificationTap(router)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        const uid = session.user.id
        registerPushToken(uid)
        loadContactNamesFromDB(uid)
        loadAndMatchContacts(uid)
        checkTeebyProactive(uid)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
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
  }, [session, segments])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name='onboarding' options={{ animation: 'fade' }} />
          <Stack.Screen name='(auth)/login' />
          <Stack.Screen name='(tabs)' />
          <Stack.Screen name='chat' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='dm' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='create' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='group-settings' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='space' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='shared-list' options={{ animation: 'slide_from_right' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
