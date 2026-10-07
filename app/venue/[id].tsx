import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Platform, Linking, useWindowDimensions,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { resolveSlotTerms, formatPaySummary } from '@/lib/resolveSlotTerms';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useArtistEnquiries, type Enquiry } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';
import { STATE_TZ } from '@/lib/gig-types';
import { DashboardContent } from '@/app/dashboard';
import { MyGigsContent } from '@/app/(tabs)/gigs';

// ── Types ────────────────────────────────────────────────────────────

type Slot = {
  id: string;
  time: string;
  date?: string | null;
  status: 'open' | 'booked' | 'pending' | 'closed';
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
  loadIn?: string;
  soundcheck?: string;
  soundcheckDetails?: string;
  useDefaultPay?: boolean;
  useDefaultHospitality?: boolean;
  feeMin?: number | null;
  feeMax?: number | null;
  doorSplit?: string;
  guaranteeAmount?: string;
  guaranteeSplit?: string;
  barSplit?: string;
  ticketSalesSplit?: string;
  ticketingHandledBy?: string;
  negotiable?: boolean;
  guestList?: string;
  meals?: boolean;
  mealsDetails?: string;
  drinks?: boolean;
  drinksDetails?: string;
};

type Room = {
  name?: string;
  capacity?: number | string;
  stage?: string;
  stageWidth?: number | string;
  stageDepth?: number | string;
  lighting?: string;
  pa?: string;
  backline?: string;
  backlineItems?: string[];
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
  venueType?: string;
  ageRestriction?: string;
  instagram?: string;
  facebook?: string;
  verified?: boolean;
  listed?: boolean;
  photoUrl?: string;
  logoUrl?: string;
  photoPosition?: { x: number; y: number };
  photos?: string[];
  photoObjects?: { url: string; caption?: string }[];
  videos?: string[];
  videoObjects?: { url: string; title?: string }[];
  capacity?: number;
  feeMin?: number;
  feeMax?: number;
  website?: string;
  email?: string;
  phone?: string;
  showPhone?: boolean;
  latitude?: string;
  longitude?: string;
  bookingContact?: { name?: string; email?: string; phone?: string };
  slots?: Record<string, Slot[]>;
  rooms?: Room[];
  techSpecs?: TechSpecs & {
    wheelchairAccess?: boolean;
    accessibleBathroom?: boolean;
    stepFreeStage?: boolean;
    wheelchairParking?: boolean;
  };
  gigNights?: GigNight[];
  nightPreferences?: GigNight[];
  payment?: { models?: string[] };
  invoicingMode?: string;
  bookingTerms?: {
    payModels?: string[];
    negotiable?: boolean;
    flatFeeMin?: string;
    flatFeeMax?: string;
    flatFeeBasis?: string;
    doorSplit?: string;
    guaranteeAmount?: string;
    guaranteeSplit?: string;
    barSplit?: string;
    ticketSplitPct?: string;
    ticketingBy?: string;
    methods?: string[];
    paymentTiming?: string;
    depositRequired?: boolean;
    depositAmount?: string;
    depositDue?: string;
    minNotice?: string;
    guestList?: string;
    meals?: boolean;
    mealsDetails?: string;
    drinks?: boolean;
    drinksDetails?: string;
    reqAbn?: boolean;
    showPayPublicly?: boolean;
  };
  settings?: { listed?: boolean };
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
  const overrides = all.filter((s: Slot) => s.date === dateISO && (s.status === 'booked' || s.status === 'pending' || s.status === 'closed'));
  return mergeSlots(recurOpen, overrides);
}

// ── Open date count (next 8 weeks) ───────────────────────────────────

function countOpenDatesNext8Weeks(venue: Venue): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + 56);
  const cur = new Date(today);
  let count = 0;
  while (cur <= end) {
    const day = DOW_TO_DAY[cur.getDay()];
    const dateISO = isoDate(cur);
    const slots = getSlotsForDate(venue, day, dateISO);
    if (slots.some(s => s.status === 'open')) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
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

// ── Key facts strip ───────────────────────────────────────────────────

function KeyFactsStrip({ venue, isLoggedIn }: { venue: Venue; isLoggedIn: boolean }) {
  const { colors } = useTheme();
  const terms = resolveSlotTerms(venue);
  const showPay = isLoggedIn || !!venue.bookingTerms?.showPayPublicly;

  const rooms = venue.rooms || [];
  const capacityParts = rooms.map(r => r.capacity).filter(Boolean);
  const capacityValue = capacityParts.length > 0
    ? capacityParts.map(c => String(c)).join(' + ')
    : venue.capacity ? String(venue.capacity) : null;
  const capacityLabel = rooms.map(r => r.name).filter(Boolean).join(', ') || null;

  const typicalPay = showPay ? formatPaySummary(terms) : null;
  const payModels = showPay ? (terms.payModels || []).join(', or ') : null;

  const curfew = venue.techSpecs?.curfew || null;
  const noiseNote = venue.techSpecs?.notes || null;

  const minNotice = terms.minNotice || null;
  const openDates = countOpenDatesNext8Weeks(venue);

  const cells = [
    capacityValue ? { value: capacityValue, sub: capacityLabel || 'Total capacity', key: 'cap' } : null,
    showPay && typicalPay ? { value: typicalPay, sub: payModels || 'Pay', key: 'pay' } : null,
    curfew ? { value: curfew, sub: noiseNote ? noiseNote.split(/[.,]/)[0].trim().slice(0, 40) : 'Curfew', key: 'curfew' } : null,
    minNotice ? { value: minNotice, sub: 'Minimum notice', key: 'notice' } : null,
    { value: String(openDates), sub: 'Next 8 weeks', key: 'dates' },
  ].filter(Boolean) as { value: string; sub: string; key: string }[];

  if (cells.length === 0) return null;

  return (
    <View style={[kf.strip, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
      {cells.map((cell, i) => (
        <View key={cell.key} style={[kf.cell, i < cells.length - 1 && { borderRightWidth: 1, borderRightColor: colors.border }]}>
          <Text style={[kf.value, { color: colors.black }]} numberOfLines={1}>{cell.value}</Text>
          <Text style={[kf.sub, { color: colors.grey }]} numberOfLines={1}>{cell.sub}</Text>
        </View>
      ))}
    </View>
  );
}

const kf = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, marginBottom: 0 },
  cell:  { flex: 1, minWidth: 100, paddingVertical: 12, paddingHorizontal: 14 },
  value: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, marginBottom: 2 },
  sub:   { fontSize: 11, fontWeight: '500' },
});

// ── Main screen ───────────────────────────────────────────────────────

