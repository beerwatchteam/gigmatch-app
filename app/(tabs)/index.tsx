import { useEffect, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ScrollView, FlatList, Platform, Image, ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs, limit, query, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, storage } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const ADMIN_EMAIL = 'beerwatchbusiness@gmail.com';

// ── Types ──────────────────────────────────────────────────────────

type SlotGig = {
  id: string;
  title: string;
  datetime: string;
  ticketUrl: string | null;
  imageUrl: string | null;
  featured: boolean;
};

type FeaturedVenue = {
  venueId: string;
  venueName: string;
  address: string;
  suburb: string;
  postcode: string;
  gigs: SlotGig[];
};

type VenueDoc = {
  id: string;
  name: string;
  streetAddress?: string;
  suburb?: string;
  postcode?: string;
  genres?: string[];
  slots?: Record<string, any[]>;
};

const isWeb = Platform.OS === 'web';

// ── Static fallback venues (shown when no live booked slots exist) ────

const FALLBACK_VENUES: FeaturedVenue[] = [
  {
    venueId:   'fallback-1',
    venueName: 'The Corner Hotel',
    address:   '57 Swan St',
    suburb:    'Richmond',
    postcode:  '3121',
    gigs: [
      { id: 'f1', title: 'Live Music Night', datetime: '2026-08-22T20:00', ticketUrl: null, imageUrl: null, featured: false },
    ],
  },
  {
    venueId:   'fallback-2',
    venueName: 'The Tote',
    address:   '71 Johnston St',
    suburb:    'Collingwood',
    postcode:  '3066',
    gigs: [
      { id: 'f2', title: 'Open Mic Night', datetime: '2026-08-23T19:30', ticketUrl: null, imageUrl: null, featured: false },
    ],
  },
  {
    venueId:   'fallback-3',
    venueName: 'The Espy',
    address:   '11 The Esplanade',
    suburb:    'St Kilda',
    postcode:  '3182',
    gigs: [
      { id: 'f3', title: 'Saturday Sessions', datetime: '2026-08-23T21:00', ticketUrl: null, imageUrl: null, featured: false },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function timeTo24h(timeStr?: string): string {
  if (!timeStr) return '20:00';
  const parts = timeStr.trim().split(' ');
  const [h, m] = parts[0].split(':').map(Number);
  const period = (parts[1] || '').toUpperCase();
  let hours = h;
  if (period === 'PM' && h !== 12) hours += 12;
  if (period === 'AM' && h === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
}

function formatDatetime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function buildLiveGigsData(venues: VenueDoc[]): FeaturedVenue[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return venues
    .map(venue => {
      const allBooked = Object.entries(venue.slots || {}).flatMap(([day, slots]) =>
        (slots || [])
          .filter((s: any) => s.status === 'booked' && s.date)
          .map((s: any) => ({ ...s, day }))
      );

      const upcoming = allBooked
        .filter((s: any) => new Date(s.date) >= today)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (upcoming.length === 0) return null;

      const featured = upcoming.filter((s: any) => s.featured);
      const gigs = (featured.length > 0 ? featured : upcoming.slice(0, 3)).map((s: any) => ({
        id:        s.id || s.date,
        title:     s.bandName || 'TBA',
        datetime:  `${s.date}T${timeTo24h(s.time)}`,
        ticketUrl: s.ticketUrl  || null,
        imageUrl:  s.imageUrl   || null,
        featured:  s.featured   || false,
      }));

      return {
        venueId:   venue.id,
        venueName: venue.name,
        address:   venue.streetAddress || '',
        suburb:    venue.suburb        || '',
        postcode:  venue.postcode      || '',
        gigs,
      };
    })
    .filter((v): v is FeaturedVenue => v !== null);
}

// ── GigCarousel ────────────────────────────────────────────────────

function GigCarousel({ gigs }: { gigs: SlotGig[] }) {
  const [index, setIndex] = useState(0);

  if (gigs.length === 0) {
    return <Text style={cs.empty}>No gigs listed yet</Text>;
  }

  const gig     = gigs[index];
  const hasPrev = index > 0;
  const hasNext = index < gigs.length - 1;

  return (
    <View style={cs.carousel}>
      <View style={cs.gigImage}>
        {gig.imageUrl
          ? <Image source={{ uri: gig.imageUrl }} style={cs.gigImageImg} />
          : <View style={cs.gigImagePlaceholder} />
        }
      </View>

      <Text style={cs.gigTitle}>{gig.title}</Text>
      <Text style={cs.gigDatetime}>{formatDatetime(gig.datetime)}</Text>

      {gig.ticketUrl ? (
        <TouchableOpacity style={cs.ticketBtn}>
          <Text style={cs.ticketBtnText}>Tickets</Text>
        </TouchableOpacity>
      ) : (
        <View style={[cs.ticketBtn, cs.ticketBtnDisabled]}>
          <Text style={cs.ticketBtnTextDisabled}>Tickets TBA</Text>
        </View>
      )}

      {gigs.length > 1 && (
        <View style={cs.controls}>
          <TouchableOpacity
            style={[cs.arrow, !hasPrev && cs.arrowDisabled]}
            onPress={() => setIndex(i => i - 1)}
            disabled={!hasPrev}
          >
            <Text style={cs.arrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={cs.counter}>{index + 1} / {gigs.length}</Text>
          <TouchableOpacity
            style={[cs.arrow, !hasNext && cs.arrowDisabled]}
            onPress={() => setIndex(i => i + 1)}
            disabled={!hasNext}
          >
            <Text style={cs.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const cs = StyleSheet.create({
  carousel:             { gap: 8 },
  empty:                { fontSize: 13, color: '#999999', fontStyle: 'italic' },
  gigImage:             { width: '100%', height: 120, borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  gigImageImg:          { width: '100%', height: '100%' },
  gigImagePlaceholder:  { width: '100%', height: '100%', backgroundColor: '#111111', borderRadius: 8 },
  gigTitle:             { fontSize: 15, fontWeight: '700', color: '#111111' },
  gigDatetime:          { fontSize: 12, color: '#666666' },
  ticketBtn:            { alignSelf: 'flex-start', backgroundColor: Colors.orange, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
  ticketBtnDisabled:    { backgroundColor: '#e5e5e5' },
  ticketBtnText:        { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  ticketBtnTextDisabled:{ fontSize: 12, fontWeight: '600', color: '#999999' },
  controls:             { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  arrow:                { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  arrowDisabled:        { opacity: 0.35 },
  arrowText:            { fontSize: 20, color: '#111111', lineHeight: 26 },
  counter:              { fontSize: 12, color: '#666666' },
});

// ── Why GigMatch ───────────────────────────────────────────────────

const WHY_MUSICIANS = [
  "Apply directly to a venue's open dates.",
  'One profile handles every inquiry — no more chasing venues by email.',
];
const WHY_VENUES = [
  "See an artist's full profile — sound, socials, past shows — before you say yes.",
  'Manage every inquiry against your calendar in one place.',
];

// ── HomeScreen ─────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const [displayData, setDisplayData]   = useState<FeaturedVenue[]>([]);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);

  const isAdmin  = user?.email === ADMIN_EMAIL;
  const isArtist = profile?.type === 'artist';

  // Live-sync venue data
  useEffect(() => {
    getDocs(query(collection(db, 'venues'), limit(8)))
      .then(snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as VenueDoc[];
        setDisplayData(buildLiveGigsData(docs));
      })
      .catch(() => {});
  }, []);

  // Live-sync hero image from Firestore
  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'homepage'), snap => {
      setHeroImageUrl(snap.data()?.heroImageUrl ?? null);
    });
  }, []);

  async function pickHeroImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled) return;
    setHeroUploading(true);
    try {
      const uri  = result.assets[0].uri;
      const blob = await (await fetch(uri)).blob();
      const storageRef = ref(storage, 'settings/hero-cover');
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);
      await setDoc(doc(db, 'settings', 'homepage'), { heroImageUrl: url }, { merge: true });
    } catch (e) {
      console.error('Hero upload failed', e);
    } finally {
      setHeroUploading(false);
    }
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <View style={s.hero}>
          {/* Background image */}
          {heroImageUrl ? (
            <>
              <Image source={{ uri: heroImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={[StyleSheet.absoluteFill, s.heroOverlay]} />
            </>
          ) : null}

          <Text style={s.headline}>
            Find your next gig or your next act,{' '}
            <Text style={s.headlineAccent}>without the email back-and-forth.</Text>
          </Text>
          <Text style={s.heroSub}>
            Browse open slots, apply directly, get booked — all in one place.
          </Text>
          <View style={s.heroCtas}>
            <TouchableOpacity style={s.ctaFilled} onPress={() => router.push('/(tabs)/venues')}>
              <Text style={s.ctaFilledText}>I'm a Musician — Find Gigs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ctaOutline} onPress={() => router.push('/(tabs)/musicians')}>
              <Text style={s.ctaOutlineText}>I'm a Venue — Find Acts</Text>
            </TouchableOpacity>
          </View>

          {/* Admin: edit cover photo */}
          {isAdmin && (
            <TouchableOpacity style={s.editHeroBtn} onPress={pickHeroImage} disabled={heroUploading}>
              {heroUploading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.editHeroBtnText}>Edit Cover Photo</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* ── Featured Venues ── */}
        {(() => {
          const venueData = displayData.length > 0 ? displayData : FALLBACK_VENUES;
          return (
          <View style={[s.featuredSection, { borderBottomColor: colors.border }]}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>On the lineup</Text>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Featured Venues</Text>
            </View>
            <FlatList
              horizontal
              data={venueData}
              keyExtractor={v => v.venueId}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.venueTrack}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.venueCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}
                  onPress={() => !item.venueId.startsWith('fallback') && router.push(`/venue/${item.venueId}`)}
                  activeOpacity={item.venueId.startsWith('fallback') ? 1 : 0.9}
                >
                  <Text style={[s.venueCardName, { color: colors.black }]}>{item.venueName}</Text>
                  <Text style={[s.venueCardAddr, { color: colors.grey }]}>
                    {[item.address, item.suburb, item.postcode].filter(Boolean).join(', ')}
                  </Text>
                  <View style={s.gigSection}>
                    <Text style={s.gigLabel}>Upcoming gigs</Text>
                    <GigCarousel gigs={item.gigs} />
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
          );
        })()}

        {/* ── Why GigMatch ── */}
        <View style={[s.whySection, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
          <View style={s.sectionInner}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>Why GigMatch</Text>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Built for the way live music actually works</Text>
            </View>
            <View style={s.whyGrid}>
              {[
                { icon: '🎸', title: 'For Musicians', bullets: WHY_MUSICIANS },
                { icon: '🏟️', title: 'For Venues',   bullets: WHY_VENUES   },
              ].map(card => (
                <View key={card.title} style={[s.whyCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Text style={s.whyIcon}>{card.icon}</Text>
                  <Text style={[s.whyCardTitle, { color: colors.black }]}>{card.title}</Text>
                  {card.bullets.map(b => (
                    <View key={b} style={s.whyRow}>
                      <View style={s.whyBullet} />
                      <Text style={[s.whyText, { color: colors.black }]}>{b}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Logged-in quick actions (mobile only) ── */}
        {!isWeb && isArtist && (
          <View style={[s.quickSection, { borderTopColor: colors.border }]}>
            {[
              { label: 'My Profile', href: '/(tabs)/profile' as const },
              { label: 'Enquiries',  href: '/(tabs)/inbox'   as const },
            ].map(item => (
              <TouchableOpacity key={item.href} style={[s.row, { borderBottomColor: colors.borderFaint }]} onPress={() => router.push(item.href)}>
                <Text style={[s.rowLabel, { color: colors.black }]}>{item.label}</Text>
                <Text style={[s.chevron, { color: colors.greyLight }]}>›</Text>
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

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    backgroundColor: '#111111',
    paddingHorizontal: isWeb ? 40 : 20,
    paddingTop:    isWeb ? 80 : 52,
    paddingBottom: isWeb ? 72 : 56,
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroOverlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  editHeroBtn: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  editHeroBtnText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
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
  ctaFilled: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  ctaFilledText: { fontSize: 15, fontWeight: '700', color: '#111111' },
  ctaOutline: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  ctaOutlineText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },

  // ── Featured venues ────────────────────────────────────────────────
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
  venueCardAddr: { fontSize: 13, color: '#555555' },
  gigSection: {
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: 14, marginTop: 10, gap: 8,
  },
  gigLabel: {
    fontSize: 11, fontWeight: '700', color: '#555555',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },

  // ── Why GigMatch ───────────────────────────────────────────────────
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
  whyIcon:      { fontSize: 28 },
  whyCardTitle: { fontSize: 20, fontWeight: '800', color: '#111111', marginBottom: 6 },
  whyRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  whyBullet:    { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(250,131,12,0.15)', marginTop: 1, flexShrink: 0 },
  whyText:      { fontSize: 14, color: '#111111', lineHeight: 22, flex: 1 },

  // ── Quick actions (mobile) ─────────────────────────────────────────
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
  chevron:  { fontSize: 20, color: Colors.greyLight },

  // ── Footer ────────────────────────────────────────────────────────
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
