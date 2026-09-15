import { useEffect, useState, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ScrollView,
  Platform, Image, ActivityIndicator, Animated, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
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

type PreviewSlot = { id?: string; time: string; status: string; room?: string };
type PreviewVenue = { name: string; slots: Record<string, PreviewSlot[]> };
type PreviewOccurrence = { date: Date; day: string; slot: PreviewSlot };

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_TO_DAY: Record<number, string> = {
  0:'Sunday',1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',
};

// ── Timetable preview helpers ──────────────────────────────────────

function getPreviewSlots(slots: Record<string, PreviewSlot[]>, max: number): PreviewOccurrence[] {
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today); end.setMonth(end.getMonth() + 3);
  const results: PreviewOccurrence[] = [];
  const cur = new Date(today);
  while (cur <= end && results.length < max) {
    const day = DOW_TO_DAY[cur.getDay()];
    const dateISO = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const recurOpen = (slots?.[day] || []).filter(s => !(s as any).date && s.status === 'open');
    const overrideTimes = new Set(
      (slots?.[day] || [])
        .filter(s => (s as any).date === dateISO && (s.status === 'booked' || s.status === 'pending'))
        .map(s => s.time.toLowerCase().trim())
    );
    recurOpen.forEach(slot => {
      if (results.length < max && !overrideTimes.has(slot.time.toLowerCase().trim())) {
        results.push({ date: new Date(cur), day, slot });
      }
    });
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

// ── TimetablePreviewRow ────────────────────────────────────────────

function TimetablePreviewRow({ date, day, slot, onEnquire, colors }: {
  date: Date; day: string; slot: PreviewSlot; onEnquire: () => void; colors: any;
}) {
  const dayAbbr = day.slice(0, 3).toUpperCase();
  const meta = [slot.time, slot.room].filter(Boolean).join(' · ');
  return (
    <View style={[ps.row, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      <View style={ps.dateBox}>
        <Text style={[ps.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[ps.dateMonth, { color: colors.grey }]}>{SHORT_MONTHS[date.getMonth()].toUpperCase()}</Text>
      </View>
      <Text style={[ps.dayAbbr, { color: colors.grey }]}>{dayAbbr}</Text>
      <Text style={[ps.meta, { color: colors.black, flex: 1 }]}>{meta}</Text>
      <View style={ps.actions}>
        <View style={ps.openBadge}>
          <Text style={ps.openBadgeText}>Open</Text>
        </View>
        <TouchableOpacity style={ps.enquireBtn} onPress={onEnquire}>
          <Text style={ps.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const ps = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderLeftWidth: 4, borderLeftColor: Colors.orange,
    borderRadius: 8, marginBottom: 8,
    paddingVertical: 14, paddingHorizontal: 16, gap: 12,
  },
  dateBox:    { width: 34, alignItems: 'center', flexShrink: 0 },
  dateNum:    { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  dateMonth:  { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  dayAbbr:    { width: 28, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 },
  meta:       { fontSize: 15, fontWeight: '600' },
  actions:    { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  openBadge:  { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  openBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  enquireBtn: { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  enquireBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});

// ── Problem cards ──────────────────────────────────────────────────

// Copy imported from constants/copy.ts

// ── HomeScreen ─────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = isWeb && width >= 780;
  const [heroImageUrl, setHeroImageUrl]   = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);
  const [testVenue, setTestVenue]         = useState<PreviewVenue | null>(null);

  const isAdmin  = user?.email === ADMIN_EMAIL;
  const isArtist = profile?.type === 'artist';

  // Scroll-driven hero fade on web
  const scrollY    = useRef(new Animated.Value(0)).current;
  const heroHeight = isWeb ? 640 : 420;
  const heroOpacity  = scrollY.interpolate({ inputRange: [0, heroHeight * 0.65], outputRange: [1, 0], extrapolate: 'clamp' });
  const heroTranslateY = scrollY.interpolate({ inputRange: [0, heroHeight], outputRange: [0, -26], extrapolate: 'clamp' });
  const glowOpacity  = scrollY.interpolate({ inputRange: [0, heroHeight], outputRange: [1, 0.4], extrapolate: 'clamp' });

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'homepage'), snap => {
      setHeroImageUrl(snap.data()?.heroImageUrl ?? null);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'venues', 'test-venue'), snap => {
      if (snap.exists()) setTestVenue(snap.data() as PreviewVenue);
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

  const previewSlots = testVenue ? getPreviewSlots(testVenue.slots || {}, 6) : [];
  const isLoggedIn = !!user;

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
          <View style={[s.problemGrid, isWide && s.problemGridWeb]}>
            {PROBLEMS.map(({ title, bullets }, i) => (
              <View
                key={title}
                style={[
                  s.problemCard,
                  { backgroundColor: colors.bg, borderColor: colors.border },
                  isWide && s.problemCardWeb,
                  !isWide && { flex: undefined },
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
          <View style={[s.audienceGrid, isWide && s.audienceGridWeb]}>

            {/* Artists — dark card */}
            <View style={[s.audienceCard, s.audienceCardDark, !isWide && { flex: undefined }]}>
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
            <View style={[s.audienceCard, s.audienceCardDark, !isWide && { flex: undefined }]}>
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

        {/* ── Live Timetable Preview ───────────────────────────── */}
        {previewSlots.length > 0 && (
          <View style={[s.featuredSection, { borderBottomColor: colors.border }]}>
            <View style={s.sectionHeader}>
              <Text style={s.eyebrow}>Live timetable</Text>
              <Text style={[s.sectionTitle, { color: colors.black }]}>
                {testVenue?.name ?? 'Open slots'}
              </Text>
            </View>
            <View style={s.timetableList}>
              {previewSlots.map(({ date, day, slot }, i) => (
                <TimetablePreviewRow
                  key={`${date.toISOString()}-${slot.id || i}`}
                  date={date} day={day} slot={slot}
                  colors={colors}
                  onEnquire={() => isLoggedIn
                    ? router.push('/venue/test-venue' as any)
                    : router.push('/login?mode=signup&tab=artist' as any)
                  }
                />
              ))}
            </View>
            <TouchableOpacity
              style={s.viewAllBtn}
              onPress={() => router.push('/venue/test-venue' as any)}
            >
              <Text style={[s.viewAllText, { color: Colors.orange }]}>View full timetable →</Text>
            </TouchableOpacity>
          </View>
        )}

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

  // ── Timetable preview ─────────────────────────────────────────────
  featuredSection: {
    paddingTop: 64, paddingBottom: 64,
    borderBottomWidth: 1,
  },
  timetableList: {
    paddingHorizontal: isWeb ? 40 : 24,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  viewAllBtn: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingTop: 16,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  viewAllText: { fontSize: 15, fontWeight: '600' },

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
