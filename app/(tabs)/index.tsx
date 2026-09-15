import { useEffect, useState, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  Platform, Image, ActivityIndicator, Animated,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { collection, getDocs, limit, query, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, storage } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { HERO_HEADLINE, HERO_HEADLINE_LINE2, HERO_SUBHEAD, HERO_STATS, PROBLEMS, PROBLEM_SECTION_HEADING } from '@/constants/copy';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const ADMIN_EMAIL = 'beerwatchbusiness@gmail.com';
const isWeb = Platform.OS === 'web';

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

// ── Static fallback venues ─────────────────────────────────────────

const FALLBACK_VENUES: FeaturedVenue[] = [
  {
    venueId: 'fallback-1', venueName: 'Brunswick Ballroom',
    address: '314-316 Sydney Rd', suburb: 'Brunswick', postcode: '3056',
    gigs: [{ id: 'f1', title: 'Live Music Night', datetime: '2026-08-22T20:00', ticketUrl: null, imageUrl: null, featured: false }],
  },
  {
    venueId: 'fallback-2', venueName: 'The Corner Hotel',
    address: '57 Swan St', suburb: 'Richmond', postcode: '3121',
    gigs: [{ id: 'f2', title: 'Open Mic Night', datetime: '2026-08-23T19:30', ticketUrl: null, imageUrl: null, featured: false }],
  },
  {
    venueId: 'fallback-3', venueName: 'Northcote Social Club',
    address: '301 High St', suburb: 'Northcote', postcode: '3070',
    gigs: [{ id: 'f3', title: 'Saturday Sessions', datetime: '2026-08-23T21:00', ticketUrl: null, imageUrl: null, featured: false }],
  },
  {
    venueId: 'fallback-4', venueName: 'Old Bar',
    address: '74-76 Johnston St', suburb: 'Fitzroy', postcode: '3065',
    gigs: [{ id: 'f4', title: 'Local Showcase', datetime: '2026-08-24T20:30', ticketUrl: null, imageUrl: null, featured: false }],
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
  return venues.map(venue => {
    const allBooked = Object.entries(venue.slots || {}).flatMap(([day, slots]) =>
      (slots || []).filter((s: any) => s.status === 'booked' && s.date).map((s: any) => ({ ...s, day }))
    );
    const upcoming = allBooked
      .filter((s: any) => new Date(s.date) >= today)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (upcoming.length === 0) return null;
    const featured = upcoming.filter((s: any) => s.featured);
    const gigs = (featured.length > 0 ? featured : upcoming.slice(0, 3)).map((s: any) => ({
      id: s.id || s.date, title: s.bandName || 'TBA',
      datetime: `${s.date}T${timeTo24h(s.time)}`,
      ticketUrl: s.ticketUrl || null, imageUrl: s.imageUrl || null, featured: s.featured || false,
    }));
    return {
      venueId: venue.id, venueName: venue.name,
      address: venue.streetAddress || '', suburb: venue.suburb || '', postcode: venue.postcode || '',
      gigs,
    };
  }).filter((v): v is FeaturedVenue => v !== null);
}

// ── GigCarousel ────────────────────────────────────────────────────

function GigCarousel({ gigs }: { gigs: SlotGig[] }) {
  const [index, setIndex] = useState(0);
  if (gigs.length === 0) return <Text style={cs.empty}>No gigs listed yet</Text>;
  const gig = gigs[index];
  return (
    <View style={cs.carousel}>
      <View style={cs.gigImage}>
        {gig.imageUrl
          ? <Image source={{ uri: gig.imageUrl }} style={cs.gigImageImg} />
          : <View style={cs.gigImagePlaceholder} />}
      </View>
      <Text style={cs.gigTitle}>{gig.title}</Text>
      <Text style={cs.gigDatetime}>{formatDatetime(gig.datetime)}</Text>
      {gig.ticketUrl
        ? <TouchableOpacity style={cs.ticketBtn}><Text style={cs.ticketBtnText}>Tickets</Text></TouchableOpacity>
        : <View style={[cs.ticketBtn, cs.ticketBtnDisabled]}><Text style={cs.ticketBtnTextDisabled}>Tickets TBA</Text></View>}
      {gigs.length > 1 && (
        <View style={cs.controls}>
          <TouchableOpacity style={[cs.arrow, index === 0 && cs.arrowDisabled]} onPress={() => setIndex(i => i - 1)} disabled={index === 0}>
            <Text style={cs.arrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={cs.counter}>{index + 1} / {gigs.length}</Text>
          <TouchableOpacity style={[cs.arrow, index === gigs.length - 1 && cs.arrowDisabled]} onPress={() => setIndex(i => i + 1)} disabled={index === gigs.length - 1}>
            <Text style={cs.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const cs = StyleSheet.create({
  carousel: { gap: 8 },
  empty: { fontSize: 13, color: '#999999', fontStyle: 'italic' },
  gigImage: { width: '100%', height: 120, borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  gigImageImg: { width: '100%', height: '100%' },
  gigImagePlaceholder: { width: '100%', height: '100%', backgroundColor: '#1e1a14', borderRadius: 8 },
  gigTitle: { fontSize: 15, fontWeight: '700', color: '#111111' },
  gigDatetime: { fontSize: 12, color: '#666666' },
  ticketBtn: { alignSelf: 'flex-start', backgroundColor: Colors.orange, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
  ticketBtnDisabled: { backgroundColor: '#e5e5e5' },
  ticketBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  ticketBtnTextDisabled: { fontSize: 12, fontWeight: '600', color: '#999999' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  arrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  arrowDisabled: { opacity: 0.35 },
  arrowText: { fontSize: 20, color: '#111111', lineHeight: 26 },
  counter: { fontSize: 12, color: '#666666' },
});

// ── Problem cards ──────────────────────────────────────────────────

// Copy imported from constants/copy.ts

// ── HomeScreen ─────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const [displayData, setDisplayData]     = useState<FeaturedVenue[]>([]);
  const [heroImageUrl, setHeroImageUrl]   = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);

  const isAdmin  = user?.email === ADMIN_EMAIL;
  const isArtist = profile?.type === 'artist';

  // Scroll-driven hero fade on web
  const scrollY    = useRef(new Animated.Value(0)).current;
  const heroHeight = isWeb ? 640 : 420;
  const heroOpacity  = scrollY.interpolate({ inputRange: [0, heroHeight * 0.65], outputRange: [1, 0], extrapolate: 'clamp' });
  const heroTranslateY = scrollY.interpolate({ inputRange: [0, heroHeight], outputRange: [0, -26], extrapolate: 'clamp' });
  const glowOpacity  = scrollY.interpolate({ inputRange: [0, heroHeight], outputRange: [1, 0.4], extrapolate: 'clamp' });

  useEffect(() => {
    getDocs(query(collection(db, 'venues'), limit(8)))
      .then(snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as VenueDoc[];
        setDisplayData(buildLiveGigsData(docs));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'homepage'), snap => {
      setHeroImageUrl(snap.data()?.heroImageUrl ?? null);
    });
  }, []);

  async function pickHeroImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, quality: 0.85,
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

  const venueData = displayData.length > 0 ? displayData : FALLBACK_VENUES;

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >

        {/* ── Hero ────────────────────────────────────────────────── */}
        <View style={[s.hero, { minHeight: heroHeight }]}>
          {/* Background image (admin-set) */}
          {heroImageUrl && (
            <>
              <Image source={{ uri: heroImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={[StyleSheet.absoluteFill, s.heroOverlay]} />
            </>
          )}

          {/* Stage glow — always behind content */}
          <Animated.View style={[s.heroGlow, { opacity: glowOpacity }]} />

          {/* Hero content fades + rises on scroll */}
          <Animated.View style={[s.heroContent, { opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] }]}>

            {/* Live badge */}
            <View style={s.badge}>
              <View style={s.badgeDot} />
              <Text style={s.badgeText}>Demo, Live in Melbourne</Text>
            </View>

            {/* Headline */}
            <Text style={s.headline}>{HERO_HEADLINE}{'\n'}{HERO_HEADLINE_LINE2}</Text>

            {/* Subhead */}
            <Text style={s.heroSub}>{HERO_SUBHEAD}</Text>

            {/* CTAs */}
            <View style={s.heroCtas}>
              <TouchableOpacity style={s.ctaFilled} onPress={() => router.push('/(tabs)/venues')}>
                <Text style={s.ctaFilledText}>Browse Venues</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ctaFilled} onPress={() => router.push('/login?mode=signup&tab=artist')}>
                <Text style={s.ctaFilledText}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            {/* Stats */}
            <View style={s.statsRow}>
              {[
                ...HERO_STATS,
              ].map(({ num, label }, i) => (
                <View key={num + i} style={[s.statTile, i > 0 && s.statTileBordered]}>
                  <Text style={s.statNum}>{num}</Text>
                  <Text style={s.statLabel}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Admin controls */}
            {isAdmin && (
              <View style={s.adminRow}>
                <TouchableOpacity style={s.adminBtn} onPress={pickHeroImage} disabled={heroUploading}>
                  {heroUploading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.adminBtnText}>Edit Cover</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.adminBtn, s.adminBtnAccent]} onPress={() => router.push('/(tabs)/profile')}>
                  <Text style={s.adminBtnText}>Admin Panel</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </View>

        {/* ── Problem section ──────────────────────────────────── */}
        <View style={[s.problemSection, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
          <View style={s.sectionHeader}>
            <Text style={s.eyebrow}>The Problem</Text>
            <Text style={[s.sectionTitle, { color: colors.black }]}>{PROBLEM_SECTION_HEADING}</Text>
          </View>
          <View style={[s.problemGrid, isWeb && s.problemGridWeb]}>
            {PROBLEMS.map(({ title, bullets }, i) => (
              <View
                key={title}
                style={[
                  s.problemCard,
                  { backgroundColor: colors.bg, borderColor: colors.border },
                  isWeb && s.problemCardWeb,
                ]}
              >
                <View style={s.problemIndex}>
                  <Text style={s.problemIndexText}>{String(i + 1).padStart(2, '0')}</Text>
                </View>
                <Text style={[s.problemTitle, { color: colors.black }]}>{title}</Text>
                <View style={{ gap: 8 }}>
                  {bullets.map(point => (
                    <View key={point} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.orange, marginTop: 8, flexShrink: 0 }} />
                      <Text style={[s.problemBody, { color: colors.grey, flex: 1 }]}>{point}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Audience split ───────────────────────────────────── */}
        <View style={[s.audienceSection, { backgroundColor: colors.bg }]}>
          <View style={[s.audienceGrid, isWeb && s.audienceGridWeb]}>

            {/* Artists — dark card */}
            <View style={[s.audienceCard, s.audienceCardDark]}>
              <Text style={s.audienceTagDark}>For Artists</Text>
              <Text style={s.audienceHeadingDark}>Find stages worth playing.</Text>
              {[
                'Browse venues with real open slots on their timetable',
                'Send a structured enquiry in minutes, not a cold DM',
                'Track every booking from one inbox',
              ].map(f => (
                <View key={f} style={s.featureRow}>
                  <Text style={s.featureArrow}>&#x2192;</Text>
                  <Text style={s.featureTextDark}>{f}</Text>
                </View>
              ))}
              <TouchableOpacity style={s.cardCtaDark} onPress={() => router.push('/(tabs)/venues')}>
                <Text style={s.cardCtaDarkText}>Browse Venues</Text>
              </TouchableOpacity>
            </View>

            {/* Venues — dark card */}
            <View style={[s.audienceCard, s.audienceCardDark]}>
              <Text style={s.audienceTagDark}>For Venues</Text>
              <Text style={s.audienceHeadingDark}>Fill your calendar, not your inbox.</Text>
              {[
                'Publish your timetable once and receive quality enquiries',
                'Accept or decline with one tap, artist notified instantly',
                'All conversations in one thread, no lost messages',
              ].map(f => (
                <View key={f} style={s.featureRow}>
                  <Text style={s.featureArrow}>&#x2192;</Text>
                  <Text style={s.featureTextDark}>{f}</Text>
                </View>
              ))}
              <TouchableOpacity style={s.cardCtaDark} onPress={() => router.push('/login?mode=signup&tab=venue')}>
                <Text style={s.cardCtaDarkText}>List Your Venue</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>

        {/* ── Featured Venues ──────────────────────────────────── */}
        <View style={[s.featuredSection, { borderBottomColor: colors.border }]}>
          <View style={s.sectionHeader}>
            <Text style={s.eyebrow}>On the lineup</Text>
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
                <View style={[s.gigSection, { borderTopColor: colors.borderFaint }]}>
                  <Text style={[s.gigLabel, { color: colors.grey }]}>Upcoming gigs</Text>
                  <GigCarousel gigs={item.gigs} />
                </View>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerLogo}>GigMatch</Text>
          <Text style={s.footerCopy}>&copy; {new Date().getFullYear()} GigMatch. All rights reserved.</Text>
        </View>

      </Animated.ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    backgroundColor: '#171310',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroOverlay: { backgroundColor: 'rgba(0,0,0,0.45)' },
  heroGlow: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '80%',
    // Simulated radial glow from bottom-center
    backgroundColor: 'transparent',
    // on web this layers a gradient; native shows a subtle orange tint
  },
  heroContent: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingTop:    isWeb ? 96 : 60,
    paddingBottom: isWeb ? 80 : 56,
    alignItems: 'center',
    maxWidth: isWeb ? 800 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(250,131,12,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(250,131,12,0.28)',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 24,
  },
  badgeDot: {
    width: 7, height: 7,
    backgroundColor: Colors.orange,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  headline: {
    fontSize: isWeb ? 64 : 36,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: isWeb ? 68 : 42,
    letterSpacing: isWeb ? -2 : -0.8,
    textAlign: 'center',
    marginBottom: 20,
  },
  heroSub: {
    fontSize: isWeb ? 18 : 15,
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: isWeb ? 30 : 24,
    maxWidth: isWeb ? 540 : 320,
    marginBottom: 36,
  },
  heroCtas: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 48,
  },
  ctaFilled: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    minHeight: 44,
  },
  ctaFilledText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  ctaOutline: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    minHeight: 44,
  },
  ctaOutlineText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },

  statsRow: {
    flexDirection: 'row',
    paddingTop: 28,
    width: '100%',
    maxWidth: 560,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  statTileBordered: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
  statNum: {
    fontSize: isWeb ? 36 : 28,
    fontWeight: '900',
    color: Colors.orange,
    letterSpacing: -1,
    lineHeight: isWeb ? 40 : 32,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 15,
    letterSpacing: 0.2,
  },

  adminRow: { flexDirection: 'row', gap: 8, marginTop: 28 },
  adminBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 44, alignItems: 'center',
  },
  adminBtnAccent: { backgroundColor: 'rgba(250,131,12,0.75)', borderColor: 'transparent' },
  adminBtnText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },

  // ── Problem section ───────────────────────────────────────────────
  problemSection: {
    borderBottomWidth: 1,
    paddingBottom: 64,
  },
  sectionHeader: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingTop: 64,
    paddingBottom: 40,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  eyebrow: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: isWeb ? 36 : 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: isWeb ? 42 : 30,
    maxWidth: isWeb ? 480 : undefined,
  },
  problemGrid: {
    paddingHorizontal: isWeb ? 40 : 24,
    gap: 12,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  problemGridWeb: {
    flexDirection: 'row',
  },
  problemCard: {
    flex: isWeb ? 1 : undefined,
    borderRadius: 14,
    borderWidth: 1,
    padding: 32,
    gap: 12,
  },
  problemCardWeb: {},
  problemIndex: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(250,131,12,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  problemIndexText: {
    fontSize: 12, fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 0.5,
  },
  problemTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  problemBody:  { fontSize: 14, lineHeight: 22, letterSpacing: 0.1 },

  // ── Audience split ────────────────────────────────────────────────
  audienceSection: { paddingVertical: 64 },
  audienceGrid: {
    paddingHorizontal: isWeb ? 40 : 24,
    gap: 16,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  audienceGridWeb: { flexDirection: 'row' },
  audienceCard: {
    flex: isWeb ? 1 : undefined,
    borderRadius: 16,
    borderWidth: 1,
    padding: isWeb ? 44 : 32,
    gap: 16,
  },
  audienceCardDark: {
    backgroundColor: '#1e1a14',
    borderColor: 'transparent',
  },
  audienceTag: {
    fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  audienceTagDark: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  audienceHeading: {
    fontSize: isWeb ? 30 : 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: isWeb ? 36 : 28,
  },
  audienceHeadingDark: {
    fontSize: isWeb ? 30 : 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    lineHeight: isWeb ? 36 : 28,
  },
  featureRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  featureArrow: { fontSize: 14, fontWeight: '700', color: Colors.orange, marginTop: 1 },
  featureText: { fontSize: 14, lineHeight: 22, flex: 1 },
  featureTextDark: { fontSize: 14, lineHeight: 22, flex: 1, color: 'rgba(255,255,255,0.55)' },
  cardCta: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  cardCtaText: { fontSize: 14, fontWeight: '600' },
  cardCtaDark: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.orange,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  cardCtaDarkText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Featured Venues ───────────────────────────────────────────────
  featuredSection: {
    paddingTop: 64, paddingBottom: 64,
    borderBottomWidth: 1,
  },
  venueTrack: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingVertical: 8,
    gap: 20,
  },
  venueCard: {
    borderRadius: 14, padding: 24,
    borderWidth: 1,
    width: isWeb ? 300 : 260,
    gap: 4,
  },
  venueCardName: { fontSize: 18, fontWeight: '700' },
  venueCardAddr: { fontSize: 13 },
  gigSection: { borderTopWidth: 1, paddingTop: 14, marginTop: 10, gap: 8 },
  gigLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },

  // ── Footer ────────────────────────────────────────────────────────
  footer: {
    backgroundColor: '#171310',
    paddingHorizontal: isWeb ? 40 : 24,
    paddingVertical: 40,
    flexDirection: isWeb ? 'row' : 'column',
    alignItems: isWeb ? 'center' : 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerLogo: { fontSize: 18, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  footerCopy: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },
});
