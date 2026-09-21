import { useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, useWindowDimensions, Modal } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Ticket, Microphone, Compass, Envelope } from 'phosphor-react-native';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useInboxBadgeCount, markConfirmedSeen, type Enquiry } from '@/lib/useEnquiries';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const isWeb = Platform.OS === 'web';
export const TOP_TAB_H   = 52;
export const BOTTOM_TAB_H = 52;
export const WEB_TAB_H   = 48;


// ── Web tab bar (text-only, horizontal) ──────────────────────────

function WebTabBar({ state, descriptors, navigation, badgeCount, greenTick }: any) {
  const { colors } = useTheme();
  const { user: tabUser, profile: tabProfile } = useAuth();
  const router = useRouter();

  const BOTTOM_ROUTES = ['venues', 'musicians', 'discover', 'inbox'];
  const LABELS: Record<string, string> = {
    venues:    'Venues',
    musicians: 'Musicians',
    discover:  'Discover',
    inbox:     'Inbox',
  };

  return (
    <View style={[wb.bar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      {/* Logo */}
      <TouchableOpacity style={wb.logo} onPress={() => router.push('/')} activeOpacity={0.8}>
        <Text style={[wb.logoText, { color: colors.black }]}>Twaylo Gigs</Text>
        <View style={wb.betaBadge}><Text style={wb.betaText}>Beta</Text></View>
      </TouchableOpacity>

      {/* Centred tabs */}
      <View style={wb.tabsCenter}>
      <View style={wb.tabs}>
        {state.routes.map((route: any, i: number) => {
          const { options } = descriptors[route.key];
          if (!BOTTOM_ROUTES.includes(route.name) || options.href === null) return null;
          const focused = state.index === i;
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
              {route.name === 'inbox' && greenTick && (
                <View style={[wb.badge, { backgroundColor: '#16a34a' }]}>
                  <Text style={wb.badgeText}>✓</Text>
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
          <Text style={wb.myProfileText}>{tabProfile?.type === 'venue' ? 'My Venue' : 'My Profile'}</Text>
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
  const { user: tabUser, profile: tabProfile } = useAuth();

  return (
    <View style={[tb.bar, { top: insets.top, backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      <TouchableOpacity style={tb.logo} onPress={() => router.push('/')} activeOpacity={0.8}>
        <Text style={tb.logoText}>Twaylo Gigs</Text>
      </TouchableOpacity>

      {tabUser ? (
        <TouchableOpacity style={tb.myProfileBtn} onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.8}>
          <Text style={tb.myProfileText}>{tabProfile?.type === 'venue' ? 'My Venue' : 'My Profile'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={tb.loginBtn} onPress={() => router.push('/login')} activeOpacity={0.8}>
          <Text style={tb.loginText}>Log In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Bottom tab bar (all 4 tabs) ───────────────────────────────────

function BottomTabBar({ state, descriptors, navigation, badgeCount, greenTick }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const BOTTOM_ROUTES = ['venues', 'musicians', 'discover', 'inbox'];

  const LABELS: Record<string, string> = {
    venues:    'Venues',
    musicians: 'Musicians',
    discover:  'Discover',
    inbox:     'Inbox',
  };

  return (
    <View style={[
      bb.bar,
      {
        backgroundColor: colors.bg,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom,
        height: BOTTOM_TAB_H + insets.bottom,
        bottom: 0,
      },
    ]}>
      {state.routes.map((route: any, i: number) => {
        const { options } = descriptors[route.key];
        if (!BOTTOM_ROUTES.includes(route.name) || options.href === null) return null;
        const focused = state.index === i;
        const iconColor = focused ? colors.black : colors.grey;
        const badge   = route.name === 'inbox' ? badgeCount : 0;
        const label   = LABELS[route.name] ?? route.name;

        const w = focused ? 'fill' : 'regular';
        function renderIcon() {
          switch (route.name) {
            case 'venues':    return <Ticket    size={24} weight={w} color={iconColor} />;
            case 'musicians': return <Microphone size={24} weight={w} color={iconColor} />;
            case 'discover':  return <Compass   size={24} weight={w} color={iconColor} />;
            case 'inbox':     return <Envelope  size={24} weight={w} color={iconColor} />;
            default:          return null;
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
              {route.name === 'inbox' && greenTick && (
                <View style={[bb.badge, bb.badgeLeft, { backgroundColor: '#16a34a' }]}>
                  <Text style={bb.badgeText}>✓</Text>
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
  loginBtn:      { position: 'absolute', right: 16, backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  loginText:     { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  myProfileBtn:  { position: 'absolute', right: 16, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  myProfileText: { fontSize: 13, fontWeight: '600', color: Colors.grey },
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
  tab:       { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 3, paddingTop: 10 },
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
  badgeLeft: {
    right: undefined,
    left: -8,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 16 },
});

// ── Confirmed gig modal ───────────────────────────────────────────

function ConfirmedGigModal({
  enquiry,
  onAcknowledge,
  onViewInInbox,
}: {
  enquiry: Enquiry;
  onAcknowledge: () => void;
  onViewInInbox: () => void;
}) {
  const { colors } = useTheme();

  const dateStr = enquiry.requestedSlot.date
    ? new Date(enquiry.requestedSlot.date + 'T12:00:00').toLocaleDateString('en-AU', {
        weekday: 'short', day: 'numeric', month: 'long',
      })
    : enquiry.requestedSlot.day ?? '';
  const timeStr = enquiry.requestedSlot.time ?? '';
  const slotStr = [dateStr, timeStr].filter(Boolean).join(' at ');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onAcknowledge}>
      <View style={cgm.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onAcknowledge} activeOpacity={1} />
        <View style={[cgm.card, { backgroundColor: colors.bg }]}>
          <View style={cgm.checkCircle}>
            <Text style={cgm.checkMark}>✓</Text>
          </View>
          <Text style={[cgm.heading, { color: colors.black }]}>Gig confirmed!</Text>
          <Text style={[cgm.bandName, { color: colors.black }]}>{enquiry.bandName}</Text>
          <Text style={[cgm.detail, { color: colors.grey }]}>{enquiry.venueName}</Text>
          {slotStr ? (
            <Text style={[cgm.detail, { color: colors.grey }]}>{slotStr}</Text>
          ) : null}
          <View style={cgm.btnRow}>
            <TouchableOpacity
              style={[cgm.secondaryBtn, { borderColor: colors.border }]}
              onPress={onAcknowledge}
            >
              <Text style={[cgm.secondaryBtnText, { color: colors.black }]}>Got it</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cgm.primaryBtn} onPress={onViewInInbox}>
              <Text style={cgm.primaryBtnText}>View in inbox</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const cgm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 32,
    elevation: 12,
  },
  checkCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(22,163,74,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  checkMark: { fontSize: 28, color: '#16a34a' },
  heading:   { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  bandName:  { fontSize: 17, fontWeight: '700', marginTop: 2 },
  detail:    { fontSize: 14, textAlign: 'center' },
  btnRow:    { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});

// ── Layout ────────────────────────────────────────────────────────
export default function TabsLayout() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const {
    count: badgeCount,
    hasUnseenConfirmed,
    unseenConfirmedEnquiries,
  } = useInboxBadgeCount(
    user?.uid ?? null,
    profile?.venueId ?? null,
  );

  // Track which confirmed gigs have been dismissed this session (before Firestore write lands)
  const [sessionAcknowledged, setSessionAcknowledged] = useState<Set<string>>(new Set());

  const pendingModal = unseenConfirmedEnquiries.find(e => !sessionAcknowledged.has(e.id)) ?? null;

  const handleAcknowledge = useCallback((enquiryId: string) => {
    setSessionAcknowledged(prev => new Set([...prev, enquiryId]));
    if (user?.uid) markConfirmedSeen(enquiryId, user.uid).catch(() => {});
  }, [user?.uid]);

  const handleViewInInbox = useCallback((enquiryId: string) => {
    handleAcknowledge(enquiryId);
    router.push(`/(tabs)/inbox?openEnquiryId=${enquiryId}` as any);
  }, [handleAcknowledge, router]);

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
      {pendingModal && (
        <ConfirmedGigModal
          enquiry={pendingModal}
          onAcknowledge={() => handleAcknowledge(pendingModal.id)}
          onViewInInbox={() => handleViewInInbox(pendingModal.id)}
        />
      )}
      <Tabs
        tabBar={props => !isMobileWeb && isWeb ? (
          <WebTabBar {...props} badgeCount={badgeCount} greenTick={hasUnseenConfirmed} />
        ) : (
          <>
            <TopTabBar {...props} />
            <BottomTabBar {...props} badgeCount={badgeCount} greenTick={hasUnseenConfirmed} />
          </>
        )}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: !isMobileWeb && isWeb
            ? { paddingTop: WEB_TAB_H }
            : isMobileWeb
              ? { paddingBottom: bottomPad }
              : {
                  paddingTop: insets.top + TOP_TAB_H,
                  paddingBottom: bottomPad,
                },
        }}
      >
        <Tabs.Screen name="index"     options={{ href: null }} />
        <Tabs.Screen name="venues"    options={{ title: 'Venues' }} />
        <Tabs.Screen name="musicians" options={{ title: 'Musicians' }} />
        <Tabs.Screen name="discover"  options={{ title: 'Discover' }} />
        <Tabs.Screen name="inbox"     options={{ title: 'Inbox', tabBarBadge: badgeCount || undefined, ...(!user ? { href: null } : {}) }} />
        <Tabs.Screen name="gigs"      options={{ href: null }} />
        <Tabs.Screen name="profile"   options={{ href: null }} />
      </Tabs>
    </View>
  );
}
