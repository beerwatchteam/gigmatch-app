import { useState, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Platform, Modal as RNModal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  doc, getDoc, getDocs, query, collection, where, limit as fsLimit,
} from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '@/lib/firebase';
import { Text } from '@/components/Text';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';
import { type Enquiry } from '@/lib/useEnquiries';
import { type GigFee, type FeeType, type PaymentTiming, STATE_TZ, dollarsToCents } from '@/lib/gig-types';
import { confirmGigFromEnquiry, upgradeGigToBooked, SlotConflictError } from '@/lib/useGigs';
import { fromZonedTime } from 'date-fns-tz';
import { AddToCalendarButton } from '@/components/AddToCalendarButton';

const isWeb = Platform.OS === 'web';

// ── Constants ────────────────────────────────────────────────────────────────

const FEE_TYPES: { value: FeeType; label: string }[] = [
  { value: 'flat',                 label: 'Flat fee'           },
  { value: 'door_split',           label: 'Door split'         },
  { value: 'guarantee_vs_door',    label: 'Guarantee + door'   },
  { value: 'ticket_split',         label: 'Ticket split'       },
  { value: 'unpaid',               label: 'Unpaid'             },
  { value: 'other',                label: 'Other'              },
];

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW_SHORT = ['S','M','T','W','T','F','S'];

const DAY_DOW: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

const SET_LENGTH_OPTIONS = [30, 45, 60, 75, 90, 120];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Maps a PAYMENT_MODELS string (from venue slot) to a FeeType. */
function slotModelToFeeType(s: string | null | undefined): FeeType | null {
  if (!s) return null;
  const v = s.toLowerCase().replace(/[\s_\-+]/g, '');
  if (v === 'flat' || v === 'flatfee' || v === 'setfee')                  return 'flat';
  if (v === 'doorsplit' || v === 'door')                                   return 'door_split';
  if (v.startsWith('guarantee') || v === 'guaranteesplit')                 return 'guarantee_vs_door';
  if (v === 'ticketsplit' || v === 'ticketsalessplit' || v.startsWith('ticket')) return 'ticket_split';
  if (v === 'bartab' || v === 'bar' || v === 'barsplit')                   return 'door_split';
  if (v.includes('unpaid') || v.includes('exposure'))                      return 'unpaid';
  if (v === 'negotiable' || v === 'other')                                 return 'other';
  return null;
}

function parseSetLengthMinutes(s: string | undefined): number {
  if (!s) return 45;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 45;
}

