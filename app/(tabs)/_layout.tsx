import { Tabs } from 'expo-router'
import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useUnread } from '../../src/hooks/useUnread'
import { TeebyFAB } from '../../src/components/TeebyFAB'
import { PRIMARY, GRAY, BG, BORDER } from '../../src/constants'

function TabIcon({ emoji, count, focused }: { emoji: string; count?: number; focused: boolean }) {
  return (
    <View style={s.wrap}>
      <View style={[s.box, focused && s.boxActive]}>
        <Text style={[s.emoji, focused && s.emojiFocused]}>{emoji}</Text>
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
  const insets = useSafeAreaInsets()
  const { total } = useUnread()

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: BG,
        borderTopWidth: 0.5,
        borderTopColor: BORDER,
        height: 64 + insets.bottom,
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
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500', marginTop: 2 },
    }}>
      <Tabs.Screen name='index' options={{ title: 'Chats', tabBarIcon: ({ focused }) => <TabIcon emoji='💬' count={total} focused={focused} /> }} />
      <Tabs.Screen name='feed' options={{ title: 'Feed', tabBarIcon: ({ focused }) => <TabIcon emoji='🌐' focused={focused} /> }} />
      <Tabs.Screen name='marketplace' options={{ title: 'Market', tabBarIcon: ({ focused }) => <TabIcon emoji='🛍️' focused={focused} /> }} />
      <Tabs.Screen name='explore' options={{ title: 'Explore', tabBarIcon: ({ focused }) => <TabIcon emoji='📡' focused={focused} /> }} />
      <Tabs.Screen name='agent' options={{ href: null }} />
      <Tabs.Screen name='profile' options={{ title: 'Me', tabBarIcon: ({ focused }) => <TabIcon emoji='👤' focused={focused} /> }} />
    </Tabs>
    {/* Floating "Ask Teeby" — sits above the tab bar on every tab. */}
    <TeebyFAB />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  box: { width: 40, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  boxActive: { backgroundColor: 'rgba(108,99,255,0.1)' },
  emoji: { fontSize: 20, opacity: 0.45 },
  emojiFocused: { opacity: 1 },
  badge: { position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 9, fontWeight: '700', color: PRIMARY },
})
