import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Platform, Linking, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import WebView from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useArtistEnquiries, type Enquiry } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';
import { STATE_TZ } from '@/lib/gig-types';
import { DashboardContent } from '@/app/dashboard';

// ── Types ────────────────────────────────────────────────────────────

type Slot = {
  id: string;
  time: string;
  date?: string | null;
  status: 'open' | 'booked' | 'pending';
  gigId?: string;
  gigName?: string;
  actName?: string;
  bandName?: string;
  name?: string;
  description?: string;
  room?: string;
  slotType?: string;
  feeMin?: number | null;
  feeMax?: number | null;
  feeBasis?: string;
  paymentModels?: string[];
  paymentModel?: string;
  paymentMethod?: string;
  minNotice?: string;
  genres?: string[];
  duration?: number;
  notes?: string;
  ticketUrl?: string;
  featured?: boolean;
  startDate?: string;
  endDate?: string;
  continuous?: boolean;
};

type Room = {
  name?: string;
  capacity?: number | string;
  stage?: string;
  lighting?: string;
  pa?: string;
  backline?: string;
  monitoring?: string;
  power?: string;
  notes?: string;
  documents?: { url: string; name: string }[];
};

type TechSpecs = {
  pa?: string;
  monitoring?: string;
  backline?: string;
  soundEngineer?: boolean;
  soundEngineerDetails?: string;
  stageDimensions?: string;
  stageDocs?: { url: string; name: string }[];
  power?: string;
  lighting?: string;
  loadInParking?: string;
  curfew?: string;
  greenRoom?: boolean;
  greenRoomDetails?: string;
  notes?: string;
  riderUrl?: string;
  documents?: { url: string; name: string }[];
  // Legacy fields
  loadIn?: string;
  soundcheck?: string;
  parking?: string;
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
  payment?: { models?: string[] };
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

/**
 * Returns the ISO date string for a given enquiry's intended slot date.
 * If the enquiry has an explicit date stored, use it. Otherwise infer from
 * submittedAt — find the next occurrence of requestedSlot.day on or after
 * the submission date. This handles legacy data where date was not stored.
 */
function inferSlotDate(enq: Enquiry): string {
  if (enq.requestedSlot?.date) return enq.requestedSlot.date;
  if (!enq.submittedAt || !enq.requestedSlot?.day) return '';
  const base = new Date(enq.submittedAt);
  if (isNaN(base.getTime())) return '';
  base.setHours(0, 0, 0, 0);
  const targetDow = DAY_WEEK_OFFSET[enq.requestedSlot.day] ?? -1;
  if (targetDow < 0) return '';
  const baseDow = (base.getDay() + 6) % 7; // Mon=0..Sun=6
  let daysAhead = targetDow - baseDow;
  if (daysAhead < 0) daysAhead += 7;
  return isoDate(addDays(base, daysAhead));
}

type SlotOccurrence = { date: Date; dateISO: string; day: string; slot: Slot };

function generateAllUpcoming(venue: Venue, months: number, startMonthOffset = 0): SlotOccurrence[] {
  const today = new Date(); today.setHours(0,0,0,0);
  const startDate = new Date(today); startDate.setMonth(startDate.getMonth() + startMonthOffset);
  const endDate = new Date(startDate); endDate.setMonth(endDate.getMonth() + months);
  const results: SlotOccurrence[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const day = DOW_TO_DAY[cur.getDay()];
    const dateISO = isoDate(cur);
    const slots = getSlotsForDate(venue, day, dateISO);
    slots.forEach(slot => results.push({ date: new Date(cur), dateISO, day, slot }));
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

function groupSlotsByMonth(items: SlotOccurrence[]): { year: number; month: number; items: SlotOccurrence[] }[] {
  const groups: { year: number; month: number; items: SlotOccurrence[] }[] = [];
  items.forEach(item => {
    const y = item.date.getFullYear(), m = item.date.getMonth();
    let g = groups.find(g => g.year === y && g.month === m);
    if (!g) { g = { year: y, month: m, items: [] }; groups.push(g); }
    g.items.push(item);
  });
  return groups;
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
  const recurOpen = all.filter((s: Slot) => {
    if (s.date || s.status !== 'open') return false;
    if (s.startDate && dateISO < s.startDate) return false;
    if (s.continuous === false && s.endDate && dateISO > s.endDate) return false;
    return true;
  });
  const overrides = all.filter((s: Slot) => s.date === dateISO && (s.status === 'booked' || s.status === 'pending'));
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

function slotPaymentSummary(slot: Slot): string {
  const models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
  const parts: string[] = [];
  if (models.includes('Flat fee') && slot.feeMin != null) {
    const range = slot.feeMax != null && slot.feeMax !== slot.feeMin ? `$${slot.feeMin}–$${slot.feeMax}` : `$${slot.feeMin}`;
    parts.push(`${range} flat fee`);
    const others = models.filter((m: string) => m !== 'Flat fee');
    if (others.length) parts.push(...others);
  } else if (models.length) {
    parts.push(...models);
  } else if (slot.feeMin != null) {
    parts.push(slot.feeMax != null && slot.feeMax !== slot.feeMin ? `$${slot.feeMin}–$${slot.feeMax}` : `$${slot.feeMin}`);
  }
  if (slot.paymentMethod) parts.push(slot.paymentMethod);
  return parts.join(' · ');
}

function fmtFee(min?: number | null, max?: number | null) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (min != null) return `from $${min}`;
  if (max != null) return `up to $${max}`;
  return null;
}

// ── Pending agent venue claim requests (shown to venue owner) ────────

type VenueClaimForOwner = {
  id: string;
  agentUid: string;
  agentName: string;
  agentUsername?: string;
  verificationCode: string;
  status: string;
};

function PendingAgentVenueClaims({ venueId }: { venueId: string }) {
  const { colors } = useTheme();
  const [claims, setClaims]         = useState<VenueClaimForOwner[]>([]);
  const [loading, setLoading]       = useState(true);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getDocs(
      query(collection(db, 'agentVenueClaims'),
        where('venueId', '==', venueId),
        where('status', '==', 'pending'))
    ).then(snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as VenueClaimForOwner)));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [venueId]);

  async function handleDecline(claim: VenueClaimForOwner) {
    setProcessing(p => ({ ...p, [claim.id]: true }));
    try {
      await updateDoc(doc(db, 'agentVenueClaims', claim.id), {
        status: 'declined',
        respondedAt: new Date().toISOString(),
      });
      setClaims(prev => prev.filter(c => c.id !== claim.id));
    } catch {} finally {
      setProcessing(p => ({ ...p, [claim.id]: false }));
    }
  }

  if (loading || claims.length === 0) return null;

  return (
    <View style={[pvac.wrap, { borderColor: colors.border }]}>
      <Text style={[pvac.heading]}>Representation Requests</Text>
      {claims.map(claim => (
        <View key={claim.id} style={[pvac.card, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <View style={pvac.cardTop}>
            <View>
              <Text style={[pvac.agentName, { color: colors.black }]}>{claim.agentName}</Text>
              {claim.agentUsername ? <Text style={[pvac.agentHandle, { color: colors.grey }]}>@{claim.agentUsername}</Text> : null}
            </View>
            <View style={[pvac.badge, { borderColor: '#f5a623' }]}>
              <Text style={[pvac.badgeText, { color: '#f5a623' }]}>Pending</Text>
            </View>
          </View>
          <Text style={[pvac.bodyText, { color: colors.grey }]}>
            This agent wants to represent your venue on Twaylo. Share the code below with them to approve, or decline if you don't recognise this request.
          </Text>
          <View style={[pvac.codeDisplay, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[pvac.codeDisplayLabel, { color: colors.grey }]}>YOUR VERIFICATION CODE</Text>
            <Text style={[pvac.codeDisplayValue, { color: colors.black }]}>{claim.verificationCode}</Text>
          </View>
          <View style={pvac.actions}>
            <TouchableOpacity
              style={[pvac.declineBtn, { borderColor: colors.border }, processing[claim.id] && pvac.btnDim]}
              onPress={() => handleDecline(claim)}
              disabled={!!processing[claim.id]}
              activeOpacity={0.75}
            >
              {processing[claim.id]
                ? <ActivityIndicator color={colors.grey} size="small" />
                : <Text style={[pvac.declineBtnText, { color: colors.grey }]}>Decline</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const pvac = StyleSheet.create({
  wrap: {
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: isWeb ? 40 : 20, paddingVertical: 20,
    marginBottom: 4,
  },
  heading:    { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, color: Colors.orange, marginBottom: 12, textTransform: 'uppercase' },
  card:       { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10, gap: 10 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  agentName:  { fontSize: 15, fontWeight: '700' },
  agentHandle:{ fontSize: 12, marginTop: 2 },
  badge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:  { fontSize: 12, fontWeight: '700' },
  bodyText:   { fontSize: 13, lineHeight: 20 },
  codeDisplay:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', gap: 4 },
  codeDisplayLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  codeDisplayValue: { fontSize: 28, fontWeight: '800', letterSpacing: 8 },
  actions:        { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  declineBtn:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' },
  declineBtnText: { fontSize: 13, fontWeight: '600' },
  btnDim:         { opacity: 0.45 },
});

// ── Main screen ───────────────────────────────────────────────────────

export default function VenueScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = _overrideId ?? String(paramId);
  const isProfileTab = !!_overrideId;
  const router = useRouter();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const isArtist = profile?.type === 'artist';
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;
  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/venues');
  const { enquiries: userEnquiries } = useArtistEnquiries(isArtist ? (user?.uid ?? null) : null);

  const [venue, setVenue]               = useState<Venue | null>(null);
  const [loading, setLoading]           = useState(true);
  const [isAgentForVenue, setIsAgentForVenue] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'timetable' | 'rooms' | 'photos' | 'dashboard'>(
    tabParam === 'timetable'  ? 'timetable'
    : tabParam === 'rooms'    ? 'rooms'
    : tabParam === 'photos'   ? 'photos'
    : tabParam === 'dashboard' ? 'dashboard'
    : 'overview',
  );

  useEffect(() => {
    return onSnapshot(doc(db, 'venues', id), snap => {
      if (snap.exists()) setVenue({ id: snap.id, ...snap.data() } as Venue);
      setLoading(false);
    }, () => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!user || profile?.type !== 'agent') return;
    getDocs(
      query(collection(db, 'agentVenueRoster'),
        where('agentUid', '==', user.uid),
        where('venueId', '==', id))
    ).then(snap => setIsAgentForVenue(!snap.empty)).catch(() => {});
  }, [user?.uid, id, profile?.type]);

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
  const venueTabs = [
    { id: 'overview',  label: 'Overview'           },
    { id: 'timetable', label: 'Timetable'          },
    { id: 'rooms',     label: 'Rooms & Tech Specs' },
    ...(hasPhotos ? [{ id: 'photos', label: 'Photos & Videos' }] : []),
  ] as const;

  // ── Web desktop dashboard (venue owner only) ──────────────────────
  if (isMyVenue && !isMobileLayout) {
    const enquireHandler = (slot: Slot, day: string, dateISO: string) => {
      const _models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
      router.push({
        pathname: '/enquire',
        params: {
          venueId:        venue.id,
          venueName:      venue.name,
          day,
          date:           dateISO || '',
          ...(slot.name ? { slotName: slot.name } : {}),
          time:           slot.time,
          room:           slot.room || '',
          slotType:       slot.slotType || 'Either',
          duration:       slot.duration ? String(slot.duration) : '',
          capacity:       venue.capacity ? String(venue.capacity) : '',
          venueTimezone:  STATE_TZ[venue.state ?? ''] ?? 'Australia/Sydney',
          slotNote:       slot.notes || '',
          ...(_models.length ? { paymentModels: _models.join(',') } : {}),
          ...(slot.feeMin != null ? { feeMin: String(slot.feeMin) } : {}),
          ...(slot.feeMax != null ? { feeMax: String(slot.feeMax) } : {}),
          ...(slot.paymentMethod ? { paymentMethod: slot.paymentMethod } : {}),
          ...(slot.minNotice ? { minNotice: slot.minNotice } : {}),
        },
      });
    };

    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
        <View style={vd.container}>

          {/* Left sidebar */}
          <View style={[vd.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
            {photo ? (
              <Image source={{ uri: photo }} style={vd.photo} resizeMode="cover" />
            ) : (
              <View style={[vd.photoPlaceholder, { backgroundColor: colors.border }]} />
            )}
            <Text style={[vd.sidebarName, { color: colors.black }]} numberOfLines={2}>
              {venue.name}
            </Text>
            {venue.suburb ? (
              <Text style={[vd.sidebarMeta, { color: colors.grey }]}>{venue.suburb}</Text>
            ) : null}

            <TouchableOpacity
              style={[vd.viewPublicBtn, { borderColor: colors.border }]}
              onPress={() => router.push(`/venue/${id}` as any)}
              activeOpacity={0.8}
            >
              <Text style={[vd.viewPublicText, { color: colors.black }]}>View public profile</Text>
            </TouchableOpacity>

            <View style={[vd.divider, { backgroundColor: colors.border }]} />

            {[...venueTabs, { id: 'dashboard', label: 'Dashboard' }].map((tab: { id: string; label: string }) => (
              <TouchableOpacity
                key={tab.id}
                style={[vd.navItem, activeTab === (tab.id as any) && vd.navItemActive]}
                onPress={() => setActiveTab(tab.id as any)}
                activeOpacity={0.75}
              >
                <Text style={[vd.navText, { color: activeTab === (tab.id as any) ? Colors.orange : colors.black }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={[vd.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={vd.editBtn}
              onPress={() => router.push('/edit-venue')}
              activeOpacity={0.85}
            >
              <Text style={vd.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[vd.logoutBtn, { borderColor: colors.border }]}
              onPress={async () => { await signOut(auth); router.replace('/'); }}
              activeOpacity={0.75}
            >
              <Text style={[vd.logoutText, { color: colors.grey }]}>Log out</Text>
            </TouchableOpacity>
          </View>

          {/* Main content */}
          <ScrollView style={vd.main} contentContainerStyle={vd.mainContent}>
            <PendingAgentVenueClaims venueId={id} />
            {activeTab === 'overview' && (
              <OverviewTab venue={venue} isArtist={false} isLoggedIn={!!user} onGoTimetable={() => setActiveTab('timetable')} isMobileLayout={false} />
            )}
            {activeTab === 'timetable' && (
              <TimetableTab
                venue={venue}
                isArtist={false}
                isLoggedIn={!!user}
                userEnquiries={userEnquiries}
                isMobileLayout={false}
                onEnquire={enquireHandler}
              />
            )}
            {activeTab === 'rooms'     && <RoomsTab venue={venue} />}
            {activeTab === 'photos'    && <PhotosTab venue={venue} />}
            {activeTab === 'dashboard' && <DashboardContent />}
            <View style={{ height: 40 }} />
          </ScrollView>

        </View>
      </SafeAreaView>
    );
  }

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
          <View style={[s.headerInfo, isMobileLayout && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <View style={isMobileLayout ? undefined : { flex: 1 }}>
              <Text style={[s.name, { color: colors.black }]}>{venue.name}</Text>
              {address ? <Text style={[s.address, { color: colors.grey }]}>{address}</Text> : null}
            </View>
            {isMyVenue ? (
              <View style={{ flexDirection: 'row', gap: 8, marginLeft: isMobileLayout ? 0 : 12, marginTop: isMobileLayout ? 12 : 4, flexWrap: 'wrap' }}>
                <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/(tabs)/gigs' as any)}>
                  <Text style={s.editProfileBtnText}>My Gigs</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/edit-venue')}>
                  <Text style={s.editProfileBtnText}>Edit Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.logoutBtn} onPress={async () => { await signOut(auth); router.replace('/'); }}>
                  <Text style={s.logoutBtnText}>Log out</Text>
                </TouchableOpacity>
              </View>
            ) : isAgentForVenue ? (
              <TouchableOpacity
                style={[s.editProfileBtn, { marginLeft: isMobileLayout ? 0 : 12, marginTop: isMobileLayout ? 12 : 4 }]}
                onPress={() => router.push(`/edit-venue?agentVenueId=${id}` as any)}
              >
                <Text style={s.editProfileBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            ) : isArtist ? (
              <TouchableOpacity style={[s.enquireHeaderBtn, isMobileLayout && { marginLeft: 0, marginTop: 12 }]} onPress={() => setActiveTab('timetable')}>
                <Text style={s.enquireHeaderBtnText}>Enquire about a timeslot</Text>
              </TouchableOpacity>
            ) : !user ? (
              <TouchableOpacity style={[s.enquireHeaderBtn, isMobileLayout && { marginLeft: 0, marginTop: 12 }]} onPress={() => router.push('/login')}>
                <Text style={s.enquireHeaderBtnText}>Log in to enquire</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.viewTimetableBtn, isMobileLayout && { marginLeft: 0, marginTop: 12 }]} onPress={() => setActiveTab('timetable')}>
                <Text style={s.viewTimetableBtnText}>View Timetable</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
            {([
              { id: 'overview',  label: 'Overview' },
              { id: 'timetable', label: 'Timetable' },
              { id: 'rooms',     label: 'Rooms & Tech Specs' },
              ...(hasPhotos ? [{ id: 'photos', label: 'Photos & Videos' }] : []),
              ...(isMyVenue ? [{ id: 'dashboard', label: 'Dashboard' }] : []),
            ] as const).map((tab: { id: string; label: string }) => (
              <TouchableOpacity
                key={tab.id}
                style={[s.tabBtn, activeTab === tab.id && s.tabBtnActive]}
                onPress={() => setActiveTab(tab.id as any)}
              >
                <Text style={[s.tabText, { color: colors.grey }, activeTab === tab.id && s.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Pending agent claims (venue owner only) ── */}
        {isMyVenue && <PendingAgentVenueClaims venueId={id} />}

        {/* ── Tab content ── */}
        {activeTab === 'overview' && (
          <OverviewTab venue={venue} isArtist={isArtist} isLoggedIn={!!user} onGoTimetable={() => setActiveTab('timetable')} isMobileLayout={isMobileLayout} />
        )}
        {activeTab === 'timetable' && (
          <TimetableTab
            venue={venue}
            isArtist={isArtist}
            isLoggedIn={!!user}
            userEnquiries={userEnquiries}
            isMobileLayout={isMobileLayout}
            onEnquire={(slot, day, dateISO) => {
              if (!user) { router.push('/login'); return; }
              const _models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
              router.push({
                pathname: '/enquire',
                params: {
                  venueId:        venue.id,
                  venueName:      venue.name,
                  day,
                  date:           dateISO || '',
                  time:           slot.time,
                  room:           slot.room || '',
                  slotType:       slot.slotType || 'Either',
                  duration:       slot.duration ? String(slot.duration) : '',
                  capacity:       venue.capacity ? String(venue.capacity) : '',
                  venueTimezone:  STATE_TZ[venue.state ?? ''] ?? 'Australia/Sydney',
                  ...(slot.name ? { slotName: slot.name } : {}),
                  slotNote:       slot.notes || '',
                  ...(_models.length ? { paymentModels: _models.join(',') } : {}),
                  ...(slot.feeMin != null ? { feeMin: String(slot.feeMin) } : {}),
                  ...(slot.feeMax != null ? { feeMax: String(slot.feeMax) } : {}),
                  ...(slot.paymentMethod ? { paymentMethod: slot.paymentMethod } : {}),
                  ...(slot.minNotice ? { minNotice: slot.minNotice } : {}),
                },
              });
            }}
          />
        )}
        {activeTab === 'rooms'     && <RoomsTab venue={venue} />}
        {activeTab === 'photos'    && <PhotosTab venue={venue} />}
        {activeTab === 'dashboard' && isMyVenue && <DashboardContent />}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({ venue, isArtist, isLoggedIn, onGoTimetable, isMobileLayout }: {
  venue: Venue; isArtist: boolean; isLoggedIn: boolean; onGoTimetable: () => void; isMobileLayout: boolean;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const desc = venue.description || '';
  const shouldTruncate = desc.length > MAX_DESC;
  const nights = venue.gigNights || venue.nightPreferences || [];
  const openSlots = countOpenSlotsThisMonth(venue);
  const recurringSchedule = CANONICAL_DAYS.flatMap(day => {
    const slots = (venue.slots?.[day] || []).filter(s => !s.date && s.status === 'open');
    return slots.map(s => ({ day, slot: s }));
  });
  const genres    = venue.genrePreferences || venue.genre || venue.genres || [];

  const StatCard = ({ num, label }: { num: string | number; label: string }) => (
    <View style={[s.statCard, { borderColor: colors.border }]}>
      <Text style={[s.statNum, { color: colors.black }]}>{num}</Text>
      <Text style={[s.statLabel, { color: colors.grey }]}>{label}</Text>
    </View>
  );

  const typicalFee = fmtFee(venue.feeMin, venue.feeMax);

  const sidebar = (
    <View style={!isMobileLayout ? s.overviewSidebar : s.overviewSidebarMobile}>
      {(venue.capacity ?? 0) > 0 && <StatCard num={Number(venue.capacity).toLocaleString()} label="Capacity" />}
      {openSlots > 0 && <StatCard num={openSlots} label="Open slots this month" />}
      {recurringSchedule.length > 0 && (
        <View style={[s.thisWeekCard, { borderColor: colors.border }]}>
          <Text style={[s.thisWeekTitle, { color: colors.grey }]}>Recurring</Text>
          {recurringSchedule.map(({ day, slot }, i) => (
            <View key={i} style={s.thisWeekSlot}>
              <Text style={[s.thisWeekSlotTime, { color: Colors.orange, fontWeight: '700' }]}>{day.slice(0, 3)}</Text>
              <Text style={[s.thisWeekSlotTime, { color: colors.black }]}>{slot.time}</Text>
              {slot.room ? <Text style={[s.thisWeekSlotStatus, { color: colors.grey }]}>{slot.room}</Text> : null}
            </View>
          ))}
        </View>
      )}
      {typicalFee && (
        <View style={[s.statCard, { borderColor: colors.border }]}>
          <Text style={[s.statLabel, { color: colors.grey }]}>Typical Fee</Text>
          <Text style={[s.statNum, { color: colors.black }]}>{typicalFee}</Text>
        </View>
      )}
    </View>
  );

  const main = (
    <View style={!isMobileLayout ? s.overviewMain : null}>

      {/* Description */}
      {desc ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>About</Text>
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

      {/* Payment */}
      {(venue.payment?.models || []).length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Payment</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Array.from(
              new Map(
                (venue.payment!.models!).map((model) => {
                  const label = /^set.?fee$/i.test(model.trim()) ? 'Flat fee' : model;
                  return [label, model] as [string, string];
                })
              ).entries()
            ).map(([label, key]) => (
              <View key={key} style={[s.genrePill, { borderColor: colors.border }]}>
                <Text style={[s.genreText, { color: colors.black }]}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

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


      {genres.length > 0 ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Genre Preferences</Text>
          <Text style={s.genreOrangeText}>{genres.join(' · ')}</Text>
        </View>
      ) : null}

      {/* Venue Info */}
      {(venue.phone || venue.email || venue.website) ? (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Venue Info</Text>
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

      {isMobileLayout && (
        <TouchableOpacity style={s.timetableBtn} onPress={onGoTimetable}>
          <Text style={s.timetableBtnText}>View Timetable & Available Slots →</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={[s.tabBody, !isMobileLayout && s.overviewLayout]}>
      {!isMobileLayout ? (
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

function TimetableTab({ venue, isArtist, isLoggedIn, userEnquiries, onEnquire, isMobileLayout }: {
  venue: Venue;
  isArtist: boolean;
  isLoggedIn: boolean;
  userEnquiries: Enquiry[];
  onEnquire: (slot: Slot, day: string, dateISO?: string) => void;
  isMobileLayout: boolean;
}) {
  const { colors } = useTheme();
  const today = new Date();

  // Web state
  const [filterTab, setFilterTab] = useState<'open' | 'all' | 'mine'>('open');

  // Native state
  const [nativeFilter, setNativeFilter] = useState<'open' | 'all' | 'mine'>('open');
  const [nativeMonthOffset, setNativeMonthOffset] = useState(0);

  const [monthOffset, setMonthOffset] = useState(0);

  if (!isMobileLayout) {
    const allUpcoming = generateAllUpcoming(venue, 3, monthOffset);

    const matchEnquiry = (enq: Enquiry, day: string, time: string, dateISO: string) =>
      enq.status !== 'declined' && enq.status !== 'cancelled' &&
      enq.requestedSlot?.day === day && enq.requestedSlot?.time === time &&
      inferSlotDate(enq) === dateISO;

    const hasEnquiryFor = (day: string, time: string, dateISO: string) =>
      userEnquiries.some(e => matchEnquiry(e, day, time, dateISO));

    const filtered = allUpcoming.filter(({ day, dateISO, slot }) => {
      if (filterTab === 'open') return slot.status === 'open' && !hasEnquiryFor(day, slot.time, dateISO);
      if (filterTab === 'mine') return hasEnquiryFor(day, slot.time, dateISO);
      return true;
    });

    const monthGroups = groupSlotsByMonth(filtered);

    const countLabel = filterTab === 'open'
      ? `${filtered.length} open slot${filtered.length !== 1 ? 's' : ''}`
      : filterTab === 'mine'
        ? `${filtered.length} slot${filtered.length !== 1 ? 's' : ''}`
        : `${filtered.length} slots listed`;

    const webWindowStart = new Date(today);
    webWindowStart.setMonth(webWindowStart.getMonth() + monthOffset);
    const webWindowEnd = new Date(webWindowStart);
    webWindowEnd.setMonth(webWindowEnd.getMonth() + 3);
    const webDateRange = `(${LONG_MONTHS[webWindowStart.getMonth()]} ${webWindowStart.getDate()} – ${LONG_MONTHS[webWindowEnd.getMonth()]} ${webWindowEnd.getDate()})`;

    const recurringSchedule = CANONICAL_DAYS.flatMap(day => {
      const slots = (venue.slots?.[day] || []).filter(s => !s.date && s.status === 'open');
      return slots.map(s => ({ day, slot: s }));
    });

    return (
      <View style={s.tabBody}>
        {/* Recurring bar */}
        {recurringSchedule.length > 0 && (
          <View style={[lv.usuallyBar, { borderBottomColor: colors.border }]}>
            <Text style={[lv.usuallyLabel, { color: colors.grey }]}>Recurring</Text>
            {recurringSchedule.map(({ day, slot }, i) => (
              <Text key={i} style={lv.usuallyItem}>
                <Text style={{ color: Colors.orange, fontWeight: '700' }}>{day.slice(0,3)} </Text>
                <Text style={{ color: colors.black }}>{slot.time}</Text>
                {slot.room ? <Text style={{ color: colors.grey }}>{'  '}{slot.room}</Text> : null}
              </Text>
            ))}
          </View>
        )}

        {/* Filter tabs + count */}
        <View style={lv.filterRow}>
          <View style={[lv.filterTabs, { borderColor: colors.border }]}>
            {(['open', 'all', 'mine'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[lv.filterTab, filterTab === tab && lv.filterTabActive]}
                onPress={() => setFilterTab(tab)}
              >
                <Text style={[lv.filterTabText, { color: filterTab === tab ? '#111111' : colors.grey }]}>
                  {tab === 'open' ? 'Open' : tab === 'all' ? 'All slots' : 'Mine'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={lv.countRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[lv.countLabel, { color: colors.grey }]}>{countLabel}</Text>
              <Text style={[lv.countLabel, { color: colors.grey, fontWeight: '400' }]}>{webDateRange}</Text>
            </View>
            <View style={lv.monthNavRow}>
              {monthOffset > 0 && (
                <TouchableOpacity style={lv.monthNavBtn} onPress={() => setMonthOffset(o => o - 3)}>
                  <Text style={[lv.monthNavText, { color: colors.grey }]}>&larr; Previous 3 Months</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={lv.monthNavBtn} onPress={() => setMonthOffset(o => o + 3)}>
                <Text style={[lv.monthNavText, { color: colors.grey }]}>Next 3 Months &rarr;</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Body: mini calendar panel + slot list */}
        <View style={lv.body}>
          {/* Left: availability calendar */}
          <View style={[lv.calPanel, { borderColor: colors.border }]}>
            <Text style={[lv.calPanelTitle, { color: colors.grey }]}>AVAILABILITY AT A GLANCE</Text>
            <View style={lv.calLegend}>
              <View style={lv.calLegendItem}>
                <View style={[lv.calDot, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.orange }]} />
                <Text style={[lv.calLegendText, { color: colors.grey }]}>Open</Text>
              </View>
              <View style={lv.calLegendItem}>
                <View style={[lv.calDot, { backgroundColor: '#e0e0e0' }]} />
                <Text style={[lv.calLegendText, { color: colors.grey }]}>Booked</Text>
              </View>
              <View style={lv.calLegendItem}>
                <View style={[lv.calDot, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#22c55e' }]} />
                <Text style={[lv.calLegendText, { color: colors.grey }]}>Enquired by me</Text>
              </View>
              <View style={lv.calLegendItem}>
                <View style={[lv.calDot, { backgroundColor: '#22c55e' }]} />
                <Text style={[lv.calLegendText, { color: colors.grey }]}>Booked by me</Text>
              </View>
            </View>
            {(() => {
              const windowStart = new Date(today); windowStart.setMonth(windowStart.getMonth() + monthOffset); windowStart.setHours(0,0,0,0);
              const windowEnd = new Date(windowStart); windowEnd.setMonth(windowEnd.getMonth() + 3);
              const calMonths: { year: number; month: number }[] = [];
              const calCur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
              const calEnd = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
              while (calCur <= calEnd) {
                calMonths.push({ year: calCur.getFullYear(), month: calCur.getMonth() });
                calCur.setMonth(calCur.getMonth() + 1);
              }
              return calMonths.map(({ year, month }) => (
                <MiniCalendarMonth
                  key={`${year}-${month}`}
                  venue={venue}
                  month={month}
                  year={year}
                  today={today}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  userEnquiries={userEnquiries}
                  colors={colors}
                />
              ));
            })()}
          </View>

          {/* Right: slot list */}
          <View style={lv.listArea}>
            {monthGroups.length === 0 ? (
              <Text style={[lv.emptyText, { color: colors.grey }]}>No slots to show.</Text>
            ) : (
              monthGroups.map(group => {
                const openCount = group.items.filter(i => i.slot.status === 'open').length;
                return (
                  <View key={`${group.year}-${group.month}`} style={lv.monthGroup}>
                    <View style={lv.monthHeader}>
                      <Text style={[lv.monthLabel, { color: colors.black }]}>
                        {LONG_MONTHS[group.month].toUpperCase()} {group.year}
                      </Text>
                      {openCount > 0 && (
                        <Text style={lv.monthOpenCount}>{openCount} open</Text>
                      )}
                    </View>
                    {group.items.map(({ date, dateISO, day, slot }, i) => (
                      <LvSlotRow
                        key={`${dateISO}-${slot.id || i}`}
                        slot={slot}
                        date={date}
                        dateISO={dateISO}
                        day={day}
                        isArtist={isArtist}
                        isLoggedIn={isLoggedIn}
                        userEnquiries={userEnquiries}
                        onEnquire={onEnquire}
                      />
                    ))}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </View>
    );
  }

  // ── Native: all dates layout ──
  const allUpcomingNative = generateAllUpcoming(venue, 3, nativeMonthOffset);
  const hasEnquiryForNative = (day: string, time: string, dateISO: string) =>
    userEnquiries.some(e =>
      e.status !== 'declined' && e.status !== 'cancelled' &&
      e.requestedSlot?.day === day && e.requestedSlot?.time === time &&
      inferSlotDate(e) === dateISO
    );
  const nativeFiltered = allUpcomingNative.filter(({ day, dateISO, slot }) => {
    if (nativeFilter === 'open') return slot.status === 'open' && !hasEnquiryForNative(day, slot.time, dateISO);
    if (nativeFilter === 'mine') return hasEnquiryForNative(day, slot.time, dateISO);
    return true;
  });
  const nativeMonthGroups = groupSlotsByMonth(nativeFiltered);

  const recurringSchedule = CANONICAL_DAYS.flatMap(day => {
    const slots = (venue.slots?.[day] || []).filter(s => !s.date && s.status === 'open');
    return slots.map(s => ({ day, slot: s }));
  });

  const nativeCountLabel = nativeFilter === 'open'
    ? `${nativeFiltered.length} open slot${nativeFiltered.length !== 1 ? 's' : ''}`
    : nativeFilter === 'mine'
      ? `${nativeFiltered.length} slot${nativeFiltered.length !== 1 ? 's' : ''}`
      : `${nativeFiltered.length} slots listed`;

  const windowStart = new Date(today);
  windowStart.setMonth(windowStart.getMonth() + nativeMonthOffset);
  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 3);
  const nativeDateRange = `(${LONG_MONTHS[windowStart.getMonth()]} ${windowStart.getDate()} – ${LONG_MONTHS[windowEnd.getMonth()]} ${windowEnd.getDate()})`;

  return (
    <View>
      {/* Recurring */}
      {recurringSchedule.length > 0 && (
        <View style={[nt.usuallyBar, { borderBottomColor: colors.border }]}>
          <Text style={[nt.usuallyLabel, { color: colors.grey }]}>Recurring</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={nt.usuallyScroll}>
            {recurringSchedule.map(({ day, slot }, i) => (
              <View key={i} style={[nt.usuallyChip, { borderColor: colors.border }]}>
                <Text style={[nt.usuallyChipDay, { color: Colors.orange }]}>{day.slice(0, 3)}</Text>
                <Text style={[nt.usuallyChipTime, { color: colors.black }]}>{slot.time}</Text>
                {slot.room ? <Text style={[nt.usuallyChipRoom, { color: colors.grey }]}>{slot.room}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filter tabs */}
      <View style={nt.filterRow}>
        <View style={[nt.filterControl, { borderColor: colors.border }]}>
          {(['open', 'all', 'mine'] as const).map((tab, idx) => (
            <>
              {idx > 0 && <View key={`div-${tab}`} style={[nt.filterDivider, { backgroundColor: colors.border }]} />}
              <TouchableOpacity
                key={tab}
                style={[nt.filterBtn, nativeFilter === tab && nt.filterBtnActive]}
                onPress={() => setNativeFilter(tab)}
              >
                <Text style={[nt.filterText, { color: nativeFilter === tab ? '#111111' : colors.grey }]}>
                  {tab === 'open' ? 'Open' : tab === 'all' ? 'All slots' : 'Mine'}
                </Text>
              </TouchableOpacity>
            </>
          ))}
        </View>
      </View>

      {/* Count + legend + nav */}
      <View style={nt.countNav}>
        {/* Legend */}
        <View style={nt.legend}>
          {[
            { label: 'Open',           dot: { borderWidth: 1.5, borderColor: Colors.orange, backgroundColor: 'transparent' } },
            { label: 'Booked',         dot: { backgroundColor: '#e0e0e0' } },
            { label: 'Enquired by me', dot: { borderWidth: 1.5, borderColor: '#22c55e', backgroundColor: 'transparent' } },
            { label: 'Booked by me',   dot: { backgroundColor: '#22c55e' } },
          ].map(({ label, dot }) => (
            <View key={label} style={nt.legendItem}>
              <View style={[nt.legendDot, dot]} />
              <Text style={[nt.legendText, { color: colors.grey }]}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 4 }}>
          <View style={nt.countRow}>
            <Text style={[nt.countLabel, { color: colors.grey }]}>{nativeCountLabel}</Text>
            <Text style={[nt.dateRange, { color: colors.grey }]}>{nativeDateRange}</Text>
          </View>
          <View style={[nt.navBtns, { justifyContent: 'flex-end' }]}>
            {nativeMonthOffset > 0 && (
              <TouchableOpacity style={nt.navBtn} onPress={() => setNativeMonthOffset(o => o - 3)}>
                <Text style={[nt.navBtnText, { color: colors.grey }]}>← Prev</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={nt.navBtn} onPress={() => setNativeMonthOffset(o => o + 3)}>
              <Text style={[nt.navBtnText, { color: colors.grey }]}>Next 3 Months →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Slot list grouped by month */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }}>
        {nativeMonthGroups.length === 0
          ? <View style={s.noSlots}><Text style={[s.noSlotsText, { color: colors.grey }]}>No slots to show.</Text></View>
          : nativeMonthGroups.map(group => (
              <View key={`${group.year}-${group.month}`} style={{ marginBottom: 24 }}>
                <Text style={[nt.monthLabel, { color: colors.grey }]}>
                  {LONG_MONTHS[group.month].toUpperCase()} {group.year}
                </Text>
                {group.items.map(({ date, dateISO, day, slot }, i) => {
                  const hasEnquired = hasEnquiryForNative(day, slot.time, dateISO);
                  return (
                    <AllDatesSlotRow
                      key={`${dateISO}-${slot.id || i}`}
                      slot={slot}
                      date={date}
                      dateISO={dateISO}
                      day={day}
                      isArtist={isArtist}
                      isLoggedIn={isLoggedIn}
                      hasEnquired={hasEnquired}
                      onEnquire={() => onEnquire(slot, day, dateISO)}
                      colors={colors}
                    />
                  );
                })}
              </View>
            ))
        }
      </View>
    </View>
  );
}

// ── Week slot row (native "This week" view) ───────────────────────────

function WeekSlotRow({ date, dateISO, dayName, slot, isArtist, isLoggedIn, hasEnquired, onEnquire, colors }: {
  date: Date; dateISO: string; dayName: string; slot: Slot;
  isArtist: boolean; isLoggedIn: boolean; hasEnquired: boolean;
  onEnquire: () => void; colors: any;
}) {
  const isOpen   = slot.status === 'open';
  const isBooked = slot.status === 'booked';
  const dayAbbr  = dayName.slice(0, 3).toUpperCase();

  const metaParts = [
    slot.room,
    isBooked  ? (slot.bandName || 'Booked')
    : hasEnquired ? 'Enquiry sent'
    : 'Open',
  ].filter(Boolean);

  return (
    <View style={[wr.row, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
      <View style={wr.left}>
        <View style={wr.topLine}>
          <Text style={[wr.dayDate, { color: colors.grey }]}>{dayAbbr} {date.getDate()}</Text>
          <Text style={[wr.time, { color: colors.black }]}>{slot.time}</Text>
        </View>
        <Text style={[wr.meta, { color: hasEnquired ? '#16a34a' : colors.grey }]}>{metaParts.join(' · ')}</Text>
      </View>
      {isOpen && !hasEnquired && isArtist && (
        <TouchableOpacity style={wr.enquireBtn} onPress={onEnquire}>
          <Text style={wr.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      )}
      {isOpen && !hasEnquired && !isLoggedIn && (
        <TouchableOpacity style={wr.loginBtn} onPress={onEnquire}>
          <Text style={[wr.loginBtnText, { color: Colors.orange }]}>Log in</Text>
        </TouchableOpacity>
      )}
      {hasEnquired && (
        <View style={[wr.statusBadge, { borderColor: '#22c55e' }]}>
          <Text style={[wr.statusText, { color: '#16a34a' }]}>Sent</Text>
        </View>
      )}
      {isBooked && !hasEnquired && (
        <View style={[wr.statusBadge, { borderColor: colors.border }]}>
          <Text style={[wr.statusText, { color: colors.grey }]}>Booked</Text>
        </View>
      )}
    </View>
  );
}

const wr = StyleSheet.create({
  row:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, gap: 12 },
  left:           { flex: 1, gap: 3 },
  topLine:        { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayDate:        { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  time:           { fontSize: 18, fontWeight: '800' },
  meta:           { fontSize: 13 },
  enquireBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, flexShrink: 0 },
  enquireBtnText: { fontSize: 13, fontWeight: '700', color: '#111111' },
  loginBtn:       { borderWidth: 1, borderColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexShrink: 0 },
  loginBtnText:   { fontSize: 13, fontWeight: '600' },
  statusBadge:    { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  statusText:     { fontSize: 12, fontWeight: '600' },
});

// ── All dates slot row (native "All dates" view) ─────────────────────

function AllDatesSlotRow({ slot, date, dateISO, day, isArtist, isLoggedIn, hasEnquired, onEnquire, colors }: {
  slot: Slot; date: Date; dateISO: string; day: string;
  isArtist: boolean; isLoggedIn: boolean; hasEnquired: boolean;
  onEnquire: () => void; colors: any;
}) {
  const isBooked = slot.status === 'booked';
  const isOpen   = slot.status === 'open';

  let leftBorderColor: string;
  let badgeLabel: string;
  let badgeTextColor: string;
  let badgeBorderColor: string;

  if (hasEnquired) {
    leftBorderColor = '#22c55e'; badgeLabel = 'Enquiry sent'; badgeTextColor = '#16a34a'; badgeBorderColor = '#22c55e';
  } else if (isBooked) {
    leftBorderColor = '#e0e0e0'; badgeLabel = 'Booked'; badgeTextColor = '#888888'; badgeBorderColor = '#e0e0e0';
  } else {
    leftBorderColor = Colors.orange; badgeLabel = 'Open'; badgeTextColor = Colors.orange; badgeBorderColor = Colors.orange;
  }

  return (
    <View style={[ad.row, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: colors.bg }]}>
      <View style={ad.dateBox}>
        <Text style={[ad.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[ad.dateMonth, { color: colors.grey }]}>{SHORT_MONTHS[date.getMonth()].toUpperCase()}</Text>
      </View>
      <Text style={[ad.dayAbbrev, { color: colors.grey }]}>{day.slice(0, 3).toUpperCase()}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[ad.time, { color: colors.black }]}>{slot.time}</Text>
        {slot.room ? <Text style={[ad.room, { color: colors.grey }]}>{slot.room}</Text> : null}
      </View>
      {isOpen && !hasEnquired && isArtist && (
        <TouchableOpacity style={ad.enquireBtn} onPress={onEnquire}>
          <Text style={ad.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      )}
      {isOpen && !hasEnquired && !isLoggedIn && (
        <TouchableOpacity style={[ad.enquireBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.orange }]} onPress={onEnquire}>
          <Text style={[ad.enquireBtnText, { color: Colors.orange }]}>Log in</Text>
        </TouchableOpacity>
      )}
      {(!isOpen || hasEnquired) && (
        <View style={[ad.badge, { borderColor: badgeBorderColor }]}>
          <Text style={[ad.badgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
        </View>
      )}
    </View>
  );
}

const ad = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, marginBottom: 10, paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  dateBox:      { width: 34, alignItems: 'center', flexShrink: 0 },
  dateNum:      { fontSize: 22, fontWeight: '800', lineHeight: 24 },
  dateMonth:    { fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginTop: 1 },
  dayAbbrev:    { width: 26, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, flexShrink: 0 },
  time:         { fontSize: 16, fontWeight: '800' },
  room:         { fontSize: 12, marginTop: 2 },
  enquireBtn:   { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexShrink: 0 },
  enquireBtnText: { fontSize: 13, fontWeight: '700', color: '#111111' },
  badge:        { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  badgeText:    { fontSize: 11, fontWeight: '600' },
});

// ── Mini calendar month (web) ─────────────────────────────────────────

function MiniCalendarMonth({ venue, month, year, today, windowStart, windowEnd, userEnquiries, colors }: {
  venue: Venue; month: number; year: number; today: Date;
  windowStart?: Date; windowEnd?: Date;
  userEnquiries: Enquiry[]; colors: any;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={lv.calMonth}>
      <Text style={[lv.calMonthLabel, { color: colors.black }]}>{LONG_MONTHS[month]} {year}</Text>
      <View style={lv.calDowRow}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <Text key={i} style={[lv.calDow, { color: colors.greyLight }]}>{d}</Text>
        ))}
      </View>
      <View style={lv.calGrid}>
        {cells.map((dayNum, i) => {
          if (!dayNum) return <View key={`e${i}`} style={lv.calCell} />;
          const date = new Date(year, month, dayNum);
          const dateISO = isoDate(date);
          const dayName = DOW_TO_DAY[date.getDay()];
          const todayNorm = new Date(today); todayNorm.setHours(0,0,0,0);
          const dateNorm = new Date(date); dateNorm.setHours(0,0,0,0);
          const winStart = windowStart ? new Date(windowStart) : todayNorm;
          const winEnd = windowEnd ? new Date(windowEnd) : null;
          winStart.setHours(0,0,0,0);
          if (winEnd) winEnd.setHours(0,0,0,0);
          const isOutOfRange = dateNorm < winStart || (winEnd !== null && dateNorm > winEnd);
          const isToday = dateNorm.getTime() === todayNorm.getTime();
          const slots = getSlotsForDate(venue, dayName, dateISO);
          const hasOpen = slots.some(s => s.status === 'open');
          const hasBooked = slots.some(s => s.status === 'booked');
          const myEnq = userEnquiries.find(e =>
            e.status !== 'declined' && e.status !== 'cancelled' &&
            slots.some(s => e.requestedSlot?.day === dayName && e.requestedSlot?.time === s.time && inferSlotDate(e) === dateISO)
          );
          const isBookedByMe = hasBooked && userEnquiries.some(e =>
            e.status === 'accepted' &&
            slots.some(s => e.requestedSlot?.day === dayName && e.requestedSlot?.time === s.time && inferSlotDate(e) === dateISO)
          );
          return (
            <View key={`${year}-${month}-${dayNum}`} style={lv.calCell}>
              <View style={[lv.calDayCircle, isToday && lv.calDayCircleToday]}>
                <Text style={[lv.calDayNum, { color: isToday ? '#ffffff' : isOutOfRange ? colors.greyLight : colors.black }]}>{dayNum}</Text>
              </View>
              <View style={lv.calDots}>
                {!isOutOfRange && hasOpen && !myEnq && <View style={[lv.calDot, { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.orange }]} />}
                {!isOutOfRange && !!myEnq && <View style={[lv.calDot, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#22c55e' }]} />}
                {!isOutOfRange && isBookedByMe && <View style={[lv.calDot, { backgroundColor: '#22c55e' }]} />}
                {!isOutOfRange && hasBooked && !isBookedByMe && <View style={[lv.calDot, { backgroundColor: '#e0e0e0' }]} />}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── List view slot row (web) ───────────────────────────────────────────

function LvSlotRow({ slot, date, dateISO, day, isArtist, isLoggedIn, userEnquiries, onEnquire }: {
  slot: Slot; date: Date; dateISO: string; day: string;
  isArtist: boolean; isLoggedIn: boolean;
  userEnquiries: Enquiry[];
  onEnquire: (s: Slot, d: string, date?: string) => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();

  const matchesSlot = (e: Enquiry) =>
    e.requestedSlot?.day === day && e.requestedSlot?.time === slot.time && inferSlotDate(e) === dateISO;

  const activeEnquiry = userEnquiries.find(e =>
    e.status !== 'declined' && e.status !== 'cancelled' && matchesSlot(e)
  );
  const hasEnquired  = slot.status === 'open' && !!activeEnquiry;
  const isBookedByMe = slot.status === 'booked' && userEnquiries.some(e => e.status === 'accepted' && matchesSlot(e));
  const canEnquire   = slot.status === 'open' && !hasEnquired && isArtist;

  let leftBorderColor: string;
  let badgeLabel: string;
  let badgeTextColor: string;
  let badgeBg: string;
  let badgeBorderColor: string;

  if (isBookedByMe) {
    leftBorderColor = '#22c55e';
    badgeLabel = 'Your gig'; badgeTextColor = '#ffffff'; badgeBg = '#22c55e'; badgeBorderColor = '#22c55e';
  } else if (hasEnquired) {
    leftBorderColor = '#22c55e';
    badgeLabel = 'Enquiry sent'; badgeTextColor = '#16a34a'; badgeBg = 'transparent'; badgeBorderColor = '#22c55e';
  } else if (slot.status === 'booked') {
    leftBorderColor = '#e0e0e0';
    badgeLabel = 'Booked'; badgeTextColor = '#888888'; badgeBg = 'transparent'; badgeBorderColor = '#e0e0e0';
  } else if (slot.status === 'pending') {
    leftBorderColor = Colors.orange;
    badgeLabel = 'Pending'; badgeTextColor = Colors.orange; badgeBg = 'transparent'; badgeBorderColor = Colors.orange;
  } else {
    leftBorderColor = Colors.orange;
    badgeLabel = 'Open'; badgeTextColor = Colors.orange; badgeBg = 'transparent'; badgeBorderColor = Colors.orange;
  }

  return (
    <View style={[lv.slotRow, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: colors.bg }]}>
      <View style={lv.dateBox}>
        <Text style={[lv.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[lv.dateMonth, { color: colors.grey }]}>{SHORT_MONTHS[date.getMonth()].toUpperCase()}</Text>
      </View>
      <Text style={[lv.dayAbbrev, { color: colors.grey }]}>{day.slice(0,3).toUpperCase()}</Text>
      <Text style={[lv.slotTime, { color: colors.black }]}>
        {slot.time}{slot.room ? <Text style={[lv.slotRoom, { color: colors.grey }]}> · {slot.room}</Text> : null}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={[lv.statusBadge, { borderColor: badgeBorderColor, backgroundColor: badgeBg }]}>
        <Text style={[lv.statusBadgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
      </View>
      {canEnquire && (
        <TouchableOpacity style={lv.enquireBtn} onPress={() => onEnquire(slot, day, dateISO)}>
          <Text style={lv.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      )}
      {(hasEnquired || isBookedByMe) && activeEnquiry && (
        <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/inbox', params: { openEnquiryId: activeEnquiry.id } } as any)}>
          <Text style={lv.viewLink}>View</Text>
        </TouchableOpacity>
      )}
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
        {isBooked ? (
          <>
            {(slot.gigName || slot.actName || slot.bandName) ? (
              <Text style={ns.bandName}>{slot.actName ?? slot.bandName}</Text>
            ) : null}
            {slot.gigName && slot.gigName !== (slot.actName ?? slot.bandName) ? (
              <Text style={[ns.notes, { fontStyle: 'italic' }]}>{slot.gigName}</Text>
            ) : null}
            {slot.description ? (
              <Text style={ns.notes} numberOfLines={2}>{slot.description}</Text>
            ) : null}
            {slot.ticketUrl ? (
              <TouchableOpacity onPress={() => Linking.openURL(slot.ticketUrl!)} style={ns.ticketBtn}>
                <Text style={ns.ticketBtnText}>Tickets →</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
        {isPending ? <Text style={ns.pendingLabel}>Pending</Text> : null}
        {isOpen && hasEnquired ? (
          <Text style={ns.enquiredLabel}>Enquired — Waiting on venue response</Text>
        ) : null}
        {isOpen && !hasEnquired && (
          <View style={ns.openMeta}>
            {slot.slotType && slot.slotType !== 'Headline' ? (
              <View style={ns.typePill}><Text style={ns.typeText}>{slot.slotType}</Text></View>
            ) : null}
            {slot.duration ? <Text style={ns.metaText}>{slot.duration} min</Text> : null}
            {fee ? <Text style={ns.metaText}>{fee}</Text> : null}
          </View>
        )}
        {(slot.genres||[]).length > 0 ? (
          <Text style={ns.genreOrangeText}>{(slot.genres||[]).join(' · ')}</Text>
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
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Photos</Text>
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
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Videos</Text>
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

  // Venue-level rows: load-in, parking, curfew
  const venueTechRows = [
    { label: 'Load-in',        value: techSpecs?.loadIn || techSpecs?.loadInParking },
    { label: 'Parking',        value: techSpecs?.parking },
    { label: 'Curfew / Noise', value: techSpecs?.curfew },
  ].filter(r => r.value);

  const hasVenueTech = venueTechRows.length > 0
    || typeof techSpecs?.soundEngineer !== 'undefined'
    || typeof techSpecs?.greenRoom !== 'undefined'
    || !!techSpecs?.notes
    || (techSpecs?.documents && techSpecs.documents.length > 0);

  if (rooms.length === 0 && !hasVenueTech) {
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
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Rooms</Text>
          {rooms.map((room, i) => {
            const roomTechRows = [
              { label: 'PA System',   value: room.pa },
              { label: 'Stage',       value: room.stage },
              { label: 'Lighting',    value: room.lighting },
              { label: 'Backline',    value: room.backline },
              { label: 'Monitoring',  value: room.monitoring },
              { label: 'Power',       value: room.power },
            ].filter(r => r.value);
            return (
              <View key={i} style={[rt.roomCard, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                <View style={rt.roomNameRow}>
                  <Text style={[rt.roomName, { color: colors.black }]}>{room.name}</Text>
                  {i === 0 && rooms.length > 1 && (
                    <View style={rt.primaryBadge}>
                      <Text style={rt.primaryBadgeText}>PRIMARY ROOM</Text>
                    </View>
                  )}
                </View>
                {room.capacity ? (
                  <View style={{ marginBottom: roomTechRows.length > 0 || room.notes ? 12 : 0 }}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>Capacity</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{Number(room.capacity).toLocaleString()}</Text>
                  </View>
                ) : null}
                {roomTechRows.length > 0 && (
                  <View style={rt.specsGrid}>
                    {roomTechRows.map(({ label, value }) => (
                      <View key={label} style={rt.specItem}>
                        <Text style={[rt.specLabel, { color: colors.grey }]}>{label}</Text>
                        <Text style={[rt.specValue, { color: colors.black }]}>{value}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {room.notes ? (
                  <View style={[rt.notesBox, { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, marginTop: 8 }]}>
                    <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 4 }]}>NOTES FOR ACTS</Text>
                    <Text style={[rt.notesText, { color: colors.black }]}>{room.notes}</Text>
                  </View>
                ) : null}
                {room.documents && room.documents.length > 0 ? (
                  <View style={[rt.notesBox, { backgroundColor: colors.bgFaint, marginTop: 8 }]}>
                    <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 8 }]}>TECH SPEC DOCUMENTS</Text>
                    {room.documents.map((doc, di) => (
                      <TouchableOpacity key={di} onPress={() => Linking.openURL(doc.url)} style={{ marginBottom: 6 }}>
                        <Text style={[s.link, { fontSize: 14 }]}>↓ {doc.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {hasVenueTech && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.black, fontSize: 16, textTransform: 'none', letterSpacing: -0.2, marginBottom: 16 }]}>Venue Info</Text>
          <View style={[rt.roomCard, { borderColor: colors.border, backgroundColor: colors.bgFaint, marginBottom: 0 }]}>
            {venueTechRows.length > 0 && (
              <View style={rt.specsGrid}>
                {venueTechRows.map(({ label, value }) => (
                  <View key={label} style={rt.specItem}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>{label}</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{value}</Text>
                  </View>
                ))}
              </View>
            )}
            {typeof techSpecs?.soundEngineer !== 'undefined' && (
              <View style={rt.specItem}>
                <Text style={[rt.specLabel, { color: colors.grey }]}>In-house Engineer</Text>
                <Text style={[rt.specValue, { color: techSpecs.soundEngineer ? Colors.orange : '#e94560' }]}>
                  {techSpecs.soundEngineer
                    ? `✓ Yes${techSpecs.soundEngineerDetails ? ` — ${techSpecs.soundEngineerDetails}` : ''}`
                    : '✕ No'}
                </Text>
              </View>
            )}
            {typeof techSpecs?.greenRoom !== 'undefined' && (
              <View style={rt.specItem}>
                <Text style={[rt.specLabel, { color: colors.grey }]}>Green Room</Text>
                {techSpecs.greenRoom ? (
                  <Text style={[rt.specValue, { color: Colors.orange }]}>
                    ✓ Available{techSpecs.greenRoomDetails ? ` — ${techSpecs.greenRoomDetails}` : ''}
                  </Text>
                ) : (
                  <Text style={[rt.specValue, { color: '#e94560' }]}>✕ No green room</Text>
                )}
              </View>
            )}
            {techSpecs?.notes ? (
              <View style={[rt.notesBox, { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, marginTop: 8 }]}>
                <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 4 }]}>VENUE NOTES</Text>
                <Text style={[rt.notesText, { color: colors.black }]}>{techSpecs.notes}</Text>
              </View>
            ) : null}
            {(techSpecs?.documents && techSpecs.documents.length > 0) ? (
              <View style={[rt.notesBox, { backgroundColor: colors.bgFaint, marginTop: 8 }]}>
                <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 8 }]}>DOCUMENTS</Text>
                {techSpecs.documents.map((doc, i) => (
                  <TouchableOpacity key={i} onPress={() => Linking.openURL(doc.url)} style={{ marginBottom: 6 }}>
                    <Text style={[s.link, { fontSize: 14 }]}>↓ {doc.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
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
  genreOrangeText:    { fontSize: 12, color: Colors.black, fontWeight: '500', marginTop: 2 },
  breadcrumb:         { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 1.4, marginBottom: 6 },
  editProfileBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start' },
  editProfileBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  logoutBtn:          { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start' },
  logoutBtnText:      { fontSize: 13, fontWeight: '600', color: Colors.grey },
  enquireHeaderBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginLeft: 12, alignSelf: 'flex-start', marginTop: 4 },
  enquireHeaderBtnText: { fontSize: 13, fontWeight: '700', color: '#111111' },
  viewTimetableBtn:     { borderWidth: 1, borderColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginLeft: 12, alignSelf: 'flex-start', marginTop: 4 },
  viewTimetableBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  sidebarEnquireBtn:     { backgroundColor: Colors.orange, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  sidebarEnquireBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },

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

  // Timetable controls extras
  ttSlotCount:        { fontSize: 13, fontWeight: '500', color: '#888888' },
  ttLegend:           { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, paddingVertical: 10, marginBottom: 4 },
  ttLegendItem:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ttLegendDot:        { width: 12, height: 12, borderRadius: 3 },
  ttLegendText:       { fontSize: 12, fontWeight: '500' },

  // Week view row layout (web)
  wvContainer:        { paddingTop: 4 },
  wvPastBar:          { flexDirection: 'row', alignItems: 'center', padding: 11, backgroundColor: '#f8f8f8', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, marginBottom: 4, gap: 12 },
  wvPastBarText:      { fontSize: 13, color: '#999999', fontStyle: 'italic', flex: 1 },
  wvPastBarToggle:    { borderWidth: 1, borderColor: '#cccccc', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  wvPastBarToggleText:{ fontSize: 12, fontWeight: '600', color: '#666666' },
  wvEmpty:            { paddingVertical: 48, textAlign: 'center', fontSize: 15 },
});

// List view styles (web desktop timetable)
const lv = StyleSheet.create({
  usuallyBar:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 18, paddingBottom: 14, borderBottomWidth: 1, marginBottom: 20 },
  usuallyLabel:     { fontSize: 13, fontWeight: '700', letterSpacing: 0 },
  usuallyItem:      { fontSize: 13 },
  filterRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  filterTabs:       { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  filterTab:        { paddingHorizontal: 18, paddingVertical: 9 },
  filterTabActive:  { backgroundColor: Colors.orange },
  filterTabText:    { fontSize: 13, fontWeight: '600' },
  countRow:         { gap: 8 },
  countLabel:       { fontSize: 13, fontWeight: '500' },
  monthNavRow:      { flexDirection: 'row', gap: 10 },
  monthNavBtn:      { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#e0e0e0' },
  monthNavText:     { fontSize: 13, fontWeight: '600' },
  body:             { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  // Mini calendar panel
  calPanel:         { width: 210, borderWidth: 1, borderRadius: 12, padding: 16 },
  calPanelTitle:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  calLegend:        { gap: 6, marginBottom: 20 },
  calLegendItem:    { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calLegendText:    { fontSize: 11 },
  calDot:           { width: 8, height: 8, borderRadius: 4 },
  calMonth:         { marginBottom: 18 },
  calMonthLabel:    { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  calDowRow:        { flexDirection: 'row', marginBottom: 2 },
  calDow:           { flex: 1, textAlign: 'center' as const, fontSize: 9, fontWeight: '700' },
  calGrid:          { flexDirection: 'row', flexWrap: 'wrap' },
  calCell:          { width: '14.28%' as any, alignItems: 'center', paddingVertical: 2 },
  calDayCircle:     { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calDayCircleToday:{ backgroundColor: Colors.orange },
  calDayNum:        { fontSize: 10, fontWeight: '600' },
  calDots:          { flexDirection: 'row', gap: 1, minHeight: 6, marginTop: 1, justifyContent: 'center' },
  // Slot list
  listArea:         { flex: 1 },
  emptyText:        { fontSize: 15, paddingVertical: 40, textAlign: 'center' as const },
  monthGroup:       { marginBottom: 24 },
  monthHeader:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  monthLabel:       { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  monthOpenCount:   { fontSize: 11, color: Colors.orange, fontWeight: '600' },
  // Slot row
  slotRow:          { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, marginBottom: 8, paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  dateBox:          { width: 36, alignItems: 'center', flexShrink: 0 },
  dateNum:          { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  dateMonth:        { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  dayAbbrev:        { width: 28, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.5, flexShrink: 0 },
  slotTime:         { fontSize: 16, fontWeight: '700', minWidth: 70, flexShrink: 0 },
  slotRoom:         { fontSize: 13, fontWeight: '500' },
  statusBadge:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0 },
  statusBadgeText:  { fontSize: 12, fontWeight: '600' },
  enquireBtn:       { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, flexShrink: 0 },
  enquireBtnText:   { fontSize: 13, fontWeight: '700', color: '#111111' },
  viewLink:         { fontSize: 13, fontWeight: '600', color: Colors.orange, paddingHorizontal: 4, flexShrink: 0 },
});

// Native timetable styles
const nt = StyleSheet.create({
  usuallyBar:            { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
  usuallyLabel:          { fontSize: 13, fontWeight: '700', letterSpacing: 0 },
  usuallyScroll:         { flexDirection: 'row', gap: 8, paddingRight: 4 },
  usuallyChip:           { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  usuallyChipDay:        { fontSize: 12, fontWeight: '700' },
  usuallyChipTime:       { fontSize: 12, fontWeight: '600' },
  usuallyChipRoom:       { fontSize: 11 },
  filterRow:             { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  countNav:              { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 16 },
  countRow:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 4 },
  countLabel:            { fontSize: 13, fontWeight: '500' },
  dateRange:             { fontSize: 12, fontWeight: '400' },
  navBtns:               { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  navBtn:                { paddingHorizontal: 4, paddingVertical: 9, alignSelf: 'flex-start' as const },
  navBtnText:            { fontSize: 13, fontWeight: '500' },
  legend:                { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 4 },
  legendItem:            { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:             { width: 9, height: 9, borderRadius: 5 },
  legendText:            { fontSize: 12 },
  filterControl:         { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  filterBtn:             { paddingHorizontal: 14, paddingVertical: 10 },
  filterDivider:         { width: 1, alignSelf: 'stretch' as const },
  filterBtnActive:       { backgroundColor: Colors.orange },
  filterText:            { fontSize: 13, fontWeight: '700' },
  monthGroup:            { marginBottom: 20 },
  monthLabel:            { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 4, paddingBottom: 10, paddingTop: 6, textTransform: 'uppercase' as const },
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
  genreOrangeText:  { fontSize: 11, color: Colors.black, fontWeight: '500', marginTop: 2 },
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
  roomCard:       { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 16, marginBottom: 16, backgroundColor: '#fafafa' },
  roomNameRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  roomName:       { fontSize: 17, fontWeight: '700', color: '#111111' },
  primaryBadge:   { backgroundColor: Colors.orange, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  primaryBadgeText: { fontSize: 10, fontWeight: '800', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.6 },
  specsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  specItem:   { width: isWeb ? '50%' : '100%', paddingVertical: 8, paddingRight: 12, gap: 2 },
  specLabel:  { fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.6 },
  specValue:  { fontSize: 14, color: '#111111', fontWeight: '500' },
  notesBox:   { borderRadius: 8, backgroundColor: '#f8f8f8', padding: 14, marginTop: 12, marginBottom: 8 },
  notesText:  { fontSize: 13, color: '#555555', lineHeight: 20 },
});

// ── Venue dashboard styles (web desktop, own venue) ────────────────
const vd = StyleSheet.create({
  container:        { flex: 1, flexDirection: 'row' },
  sidebar:          { width: 224, borderRightWidth: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  photo:            { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  photoPlaceholder: { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  sidebarName:      { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, marginBottom: 4 },
  sidebarMeta:      { fontSize: 12, marginBottom: 16 },
  viewPublicBtn:    { borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  viewPublicText:   { fontSize: 13, fontWeight: '600' },
  divider:          { height: 1, marginVertical: 18 },
  navItem:          { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 7, marginBottom: 2 },
  navItemActive:    { backgroundColor: Colors.orange + '18' },
  navText:          { fontSize: 14, fontWeight: '600' },
  editBtn:          { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  editBtnText:      { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  logoutBtn:        { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  logoutText:       { fontSize: 13, fontWeight: '600' },
  main:             { flex: 1 },
  mainContent:      { paddingHorizontal: 40, paddingVertical: 32 },
});
