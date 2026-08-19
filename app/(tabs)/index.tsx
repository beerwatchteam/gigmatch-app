import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

type Venue = {
  id: string; name: string;
  streetAddress?: string; suburb?: string; postcode?: string; state?: string;
};

const isWeb = Platform.OS === 'web';

const WHY_MUSICIANS = [
  "Apply directly to a venue's open dates.",
  'One profile handles every inquiry — no more chasing venues by email.',
];
const WHY_VENUES = [
  "See an artist's full profile — sound, socials, past shows — before you say yes.",
  'Manage every inquiry against your calendar in one place.',
];

export default function HomeScreen() {
  const router = useRouter();
  const { profile, user } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);

  useEffect(() => {
    getDocs(query(collection(db, 'venues'), limit(8)))
      .then(snap => setVenues(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Venue[]))
      .catch(() => {});
  }, []);

  const isVenue  = profile?.type === 'venue';
  const isArtist = profile?.type === 'artist';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <View style={s.hero}>
          <Text style={s.headline}>
            Find your next gig or your next act,{' '}
            <Text style={s.headlineAccent}>without the email back-and-forth.</Text>
          </Text>
          <Text style={s.heroSub}>
            Browse open slots, apply directly, get booked — all in one place.
          </Text>
          <View style={s.heroCtas}>
            <TouchableOpacity style={s.ctaBtn} onPress={() => router.push('/(tabs)/venues')}>
              <Text style={s.ctaBtnText}>I'm a Musician — Find Gigs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ctaBtn} onPress={() => router.push('/(tabs)/musicians')}>
              <Text style={s.ctaBtnText}>I'm a Venue — Find Acts</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Featured Venues ── */}
        {venues.length > 0 && (
          <View style={s.featuredSection}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>On the lineup</Text>
              <Text style={s.sectionTitle}>Featured Venues</Text>
            </View>
            <FlatList
              horizontal
              data={venues}
              keyExtractor={v => v.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.venueTrack}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.venueCard}
                  onPress={() => router.push(`/venue/${item.id}`)}
                >
                  <Text style={s.venueCardName}>{item.name}</Text>
                  <Text style={s.venueCardAddr}>
                    {[item.streetAddress, item.suburb, item.postcode]
                      .filter(Boolean).join(', ')}
                  </Text>

                  {/* Upcoming gigs section — matching web app */}
                  <View style={s.gigSection}>
                    <Text style={s.gigLabel}>UPCOMING GIGS</Text>
                    <View style={s.gigPlaceholder} />
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* ── Why GigMatch ── */}
        <View style={s.whySection}>
          <View style={s.sectionInner}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>Why GigMatch</Text>
              <Text style={s.sectionTitle}>Built for the way live music actually works</Text>
            </View>
            <View style={s.whyGrid}>
              <View style={s.whyCard}>
                <Text style={s.whyIcon}>🎸</Text>
                <Text style={s.whyCardTitle}>For Musicians</Text>
                {WHY_MUSICIANS.map(b => (
                  <View key={b} style={s.whyRow}>
                    <View style={s.whyBullet} />
                    <Text style={s.whyText}>{b}</Text>
                  </View>
                ))}
              </View>
              <View style={s.whyCard}>
                <Text style={s.whyIcon}>🏟️</Text>
                <Text style={s.whyCardTitle}>For Venues</Text>
                {WHY_VENUES.map(b => (
                  <View key={b} style={s.whyRow}>
                    <View style={s.whyBullet} />
                    <Text style={s.whyText}>{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Logged-in quick actions (mobile only) ── */}
        {!isWeb && isArtist && (
          <View style={s.quickSection}>
            {[
              { label: 'My Profile',  href: '/(tabs)/profile' as const },
              { label: 'Enquiries',   href: '/(tabs)/inbox'   as const },
            ].map(item => (
              <TouchableOpacity key={item.href} style={s.row} onPress={() => router.push(item.href)}>
                <Text style={s.rowLabel}>{item.label}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerLogo}>GigMatch</Text>
          <Text style={s.footerCopy}>© {new Date().getFullYear()} GigMatch. All rights reserved.</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  // ── Hero ────────────────────────────────────────────────────────
  hero: {
    backgroundColor: '#111111',
    paddingHorizontal: isWeb ? 40 : 20,
    paddingTop:    isWeb ? 80 : 52,
    paddingBottom: isWeb ? 72 : 56,
    alignItems: 'center',
  },
  headline: {
    fontSize: isWeb ? 42 : 30,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: isWeb ? 50 : 38,
    letterSpacing: -0.5,
    textAlign: 'center',
    maxWidth: 720,
    marginBottom: 16,
  },
  headlineAccent: { color: Colors.orange },
  heroSub: {
    fontSize: isWeb ? 17 : 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: isWeb ? 28 : 24,
    maxWidth: 520,
    marginBottom: 40,
  },
  heroCtas: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 16,
    justifyContent: 'center',
    flexWrap: 'wrap',
    alignSelf: isWeb ? 'center' : 'stretch',
  },
  ctaBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  ctaBtnText: { fontSize: 15, fontWeight: '700', color: '#111111' },

  // ── Featured venues ──────────────────────────────────────────────
  featuredSection: {
    paddingTop: 64,
    paddingBottom: 64,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  sectionHeader: {
    paddingHorizontal: isWeb ? 40 : 20,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.orange,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
  },
  sectionTitle: {
    fontSize: isWeb ? 28 : 22, fontWeight: '800', color: '#111111', letterSpacing: -0.3,
  },
  venueTrack: {
    paddingHorizontal: isWeb ? 40 : 20,
    paddingVertical: 8,
    gap: 24,
  },
  venueCard: {
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    width: isWeb ? 320 : 280,
    gap: 4,
  },
  venueCardName: { fontSize: 19, fontWeight: '700', color: '#111111' },
  venueCardAddr: { fontSize: 13, color: '#111111' },
  gigSection: {
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: 14, marginTop: 10,
  },
  gigLabel: {
    fontSize: 11, fontWeight: '700', color: '#111111',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  gigPlaceholder: {
    width: '100%', height: 140, backgroundColor: '#111111', borderRadius: 10,
  },

  // ── Why GigMatch ─────────────────────────────────────────────────
  whySection: {
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  sectionInner: {
    paddingHorizontal: isWeb ? 40 : 20,
    paddingVertical: 64,
    maxWidth: 1200,
  },
  whyGrid: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 32,
  },
  whyCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 32,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    gap: 14,
  },
  whyIcon: { fontSize: 28 },
  whyCardTitle: { fontSize: 20, fontWeight: '800', color: '#111111', marginBottom: 6 },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  whyBullet: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(250,131,12,0.15)',
    marginTop: 1, flexShrink: 0,
  },
  whyText: { fontSize: 14, color: '#111111', lineHeight: 22, flex: 1 },

  // ── Quick actions (mobile) ────────────────────────────────────────
  quickSection: {
    paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: 32,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  rowLabel: { fontSize: 15, color: '#111111', fontWeight: '500' },
  chevron: { fontSize: 20, color: Colors.greyLight },

  // ── Footer ───────────────────────────────────────────────────────
  footer: {
    backgroundColor: '#111111',
    paddingHorizontal: isWeb ? 40 : 20,
    paddingVertical: 32,
    flexDirection: isWeb ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerLogo: { fontSize: 18, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  footerCopy: { fontSize: 13, color: '#888888' },
});
