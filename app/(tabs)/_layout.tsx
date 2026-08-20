import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useInboxBadgeCount } from '@/lib/useEnquiries';

const isWeb = Platform.OS === 'web';
export const TOP_TAB_H = 52;

// ── Custom top tab bar ────────────────────────────────────────────
function TopTabBar({ state, descriptors, navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const onProfileScreen = pathname.includes('edit-venue') || pathname.includes('edit-profile');

  return (
    <View
      style={[
        tb.bar,
        {
          top: insets.top,
          backgroundColor: colors.bg,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {state.routes.map((route: any, i: number) => {
        const { options } = descriptors[route.key];
        if (route.name === 'index' || options.href === null) return null;
        const focused = (state.index === i) || (route.name === 'profile' && onProfileScreen);
        const badge   = options.tabBarBadge;

        return (
          <TouchableOpacity
            key={route.key}
            style={[tb.tab, focused && tb.tabFocused]}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            activeOpacity={0.75}
          >
            <Text
              style={[
                tb.label,
                { color: focused ? Colors.orange : colors.black },
                focused && tb.labelFocused,
              ]}
            >
              {options.title ?? route.name}
            </Text>
            {badge != null && badge > 0 ? (
              <View style={tb.badge}>
                <Text style={tb.badgeText}>{badge > 99 ? '99+' : badge}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    height: TOP_TAB_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    gap: 4,
    paddingHorizontal: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    position: 'relative',
  },
  tabFocused: {
    backgroundColor: Colors.orange + '18',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  labelFocused: {
    fontWeight: '700',
  },
  badge: {
    marginLeft: 5,
    backgroundColor: Colors.orange,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 18,
  },
});

// ── Layout ────────────────────────────────────────────────────────
export default function TabsLayout() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const badgeCount = useInboxBadgeCount(
    user?.uid ?? null,
    profile?.venueId ?? null,
  );

  const profileTabTitle = !user
    ? 'Profile'
    : profile?.type === 'venue'
      ? 'My Venue'
      : 'My Profile';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        tabBar={isWeb ? () => null : props => <TopTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          // Push content below status bar + tab bar on native.
          // SafeAreaView in each screen handles the status bar inset;
          // sceneContainerStyle adds the extra TAB_H gap above that.
          ...(isWeb ? {} : { sceneContainerStyle: { paddingTop: TOP_TAB_H } }),
        }}
      >
        <Tabs.Screen name="index"     options={{ href: null }} />
        <Tabs.Screen name="venues"    options={{ title: 'Venues' }} />
        <Tabs.Screen name="musicians" options={{ title: 'Musicians' }} />
        <Tabs.Screen name="inbox"     options={{ title: 'Inbox', tabBarBadge: badgeCount || undefined, ...(!user ? { href: null } : {}) }} />
        <Tabs.Screen name="profile"   options={{ title: profileTabTitle }} />
      </Tabs>
    </View>
  );
}
