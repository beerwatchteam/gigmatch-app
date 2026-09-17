import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/Text';
import { useRouter, usePathname } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useInboxBadgeCount } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';

const NAV_LINKS = [
  { label: 'Venues',    href: '/(tabs)/venues'    as const },
  { label: 'Musicians', href: '/(tabs)/musicians'  as const },
  { label: 'Inbox',     href: '/(tabs)/inbox'      as const },
];

export default function WebHeader() {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const venueId    = profile?.venueId ?? null;
  const badgeCount = useInboxBadgeCount(user?.uid ?? null, venueId);
  const { colors, isDark, toggleDark } = useTheme();

  const isActive = (href: string) => {
    const segment = href.split('/').pop() ?? '';
    return pathname.includes(segment);
  };

  const isProfileActive =
    pathname.includes('profile') ||
    pathname.includes('edit-venue') ||
    pathname.includes('edit-profile') ||
    (profile?.venueId ? pathname.includes(profile.venueId) : false) ||
    (user?.uid ? pathname.startsWith('/musician/') && pathname.includes(user.uid) : false);

  return (
    <View style={[styles.bar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      {/* Logo */}
      <TouchableOpacity onPress={() => router.push('/landing')} style={styles.logoWrap}>
        <Text style={[styles.logo, { color: colors.black }]}>GottaGig</Text>
        <View style={styles.beta}>
          <Text style={styles.betaText}>Beta</Text>
        </View>
      </TouchableOpacity>

      {/* Nav links — absolutely centred in the bar */}
      <View style={styles.nav} pointerEvents="box-none">
        {NAV_LINKS.map(link => {
          const isInbox = link.label === 'Inbox';
          if (isInbox && !user) return null;
          return (
            <TouchableOpacity
              key={link.href}
              style={[styles.link, isActive(link.href) && styles.linkActive]}
              onPress={() => router.push(link.href)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.linkText, { color: colors.black }, isActive(link.href) && styles.linkTextActive]}>
                  {link.label}
                </Text>
                {isInbox && badgeCount > 0 && user && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badgeCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {user ? (
          <TouchableOpacity
            style={[styles.link, isProfileActive && styles.linkActive]}
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Text style={[styles.linkText, { color: colors.black }, isProfileActive && styles.linkTextActive]}>
              {profile?.type === 'venue' ? 'My Venue' : 'My Profile'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Right actions */}
      <View style={styles.right}>
        {/* Dark mode toggle */}
        <TouchableOpacity style={[styles.themeBtn, { borderColor: colors.border }]} onPress={toggleDark}>
          <Text style={styles.themeBtnText}>{isDark ? '☀️' : '🌙'}</Text>
        </TouchableOpacity>
        {user ? (
          <TouchableOpacity style={[styles.logoutBtn, { borderColor: colors.border }]} onPress={async () => { await signOut(auth); router.replace('/'); }}>
            <Text style={[styles.logoutText, { color: colors.grey }]}>Log out</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/login')}>
            <Text style={styles.loginText}>Log in</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 0,
    height: 60,
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 40,
  },
  logo: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.black,
    letterSpacing: -0.3,
  },
  beta: {
    backgroundColor: Colors.bgFaint,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  betaText: { fontSize: 10, color: Colors.grey, fontWeight: '600' },
  nav: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  link: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  linkActive: {
    backgroundColor: 'rgba(250,131,12,0.12)',
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.black,
  },
  linkTextActive: {
    color: Colors.orange,
    fontWeight: '600',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  logoutText: { fontSize: 14, color: Colors.grey, fontWeight: '600' },
  loginBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  loginText: { fontSize: 14, color: Colors.black, fontWeight: '700' },
  themeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  themeBtnText: { fontSize: 14 },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
});
