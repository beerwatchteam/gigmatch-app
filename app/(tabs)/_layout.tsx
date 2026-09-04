import { View, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useInboxBadgeCount } from '@/lib/useEnquiries';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const isWeb = Platform.OS === 'web';
export const TOP_TAB_H   = 52;
export const BOTTOM_TAB_H = 60;
export const WEB_TAB_H   = 48;

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
      <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: color }} />
      <View style={{
        width: 20, height: 10,
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
        borderWidth: 1.5, borderBottomWidth: 0,
        borderColor: color,
      }} />
    </View>
  );
}

function SlotsIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 20, height: 17, justifyContent: 'space-between' }}>
      <View style={{ height: 2.5, backgroundColor: color, borderRadius: 1.5 }} />
      <View style={{ height: 2.5, backgroundColor: color, borderRadius: 1.5 }} />
      <View style={{ height: 2.5, backgroundColor: color, borderRadius: 1.5, width: '65%' }} />
    </View>
  );
}

function VenuesIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 22, alignItems: 'center' }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 4.5, height: 4.5, borderRadius: 2.5, backgroundColor: color }} />
      </View>
      <View style={{ width: 1.5, height: 5, backgroundColor: color, marginTop: 0 }} />
    </View>
  );
}

function MusiciansIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: color }} />
      <View style={{ position: 'absolute', width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
    </View>
  );
}

// ── Web tab bar (text-only, horizontal) ──────────────────────────

function WebTabBar({ state, descriptors, navigation, badgeCount, profileTabTitle }: any) {
  const { colors } = useTheme();
  const { user: tabUser, profile: tabProfile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const onProfileScreen =
    pathname.includes('edit-venue') ||
    pathname.includes('edit-profile') ||
    (tabProfile?.venueId ? pathname.includes(tabProfile.venueId) : false) ||
    (tabUser?.uid ? pathname.startsWith('/musician/') && pathname.includes(tabUser.uid) : false);

  const BOTTOM_ROUTES = ['venues', 'musicians', 'inbox', 'profile'];
  const LABELS: Record<string, string> = {
    venues:    'Venues',
    musicians: 'Musicians',
    inbox:     'Inbox',
    profile:   profileTabTitle,
  };

  return (
    <View style={[wb.bar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      {/* Logo */}
      <TouchableOpacity style={wb.logo} onPress={() => router.push('/')} activeOpacity={0.8}>
        <Text style={[wb.logoText, { color: colors.black }]}>GigMatch</Text>
        <View style={wb.betaBadge}><Text style={wb.betaText}>Beta</Text></View>
      </TouchableOpacity>

      {/* Centred tabs */}
      <View style={wb.tabsCenter}>
      <View style={wb.tabs}>
        {state.routes.map((route: any, i: number) => {
          const { options } = descriptors[route.key];
          if (!BOTTOM_ROUTES.includes(route.name) || options.href === null) return null;
          const focused = (state.index === i) || (route.name === 'profile' && onProfileScreen);
          const badge   = route.name === 'inbox' ? badgeCount : 0;
          const label   = LABELS[route.name] ?? route.name;

          return (
            <TouchableOpacity
              key={route.key}
              style={wb.tab}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              activeOpacity={0.75}
            >
              <Text style={[wb.label, { color: focused ? colors.black : colors.grey }]}>
                {label}
              </Text>
              {badge > 0 && (
                <View style={wb.badge}>
                  <Text style={wb.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
              {focused && <View style={wb.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
      </View>

      {tabUser ? (
        <TouchableOpacity style={wb.myProfileBtn} onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.8}>
          <Text style={wb.myProfileText}>My Profile</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={wb.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.8}>
          <Text style={wb.loginText}>Log In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Top bar (logo + login only) ───────────────────────────────────

function TopTabBar(_props: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user: tabUser } = useAuth();

  return (
    <View style={[tb.bar, { top: insets.top, backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
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

// ── Bottom tab bar (all 4 tabs) ───────────────────────────────────

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

  const BOTTOM_ROUTES = ['venues', 'musicians', 'inbox', 'profile'];

  const LABELS: Record<string, string> = {
    venues:    'Venues',
    musicians: 'Musicians',
    inbox:     'Inbox',
    profile:   profileTabTitle,
  };

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
        const iconColor = focused ? colors.black : colors.grey;
        const badge   = route.name === 'inbox' ? badgeCount : 0;
        const label   = LABELS[route.name] ?? route.name;

        function renderIcon() {
          switch (route.name) {
            case 'venues':    return <SlotsIcon color={iconColor} />;
            case 'musicians': return <MusiciansIcon color={iconColor} />;
            case 'inbox':     return <InboxIcon color={iconColor} />;
            default:          return <ProfileIcon color={iconColor} />;
          }
        }

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
            {focused && <View style={bb.activeBar} />}
            <View style={bb.iconWrap}>
              {renderIcon()}
              {badge > 0 && (
                <View style={bb.badge}>
                  <Text style={bb.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
            </View>
            <Text style={[bb.label, { color: focused ? colors.black : colors.grey }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const wb = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 1000,
    height: WEB_TAB_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingHorizontal: 24,
  },
  logo:       { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoText:   { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  betaBadge:  { backgroundColor: '#f0f0f0', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  betaText:   { fontSize: 10, fontWeight: '600', color: Colors.grey },
  tabsCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center', pointerEvents: 'box-none' as any },
  tabs: { flexDirection: 'row', height: WEB_TAB_H },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: WEB_TAB_H,
    gap: 6,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 0, left: 14, right: 14,
    height: 2,
    backgroundColor: Colors.orange,
    borderRadius: 1,
  },
  label: { fontSize: 14, fontWeight: '600' },
  badge: {
    backgroundColor: Colors.orange,
    borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 16 },
  loginBtn:      { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  loginText:     { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  myProfileBtn:  { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  myProfileText: { fontSize: 13, fontWeight: '600', color: Colors.grey },
});

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
  tab:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 },
  activeBar: { position: 'absolute', top: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.orange, borderRadius: 1 },
  iconWrap:  { position: 'relative' },
  label:     { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
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
  const { width } = useWindowDimensions();
  const badgeCount = useInboxBadgeCount(
    user?.uid ?? null,
    profile?.venueId ?? null,
  );

  const profileTabTitle = !user
    ? 'Profile'
    : profile?.type === 'venue'
      ? 'My Venue'
      : 'My Profile';

  // Mobile web: treat like native (top logo bar + bottom tabs)
  const isMobileWeb = isWeb && width < 768;
  const useNativeLayout = !isWeb || isMobileWeb;
  const bottomPad = useNativeLayout ? BOTTOM_TAB_H + insets.bottom : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        tabBar={props => !isMobileWeb && isWeb ? (
          <WebTabBar
            {...props}
            badgeCount={badgeCount}
            profileTabTitle={profileTabTitle}
          />
        ) : (
          <>
            <TopTabBar {...props} />
            <BottomTabBar
              {...props}
              badgeCount={badgeCount}
              profileTabTitle={profileTabTitle}
            />
          </>
        )}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneContainerStyle: !isMobileWeb && isWeb
            ? { paddingTop: WEB_TAB_H }
            : {
                paddingTop: insets.top + TOP_TAB_H,
                paddingBottom: bottomPad,
              },
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
