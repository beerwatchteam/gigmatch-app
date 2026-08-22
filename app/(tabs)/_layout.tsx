import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useInboxBadgeCount } from '@/lib/useEnquiries';

const isWeb = Platform.OS === 'web';
export const TOP_TAB_H   = 52;
export const BOTTOM_TAB_H = 60;

// ── Inline SVG-style icons ────────────────────────────────────────

function InboxIcon({ color }: { color: string }) {
  // Envelope shape: rectangle body + V-fold line
  return (
    <View style={{ width: 24, height: 18, borderWidth: 1.5, borderColor: color, borderRadius: 3 }}>
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 9,
        borderBottomWidth: 1.5,
        borderBottomColor: color,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        // Clip to create V shape by overlapping two diagonal borders
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', top: -1, left: -2, right: -2, bottom: 0,
          borderBottomWidth: 11,
          borderBottomColor: 'transparent',
          borderLeftWidth: 14,
          borderLeftColor: color,
          borderRightWidth: 14,
          borderRightColor: color,
          opacity: 0,
        }} />
      </View>
      {/* Left diagonal */}
      <View style={{
        position: 'absolute', top: 0, left: 0,
        width: 13, height: 1.5, backgroundColor: color,
        transform: [{ rotate: '37deg' }, { translateX: -1 }, { translateY: 4 }],
      }} />
      {/* Right diagonal */}
      <View style={{
        position: 'absolute', top: 0, right: 0,
        width: 13, height: 1.5, backgroundColor: color,
        transform: [{ rotate: '-37deg' }, { translateX: 1 }, { translateY: 4 }],
      }} />
    </View>
  );
}

function ProfileIcon({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      {/* Head */}
      <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: color }} />
      {/* Shoulders arc */}
      <View style={{
        width: 20, height: 10,
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
        borderWidth: 1.5, borderBottomWidth: 0,
        borderColor: color,
      }} />
    </View>
  );
}

// ── Top tab bar (Venues + Musicians + GigMatch logo + Log In) ─────

function TopTabBar({ state, descriptors, navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user: tabUser } = useAuth();

  // Only render Venues and Musicians in the top bar
  const TOP_ROUTES = ['venues', 'musicians'];

  return (
    <View style={[tb.bar, { top: insets.top, backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      {state.routes.map((route: any, i: number) => {
        const { options } = descriptors[route.key];
        if (!TOP_ROUTES.includes(route.name) || options.href === null) return null;
        const focused = state.index === i;

        return (
          <TouchableOpacity
            key={route.key}
            style={[tb.tab, focused && tb.tabFocused]}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            activeOpacity={0.75}
          >
            <Text style={[tb.label, { color: focused ? Colors.orange : colors.black }, focused && tb.labelFocused]}>
              {options.title ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={tb.logo} onPress={() => router.push('/')} activeOpacity={0.8}>
        <Text style={tb.logoText}>GigMatch</Text>
      </TouchableOpacity>

      {!tabUser && (
        <TouchableOpacity style={tb.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.8}>
          <Text style={tb.loginText}>Log In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Bottom tab bar (Inbox + Profile — logged-in users only) ───────

function BottomTabBar({ state, descriptors, navigation, badgeCount, profileTabTitle }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user: tabUser, profile: tabProfile } = useAuth();

  const onProfileScreen =
    pathname.includes('edit-venue') ||
    pathname.includes('edit-profile') ||
    (tabProfile?.venueId ? pathname.includes(tabProfile.venueId) : false) ||
    (tabUser?.uid ? pathname.startsWith('/musician/') && pathname.includes(tabUser.uid) : false);

  const BOTTOM_ROUTES = ['inbox', 'profile'];

  return (
    <View style={[
      bb.bar,
      {
        backgroundColor: colors.bg,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom,
        bottom: 0,
      },
    ]}>
      {state.routes.map((route: any, i: number) => {
        const { options } = descriptors[route.key];
        if (!BOTTOM_ROUTES.includes(route.name) || options.href === null) return null;
        const focused = (state.index === i) || (route.name === 'profile' && onProfileScreen);
        const color   = focused ? Colors.orange : colors.grey;
        const badge   = route.name === 'inbox' ? badgeCount : 0;
        const label   = route.name === 'profile' ? profileTabTitle : 'Inbox';

        return (
          <TouchableOpacity
            key={route.key}
            style={bb.tab}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            activeOpacity={0.75}
          >
            <View style={bb.iconWrap}>
              {route.name === 'inbox'
                ? <InboxIcon color={color} />
                : <ProfileIcon color={color} />
              }
              {badge > 0 && (
                <View style={bb.badge}>
                  <Text style={bb.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
            </View>
            <Text style={[bb.label, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0, right: 0,
    zIndex: 1000,
    height: TOP_TAB_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    gap: 4,
    paddingHorizontal: 16,
  },
  tab:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  tabFocused:   { backgroundColor: Colors.orange + '18' },
  label:        { fontSize: 14, fontWeight: '500' },
  labelFocused: { fontWeight: '700' },
  logo:         { position: 'absolute', left: 16 },
  logoText:     { fontSize: 16, fontWeight: '800', color: Colors.orange, letterSpacing: -0.5 },
  loginBtn:     { position: 'absolute', right: 16, backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  loginText:    { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});

const bb = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0, right: 0,
    zIndex: 1000,
    height: BOTTOM_TAB_H,
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  tab:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 },
  iconWrap: { position: 'relative' },
  label:    { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  badge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: Colors.orange,
    borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 16 },
});

// ── Layout ────────────────────────────────────────────────────────
export default function TabsLayout() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const badgeCount = useInboxBadgeCount(
    user?.uid ?? null,
    profile?.venueId ?? null,
  );

  const profileTabTitle = !user
    ? 'Profile'
    : profile?.type === 'venue'
      ? 'My Venue'
      : 'My Profile';

  const bottomPad = !isWeb && user ? BOTTOM_TAB_H + insets.bottom : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        tabBar={isWeb ? () => null : props => (
          <>
            <TopTabBar {...props} />
            {!!user && (
              <BottomTabBar
                {...props}
                badgeCount={badgeCount}
                profileTabTitle={profileTabTitle}
              />
            )}
          </>
        )}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          ...(isWeb ? {} : {
            sceneContainerStyle: {
              paddingTop: insets.top + TOP_TAB_H,
              paddingBottom: bottomPad,
            },
          }),
        }}
      >
        <Tabs.Screen name="index"     options={{ href: null }} />
        <Tabs.Screen name="venues"    options={{ title: 'Venues' }} />
        <Tabs.Screen name="musicians" options={{ title: 'Musicians' }} />
        <Tabs.Screen name="inbox"     options={{ title: 'Inbox', tabBarBadge: badgeCount || undefined, ...(!user ? { href: null } : {}) }} />
        <Tabs.Screen name="profile"   options={{ title: profileTabTitle, ...(!user ? { href: null } : {}) }} />
      </Tabs>
    </View>
  );
}
