import { Tabs } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

const PRIMARY = '#6C63FF'
const GRAY = '#8A8A9A'
const BG = '#FAFAFE'

function TabIcon({ emoji, count, focused, label }: { emoji: string; count?: number; focused: boolean; label: string }) {
  return (
    <View style={s.iconWrap}>
      <View style={[s.iconBox, focused && s.iconBoxActive]}>
        <Text style={[s.iconEmoji, focused && s.iconEmojiFocused]}>{emoji}</Text>
      </View>
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
    const interval = setInterval(checkUnread, 30000)
    const channel = supabase.channel('unread-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => checkUnread())
      .subscribe()
    return () => { clearInterval(interval); supabase.removeChannel(channel) }
  }, [])

  const checkUnread = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: myGroups } = await supabase
        .from('group_members').select('group_id, last_read_at').eq('user_id', user.id)
      if (!myGroups?.length) { setUnread(0); return }
      let count = 0
      for (const m of myGroups) {
        const lastRead = m.last_read_at || new Date(0).toISOString()
        const { count: c } = await supabase.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', m.group_id)
          .neq('user_id', user.id)
          .neq('type', 'system')
          .gt('created_at', lastRead)
        count += c || 0
      }
      setUnread(count)
    } catch {}
  }

  const tabBarHeight = 64 + insets.bottom

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: BG,
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(108,99,255,0.1)',
        height: tabBarHeight,
        paddingBottom: insets.bottom + 8,
        paddingTop: 8,
        elevation: 0,
        shadowColor: PRIMARY,
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -2 },
      },
      tabBarActiveTintColor: PRIMARY,
      tabBarInactiveTintColor: GRAY,
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500', letterSpacing: 0.2, marginTop: 2 },
      tabBarShowLabel: true,
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Chats',
        tabBarIcon: ({ focused }) => <TabIcon emoji="💬" count={unread} focused={focused} label="Chats" />,
      }} />
      <Tabs.Screen name="feed" options={{
        title: 'Feed',
        tabBarIcon: ({ focused }) => <TabIcon emoji="🌐" focused={focused} label="Feed" />,
      }} />
      <Tabs.Screen name="marketplace" options={{
        title: 'Market',
        tabBarIcon: ({ focused }) => <TabIcon emoji="🛍️" focused={focused} label="Market" />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: 'Explore',
        tabBarIcon: ({ focused }) => <TabIcon emoji="📡" focused={focused} label="Explore" />,
      }} />
      <Tabs.Screen name="agent" options={{
        title: 'Teeby',
        tabBarIcon: ({ focused }) => <TabIcon emoji="✦" focused={focused} label="Teeby" />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Me',
        tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} label="Me" />,
      }} />
      <Tabs.Screen name="radar" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  iconBox: { width: 40, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  iconBoxActive: { backgroundColor: 'rgba(108,99,255,0.1)' },
  iconEmoji: { fontSize: 20, opacity: 0.45 },
  iconEmojiFocused: { opacity: 1 },
  badge: { position: 'absolute', top: -4, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, fontWeight: '600', color: PRIMARY },
})
