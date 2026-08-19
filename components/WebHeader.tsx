import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useInboxBadgeCount } from '@/lib/useEnquiries';

const NAV_LINKS = [
  { label: 'Venues',    href: '/(tabs)/venues'    as const },
  { label: 'Musicians', href: '/(tabs)/musicians'  as const },
  { label: 'Inbox',     href: '/(tabs)/inbox'      as const },
];

export default function WebHeader() {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const venueId   = profile?.venueId ?? null;
  const badgeCount = useInboxBadgeCount(user?.uid ?? null, venueId);

  const isActive = (href: string) => {
    const segment = href.split('/').pop() ?? '';
    return pathname.includes(segment);
  };

  return (
    <View style={styles.bar}>
      {/* Logo */}
      <TouchableOpacity onPress={() => router.push('/(tabs)')} style={styles.logoWrap}>
        <Text style={styles.logo}>GigMatch</Text>
        <View style={styles.beta}>
          <Text style={styles.betaText}>Beta</Text>
        </View>
      </TouchableOpacity>

      {/* Nav links */}
      <View style={styles.nav}>
        {NAV_LINKS.map(link => {
          const isInbox = link.label === 'Inbox';
          return (
            <TouchableOpacity
              key={link.href}
              style={[styles.link, isActive(link.href) && styles.linkActive]}
              onPress={() => router.push(link.href)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.linkText, isActive(link.href) && styles.linkTextActive]}>
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
            style={[styles.link, isActive('profile') && styles.linkActive]}
            onPress={() =>
              profile?.type === 'venue' && profile.venueId
                ? router.push(`/venue/${profile.venueId}`)
                : router.push('/(tabs)/profile')
            }
          >
            <Text style={[styles.linkText, isActive('profile') && styles.linkTextActive]}>
              {profile?.type === 'venue' ? 'My Venue' : 'My Profile'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Right actions */}
      <View style={styles.right}>
        {user ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={() => signOut(auth)}>
            <Text style={styles.logoutText}>Log out</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  link: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
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
