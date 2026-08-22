import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Platform, Linking,
} from 'react-native';
import { Text } from '@/components/Text';
import WebView from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useArtistEnquiries, type Enquiry } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';

// ── Types ────────────────────────────────────────────────────────────

type Slot = {
  id: string;
  time: string;
  date?: string | null;
  status: 'open' | 'booked' | 'pending';
  bandName?: string;
  room?: string;
  slotType?: string;
  feeMin?: number | null;
  feeMax?: number | null;
  genres?: string[];
  duration?: number;
  notes?: string;
  ticketUrl?: string;
  featured?: boolean;
};

type Room = {
  name?: string;
  capacity?: number | string;
  stage?: string;
  lighting?: string;
  pa?: string;
};

type TechSpecs = {
  pa?: string;
  monitoring?: string;
  backline?: string;
  lighting?: string;
  loadIn?: string;
  soundcheck?: string;
  parking?: string;
  greenRoom?: boolean;
  greenRoomDetails?: string;
  notes?: string;
  riderUrl?: string;
};

type GigNight = {
  day?: string;
  startTime?: string;
  duration?: number;
  genres?: string[];
  notes?: string;
};

type Venue = {
  id: string;
  name: string;
  suburb?: string;
  state?: string;
  streetAddress?: string;
  postcode?: string;
  description?: string;
  genre?: string[];
  genres?: string[];
  genrePreferences?: string[];
  photoUrl?: string;
  photoPosition?: { x: number; y: number };
  photos?: string[];
  videos?: string[];
  capacity?: number;
  feeMin?: number;
  feeMax?: number;
  website?: string;
  email?: string;
  phone?: string;
  bookingContact?: { name?: string; email?: string; phone?: string };
  slots?: Record<string, Slot[]>;
  rooms?: Room[];
  techSpecs?: TechSpecs;
  gigNights?: GigNight[];
  nightPreferences?: GigNight[];
};

// ── Constants ────────────────────────────────────────────────────────

const CANONICAL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_WEEK_OFFSET: Record<string, number> = {
  Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5, Sunday:6,
};
const DOW_TO_DAY: Record<number, string> = {
  0:'Sunday', 1:'Monday', 2:'Tuesday', 3:'Wednesday', 4:'Thursday', 5:'Friday', 6:'Saturday',
};
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MONTHS  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_HEADERS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MAX_DESC = 280;
const isWeb = Platform.OS === 'web';
// ── Positioned banner image (respects saved focal point) ─────────────
function PositionedBanner({ uri, position, height }: { uri: string; position?: { x: number; y: number }; height: number }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };

  useEffect(() => {
    if (uri) Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {});
  }, [uri]);

  const coverScale = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, height / dims.nh) : 1.6;
  const displayW   = dims.nw ? dims.nw * coverScale : w * 1.6;
  const displayH   = dims.nh ? dims.nh * coverScale : height * 1.6;
  const maxTx      = Math.max(0, displayW - w);
  const maxTy      = Math.max(0, displayH - height);
  const tx         = -(pos.x / 100) * maxTx;
  const ty         = -(pos.y / 100) * maxTy;

  return (
    <View style={{ height, overflow: 'hidden' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Image
        source={{ uri }}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: displayW, height: displayH,
          transform: [{ translateX: tx }, { translateY: ty }],
        } as any}
        resizeMode="cover"
      />
    </View>
  );
}

// ── Date helpers ─────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fmtShort(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function isDatePast(date: Date): boolean {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  return d < today;
}

/** Returns ISO date string for the next upcoming occurrence of a named weekday (including today). */
function nextDateForDay(dayName: string): string {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayDow = (today.getDay() + 6) % 7; // Mon=0..Sun=6
  const targetDow = DAY_WEEK_OFFSET[dayName] ?? 0;
  let daysAhead = targetDow - todayDow;
  if (daysAhead < 0) daysAhead += 7;
  return isoDate(addDays(today, daysAhead));
}

// ── Slot merging ─────────────────────────────────────────────────────

function mergeSlots(recurringOpen: Slot[], overrides: Slot[]): Slot[] {
  const norm = (s: string) => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'').trim();
  const merged: Slot[] = [];
  recurringOpen.forEach(open => {
    const rep = overrides.find(b => {
      const timeMatch = norm(b.time) === norm(open.time);
      const roomMatch = (b.room && open.room) ? norm(b.room) === norm(open.room) : true;
      return timeMatch && roomMatch;
    });
    merged.push(rep ?? open);
  });
  overrides.forEach(b => { if (!merged.find(s => s.id === b.id)) merged.push(b); });
  const toMins = (t: string) => {
    if (!t) return 0;
    const [time, period] = t.split(' ');
    const [h, m] = time.split(':').map(Number);
    let hrs = h;
    if (period === 'PM' && h !== 12) hrs += 12;
    if (period === 'AM' && h === 12) hrs = 0;
    return hrs * 60 + m;
  };
  return merged.sort((a,b) => toMins(a.time) - toMins(b.time));
}

function getSlotsForDate(venue: Venue, day: string, dateISO: string): Slot[] {
  const all = venue.slots?.[day] || [];
  const recurOpen = all.filter(s => !s.date && s.status === 'open');
  const overrides = all.filter(s => s.date === dateISO && (s.status === 'booked' || s.status === 'pending'));
  return mergeSlots(recurOpen, overrides);
}

// ── Open slot count (current month) ──────────────────────────────────

function countOpenSlotsThisMonth(venue: Venue): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const weekdayCounts: Record<string, number> = {};
  const cur = new Date(start);
  while (cur <= end) {
    const d = DOW_TO_DAY[cur.getDay()];
    weekdayCounts[d] = (weekdayCounts[d] || 0) + 1;
    cur.setDate(cur.getDate()+1);
  }
  return Object.entries(weekdayCounts).reduce((acc, [day, occ]) => {
    const open = (venue.slots?.[day] || []).filter(s => !s.date && s.status === 'open').length;
    return acc + open * occ;
  }, 0);
}

// ── This week slots ───────────────────────────────────────────────────

function getThisWeekSlots(venue: Venue) {
  const weekStart = getMondayOfWeek(new Date());
  return CANONICAL_DAYS.map(day => {
    const date = addDays(weekStart, DAY_WEEK_OFFSET[day]);
    const slots = getSlotsForDate(venue, day, isoDate(date));
    return { day, date, slots };
  }).filter(d => d.slots.length > 0);
}

