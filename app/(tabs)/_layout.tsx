import { Tabs } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

const GREEN = '#1D9E75'
const GRAY = '#B4B2A9'
const PURPLE = '#7F77DD'

function TabIcon({ emoji, label, count, focused, color }: { emoji: string; label: string; count?: number; focused: boolean; color?: string }) {
  return (
    <View style={s.iconWrap}>
      <Text style={[s.iconEmoji, focused && { transform: [{ scale: 1.1 }] }]}>{emoji}</Text>
      {(count || 0) > 0 && (
        <View style={[s.badge, color ? { backgroundColor: color } : {}]}>
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => checkUnread())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const checkUnread = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at').eq('user_id', user.id)
    if (!myGroups?.length) return
    let count = 0
    for (const m of myGroups) {
      const lastRead = m.last_read_at || new Date(0).toISOString()
      const { count: c } = await supabase.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', m.group_id).neq('user_id', user.id).gt('created_at', lastRead)
      count += c || 0
    }
    setUnread(count)
  }

  const tabBarHeight = 56 + insets.bottom

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#fff',
        borderTopWidth: 0.5,
        borderTopColor: '#E0DED8',
        height: tabBarHeight,
        paddingBottom: insets.bottom + 4,
        paddingTop: 6,
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      tabBarActiveTintColor: GREEN,
      tabBarInactiveTintColor: GRAY,
      tabBarLabelStyle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.2, marginTop: 2 },
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Chats',
        tabBarIcon: ({ focused }) => <TabIcon emoji="💬" label="Chats" count={unread} focused={focused} />,
      }} />
      <Tabs.Screen name="feed" options={{
        title: 'Feed',
        tabBarIcon: ({ focused }) => <TabIcon emoji={focused ? '🌐' : '🌍'} label="Feed" focused={focused} />,
      }} />
      <Tabs.Screen name="marketplace" options={{
        title: 'Market',
        tabBarIcon: ({ focused }) => <TabIcon emoji={focused ? '🛍️' : '🛒'} label="Market" focused={focused} />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: 'Explore',
        tabBarIcon: ({ focused }) => <TabIcon emoji="📡" label="Explore" focused={focused} />,
      }} />
      <Tabs.Screen name="agent" options={{
        title: 'Teeby',
        tabBarIcon: ({ focused }) => <TabIcon emoji="✦" label="Teeby" focused={focused} color={focused ? PURPLE : undefined} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Me',
        tabBarIcon: ({ focused }) => <TabIcon emoji={focused ? '👤' : '👤'} label="Me" focused={focused} />,
      }} />
      <Tabs.Screen name="radar" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative', width: 32, height: 28 },
  iconEmoji: { fontSize: 20 },
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#E24B4A', borderRadius: 10, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
})
