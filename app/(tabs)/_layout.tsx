import { Tabs } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

const ACCENT = '#6C63FF'
const TEAL = '#00BFA6'
const GRAY = '#8A8A9A'

function TabIcon({ emoji, count, focused }: { emoji: string; count?: number; focused: boolean }) {
  return (
    <View style={s.iconWrap}>
      <Text style={[s.iconEmoji, focused && s.iconEmojiFocused]}>{emoji}</Text>
      {(count || 0) > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{(count || 0) > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  )
}

export default function TabsLayout() {
  const [unread, setUnread] = useState(0)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    checkUnread()
    const channel = supabase.channel('unread-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => checkUnread())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const checkUnread = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at').eq('user_id', user.id)
    let count = 0
    for (const m of myGroups || []) {
      const lastRead = m.last_read_at || new Date(0).toISOString()
      const { count: c } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('group_id', m.group_id).neq('user_id', user.id).gt('created_at', lastRead)
      count += c || 0
    }
    setUnread(count)
  }

  const tabBarHeight = 58 + insets.bottom

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#16213E',
        borderTopWidth: 0,
        height: tabBarHeight,
        paddingBottom: insets.bottom + 4,
        paddingTop: 8,
        elevation: 20,
        shadowColor: '#6C63FF',
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      tabBarActiveTintColor: TEAL,
      tabBarInactiveTintColor: GRAY,
      tabBarLabelStyle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Chats',
        tabBarIcon: ({ focused }) => <TabIcon emoji="💬" count={unread} focused={focused} />,
      }} />
      <Tabs.Screen name="feed" options={{
        title: 'Feed',
        tabBarIcon: ({ focused }) => <TabIcon emoji="🌐" focused={focused} />,
      }} />
      <Tabs.Screen name="marketplace" options={{
        title: 'Market',
        tabBarIcon: ({ focused }) => <TabIcon emoji="🛍️" focused={focused} />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: 'Explore',
        tabBarIcon: ({ focused }) => <TabIcon emoji="📡" focused={focused} />,
      }} />
      <Tabs.Screen name="agent" options={{
        title: 'Teeby',
        tabBarIcon: ({ focused }) => <TabIcon emoji="✦" focused={focused} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Me',
        tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
      }} />
      <Tabs.Screen name="radar" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative', width: 32, height: 28 },
  iconEmoji: { fontSize: 20, opacity: 0.5 },
  iconEmojiFocused: { opacity: 1 },
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#FF4757', borderRadius: 10, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#16213E' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
})
