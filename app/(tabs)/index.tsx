import { useEffect, useState, useMemo } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ScrollView,
  Platform, useWindowDimensions, Image,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { collection, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const ADMIN_EMAIL = 'beerwatchbusiness@gmail.com';
const isWeb = Platform.OS === 'web';

// ── Types ──────────────────────────────────────────────────────────

type Slot = { id?: string; time: string; status: string; room?: string; date?: string };
type VenueData = {
  id: string; name: string; suburb?: string; capacity?: number;
  genre?: string[]; genres?: string[];
  photoUrl?: string; photos?: string[];
  slots?: Record<string, Slot[]>;
  settings?: { listed?: boolean };
};
type MusicianData = {
  id: string; name?: string;
  artistType?: string | string[];
  location?: string; genre?: string[];
  photoUrl?: string;
  feeMin?: number; feeMax?: number;
  averageDraw?: number; gigsThisYear?: number;
  settings?: { listed?: boolean };
};
type OpenSlotItem = { venue: VenueData; date: Date; day: string; slot: Slot };

// ── Constants ──────────────────────────────────────────────────────

const DOW_TO_DAY: Record<number, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};
const SHORT_MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SHORT_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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
      for (const slot of daySlots.filter(
        s => !s.date && s.status === 'open' && !overrideTimes.has(s.time.toLowerCase().trim())
      )) {
        results.push({ venue, date: new Date(cur), day: dayName, slot });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

function getVenueSlotDots(venue: VenueData): boolean[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + 42);
  const dots: boolean[] = [];
  const cur = new Date(today);
  while (cur <= end && dots.length < 6) {
    const dayName = DOW_TO_DAY[cur.getDay()];
    const dateISO = cur.toISOString().slice(0, 10);
    const daySlots = venue.slots?.[dayName] ?? [];
    const recurSlots = daySlots.filter(s => !s.date);
    if (recurSlots.length > 0) {
      const overrides = new Set(
        daySlots
          .filter(s => s.date === dateISO && (s.status === 'booked' || s.status === 'pending'))
          .map(s => s.time.toLowerCase().trim())
      );
      dots.push(recurSlots.some(s => s.status === 'open' && !overrides.has(s.time.toLowerCase().trim())));
    }
    cur.setDate(cur.getDate() + 1);
  }
  while (dots.length < 6) dots.push(false);
  return dots.slice(0, 6);
}

function getNextOpenInfo(venue: VenueData): { label: string; count: number } | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + 84);
  const cur = new Date(today);
  let firstDate: Date | null = null;
  let count = 0;
  while (cur <= end) {
    const dayName = DOW_TO_DAY[cur.getDay()];
    const dateISO = cur.toISOString().slice(0, 10);
    const daySlots = venue.slots?.[dayName] ?? [];
    const overrides = new Set(
      daySlots
        .filter(s => s.date === dateISO && (s.status === 'booked' || s.status === 'pending'))
        .map(s => s.time.toLowerCase().trim())
    );
    const open = daySlots.filter(s => !s.date && s.status === 'open' && !overrides.has(s.time.toLowerCase().trim()));
    if (open.length > 0) {
      if (!firstDate) firstDate = new Date(cur);
      count += open.length;
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (!firstDate) return null;
  const label = `${SHORT_DAYS[firstDate.getDay()]} ${firstDate.getDate()} ${SHORT_MONTHS[firstDate.getMonth()]}`;
  return { label, count };
}

// ── FortnightSlotRow ───────────────────────────────────────────────

function FortnightSlotRow({
  item, onEnquire, colors,
}: { item: OpenSlotItem; onEnquire: () => void; colors: any }) {
  const { venue, date, day, slot } = item;
  const dayAbbr   = day.slice(0, 3).toUpperCase();
  const monthAbbr = SHORT_MONTHS[date.getMonth()].toUpperCase();
  const meta      = [slot.time, slot.room].filter(Boolean).join(' · ');
  const venueLine = [venue.name, venue.suburb, venue.capacity ? `${venue.capacity} cap` : null]
    .filter(Boolean).join(' · ');

  return (
    <View style={[fsr.row, { borderTopColor: '#e2dbd0' }]}>
      <View style={fsr.dateBracket}>
        <Text style={fsr.dateNum}>{date.getDate()}</Text>
        <Text style={fsr.dateSub}>{dayAbbr} {monthAbbr}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={fsr.meta} numberOfLines={1}>{meta}</Text>
        <Text style={fsr.venueLine} numberOfLines={1}>{venueLine}</Text>
      </View>
      <TouchableOpacity style={fsr.enquireBtn} onPress={onEnquire}>
        <Text style={fsr.enquireBtnText}>Enquire</Text>
      </TouchableOpacity>
    </View>
  );
}

const fsr = StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12, borderTopWidth: 1 },
  dateBracket: { width: 54, borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 10, flexShrink: 0 },
  dateNum:     { fontSize: 22, fontWeight: '800', lineHeight: 24, color: '#111111' },
  dateSub:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, marginTop: 1, color: '#888888' },
  meta:        { fontSize: 14, fontWeight: '700', lineHeight: 18, color: '#111111' },
  venueLine:   { fontSize: 12, fontWeight: '400', marginTop: 2, color: '#888888' },
  enquireBtn:  { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  enquireBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
});