function formatLocalDate(iso: string): string {
  // Parse YYYY-MM-DD without Date constructor to avoid UTC midnight issues
  const [y, mo, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
}

function deriveTimezone(venueData: Record<string, any>): string {
  const state = (venueData.state ?? venueData.location ?? '').toUpperCase().trim();
  for (const [code, tz] of Object.entries(STATE_TZ)) {
    if (state.includes(code)) return tz;
  }
  return 'Australia/Sydney';
}

// ── Mini calendar picker (JS-only, works on all platforms) ───────────────────

function CalendarPicker({
  value,
  onChange,
  allowedDow,
  colors: c,
}: {
  value: string;
  onChange: (v: string) => void;
  allowedDow?: number;
  colors: ReturnType<typeof import('@/lib/theme-context').useTheme>['colors'];
}) {
  const today = new Date(); today.setHours(0,0,0,0);
  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { y: +value.slice(0,4), m: +value.slice(5,7)-1, d: +value.slice(8,10) }
    : null;

  const [open,      setOpen]      = useState(false);
  const [viewYear,  setViewYear]  = useState(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m ?? today.getMonth());

  const display = parsed
    ? `${String(parsed.d).padStart(2,'0')}/${String(parsed.m+1).padStart(2,'0')}/${parsed.y}`
    : 'Select date';

  const cells: (number|null)[] = (() => {
    const first = new Date(viewYear, viewMonth, 1).getDay();
    const total = new Date(viewYear, viewMonth+1, 0).getDate();
    const arr: (number|null)[] = Array(first).fill(null);
    for (let ci = 1; ci <= total; ci++) arr.push(ci);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  })();

  function isAllowed(d: number) {
    if (allowedDow == null) return true;
    return new Date(viewYear, viewMonth, d).getDay() === allowedDow;
  }

  function pick(d: number) {
    if (!isAllowed(d)) return;
    onChange(`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); }
    else setViewMonth(m => m-1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); }
    else setViewMonth(m => m+1);
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[cs.input, { backgroundColor: c.bgFaint, borderColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text style={{ fontSize: 14, color: value ? c.black : Colors.greyLight }}>{display}</Text>
        <Text style={{ fontSize: 12, color: Colors.grey }}>📅</Text>
      </TouchableOpacity>
      <RNModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.bg, borderRadius: 18, padding: 20, width: '100%', maxWidth: 340 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <TouchableOpacity onPress={prevMonth} style={{ padding: 8, minWidth: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, color: Colors.orange }}>‹</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.black }}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={{ padding: 8, minWidth: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, color: Colors.orange }}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {DOW_SHORT.map((lbl, li) => (
                <View key={li} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey }}>{lbl}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, idx) => {
                if (d === null) return <View key={idx} style={{ width: '14.28%' as any }} />;
                const allowed = isAllowed(d);
                const sel = parsed?.y === viewYear && parsed?.m === viewMonth && parsed?.d === d;
                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => pick(d)}
                    activeOpacity={allowed ? 0.7 : 1}
                    style={{ width: '14.28%' as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{
                      width: 32, height: 32, borderRadius: 16,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: sel ? Colors.orange : 'transparent',
                    }}>
                      <Text style={{
                        fontSize: 13,
                        color: !allowed ? c.border : sel ? '#fff' : c.black,
                        fontWeight: sel ? '700' : '400',
                      }}>{d}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {allowedDow != null && (
              <Text style={{ fontSize: 11, color: Colors.grey, textAlign: 'center', marginTop: 10 }}>
                Only {Object.keys(DAY_DOW).find(k => DAY_DOW[k] === allowedDow)} dates are selectable.
              </Text>
            )}
            <TouchableOpacity onPress={() => setOpen(false)} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.grey }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function ConfirmGigScreen() {
  const router   = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { enquiryId, mode: modeParam } = useLocalSearchParams<{ enquiryId: string; mode?: string }>();
  const isUpgrade = modeParam === 'upgrade';

  // Data
  const [enquiry,        setEnquiry]        = useState<Enquiry | null>(null);
  const [venueOwnerUid,  setVenueOwnerUid]  = useState('');
  const [venueDisplayName, setVenueDisplayName] = useState('');
  const [venuePhotoUrl,  setVenuePhotoUrl]  = useState<string | null>(null);
  const [timezone,       setTimezone]       = useState('Australia/Sydney');
  const [slotPayModels,  setSlotPayModels]  = useState<string[]>([]);
  const [feeRangePlaceholder, setFeeRangePlaceholder] = useState('0.00');
  const [loading,        setLoading]        = useState(true);

  // Form state
  const [localDate,      setLocalDate]      = useState('');
  const [feeType,        setFeeType]        = useState<FeeType>('flat');
  const [amountStr,      setAmountStr]      = useState('');
  const [doorPercent,    setDoorPercent]    = useState('');
  const [ticketPriceStr, setTicketPriceStr] = useState('');
  const [ticketUrl,      setTicketUrl]      = useState('');
  const [feeNotes,       setFeeNotes]       = useState('');
  const [includesGst,    setIncludesGst]    = useState<boolean | null>(null);
  const [paymentTiming,  setPaymentTiming]  = useState<PaymentTiming>('after');
  const [setLengthMins,  setSetLengthMins]  = useState(45);
  const [loadInTime,     setLoadInTime]     = useState('');
  const [soundCheckTime, setSoundCheckTime] = useState('');
  const [listAsBooked,   setListAsBooked]   = useState<'pending' | 'booked'>(isUpgrade ? 'booked' : 'pending');
  const [confirmMsg,     setConfirmMsg]     = useState('');
  const [ticketExpanded, setTicketExpanded] = useState(false);

  // UI
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [done,         setDone]         = useState(false);
  const [confirmedGigId, setConfirmedGigId] = useState<string | undefined>(undefined);
  const [triedSubmit,  setTriedSubmit]  = useState(false);

  useEffect(() => {
    if (!enquiryId) return;
    async function load() {
      try {
        // Load enquiry
        const enqSnap = await getDoc(doc(db, 'inquiries', enquiryId));
        if (!enqSnap.exists()) { setLoading(false); return; }
        const enq = { id: enqSnap.id, ...enqSnap.data() } as Enquiry;
        setEnquiry(enq);

        // Prefill date and scheduling fields
        setLocalDate(enq.requestedSlot.date ?? '');
        setSetLengthMins(parseSetLengthMinutes(enq.requestedSlot.setLength));
        if (enq.loadInTime)     setLoadInTime(enq.loadInTime);
        if (enq.soundCheckTime) setSoundCheckTime(enq.soundCheckTime);

        // Prefill fee type and all amount fields from the saved GigFee object
        const enqAny  = enq as any;
        const savedFee = enqAny.fee as GigFee | null | undefined;
        const feeTypeVal: string | undefined = enqAny.feeType ?? savedFee?.type;
        if (feeTypeVal) {
          const ft = FEE_TYPES.find(f => f.value === feeTypeVal);
          if (ft) setFeeType(ft.value);
        }
        if (savedFee?.amountCents != null) {
          const dollars = savedFee.amountCents / 100;
          setAmountStr(Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2));
        }
        if (savedFee?.doorPercent != null) setDoorPercent(String(savedFee.doorPercent));
        if (savedFee?.ticketPriceCents != null) {
          const tp = savedFee.ticketPriceCents / 100;
          setTicketPriceStr(Number.isInteger(tp) ? String(tp) : tp.toFixed(2));
        }
        if (savedFee?.ticketUrl) setTicketUrl(savedFee.ticketUrl);
        if (savedFee?.notes)     setFeeNotes(savedFee.notes);

        // Load venue
        const venueSnap = await getDoc(doc(db, 'venues', enq.venueId));
        if (venueSnap.exists()) {
          const vd = venueSnap.data();
          setVenueDisplayName(vd.name ?? enq.venueName);
          setVenuePhotoUrl(vd.photoUrl ?? null);
          setTimezone(deriveTimezone(vd));

          // Prefill payment timing from venue settings — all timing options map to 'after'
          // (same-night, within-N-days, other all mean after the gig). Default: 'after'.
          setPaymentTiming('after');

          // Find matching slot for paymentModels
          const { day, date, time, room } = enq.requestedSlot;
          const daySlots: any[] = vd.slots?.[day] ?? [];
          const slotDate = date ?? null;
          const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          const matchedSlot = daySlots.find(s =>
            s.date === slotDate &&
            norm(s.time) === norm(time) &&
            (!room || norm(s.room ?? '') === norm(room))
          ) ?? daySlots.find(s =>
            !s.date && norm(s.time) === norm(time) &&
            (!room || norm(s.room ?? '') === norm(room))
          );
          if (matchedSlot) {
            // Payment models (slot-level suggestions shown as dotted border)
            if (matchedSlot.paymentModels?.length) {
              setSlotPayModels(matchedSlot.paymentModels as string[]);
              // Only use slot suggestion as fallback — enquiry's saved feeType takes priority
              if (!(enq as any).feeType) {
                const parsed = slotModelToFeeType(matchedSlot.paymentModels[0]);
                if (parsed) setFeeType(parsed);
              }
            }
            // Fee range placeholder (never prefill the amount, just hint the range)
            const fMin = matchedSlot.feeMin != null ? Number(matchedSlot.feeMin) : null;
            const fMax = matchedSlot.feeMax != null ? Number(matchedSlot.feeMax) : null;
            if (fMin != null && fMax != null && fMax !== fMin) setFeeRangePlaceholder(`$${fMin} – $${fMax}`);
            else if (fMin != null) setFeeRangePlaceholder(`$${fMin}`);
            // Set length from slot duration (minutes) if enquiry didn't capture it
            if (!enq.requestedSlot.setLength && matchedSlot.duration) {
              setSetLengthMins(Number(matchedSlot.duration));
            }
            // Load-in / soundcheck from slot template if not on enquiry
            if (!enq.loadInTime    && matchedSlot.loadIn)     setLoadInTime(matchedSlot.loadIn);
            if (!enq.soundCheckTime && matchedSlot.soundcheck) setSoundCheckTime(matchedSlot.soundcheck);
          }
        }

        // Load venue owner UID
        const usersSnap = await getDocs(query(
          collection(db, 'users'),
          where('venueId', '==', enq.venueId),
          fsLimit(1),
        ));
        if (!usersSnap.empty) setVenueOwnerUid(usersSnap.docs[0].id);

      } catch {
        // Data load failure is non-fatal — form still usable
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [enquiryId]);

  const dateLocked = !!(enquiry?.requestedSlot.date);
  const allowedDow = enquiry?.requestedSlot.day != null
    ? DAY_DOW[enquiry.requestedSlot.day]
    : undefined;

  const showAmount   = feeType === 'flat' || feeType === 'guarantee_vs_door';
  const showDoor     = feeType === 'door_split' || feeType === 'guarantee_vs_door';
  const showTicket   = feeType === 'ticket_split';

  // Fee is "complete" when enough info has been entered for the chosen type.
  const feeComplete =
    feeType === 'unpaid' || feeType === 'other'
      ? true
      : (feeType === 'flat' || feeType === 'guarantee_vs_door')
        ? amountStr.trim() !== ''
        : feeType === 'door_split'
          ? doorPercent.trim() !== ''
          : feeType === 'ticket_split'
            ? ticketPriceStr.trim() !== ''
            : true;

  // Fee is required when listing as booked.
  const feeRequired = listAsBooked === 'booked';

  // Show the red error state: always in upgrade mode (they're here to fix it),
  // otherwise only after they've tried to submit.
  const showFeeError = feeRequired && !feeComplete && (triedSubmit || isUpgrade);

  const localTime = enquiry?.requestedSlot.time ?? '';

  const previewMsg = (() => {
    if (!enquiry) return '';
    const parts: string[] = [];
    if (localDate) {
      const [y, mo, d] = localDate.split('-').map(Number);
      const dt  = new Date(y, mo - 1, d);
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
      const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo - 1];
      parts.push(`${dow} ${d} ${mon}`);
    }
    if (localTime) parts.push(localTime);
    if (feeType === 'flat' && amountStr) parts.push(`$${amountStr} flat`);
    else if (feeType === 'door_split' && doorPercent) parts.push(`${doorPercent}% door`);
    parts.push(`pay ${paymentTiming} the gig`);
    if (loadInTime.trim()) parts.push(`load-in ${loadInTime.trim()}`);
    return `Gig confirmed: ${parts.join(' · ')}`;
  })();

  async function handleConfirm() {
    if (!user || !enquiry) return;

    if (feeRequired && !feeComplete) {
      setTriedSubmit(true);
      setError('Please complete the fee details before confirming.');
      return;
    }

    if (!isUpgrade) {
      if (!localDate) { setError('Please select a date.'); return; }
      if (!localTime) { setError('No time on this slot — contact support.'); return; }
    }

    const fee: GigFee = {
      type:            feeType,
      amountCents:     null,
      doorPercent:     null,
      ticketPriceCents: null,
      ticketUrl:       null,
      notes:           null,
      includesGst:     includesGst,
    };
    if (showAmount && amountStr) fee.amountCents = dollarsToCents(amountStr);
    if (showDoor && doorPercent)  fee.doorPercent = parseFloat(doorPercent);
    if (showTicket && ticketPriceStr) fee.ticketPriceCents = dollarsToCents(ticketPriceStr);
    if (showTicket && ticketUrl.trim()) fee.ticketUrl = ticketUrl.trim();
    if (feeNotes.trim()) fee.notes = feeNotes.trim();

    setSubmitting(true);
    setError(null);
    try {
      if (isUpgrade) {
        await upgradeGigToBooked(enquiry, fee);
      } else {
        const newGigId = await confirmGigFromEnquiry({
          enquiry,
          venueOwnerUid: venueOwnerUid || (user?.uid ?? ''),
          venueDisplayName,
          venuePhotoUrl,
          localDate,
          localTime,
          timezone,
          fee,
          paymentTiming,
          setLengthMinutes: setLengthMins,
          loadInTime:   loadInTime.trim()   || undefined,
          soundCheckTime: soundCheckTime.trim() || undefined,
          listAsBooked: listAsBooked === 'booked',
          confirmMessage: confirmMsg.trim() || undefined,
        });
        setConfirmedGigId(newGigId);
      }
      setDone(true);
    } catch (err: any) {
      if (err instanceof SlotConflictError) {
        setError(err.message);
      } else if (err?.code === 'unavailable') {
        setError('You appear to be offline. Connect and try again.');
      } else {
        setError(err?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <View style={[cs.overlay, { backgroundColor: isWeb ? 'rgba(0,0,0,0.45)' : colors.bg }]}>
        {isWeb && <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => router.back()} activeOpacity={1} />}
        <View style={[cs.card, isWeb && cs.cardWeb, { backgroundColor: colors.bg }]}>
          <View style={cs.successWrap}>
            <View style={cs.successCircle}>
              <Text style={cs.successCheck}>✓</Text>
            </View>
            <Text style={[cs.successTitle, { color: colors.black }]}>{isUpgrade ? 'Listed as booked' : 'Gig confirmed'}</Text>
            <Text style={[cs.successSub, { color: colors.grey }]}>
              {isUpgrade
                ? `${enquiry?.bandName} is now publicly listed at ${enquiry?.venueName}.`
                : `${enquiry?.bandName} is locked in at ${enquiry?.venueName}.`}
            </Text>
            <TouchableOpacity style={cs.doneBtn} onPress={() => router.back()}>
              <Text style={cs.doneBtnText}>Back to inbox</Text>
            </TouchableOpacity>
            {!isUpgrade && enquiry && localDate && localTime && (() => {
              const [y, mo, d] = localDate.split('-').map(Number);
              const [h, mi]    = localTime.split(':').map(Number);
              const start      = fromZonedTime(new Date(y, mo - 1, d, h, mi, 0, 0), timezone);
              const end        = new Date(start.getTime() + setLengthMins * 60_000);
              return (
                <AddToCalendarButton
                  startDate={start}
                  endDate={end}
                  summary={`${enquiry.bandName} @ ${enquiry.venueName}`}
                  location={enquiry.venueName}
                  description={[
                    setLengthMins > 0 ? `Set length: ${setLengthMins} min` : '',
                    loadInTime.trim() ? `Load-in: ${loadInTime.trim()}` : '',
                    soundCheckTime.trim() ? `Soundcheck: ${soundCheckTime.trim()}` : '',
                    'For more information check twaylo.com.au',
                  ].filter(Boolean).join('\n')}
                  gigId={confirmedGigId}
                  timezone={timezone}
                />
              );
            })()}
          </View>
        </View>
      </View>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[cs.overlay, { backgroundColor: isWeb ? 'rgba(0,0,0,0.45)' : colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.orange} />
      </View>
    );
  }

  if (!enquiry) {
    return (
      <View style={[cs.overlay, { backgroundColor: isWeb ? 'rgba(0,0,0,0.45)' : colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.grey }}>Enquiry not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: Colors.orange }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const formContent = (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[cs.scroll, isWeb && cs.scrollWeb]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={cs.formHeader}>
          <View style={{ flex: 1 }}>
            <Text style={cs.headerLabel}>{isUpgrade ? 'ADD FEE DETAILS' : 'CONFIRM GIG'}</Text>
            <Text style={[cs.bandName, { color: colors.black }]}>{enquiry.bandName}</Text>
            <Text style={[cs.venueName, { color: colors.grey }]}>{enquiry.venueName}</Text>
            <Text style={[cs.slotDetail, { color: colors.grey }]}>
              {[enquiry.requestedSlot.day, enquiry.requestedSlot.date, enquiry.requestedSlot.time, enquiry.requestedSlot.room].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[cs.closeBtn, { borderColor: colors.border }]}
          >
            <Text style={[cs.closeBtnText, { color: colors.black }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Schedule (locked from gig info) */}
        <View style={cs.field}>
          <Text style={[cs.label, { color: colors.grey }]}>SCHEDULE</Text>
          <View style={[cs.infoCard, { borderColor: colors.border }]}>
            <View style={[cs.infoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <Text style={[cs.infoKey, { color: colors.grey }]}>Set length</Text>
              <Text style={[cs.infoVal, { color: colors.black }]}>{setLengthMins > 0 ? `${setLengthMins} min` : '—'}</Text>
            </View>
            <View style={[cs.infoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <Text style={[cs.infoKey, { color: colors.grey }]}>Load-in</Text>
              <Text style={[cs.infoVal, { color: colors.black }]}>{loadInTime || '—'}</Text>
            </View>
            <View style={cs.infoRow}>
              <Text style={[cs.infoKey, { color: colors.grey }]}>Soundcheck</Text>
              <Text style={[cs.infoVal, { color: colors.black }]}>{soundCheckTime || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Fee type */}
        <View style={[cs.field, showFeeError && cs.feeErrorSection]}>
          <Text style={[cs.label, showFeeError ? { color: '#dc2626' } : { color: colors.grey }]}>
            FEE TYPE{showFeeError ? '  — required to list as booked' : ''}
          </Text>
          <View style={cs.feeGrid}>
            {FEE_TYPES.map(ft => {
              const isHighlighted = slotPayModels.includes(ft.value);
              const isSelected    = feeType === ft.value;
              return (
                <TouchableOpacity
                  key={ft.value}
                  onPress={() => setFeeType(ft.value)}
                  style={[
                    cs.feeChip,
                    { borderColor: isSelected ? Colors.orange : isHighlighted ? Colors.orange + '60' : colors.border },
                    isSelected && { backgroundColor: Colors.orange + '18' },
                  ]}
                >
                  <Text style={[cs.feeChipText, { color: isSelected ? Colors.orange : colors.black }]}>
                    {ft.label}
                  </Text>
                  {isHighlighted && !isSelected && (
                    <View style={cs.suggestedDot} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {slotPayModels.length > 0 && (
            <Text style={[cs.hint, { color: colors.grey }]}>
              Venue accepts: {slotPayModels.join(', ')}
            </Text>
          )}
        </View>

        {/* Dollar amount */}
        {showAmount && (
          <View style={cs.field}>
            <Text style={[cs.label, { color: colors.grey }]}>
              {feeType === 'guarantee_vs_door' ? 'GUARANTEE AMOUNT' : 'FEE AMOUNT'}
            </Text>
            <View style={[cs.prefixInput, { backgroundColor: colors.bgFaint, borderColor: showFeeError && !amountStr.trim() ? '#dc2626' : colors.border }]}>
              <Text style={[cs.prefixSymbol, { color: colors.black }]}>$</Text>
              <TextInput
                style={[cs.prefixTextInput, { color: colors.black }]}
                placeholder={feeRangePlaceholder}
                placeholderTextColor={Colors.greyLight}
                value={amountStr}
                onChangeText={setAmountStr}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        )}

        {/* Door split % */}
        {showDoor && (
          <View style={cs.field}>
            <Text style={[cs.label, { color: colors.grey }]}>ARTIST DOOR SPLIT (%)</Text>
            <TextInput
              style={[cs.input, { backgroundColor: colors.bgFaint, borderColor: showFeeError && !doorPercent.trim() ? '#dc2626' : colors.border, color: colors.black }]}
              placeholder="e.g. 70"
              placeholderTextColor={Colors.greyLight}
              value={doorPercent}
              onChangeText={setDoorPercent}
              keyboardType="decimal-pad"
            />
          </View>
        )}

        {/* Ticket section (collapsed unless ticket_split) */}
        {showTicket || ticketExpanded ? (
          <View style={cs.field}>
            <Text style={[cs.label, { color: colors.grey }]}>TICKET PRICE ($)</Text>
            <TextInput
              style={[cs.input, { backgroundColor: colors.bgFaint, borderColor: showFeeError && !ticketPriceStr.trim() ? '#dc2626' : colors.border, color: colors.black }]}
              placeholder="0.00"
              placeholderTextColor={Colors.greyLight}
              value={ticketPriceStr}
              onChangeText={setTicketPriceStr}
              keyboardType="decimal-pad"
            />
            <View style={{ height: 8 }} />
            <Text style={[cs.label, { color: colors.grey }]}>TICKET URL</Text>
            <TextInput
              style={[cs.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
              placeholder="https://..."
              placeholderTextColor={Colors.greyLight}
              value={ticketUrl}
              onChangeText={setTicketUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        ) : (
          !showTicket && (
            <TouchableOpacity onPress={() => setTicketExpanded(true)} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: Colors.orange }}>+ Add ticket details</Text>
            </TouchableOpacity>
          )
        )}

        {/* Fee notes */}
        <View style={cs.field}>
          <Text style={[cs.label, { color: colors.grey }]}>FEE NOTES</Text>
          <TextInput
            style={[cs.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
            placeholder="Any payment terms or conditions..."
            placeholderTextColor={Colors.greyLight}
            value={feeNotes}
            onChangeText={setFeeNotes}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />
        </View>

        {/* Payment timing */}
        {feeType !== 'unpaid' && (
          <View style={cs.field}>
            <Text style={[cs.label, { color: colors.grey }]}>PAYMENT TIMING</Text>
            <View style={cs.segmentRow}>
              {([
                { value: 'before', label: 'Before the gig' },
                { value: 'after',  label: 'After the gig'  },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setPaymentTiming(opt.value)}
                  style={[
                    cs.segment,
                    { borderColor: paymentTiming === opt.value ? Colors.orange : colors.border },
                    paymentTiming === opt.value && { backgroundColor: Colors.orange + '18' },
                  ]}
                >
                  <Text style={[cs.segmentText, { color: paymentTiming === opt.value ? Colors.orange : colors.black }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Fee includes GST */}
        {feeType !== 'unpaid' && (
          <View style={cs.field}>
            <Text style={[cs.label, { color: colors.grey }]}>FEE INCLUDES GST</Text>
            <View style={cs.segmentRow}>
              {([
                { value: true,  label: 'Yes' },
                { value: false, label: 'No'  },
                { value: null,  label: 'Not specified' },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={String(opt.value)}
                  onPress={() => setIncludesGst(opt.value)}
                  style={[
                    cs.segment,
                    { borderColor: includesGst === opt.value ? Colors.orange : colors.border },
                    includesGst === opt.value && { backgroundColor: Colors.orange + '18' },
                  ]}
                >
                  <Text style={[cs.segmentText, { color: includesGst === opt.value ? Colors.orange : colors.black }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Message to artist */}
        <View style={cs.field}>
          <Text style={[cs.label, { color: colors.grey }]}>MESSAGE TO ARTIST</Text>
          <TextInput
            style={[cs.textarea, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
            placeholder="Optional message..."
            placeholderTextColor={Colors.greyLight}
            value={confirmMsg}
            onChangeText={setConfirmMsg}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />
        </View>

        {/* Listing choice — hidden in upgrade mode (already locked to booked) */}
        {!isUpgrade && <View style={cs.field}>
          <Text style={[cs.label, { color: colors.grey }]}>TIMETABLE LISTING</Text>
          <View style={{ gap: 6 }}>
            {([
              { value: 'pending', label: 'Reserve (pending)', sub: 'slot reserved, not publicly listed yet' },
              { value: 'booked',  label: 'List as booked now', sub: 'band appears on public timetable' },
            ] as const).map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setListAsBooked(opt.value)}
                style={[cs.radioRow, { borderColor: listAsBooked === opt.value ? Colors.orange : colors.border, backgroundColor: listAsBooked === opt.value ? Colors.orange + '0d' : colors.bgFaint }]}
              >
                <View style={[cs.radioCircle, { borderColor: listAsBooked === opt.value ? Colors.orange : colors.border }]}>
                  {listAsBooked === opt.value && <View style={cs.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[cs.radioLabel, { color: colors.black }]}>{opt.label}</Text>
                  <Text style={[cs.radioSub, { color: colors.grey }]}>{opt.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>}

        {/* System message preview — hidden in upgrade mode */}
        {!isUpgrade && (
          <View style={[cs.previewRow, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
            <Text style={[cs.previewLabel, { color: colors.grey }]}>SYSTEM MESSAGE PREVIEW</Text>
            <Text style={[cs.previewText, { color: colors.grey }]}>{previewMsg}</Text>
          </View>
        )}

        {error && <Text style={cs.errorText}>{error}</Text>}
        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Footer */}
      <View style={[cs.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <TouchableOpacity
          style={[cs.cancelBtn, { borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Text style={[cs.cancelBtnText, { color: colors.black }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[cs.confirmBtn, (submitting || (feeRequired && !feeComplete)) && { opacity: 0.45 }]}
          onPress={handleConfirm}
          disabled={submitting || (feeRequired && !feeComplete)}
        >
          {submitting
            ? <ActivityIndicator color="#111111" size="small" />
            : <Text style={cs.confirmBtnText}>{isUpgrade ? 'List as Booked' : 'Confirm gig'}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isWeb) {
    return (
      <View style={cs.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => router.back()} activeOpacity={1} />
        <View style={[cs.card, cs.cardWeb, { backgroundColor: colors.bg }]}>
          {formContent}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[cs.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={cs.sheetHandle} />
      {formContent}
    </SafeAreaView>
  );
}

const cs = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  safe:        { flex: 1 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#d0d0d0', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  card:        { width: '100%', borderRadius: 16, overflow: 'hidden' as any },
  cardWeb: {
    maxWidth: 520,
    maxHeight: '92%' as any,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 40,
  },
  scroll:    { padding: 20, gap: 16 },
  scrollWeb: { padding: 28, paddingBottom: 12 },

  // Header
  formHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  headerLabel: { fontSize: 11, fontWeight: '700', color: Colors.orange, letterSpacing: 1, marginBottom: 4 },
  bandName:    { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  venueName:   { fontSize: 14, fontWeight: '600', marginTop: 2 },
  slotDetail:  { fontSize: 13, marginTop: 3 },
  closeBtn:    { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  closeBtnText: { fontSize: 14, fontWeight: '600' },

  // Fields
  field:         { gap: 6 },
  feeErrorSection: { backgroundColor: 'rgba(220,38,38,0.04)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(220,38,38,0.25)' },
  fieldRow:  { flexDirection: 'row', gap: 12 },
  label:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  hint:      { fontSize: 12, marginTop: 2 },
  input: {
    height: 44, borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, fontSize: 14,
  },
  prefixInput: {
    height: 44, borderRadius: 8, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 12,
  },
  prefixSymbol: {
    fontSize: 14, fontWeight: '600', marginRight: 2,
  },
  prefixTextInput: {
    flex: 1, height: 44, fontSize: 14, paddingRight: 12,
  },
  textarea: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 72,
  },
  lockedRow: {
    height: 44, borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  lockedText:  { fontSize: 14 },
  lockedBadge: { fontSize: 11, fontWeight: '600' },

  // Locked info card (schedule)
  infoCard: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' as const },
  infoRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 11 },
  infoKey:  { fontSize: 13, fontWeight: '500' },
  infoVal:  { fontSize: 13, fontWeight: '700' },

  // Fee type grid
  feeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  feeChip: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  feeChipText:  { fontSize: 13, fontWeight: '600' },
  suggestedDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.orange },

  // Segmented control (timing / GST)
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segment: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, flex: 1, alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '600' },

  // Set length pills
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontWeight: '600' },

  // Radio rows (listing choice)
  radioRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: 8, padding: 12,
  },
  radioCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
  radioLabel:  { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  radioSub:    { fontSize: 12 },

  // System message preview
  previewRow: {
    borderWidth: 1, borderRadius: 8,
    padding: 12, gap: 4,
  },
  previewLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  previewText:  { fontSize: 13, fontStyle: 'italic' },

  // Error
  errorText: { fontSize: 13, color: '#dc2626', textAlign: 'center' },

  // Footer
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    gap: 10, padding: 16, borderTopWidth: 1,
  },
  cancelBtn:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
  confirmBtn:    { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, minWidth: 120, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },

  // Success
  successWrap:   { padding: 32, alignItems: 'center', gap: 12 },
  successCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.orange + '20', alignItems: 'center', justifyContent: 'center' },
  successCheck:  { fontSize: 24, color: Colors.orange },
  successTitle:  { fontSize: 20, fontWeight: '800' },
  successSub:    { fontSize: 14, textAlign: 'center' },
  doneBtn:       { marginTop: 8, backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  doneBtnText:   { fontSize: 14, fontWeight: '700', color: '#111111' },
});
