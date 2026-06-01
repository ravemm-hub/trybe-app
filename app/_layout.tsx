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
    const name = p?.display_name || ''

    // FIRST PRIORITY: are there active Trybes near the user's current location
    // that they're NOT in? If yes, Teeby surfaces them — that's the most
    // valuable nudge ("you're at a venue with a live Trybe — join?").
    let coords: { lat: number; lon: number } | null = null
    try {
      const Location = await import('expo-location')
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        coords = { lat: loc.coords.latitude, lon: loc.coords.longitude }
      }
    } catch {}

    if (coords) {
      try {
        const { data: near } = await supabase.rpc('unjoined_groups_near', {
          p_user: userId, p_lat: coords.lat, p_lon: coords.lon, p_radius_m: 1500,
        })
        if (Array.isArray(near) && near.length > 0) {
          // Filter to ones we haven't already nudged them about.
          const ids = near.map((g: any) => g.id)
          const { data: alreadySent } = await supabase.from('proactive_nudges_sent')
            .select('group_id').eq('user_id', userId).in('group_id', ids)
          const sentIds = new Set((alreadySent || []).map((r: any) => r.group_id))
          const fresh = near.filter((g: any) => !sentIds.has(g.id))
          if (fresh.length > 0) {
            const top = fresh[0]
            const dist = top.distance_m < 1000
              ? Math.round(top.distance_m) + 'm'
              : (top.distance_m / 1000).toFixed(1) + 'km'
            const venueLine = top.venue_name ? '\n📍 ' + top.venue_name : ''
            const descLine = top.description ? '\n"' + top.description.slice(0, 100) + '"' : ''
            const text = 'Hey' + (name ? ' ' + name : '') + '! 👀\n\nThere\'s an active Trybe just ' + dist + ' from you:\n\n⚡ ' + top.name + venueLine + descLine + '\n\n' + top.member_count + ' members. Want to join?'
            await supabase.from('agent_messages').insert({ user_id: userId, role: 'assistant', content: text })
            await supabase.from('proactive_nudges_sent').insert({ user_id: userId, group_id: top.id })
            return
          }
        }
      } catch {}
    }

    // FALLBACK: generic "what's active right now" message (the old behavior).
    const { data: groups } = await supabase.from('groups').select('name, member_count')
      .eq('status', 'open').order('member_count', { ascending: false }).limit(3)
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
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setSession(null); return }
      // Verify the session still points to a real user — otherwise sign out (stale session).
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) { try { await supabase.auth.signOut() } catch {} ; setSession(null); return }
      setSession(session)
      registerPushToken(user.id)
      loadContactNamesFromDB(user.id)
      loadAndMatchContacts(user.id)
      checkTeebyProactive(user.id)
    })()
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
          <Stack.Screen name='profile-view' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='notifications' options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name='tryber-zone' options={{ animation: 'slide_from_bottom' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
