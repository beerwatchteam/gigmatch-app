import { useEffect, useState, useMemo } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ScrollView,
  Platform, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { PROBLEMS, PROBLEM_SECTION_HEADING } from '@/constants/copy';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const ADMIN_EMAIL = 'beerwatchbusiness@gmail.com';
const isWeb = Platform.OS === 'web';

// ── Types ──────────────────────────────────────────────────────────

type Slot = { id?: string; time: string; status: string; room?: string; date?: string };
type VenueData = {
  id: string; name: string; suburb?: string; capacity?: number;
  slots?: Record<string, Slot[]>;
  settings?: { listed?: boolean };
};
type OpenSlotItem = { venue: VenueData; date: Date; day: string; slot: Slot };

// ── Constants ──────────────────────────────────────────────────────

const DOW_TO_DAY: Record<number, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Helpers ────────────────────────────────────────────────────────

function computeOpenSlots(venues: VenueData[], days: number): OpenSlotItem[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + days);
  const results: OpenSlotItem[] = [];
  const cur = new Date(today);
  while (cur <= end) {
    const dayName = DOW_TO_DAY[cur.getDay()];
    const dateISO = cur.toISOString().slice(0, 10);
    for (const venue of venues) {
      const daySlots = venue.slots?.[dayName] ?? [];
      const overrideTimes = new Set(
        daySlots
          .filter(s => s.date === dateISO && (s.status === 'booked' || s.status === 'pending'))
          .map(s => s.time.toLowerCase().trim())
      );
      const openSlots = daySlots.filter(
        s => !s.date && s.status === 'open' && !overrideTimes.has(s.time.toLowerCase().trim())
      );
      for (const slot of openSlots) {
        results.push({ venue, date: new Date(cur), day: dayName, slot });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

// ── FortnightSlotRow ───────────────────────────────────────────────

function FortnightSlotRow({
  item, onEnquire, colors,
}: { item: OpenSlotItem; onEnquire: () => void; colors: any }) {
  const { venue, date, day, slot } = item;
  const dayAbbr   = day.slice(0, 3).toUpperCase();
  const monthAbbr = SHORT_MONTHS[date.getMonth()].toUpperCase();
  const meta      = [slot.time, slot.room].filter(Boolean).join(' · ');
  const venueLine = [
    venue.name,
    venue.suburb,
    venue.capacity ? `${venue.capacity} cap` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[fsr.row, { borderTopColor: '#e2dbd0' }]}>
      <View style={fsr.dateBracket}>
        <Text style={[fsr.dateNum, { color: '#111111' }]}>{date.getDate()}</Text>
        <Text style={[fsr.dateSub, { color: '#888888' }]}>{dayAbbr} {monthAbbr}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[fsr.meta, { color: '#111111' }]} numberOfLines={1}>{meta}</Text>
        <Text style={[fsr.venueLine, { color: '#888888' }]} numberOfLines={1}>{venueLine}</Text>
      </View>
      <TouchableOpacity style={fsr.enquireBtn} onPress={onEnquire}>
        <Text style={[fsr.enquireBtnText, { color: Colors.orange }]}>Enquire</Text>
      </TouchableOpacity>
    </View>
  );
}

const fsr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderTopWidth: 1,
  },
  dateBracket: {
    width: 54,
    borderLeftWidth: 3,
    borderLeftColor: Colors.orange,
    paddingLeft: 10,
    flexShrink: 0,
  },
  dateNum:   { fontSize: 22, fontWeight: '800', lineHeight: 24 },
  dateSub:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, marginTop: 1 },
  meta:      { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  venueLine: { fontSize: 12, fontWeight: '400', marginTop: 2 },
  enquireBtn: {
    borderWidth: 1,
    borderColor: Colors.orange,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexShrink: 0,
  },
  enquireBtnText: { fontSize: 13, fontWeight: '600' },
});

// ── HomeScreen ─────────────────────────────────────────────────────