// ── Fee formatter ─────────────────────────────────────────────────────

function fmtFee(min?: number | null, max?: number | null) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (min != null) return `from $${min}`;
  if (max != null) return `up to $${max}`;
  return null;
}

// ── Main screen ───────────────────────────────────────────────────────

export default function VenueScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = _overrideId ?? String(paramId);
  const isProfileTab = !!_overrideId;
  const router = useRouter();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const isArtist = profile?.type === 'artist';
  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/venues');
  const { enquiries: userEnquiries } = useArtistEnquiries(isArtist ? (user?.uid ?? null) : null);

  const [venue, setVenue]     = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'timetable' | 'rooms' | 'photos'>(
    tabParam === 'timetable' ? 'timetable'
    : tabParam === 'rooms'   ? 'rooms'
    : tabParam === 'photos'  ? 'photos'
    : 'overview',
  );

  useEffect(() => {
    return onSnapshot(doc(db, 'venues', id), snap => {
      if (snap.exists()) setVenue({ id: snap.id, ...snap.data() } as Venue);
      setLoading(false);
    }, () => setLoading(false));
  }, [id]);

  const safeEdges = isProfileTab ? (['bottom'] as const) : undefined;

  if (loading) return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={safeEdges}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>
  );

  if (!venue) return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
      {!isProfileTab && (
        <TouchableOpacity style={{ padding: 20 }} onPress={handleBack}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
      )}
      <Text style={s.notFound}>Venue not found.</Text>
    </SafeAreaView>
  );

  const isMyVenue = profile?.type === 'venue' && profile?.venueId === id;
  const genres    = venue.genre || venue.genres || [];
  const address   = [venue.streetAddress, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(', ');
  const photo     = venue.photoUrl || (venue.photos && venue.photos[0]);
  const hasPhotos = (venue.photos || []).length > 0 || (venue.videos || []).length > 0 || isMyVenue;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
      <ScrollView stickyHeaderIndices={[1]}>

        {/* ── Banner ── */}
        <View>
          {photo
            ? <PositionedBanner uri={photo} position={venue.photoPosition} height={isWeb ? 220 : 240} />
            : <View style={s.bannerPlaceholder}><Text style={s.bannerPlaceholderText}>venue photo</Text></View>
          }
          {!isProfileTab && (
            <TouchableOpacity style={s.backOverlay} onPress={handleBack}>
              <Text style={s.backOverlayText}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Sticky header: name + tabs ── */}
        <View style={[s.stickyHeader, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <View style={s.headerInfo}>
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: colors.black }]}>{venue.name}</Text>
              {address ? <Text style={[s.address, { color: colors.grey }]}>{address}</Text> : null}
              {genres.length > 0 && (
                <View style={s.genreRow}>
                  {genres.map(g => (
                    <View key={g} style={s.genrePill}><Text style={s.genreText}>{g}</Text></View>
                  ))}
                </View>
              )}
            </View>
            {isMyVenue && (
              <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/edit-venue')}>
                <Text style={s.editProfileBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
            {([
              { id: 'overview',  label: 'Overview' },
              { id: 'timetable', label: 'Timetable' },
              { id: 'rooms',     label: 'Rooms, Tech Specs & Rider' },
              ...(hasPhotos ? [{ id: 'photos', label: 'Photos & Videos' }] : []),
            ] as const).map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={[s.tabBtn, activeTab === tab.id && s.tabBtnActive]}
                onPress={() => setActiveTab(tab.id as 'overview' | 'timetable' | 'rooms' | 'photos')}
              >
                <Text style={[s.tabText, { color: colors.grey }, activeTab === tab.id && s.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Tab content ── */}
        {activeTab === 'overview' && (
          <OverviewTab venue={venue} isArtist={isArtist} isLoggedIn={!!user} onGoTimetable={() => setActiveTab('timetable')} />
        )}
        {activeTab === 'timetable' && (
          <TimetableTab
            venue={venue}
            isArtist={isArtist}
            isLoggedIn={!!user}
            userEnquiries={userEnquiries}
            onEnquire={(slot, day, dateISO) => {
              if (!user) { router.push('/login'); return; }
              router.push({
                pathname: '/enquire',
                params: {
                  venueId:   venue.id,
                  venueName: venue.name,
                  day,
                  date:      dateISO || '',
                  time:      slot.time,
                  room:      slot.room || '',
                  slotType:  slot.slotType || 'Any',
                },
              });
            }}
          />
        )}
        {activeTab === 'rooms'   && <RoomsTab venue={venue} />}
        {activeTab === 'photos'  && <PhotosTab venue={venue} />}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({ venue, isArtist, isLoggedIn, onGoTimetable }: {
  venue: Venue; isArtist: boolean; isLoggedIn: boolean; onGoTimetable: () => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const desc = venue.description || '';
  const shouldTruncate = desc.length > MAX_DESC;
  const nights = venue.gigNights || venue.nightPreferences || [];
  const openSlots = countOpenSlotsThisMonth(venue);
  const thisWeek  = getThisWeekSlots(venue);
  const genres    = venue.genrePreferences || venue.genre || venue.genres || [];

  const StatCard = ({ num, label }: { num: string | number; label: string }) => (
    <View style={[s.statCard, { borderColor: colors.border }]}>
      <Text style={[s.statNum, { color: colors.black }]}>{num}</Text>
      <Text style={[s.statLabel, { color: colors.grey }]}>{label}</Text>
    </View>
  );

  const sidebar = (
    <View style={isWeb ? s.overviewSidebar : s.overviewSidebarMobile}>
      {(venue.capacity ?? 0) > 0 && <StatCard num={Number(venue.capacity).toLocaleString()} label="Capacity" />}
      {openSlots > 0 && <StatCard num={openSlots} label="Open slots this month" />}
      {thisWeek.length > 0 && (
        <View style={[s.thisWeekCard, { borderColor: colors.border }]}>
          <Text style={[s.thisWeekTitle, { color: colors.grey }]}>This week</Text>
          {thisWeek.map(({ day, date, slots }) => (
            <View key={day} style={s.thisWeekDay}>
              <Text style={[s.thisWeekDayLabel, { color: colors.black }]}>
                {day.slice(0,3)} {fmtShort(date)}
              </Text>
              {slots.map((slot, i) => (
                <View key={slot.id || i} style={s.thisWeekSlot}>
                  <Text style={[s.thisWeekSlotTime, { color: colors.black }]}>{slot.time}</Text>
                  <Text style={[
                    s.thisWeekSlotStatus,
                    slot.status === 'open' ? s.thisWeekOpen : s.thisWeekBooked,
                  ]}>
                    {slot.status === 'open' ? 'Open' : slot.bandName || 'Booked'}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const main = (
    <View style={isWeb ? s.overviewMain : null}>

      {/* Venue Info */}
      {(venue.phone || venue.email || venue.website) ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Venue Info</Text>
          <View style={[s.infoGrid, { borderTopColor: colors.border }]}>
            {venue.phone ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Phone</Text>
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${venue.phone}`)}>
                  <Text style={s.link}>{venue.phone}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {venue.email ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Email</Text>
                <TouchableOpacity onPress={() => Linking.openURL(`mailto:${venue.email}`)}>
                  <Text style={s.link}>{venue.email}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {venue.website ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Website</Text>
                <TouchableOpacity onPress={() => Linking.openURL(venue.website!)}>
                  <Text style={s.link}>{venue.website}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Description */}
      {desc ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>About</Text>
          <Text style={[s.body, { color: colors.black }]}>
            {shouldTruncate && !expanded ? desc.slice(0, MAX_DESC) + '…' : desc}
          </Text>
          {shouldTruncate && (
            <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ marginTop: 6 }}>
              <Text style={s.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {/* Booking Contact */}
      {venue.bookingContact && (venue.bookingContact.name || venue.bookingContact.email || venue.bookingContact.phone) ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Booking Contact</Text>
          <View style={[s.infoGrid, { borderTopColor: colors.border }]}>
            {venue.bookingContact.name ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Name</Text>
                <Text style={[s.infoValue, { color: colors.black }]}>{venue.bookingContact.name}</Text>
              </View>
            ) : null}
            {venue.bookingContact.email ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Email</Text>
                <TouchableOpacity onPress={() => Linking.openURL(`mailto:${venue.bookingContact!.email}`)}>
                  <Text style={s.link}>{venue.bookingContact.email}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {venue.bookingContact.phone ? (
              <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLabel, { color: colors.grey }]}>Phone</Text>
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${venue.bookingContact!.phone}`)}>
                  <Text style={s.link}>{venue.bookingContact.phone}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {nights.length > 0 ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Gig Nights</Text>
          {nights.map((night, i) => (
            <View key={i} style={s.nightRow}>
              <Text style={[s.nightDay, { color: colors.black }]}>{night.day}</Text>
              {night.startTime ? <Text style={[s.nightMeta, { color: colors.grey }]}>{night.startTime}</Text> : null}
              {night.duration  ? <Text style={[s.nightMeta, { color: colors.grey }]}>{night.duration} min</Text> : null}
              {(night.genres || []).length > 0 && (
                <View style={s.genreRow}>
                  {(night.genres || []).map(g => (
                    <View key={g} style={s.genrePillSmall}><Text style={s.genreTextSmall}>{g}</Text></View>
                  ))}
                </View>
              )}
              {night.notes ? <Text style={s.nightNotes}>{night.notes}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {genres.length > 0 ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Genre Preferences</Text>
          <View style={s.genreRow}>
            {genres.map(g => (
              <View key={g} style={s.genrePill}><Text style={s.genreText}>{g}</Text></View>
            ))}
          </View>
        </View>
      ) : null}

      {!isWeb && (
        <TouchableOpacity style={s.timetableBtn} onPress={onGoTimetable}>
          <Text style={s.timetableBtnText}>View Timetable & Available Slots →</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={[s.tabBody, isWeb && s.overviewLayout]}>
      {isWeb ? (
        <>
          {main}
          {sidebar}
        </>
      ) : (
        <>
          {sidebar}
          {main}
        </>
      )}
    </View>
  );
}

// ── Timetable tab ────────────────────────────────────────────────────

function TimetableTab({ venue, isArtist, isLoggedIn, userEnquiries, onEnquire }: {
  venue: Venue;
  isArtist: boolean;
  isLoggedIn: boolean;
  userEnquiries: Enquiry[];
  onEnquire: (slot: Slot, day: string, dateISO?: string) => void;
}) {
  const { colors } = useTheme();
  const today = new Date();
  const [viewMode, setViewMode]               = useState<'week' | 'month'>('week');
  const [weekStart, setWeekStart]             = useState(() => getMondayOfWeek(today));
  const [currentMonth, setCurrentMonth]       = useState(today.getMonth());
  const [currentYear, setCurrentYear]         = useState(today.getFullYear());
  const [activeDay, setActiveDay]             = useState<string>(() => {
    const fd = CANONICAL_DAYS.find(d => (venue.slots?.[d] || []).some(s => s.status === 'open'));
    return fd || CANONICAL_DAYS[4]; // Friday fallback
  });

  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = viewMode === 'week'
    ? `${fmtShort(weekStart)} — ${fmtShort(weekEnd)} ${weekEnd.getFullYear()}`
    : `${LONG_MONTHS[currentMonth]} ${currentYear}`;

  function handlePrev() {
    if (viewMode === 'week') setWeekStart(d => addDays(d, -7));
    else if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y-1); }
    else setCurrentMonth(m => m-1);
  }
  function handleNext() {
    if (viewMode === 'week') setWeekStart(d => addDays(d, 7));
    else if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y+1); }
    else setCurrentMonth(m => m+1);
  }

  if (isWeb) {
    // ── Web: week/month grid ──
    return (
      <View style={s.tabBody}>
        {/* Controls */}
        <View style={s.ttControls}>
          <View style={[s.ttToggle, { borderColor: colors.border }]}>
            {(['week','month'] as const).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[s.ttToggleBtn, viewMode === mode && s.ttToggleBtnActive]}
                onPress={() => setViewMode(mode)}
              >
                <Text style={[s.ttToggleText, { color: colors.grey }, viewMode === mode && s.ttToggleTextActive]}>
                  {mode === 'week' ? 'Week' : 'Month'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.ttRangeLabel, { color: colors.black }]}>{rangeLabel}</Text>
          <View style={s.ttNavBtns}>
            <TouchableOpacity style={[s.ttNavBtn, { borderColor: colors.border }]} onPress={handlePrev}>
              <Text style={[s.ttNavBtnText, { color: colors.black }]}>← Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ttNavBtn, { borderColor: colors.border }]} onPress={handleNext}>
              <Text style={[s.ttNavBtnText, { color: colors.black }]}>Next →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {viewMode === 'week' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.weekGrid}>
              {CANONICAL_DAYS.map(day => {
                const date   = addDays(weekStart, DAY_WEEK_OFFSET[day]);
                const past   = isDatePast(date);
                const dateISO = isoDate(date);
                const slots  = getSlotsForDate(venue, day, dateISO);
                return (
                  <View key={day} style={[s.dayCol, { borderColor: colors.border }, past && s.dayColPast]}>
                    <Text style={[s.dayColHeader, { color: colors.black }]}>{day.slice(0,3).toUpperCase()}</Text>
                    <Text style={[s.dayColDate, { color: colors.grey }]}>{fmtShort(date)}</Text>
                    {past && <Text style={[s.dayColPassed, { color: colors.grey }]}>Passed</Text>}
                    {slots.length === 0
                      ? <Text style={[s.dayColEmpty, { color: colors.greyLight }]}>No gigs scheduled</Text>
                      : slots.map((slot, i) => (
                          <WebSlotCard key={slot.id||i} slot={slot} day={day} dateISO={dateISO} past={past} isArtist={isArtist} isLoggedIn={isLoggedIn} userEnquiries={userEnquiries} onEnquire={onEnquire} />
                        ))
                    }
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {viewMode === 'month' && (
          <MonthGrid venue={venue} month={currentMonth} year={currentYear} isArtist={isArtist} isLoggedIn={isLoggedIn} userEnquiries={userEnquiries} onEnquire={onEnquire} />
        )}
      </View>
    );
  }

  // ── Native: day selector + slot list ──
  const nativeDateISO = nextDateForDay(activeDay);
  const daySlots  = venue.slots?.[activeDay] || [];
  const openRec   = daySlots.filter(s => s.status === 'open' && !s.date);
  const overrides = daySlots.filter(s => s.date === nativeDateISO && (s.status === 'booked' || s.status === 'pending'));
  const merged    = mergeSlots(openRec, overrides);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.dayBar, { borderBottomColor: colors.border }]} contentContainerStyle={s.dayBarContent}>
        {CANONICAL_DAYS.map(day => {
          const hasSlots = (venue.slots?.[day] || []).length > 0;
          return (
            <TouchableOpacity
              key={day}
              style={[s.dayBtn, { borderColor: colors.border }, activeDay === day && s.dayBtnActive, !hasSlots && s.dayBtnEmpty]}
              onPress={() => setActiveDay(day)}
              disabled={!hasSlots}
            >
              <Text style={[s.dayBtnText, { color: colors.grey }, activeDay === day && s.dayBtnTextActive, !hasSlots && s.dayBtnTextEmpty]}>
                {day.slice(0,3)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={s.slotList}>
        {merged.length === 0
          ? <View style={s.noSlots}><Text style={[s.noSlotsText, { color: colors.grey }]}>No gig slots for {activeDay}</Text></View>
          : merged.map((slot, i) => {
              const hasEnquired = userEnquiries.some(enq =>
                enq.status !== 'declined' && enq.status !== 'cancelled' &&
                enq.requestedSlot?.day === activeDay &&
                enq.requestedSlot?.time === slot.time
              );
              return (
                <NativeSlotCard
                  key={slot.id||i}
                  slot={slot}
                  day={activeDay}
                  isArtist={isArtist}
                  isLoggedIn={isLoggedIn}
                  hasEnquired={hasEnquired}
                  onEnquire={() => onEnquire(slot, activeDay, nativeDateISO)}
                />
              );
            })
        }
      </View>
    </View>
  );
}

// ── Web slot card ─────────────────────────────────────────────────────

function WebSlotCard({ slot, day, dateISO, past, isArtist, isLoggedIn, userEnquiries, onEnquire }: {
  slot: Slot; day: string; dateISO: string; past: boolean;
  isArtist: boolean; isLoggedIn: boolean; userEnquiries: Enquiry[];
  onEnquire: (s: Slot, d: string, date?: string) => void;
}) {
  const { colors } = useTheme();
  const hasEnquired = slot.status === 'open' && userEnquiries.some(enq =>
    enq.status !== 'declined' && enq.status !== 'cancelled' &&
    enq.requestedSlot?.day === day && enq.requestedSlot?.time === slot.time &&
    (enq.requestedSlot?.date ? enq.requestedSlot.date === dateISO : true)
  );

  if (slot.status === 'booked') {
    return (
      <View style={[ws.card, { borderColor: colors.border }]}>
        {slot.featured ? (
          <View style={ws.featuredBadge}><Text style={ws.featuredText}>★ Featured</Text></View>
        ) : null}
        <Text style={[ws.time, { color: colors.black }]}>{slot.time}</Text>
        <Text style={[ws.bandName, { color: colors.black }]}>{slot.bandName}</Text>
        {slot.slotType ? <View style={[ws.typePill, { backgroundColor: colors.bgFaint }]}><Text style={[ws.typeText, { color: colors.grey }]}>{slot.slotType}</Text></View> : null}
        {slot.ticketUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(slot.ticketUrl!)} style={ws.ticketBtn}>
            <Text style={ws.ticketBtnText}>Tickets</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }
  if (slot.status === 'pending') {
    return (
      <View style={[ws.card, ws.cardPending, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <Text style={[ws.time, { color: colors.black }]}>{slot.time}</Text>
        <Text style={ws.pendingLabel}>Pending</Text>
        {slot.bandName ? <Text style={[ws.bandNameMuted, { color: colors.grey }]}>{slot.bandName}</Text> : null}
        {slot.room ? <Text style={[ws.room, { color: colors.grey }]}>{slot.room}</Text> : null}
      </View>
    );
  }
  if (hasEnquired) {
    return (
      <View style={[ws.card, ws.cardEnquired, { borderColor: colors.border }]}>
        <Text style={[ws.time, { color: colors.black }]}>{slot.time}</Text>
        <Text style={ws.enquiredLabel}>Enquired — Waiting on venue response</Text>
        {slot.room ? <Text style={[ws.room, { color: colors.grey }]}>{slot.room}</Text> : null}
      </View>
    );
  }
  // open
  const canEnquire = !past && (isArtist || isLoggedIn);
  return (
    <TouchableOpacity
      style={[ws.card, ws.cardOpen, { borderColor: colors.border, backgroundColor: colors.bgFaint }, canEnquire && ws.cardOpenClickable]}
      onPress={canEnquire ? () => onEnquire(slot, day, dateISO) : undefined}
      activeOpacity={canEnquire ? 0.75 : 1}
    >
      <Text style={[ws.time, { color: colors.black }]}>{slot.time}</Text>
      <Text style={ws.openLabel}>Open{canEnquire ? ' — Enquire' : ''}</Text>
      {slot.room ? <Text style={[ws.room, { color: colors.grey }]}>{slot.room}</Text> : null}
    </TouchableOpacity>
  );
}

// ── Month grid ────────────────────────────────────────────────────────

function MonthGrid({ venue, month, year, isArtist, isLoggedIn, userEnquiries, onEnquire }: {
  venue: Venue; month: number; year: number;
  isArtist: boolean; isLoggedIn: boolean; userEnquiries: Enquiry[];
  onEnquire: (s: Slot, d: string, date?: string) => void;
}) {
  const { colors } = useTheme();
  const today = new Date();
  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells: (Date|null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={mg.wrap}>
      {DOW_HEADERS.map(h => <Text key={h} style={[mg.dow, { color: colors.grey }]}>{h}</Text>)}
      {cells.map((date, i) => {
        if (!date) return <View key={`e${i}`} style={[mg.cell, { borderColor: colors.border }]} />;
        const isToday = date.getFullYear()===today.getFullYear() && date.getMonth()===today.getMonth() && date.getDate()===today.getDate();
        const slotKey = DOW_TO_DAY[date.getDay()];
        const dateISO = isoDate(date);
        const slots   = getSlotsForDate(venue, slotKey, dateISO);
        return (
          <View key={`${date.getMonth()}-${date.getDate()}`} style={[mg.cell, { borderColor: colors.border }, isToday && mg.cellToday]}>
            <Text style={[mg.dayNum, { color: colors.black }, isToday && mg.dayNumToday]}>{date.getDate()}</Text>
            {slots.slice(0,3).map((slot,j) => {
              const hasEnq = slot.status === 'open' && userEnquiries.some(enq =>
                enq.status !== 'declined' && enq.status !== 'cancelled' &&
                enq.requestedSlot?.day === slotKey && enq.requestedSlot?.time === slot.time &&
                (enq.requestedSlot?.date ? enq.requestedSlot.date === dateISO : true)
              );
              return (
                <TouchableOpacity
                  key={slot.id||j}
                  style={[mg.pill, slot.status === 'open' ? (hasEnq ? mg.pillEnquired : mg.pillOpen) : mg.pillBooked]}
                  onPress={slot.status === 'open' && !hasEnq && (isArtist||isLoggedIn) ? () => onEnquire(slot, slotKey, dateISO) : undefined}
                >
                  <Text style={mg.pillText} numberOfLines={1}>
                    {slot.status === 'open'
                      ? (hasEnq ? `Enquired — ${slot.time}` : `Open — ${slot.time}`)
                      : (slot.bandName || (slot.status === 'pending' ? 'Pending' : 'Booked'))}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ── Native slot card ──────────────────────────────────────────────────

function NativeSlotCard({ slot, day, isArtist, isLoggedIn, hasEnquired, onEnquire }: {
  slot: Slot; day: string; isArtist: boolean; isLoggedIn: boolean;
  hasEnquired: boolean; onEnquire: () => void;
}) {
  const { colors } = useTheme();
  const isOpen    = slot.status === 'open';
  const isBooked  = slot.status === 'booked';
  const isPending = slot.status === 'pending';
  const fee = fmtFee(slot.feeMin, slot.feeMax);

  return (
    <View style={[ns.card, { backgroundColor: colors.bg, borderColor: colors.border }, isBooked && ns.cardBooked, isPending && ns.cardPending, (isOpen && hasEnquired) && ns.cardEnquired]}>
      {isBooked && slot.featured ? (
        <View style={ns.featuredBadge}><Text style={ns.featuredText}>★ Featured</Text></View>
      ) : null}
      <View style={ns.left}>
        <View style={ns.timeRow}>
          <Text style={[ns.time, { color: colors.black }]}>{slot.time}</Text>
          {slot.room ? <Text style={[ns.room, { color: colors.grey }]}>{slot.room}</Text> : null}
        </View>
        {isBooked  ? <Text style={ns.bandName}>{slot.bandName}</Text> : null}
        {isBooked && slot.ticketUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(slot.ticketUrl!)} style={ns.ticketBtn}>
            <Text style={ns.ticketBtnText}>Tickets →</Text>
          </TouchableOpacity>
        ) : null}
        {isPending ? <Text style={ns.pendingLabel}>Pending</Text> : null}
        {isOpen && hasEnquired ? (
          <Text style={ns.enquiredLabel}>Enquired — Waiting on venue response</Text>
        ) : null}
        {isOpen && !hasEnquired && (
          <View style={ns.openMeta}>
            {slot.slotType && slot.slotType !== 'Any' ? (
              <View style={ns.typePill}><Text style={ns.typeText}>{slot.slotType}</Text></View>
            ) : null}
            {slot.duration ? <Text style={ns.metaText}>{slot.duration} min</Text> : null}
            {fee ? <Text style={ns.metaText}>{fee}</Text> : null}
          </View>
        )}
        {(slot.genres||[]).length > 0 ? (
          <View style={ns.genreRow}>
            {(slot.genres||[]).map(g => (
              <View key={g} style={ns.genrePill}><Text style={ns.genreText}>{g}</Text></View>
            ))}
          </View>
        ) : null}
        {slot.notes ? <Text style={ns.notes}>{slot.notes}</Text> : null}
      </View>
      {isOpen && !hasEnquired && isArtist ? (
        <TouchableOpacity style={ns.enquireBtn} onPress={onEnquire}>
          <Text style={ns.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      ) : null}
      {isOpen && !hasEnquired && !isLoggedIn ? (
        <TouchableOpacity style={ns.enquireBtnGhost} onPress={onEnquire}>
          <Text style={ns.enquireBtnGhostText}>Log in to enquire</Text>
        </TouchableOpacity>
      ) : null}
      <View style={[ns.dot, {
        backgroundColor: isBooked ? '#22c55e' : isPending ? Colors.orange : hasEnquired ? '#f5a623' : '#e0e0e0',
      }]} />
    </View>
  );
}

// ── Media helpers ──────────────────────────────────────────────────────

function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?playsinline=1`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

function isEmbedVideo(url: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(url);
}

// ── MediaCarousel ──────────────────────────────────────────────────────

function MediaCarousel({
  items,
  renderSlide,
}: {
  items: string[];
  renderSlide: (url: string, i: number) => React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  if (!items.length) return null;

  const prev = () => setIndex(i => (i - 1 + items.length) % items.length);
  const next = () => setIndex(i => (i + 1) % items.length);

  return (
    <View style={mc.wrap}>
      {renderSlide(items[index], index)}

      {items.length > 1 && (
        <>
          <TouchableOpacity style={[mc.arrow, mc.arrowLeft]} onPress={prev} activeOpacity={0.8}>
            <Text style={mc.arrowText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[mc.arrow, mc.arrowRight]} onPress={next} activeOpacity={0.8}>
            <Text style={mc.arrowText}>›</Text>
          </TouchableOpacity>
          <View style={mc.dots}>
            {items.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => setIndex(i)}>
                <View style={[mc.dot, i === index && mc.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const mc = StyleSheet.create({
  wrap:      { position: 'relative', borderRadius: 12, overflow: 'hidden', backgroundColor: '#111111', aspectRatio: 16 / 9, width: '100%' },
  arrow: {
    position: 'absolute', top: '50%' as any, marginTop: -19,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  arrowLeft:  { left: 10 },
  arrowRight: { right: 10 },
  arrowText:  { fontSize: 24, color: '#ffffff', lineHeight: 30 },
  dots:       { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6, zIndex: 2 },
  dot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:  { backgroundColor: '#ffffff' },
});

// ── VideoPlayer ────────────────────────────────────────────────────────

function VideoPlayer({ url }: { url: string }) {
  const embed    = isEmbedVideo(url);
  const embedUrl = toEmbedUrl(url);

  // Web: use native browser elements via inline style trick
  if (isWeb) {
    if (embed) {
      return (
        <WebView
          source={{ uri: embedUrl }}
          style={{ flex: 1 }}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
        />
      );
    }
    // Direct video on web — WebView on web renders as iframe, so wrap in HTML
    return (
      <WebView
        source={{
          html: `<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh">
            <video src="${url}" controls playsinline style="width:100%;max-height:100%;outline:none"></video>
          </body></html>`,
        }}
        style={{ flex: 1 }}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
      />
    );
  }

  // Native
  if (embed) {
    return (
      <WebView
        source={{ uri: embedUrl }}
        style={{ flex: 1 }}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    );
  }

  // Native direct video — HTML5 video in WebView
  return (
    <WebView
      source={{
        html: `<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh">
          <video src="${url}" controls playsinline style="width:100%;max-height:100%;outline:none"></video>
        </body></html>`,
      }}
      style={{ flex: 1 }}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

// ── Photos & Videos tab ───────────────────────────────────────────────

function PhotosTab({ venue }: { venue: Venue }) {
  const { colors } = useTheme();
  const photos = [
    ...(venue.photoUrl ? [venue.photoUrl] : []),
    ...(venue.photos || []).filter((url: string) => url !== venue.photoUrl),
  ];
  const videos = venue.videos || [];
  const hasContent = photos.length > 0 || videos.length > 0;

  if (!hasContent) {
    return (
      <View style={[s.tabBody, { alignItems: 'center', paddingTop: 60 }]}>
        <Text style={[s.noSlotsText, { color: colors.grey }]}>No photos or videos yet.</Text>
      </View>
    );
  }

  return (
    <View style={[s.tabBody, isWeb && pt.webGrid]}>
      {photos.length > 0 && (
        <View style={[pt.mediaSection, isWeb && pt.mediaSectionWeb]}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Photos</Text>
          <MediaCarousel
            items={photos}
            renderSlide={(url) => (
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            )}
          />
        </View>
      )}
      {videos.length > 0 && (
        <View style={[pt.mediaSection, isWeb && pt.mediaSectionWeb]}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Videos</Text>
          <MediaCarousel
            items={videos}
            renderSlide={(url) => <VideoPlayer url={url} />}
          />
        </View>
      )}
    </View>
  );
}

// ── Rooms & Tech Specs tab ───────────────────────────────────────────

function RoomsTab({ venue }: { venue: Venue }) {
  const { colors } = useTheme();
  const rooms     = venue.rooms || [];
  const techSpecs = venue.techSpecs;

  const techRows = [
    { label: 'PA System',  value: techSpecs?.pa },
    { label: 'Monitoring', value: techSpecs?.monitoring },
    { label: 'Backline',   value: techSpecs?.backline },
    { label: 'Lighting',   value: techSpecs?.lighting },
    { label: 'Load-in',    value: techSpecs?.loadIn },
    { label: 'Soundcheck', value: techSpecs?.soundcheck },
    { label: 'Parking',    value: techSpecs?.parking },
  ].filter(r => r.value);

  if (rooms.length === 0 && !techSpecs) {
    return (
      <View style={[s.tabBody, { alignItems: 'center', paddingTop: 60 }]}>
        <Text style={[s.noSlotsText, { color: colors.grey }]}>Rooms and tech specs haven't been listed yet.</Text>
      </View>
    );
  }

  return (
    <View style={s.tabBody}>
      {rooms.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Rooms</Text>
          {rooms.map((room, i) => (
            <View key={i} style={[rt.roomCard, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[rt.roomName, { color: colors.black }]}>{room.name}</Text>
              <View style={rt.specsGrid}>
                {room.capacity ? (
                  <View style={rt.specItem}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>Capacity</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{Number(room.capacity).toLocaleString()}</Text>
                  </View>
                ) : null}
                {room.stage ? (
                  <View style={rt.specItem}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>Stage</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{room.stage}</Text>
                  </View>
                ) : null}
                {room.lighting ? (
                  <View style={rt.specItem}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>Lighting</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{room.lighting}</Text>
                  </View>
                ) : null}
                {room.pa ? (
                  <View style={rt.specItem}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>PA</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{room.pa}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {techSpecs && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.grey }]}>Tech Specs</Text>
          <View style={rt.specsGrid}>
            {techRows.map(({ label, value }) => (
              <View key={label} style={rt.specItem}>
                <Text style={[rt.specLabel, { color: colors.grey }]}>{label}</Text>
                <Text style={[rt.specValue, { color: colors.black }]}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={rt.specItem}>
            <Text style={[rt.specLabel, { color: colors.grey }]}>Green Room</Text>
            {techSpecs.greenRoom ? (
              <Text style={[rt.specValue, { color: Colors.orange }]}>
                ✓ Green room{techSpecs.greenRoomDetails ? ` — ${techSpecs.greenRoomDetails}` : ''}
              </Text>
            ) : (
              <Text style={[rt.specValue, { color: '#e94560' }]}>✕ No green room</Text>
            )}
          </View>
          {techSpecs.notes ? (
            <View style={[rt.notesBox, { backgroundColor: colors.bgFaint }]}>
              <Text style={[rt.notesText, { color: colors.grey }]}>{techSpecs.notes}</Text>
            </View>
          ) : null}
          {techSpecs.riderUrl ? (
            <TouchableOpacity onPress={() => Linking.openURL(techSpecs!.riderUrl!)}>
              <Text style={s.link}>{techSpecs.riderUrl}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: '#ffffff' },
  banner:             { width: '100%', height: isWeb ? 220 : 240, resizeMode: 'cover' },
  bannerPlaceholder:  { width: '100%', height: isWeb ? 220 : 240, backgroundColor: '#e8e3d8', alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { color: '#999999', fontSize: 14 },
  backOverlay:        { position: 'absolute', top: 16, left: 16, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  backOverlayText:    { fontSize: 14, fontWeight: '600', color: '#111111' },
  backText:           { fontSize: 15, color: Colors.orange, fontWeight: '600', padding: 20 },
  notFound:           { textAlign: 'center', color: '#888888', marginTop: 40, fontSize: 15 },

  // Sticky header
  stickyHeader:       { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  headerInfo:         { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: isWeb ? 40 : 20, paddingTop: 20, paddingBottom: 12 },
  name:               { fontSize: isWeb ? 32 : 26, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginBottom: 4 },
  address:            { fontSize: 14, color: '#555555', marginBottom: 10 },
  genreRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  genrePill:          { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  genreText:          { fontSize: 12, color: Colors.orange, fontWeight: '500' },
  genrePillSmall:     { borderWidth: 1, borderColor: Colors.orange, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  genreTextSmall:     { fontSize: 11, color: Colors.orange },
  editProfileBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, marginLeft: 12, alignSelf: 'flex-start', marginTop: 4 },
  editProfileBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },

  // Tab bar
  tabBar:             { borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  tabBarContent:      { flexDirection: 'row' },
  tabBtn:             { paddingVertical: 13, paddingHorizontal: isWeb ? 20 : 16, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive:       { borderBottomColor: Colors.orange },
  tabText:            { fontSize: 13, fontWeight: '600', color: '#888888' },
  tabTextActive:      { color: Colors.orange },

  // Tab body
  tabBody:            { padding: isWeb ? 40 : 20, paddingBottom: 60 },

  // Overview layout
  overviewLayout:     { flexDirection: 'row', alignItems: 'flex-start', gap: 32 },
  overviewMain:       { flex: 1 },
  overviewSidebar:    { width: 220, gap: 12 },
  overviewSidebarMobile: { gap: 12, marginBottom: 24 },

  // Stat cards
  statCard:           { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 16, alignItems: 'flex-start' },
  statNum:            { fontSize: 40, fontWeight: '800', color: '#111111', lineHeight: 44 },
  statLabel:          { fontSize: 11, fontWeight: '600', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  // This week
  thisWeekCard:       { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 14 },
  thisWeekTitle:      { fontSize: 11, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  thisWeekDay:        { marginBottom: 10 },
  thisWeekDayLabel:   { fontSize: 13, fontWeight: '700', color: '#111111', marginBottom: 4 },
  thisWeekSlot:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  thisWeekSlotTime:   { fontSize: 13, color: '#111111' },
  thisWeekSlotStatus: { fontSize: 13, fontWeight: '600' },
  thisWeekOpen:       { color: Colors.orange },
  thisWeekBooked:     { color: '#888888' },

  // Content sections
  section:            { marginBottom: 28 },
  sectionTitle:       { fontSize: 11, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  body:               { fontSize: 15, color: '#111111', lineHeight: 23 },
  readMore:           { fontSize: 14, color: Colors.orange, fontWeight: '600' },
  link:               { fontSize: 14, color: Colors.orange },
  infoGrid:           { borderTopWidth: 1, borderTopColor: '#eeeeee' },
  infoRow:            { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eeeeee', gap: 12 },
  infoLabel:          { width: 80, fontSize: 13, fontWeight: '600', color: '#888888', flexShrink: 0 },
  infoValue:          { flex: 1, fontSize: 14, color: '#111111' },
  contactName:        { fontSize: 14, fontWeight: '600', color: '#111111', marginBottom: 4 },
  nightRow:           { marginBottom: 12, gap: 4 },
  nightDay:           { fontSize: 14, fontWeight: '700', color: '#111111' },
  nightMeta:          { fontSize: 13, color: '#555555' },
  nightNotes:         { fontSize: 13, color: '#888888', fontStyle: 'italic' },
  timetableBtn:       { backgroundColor: Colors.orange, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  timetableBtnText:   { fontSize: 15, fontWeight: '700', color: '#111111' },

  // Timetable native
  dayBar:             { borderBottomWidth: 1, borderBottomColor: '#eeeeee', flexGrow: 0 },
  dayBarContent:      { paddingHorizontal: 12, paddingVertical: 4, gap: 4 },
  dayBtn:             { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#eeeeee' },
  dayBtnActive:       { backgroundColor: Colors.orange, borderColor: Colors.orange },
  dayBtnEmpty:        { opacity: 0.3 },
  dayBtnText:         { fontSize: 13, fontWeight: '600', color: '#888888' },
  dayBtnTextActive:   { color: '#111111' },
  dayBtnTextEmpty:    { color: '#cccccc' },
  slotList:           { padding: 16, gap: 12 },
  noSlots:            { padding: 40, alignItems: 'center' },
  noSlotsText:        { fontSize: 15, color: '#888888' },

  // Timetable web controls
  ttControls:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  ttToggle:           { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', overflow: 'hidden' },
  ttToggleBtn:        { paddingHorizontal: 16, paddingVertical: 8 },
  ttToggleBtnActive:  { backgroundColor: Colors.orange },
  ttToggleText:       { fontSize: 13, fontWeight: '600', color: '#555555' },
  ttToggleTextActive: { color: '#111111' },
  ttRangeLabel:       { fontSize: 15, fontWeight: '600', color: '#111111' },
  ttNavBtns:          { flexDirection: 'row', gap: 8 },
  ttNavBtn:           { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  ttNavBtnText:       { fontSize: 13, color: '#333333' },

  // Week grid (web)
  weekGrid:           { flexDirection: 'row', gap: 1 },
  dayCol:             { flex: 1, minWidth: 140, borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 8, padding: 10, gap: 8 },
  dayColPast:         { opacity: 0.5 },
  dayColHeader:       { fontSize: 11, fontWeight: '700', color: '#333333', letterSpacing: 0.5 },
  dayColDate:         { fontSize: 12, color: '#888888' },
  dayColPassed:       { fontSize: 11, color: '#888888', fontStyle: 'italic' },
  dayColEmpty:        { fontSize: 12, color: '#aaaaaa', paddingVertical: 8 },
});

// Web slot card styles
const ws = StyleSheet.create({
  card:             { borderRadius: 6, padding: 8, marginBottom: 4, borderWidth: 1, borderColor: '#e8e8e8', gap: 4 },
  cardOpen:         { borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  cardOpenClickable:{ borderColor: Colors.orange, backgroundColor: '#fff8f0' },
  cardEnquired:     { borderColor: '#f5a623', backgroundColor: '#fffbf0' },
  cardPending:      { borderColor: '#cccccc', backgroundColor: '#f8f8f8' },
  time:             { fontSize: 13, fontWeight: '700', color: '#111111' },
  openLabel:        { fontSize: 12, color: Colors.orange, fontWeight: '600' },
  enquiredLabel:    { fontSize: 12, color: '#f5a623', fontWeight: '600' },
  pendingLabel:     { fontSize: 12, color: '#888888', fontWeight: '600' },
  bandName:         { fontSize: 12, fontWeight: '700', color: '#111111' },
  bandNameMuted:    { fontSize: 12, color: '#888888' },
  room:             { fontSize: 11, color: '#888888' },
  typePill:         { alignSelf: 'flex-start', backgroundColor: '#f4f4f4', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  typeText:         { fontSize: 10, fontWeight: '700', color: '#333333', textTransform: 'uppercase' },
  ticketBtn:        { alignSelf: 'flex-start', backgroundColor: Colors.orange, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  ticketBtnText:    { fontSize: 11, fontWeight: '700', color: '#111111' },
  featuredBadge:    { alignSelf: 'flex-start', backgroundColor: '#fbbf24', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 },
  featuredText:     { fontSize: 10, fontWeight: '700', color: '#111111' },
});

// Month grid styles — 7 equal columns via flexBasis
const CELL_W = '14.28%';
const mg = StyleSheet.create({
  wrap:         { flexDirection: 'row', flexWrap: 'wrap' },
  dow:          { width: CELL_W, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#888888', paddingVertical: 6 },
  cell:         { width: CELL_W, borderWidth: 0.5, borderColor: '#eeeeee', minHeight: 80, padding: 4 },
  cellToday:    { backgroundColor: '#fff8f0' },
  dayNum:       { fontSize: 12, fontWeight: '600', color: '#333333', marginBottom: 2 },
  dayNumToday:  { color: Colors.orange },
  pill:         { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, marginBottom: 2 },
  pillOpen:     { backgroundColor: '#fff3e0' },
  pillBooked:   { backgroundColor: '#f0f0f0' },
  pillEnquired: { backgroundColor: '#fffbf0', borderWidth: 1, borderColor: '#f5a623' },
  pillText:     { fontSize: 10, color: '#333333' },
});

// Native slot card styles
const ns = StyleSheet.create({
  card:             { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardBooked:       { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  cardPending:      { borderColor: Colors.orange, backgroundColor: '#fff8f0' },
  cardEnquired:     { borderColor: '#f5a623', backgroundColor: '#fffbf0' },
  left:             { flex: 1, gap: 6 },
  timeRow:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time:             { fontSize: 17, fontWeight: '800', color: '#111111' },
  room:             { fontSize: 13, color: '#888888', fontWeight: '500' },
  bandName:         { fontSize: 15, fontWeight: '700', color: '#16a34a' },
  pendingLabel:     { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  enquiredLabel:    { fontSize: 13, color: '#f5a623', fontWeight: '600' },
  openMeta:         { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typePill:         { backgroundColor: 'rgba(250,131,12,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  typeText:         { fontSize: 11, color: Colors.orange, fontWeight: '700' },
  metaText:         { fontSize: 13, color: '#888888' },
  genreRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:        { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  genreText:        { fontSize: 11, color: '#888888' },
  notes:            { fontSize: 13, color: '#888888', fontStyle: 'italic' },
  enquireBtn:       { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  enquireBtnText:   { fontSize: 13, fontWeight: '700', color: '#111111' },
  enquireBtnGhost:  { borderWidth: 1, borderColor: Colors.orange, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  enquireBtnGhostText: { fontSize: 12, color: Colors.orange, fontWeight: '600' },
  dot:              { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4 },
  featuredBadge:    { alignSelf: 'flex-start', backgroundColor: '#fbbf24', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4 },
  featuredText:     { fontSize: 11, fontWeight: '700', color: '#111111' },
  ticketBtn:        { alignSelf: 'flex-start', marginTop: 4 },
  ticketBtnText:    { fontSize: 13, color: Colors.orange, fontWeight: '700' },
});

// Photos & Videos tab styles
const pt = StyleSheet.create({
  webGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' },
  mediaSection:     { marginBottom: 24 },
  mediaSectionWeb:  { flex: 1, minWidth: 280 },
});

// Rooms & tech styles
const rt = StyleSheet.create({
  roomCard:   { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 16, marginBottom: 16, backgroundColor: '#fafafa' },
  roomName:   { fontSize: 17, fontWeight: '700', color: '#111111', marginBottom: 12 },
  specsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  specItem:   { width: isWeb ? '50%' : '100%', paddingVertical: 8, paddingRight: 12, gap: 2 },
  specLabel:  { fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.6 },
  specValue:  { fontSize: 14, color: '#111111', fontWeight: '500' },
  notesBox:   { borderRadius: 8, backgroundColor: '#f8f8f8', padding: 14, marginTop: 12, marginBottom: 8 },
  notesText:  { fontSize: 13, color: '#555555', lineHeight: 20 },
});