// ── VenueCard (For Artists grid) ───────────────────────────────────

function VenueCard({ venue, onPress }: { venue: VenueData; onPress: () => void }) {
  const photo  = venue.photoUrl ?? venue.photos?.[0];
  const genres = (venue.genre ?? venue.genres ?? []).slice(0, 4).join(' · ');
  const dots   = getVenueSlotDots(venue);
  const info   = getNextOpenInfo(venue);

  return (
    <TouchableOpacity style={vc.card} onPress={onPress} activeOpacity={0.85}>
      {/* Photo */}
      {photo ? (
        <Image source={{ uri: photo }} style={vc.photo} resizeMode="cover" />
      ) : (
        <View style={vc.photoPlaceholder}>
          <Text style={vc.photoPlaceholderText}>venue photo</Text>
        </View>
      )}
      {/* Body */}
      <View style={vc.body}>
        <View style={vc.nameRow}>
          <Text style={vc.name} numberOfLines={1}>{venue.name}</Text>
          {venue.capacity ? <Text style={vc.cap}>{venue.capacity} cap</Text> : null}
        </View>
        {genres ? <Text style={vc.genres} numberOfLines={1}>{[venue.suburb, genres].filter(Boolean).join(' · ')}</Text> : null}
        {/* Slot dots */}
        <View style={vc.dotsRow}>
          {dots.map((open, i) => (
            <View key={i} style={[vc.dot, open && vc.dotOpen]} />
          ))}
        </View>
        {info ? (
          <Text style={vc.nextOpen}>{info.count} open · next {info.label}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const vc = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8e3d9',
    overflow: 'hidden',
  },
  photo:              { width: '100%', height: 140 },
  photoPlaceholder: {
    width: '100%', height: 140,
    backgroundColor: '#ede8df',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 12, color: '#b0a898', fontWeight: '500' },
  body:    { padding: 14, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  name:    { fontSize: 15, fontWeight: '700', color: '#111111', flex: 1 },
  cap:     { fontSize: 12, fontWeight: '400', color: '#888888', flexShrink: 0 },
  genres:  { fontSize: 12, fontWeight: '400', color: '#888888' },
  dotsRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  dot: {
    width: 20, height: 8,
    borderRadius: 4,
    backgroundColor: '#e0dbd2',
  },
  dotOpen: { backgroundColor: Colors.orange },
  nextOpen: { fontSize: 12, fontWeight: '600', color: Colors.orange, marginTop: 2 },
});

// ── ArtistCard (For Venues section) ───────────────────────────────

function ArtistCard({ musician }: { musician: MusicianData }) {
  const photo   = musician.photoUrl;
  const actType = Array.isArray(musician.artistType) ? musician.artistType[0] : musician.artistType;
  const genres  = (musician.genre ?? []).slice(0, 3).join(' · ');
  const feeLabel = musician.feeMin != null
    ? musician.feeMax != null
      ? `$${musician.feeMin}-${musician.feeMax}`
      : `$${musician.feeMin}+`
    : null;
  const year          = new Date().getFullYear();
  const gigsThisYear  = musician.gigsThisYear ?? 0;
  const averageDraw   = musician.averageDraw ?? null;

  return (
    <View style={ac.card}>
      {photo ? (
        <Image source={{ uri: photo }} style={ac.photo} resizeMode="cover" />
      ) : (
        <View style={ac.photoPlaceholder}>
          <Text style={ac.photoPlaceholderText}>artist photo</Text>
        </View>
      )}
      <View style={ac.body}>
        <View style={ac.nameRow}>
          <Text style={ac.name} numberOfLines={1}>{musician.name}</Text>
          {actType ? (
            <View style={ac.badge}>
              <Text style={ac.badgeText}>{actType.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        {(musician.location || genres) ? (
          <Text style={ac.sub} numberOfLines={1}>
            {[musician.location, genres].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <View style={ac.divider} />
        <View style={ac.statsRow}>
          {averageDraw != null && (
            <View style={ac.stat}>
              <Text style={ac.statNum}>{averageDraw}</Text>
              <Text style={ac.statLabel}>DRAW</Text>
            </View>
          )}
          {feeLabel ? (
            <View style={ac.stat}>
              <Text style={ac.statNum}>{feeLabel}</Text>
              <Text style={ac.statLabel}>FEE</Text>
            </View>
          ) : null}
          {gigsThisYear > 0 && (
            <View style={ac.stat}>
              <Text style={ac.statNum}>{gigsThisYear}</Text>
              <Text style={ac.statLabel}>GIGS {year}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const ac = StyleSheet.create({
  card:               { backgroundColor: '#ffffff', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#e0dbd2' },
  photo:              { width: '100%', height: 130 },
  photoPlaceholder:   { width: '100%', height: 130, backgroundColor: '#ede8df', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { fontSize: 12, color: '#b0a898', fontWeight: '500' },
  body:    { padding: 14, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name:    { fontSize: 15, fontWeight: '700', color: '#111111', flex: 1 },
  badge:   { borderWidth: 1, borderColor: '#d0cbc2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5 },
  sub:     { fontSize: 12, color: '#888888' },
  divider: { height: 1, backgroundColor: '#e8e3d9', marginVertical: 4 },
  statsRow:{ flexDirection: 'row', gap: 20 },
  stat:    { gap: 2 },
  statNum: { fontSize: 16, fontWeight: '800', color: '#111111' },
  statLabel: { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.8, textTransform: 'uppercase' },
});

// ── HomeScreen ─────────────────────────────────────────────────────

const HOW_IT_WORKS_STEPS = [
  {
    num: '01',
    heading: 'Venues publish a timetable',
    body: 'Recurring band nights, room by room. Set once, and every free slot is public.',
  },
  {
    num: '02',
    heading: 'Artists enquire on a real date',
    body: 'Pick an open night and with the click of a button send a structured enquiry pre-built from your profile, including your draw, music, rider, past gigs and more attached.',
  },
  {
    num: '03',
    heading: 'One tap to confirm',
    body: "Accept, discuss or decline and both sides get it in the same thread. Nothing gets lost: every gig has a details section holding all the important info. Everything lives in one place, not scattered across the internet.",
  },
];

export default function HomeScreen() {
  const router     = useRouter();
  const { user }   = useAuth();
  const { colors } = useTheme();
  const { width }  = useWindowDimensions();
  const isWide     = isWeb && width >= 960;

  const isAdmin    = user?.email === ADMIN_EMAIL;
  const isLoggedIn = !!user;

  const [venues,        setVenues]        = useState<VenueData[]>([]);
  const [musicians,     setMusicians]     = useState<MusicianData[]>([]);
  const [musicianCount, setMusicianCount] = useState<number>(0);
  const [heroImageUrl,  setHeroImageUrl]  = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'homepage'), snap => {
      setHeroImageUrl(snap.data()?.heroImageUrl ?? null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'venues')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as VenueData[];
      setVenues(all.filter(v => v.settings?.listed !== false));
    }).catch(console.error);

    getDocs(collection(db, 'bandProfiles')).then(snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() })) as MusicianData[];
      setMusicianCount(all.filter(m => m.settings?.listed !== false && m.name).length);
      const featured = all.filter(m =>
        m.name?.toLowerCase().includes('dahlias') ||
        m.name?.toLowerCase().includes('valenta')
      );
      setMusicians(
        featured.length > 0
          ? featured.slice(0, 2)
          : all.filter(m => m.settings?.listed !== false && m.name).slice(0, 2)
      );
    }).catch(console.error);
  }, []);

  const { fortnightSlots, bandNightsTotal } = useMemo(() => {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    let nightsTotal = 0;
    for (const venue of venues) {
      for (const day of days) {
        nightsTotal += (venue.slots?.[day] ?? []).filter(s => !s.date && s.status === 'open').length;
      }
    }
    return {
      fortnightSlots:  computeOpenSlots(venues, 14),
      bandNightsTotal: nightsTotal,
    };
  }, [venues]);

  const venuesWithSlots = useMemo(
    () => venues.filter(v => getNextOpenInfo(v) !== null).slice(0, 4),
    [venues]
  );

  const venueCount = venues.length;
  const endDate    = new Date(); endDate.setDate(endDate.getDate() + 14);
  const endLabel   = `${endDate.getDate()} ${SHORT_MONTHS[endDate.getMonth()]}`;

  // Venue grid: 4 cols wide, 2 cols mid, 1 col narrow
  const numCols   = isWide ? 4 : (isWeb && width >= 600) ? 2 : 1;
  const gridGap   = 16;
  const padH      = isWeb ? 80 : 48;
  const cardWidth = (width - padH - gridGap * (numCols - 1)) / numCols;

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <View style={[s.hero, { borderBottomColor: colors.border }]}>
          {heroImageUrl && (
            <Image source={{ uri: heroImageUrl }} style={s.heroBgImage} resizeMode="cover" />
          )}
          {heroImageUrl && <View style={s.heroBgOverlay} />}
          <View style={[s.heroInner, isWide && s.heroInnerWide]}>

            {/* Left */}
            <View style={[s.heroLeft, isWide && s.heroLeftWide]}>
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={[s.liveBadgeText, { color: colors.grey }]}>LIVE IN MELBOURNE</Text>
              </View>
              <Text style={[s.headline, { color: colors.black }]}>
                {`Connect. Enquire. Book.\nAll in one place.`}
              </Text>
              <Text style={[s.subhead, { color: colors.grey }]}>
                {`Browse venues with real-time available gig slots. Send a structured enquiry built straight from your profile, and start messaging your way to a confirmed gig, in minutes.\n\nNo Facebook groups, no cold DMs, no chasing replies across five different apps, and no getting lost in endless email chains.`}
              </Text>
              <View style={s.heroCtaRow}>
                <TouchableOpacity style={s.ctaFilled} onPress={() => router.push('/login?mode=signup&tab=artist' as any)}>
                  <Text style={s.ctaFilledText}>Sign up as an artist</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.ctaOutline, { borderColor: colors.black }]} onPress={() => router.push('/login?mode=signup&tab=venue' as any)}>
                  <Text style={[s.ctaOutlineText, { color: colors.black }]}>Claim your venue</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.desktopHint}>For best experience use on desktop</Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)}>
                  <Text style={s.adminLink}>Admin Panel →</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Right: fortnight panel */}
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
                  <Text style={s.moreSlots}>+{fortnightSlots.length - 3} more open slots before {endLabel}</Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* ── How It Works ──────────────────────────────────────── */}
        <View style={s.hiwSection}>
          <View style={[s.sectionInner, isWide && s.sectionInnerWide]}>
            <Text style={s.hiwEyebrow}>HOW IT WORKS</Text>
            <Text style={s.hiwHeading}>Three steps, and it's in writing.</Text>
            <View style={[s.hiwGrid, isWide && s.hiwGridWide]}>
              {HOW_IT_WORKS_STEPS.map((step, i) => (
                <View
                  key={step.num}
                  style={[
                    s.hiwStep,
                    { borderTopColor: Colors.orange },
                    isWide && { flex: 1 },
                  ]}
                >
                  <Text style={s.hiwNum}>{step.num}</Text>
                  <Text style={s.hiwStepHeading}>{step.heading}</Text>
                  <Text style={s.hiwStepBody}>{step.body}</Text>
                </View>
              ))}
            </View>
            <Text style={s.hiwReplaces}>
              Replaces: Facebook groups, cold email, Instagram DMs, phone tag, and a spreadsheet someone forgot to update.
            </Text>
          </View>
        </View>

        {/* ── Enquiry Preview ───────────────────────────────────── */}
        {isWeb && (
          <View style={[s.enquiryPreviewSection, { backgroundColor: colors.bgFaint, borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <View style={[s.sectionInner, isWide && s.sectionInnerWide, isWide && { flexDirection: 'row', alignItems: 'flex-start', gap: 64 }]}>
              {/* Left: copy */}
              <View style={isWide ? { flex: 1, paddingTop: 8 } : { marginBottom: 32 }}>
                <Text style={s.sectionEyebrow}>THE ENQUIRY</Text>
                <Text style={[s.forArtistsHeading, { color: colors.black, marginBottom: 16 }]}>
                  One tap. Full profile attached.
                </Text>
                <Text style={[s.forVenuesSub, { marginBottom: 16 }]}>
                  When an artist hits Enquire, the venue gets everything they need to make a decision: bio, draw, past gigs, music, tech rider, and socials. No back-and-forth. No chasing for an EPK.
                </Text>
                <Text style={[s.forVenuesSub]}>
                  The artist chooses what to include. The venue gets it in their inbox, structured and ready to read.
                </Text>
              </View>
              {/* Right: static form preview */}
              <View style={[s.enquiryCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                {/* Header */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={s.enqEyebrow}>ENQUIRY</Text>
                  <Text style={[s.enqVenueName, { color: colors.black }]}>The Tote Hotel</Text>
                  <Text style={[s.enqMeta, { color: colors.grey }]}>Friday · 7:00 PM · Band Room</Text>
                </View>
                {/* Artist pill */}
                <View style={[s.enqArtistPill, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                  <View style={s.enqArtistAvatar} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.enqArtistName, { color: colors.black }]}>The Dahlias</Text>
                      <View style={[s.enqBadge, { borderColor: colors.border }]}>
                        <Text style={[s.enqBadgeText, { color: colors.grey }]}>BAND</Text>
                      </View>
                    </View>
                    <Text style={[s.enqArtistMeta, { color: colors.grey }]}>Indie · Rock · Mount Eliza, VIC</Text>
                  </View>
                </View>
                {/* Set details */}
                <View style={[s.enqSection, { borderTopColor: colors.border }]}>
                  <Text style={s.enqSectionLabel}>SET DETAILS</Text>
                  <View style={{ flexDirection: 'row', gap: 24 }}>
                    <View>
                      <Text style={[s.enqDetailKey, { color: colors.black }]}>Duration</Text>
                      <Text style={[s.enqDetailVal, { color: colors.grey }]}>45 min</Text>
                    </View>
                    <View>
                      <Text style={[s.enqDetailKey, { color: colors.black }]}>Slot Type</Text>
                      <Text style={[s.enqDetailVal, { color: colors.grey }]}>Headline</Text>
                    </View>
                  </View>
                </View>
                {/* What you're sending */}
                <View style={[s.enqSection, { borderTopColor: colors.border }]}>
                  <Text style={s.enqSectionLabel}>WHAT YOU'RE SENDING</Text>
                  <View style={s.enqCheckGrid}>
                    {['About', 'Music', 'Gig history', 'Upcoming gigs', 'Socials', 'Tech rider'].map(item => (
                      <View key={item} style={[s.enqCheckItem, { borderColor: Colors.orange, backgroundColor: 'rgba(250,131,12,0.07)' }]}>
                        <View style={s.enqCheckbox}>
                          <Text style={s.enqCheckmark}>✓</Text>
                        </View>
                        <Text style={[s.enqCheckLabel, { color: colors.black }]}>{item}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[s.enqCount, { color: colors.grey }]}>6 of 6 profile sections included</Text>
                </View>
                {/* Fade + CTA */}
                <View style={s.enqFadeOverlay} pointerEvents="none" />
                <TouchableOpacity style={s.enqSendBtn} onPress={() => router.push('/login?mode=signup&tab=artist' as any)}>
                  <Text style={s.enqSendBtnText}>Sign up to send an enquiry</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── For Artists ───────────────────────────────────────── */}
        <View style={[s.forArtistsSection, { backgroundColor: colors.bg }]}>
          <View style={[s.sectionInner, isWide && s.sectionInnerWide]}>
            {/* Header row */}
            <View style={s.forArtistsHeader}>
              <View>
                <Text style={s.sectionEyebrow}>FOR ARTISTS</Text>
                <Text style={[s.forArtistsHeading, { color: colors.black }]}>Rooms with a night free.</Text>
              </View>
              <TouchableOpacity style={[s.browseBtn, { borderColor: colors.border }]} onPress={() => router.push('/(tabs)/venues')}>
                <Text style={[s.browseBtnText, { color: colors.black }]}>Browse all {venueCount > 0 ? venueCount : ''} venues →</Text>
              </TouchableOpacity>
            </View>
            {/* Venue grid */}
            <View style={[s.venueGrid, isWide && s.venueGridWide]}>
              {(venuesWithSlots.length > 0 ? venuesWithSlots : venues.slice(0, 4)).map(venue => (
                <View key={venue.id} style={{ width: isWeb ? cardWidth : '100%' }}>
                  <VenueCard
                    venue={venue}
                    onPress={() => router.push(`/venue/${venue.id}` as any)}
                  />
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── For Venues ────────────────────────────────────────── */}
        <View style={s.forVenuesSection}>
          <View style={[s.sectionInner, isWide && s.sectionInnerWide]}>
            {/* Header row */}
            <View style={s.forVenuesHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionEyebrow}>FOR VENUES</Text>
                <Text style={s.forVenuesHeading}>Acts you can actually judge.</Text>
                <Text style={s.forVenuesSub}>
                  Every enquiry arrives with draw, fee range, past gigs, socials and a tech rider attached, so you can say yes or no in one pass.
                </Text>
              </View>
              <TouchableOpacity style={s.browseMusicianBtn} onPress={() => router.push('/(tabs)/musicians')}>
                <Text style={s.browseMusicianText}>Browse musicians →</Text>
              </TouchableOpacity>
            </View>
            {/* Cards grid */}
            <View style={[s.forVenuesGrid, isWide && s.forVenuesGridWide]}>
              {musicians.map(m => (
                <View key={m.id} style={[s.forVenuesCardWrap, isWide && { flex: 1 }]}>
                  <ArtistCard musician={m} />
                </View>
              ))}
              {/* Dark CTA card */}
              <View style={[s.forVenuesCta, isWide && { flex: 1 }]}>
                <Text style={s.forVenuesCtaHeading}>Publish your timetable once.</Text>
                <Text style={s.forVenuesCtaBody}>
                  Set your band nights, and enquiries come to you with everything attached. Free while we're in beta.
                </Text>
                <TouchableOpacity style={s.forVenuesCtaBtn} onPress={() => router.push('/login?mode=signup&tab=venue' as any)}>
                  <Text style={s.forVenuesCtaBtnText}>Claim your venue</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* ── Pick a Side ───────────────────────────────────────── */}
        <View style={[s.pickASideSection, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
          <Text style={[s.pickASideEyebrow, { color: colors.grey }]}>MELBOURNE FIRST · MORE CITIES SOON</Text>
          <Text style={[s.pickASideHeading, { color: colors.black }]}>Pick a side and get started.</Text>
          <View style={s.pickASideBtns}>
            <TouchableOpacity style={s.ctaFilled} onPress={() => router.push('/login?mode=signup&tab=artist' as any)}>
              <Text style={s.ctaFilledText}>I'm an artist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ctaOutline, { borderColor: colors.black }]} onPress={() => router.push('/login?mode=signup&tab=venue' as any)}>
              <Text style={[s.ctaOutlineText, { color: colors.black }]}>I run a venue</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <View style={[s.footer, { borderTopColor: colors.border }]}>
          <View style={s.footerLeft}>
            <Text style={[s.footerLogo, { color: colors.black }]}>Twaylo</Text>
            <Text style={[s.footerMeta, { color: colors.grey }]}>BETA · MELBOURNE</Text>
          </View>
          <View style={s.footerNav}>
            {(['Venues', 'Musicians', 'Discover', 'Contact'] as const).map(label => (
              <TouchableOpacity
                key={label}
                onPress={() => {
                  if (label === 'Venues')    router.push('/(tabs)/venues');
                  else if (label === 'Musicians') router.push('/(tabs)/musicians');
                  else if (label === 'Discover') router.push('/(tabs)/discover');
                }}
              >
                <Text style={[s.footerNavLink, { color: colors.grey }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Shared
  sectionInner: {
    paddingHorizontal: isWeb ? 40 : 24,
    width: '100%',
  },
  sectionInnerWide: {
    maxWidth: 1200,
    alignSelf: 'center',
  },
  sectionEyebrow: {
    fontSize: 11, fontWeight: '700', color: Colors.orange,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10,
  },

  // ── Hero ──────────────────────────────────────────────────────────
  hero:         { borderBottomWidth: 1, paddingBottom: isWeb ? 56 : 40, overflow: 'hidden' },
  heroBgImage:  { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroBgOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.85)' },
  heroInner:    { paddingHorizontal: isWeb ? 40 : 24, paddingTop: isWeb ? 56 : 40, gap: 32 },
  heroInnerWide:{ flexDirection: 'row', alignItems: 'flex-start', maxWidth: 1200, alignSelf: 'center', width: '100%', gap: 48 },
  heroLeft:     { gap: 20 },
  heroLeftWide: { flex: 1, maxWidth: 560, paddingTop: 16 },
  liveBadge:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange },
  liveBadgeText:{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  headline:     { fontSize: isWeb ? 46 : 28, fontWeight: '900', letterSpacing: isWeb ? -1.5 : -0.5, lineHeight: isWeb ? 52 : 34 },
  subhead:      { fontSize: isWeb ? 16 : 15, lineHeight: isWeb ? 27 : 24, maxWidth: isWeb ? 480 : undefined },
  heroCtaRow:   { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, alignItems: 'center' },
  ctaFilled:    { backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ctaFilledText:{ fontSize: 15, fontWeight: '700', color: '#ffffff' },
  ctaOutline:   { borderWidth: 1.5, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ctaOutlineText: { fontSize: 15, fontWeight: '700' },
  statsDivider: { height: 1, marginTop: 4 },
  statsRow:     { flexDirection: 'row', gap: 32 },
  statItem:     { gap: 4 },
  statNum:      { fontSize: isWeb ? 28 : 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel:    { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  adminLink:    { fontSize: 13, fontWeight: '600', color: Colors.orange, marginTop: 4 },
  desktopHint:  { fontSize: 12, color: '#666666', marginTop: 3, fontStyle: 'italic' },

  // Fortnight panel
  fortnightPanel:      { backgroundColor: '#f2ede4', borderRadius: 14, overflow: 'hidden' },
  fortnightPanelWide:  { flex: 1, maxWidth: 440, alignSelf: 'flex-start' },
  panelHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  panelHeaderLabel:    { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: '#888888' },
  panelHeaderLink:     { fontSize: 13, fontWeight: '600', color: Colors.orange },
  moreSlots:           { textAlign: 'center', fontSize: 12, fontWeight: '400', color: '#888888', paddingVertical: 14 },

  // ── How It Works ──────────────────────────────────────────────────
  hiwSection:     { backgroundColor: '#111111', paddingVertical: isWeb ? 72 : 56 },
  hiwEyebrow:     { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  hiwHeading:     { fontSize: isWeb ? 40 : 28, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5, lineHeight: isWeb ? 44 : 34, marginBottom: 40 },
  hiwDivider:     { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 40 },
  hiwGrid:        { gap: 32 },
  hiwGridWide:    { flexDirection: 'row', gap: 0 },
  hiwStep:        { borderTopWidth: 2, paddingTop: 20, gap: 12 },
  hiwStepBorder:  { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.1)', paddingRight: 40, marginRight: 40 },
  hiwNum:         { fontSize: 12, fontWeight: '700', color: Colors.orange, letterSpacing: 0.5 },
  hiwStepHeading: { fontSize: isWeb ? 18 : 16, fontWeight: '800', color: '#ffffff', letterSpacing: -0.2, lineHeight: isWeb ? 24 : 22 },
  hiwStepBody:    { fontSize: 14, lineHeight: 22, color: 'rgba(255,255,255,0.5)' },
  hiwReplaces:    { fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.35)', marginTop: 48 },

  // ── For Artists ───────────────────────────────────────────────────
  forArtistsSection: { paddingVertical: isWeb ? 72 : 48 },
  forArtistsHeader:  {
    flexDirection: isWeb ? 'row' : 'column',
    alignItems: isWeb ? 'flex-end' : 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 32,
  },
  forArtistsHeading: { fontSize: isWeb ? 40 : 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: isWeb ? 44 : 34 },
  browseBtn:         { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center', flexShrink: 0 },
  browseBtnText:     { fontSize: 14, fontWeight: '600' },
  venueGrid:         { gap: 16 },
  venueGridWide:     { flexDirection: 'row', flexWrap: 'wrap' as const },

  // ── For Venues ────────────────────────────────────────────────────
  forVenuesSection:   { backgroundColor: '#ede8df', paddingVertical: isWeb ? 72 : 48 },
  forVenuesHeader:    { flexDirection: isWeb ? 'row' : 'column', alignItems: isWeb ? 'flex-start' : 'flex-start', gap: 16, marginBottom: 32 },
  forVenuesHeading:   { fontSize: isWeb ? 40 : 28, fontWeight: '800', color: '#111111', letterSpacing: -0.5, lineHeight: isWeb ? 44 : 34, marginBottom: 8 },
  forVenuesSub:       { fontSize: 15, lineHeight: 24, color: '#5b5548', maxWidth: isWeb ? 460 : undefined },
  browseMusicianBtn:  { borderWidth: 1, borderColor: '#c0b9ae', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-start' },
  browseMusicianText: { fontSize: 14, fontWeight: '600', color: '#111111' },
  forVenuesGrid:      { gap: 16 },
  forVenuesGridWide:  { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  forVenuesCardWrap:  {},
  forVenuesCta:       {
    backgroundColor: '#1a1614',
    borderRadius: 14,
    padding: 24,
    gap: 14,
    justifyContent: 'center',
  },
  forVenuesCtaHeading: { fontSize: 20, fontWeight: '800', color: '#ffffff', letterSpacing: -0.3, lineHeight: 26 },
  forVenuesCtaBody:    { fontSize: 14, lineHeight: 22, color: 'rgba(255,255,255,0.55)' },
  forVenuesCtaBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', minHeight: 44, marginTop: 4 },
  forVenuesCtaBtnText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },

  // ── Pick a Side ───────────────────────────────────────────────────
  pickASideSection: { paddingVertical: isWeb ? 80 : 56, alignItems: 'center', borderTopWidth: 1 },
  pickASideEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 },
  pickASideHeading: { fontSize: isWeb ? 48 : 30, fontWeight: '900', letterSpacing: isWeb ? -1.5 : -0.5, lineHeight: isWeb ? 52 : 36, textAlign: 'center', marginBottom: 32, maxWidth: isWeb ? 640 : 300 },
  pickASideBtns:    { flexDirection: 'row', gap: 12, flexWrap: 'wrap' as const, justifyContent: 'center' },

  // ── Footer ────────────────────────────────────────────────────────
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: isWeb ? 40 : 24,
    paddingVertical: 32,
    flexDirection: isWeb ? 'row' : 'column',
    alignItems: isWeb ? 'center' : 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  footerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerLogo:    { fontSize: 17, fontWeight: '800', letterSpacing: -0.5 },
  footerMeta:    { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  footerNav:     { flexDirection: 'row', gap: 24, flexWrap: 'wrap' as const },
  footerNavLink: { fontSize: 14, fontWeight: '500' },

  // ── Enquiry preview ────────────────────────────────────────────
  enquiryPreviewSection: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 64 },
  enquiryCard: {
    borderWidth: 1, borderRadius: 16, overflow: 'hidden',
    width: isWeb ? 360 : '100%', flexShrink: 0,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 0,
  },
  enqEyebrow:       { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 4 },
  enqVenueName:     { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, marginBottom: 2 },
  enqMeta:          { fontSize: 13 },
  enqArtistPill:    { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 0 },
  enqArtistAvatar:  { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.greyLight },
  enqArtistName:    { fontSize: 15, fontWeight: '700' },
  enqBadge:         { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  enqBadgeText:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  enqArtistMeta:    { fontSize: 12, marginTop: 2 },
  enqSection:       { borderTopWidth: 1, marginTop: 14, paddingTop: 14 },
  enqSectionLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' as const, color: Colors.grey, marginBottom: 10 },
  enqDetailKey:     { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  enqDetailVal:     { fontSize: 13 },
  enqCheckGrid:     { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  enqCheckItem:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, width: '47%' as any },
  enqCheckbox:      { width: 20, height: 20, borderRadius: 4, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  enqCheckmark:     { fontSize: 12, fontWeight: '700', color: '#fff' },
  enqCheckLabel:    { fontSize: 13, fontWeight: '600', flex: 1 },
  enqCount:         { fontSize: 12, marginTop: 10, textAlign: 'center' as const },
  enqFadeOverlay:   { height: 48, marginTop: 12, marginHorizontal: -20 },
  enqSendBtn:       { backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginHorizontal: -20, marginBottom: 0 },
  enqSendBtnText:   { fontSize: 15, fontWeight: '700', color: '#111' },
});