export default function VenueScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: tabParam, preview } = useLocalSearchParams<{ id: string; tab?: string; preview?: string }>();
  const id = _overrideId ?? String(paramId);
  const isProfileTab = !!_overrideId;
  const isPublicPreview = !!preview;
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
  const [gigsHosted, setGigsHosted]     = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'timetable' | 'rooms' | 'photos' | 'dashboard' | 'gigs'>(
    tabParam === 'timetable'   ? 'timetable'
    : tabParam === 'rooms'     ? 'rooms'
    : tabParam === 'photos'    ? 'photos'
    : tabParam === 'dashboard' ? 'dashboard'
    : tabParam === 'gigs'      ? 'gigs'
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

  useEffect(() => {
    getDocs(query(collection(db, 'inquiries'), where('venueId', '==', id), where('status', '==', 'confirmed')))
      .then(snap => setGigsHosted(snap.size))
      .catch(() => {});
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

  const isMyVenue = !isPublicPreview && profile?.type === 'venue' && profile?.venueId === id;
  const genres    = venue.genrePreferences || venue.genre || venue.genres || [];
  const photo     = venue.photoUrl || (venue.photos && venue.photos[0]);
  const hasPhotos = (venue.photos || []).length > 0 || (venue.videos || []).length > 0 || isMyVenue;
  const venueTabs = [
    { id: 'overview',  label: 'Overview'       },
    { id: 'timetable', label: 'Gig slots'      },
    { id: 'rooms',     label: 'Rooms & tech'   },
    ...(hasPhotos ? [{ id: 'photos', label: 'Photos & video' }] : []),
    ...(isMyVenue ? [{ id: 'gigs', label: 'My Gigs' }] : []),
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
            {!isProfileTab && (
              <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12 }}>
                <TouchableOpacity
                  onPress={handleBack}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: colors.black, lineHeight: 18 }}>←</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.black }}>Back</Text>
                </TouchableOpacity>
              </View>
            )}
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

            <View style={{ height: 12 }} />

            {([
              { id: 'overview',  label: 'Overview'     },
              { id: 'timetable', label: 'Gig slots'    },
              { id: 'rooms',     label: 'Rooms & tech' },
              ...(hasPhotos ? [{ id: 'photos', label: 'Photos & video' }] : []),
            ] as const).map((tab: { id: string; label: string }) => (
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

            {([
              { id: 'gigs',      label: 'My Gigs'   },
              { id: 'dashboard', label: 'Dashboard'  },
            ] as const).map(tab => (
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
              <OverviewTab venue={venue} isArtist={false} isLoggedIn={!!user} onGoTimetable={() => setActiveTab('timetable')} onEnquire={enquireHandler} isMobileLayout={false} isMyVenue={isMyVenue} gigsHosted={gigsHosted} />
            )}
            {activeTab === 'timetable' && (
              <TimetableTab
                venue={venue}
                isArtist={false}
                isLoggedIn={!!user}
                userEnquiries={userEnquiries}
                isMobileLayout={false}
                onEnquire={enquireHandler}
                isMyVenue={isMyVenue}
              />
            )}
            {activeTab === 'rooms'     && <RoomsTab venue={venue} isArtist={isArtist} isLoggedIn={!!user} userId={user?.uid} />}
            {activeTab === 'photos'    && <PhotosTab venue={venue} />}
            {activeTab === 'gigs'      && <MyGigsContent embedded />}
            {activeTab === 'dashboard' && <DashboardContent />}
            <View style={{ height: 40 }} />
          </ScrollView>

        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
      {isPublicPreview && (
        <View style={[s.previewBanner, { backgroundColor: colors.black }]}>
          <Text style={s.previewBannerText}>Previewing as the public would see this profile</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/profile' as any)} activeOpacity={0.75}>
            <Text style={s.previewBannerExit}>Exit preview</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Desktop web: top nav bar with back button */}
      {!isProfileTab && isWeb && !isMobileLayout && (
        <View style={[s.webNavBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
            <Text style={{ fontSize: 14, color: colors.grey }}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView stickyHeaderIndices={[1]}>

        {/* ── Full header (scrolls away) ── */}
        <View>
          {/* Cover photo */}
          <View>
            {photo
              ? <PositionedBanner uri={photo} position={venue.photoPosition} height={isWeb ? 260 : 200} />
              : <View style={[s.bannerPlaceholder, { height: isWeb ? 260 : 200 }]} />
            }
          </View>

          {/* Identity row: logo + name + subline */}
          <View style={[s.identityRow, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
            {/* Logo overlapping the cover */}
            <View style={s.logoWrap}>
              {(venue.logoUrl || venue.photoUrl) ? (
                <Image source={{ uri: venue.logoUrl || venue.photoUrl }} style={[s.logoImg, { borderColor: colors.bg }]} resizeMode="cover" />
              ) : (
                <View style={[s.logoPlaceholder, { borderColor: colors.bg, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.logoPlaceholderText, { color: colors.grey }]}>
                    {venue.name?.slice(0, 2).toUpperCase() || '??'}
                  </Text>
                </View>
              )}
            </View>

            <View style={s.identityInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={[s.name, { color: colors.black }]}>{venue.name}</Text>
                {venue.verified && (
                  <View style={s.verifiedBadge}>
                    <Text style={s.verifiedBadgeText}>✓ Verified</Text>
                  </View>
                )}
              </View>
              {(() => {
                const sublineParts = [
                  venue.venueType,
                  [venue.suburb, venue.state].filter(Boolean).join(', '),
                  venue.ageRestriction,
                ].filter(Boolean);
                return sublineParts.length > 0
                  ? <Text style={[s.subline, { color: colors.grey }]}>{sublineParts.join(' · ')}</Text>
                  : null;
              })()}
            </View>
          </View>

          {/* Action buttons */}
          <View style={[s.actionsRow, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
            {isMyVenue ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/edit-venue')}>
                  <Text style={s.editProfileBtnText}>Edit profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.logoutBtn} onPress={async () => { await signOut(auth); router.replace('/'); }}>
                  <Text style={s.logoutBtnText}>Log out</Text>
                </TouchableOpacity>
              </View>
            ) : isAgentForVenue ? (
              <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push(`/edit-venue?agentVenueId=${id}` as any)}>
                <Text style={s.editProfileBtnText}>Edit profile</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={s.msgVenueBtn}
                  onPress={() => router.push({ pathname: '/(tabs)/inbox', params: { newThreadVenueId: id } } as any)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.msgVenueBtnText, { color: colors.black }]}>Message venue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.enquireHeaderBtn}
                  onPress={() => {
                    if (!user) { router.push('/login'); return; }
                    setActiveTab('timetable');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.enquireHeaderBtnText}>See open dates</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Genre chips */}
          {genres.length > 0 && (
            <View style={[s.genreChipsRow, { backgroundColor: colors.bg }]}>
              {genres.map((g, i) => (
                <View key={i} style={[s.genrePill, { borderColor: colors.border }]}>
                  <Text style={[s.genreText, { color: colors.black }]}>{g}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Key facts strip */}
          <KeyFactsStrip venue={venue} isLoggedIn={!!user} />

          {/* Pending agent claims (venue owner only) */}
          {isMyVenue && <PendingAgentVenueClaims venueId={id} />}
        </View>

        {/* ── Tab bar (sticky) ── */}
        <View style={[s.stickyTabBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabBarContent}>
            {([
              { id: 'overview',  label: 'Overview'     },
              { id: 'timetable', label: 'Gig slots'    },
              { id: 'rooms',     label: 'Rooms & tech' },
              ...(hasPhotos ? [{ id: 'photos', label: 'Photos & video' }] : []),
              ...(isMyVenue ? [{ id: 'gigs', label: 'My Gigs' }, { id: 'dashboard', label: 'Dashboard' }] : []),
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

        {/* ── Tab content ── */}
        {activeTab === 'overview' && (
          <OverviewTab
            venue={venue}
            isArtist={isArtist}
            isLoggedIn={!!user}
            onGoTimetable={() => setActiveTab('timetable')}
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
            isMobileLayout={isMobileLayout}
            isMyVenue={isMyVenue}
            gigsHosted={gigsHosted}
          />
        )}
        {activeTab === 'timetable' && (
          <TimetableTab
            venue={venue}
            isArtist={isArtist}
            isLoggedIn={!!user}
            userEnquiries={userEnquiries}
            isMobileLayout={isMobileLayout}
            isMyVenue={isMyVenue}
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
        {activeTab === 'rooms'     && <RoomsTab venue={venue} isArtist={isArtist} isLoggedIn={!!user} userId={user?.uid} />}
        {activeTab === 'photos'    && <PhotosTab venue={venue} />}
        {activeTab === 'gigs'      && isMyVenue && <MyGigsContent embedded />}
        {activeTab === 'dashboard' && isMyVenue && <DashboardContent />}

      </ScrollView>

      {/* Floating back button — mobile only (desktop uses the nav bar above) */}
      {!isProfileTab && (!isWeb || isMobileLayout) && (
        <SafeAreaView edges={['top']} style={s.backOverlayWrap} pointerEvents="box-none">
          <TouchableOpacity style={s.backOverlay} onPress={handleBack}>
            <Text style={s.backOverlayText}>← Back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </SafeAreaView>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────

/** Returns a {name, detail} pair for a single pay model for display in the What acts get card. */
function payModelDetail(model: string, terms: ReturnType<typeof resolveSlotTerms>): { name: string; detail: string } {
  if (model === 'Flat fee') {
    const min = parseFloat(terms.flatFeeMin);
    const max = parseFloat(terms.flatFeeMax);
    const basis = terms.flatFeeBasis || 'Per act';
    const basisLower = basis.toLowerCase();
    if (!isNaN(min) && !isNaN(max) && max > min) return { name: 'Flat fee', detail: `$${min}–$${max} ${basisLower}` };
    if (!isNaN(min)) return { name: 'Flat fee', detail: `$${min} ${basisLower}` };
    return { name: 'Flat fee', detail: '' };
  }
  if (model === 'Door split') return { name: 'Door split', detail: terms.doorSplit || '' };
  if (model === 'Guarantee + split') {
    const g = parseFloat(terms.guaranteeAmount);
    const sp = terms.guaranteeSplit;
    if (!isNaN(g) && sp) return { name: 'Guarantee + split', detail: `$${g} guarantee + ${sp}% split` };
    if (!isNaN(g)) return { name: 'Guarantee + split', detail: `$${g} guarantee + split` };
    return { name: 'Guarantee + split', detail: '' };
  }
  if (model === 'Bar split') return { name: 'Bar split', detail: terms.barSplit ? `${terms.barSplit}% of bar` : '' };
  if (model === 'Ticket split') return { name: 'Ticket split', detail: terms.ticketSplitPct ? `${terms.ticketSplitPct}% of tickets` : '' };
  if (model === 'Unpaid') {
    const perk = terms.drinks && terms.drinksDetails ? terms.drinksDetails : terms.drinks ? 'Drinks' : '';
    return { name: 'Unpaid', detail: perk };
  }
  return { name: model, detail: '' };
}

function OverviewTab({ venue, isArtist, isLoggedIn, onGoTimetable, onEnquire, isMobileLayout, isMyVenue = false, gigsHosted = 0 }: {
  venue: Venue; isArtist: boolean; isLoggedIn: boolean;
  onGoTimetable: () => void;
  onEnquire?: (slot: Slot, day: string, dateISO: string) => void;
  isMobileLayout: boolean; isMyVenue?: boolean; gigsHosted?: number;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const desc = venue.description || '';
  const shouldTruncate = desc.length > MAX_DESC;
  const showPay = isLoggedIn || !!venue.bookingTerms?.showPayPublicly;

  const terms = resolveSlotTerms(venue);

  const addBtn = (tab: string) => (
    <TouchableOpacity onPress={() => router.push(`/edit-venue?tab=${encodeURIComponent(tab)}` as any)} activeOpacity={0.75}>
      <Text style={{ color: Colors.orange, fontSize: 12, fontWeight: '700' }}>Add +</Text>
    </TouchableOpacity>
  );

  const hasVenueInfo = !!(
    (venue.phone && venue.showPhone) || venue.website || venue.instagram || venue.facebook
  );

  // ── Accessibility ──────────────────────────────────────────────────
  const ts = venue.techSpecs;
  const accessItems = [
    { label: 'Wheelchair access',   on: !!ts?.wheelchairAccess },
    { label: 'Accessible bathroom', on: !!ts?.accessibleBathroom },
    { label: 'Step-free stage',     on: !!ts?.stepFreeStage },
    { label: 'Accessible parking',  on: !!ts?.wheelchairParking },
  ];
  const hasAnyAccessData = typeof ts?.wheelchairAccess !== 'undefined'
    || typeof ts?.accessibleBathroom !== 'undefined'
    || typeof ts?.stepFreeStage !== 'undefined'
    || typeof ts?.wheelchairParking !== 'undefined';

  // ── What acts get ─────────────────────────────────────────────────
  const payModels = terms.payModels || [];
  const hasPayTerms = payModels.length > 0;
  const invoicingLabel = terms.invoicingMode === 'venueRCTI'
    ? 'The venue issues an RCTI'
    : 'Send the venue an invoice';

  const hospChips: string[] = [];
  if (isLoggedIn) {
    if (terms.guestList) hospChips.push(`Guest list · ${terms.guestList} per act`);
    if (terms.meals) hospChips.push(terms.mealsDetails || 'Meals provided');
    if (terms.drinks) hospChips.push(terms.drinksDetails || 'Drinks provided');
    if (venue.techSpecs?.soundEngineer) hospChips.push(
      venue.techSpecs.soundEngineerDetails
        ? `In-house engineer (${venue.techSpecs.soundEngineerDetails})`
        : 'In-house engineer, included'
    );
  }

  // ── Next open dates (aside) ────────────────────────────────────────
  const nextOpenDates = generateAllUpcoming(venue, 2)
    .filter(({ slot }) => slot.status === 'open')
    .slice(0, 3);

  // ── Link display helpers ───────────────────────────────────────────
  function displayUrl(url: string): string {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
  function displayInsta(raw: string): string {
    return raw.startsWith('http') ? raw.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '') : raw.startsWith('@') ? raw : `@${raw}`;
  }
  function displayFb(raw: string): string {
    if (raw.startsWith('http')) return '/' + raw.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, '');
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  // ── Maps link ─────────────────────────────────────────────────────
  const openMaps = () => {
    const addr = encodeURIComponent([venue.streetAddress, venue.suburb, venue.state].filter(Boolean).join(', '));
    Linking.openURL(`https://maps.google.com/?q=${addr}`);
  };

  // ── Aside ─────────────────────────────────────────────────────────
  const aside = (
    <View style={!isMobileLayout ? ov.aside : ov.asideMobile}>

      {/* Next open dates */}
      {nextOpenDates.length > 0 && (
        <View style={[ov.asideCard, { borderColor: colors.border }]}>
          <View style={ov.asideCardHeader}>
            <Text style={[ov.asideCardTitle, { color: colors.black }]}>Next open dates</Text>
            <TouchableOpacity onPress={onGoTimetable} activeOpacity={0.7}>
              <Text style={ov.asideAllLink}>All dates</Text>
            </TouchableOpacity>
          </View>
          {nextOpenDates.map(({ date, dateISO, day, slot }, i) => {
            const monthAbbr = SHORT_MONTHS[date.getMonth()];
            const metaParts = [monthAbbr, slot.time, slot.room].filter(Boolean).join(' · ');
            return (
              <View key={`${dateISO}-${i}`} style={[ov.nextDateRow, { borderTopColor: colors.border }]}>
                <View style={ov.nextDateBlock}>
                  <Text style={[ov.nextDateDay, { color: colors.grey }]}>{day.slice(0,3).toUpperCase()}</Text>
                  <Text style={[ov.nextDateNum, { color: colors.black }]}>{date.getDate()}</Text>
                </View>
                <View style={ov.nextDateInfo}>
                  {(slot.name || slot.gigName) ? (
                    <Text style={[ov.nextDateName, { color: colors.black }]} numberOfLines={1}>
                      {slot.name || slot.gigName}
                    </Text>
                  ) : null}
                  <Text style={[ov.nextDateMeta, { color: colors.grey }]} numberOfLines={1}>{metaParts}</Text>
                </View>
                {onEnquire && (isArtist || !isLoggedIn) && !isMyVenue ? (
                  <TouchableOpacity
                    style={ov.nextDateEnquireBtn}
                    onPress={() => onEnquire(slot, day, dateISO)}
                    activeOpacity={0.85}
                  >
                    <Text style={ov.nextDateEnquireBtnText}>Enquire</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Links */}
      {hasVenueInfo && (
        <View style={[ov.asideCard, { borderColor: colors.border }]}>
          {venue.website ? (
            <TouchableOpacity style={ov.linkRow} onPress={() => Linking.openURL(venue.website!)} activeOpacity={0.7}>
              <Text style={[ov.linkLabel, { color: colors.grey }]}>Website</Text>
              <Text style={[ov.linkValue, { color: colors.black }]} numberOfLines={1}>{displayUrl(venue.website)}</Text>
            </TouchableOpacity>
          ) : null}
          {venue.instagram ? (
            <TouchableOpacity style={[ov.linkRow, { borderTopWidth: venue.website ? 1 : 0, borderTopColor: colors.border }]} onPress={() => {
              const raw = venue.instagram!;
              const url = raw.startsWith('http') ? raw : `https://www.instagram.com/${raw.replace(/^@/, '')}`;
              Linking.openURL(url);
            }} activeOpacity={0.7}>
              <Text style={[ov.linkLabel, { color: colors.grey }]}>Instagram</Text>
              <Text style={[ov.linkValue, { color: colors.black }]} numberOfLines={1}>{displayInsta(venue.instagram)}</Text>
            </TouchableOpacity>
          ) : null}
          {venue.facebook ? (
            <TouchableOpacity style={[ov.linkRow, { borderTopWidth: (venue.website || venue.instagram) ? 1 : 0, borderTopColor: colors.border }]} onPress={() => Linking.openURL(venue.facebook!)} activeOpacity={0.7}>
              <Text style={[ov.linkLabel, { color: colors.grey }]}>Facebook</Text>
              <Text style={[ov.linkValue, { color: colors.black }]} numberOfLines={1}>{displayFb(venue.facebook)}</Text>
            </TouchableOpacity>
          ) : null}
          {venue.phone && venue.showPhone ? (
            <TouchableOpacity style={[ov.linkRow, { borderTopWidth: (venue.website || venue.instagram || venue.facebook) ? 1 : 0, borderTopColor: colors.border }]} onPress={() => Linking.openURL(`tel:${venue.phone}`)} activeOpacity={0.7}>
              <Text style={[ov.linkLabel, { color: colors.grey }]}>Phone</Text>
              <Text style={[ov.linkValue, { color: colors.black }]} numberOfLines={1}>{venue.phone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Note */}
      <Text style={[ov.noteText, { color: colors.grey }]}>
        Questions before you enquire? Message the venue. Booking details are shared once a gig is confirmed.
      </Text>
    </View>
  );

  const main = (
    <View style={!isMobileLayout ? ov.main : null}>

      {/* About */}
      {(desc || isMyVenue) && (
        <View style={ov.section}>
          <View style={ov.sectionHead}>
            <Text style={[ov.sectionHeading, { color: colors.black }]}>About</Text>
            {isMyVenue && !desc && addBtn('Basic Info')}
          </View>
          {desc ? (
            <>
              <Text style={[ov.body, { color: colors.black }]}>
                {shouldTruncate && !expanded ? desc.slice(0, MAX_DESC) + '...' : desc}
              </Text>
              {shouldTruncate && (
                <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ marginTop: 6 }}>
                  <Text style={ov.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : null}
        </View>
      )}

      {/* What acts get */}
      {(hasPayTerms || hospChips.length > 0 || isMyVenue) && (
        <View style={ov.section}>
          <View style={ov.sectionHead}>
            <Text style={[ov.sectionHeading, { color: colors.black }]}>What acts get</Text>
            {isMyVenue && !hasPayTerms && addBtn('Payments')}
          </View>
          <Text style={[ov.sectionSubheading, { color: colors.grey }]}>
            The venue's standard deal. Some nights have their own terms, shown on each date.
          </Text>
          <View style={[ov.termsCard, { borderColor: colors.border }]}>

            {/* Pay */}
            {(hasPayTerms || isMyVenue) && (
              <View style={[ov.termsRow, { borderBottomColor: colors.border }]}>
                <Text style={[ov.termsLabel, { color: colors.grey }]}>Pay</Text>
                <View style={{ flex: 1, gap: 6 }}>
                  {showPay && hasPayTerms ? (
                    <>
                      {payModels.map((model, i) => {
                        const { name, detail } = payModelDetail(model, terms);
                        return (
                          <View key={i} style={ov.payModelRow}>
                            <Text style={[ov.termsValue, { color: colors.black }]}>{name}</Text>
                            {detail ? <Text style={[ov.payModelDetail, { color: colors.grey }]}>{detail}</Text> : null}
                          </View>
                        );
                      })}
                      {terms.negotiable && (
                        <View style={[ov.negotiableBadge, { borderColor: '#2F7A4B' }]}>
                          <Text style={[ov.negotiableBadgeText, { color: '#2F7A4B' }]}>Open to negotiation</Text>
                        </View>
                      )}
                    </>
                  ) : !showPay ? (
                    <Text style={[ov.termsValue, { color: colors.grey, fontStyle: 'italic' }]}>Sign in to see pay details</Text>
                  ) : (
                    <Text style={[ov.termsValue, { color: colors.grey }]}>Not specified</Text>
                  )}
                </View>
              </View>
            )}

            {/* Getting paid */}
            {isLoggedIn && (terms.paymentTiming || (terms.methods?.length ?? 0) > 0 || terms.depositRequired) && (
              <View style={[ov.termsRow, { borderBottomColor: colors.border }]}>
                <Text style={[ov.termsLabel, { color: colors.grey }]}>Getting paid</Text>
                <View style={{ flex: 1, gap: 3 }}>
                  {(terms.paymentTiming || (terms.methods?.length ?? 0) > 0) && (
                    <Text style={[ov.termsValue, { color: colors.black }]}>
                      {[terms.paymentTiming, terms.methods?.join(' or ')].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                  <Text style={[ov.termsValue, { color: colors.black }]}>
                    {invoicingLabel}{terms.reqAbn ? '. An ABN is required.' : '.'}
                  </Text>
                  {terms.depositRequired && terms.depositAmount && (
                    <Text style={[ov.termsValue, { color: colors.black }]}>
                      ${terms.depositAmount} deposit{terms.depositDue ? `, due ${terms.depositDue}` : ''}.
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Hospitality */}
            {isLoggedIn && hospChips.length > 0 && (
              <View style={[ov.termsRow, { borderBottomColor: 'transparent' }]}>
                <Text style={[ov.termsLabel, { color: colors.grey }]}>Hospitality</Text>
                <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {hospChips.map((chip, i) => (
                    <View key={i} style={[ov.hospChip, { borderColor: colors.border }]}>
                      <Text style={[ov.hospChipText, { color: colors.black }]}>{chip}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

          </View>
        </View>
      )}

      {/* Accessibility */}
      {hasAnyAccessData && (
        <View style={ov.section}>
          <Text style={[ov.sectionHeading, { color: colors.black }]}>Accessibility</Text>
          <Text style={[ov.sectionSubheading, { color: colors.grey, marginTop: 4 }]}>For performers and audiences.</Text>
          <View style={ov.accessGrid}>
            {accessItems.map(item => (
              <View key={item.label} style={ov.accessItem}>
                <View style={[ov.accessIconWrap, { backgroundColor: item.on ? '#F0FAF4' : '#FEF3EE' }]}>
                  <Text style={[ov.accessIcon, { color: item.on ? '#2F7A4B' : '#9A3B06' }]}>
                    {item.on ? '✓' : '✕'}
                  </Text>
                </View>
                <Text style={[ov.accessLabel, { color: item.on ? colors.black : colors.grey }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Location */}
      {(venue.streetAddress || venue.suburb) && (
        <View style={[ov.section, { marginBottom: 0 }]}>
          {/* Map placeholder */}
          <View style={[ov.mapPlaceholder, { backgroundColor: colors.border }]}>
            <View style={ov.mapPin}>
              <View style={ov.mapPinHead} />
              <View style={ov.mapPinTail} />
            </View>
          </View>
          {/* Address row */}
          <View style={[ov.locationRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[ov.locationAddress, { color: colors.black }]}>
                {[venue.streetAddress, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(', ')}
              </Text>
              {(ts?.loadIn || ts?.loadInParking) ? (
                <Text style={[ov.locationMeta, { color: colors.grey }]}>
                  {ts.loadIn || ts.loadInParking}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={openMaps} activeOpacity={0.7} style={{ flexShrink: 0 }}>
              <Text style={ov.mapsLink}>Open in Maps</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isMobileLayout && (
        <TouchableOpacity style={[s.timetableBtn, { marginTop: 24 }]} onPress={onGoTimetable}>
          <Text style={s.timetableBtnText}>See open dates</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={[s.tabBody, !isMobileLayout && ov.layout]}>
      {main}
      {aside}
    </View>
  );
}

const ov = StyleSheet.create({
  layout:             { flexDirection: 'row', alignItems: 'flex-start', gap: 40 },
  main:               { flex: 1 },
  aside:              { width: 260, gap: 14, flexShrink: 0 },
  asideMobile:        { gap: 14, marginTop: 24 },
  section:            { marginBottom: 28 },
  sectionHead:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionHeading:     { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  sectionSubheading:  { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  body:               { fontSize: 15, lineHeight: 24 },
  readMore:           { fontSize: 14, color: Colors.orange, fontWeight: '600' },
  // What acts get
  termsCard:          { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  termsRow:           { flexDirection: 'row', gap: 16, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1 },
  termsLabel:         { width: 96, fontSize: 13, fontWeight: '600', flexShrink: 0, paddingTop: 1 },
  termsValue:         { fontSize: 14, lineHeight: 21 },
  payModelRow:        { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  payModelDetail:     { fontSize: 13, textAlign: 'right' as const, flex: 1 },
  negotiableBadge:    { alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  negotiableBadgeText:{ fontSize: 12, fontWeight: '600' },
  hospChip:           { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  hospChipText:       { fontSize: 13, fontWeight: '500' },
  // Accessibility
  accessGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  accessItem:         { flexDirection: 'row', alignItems: 'center', gap: 8, width: '48%' as any, minWidth: 160 },
  accessIconWrap:     { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  accessIcon:         { fontSize: 12, fontWeight: '800' },
  accessLabel:        { fontSize: 14, flex: 1 },
  // Location
  mapPlaceholder:     { height: 180, borderRadius: 12, marginBottom: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mapPin:             { alignItems: 'center' },
  mapPinHead:         { width: 20, height: 20, borderRadius: 10, backgroundColor: '#16161A' },
  mapPinTail:         { width: 2, height: 10, backgroundColor: '#16161A', marginTop: -2 },
  locationRow:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: 16, gap: 12 },
  locationAddress:    { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  locationMeta:       { fontSize: 13, lineHeight: 19 },
  mapsLink:           { fontSize: 13, fontWeight: '600', color: Colors.orange, textDecorationLine: 'underline' as const },
  // Aside card
  asideCard:          { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  asideCardHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  asideCardTitle:     { fontSize: 14, fontWeight: '700' },
  asideAllLink:       { fontSize: 13, fontWeight: '600', color: Colors.orange, textDecorationLine: 'underline' as const },
  // Next open dates rows
  nextDateRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, gap: 10 },
  nextDateBlock:      { width: 30, alignItems: 'center', flexShrink: 0 },
  nextDateDay:        { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' as const },
  nextDateNum:        { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  nextDateInfo:       { flex: 1, gap: 1 },
  nextDateName:       { fontSize: 13, fontWeight: '600' },
  nextDateMeta:       { fontSize: 12 },
  nextDateEnquireBtn: { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0 },
  nextDateEnquireBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  // Links
  linkRow:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, gap: 8 },
  linkLabel:          { fontSize: 14, fontWeight: '500', width: 72, flexShrink: 0 },
  linkValue:          { flex: 1, fontSize: 13, textAlign: 'right' as const },
  // Note
  noteText:           { fontSize: 13, lineHeight: 20 },
});

// ── Timetable tab ────────────────────────────────────────────────────

function TimetableTab({ venue, isArtist, isLoggedIn, userEnquiries, onEnquire, isMobileLayout, isMyVenue = false }: {
  venue: Venue;
  isArtist: boolean;
  isLoggedIn: boolean;
  userEnquiries: Enquiry[];
  onEnquire: (slot: Slot, day: string, dateISO: string) => void;
  isMobileLayout: boolean;
  isMyVenue?: boolean;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const today = new Date();

  // Web state
  const [filterTab, setFilterTab] = useState<'open' | 'all' | 'mine'>('open');

  // Native state
  const [nativeFilter, setNativeFilter] = useState<'open' | 'all' | 'mine'>('open');
  const [nativeMonthOffset, setNativeMonthOffset] = useState(0);

  const [monthOffset, setMonthOffset] = useState(0);

  // Per-occurrence override modal
  const [overrideModal, setOverrideModal] = useState<{ slot: Slot; day: string; dateISO: string; date: Date } | null>(null);

  if (!isMobileLayout) {
    const allUpcoming = generateAllUpcoming(venue, 3, monthOffset);

    const matchEnquiry = (enq: Enquiry, day: string, time: string, dateISO: string) =>
      enq.status !== 'declined' && enq.status !== 'cancelled' &&
      enq.requestedSlot?.day === day && enq.requestedSlot?.time === time &&
      inferSlotDate(enq) === dateISO;

    const hasEnquiryFor = (day: string, time: string, dateISO: string) =>
      userEnquiries.some(e => matchEnquiry(e, day, time, dateISO));

    const filtered = allUpcoming.filter(({ day, dateISO, slot }) => {
      if (!isMyVenue && slot.status === 'closed') return false;
      if (filterTab === 'open') return (slot.status === 'open' || (isMyVenue && slot.status === 'closed')) && !hasEnquiryFor(day, slot.time, dateISO);
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
      <>
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
              allUpcoming.length === 0 && isMyVenue ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={[lv.emptyText, { color: colors.grey }]}>No slots added yet.</Text>
                  <TouchableOpacity onPress={() => router.push('/edit-venue?tab=Timetable' as any)} activeOpacity={0.75}>
                    <Text style={{ color: Colors.orange, fontSize: 13, fontWeight: '700' }}>Add +</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[lv.emptyText, { color: colors.grey }]}>No slots to show.</Text>
              )
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
                        isMyVenue={isMyVenue}
                        onVenueEdit={(s, d, iso) => setOverrideModal({ slot: s, day: d, dateISO: iso, date })}
                        venue={venue}
                      />
                    ))}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </View>
      {overrideModal && (
        <SlotOverrideModal
          slot={overrideModal.slot}
          day={overrideModal.day}
          dateISO={overrideModal.dateISO}
          venueId={venue.id}
          allSlots={venue.slots ?? {}}
          onClose={() => setOverrideModal(null)}
        />
      )}
      </>
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
    if (!isMyVenue && slot.status === 'closed') return false;
    if (nativeFilter === 'open') return (slot.status === 'open' || (isMyVenue && slot.status === 'closed')) && !hasEnquiryForNative(day, slot.time, dateISO);
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
    <>
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
        {nativeMonthGroups.length === 0 ? (
          allUpcomingNative.length === 0 && isMyVenue ? (
            <View style={[s.noSlots, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <Text style={[s.noSlotsText, { color: colors.grey }]}>No slots added yet.</Text>
              <TouchableOpacity onPress={() => router.push('/edit-venue?tab=Timetable' as any)} activeOpacity={0.75}>
                <Text style={{ color: Colors.orange, fontSize: 13, fontWeight: '700' }}>Add +</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.noSlots}><Text style={[s.noSlotsText, { color: colors.grey }]}>No slots to show.</Text></View>
          )
        ) : nativeMonthGroups.map(group => (
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
                      isMyVenue={isMyVenue}
                      onVenueEdit={(s, d, iso) => setOverrideModal({ slot: s, day: d, dateISO: iso, date })}
                      colors={colors}
                      venue={venue}
                    />
                  );
                })}
              </View>
            ))
        }
      </View>
    </View>
    {overrideModal && (
      <SlotOverrideModal
        slot={overrideModal.slot}
        day={overrideModal.day}
        dateISO={overrideModal.dateISO}
        venueId={venue.id}
        allSlots={venue.slots ?? {}}
        onClose={() => setOverrideModal(null)}
      />
    )}
    </>
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

function AllDatesSlotRow({ slot, date, dateISO, day, isArtist, isLoggedIn, hasEnquired, onEnquire, isMyVenue, onVenueEdit, colors, venue }: {
  slot: Slot; date: Date; dateISO: string; day: string;
  isArtist: boolean; isLoggedIn: boolean; hasEnquired: boolean;
  onEnquire: () => void;
  isMyVenue?: boolean;
  onVenueEdit?: (slot: Slot, day: string, dateISO: string) => void;
  colors: any;
  venue: Venue;
}) {
  const [expanded, setExpanded] = useState(false);
  const isBooked = slot.status === 'booked';
  const isOpen   = slot.status === 'open';
  const isClosed = slot.status === 'closed';

  const terms = resolveSlotTerms(venue, slot);
  const paySummary = formatPaySummary(terms);

  const metaParts = [
    slot.time,
    slot.duration ? `${slot.duration} min sets` : null,
    slot.room,
  ].filter(Boolean).join(' · ');

  // Expanded timings
  const timingLines: string[] = [];
  if (slot.loadIn) {
    timingLines.push(`Load-in ${slot.loadIn}${slot.soundcheck ? ' · Soundcheck' : ''}`);
  } else if (slot.soundcheck) {
    timingLines.push('Soundcheck');
  }
  if (slot.soundcheckDetails) timingLines.push(slot.soundcheckDetails);
  timingLines.push([`On stage ${slot.time}`, slot.duration ? `for ${slot.duration} min sets` : null].filter(Boolean).join(' '));

  // What you get
  const whatParts = [
    terms.guestList ? `Guest list · ${terms.guestList}` : null,
    terms.meals ? (terms.mealsDetails || 'Meals') : null,
    terms.drinks ? (terms.drinksDetails || 'Drinks') : null,
  ].filter(Boolean);
  const whatYouGet = whatParts.length > 0 ? whatParts.join(', ') : null;

  const bookBy = terms.minNotice && terms.minNotice !== '0' ? terms.minNotice : 'No minimum notice';

  let leftBorderColor: string;
  let badgeLabel: string;
  let badgeTextColor: string;
  let badgeBorderColor: string;

  if (isClosed) {
    leftBorderColor = colors.border; badgeLabel = 'Closed'; badgeTextColor = colors.grey; badgeBorderColor = colors.border;
  } else if (hasEnquired) {
    leftBorderColor = '#22c55e'; badgeLabel = 'Enquiry sent'; badgeTextColor = '#16a34a'; badgeBorderColor = '#22c55e';
  } else if (isBooked) {
    leftBorderColor = '#e0e0e0'; badgeLabel = 'Booked'; badgeTextColor = '#888888'; badgeBorderColor = '#e0e0e0';
  } else {
    leftBorderColor = Colors.orange; badgeLabel = 'Open'; badgeTextColor = Colors.orange; badgeBorderColor = Colors.orange;
  }

  const showDetails = isOpen && !isClosed;

  return (
    <View style={[ad.card, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: isClosed ? colors.bgFaint : colors.bg, opacity: isClosed ? 0.7 : 1 }]}>
      {/* Top row */}
      <View style={ad.top}>
        <View style={ad.dateBlock}>
          <Text style={[ad.dateBlockDay, { color: colors.grey }]}>{day.slice(0, 3).toUpperCase()}</Text>
          <Text style={[ad.dateBlockNum, { color: colors.black }]}>{date.getDate()}</Text>
        </View>
        <View style={ad.slotInfo}>
          <View style={ad.nameRow}>
            {(slot.name || slot.gigName) ? (
              <Text style={[ad.slotName, { color: isClosed ? colors.grey : colors.black }]} numberOfLines={1}>
                {slot.name || slot.gigName}
              </Text>
            ) : null}
            {slot.slotType ? (
              <View style={[ad.typePill, { borderColor: colors.border }]}>
                <Text style={[ad.typeText, { color: colors.grey }]}>{slot.slotType}</Text>
              </View>
            ) : null}
          </View>
          {metaParts ? <Text style={[ad.metaText, { color: colors.grey }]}>{metaParts}</Text> : null}
          {paySummary ? <Text style={[ad.payText, { color: colors.grey }]}>{paySummary}</Text> : null}
        </View>
        <View style={ad.actions}>
          {showDetails && !isMyVenue && (
            <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
              <Text style={ad.detailsLink}>{expanded ? 'Hide details' : 'Details'}</Text>
            </TouchableOpacity>
          )}
          {hasEnquired && !isMyVenue && (
            <View style={[ad.badge, { borderColor: badgeBorderColor }]}>
              <Text style={[ad.badgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
            </View>
          )}
          {!isOpen && !isMyVenue && !hasEnquired && (
            <View style={[ad.badge, { borderColor: badgeBorderColor }]}>
              <Text style={[ad.badgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
            </View>
          )}
          {isMyVenue && (
            <TouchableOpacity style={ad.editBtn} onPress={() => onVenueEdit?.(slot, day, dateISO)} activeOpacity={0.75}>
              <Text style={ad.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
          {isOpen && !hasEnquired && isArtist && !isMyVenue && (
            <TouchableOpacity style={ad.enquireBtn} onPress={onEnquire}>
              <Text style={ad.enquireBtnText}>Enquire</Text>
            </TouchableOpacity>
          )}
          {isOpen && !hasEnquired && !isLoggedIn && !isMyVenue && (
            <TouchableOpacity style={[ad.enquireBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.orange }]} onPress={onEnquire}>
              <Text style={[ad.enquireBtnText, { color: Colors.orange }]}>Log in</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Expanded details panel */}
      {expanded && (
        <View style={[ad.detailsPanel, { borderTopColor: colors.border }]}>
          <View style={ad.detailsGrid}>
            <View style={ad.detailsCol}>
              <Text style={[ad.detailsLabel, { color: colors.grey }]}>Timings</Text>
              {timingLines.map((line, i) => (
                <Text key={i} style={[ad.detailsValue, { color: colors.black }]}>{line}</Text>
              ))}
            </View>
            <View style={ad.detailsCol}>
              <Text style={[ad.detailsLabel, { color: colors.grey }]}>Pay</Text>
              <Text style={[ad.detailsValue, { color: colors.black }]}>{paySummary || 'Not specified'}</Text>
            </View>
            <View style={ad.detailsCol}>
              <Text style={[ad.detailsLabel, { color: colors.grey }]}>What you get</Text>
              <Text style={[ad.detailsValue, { color: colors.black }]}>{whatYouGet || 'Nothing listed'}</Text>
            </View>
            <View style={ad.detailsCol}>
              <Text style={[ad.detailsLabel, { color: colors.grey }]}>Book by</Text>
              <Text style={[ad.detailsValue, { color: colors.black }]}>{bookBy}</Text>
            </View>
          </View>
          {slot.notes ? (
            <View style={[ad.detailsNotes, { borderTopColor: colors.border }]}>
              <Text style={[ad.detailsNotesLabel, { color: colors.grey }]}>Notes from the venue</Text>
              <Text style={[ad.detailsNotesText, { color: colors.black }]}>{slot.notes}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const ad = StyleSheet.create({
  card:           { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  top:            { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  dateBlock:      { width: 36, alignItems: 'center', flexShrink: 0, paddingTop: 2 },
  dateBlockDay:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  dateBlockNum:   { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  slotInfo:       { flex: 1, gap: 3 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  slotName:       { fontSize: 15, fontWeight: '700' },
  typePill:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  typeText:       { fontSize: 11, fontWeight: '600' },
  metaText:       { fontSize: 13 },
  payText:        { fontSize: 13 },
  actions:        { flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 },
  detailsLink:    { fontSize: 13, fontWeight: '600', color: '#16161A', textDecorationLine: 'underline' as const },
  enquireBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  enquireBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  badge:          { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText:      { fontSize: 11, fontWeight: '600' },
  editBtn:        { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  editBtnText:    { fontSize: 12, fontWeight: '600', color: '#555555' },
  // Expanded panel
  detailsPanel:   { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 16, gap: 16 },
  detailsGrid:    { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 16 },
  detailsCol:     { minWidth: '40%' as any, flex: 1, gap: 4 },
  detailsLabel:   { fontSize: 12, fontWeight: '600' },
  detailsValue:   { fontSize: 14, lineHeight: 21 },
  detailsNotes:   { borderTopWidth: 1, paddingTop: 14, gap: 4 },
  detailsNotesLabel: { fontSize: 12, fontWeight: '600' },
  detailsNotesText:  { fontSize: 14, lineHeight: 21 },
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

// ── Inline chip group for the override modal ─────────────────────────

function OverrideChips({ options, value, onSelect, multi }: {
  options: string[]; value: string | string[];
  onSelect: (v: any) => void; multi?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const active = multi ? (value as string[]).includes(opt) : value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[
              som.chip,
              active ? { backgroundColor: Colors.orange, borderColor: Colors.orange } : { borderColor: colors.border },
            ]}
            onPress={() => {
              if (multi) {
                const arr = (value as string[]) || [];
                onSelect(active ? arr.filter(x => x !== opt) : [...arr, opt]);
              } else {
                onSelect(active ? '' : opt);
              }
            }}
            activeOpacity={0.75}
          >
            <Text style={[som.chipText, { color: active ? '#111111' : colors.grey }]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Slot override modal (venue owner) ────────────────────────────────

const OVERRIDE_GENRES    = ['Rock','Indie','Pop','Punk','Metal','Jazz','Blues','Soul / R&B','Funk','Hip-hop','Electronic','Country','Folk','Reggae','Classical','Other'];
const OVERRIDE_SLOT_TYPES = ['Headline','Support','Either','Open Mic','Residency'];
const OVERRIDE_DURATIONS  = ['30 min','45 min','60 min','90 min','120 min'];
const OVERRIDE_PAY_MODELS = ['Flat fee','Door split','Guarantee + split','Bar split','Ticket split','Unpaid'];

function SlotOverrideModal({ slot, day, dateISO, venueId, allSlots, onClose }: {
  slot: Slot; day: string; dateISO: string;
  venueId: string; allSlots: Record<string, Slot[]>;
  onClose: () => void;
}) {
  const { colors } = useTheme();

  const [isClosed,      setIsClosed]      = useState(slot.status === 'closed');
  const [time,          setTime]          = useState(slot.time || '');
  const [name,          setName]          = useState(slot.name || '');
  const [slotType,      setSlotType]      = useState(slot.slotType || '');
  const [durationStr,   setDurationStr]   = useState(
    slot.duration ? (OVERRIDE_DURATIONS.find(o => parseInt(o) === slot.duration) || `${slot.duration} min`) : ''
  );
  const [feeMin,        setFeeMin]        = useState(slot.feeMin != null ? String(slot.feeMin) : '');
  const [feeMax,        setFeeMax]        = useState(slot.feeMax != null ? String(slot.feeMax) : '');
  const [payModels,     setPayModels]     = useState<string[]>(
    slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : [])
  );
  const [genres,        setGenres]        = useState<string[]>(slot.genres || []);
  const [notes,         setNotes]         = useState(slot.notes || '');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  const d = new Date(dateISO + 'T00:00:00');
  const displayDate = `${day}, ${d.getDate()} ${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  const normStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const daySlots: Slot[] = [...(allSlots[day] || [])];
      const existingIdx = daySlots.findIndex(
        s => s.date === dateISO && normStr(s.time) === normStr(slot.time)
      );

      const parsedDuration = durationStr ? parseInt(durationStr) : undefined;
      const parsedFeeMin   = feeMin.trim() ? Number(feeMin.trim()) : undefined;
      const parsedFeeMax   = feeMax.trim() ? Number(feeMax.trim()) : undefined;

      const override: Slot = {
        ...slot,
        id: slot.id ? `${slot.id}_${dateISO}` : `override_${dateISO}_${normStr(slot.time)}`,
        date: dateISO,
        status:         isClosed ? 'closed' : 'open',
        time:           time.trim() || slot.time,
        ...(name.trim()            ? { name: name.trim() }                   : {}),
        ...(slotType               ? { slotType }                             : {}),
        ...(parsedDuration         ? { duration: parsedDuration }             : {}),
        ...(parsedFeeMin != null   ? { feeMin: parsedFeeMin }                 : {}),
        ...(parsedFeeMax != null   ? { feeMax: parsedFeeMax }                 : {}),
        ...(payModels.length       ? { paymentModels: payModels, paymentModel: '' } : {}),
        ...(genres.length          ? { genres }                               : {}),
        ...(notes.trim()           ? { notes: notes.trim() }                  : {}),
      };
      if (!override.name)    delete override.name;
      if (!override.notes)   delete override.notes;

      if (existingIdx >= 0) {
        daySlots[existingIdx] = override;
      } else {
        daySlots.push(override);
      }

      await updateDoc(doc(db, 'venues', venueId), { [`slots.${day}`]: daySlots });
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const FieldLabel = ({ label }: { label: string }) => (
    <Text style={[som.fieldLabel, { color: colors.grey }]}>{label}</Text>
  );

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={som.backdrop}>
          <View style={[som.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>

            {/* Header */}
            <View style={som.header}>
              <View>
                <Text style={[som.title, { color: colors.black }]}>Edit for this date</Text>
                <Text style={[som.subtitle, { color: colors.grey }]}>{displayDate}</Text>
              </View>
              <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={som.closeBtn}>
                <Text style={[som.closeBtnText, { color: colors.grey }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Recurring slot context */}
            <View style={[som.slotInfo, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[som.slotInfoLabel, { color: colors.grey }]}>Recurring slot</Text>
              <Text style={[som.slotTime, { color: colors.black }]}>{slot.time}</Text>
              {slot.room ? <Text style={[som.slotRoom, { color: colors.grey }]}> · {slot.room}</Text> : null}
            </View>

            <ScrollView style={som.scrollArea} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Availability */}
              <View style={[som.section, { borderColor: colors.border }]}>
                <FieldLabel label="AVAILABILITY" />
                <View style={som.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[som.toggleLabel, { color: colors.black }]}>
                      {isClosed ? 'Closed for this date' : 'Open for this date'}
                    </Text>
                    <Text style={[som.toggleSub, { color: colors.grey }]}>
                      {isClosed ? 'Hidden from artists.' : 'Artists can enquire.'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[som.toggle, isClosed ? som.toggleOff : som.toggleOn]}
                    onPress={() => setIsClosed(v => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={[som.toggleThumb, isClosed ? { marginLeft: 2 } : { marginLeft: 22 }]} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Start time */}
              <View style={som.field}>
                <FieldLabel label="START TIME" />
                <TextInput
                  style={[som.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
                  value={time}
                  onChangeText={setTime}
                  placeholder={slot.time}
                  placeholderTextColor={colors.grey}
                />
              </View>

              {/* Slot name */}
              <View style={som.field}>
                <FieldLabel label="SLOT NAME (optional)" />
                <TextInput
                  style={[som.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. New Year's Eve Special"
                  placeholderTextColor={colors.grey}
                />
              </View>

              {/* Slot type */}
              <View style={som.field}>
                <FieldLabel label="SLOT TYPE" />
                <OverrideChips options={OVERRIDE_SLOT_TYPES} value={slotType} onSelect={setSlotType} />
              </View>

              {/* Duration */}
              <View style={som.field}>
                <FieldLabel label="SET LENGTH" />
                <OverrideChips options={OVERRIDE_DURATIONS} value={durationStr} onSelect={setDurationStr} />
              </View>

              {/* Fee */}
              <View style={som.field}>
                <FieldLabel label="FEE" />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[som.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
                      value={feeMin}
                      onChangeText={setFeeMin}
                      placeholder="Min $"
                      placeholderTextColor={colors.grey}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[som.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
                      value={feeMax}
                      onChangeText={setFeeMax}
                      placeholder="Max $"
                      placeholderTextColor={colors.grey}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </View>

              {/* Payment model */}
              <View style={som.field}>
                <FieldLabel label="PAYMENT MODEL" />
                <OverrideChips options={OVERRIDE_PAY_MODELS} value={payModels} onSelect={setPayModels} multi />
              </View>

              {/* Genres */}
              <View style={som.field}>
                <FieldLabel label="GENRES FOR THIS DATE" />
                <OverrideChips options={OVERRIDE_GENRES} value={genres} onSelect={setGenres} multi />
              </View>

              {/* Notes */}
              <View style={som.field}>
                <FieldLabel label="NOTES FOR THIS DATE" />
                <TextInput
                  style={[som.textarea, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Anything specific artists should know about this date"
                  placeholderTextColor={colors.grey}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {error ? <Text style={som.errorText}>{error}</Text> : null}

              <View style={som.actions}>
                <TouchableOpacity
                  style={[som.cancelBtn, { borderColor: colors.border }]}
                  onPress={onClose}
                  disabled={saving}
                  activeOpacity={0.7}
                >
                  <Text style={[som.cancelBtnText, { color: colors.grey }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[som.saveBtn, saving && { opacity: 0.5 }]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  {saving
                    ? <ActivityIndicator color="#111111" size="small" />
                    : <Text style={som.saveBtnText}>Save for this date</Text>}
                </TouchableOpacity>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const som = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:        { width: '100%', maxWidth: 480, borderRadius: 16, borderWidth: 1, maxHeight: '88%', overflow: 'hidden' },
  header:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 20, paddingBottom: 12 },
  title:        { fontSize: 17, fontWeight: '800' },
  subtitle:     { fontSize: 13, marginTop: 2 },
  closeBtn:     { padding: 4 },
  closeBtnText: { fontSize: 18, lineHeight: 20 },
  slotInfo:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 4, borderTopWidth: 1, borderBottomWidth: 1 },
  slotInfoLabel:{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 },
  slotTime:     { fontSize: 13, fontWeight: '700' },
  slotRoom:     { fontSize: 13 },
  scrollArea:   { paddingHorizontal: 20 },
  section:      { borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 16 },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  toggleLabel:  { fontSize: 14, fontWeight: '600' },
  toggleSub:    { fontSize: 12, marginTop: 2 },
  toggle:       { width: 46, height: 26, borderRadius: 13, justifyContent: 'center' },
  toggleOn:     { backgroundColor: Colors.orange },
  toggleOff:    { backgroundColor: '#d1d5db' },
  toggleThumb:  { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' },
  field:        { marginTop: 16 },
  fieldLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  input:        { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea:     { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 72, textAlignVertical: 'top' },
  chip:         { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:     { fontSize: 13, fontWeight: '600' },
  errorText:    { color: '#ef4444', fontSize: 13, marginTop: 12 },
  actions:      { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn:    { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '600' },
  saveBtn:      { flex: 2, backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveBtnText:  { fontSize: 14, fontWeight: '700', color: '#111111' },
});

// ── List view slot row (web) ───────────────────────────────────────────

function LvSlotRow({ slot, date, dateISO, day, isArtist, isLoggedIn, userEnquiries, onEnquire, isMyVenue, onVenueEdit, venue }: {
  slot: Slot; date: Date; dateISO: string; day: string;
  isArtist: boolean; isLoggedIn: boolean;
  userEnquiries: Enquiry[];
  onEnquire: (s: Slot, d: string, date: string) => void;
  isMyVenue?: boolean;
  onVenueEdit?: (slot: Slot, day: string, dateISO: string) => void;
  venue: Venue;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const matchesSlot = (e: Enquiry) =>
    e.requestedSlot?.day === day && e.requestedSlot?.time === slot.time && inferSlotDate(e) === dateISO;

  const activeEnquiry = userEnquiries.find(e =>
    e.status !== 'declined' && e.status !== 'cancelled' && matchesSlot(e)
  );
  const hasEnquired  = slot.status === 'open' && !!activeEnquiry;
  const isBookedByMe = slot.status === 'booked' && userEnquiries.some(e => e.status === 'accepted' && matchesSlot(e));
  const isOpen       = slot.status === 'open';
  const isClosed     = slot.status === 'closed';

  const terms = resolveSlotTerms(venue, slot);
  const paySummary = formatPaySummary(terms);

  const metaParts = [
    slot.time,
    slot.duration ? `${slot.duration} min sets` : null,
    slot.room,
  ].filter(Boolean).join(' · ');

  // Expanded: timings lines
  const timingLines: string[] = [];
  if (slot.loadIn) {
    timingLines.push(`Load-in ${slot.loadIn}${slot.soundcheck ? ' · Soundcheck' : ''}`);
  } else if (slot.soundcheck) {
    timingLines.push('Soundcheck');
  }
  if (slot.soundcheckDetails) timingLines.push(slot.soundcheckDetails);
  timingLines.push([`On stage ${slot.time}`, slot.duration ? `for ${slot.duration} min sets` : null].filter(Boolean).join(' '));

  // Expanded: what you get
  const whatParts = [
    terms.guestList ? `Guest list · ${terms.guestList}` : null,
    terms.meals ? (terms.mealsDetails || 'Meals') : null,
    terms.drinks ? (terms.drinksDetails || 'Drinks') : null,
  ].filter(Boolean);
  const whatYouGet = whatParts.length > 0 ? whatParts.join(', ') : null;

  // Expanded: book by
  const bookBy = terms.minNotice && terms.minNotice !== '0' ? terms.minNotice : 'No minimum notice';

  let leftBorderColor: string;
  let badgeLabel: string;
  let badgeTextColor: string;
  let badgeBg: string;
  let badgeBorderColor: string;

  if (isClosed) {
    leftBorderColor = colors.border;
    badgeLabel = 'Closed'; badgeTextColor = colors.grey; badgeBg = 'transparent'; badgeBorderColor = colors.border;
  } else if (isBookedByMe) {
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

  const showDetails = isOpen && !isClosed;

  return (
    <View style={[lv.slotCard, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: isClosed ? colors.bgFaint : colors.bg, opacity: isClosed ? 0.7 : 1 }]}>
      {/* Top row */}
      <View style={lv.slotCardTop}>
        {/* Date block */}
        <View style={lv.dateBlock}>
          <Text style={[lv.dateBlockDay, { color: colors.grey }]}>{day.slice(0,3).toUpperCase()}</Text>
          <Text style={[lv.dateBlockNum, { color: colors.black }]}>{date.getDate()}</Text>
        </View>

        {/* Slot info */}
        <View style={lv.slotInfo}>
          <View style={lv.slotNameRow}>
            {(slot.name || slot.gigName) ? (
              <Text style={[lv.slotName, { color: isClosed ? colors.grey : colors.black }]} numberOfLines={1}>
                {slot.name || slot.gigName}
              </Text>
            ) : null}
            {slot.slotType ? (
              <View style={[lv.slotTypePill, { borderColor: colors.border }]}>
                <Text style={[lv.slotTypeText, { color: colors.grey }]}>{slot.slotType}</Text>
              </View>
            ) : null}
          </View>
          {metaParts ? <Text style={[lv.slotMeta, { color: colors.grey }]}>{metaParts}</Text> : null}
          {paySummary ? <Text style={[lv.slotPay, { color: colors.grey }]}>{paySummary}</Text> : null}
        </View>

        {/* Actions */}
        <View style={lv.slotActions}>
          {showDetails && !isMyVenue && (
            <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
              <Text style={lv.detailsLink}>{expanded ? 'Hide details' : 'Details'}</Text>
            </TouchableOpacity>
          )}
          {!isOpen && !isMyVenue && (
            <View style={[lv.statusBadge, { borderColor: badgeBorderColor, backgroundColor: badgeBg }]}>
              <Text style={[lv.statusBadgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
            </View>
          )}
          {hasEnquired && !isMyVenue && (
            <View style={[lv.statusBadge, { borderColor: badgeBorderColor, backgroundColor: badgeBg }]}>
              <Text style={[lv.statusBadgeText, { color: badgeTextColor }]}>{badgeLabel}</Text>
            </View>
          )}
          {isMyVenue && (
            <TouchableOpacity style={lv.editBtn} onPress={() => onVenueEdit?.(slot, day, dateISO)} activeOpacity={0.75}>
              <Text style={lv.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
          {isOpen && !hasEnquired && isArtist && !isMyVenue && (
            <TouchableOpacity style={lv.enquireBtn} onPress={() => onEnquire(slot, day, dateISO)}>
              <Text style={lv.enquireBtnText}>Enquire</Text>
            </TouchableOpacity>
          )}
          {isOpen && !hasEnquired && !isLoggedIn && !isMyVenue && (
            <TouchableOpacity style={[lv.enquireBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.orange }]} onPress={() => onEnquire(slot, day, dateISO)}>
              <Text style={[lv.enquireBtnText, { color: Colors.orange }]}>Log in</Text>
            </TouchableOpacity>
          )}
          {(hasEnquired || isBookedByMe) && activeEnquiry && (
            <TouchableOpacity onPress={() => router.push({ pathname: '/(tabs)/inbox', params: { openEnquiryId: activeEnquiry.id } } as any)}>
              <Text style={lv.viewLink}>View</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Expanded details panel */}
      {expanded && (
        <View style={[lv.detailsPanel, { borderTopColor: colors.border }]}>
          <View style={lv.detailsGrid}>
            <View style={lv.detailsCol}>
              <Text style={[lv.detailsLabel, { color: colors.grey }]}>Timings</Text>
              {timingLines.map((line, i) => (
                <Text key={i} style={[lv.detailsValue, { color: colors.black }]}>{line}</Text>
              ))}
            </View>
            <View style={lv.detailsCol}>
              <Text style={[lv.detailsLabel, { color: colors.grey }]}>Pay</Text>
              <Text style={[lv.detailsValue, { color: colors.black }]}>{paySummary || 'Not specified'}</Text>
            </View>
            <View style={lv.detailsCol}>
              <Text style={[lv.detailsLabel, { color: colors.grey }]}>What you get</Text>
              <Text style={[lv.detailsValue, { color: colors.black }]}>{whatYouGet || 'Nothing listed'}</Text>
            </View>
            <View style={lv.detailsCol}>
              <Text style={[lv.detailsLabel, { color: colors.grey }]}>Book by</Text>
              <Text style={[lv.detailsValue, { color: colors.black }]}>{bookBy}</Text>
            </View>
          </View>
          {slot.notes ? (
            <View style={[lv.detailsNotes, { borderTopColor: colors.border }]}>
              <Text style={[lv.detailsNotesLabel, { color: colors.grey }]}>Notes from the venue</Text>
              <Text style={[lv.detailsNotesText, { color: colors.black }]}>{slot.notes}</Text>
            </View>
          ) : null}
        </View>
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

// ── VideoThumb ────────────────────────────────────────────────────────

function videoSource(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube';
  if (/vimeo\.com/.test(url)) return 'Vimeo';
  return 'Video';
}

function VideoThumb({ url, title }: { url: string; title?: string }) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  const thumbnailUri = yt ? `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` : null;
  const source = videoSource(url);

  return (
    <TouchableOpacity style={vt.card} onPress={() => Linking.openURL(url)} activeOpacity={0.88}>
      <View style={vt.thumb}>
        {thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, vt.darkPlaceholder]} />
        )}
        {/* Dark scrim over thumbnail so play button reads clearly */}
        <View style={vt.scrim} />
        <View style={vt.playCircle}>
          <Text style={vt.playIcon}>▶</Text>
        </View>
      </View>
      <View style={vt.meta}>
        {title ? <Text style={vt.title} numberOfLines={2}>{title}</Text> : null}
        <Text style={vt.source}>{source}</Text>
      </View>
    </TouchableOpacity>
  );
}

const vt = StyleSheet.create({
  card:        { flex: 1 },
  thumb:       { aspectRatio: 16/9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1c1c1e' },
  darkPlaceholder: { backgroundColor: '#1c1c1e' },
  scrim:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' } as any,
  playCircle:  { position: 'absolute', top: '50%' as any, left: '50%' as any, marginTop: -28, marginLeft: -28, width: 56, height: 56, borderRadius: 28, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  playIcon:    { color: '#111111', fontSize: 20, marginLeft: 4 },
  meta:        { paddingTop: 10, gap: 3 },
  title:       { fontSize: 15, fontWeight: '700', color: '#111111', lineHeight: 21 },
  source:      { fontSize: 13, color: '#888888' },
});

// ── Photos & video tab ────────────────────────────────────────────────

function PhotosTab({ venue }: { venue: Venue }) {
  const { colors } = useTheme();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Prefer structured photoObjects (with captions) over plain photos array
  const photoItems: { url: string; caption?: string }[] = venue.photoObjects?.length
    ? venue.photoObjects
    : (() => {
        const raw = (venue.photos || []).filter(u => u !== venue.photoUrl);
        if (venue.photoUrl) raw.unshift(venue.photoUrl);
        return raw.map(url => ({ url }));
      })();

  const videoObjects: { url: string; title?: string }[] = venue.videoObjects?.length
    ? venue.videoObjects
    : (venue.videos || []).map(url => ({ url }));

  if (photoItems.length === 0 && videoObjects.length === 0) {
    return (
      <View style={[s.tabBody, { alignItems: 'center', paddingTop: 60 }]}>
        <Text style={[s.noSlotsText, { color: colors.grey }]}>No photos or videos yet.</Text>
      </View>
    );
  }

  const photoCols = isWeb ? 4 : 2;
  const tileGap = 8;

  return (
    <View style={s.tabBody}>

      {/* Video grid */}
      {videoObjects.length > 0 && (
        <View style={pt.section}>
          <Text style={[pt.heading, { color: colors.black }]}>Video</Text>
          <View style={pt.videoGrid}>
            {videoObjects.map((v, i) => (
              <View key={i} style={[pt.videoCell, isWeb && { width: `${100 / 2}%` as any, paddingRight: i % 2 === 0 ? tileGap / 2 : 0, paddingLeft: i % 2 !== 0 ? tileGap / 2 : 0 }]}>
                <VideoThumb url={v.url} title={v.title} />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Photo grid */}
      {photoItems.length > 0 && (
        <View style={pt.section}>
          <Text style={[pt.heading, { color: colors.black }]}>Photos</Text>
          <View style={[pt.photoGrid, { gap: tileGap }]}>
            {photoItems.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={[pt.photoTile, isWeb
                  ? { width: `calc(${100 / photoCols}% - ${tileGap * (photoCols - 1) / photoCols}px)` as any }
                  : { width: `${100 / 2 - 1}%` as any }
                ]}
                onPress={() => setLightboxIndex(i)}
                activeOpacity={0.88}
              >
                <Image source={{ uri: item.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                {item.caption ? (
                  <View style={pt.captionWrap}>
                    <Text style={pt.captionText} numberOfLines={1}>{item.caption}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setLightboxIndex(null)}>
          <View style={pt.lightboxBackdrop}>
            <TouchableOpacity style={pt.lightboxClose} onPress={() => setLightboxIndex(null)} activeOpacity={0.8}>
              <Text style={pt.lightboxCloseText}>✕</Text>
            </TouchableOpacity>
            <Image
              source={{ uri: photoItems[lightboxIndex].url }}
              style={pt.lightboxImage}
              resizeMode="contain"
            />
            {photoItems[lightboxIndex].caption ? (
              <Text style={pt.lightboxCaption}>{photoItems[lightboxIndex].caption}</Text>
            ) : null}
            {photoItems.length > 1 && (
              <View style={pt.lightboxNav}>
                <TouchableOpacity
                  style={pt.lightboxNavBtn}
                  onPress={() => setLightboxIndex(i => ((i ?? 0) - 1 + photoItems.length) % photoItems.length)}
                  activeOpacity={0.8}
                >
                  <Text style={pt.lightboxNavText}>‹</Text>
                </TouchableOpacity>
                <Text style={pt.lightboxCount}>{(lightboxIndex ?? 0) + 1} / {photoItems.length}</Text>
                <TouchableOpacity
                  style={pt.lightboxNavBtn}
                  onPress={() => setLightboxIndex(i => ((i ?? 0) + 1) % photoItems.length)}
                  activeOpacity={0.8}
                >
                  <Text style={pt.lightboxNavText}>›</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Rooms & Tech tab helpers ───────────────────────────────────────────

/** Returns the weekday names that have open recurring slots assigned to a specific room. */
function getRoomNights(venue: Venue, roomName: string): string[] {
  return CANONICAL_DAYS.filter(day => {
    const slots = venue.slots?.[day] || [];
    return slots.some(s => !s.date && s.status === 'open'
      && s.room?.toLowerCase().trim() === roomName?.toLowerCase().trim());
  });
}

function formatNights(days: string[]): string {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0] + 's';
  const last = days[days.length - 1] + 's';
  const rest = days.slice(0, -1).map(d => d + 's');
  return [...rest, last].join(' and ');
}

function parseMonitorMixCount(monitoring?: string): number | null {
  if (!monitoring) return null;
  const m = monitoring.match(/(\d+)\s*(mix|mon|wedge|in-ear|iem)/i);
  return m ? parseInt(m[1]) : null;
}

function parseStageArea(room: Room): number | null {
  const w = parseFloat(String(room.stageWidth || ''));
  const d = parseFloat(String(room.stageDepth || ''));
  if (!isNaN(w) && !isNaN(d)) return w * d;
  // Try to parse "6 × 4 m" or "6x4" from room.stage
  const m = (room.stage || '').match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
  if (m) return parseFloat(m[1]) * parseFloat(m[2]);
  return null;
}

function backlineList(room: Room): string[] {
  if (Array.isArray(room.backlineItems) && room.backlineItems.length > 0) return room.backlineItems;
  if (room.backline) return room.backline.split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

// ── Rider match logic ─────────────────────────────────────────────────

type RiderCheckItem = { label: string; pass: boolean };

function buildRiderChecks(room: Room, artist: any): RiderCheckItem[] {
  if (!artist) return [];
  const items: RiderCheckItem[] = [];
  const rider: Record<string, string> = artist.techRider || {};
  const riderBools: Record<string, boolean> = artist.techRiderBools || {};
  const neededBackline: string[] = artist.backlineFromVenue || [];
  const roomBackline = backlineList(room).map(b => b.toLowerCase());

  // PA system: needed unless artist brings own PA
  if (!riderBools.ownPA) {
    items.push({ label: 'PA system', pass: !!room.pa });
  }

  // Backline items
  neededBackline.forEach(needed => {
    const n = needed.toLowerCase();
    const pass = roomBackline.some(b => b.includes(n) || n.includes(b));
    items.push({ label: needed, pass });
  });

  // Monitor mixes
  const neededMixes = parseMonitorMixCount(rider.monitoring);
  if (neededMixes !== null) {
    const availMixes = parseMonitorMixCount(room.monitoring);
    const pass = availMixes !== null && availMixes >= neededMixes;
    const label = pass
      ? `${availMixes} wedge mix${availMixes !== 1 ? 'es' : ''}`
      : availMixes !== null
        ? `${availMixes} wedge mix${availMixes !== 1 ? 'es' : ''} only`
        : `${neededMixes} wedge mix${neededMixes !== 1 ? 'es' : ''} needed`;
    items.push({ label, pass });
  }

  // Stage size vs performer count
  const performerCount = parseInt(String(artist.performerCount || artist.lineupSize || ''));
  if (!isNaN(performerCount) && performerCount > 0) {
    const area = parseStageArea(room);
    const needed = performerCount * 2; // ~2 m² per performer
    const pass = area !== null && area >= needed;
    items.push({
      label: pass ? `Stage fits ${performerCount} performer${performerCount !== 1 ? 's' : ''}` : `Stage fits ${Math.floor((area || 0) / 2)}-${Math.ceil((area || 0) / 2)} performers`,
      pass,
    });
  }

  return items;
}

// ── Rooms & Tech tab ──────────────────────────────────────────────────

function RoomsTab({ venue, isArtist, isLoggedIn, userId }: {
  venue: Venue; isArtist: boolean; isLoggedIn: boolean; userId?: string;
}) {
  const { colors } = useTheme();
  const rooms     = venue.rooms || [];
  const techSpecs = venue.techSpecs;
  const [artistProfile, setArtistProfile] = useState<any>(null);

  useEffect(() => {
    if (!isArtist || !userId) return;
    getDoc(doc(db, 'bandProfiles', userId))
      .then(snap => { if (snap.exists()) setArtistProfile(snap.data()); })
      .catch(() => {});
  }, [isArtist, userId]);

  const onNightRows = [
    { label: 'Load-in',    value: techSpecs?.loadIn || techSpecs?.loadInParking },
    { label: 'Parking',    value: techSpecs?.parking },
    { label: 'Sound engineer', value:
        typeof techSpecs?.soundEngineer !== 'undefined'
          ? techSpecs.soundEngineer
            ? `Included${techSpecs.soundEngineerDetails ? ` (${techSpecs.soundEngineerDetails})` : ''}`
            : 'No in-house engineer'
          : undefined
    },
    { label: 'Curfew',    value: techSpecs?.curfew },
    { label: 'Noise',     value: techSpecs?.notes },
    { label: 'Green room',value:
        typeof techSpecs?.greenRoom !== 'undefined'
          ? techSpecs.greenRoom
            ? `Available${techSpecs.greenRoomDetails ? ` — ${techSpecs.greenRoomDetails}` : ''}`
            : 'No green room'
          : undefined
    },
  ].filter(r => r.value);

  const hasOnTheNight = onNightRows.length > 0;

  if (rooms.length === 0 && !hasOnTheNight) {
    return (
      <View style={[s.tabBody, { alignItems: 'center', paddingTop: 60 }]}>
        <Text style={[s.noSlotsText, { color: colors.grey }]}>Rooms and tech specs haven't been listed yet.</Text>
      </View>
    );
  }

  const hasRider = artistProfile && (
    !!(artistProfile.techRiderBools || artistProfile.backlineFromVenue?.length || artistProfile.techRider?.monitoring)
  );

  return (
    <View style={s.tabBody}>

      {rooms.map((room, i) => {
        const nights   = getRoomNights(venue, room.name || '');
        const nightStr = formatNights(nights);
        const stageStr = room.stage
          || (room.stageWidth && room.stageDepth ? `${room.stageWidth} × ${room.stageDepth} m stage` : null);
        const headerParts = [
          room.capacity ? `Capacity ${Number(room.capacity).toLocaleString()}` : null,
          stageStr ? `${stageStr}${stageStr.toLowerCase().includes('stage') ? '' : ' stage'}` : null,
          nightStr || null,
        ].filter(Boolean);

        const riderChecks = hasRider ? buildRiderChecks(room, artistProfile) : [];
        const chips = backlineList(room);

        const mainSpecs = [
          { label: 'PA system',  value: room.pa },
          { label: 'Monitoring', value: room.monitoring },
          { label: 'Lighting',   value: room.lighting },
        ].filter(r => r.value);
        const extraSpecs = [
          { label: 'Power', value: room.power },
        ].filter(r => r.value);

        return (
          <View key={i} style={[rt.card, { borderColor: colors.border, backgroundColor: colors.bg }]}>

            {/* Card header */}
            <View style={rt.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[rt.roomName, { color: colors.black }]}>{room.name}</Text>
                {headerParts.length > 0 && (
                  <Text style={[rt.roomMeta, { color: colors.grey }]}>{headerParts.join(' · ')}</Text>
                )}
              </View>
              {room.documents && room.documents.length > 0 && (
                <View style={rt.docsRow}>
                  {room.documents.map((d, di) => (
                    <TouchableOpacity
                      key={di}
                      style={[rt.docBtn, { borderColor: colors.border }]}
                      onPress={() => Linking.openURL(d.url)}
                      activeOpacity={0.75}
                    >
                      <Text style={[rt.docBtnText, { color: colors.black }]}>↓ {d.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Against your tech rider */}
            {isArtist && isLoggedIn && riderChecks.length > 0 && (
              <View style={[rt.riderBox, { backgroundColor: colors.bgFaint }]}>
                <Text style={[rt.riderHeading, { color: colors.grey }]}>Against your tech rider</Text>
                <View style={rt.riderItems}>
                  {riderChecks.map((item, ci) => (
                    <View key={ci} style={rt.riderItem}>
                      <Text style={[rt.riderIcon, { color: item.pass ? '#2F7A4B' : '#9A3B06' }]}>
                        {item.pass ? '✓' : '✗'}
                      </Text>
                      <Text style={[rt.riderLabel, { color: item.pass ? colors.black : '#9A3B06' }]}>
                        {item.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Spec grid: 3 columns */}
            {mainSpecs.length > 0 && (
              <View style={rt.specGrid}>
                {mainSpecs.map(({ label, value }) => (
                  <View key={label} style={rt.specCell}>
                    <Text style={[rt.specLabel, { color: colors.grey }]}>{label}</Text>
                    <Text style={[rt.specValue, { color: colors.black }]}>{value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Extra specs: full width */}
            {extraSpecs.map(({ label, value }) => (
              <View key={label} style={rt.specFull}>
                <Text style={[rt.specLabel, { color: colors.grey }]}>{label}</Text>
                <Text style={[rt.specValue, { color: colors.black }]}>{value}</Text>
              </View>
            ))}

            {/* Backline chips */}
            {chips.length > 0 && (
              <View style={rt.backlineSection}>
                <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 10 }]}>Backline you can use</Text>
                <View style={rt.backlineChips}>
                  {chips.map((chip, ci) => (
                    <View key={ci} style={[rt.chip, { borderColor: colors.border }]}>
                      <Text style={[rt.chipText, { color: colors.black }]}>{chip}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Notes for acts */}
            {room.notes ? (
              <View style={rt.notesSection}>
                <Text style={[rt.specLabel, { color: colors.grey, marginBottom: 6 }]}>Notes for acts</Text>
                <Text style={[rt.notesText, { color: colors.black }]}>{room.notes}</Text>
              </View>
            ) : null}

          </View>
        );
      })}

      {/* On the night */}
      {hasOnTheNight && (
        <View style={[rt.card, { borderColor: colors.border, backgroundColor: colors.bg }]}>
          <Text style={[rt.roomName, { color: colors.black, marginBottom: 16 }]}>On the night</Text>
          {onNightRows.map(({ label, value }) => (
            <View key={label} style={[rt.onNightRow, { borderBottomColor: colors.border }]}>
              <Text style={[rt.onNightLabel, { color: colors.grey }]}>{label}</Text>
              <Text style={[rt.onNightValue, { color: colors.black }]}>{value}</Text>
            </View>
          ))}
        </View>
      )}

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: '#ffffff' },
  banner:             { width: '100%', height: isWeb ? 220 : 240, resizeMode: 'cover' },
  bannerPlaceholder:  { width: '100%', backgroundColor: '#e8e3d8', alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { color: '#999999', fontSize: 14 },
  backOverlayWrap:    { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  backOverlay:        { alignSelf: 'flex-start', margin: 16, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  webNavBar:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  backOverlayText:    { fontSize: 14, fontWeight: '600', color: '#111111' },
  previewBanner:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 16 },
  previewBannerText:  { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  previewBannerExit:  { fontSize: 12, fontWeight: '700', color: Colors.orange },
  backText:           { fontSize: 15, color: Colors.orange, fontWeight: '600', padding: 20 },
  notFound:           { textAlign: 'center', color: '#888888', marginTop: 40, fontSize: 15 },

  // Profile header
  identityRow:        { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: isWeb ? 40 : 20, paddingTop: 0, paddingBottom: 14, gap: 16 },
  logoWrap:           { marginTop: -32, flexShrink: 0 },
  logoImg:            { width: 72, height: 72, borderRadius: 12, borderWidth: 3 },
  logoPlaceholder:    { width: 72, height: 72, borderRadius: 12, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderText:{ fontSize: 22, fontWeight: '800' },
  identityInfo:       { flex: 1, paddingBottom: 4 },
  name:               { fontSize: isWeb ? 28 : 22, fontWeight: '800', color: '#111111', letterSpacing: -0.4, marginBottom: 3 },
  subline:            { fontSize: 13, color: '#555555' },
  verifiedBadge:      { backgroundColor: '#2F7A4B', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'center' },
  verifiedBadgeText:  { fontSize: 11, fontWeight: '700', color: '#ffffff', letterSpacing: 0.3 },
  actionsRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: isWeb ? 40 : 20, paddingBottom: 16, paddingTop: 4 },
  genreChipsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: isWeb ? 40 : 20, paddingBottom: 14 },
  stickyTabBar:       { borderBottomWidth: 1 },
  accessibilityRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  accessibilityCheck: { fontSize: 14, fontWeight: '700' },
  accessibilityLabel: { fontSize: 14 },
  genreRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  genrePill:          { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  genreText:          { fontSize: 12, color: Colors.orange, fontWeight: '500' },
  genrePillSmall:     { borderWidth: 1, borderColor: Colors.orange, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  genreTextSmall:     { fontSize: 11, color: Colors.orange },
  genreOrangeText:    { fontSize: 12, color: Colors.black, fontWeight: '500', marginTop: 2 },
  breadcrumb:         { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 1.4, marginBottom: 6 },
  editProfileBtn:     { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start' },
  editProfileBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  logoutBtn:          { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start' },
  logoutBtnText:      { fontSize: 13, fontWeight: '600', color: Colors.grey },
  msgVenueBtn:        { borderWidth: 1, borderColor: '#D0CFC9', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-start' },
  msgVenueBtnText:    { fontSize: 13, fontWeight: '600' },
  enquireHeaderBtn:   { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-start' },
  enquireHeaderBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  viewTimetableBtn:   { borderWidth: 1, borderColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-start' },
  viewTimetableBtnText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  sidebarEnquireBtn:     { backgroundColor: Colors.orange, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  sidebarEnquireBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // Tab bar
  tabBar:             { borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  tabBarContent:      { flexDirection: 'row' },
  tabBtn:             { paddingVertical: 13, paddingHorizontal: isWeb ? 20 : 16, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive:       { borderBottomColor: '#16161A' },
  tabText:            { fontSize: 13, fontWeight: '600', color: '#888888' },
  tabTextActive:      { color: '#16161A' },

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
  // Slot card
  slotCard:         { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  slotCardTop:      { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 16, paddingHorizontal: 16, gap: 14 },
  dateBlock:        { width: 36, alignItems: 'center', flexShrink: 0, paddingTop: 2 },
  dateBlockDay:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  dateBlockNum:     { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  slotInfo:         { flex: 1, gap: 4 },
  slotNameRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  slotName:         { fontSize: 15, fontWeight: '700' },
  slotTypePill:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  slotTypeText:     { fontSize: 11, fontWeight: '600' },
  slotMeta:         { fontSize: 13 },
  slotPay:          { fontSize: 13 },
  slotActions:      { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  detailsLink:      { fontSize: 13, fontWeight: '600', color: '#16161A', textDecorationLine: 'underline' as const },
  statusBadge:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0 },
  statusBadgeText:  { fontSize: 12, fontWeight: '600' },
  enquireBtn:       { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, flexShrink: 0 },
  enquireBtnText:   { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  viewLink:         { fontSize: 13, fontWeight: '600', color: Colors.orange, paddingHorizontal: 4, flexShrink: 0 },
  editBtn:          { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  editBtnText:      { fontSize: 12, fontWeight: '600', color: '#555555' },
  // Expanded details panel
  detailsPanel:     { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 20, gap: 16 },
  detailsGrid:      { flexDirection: 'row', gap: 0 },
  detailsCol:       { flex: 1, paddingRight: 12, gap: 6 },
  detailsLabel:     { fontSize: 12, fontWeight: '600' },
  detailsValue:     { fontSize: 14, lineHeight: 22 },
  detailsNotes:     { borderTopWidth: 1, paddingTop: 16, gap: 6 },
  detailsNotesLabel:{ fontSize: 12, fontWeight: '600' },
  detailsNotesText: { fontSize: 14, lineHeight: 22 },
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
  section:            { marginBottom: 32 },
  heading:            { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, marginBottom: 14 },
  videoGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  videoCell:          { flex: 1, minWidth: 280 },
  photoGrid:          { flexDirection: 'row', flexWrap: 'wrap' },
  photoTile:          { aspectRatio: 4/3, overflow: 'hidden', borderRadius: 8 },
  captionWrap:        { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.52)', paddingHorizontal: 10, paddingVertical: 6 },
  captionText:        { color: '#ffffff', fontSize: 12, fontWeight: '500' },
  lightboxBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', alignItems: 'center' },
  lightboxImage:      { width: '100%', height: '75%' as any },
  lightboxCaption:    { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 12, paddingHorizontal: 24, textAlign: 'center' as const },
  lightboxClose:      { position: 'absolute', top: 48, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lightboxCloseText:  { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  lightboxNav:        { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 16 },
  lightboxNavBtn:     { padding: 12 },
  lightboxNavText:    { color: '#ffffff', fontSize: 28, lineHeight: 32 },
  lightboxCount:      { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});

// Rooms & tech styles
const rt = StyleSheet.create({
  card:           { borderWidth: 1, borderRadius: 14, padding: isWeb ? 24 : 18, marginBottom: 16 },
  cardHeader:     { flexDirection: isWeb ? 'row' : 'column', alignItems: isWeb ? 'flex-start' : 'stretch', gap: 12, marginBottom: 20 },
  roomName:       { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  roomMeta:       { fontSize: 14, marginTop: 4, lineHeight: 20 },
  docsRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: isWeb ? 0 : 4 },
  docBtn:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, gap: 6 },
  docBtnText:     { fontSize: 13, fontWeight: '600' },
  riderBox:       { borderRadius: 10, padding: 14, marginBottom: 20 },
  riderHeading:   { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 10 },
  riderItems:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, rowGap: 4 },
  riderItem:      { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 16 },
  riderIcon:      { fontSize: 13, fontWeight: '800' },
  riderLabel:     { fontSize: 14, fontWeight: '500' },
  specGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 0, marginBottom: 16 },
  specCell:       { width: isWeb ? '33.33%' : '100%', paddingVertical: 10, paddingRight: 16, gap: 4 },
  specFull:       { paddingVertical: 10, gap: 4, marginBottom: 6 },
  specLabel:      { fontSize: 12, fontWeight: '600', color: '#888888', textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  specValue:      { fontSize: 15, fontWeight: '500', lineHeight: 22 },
  backlineSection:{ marginTop: 4, marginBottom: 16 },
  backlineChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  chipText:       { fontSize: 14, fontWeight: '500' },
  notesSection:   { paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E7E6E3' },
  notesText:      { fontSize: 14, lineHeight: 21 },
  onNightRow:     { flexDirection: 'row', gap: 16, paddingVertical: 11, borderBottomWidth: 1 },
  onNightLabel:   { width: 110, fontSize: 14, fontWeight: '600', flexShrink: 0 },
  onNightValue:   { flex: 1, fontSize: 14, lineHeight: 21 },
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