export default function HomeScreen() {
  const router     = useRouter();
  const { user }   = useAuth();
  const { colors } = useTheme();
  const { width }  = useWindowDimensions();
  const isWide     = isWeb && width >= 960;

  const isAdmin    = user?.email === ADMIN_EMAIL;
  const isLoggedIn = !!user;

  const [venues, setVenues] = useState<VenueData[]>([]);

  useEffect(() => {
    getDocs(collection(db, 'venues')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as VenueData[];
      setVenues(all.filter(v => v.settings?.listed !== false));
    }).catch(console.error);
  }, []);

  const { fortnightSlots, openSlotsCount6wk } = useMemo(() => ({
    fortnightSlots:    computeOpenSlots(venues, 14),
    openSlotsCount6wk: computeOpenSlots(venues, 42).length,
  }), [venues]);

  const venueCount = venues.length;
  const endDate    = new Date(); endDate.setDate(endDate.getDate() + 14);
  const endLabel   = `${endDate.getDate()} ${SHORT_MONTHS[endDate.getMonth()]}`;

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <View style={[s.hero, { borderBottomColor: colors.border }]}>
          <View style={[s.heroInner, isWide && s.heroInnerWide]}>

            {/* Left column */}
            <View style={[s.heroLeft, isWide && s.heroLeftWide]}>

              {/* Live badge */}
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={[s.liveBadgeText, { color: colors.grey }]}>LIVE IN MELBOURNE</Text>
              </View>

              {/* Headline */}
              <Text style={[s.headline, { color: colors.black }]}>
                Every open slot in town, on one timetable.
              </Text>

              {/* Subhead */}
              <Text style={[s.subhead, { color: colors.grey }]}>
                GigMatch shows artists which venues actually have a night free, and gives venues one place to take enquiries. No Facebook groups, no cold DMs, no chasing.
              </Text>

              {/* CTAs */}
              <View style={s.heroCtaRow}>
                <TouchableOpacity
                  style={s.ctaFilled}
                  onPress={() => router.push('/login?mode=signup&tab=artist' as any)}
                >
                  <Text style={s.ctaFilledText}>Sign up as an artist</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.ctaOutline, { borderColor: colors.black }]}
                  onPress={() => router.push('/login?mode=signup&tab=venue' as any)}
                >
                  <Text style={[s.ctaOutlineText, { color: colors.black }]}>List your venue</Text>
                </TouchableOpacity>
              </View>

              {/* Stats */}
              <View style={[s.statsDivider, { backgroundColor: colors.border }]} />
              <View style={s.statsRow}>
                <View style={s.statItem}>
                  <Text style={[s.statNum, { color: colors.black }]}>
                    {venueCount > 0 ? venueCount : '\u2014'}
                  </Text>
                  <Text style={[s.statLabel, { color: colors.grey }]}>VENUES LISTED</Text>
                </View>
                <View style={s.statItem}>
                  <Text style={[s.statNum, { color: Colors.orange }]}>
                    {openSlotsCount6wk > 0 ? openSlotsCount6wk : '\u2014'}
                  </Text>
                  <Text style={[s.statLabel, { color: colors.grey }]}>OPEN SLOTS · 6 WKS</Text>
                </View>
                <View style={s.statItem}>
                  <Text style={[s.statNum, { color: colors.black }]}>~3 hrs</Text>
                  <Text style={[s.statLabel, { color: colors.grey }]}>MEDIAN REPLY</Text>
                </View>
              </View>

              {isAdmin && (
                <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)}>
                  <Text style={s.adminLink}>Admin Panel →</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Right: Open this fortnight panel */}
            {fortnightSlots.length > 0 && (
              <View style={[s.fortnightPanel, isWide && s.fortnightPanelWide]}>
                <View style={s.panelHeader}>
                  <Text style={s.panelHeaderLabel}>OPEN THIS FORTNIGHT</Text>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/venues')}>
                    <Text style={s.panelHeaderLink}>All venues →</Text>
                  </TouchableOpacity>
                </View>
                {fortnightSlots.slice(0, 3).map((item, i) => (
                  <FortnightSlotRow
                    key={`${item.date.toISOString()}-${i}`}
                    item={item}
                    colors={colors}
                    onEnquire={() => isLoggedIn
                      ? router.push(`/venue/${item.venue.id}` as any)
                      : router.push('/login?mode=signup&tab=artist' as any)
                    }
                  />
                ))}
                {fortnightSlots.length > 3 && (
                  <Text style={s.moreSlots}>
                    +{fortnightSlots.length - 3} more open slots before {endLabel}
                  </Text>
                )}
              </View>
            )}

          </View>
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
              <TouchableOpacity style={s.cardCtaDark} onPress={() => router.push('/login?mode=signup&tab=venue' as any)}>
                <Text style={s.cardCtaDarkText}>List Your Venue</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerLogo}>GigMatch</Text>
          <Text style={s.footerCopy}>&copy; {new Date().getFullYear()} GigMatch. All rights reserved.</Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: { borderBottomWidth: 1, paddingBottom: isWeb ? 56 : 40 },
  heroInner: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingTop: isWeb ? 56 : 40,
    gap: 32,
  },
  heroInnerWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
    gap: 48,
  },
  heroLeft:     { gap: 20 },
  heroLeftWide: { flex: 1, maxWidth: 480, paddingTop: 16 },

  liveBadge:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange },
  liveBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },

  headline: {
    fontSize: isWeb ? 54 : 34,
    fontWeight: '900',
    letterSpacing: isWeb ? -2 : -0.5,
    lineHeight: isWeb ? 58 : 38,
  },
  subhead: {
    fontSize: isWeb ? 16 : 15,
    lineHeight: isWeb ? 27 : 24,
    maxWidth: isWeb ? 400 : undefined,
  },

  heroCtaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    gap: 12,
    alignItems: 'center',
  },
  ctaFilled: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaFilledText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  ctaOutline: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 24,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOutlineText: { fontSize: 15, fontWeight: '700' },

  statsDivider: { height: 1, marginTop: 4 },
  statsRow:     { flexDirection: 'row', gap: 32 },
  statItem:     { gap: 4 },
  statNum: {
    fontSize: isWeb ? 28 : 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  adminLink: { fontSize: 13, fontWeight: '600', color: Colors.orange, marginTop: 4 },

  // ── Fortnight panel ───────────────────────────────────────────────
  fortnightPanel: {
    backgroundColor: '#f2ede4',
    borderRadius: 14,
    overflow: 'hidden',
  },
  fortnightPanelWide: {
    flex: 1,
    maxWidth: 440,
    alignSelf: 'flex-start',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  panelHeaderLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#888888',
  },
  panelHeaderLink: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  moreSlots: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
    color: '#888888',
    paddingVertical: 14,
  },

  // ── Problem section ───────────────────────────────────────────────
  problemSection: { borderBottomWidth: 1, paddingBottom: 64 },
  sectionHeader: {
    paddingHorizontal: isWeb ? 40 : 24,
    paddingTop: 64,
    paddingBottom: 40,
    maxWidth: isWeb ? 1200 : undefined,
    alignSelf: isWeb ? 'center' : undefined,
    width: '100%',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
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
  problemGridWeb: { flexDirection: 'row' },
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
  problemIndexText: { fontSize: 12, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },
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
  audienceGridWeb:  { flexDirection: 'row' },
  audienceCard: {
    flex: isWeb ? 1 : undefined,
    borderRadius: 16,
    borderWidth: 1,
    padding: isWeb ? 44 : 32,
    gap: 16,
  },
  audienceCardDark:    { backgroundColor: '#1e1a14', borderColor: 'transparent' },
  audienceTagDark: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  audienceHeadingDark: {
    fontSize: isWeb ? 30 : 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    lineHeight: isWeb ? 36 : 28,
  },
  featureRow:      { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  featureArrow:    { fontSize: 14, fontWeight: '700', color: Colors.orange, marginTop: 1 },
  featureTextDark: { fontSize: 14, lineHeight: 22, flex: 1, color: 'rgba(255,255,255,0.55)' },
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
