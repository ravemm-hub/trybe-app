import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../lib/supabase'

import { loadCustomNamesFromDB, saveContactPhoneMap, saveCustomName, normalizePhone } from '../lib/contactNames'

async function loadContactsInBackground(userId) {
  try {
    const Contacts = require('expo-contacts')
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] })
    const contactList = []
    for (const c of data) {
      if (!c.phoneNumbers?.length || !c.name) continue
      const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
      if (phone) contactList.push({ name: c.name, phone })
    }
    if (!contactList.length) return
    await saveContactPhoneMap(contactList)
    const allPhones = [...new Set(contactList.flatMap(c => {
      const n = normalizePhone(c.phone)
      const withPlus = n.startsWith('0') ? '+972' + n.slice(1) : n
      return [c.phone, n, withPlus]
    }))]
    const { data: tryberUsers } = await supabase.from('profiles').select('id, phone').in('phone', allPhones)
    for (const u of tryberUsers || []) {
      if (!u.phone) continue
      const uNorm = normalizePhone(u.phone)
      const contact = contactList.find(c => normalizePhone(c.phone) === uNorm)
      if (contact) await saveCustomName(userId, u.id, contact.name)
    }
  } catch {}
}
import type { Session } from '@supabase/supabase-js'

async function checkTeebyProactive(userId: string) {
  try {
    const { data: lastMsg } = await supabase
      .from('agent_messages').select('created_at').eq('user_id', userId).eq('role', 'assistant')
      .order('created_at', { ascending: false }).limit(1)

    const lastTime = lastMsg?.[0] ? new Date(lastMsg[0].created_at).getTime() : 0
    if (lastTime > Date.now() - 60 * 60 * 1000) return

    const { data: profile } = await supabase
      .from('profiles').select('display_name').eq('id', userId).single()

    const userName = profile?.display_name || ''
    const { data: groups } = await supabase
      .from('groups').select('id, name, member_count').eq('status', 'open')
      .order('member_count', { ascending: false }).limit(3)

    let text = `Hey${userName ? ` ${userName}` : ''}! נ‘‹ `
    if (groups?.length) {
      text += `There are ${groups.length} active groups right now:\n`
      groups.forEach((g: any) => { text += `ג¡ ${g.name} ג€” ${g.member_count} people\n` })
      text += '\nWant me to find something near you?'
    } else {
      text += `I'm here whenever you need me. Ask me anything! ג¦`
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
        checkTeebyProactive(session.user.id)
        loadCustomNamesFromDB(session.user.id)
        loadContactsInBackground(session.user.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
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






