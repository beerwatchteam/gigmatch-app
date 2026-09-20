import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform, Modal, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import SuburbSearch from '@/components/SuburbSearch';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { db, storage, auth } from '@/lib/firebase';
import { signOut, deleteUser } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { RepositionablePhoto } from '@/components/RepositionablePhoto';

const CANONICAL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const GENRES = ['Rock','Jazz','Blues','Pop','Indie','Electronic / DJ','Hip-Hop','Country','Acoustic / Folk','Cover Bands','Original','Classical','Metal','Other'];
const AU_STATES      = ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'];
const SLOT_TYPES     = ['Headline','Support','Open Mic','Other'];
const PAYMENT_MODELS = ['Flat fee','Door split','Guarantee + split','Bar tab','Ticket sales split','Unpaid (exposure)','Negotiable'];
const PAY_METHODS    = ['Cash','Bank transfer','PayPal','Stripe','Other'];
const PAY_TIMING     = ['Same night','Within 7 days','Within 14 days','Within 30 days','Other'];
const BACKLINE_OFFER = ['PA system','Stage monitors','Microphones + stands','Drum kit','Bass amp','Guitar amp','Keys / DI','Lighting rig'];
const INVOICE_DIRS   = ['Artist invoices venue','Venue issues RCTI to artist','Not required'];
const PL_OPTIONS     = ['Required','Preferred','Not required'];

type Room = { name: string; capacity: string; stage: string; lighting: string; pa: string; backline: string; monitoring: string; power: string; notes: string; documents: { url: string; name: string }[]; _isNew?: boolean };
type Night = {
  name: string;
  day: string; days?: string[]; startTime: string; duration: number; slotType: string;
  startDate: string; endDate: string; continuous: boolean;
  feeMin: string; feeMax: string; feeBasis: string; loadIn: string; soundcheck: string;
  room: string; genres: string[]; notes: string; paymentModel: string; paymentModels?: string[];
  doorSplit: string; coverCharge: string;
  barSplit: string;
  ticketSalesSplit: string; ticketingHandledBy: string;
  paymentMethod: string; minNotice: string;
  _isNew?: boolean;
};
type Payment = {
  models: string[];
  setFeeMin: string; setFeeMax: string; feeBasis: string;
  weekdayFeeMin: string; weekdayFeeMax: string;
  weekendFeeMin: string; weekendFeeMax: string;
  doorSplit: string; coverCharge: string; splitNotes: string;
  barSplit: string;
  ticketSalesSplit: string; ticketingHandledBy: string;
  backlineProvided: string[];
  guestListAllowance: string;
  mealsProvided: boolean; mealsNotes: string;
  paymentMethods: string[];
  timing: string; timingOther: string;
  depositRequired: boolean; depositAmount: string; depositDue: string;
  abn: string; gstRegistered: boolean; requiresArtistAbn: boolean;
  invoiceRequired: boolean;
  invoiceDirection: string;
  invoiceDocs: { url: string; name: string }[];
  cancellationTerms: string;
  publicLiability: string;
  latePaymentContact: string;
  additionalNotes: string;
};
type VenueData = {
  id?: string; name: string; streetAddress: string; location: string; suburb: string;
  state: string; postcode: string; phone: string; email: string;
  website: string; description: string; photoUrl: string;
  latitude: string; longitude: string;
  rooms: Room[]; gigNights: Night[];
  techSpecs: Record<string, any>;
  settings: { emailOnNewEnquiry: boolean; emailEnquiryReminders: boolean; listed: boolean };
  photos: string[]; videos: string[];
  payment: Payment;
  slots?: Record<string, any>;
  photoPosition?: { x: number; y: number };
};

const BLANK_PAYMENT: Payment = {
  models: [], setFeeMin: '', setFeeMax: '', feeBasis: 'Per band',
  weekdayFeeMin: '', weekdayFeeMax: '', weekendFeeMin: '', weekendFeeMax: '',
  doorSplit: '', coverCharge: '', splitNotes: '', barSplit: '',
  ticketSalesSplit: '', ticketingHandledBy: '',
  backlineProvided: [], guestListAllowance: '', mealsProvided: false, mealsNotes: '',
  paymentMethods: [], timing: '', timingOther: '',
  depositRequired: false, depositAmount: '', depositDue: '',
  abn: '', gstRegistered: false, requiresArtistAbn: false,
  invoiceRequired: true, invoiceDirection: '', invoiceDocs: [],
  cancellationTerms: '', publicLiability: '', latePaymentContact: '',
  additionalNotes: '',
};

const BLANK: VenueData = {
  name: '', streetAddress: '', location: '', suburb: '', state: '', postcode: '',
  phone: '', email: '', website: '', description: '', photoUrl: '',
  latitude: '', longitude: '',
  rooms: [], gigNights: [], techSpecs: {},
  settings: { emailOnNewEnquiry: true, emailEnquiryReminders: false, listed: true },
  photos: [], videos: [],
  payment: { ...BLANK_PAYMENT },
  photoPosition: { x: 50, y: 50 },
};

const TABS = ['Settings','Basic Info','Rooms','Timetable','Tech Specs','Payments','Photos & Videos'];

const VENUE_STEP_TAB: Record<number, string | null> = {
  1: null, 2: 'Basic Info', 3: 'Rooms', 4: 'Timetable', 5: 'Tech Specs', 6: 'Payments', 7: 'Photos & Videos', 8: null,
};

type VenueOnboardingStep = {
  title: string;
  body: string;
  body2?: string;
  fieldsLabel?: string;
  fields?: string[];
  footer?: string;
  nextLabel: string;
};

const VENUE_ONBOARDING: Record<number, VenueOnboardingStep> = {
  1: {
    title: 'Verified',
    body: "Your venue has been verified. Let's get it set up so artists can find you and book with confidence.",
    nextLabel: 'Get started',
  },
  2: {
    title: 'Profile',
    body: 'Fill in your venue details. Artists check these before they enquire, so make it count.',
    fieldsLabel: 'FIELDS TO COMPLETE',
    fields: ['Venue name', 'Address and suburb', 'Capacity', 'Genres you book', 'A short description of the vibe'],
    nextLabel: 'Next: Rooms',
  },
  3: {
    title: 'Rooms',
    body: 'Add every performance space in your venue. Artists book a specific room, not just a date, so each space needs its own setup.',
    body2: "Got a main stage, a front bar, and a courtyard? Add them all. You can manage each room's timetable separately.",
    nextLabel: 'Next: Timetable',
  },
  4: {
    title: 'Timetable',
    body: 'Add your band nights. Set recurring weekly slots or specific one-off dates, room by room.',
    body2: 'Open slots are what artists browse. The more complete your timetable, the more enquiries you\'ll get.',
    nextLabel: 'Next: Tech Specs',
  },
  5: {
    title: 'Tech Specs',
    body: "Tell artists what you're working with. This is the information they need before they can say yes to a gig.",
    fieldsLabel: 'FIELDS TO COMPLETE',
    fields: ['PA system (brand, size, output)', 'Monitoring (wedges, IEM capability)', 'Backline available (amps, drums, keys)', 'Stage dimensions', 'Load-in access and instructions', 'Soundcheck policy'],
    nextLabel: 'Next: Payment',
  },
  6: {
    title: 'Payment',
    body: 'Set your standard payment terms. Artists will see this before they send an enquiry, so be upfront.',
    fieldsLabel: 'OPTIONS',
    fields: ['Flat fee (specify range or fixed amount)', 'Door deal (specify percentage split)', 'Percentage of bar', 'No payment (exposure/residency gigs)', 'Negotiable per booking'],
    footer: 'You can override these per slot on your timetable.',
    nextLabel: 'Next: Photos',
  },
  7: {
    title: 'Photos',
    body: 'Upload photos of your venue. Artists check these before they enquire, so give them something worth looking at.',
    body2: 'Include exterior shots, the stage, and the room at capacity. Good photos convert browsers into bookings.',
    nextLabel: 'Next: Go live',
  },
  8: {
    title: 'Go Live',
    body: 'Your venue is ready. Artists can now see your open slots and send enquiries directly to your inbox.',
    body2: 'Keep your timetable up to date and respond to enquiries promptly. Artists notice.',
    nextLabel: 'Go to my timetable',
  },
};

// ── Shared sub-components ────────────────────────────────────────

function Field({ label, error, helper, children }: { label: string; error?: boolean; helper?: string; children: React.ReactNode }) {
  return (
    <View style={field.wrap}>
      <Text style={[field.label, error && { color: Colors.danger }]}>{label}</Text>
      {children}
      {helper && <Text style={{ fontSize: 12, color: Colors.grey, marginTop: 5, lineHeight: 17 }}>{helper}</Text>}
    </View>
  );
}
const field = StyleSheet.create({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
});

function Input({ value, onChangeText, placeholder, multiline, autoGrow, keyboardType, error }: any) {
  const { colors } = useTheme();
  return (
    <TextInput
      style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }, multiline && s.textarea, error && s.inputError]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={Colors.greyLight}
      multiline={multiline || autoGrow}
      numberOfLines={multiline ? 4 : 1}
      keyboardType={keyboardType}
      autoCapitalize="none"
      textAlignVertical={(multiline || autoGrow) ? 'top' : 'auto'}
    />
  );
}

function CurrencyInput({ value, onChangeText, placeholder, error }: any) {
  const { colors } = useTheme();
  return (
    <View style={[s.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0, paddingVertical: 0, backgroundColor: colors.bgFaint, borderColor: error ? Colors.danger : colors.border }]}>
      <Text style={{ paddingLeft: 12, fontSize: 14, color: colors.black, fontWeight: '500' }}>$</Text>
      <TextInput
        style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 12, fontSize: 14, color: colors.black }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || '0'}
        placeholderTextColor={Colors.greyLight}
        keyboardType="numeric"
        autoCapitalize="none"
      />
    </View>
  );
}

function Select({ options, value, onSelect }: { options: string[]; value: string; onSelect: (v: string) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerViewRef = { current: null as View | null };

  function handlePress() {
    if (Platform.OS !== 'web') {
      Alert.alert('Select', undefined, [
        ...options.map(opt => ({ text: opt, onPress: () => onSelect(opt) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    } else {
      if (!open && triggerViewRef.current) {
        (triggerViewRef.current as any).measureInWindow((x: number, y: number, width: number, height: number) => {
          setLayout({ x, y, width, height });
          setOpen(true);
        });
      } else {
        setOpen(o => !o);
      }
    }
  }

  return (
    <View ref={(r) => { triggerViewRef.current = r; }}>
      <TouchableOpacity
        onPress={handlePress}
        style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 }]}
      >
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight }}>{value || 'Select…'}</Text>
        <Text style={{ fontSize: 10, color: Colors.grey, marginLeft: 4 }}>▼</Text>
      </TouchableOpacity>
      {open && layout && (
        <Modal transparent animationType="none" onRequestClose={() => setOpen(false)}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpen(false)}>
            <View style={{ position: 'absolute', top: layout.y + layout.height + 4, left: layout.x, width: layout.width, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12 }}>
              {options.map((opt, i) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => { onSelect(opt); setOpen(false); }}
                  style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < options.length - 1 ? 1 : 0, borderBottomColor: colors.borderFaint, backgroundColor: opt === value ? 'rgba(250,131,12,0.06)' : 'transparent' }}
                >
                  <Text style={{ fontSize: 14, color: opt === value ? Colors.orange : colors.black, fontWeight: opt === value ? '700' : '400' }}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS_SHORT  = ['S','M','T','W','T','F','S'];
const DAY_NAMES_DOW: Record<string, number> = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };

function DatePicker({ value, onChange, allowedDays, rangeStart }: { value: string; onChange: (v: string) => void; allowedDays?: number[]; rangeStart?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const parsedVal = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { y: +value.slice(0,4), m: +value.slice(5,7)-1, d: +value.slice(8,10) }
    : null;

  const parsedRangeStart = rangeStart && /^\d{4}-\d{2}-\d{2}$/.test(rangeStart)
    ? { y: +rangeStart.slice(0,4), m: +rangeStart.slice(5,7)-1, d: +rangeStart.slice(8,10) }
    : null;

  const todayD = new Date(); todayD.setHours(0,0,0,0);
  const [viewYear,  setViewYear]  = useState(parsedVal?.y ?? todayD.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsedVal?.m ?? todayD.getMonth());

  function handleOpen() {
    if (parsedVal) {
      setViewYear(parsedVal.y); setViewMonth(parsedVal.m);
    } else if (parsedRangeStart) {
      setViewYear(parsedRangeStart.y); setViewMonth(parsedRangeStart.m);
    } else {
      setViewYear(todayD.getFullYear()); setViewMonth(todayD.getMonth());
    }
    setOpen(true);
  }

  const display = parsedVal
    ? `${String(parsedVal.d).padStart(2,'0')}/${String(parsedVal.m+1).padStart(2,'0')}/${parsedVal.y}`
    : '--/--/----';

  const cells: (number|null)[] = (() => {
    const first = new Date(viewYear, viewMonth, 1).getDay();
    const total = new Date(viewYear, viewMonth+1, 0).getDate();
    const arr: (number|null)[] = Array(first).fill(null);
    for (let ci = 1; ci <= total; ci++) arr.push(ci);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  })();

  function isAllowed(d: number) {
    if (!allowedDays?.length) return true;
    return allowedDays.includes(new Date(viewYear, viewMonth, d).getDay());
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
      <TouchableOpacity onPress={handleOpen} style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 }]}>
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight }}>{display}</Text>
        <Text style={{ fontSize: 11, color: Colors.grey }}>📅</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 20, width: '100%', maxWidth: 340, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <TouchableOpacity onPress={prevMonth} style={{ padding: 8, minWidth: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, color: Colors.orange, lineHeight: 26 }}>‹</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.black }}>{MONTH_NAMES_FULL[viewMonth]} {viewYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={{ padding: 8, minWidth: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, color: Colors.orange, lineHeight: 26 }}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {DOW_LABELS_SHORT.map((lbl, li) => (
                <View key={li} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, letterSpacing: 0.5 }}>{lbl}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, idx) => {
                if (d === null) return <View key={idx} style={{ width: '14.28%' as any }} />;
                const allowed = isAllowed(d);
                const sel = parsedVal?.y === viewYear && parsedVal?.m === viewMonth && parsedVal?.d === d;
                const isTdy = todayD.getFullYear() === viewYear && todayD.getMonth() === viewMonth && todayD.getDate() === d;
                const isRangeStart = parsedRangeStart?.y === viewYear && parsedRangeStart?.m === viewMonth && parsedRangeStart?.d === d;
                return (
                  <TouchableOpacity key={idx} onPress={() => pick(d)} activeOpacity={allowed ? 0.7 : 1} style={{ width: '14.28%' as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{
                      width: 32, height: 32, borderRadius: 16,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: sel ? Colors.orange : 'transparent',
                      borderWidth: (isTdy && !sel) || (isRangeStart && !sel) ? 1.5 : 0,
                      borderColor: isRangeStart && !sel ? Colors.grey : Colors.orange,
                      borderStyle: isRangeStart && !sel && !isTdy ? 'dashed' : 'solid',
                    }}>
                      <Text style={{ fontSize: 13, color: !allowed ? colors.border : sel ? '#fff' : isTdy ? Colors.orange : isRangeStart ? Colors.grey : colors.black, fontWeight: sel || isRangeStart ? '700' : '400' }}>{d}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {parsedRangeStart && (
              <Text style={{ fontSize: 11, color: Colors.grey, textAlign: 'center', marginTop: 10, lineHeight: 16 }}>
                Start date: {String(parsedRangeStart.d).padStart(2,'0')}/{String(parsedRangeStart.m+1).padStart(2,'0')}/{parsedRangeStart.y}. Same day is allowed for a one-off event.
              </Text>
            )}
            {!parsedRangeStart && (allowedDays?.length ?? 0) > 0 && (
              <Text style={{ fontSize: 11, color: Colors.grey, textAlign: 'center', marginTop: 10, lineHeight: 16 }}>
                Only dates matching your selected {allowedDays!.length === 1 ? 'day' : 'days'} are selectable.
              </Text>
            )}
            <TouchableOpacity onPress={() => setOpen(false)} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.grey }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimePicker({ value, onChange, defaultValue = '00:00' }: { value: string; onChange: (v: string) => void; defaultValue?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const hourScrollRef = useRef<ScrollView>(null);

  const parse = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return { hour: h % 12 || 12, minute: m, ampm: h >= 12 ? 'PM' : 'AM' };
  };
  const to24hr = (h: number, m: number, ap: string) => {
    const h24 = ap === 'PM' ? (h % 12) + 12 : h % 12;
    return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  const display = (v: string) => {
    if (!v) return '--:-- --';
    const { hour, minute, ampm } = parse(v);
    return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
  };

  function handleOpen() {
    const initial = value || defaultValue;
    setDraft(initial);
    setOpen(true);
    // Scroll hours to selected hour after modal renders
    const { hour } = parse(initial);
    setTimeout(() => {
      hourScrollRef.current?.scrollTo({ y: (hour - 1) * 20, animated: false });
    }, 50);
  }

  const { hour, minute, ampm } = parse(draft || defaultValue);
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  return (
    <View>
      <TouchableOpacity
        onPress={handleOpen}
        style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 }]}
      >
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight }}>{display(value)}</Text>
        <Text style={{ fontSize: 11, color: Colors.grey }}>◷</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 24, width: 300, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.black, marginBottom: 4 }}>Select Time</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 20 }}>{display(draft)}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {/* Hours */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Hour</Text>
                <ScrollView ref={hourScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {hours.map(h => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => setDraft(to24hr(h, minute, ampm))}
                      style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: h === hour ? Colors.orange : 'transparent', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: h === hour ? '#fff' : colors.black, fontWeight: h === hour ? '700' : '400' }}>{h}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* Minutes */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Min</Text>
                <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {minutes.map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setDraft(to24hr(hour, m, ampm))}
                      style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: m === minute ? Colors.orange : 'transparent', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: m === minute ? '#fff' : colors.black, fontWeight: m === minute ? '700' : '400' }}>{String(m).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* AM/PM */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}> </Text>
                <View style={{ gap: 6 }}>
                  {(['AM', 'PM'] as const).map(ap => (
                    <TouchableOpacity
                      key={ap}
                      onPress={() => setDraft(to24hr(hour, minute, ap))}
                      style={{ paddingVertical: 12, borderRadius: 8, backgroundColor: ap === ampm ? Colors.orange : colors.bgFaint, borderWidth: 1, borderColor: ap === ampm ? Colors.orange : colors.border, alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: ap === ampm ? '#fff' : colors.black, fontWeight: ap === ampm ? '700' : '400' }}>{ap}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ color: colors.black, fontWeight: '600', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { onChange(draft); setOpen(false); }}
                style={{ flex: 2, backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Pills({ options, value, onSelect, multi }: { options: string[]; value: string | string[]; onSelect: (v: any) => void; multi?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const active = multi ? (value as string[]).includes(opt) : value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[s.pill, { borderColor: colors.border }, active && s.pillActive]}
            onPress={() => {
              if (multi) {
                const arr = value as string[];
                onSelect(active ? arr.filter(x => x !== opt) : [...arr, opt]);
              } else {
                onSelect(opt);
              }
            }}
          >
            <Text style={[s.pillText, { color: colors.black }, active && s.pillTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Cross-platform confirm dialog (Alert.alert is a no-op on web)
function crossConfirm(title: string, message: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    if ((window as any).confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: destructive ? 'Delete' : 'Confirm', style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  }
}

// ── Main component ────────────────────────────────────────────────

export default function EditVenueScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, isDark, toggleDark } = useTheme();
  const { agentVenueId } = useLocalSearchParams<{ agentVenueId?: string }>();
  const isAgentEdit = !!agentVenueId && profile?.type === 'agent';
  const venueId = (agentVenueId as string) || (profile?.venueId ?? '');
  const activeTabs = isAgentEdit ? TABS.filter(t => t !== 'Settings') : TABS;

  const [data, setData]           = useState<VenueData>(BLANK);
  const [saved, setSaved]         = useState<VenueData>(BLANK);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [activeTab, setActiveTab] = useState(isAgentEdit ? 'Basic Info' : 'Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors, setTabErrors]   = useState<string[]>([]);
  const [expandedRoom,  setExpandedRoom]  = useState<number | null>(null);
  const [expandedNight, setExpandedNight] = useState<number | null>(null);

  const [photoUploading, setPhotoUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [roomDocUploading, setRoomDocUploading] = useState<number | null>(null);
  const [stageDocUploading, setStageDocUploading] = useState(false);
  const [invoiceDocUploading, setInvoiceDocUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [showStickySave, setShowStickySave] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingVisited, setOnboardingVisited] = useState<string[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const titleBarBottomRef = useRef(Infinity);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) {
        const d = { ...BLANK, id: snap.id, ...snap.data() } as VenueData;
        d.rooms     = d.rooms     || [];
        d.gigNights = (d.gigNights || []).map((n: any) => ({
          ...n,
          name: n.name || '',
          days: n.days?.length ? n.days : (n.day ? [n.day] : []),
        }));
        d.photos    = d.photos    || [];
        d.videos    = d.videos    || [];
        d.settings  = d.settings  || BLANK.settings;
        d.payment   = d.payment   ? { ...BLANK_PAYMENT, ...d.payment } : { ...BLANK_PAYMENT };
        // Back-fill location from suburb/state/postcode for existing venues
        if (!d.location && d.suburb) {
          d.location = [d.suburb, d.state, d.postcode].filter(Boolean).join(', ');
        }
        setData(d); setSaved(d);
        const isComplete = snap.data().onboardingComplete === true;
        setOnboardingComplete(isComplete);
        if (!isComplete) setOnboardingStep(1);
      }
    }).finally(() => setLoading(false));
  }, [venueId]);

  function set<K extends keyof VenueData>(field: K, value: VenueData[K]) {
    setJustSaved(false);
    setData(prev => ({ ...prev, [field]: value }));
  }

  function setPayment<K extends keyof Payment>(field: K, value: Payment[K]) {
    setJustSaved(false);
    setData(prev => ({ ...prev, payment: { ...prev.payment, [field]: value } }));
  }

  // ── Rooms ──
  function setRoom(i: number, field: keyof Room, val: string) {
    setData(prev => ({ ...prev, rooms: prev.rooms.map((r, idx) => idx === i ? { ...r, [field]: val } : r) }));
  }
  function addRoom() {
    setData(prev => {
      const rooms = [...prev.rooms, { name: '', capacity: '', stage: '', lighting: '', pa: '', backline: '', monitoring: '', power: '', notes: '', documents: [], _isNew: true }];
      setExpandedRoom(rooms.length - 1);
      return { ...prev, rooms };
    });
  }
  function removeRoom(i: number) {
    setData(prev => ({ ...prev, rooms: prev.rooms.filter((_, idx) => idx !== i) }));
    setExpandedRoom(null);
  }

  // ── Gig Nights ──
  function setNight(i: number, field: keyof Night, val: any) {
    setJustSaved(false);
    setData(prev => ({ ...prev, gigNights: prev.gigNights.map((n, idx) => idx === i ? { ...n, [field]: val } : n) }));
  }
  function setNightFields(i: number, fields: Partial<Night>) {
    setJustSaved(false);
    setData(prev => ({ ...prev, gigNights: prev.gigNights.map((n, idx) => idx === i ? { ...n, ...fields } : n) }));
  }
  function subtractMinutes(time: string, mins: number): string {
    const [h, m] = time.split(':').map(Number);
    const total = ((h * 60 + m - mins) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  function addNight() {
    const usedDays = data.gigNights.map(n => n.day);
    const day = CANONICAL_DAYS.find(d => !usedDays.includes(d)) || 'Monday';
    setData(prev => {
      const nights = [...prev.gigNights, {
        name: '', day, days: [day], startTime: '', duration: 60, slotType: 'Headline',
        startDate: '', endDate: '', continuous: true,
        feeMin: '', feeMax: '', feeBasis: '', loadIn: '', soundcheck: '',
        room: '', genres: [], notes: '', paymentModel: '', paymentModels: [],
        doorSplit: '', coverCharge: '', barSplit: '', ticketSalesSplit: '', ticketingHandledBy: '',
        paymentMethod: '', minNotice: '',
        _isNew: true,
      }];
      setExpandedNight(nights.length - 1);
      return { ...prev, gigNights: nights };
    });
  }
  function removeNight(i: number) {
    setData(prev => ({ ...prev, gigNights: prev.gigNights.filter((_, idx) => idx !== i) }));
    setExpandedNight(null);
  }

  function sortedNights(nights: Night[]) {
    return [...nights].sort((a, b) => {
      const da = (a.days?.length ? a.days[0] : a.day) || '';
      const db = (b.days?.length ? b.days[0] : b.day) || '';
      return CANONICAL_DAYS.indexOf(da) - CANONICAL_DAYS.indexOf(db);
    });
  }

  function nightPaymentSummary(night: Night): string {
    const models = night.paymentModels?.length ? night.paymentModels : (night.paymentModel ? [night.paymentModel] : []);
    if (!models.length) return '';
    const parts: string[] = [];
    if (models.includes('Flat fee') && night.feeMin) {
      const range = night.feeMax && night.feeMax !== night.feeMin ? `$${night.feeMin}–$${night.feeMax}` : `$${night.feeMin}`;
      parts.push(`${range} flat fee`);
      const others = models.filter(m => m !== 'Flat fee');
      if (others.length) parts.push(...others);
    } else {
      parts.push(...models);
    }
    if (night.paymentMethod) parts.push(night.paymentMethod);
    return parts.join(' · ');
  }

  function addVideo() {
    const url = newVideoUrl.trim();
    if (!url) return;
    set('videos', [...(data.videos || []), url]);
    setNewVideoUrl('');
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `riders/${venueId}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('techSpecs', { ...data.techSpecs, documents: [...(data.techSpecs?.documents || []), { url, name: asset.name }] });
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setDocUploading(false);
    }
  }

  async function pickRoomDocument(roomIndex: number) {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setRoomDocUploading(roomIndex);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `rooms/${venueId}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      setData(prev => ({
        ...prev,
        rooms: prev.rooms.map((r, idx) =>
          idx === roomIndex ? { ...r, documents: [...(r.documents || []), { url, name: asset.name }] } : r
        ),
      }));
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setRoomDocUploading(null);
    }
  }

  async function pickStagePlotDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setStageDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `stageplots/${venueId}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('techSpecs', { ...data.techSpecs, stageDocs: [...(data.techSpecs?.stageDocs || []), { url, name: asset.name }] });
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setStageDocUploading(false);
    }
  }

  async function pickInvoiceDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setInvoiceDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `invoices/${venueId}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      setPayment('invoiceDocs', [...(data.payment.invoiceDocs || []), { url, name: asset.name }]);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setInvoiceDocUploading(false);
    }
  }

  async function pickVideoFile() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    setVideoUploading(true);
    try {
      const uri  = result.assets[0].uri;
      const res  = await fetch(uri);
      const blob = await res.blob();
      const ref  = sRef(storage, `photos/venues/${venueId}/gallery/${Date.now()}.mp4`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('videos', [...(data.videos || []), url]);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setVideoUploading(false);
    }
  }

  // ── Photo upload ──
  async function pickBannerPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUploading(true);
    try {
      const uri = result.assets[0].uri;
      const res  = await fetch(uri);
      const blob = await res.blob();
      const ref  = sRef(storage, `photos/venues/${venueId}/photo`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      // Sync into photos gallery: replace old profile photo entry, or prepend
      const oldUrl    = data.photoUrl;
      const existing  = data.photos || [];
      const nextPhotos = oldUrl && existing.includes(oldUrl)
        ? existing.map((p: string) => p === oldUrl ? url : p)
        : [url, ...existing];
      set('photoUrl', url);
      set('photos', nextPhotos);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setPhotoUploading(false);
    }
  }

  async function addGalleryPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    try {
      const uri  = result.assets[0].uri;
      const res  = await fetch(uri);
      const blob = await res.blob();
      const ref  = sRef(storage, `photos/venues/${venueId}/gallery/${Date.now()}.jpg`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('photos', [...data.photos, url]);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    }
  }

  // ── Save ──
  async function handleSave() {
    setShowErrors(true);
    const errors: string[] = [];
    if (!data.name?.trim() || !data.streetAddress?.trim() || !data.location?.trim() ||
        !data.email?.trim() || !data.phone?.trim() || !data.website?.trim())
      errors.push('Basic Info');
    if (data.rooms.some(r => !r.name?.trim() || !r.capacity?.toString().trim()))
      errors.push('Rooms');
    if (data.gigNights.some(n => !(n.days?.length || n.day) || !n.startTime || !n.startDate || (!n.continuous && !n.endDate)))
      errors.push('Timetable');

    if (errors.length > 0) { setTabErrors(errors); return; }
    setTabErrors([]);
    setSaving(true);

    try {
      const { id, ...fields } = data as any;
      fields.rooms = data.rooms.map(({ _isNew, ...r }: any) => r);
      fields.gigNights = data.gigNights.map(({ _isNew, ...n }: any) => n);
      const existingSlots = data.slots || {};
      const newSlots: Record<string, any> = {};
      CANONICAL_DAYS.forEach(day => {
        const keepers = (existingSlots[day] || []).filter((s: any) => s.date || s.status !== 'open');
        const nightsForDay = data.gigNights.filter(n => {
          const allDays = n.days?.length ? n.days : (n.day ? [n.day] : []);
          return allDays.includes(day) && n.startTime;
        });
        const openSlots = nightsForDay.map((night, idx) => {
          const [h, m] = (night.startTime || '00:00').split(':').map(Number);
          const period = h >= 12 ? 'PM' : 'AM';
          const time   = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
          return {
            id: `open-${day.toLowerCase()}-${idx}`,
            time, status: 'open',
            name: night.name || '',
            slotType: night.slotType || 'Headline',
            room: night.room || '',
            feeMin: night.feeMin !== '' ? Number(night.feeMin) : null,
            feeMax: night.feeMax !== '' ? Number(night.feeMax) : null,
            feeBasis: night.feeBasis || '',
            paymentModels: night.paymentModels?.length ? night.paymentModels : (night.paymentModel ? [night.paymentModel] : []),
            paymentMethod: night.paymentMethod || '',
            genres: night.genres || [],
            duration: night.duration || 60,
            loadIn: night.loadIn || '', soundcheck: night.soundcheck || '',
            notes: night.notes || '',
            startDate: night.startDate || '',
            endDate: night.endDate || '',
            continuous: night.continuous !== false,
            minNotice: night.minNotice || '',
          };
        });
        const combined = [...keepers, ...openSlots];
        if (combined.length > 0) newSlots[day] = combined;
      });

      await updateDoc(doc(db, 'venues', venueId), { ...fields, slots: newSlots });
      setSaved(data);
      setData(prev => ({
        ...prev,
        rooms: prev.rooms.map(({ _isNew, ...r }: any) => r),
        gigNights: prev.gigNights.map(({ _isNew, ...n }: any) => n),
      }));
      setShowErrors(false);
      setJustSaved(true);
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/venue/${venueId}` as any);
    }
  }

  function handleBack() {
    const isDirty = JSON.stringify(data) !== JSON.stringify(saved);
    if (isDirty) {
      crossConfirm('Unsaved changes', 'Any unsaved changes will be lost. Are you sure?', goBack, true);
      return;
    }
    const hasErrors =
      !data.name?.trim() || !data.streetAddress?.trim() || !data.location?.trim() ||
      !data.email?.trim() || !data.phone?.trim() || !data.website?.trim();
    if (hasErrors) {
      setShowErrors(true);
      crossConfirm('Venue profile incomplete', "Some required fields are missing. Your venue won't be visible until complete. Leave anyway?", goBack, true);
      return;
    }
    goBack();
  }

  function advanceOnboarding() {
    if (onboardingStep === 8) { finishOnboarding(); return; }
    const curTab = VENUE_STEP_TAB[onboardingStep];
    if (curTab) setOnboardingVisited(prev => prev.includes(curTab) ? prev : [...prev, curTab]);
    const next = onboardingStep + 1;
    const nextTab = VENUE_STEP_TAB[next];
    if (nextTab && nextTab !== activeTab) setActiveTab(nextTab);
    setOnboardingStep(next);
  }

  function backOnboarding() {
    if (onboardingStep <= 1) return;
    const prev = onboardingStep - 1;
    const prevTab = VENUE_STEP_TAB[prev];
    if (prevTab && prevTab !== activeTab) setActiveTab(prevTab);
    setOnboardingStep(prev);
  }

  async function skipOnboarding() {
    setOnboardingStep(0);
    setOnboardingComplete(true);
    updateDoc(doc(db, 'venues', venueId), { onboardingComplete: true }).catch(() => {});
  }

  function finishOnboarding() {
    setOnboardingStep(0);
    setOnboardingComplete(true);
    setActiveTab('Timetable');
    updateDoc(doc(db, 'venues', venueId), { onboardingComplete: true }).catch(() => {});
  }

  function replayOnboarding() {
    setOnboardingVisited([]);
    setActiveTab('Basic Info');
    setOnboardingStep(1);
  }

  const isWeb = Platform.OS === 'web';
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;

  if (loading) return <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>;

  if (!venueId) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <View style={s.center}>
          <Text style={[s.emptyText, { color: colors.black }]}>No venue linked to your account.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isWeb && !isMobileLayout) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <View style={evd.row}>

          {/* Sidebar */}
          <View style={[evd.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
            <TouchableOpacity onPress={pickBannerPhoto} activeOpacity={0.8} style={evd.photoWrap}>
              {photoUploading
                ? <View style={[evd.photo, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                    <ActivityIndicator color={Colors.orange} />
                  </View>
                : data.photoUrl
                  ? <Image source={{ uri: data.photoUrl }} style={evd.photo} resizeMode="cover" />
                  : <View style={[evd.photo, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 11, color: colors.grey, textAlign: 'center' }}>Add photo</Text>
                    </View>}
            </TouchableOpacity>
            <Text style={[evd.name, { color: colors.black }]} numberOfLines={2}>
              {data.name || 'Your venue'}
            </Text>
            {data.location ? (
              <Text style={[evd.sub, { color: colors.grey }]}>{data.location}</Text>
            ) : null}

            <View style={[evd.divider, { backgroundColor: colors.border }]} />

            {activeTabs.map(tab => (
              <TouchableOpacity
                key={tab}
                style={[evd.navItem, activeTab === tab && evd.navItemActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.75}
              >
                <View style={evd.navRow}>
                  <Text style={[evd.navText, { color: activeTab === tab ? Colors.orange : colors.black }]}>
                    {tab}
                  </Text>
                  {onboardingStep > 0 && onboardingVisited.includes(tab)
                    ? <Text style={evd.navCheck}>✓</Text>
                    : tabErrors.includes(tab) && <View style={evd.navErrorDot} />
                  }
                </View>
              </TouchableOpacity>
            ))}

            <View style={[evd.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={[evd.saveBtn, saving && { opacity: 0.6 }, justSaved && { backgroundColor: '#22c55e' }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={evd.saveBtnText}>{saving ? 'Saving...' : justSaved ? 'Saved ✓' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[evd.backBtn, { borderColor: colors.border }]}
              onPress={handleBack}
              activeOpacity={0.75}
            >
              <Text style={[evd.backBtnText, { color: colors.black }]}>Back</Text>
            </TouchableOpacity>
          </View>

          {/* Main content */}
          <ScrollView style={evd.main} showsVerticalScrollIndicator={false} contentContainerStyle={evd.mainContent}>
            {tabErrors.length > 0 && (
              <View style={[s.tabErrors, { marginBottom: 24, borderRadius: 8 }]}>
                <Text style={s.tabErrorsLabel}>Please complete: </Text>
                {tabErrors.map(t => <Text key={t} style={s.tabErrorPill}>{t}</Text>)}
              </View>
            )}

            {/* ── SETTINGS ── */}
            {activeTab === 'Settings' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Notification Preferences</Text>
                <TouchableOpacity style={[s.checkRow, { borderBottomColor: colors.borderFaint }]} onPress={() => set('settings', { ...data.settings, emailOnNewEnquiry: !data.settings.emailOnNewEnquiry })}>
                  <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailOnNewEnquiry && s.checkboxChecked]}>{data.settings.emailOnNewEnquiry && <Text style={s.checkmark}>✓</Text>}</View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>Email me when new enquiry is received</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.checkRow, { borderBottomColor: colors.borderFaint }]} onPress={() => set('settings', { ...data.settings, emailEnquiryReminders: !data.settings.emailEnquiryReminders })}>
                  <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailEnquiryReminders && s.checkboxChecked]}>{data.settings.emailEnquiryReminders && <Text style={s.checkmark}>✓</Text>}</View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>Email me enquiry reminders</Text>
                </TouchableOpacity>
                <Text style={[s.sectionTitle, { color: colors.black, marginTop: 24 }]}>Account</Text>
                <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
                  <Text style={[s.toggleLabel, { color: colors.black }]}>Dark Mode</Text>
                  <Switch value={isDark} onValueChange={toggleDark} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#ffffff" />
                </View>
                <TouchableOpacity style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]} onPress={async () => { await signOut(auth); router.replace('/'); }}>
                  <Text style={[s.toggleLabel, { color: Colors.danger }]}>Log out</Text>
                </TouchableOpacity>
                <View style={[s.dangerSection, { borderColor: Colors.danger + '44' }]}>
                  <Text style={s.dangerTitle}>Danger Zone</Text>
                  <Text style={[s.dangerDesc, { color: colors.black }]}>Deactivating your listing will hide it from all bands browsing Twaylo. This action can be reversed at any time.</Text>
                  <TouchableOpacity style={[s.dangerBtn, data.settings.listed ? {} : s.dangerBtnActive]} onPress={() => { const willDeactivate = data.settings.listed; crossConfirm(willDeactivate ? 'Deactivate Venue Listing?' : 'Reactivate Venue Listing?', willDeactivate ? 'Are you sure? This will deactivate your account and hide it from view. You can reactivate at any time.' : 'This will make your venue visible to musicians again.', async () => { const { venueId } = profile ?? {}; if (!venueId) return; const newListed = !willDeactivate; await updateDoc(doc(db, 'venues', venueId), { 'settings.listed': newListed }); set('settings', { ...data.settings, listed: newListed }); }, willDeactivate); }}>
                    <Text style={s.dangerBtnText}>{data.settings.listed ? 'Deactivate Venue Listing' : 'Reactivate Venue Listing'}</Text>
                  </TouchableOpacity>
                  <Text style={[s.dangerDesc, { color: colors.grey, marginTop: 20 }]}>Permanently delete your venue and account. This action cannot be undone.</Text>
                  <TouchableOpacity style={[s.dangerBtn, s.dangerBtnActive]} onPress={() => { crossConfirm('Delete Account', 'This will permanently delete your venue profile and account from the database. This action cannot be undone.', async () => { try { const { venueId, uid } = profile ?? {}; if (venueId) await deleteDoc(doc(db, 'venues', venueId)); if (uid) { await deleteDoc(doc(db, 'users', uid)); await deleteDoc(doc(db, 'venueApplications', uid)); } const cu = auth.currentUser; if (cu) await deleteUser(cu); } catch (e: any) { Alert.alert('Error', e.message ?? 'Could not delete account. Please try again.'); } finally { await signOut(auth).catch(() => {}); router.replace('/'); } }, true); }}>
                    <Text style={s.dangerBtnText}>Delete Account</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── BASIC INFO ── */}
            {activeTab === 'Basic Info' && (
              <View style={s.section}>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Venue Details</Text>
                  <Field label="Venue name *" error={showErrors && !data.name?.trim()}><Input value={data.name} onChangeText={(v: string) => set('name', v)} placeholder="Venue name" error={showErrors && !data.name?.trim()} /></Field>
                  <Field label="Street address *" error={showErrors && !data.streetAddress?.trim()}><Input value={data.streetAddress} onChangeText={(v: string) => set('streetAddress', v)} placeholder="123 Main St" error={showErrors && !data.streetAddress?.trim()} /></Field>
                  <Field label="Location *" error={showErrors && !data.location?.trim()}><SuburbSearch value={data.location} onChange={(v: string) => set('location', v)} onAutofill={(suburb, state, postcode) => { set('location', [suburb, state, postcode].filter(Boolean).join(', ')); set('suburb', suburb); set('state', state); set('postcode', postcode); }} error={showErrors && !data.location?.trim()} /></Field>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Map Coordinates</Text>
                  <Text style={{ fontSize: 13, color: colors.grey, marginBottom: 12, lineHeight: 18 }}>Internal only. Not shown publicly. Used for future map features.</Text>
                  <Field label="Latitude"><Input value={data.latitude} onChangeText={(v: string) => set('latitude', v)} placeholder="e.g. -33.8688" keyboardType="decimal-pad" /></Field>
                  <Field label="Longitude"><Input value={data.longitude} onChangeText={(v: string) => set('longitude', v)} placeholder="e.g. 151.2093" keyboardType="decimal-pad" /></Field>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Contact</Text>
                  <Field label="Email *" error={showErrors && !data.email?.trim()}><Input value={data.email} onChangeText={(v: string) => set('email', v)} placeholder="Email *" keyboardType="email-address" error={showErrors && !data.email?.trim()} /></Field>
                  <Field label="Phone number *" error={showErrors && !data.phone?.trim()}><Input value={data.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone *" keyboardType="phone-pad" error={showErrors && !data.phone?.trim()} /></Field>
                  <Field label="Website *" error={showErrors && !data.website?.trim()}><Input value={data.website} onChangeText={(v: string) => set('website', v)} placeholder="Website *" error={showErrors && !data.website?.trim()} /></Field>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Description</Text>
                  <Input value={data.description} onChangeText={(v: string) => set('description', v)} placeholder="Tell musicians about your venue…" multiline />
                </View>
              </View>
            )}

            {/* ── ROOMS ── */}
            {activeTab === 'Rooms' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Rooms</Text>
                <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Add the spaces at your venue where live music happens. PA, lighting rig, and stage dimensions are entered per room, since they can differ between spaces.</Text>
                {data.rooms.map((room, i) => {
                  const isOpen = expandedRoom === i;
                  const hasError = showErrors && (!room.name?.trim() || !room.capacity?.toString().trim());
                  return (
                    <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                      <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedRoom(isOpen ? null : i)}>
                        <Text style={s.cardHeaderText}>{room.name || 'Unnamed room'}{room.capacity ? ` · Cap. ${room.capacity}` : ''}</Text>
                        <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {isOpen && (
                        <View style={{ paddingTop: 14, gap: 12 }}>
                          <Field label="Room name *" error={showErrors && !room.name?.trim()}><Input value={room.name} onChangeText={(v: string) => setRoom(i, 'name', v)} placeholder="e.g. Main Room" error={showErrors && !room.name?.trim()} /></Field>
                          <Field label="Capacity *" error={showErrors && !room.capacity?.toString().trim()}><Input value={room.capacity} onChangeText={(v: string) => setRoom(i, 'capacity', v)} placeholder="e.g. 200" keyboardType="numeric" error={showErrors && !room.capacity?.toString().trim()} /></Field>
                          <Field label="Stage & Dimensions"><Input value={room.stage} onChangeText={(v: string) => setRoom(i, 'stage', v)} placeholder="e.g. Elevated stage, 6m x 4m" autoGrow /></Field>
                          <Field label="Lighting"><Input value={room.lighting} onChangeText={(v: string) => setRoom(i, 'lighting', v)} placeholder="e.g. Full rig with follow spot" autoGrow /></Field>
                          <Field label="PA System"><Input value={room.pa} onChangeText={(v: string) => setRoom(i, 'pa', v)} placeholder="e.g. d&b audiotechnik J-Series" autoGrow /></Field>
                          <Field label="Backline"><Input value={room.backline} onChangeText={(v: string) => setRoom(i, 'backline', v)} placeholder="e.g. house drum kit, 2x guitar amps" autoGrow /></Field>
                          <Field label="Monitoring"><Input value={room.monitoring} onChangeText={(v: string) => setRoom(i, 'monitoring', v)} placeholder="e.g. 4x wedges, 2 mixes" autoGrow /></Field>
                          <Field label="Power"><Input value={room.power} onChangeText={(v: string) => setRoom(i, 'power', v)} placeholder="e.g. 4x 15A outlets on stage" autoGrow /></Field>
                          <Field label="Notes for Acts"><Input value={room.notes} onChangeText={(v: string) => setRoom(i, 'notes', v)} placeholder="Anything acts should know about this room" multiline /></Field>
                          <Field label="Tech Spec Documents">
                            {(room.documents || []).map((doc, idx) => (
                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name || doc.url}</Text>
                                <TouchableOpacity style={s.removeBtn} onPress={() => setRoom(i, 'documents', (room.documents || []).filter((_: any, di: number) => di !== idx))}><Text style={s.removeBtnText}>Remove</Text></TouchableOpacity>
                              </View>
                            ))}
                            <TouchableOpacity style={s.addBtn} onPress={() => pickRoomDocument(i)} disabled={roomDocUploading === i}>
                              <Text style={s.addBtnText}>{roomDocUploading === i ? 'Uploading…' : '+ Add Document'}</Text>
                            </TouchableOpacity>
                          </Field>
                          <View style={s.itemBtnRow}>
                            <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeRoom(i)}><Text style={s.removeBtnText}>Remove Room</Text></TouchableOpacity>
                            <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}><Text style={s.itemSaveBtnText}>{room._isNew ? 'Add Room' : 'Save'}</Text></TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
                <TouchableOpacity style={s.addBtn} onPress={addRoom}><Text style={s.addBtnText}>+ Add Room</Text></TouchableOpacity>
              </View>
            )}

            {/* ── TIMETABLE ── */}
            {activeTab === 'Timetable' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Gig Timetable</Text>
                <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Add your gig slots and set terms for each one. Artists browse your timetable and send enquiries for slots that suit them.</Text>
                {sortedNights(data.gigNights).map(night => {
                  const i = data.gigNights.indexOf(night);
                  const isOpen = expandedNight === i;
                  const nightDays = night.days?.length ? night.days : (night.day ? [night.day] : []);
                  const nightAllowedDow = nightDays.map(d => DAY_NAMES_DOW[d]).filter((n): n is number => n !== undefined);
                  const hasError = showErrors && (!(night.days?.length || night.day) || !night.startTime || !night.startDate || (!night.continuous && !night.endDate));
                  const fmtTime = (t: string) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
                  const dayStr = nightDays.join(', ');
                  const summaryParts = [night.name || dayStr || 'New slot', night.startTime ? fmtTime(night.startTime) : null, night.room || null, night.duration ? `${night.duration} min` : null].filter(Boolean).join(' · ');
                  const activeModels = night.paymentModels?.length ? night.paymentModels : (night.paymentModel ? [night.paymentModel] : []);
                  return (
                    <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                      <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedNight(isOpen ? null : i)}>
                        <Text style={[s.cardHeaderText, { color: colors.black }]}>{summaryParts}</Text>
                        <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {isOpen && (
                        <View style={{ paddingTop: 14, gap: 12 }}>
                          <View style={{ marginBottom: 4 }}>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.black, marginBottom: 4 }}>{night._isNew ? 'Add a Gig Slot' : 'Edit Gig Slot'}</Text>
                            <Text style={{ fontSize: 13, color: Colors.grey, lineHeight: 19 }}>Set the day, time, and terms for this slot. Artists will see this exact info when they enquire.</Text>
                          </View>
                          <Field label="NAME" helper="Optional. Give this slot a name, like 'Summer Sunday Sessions'. Shown to artists when they enquire."><Input value={night.name} onChangeText={(v: string) => setNight(i, 'name', v)} placeholder="e.g. Friday Night Sessions" /></Field>
                          <Field label="DAY *" error={showErrors && !nightDays.length}><Pills options={CANONICAL_DAYS} value={nightDays} onSelect={(v: string[]) => setNightFields(i, { days: v, day: v[0] || '' })} multi /></Field>
                          <Field label="SLOT TYPE" helper="Helps artists know what kind of set you're booking for."><Pills options={SLOT_TYPES} value={night.slotType || 'Headline'} onSelect={(v: string) => setNight(i, 'slotType', v)} /></Field>
                          <Field label="ROOM" helper="Choose 'Any room' if this slot isn't tied to a specific space."><Pills options={['Any room', ...data.rooms.map(r => r.name).filter(Boolean)]} value={night.room || 'Any room'} onSelect={(v: string) => setNight(i, 'room', v === 'Any room' ? '' : v)} /></Field>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 2 }}><Field label="START TIME *" error={showErrors && !night.startTime}><TimePicker value={night.startTime} onChange={(v: string) => setNightFields(i, { startTime: v, loadIn: subtractMinutes(v, 150), soundcheck: subtractMinutes(v, 90) })} defaultValue="19:00" /></Field></View>
                            <View style={{ flex: 1 }}><Field label="PER SET DURATION (MIN)" helper="How long each artist's set runs."><Input value={night.duration > 0 ? String(night.duration) : ''} onChangeText={(v: string) => setNight(i, 'duration', Number(v) || 0)} keyboardType="numeric" placeholder="60" /></Field></View>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}><Field label="LOAD-IN TIME"><TimePicker value={night.loadIn} onChange={(v: string) => setNight(i, 'loadIn', v)} /></Field></View>
                            <View style={{ flex: 1 }}><Field label="SOUNDCHECK"><TimePicker value={night.soundcheck} onChange={(v: string) => setNight(i, 'soundcheck', v)} /></Field></View>
                          </View>
                          <Text style={{ fontSize: 12, color: Colors.grey, marginTop: -8, marginBottom: 2 }}>Optional — lets artists plan their arrival.</Text>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Field label="START DATE *" error={showErrors && !night.startDate}><DatePicker value={night.startDate} onChange={(v: string) => setNight(i, 'startDate', v)} allowedDays={nightAllowedDow} /></Field>
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }} onPress={() => { setNight(i, 'continuous', !night.continuous); if (!night.continuous) setNight(i, 'endDate', ''); }}>
                                <View style={[s.checkbox, { borderColor: colors.border }, night.continuous && s.checkboxChecked]}>{night.continuous && <Text style={s.checkmark}>✓</Text>}</View>
                                <Text style={[s.checkLabel, { color: colors.black }]}>Continuous (No end date)</Text>
                              </TouchableOpacity>
                              <Text style={{ fontSize: 12, color: Colors.grey, marginTop: 6 }}>Uncheck to set an end date for a limited run, like a residency.</Text>
                            </View>
                            {!night.continuous && (<View style={{ flex: 1 }}><Field label="END DATE *" error={showErrors && !night.endDate}><DatePicker value={night.endDate} onChange={(v: string) => setNight(i, 'endDate', v)} allowedDays={nightAllowedDow} rangeStart={night.startDate} /></Field></View>)}
                          </View>
                          <Field label="PAYMENT MODEL" helper="Artists will see this before they enquire. Clear terms mean better enquiries.">
                            <Pills options={PAYMENT_MODELS} value={activeModels} onSelect={(newModels: string[]) => { const added = newModels.find(m => !activeModels.includes(m)); const prefill: Partial<Night> = { paymentModels: newModels, paymentModel: '' }; if (added === 'Flat fee') { prefill.feeMin = data.payment.setFeeMin; prefill.feeMax = data.payment.setFeeMax; prefill.feeBasis = data.payment.feeBasis; } else if (added === 'Door split') { prefill.doorSplit = data.payment.doorSplit; prefill.coverCharge = data.payment.coverCharge; } else if (added === 'Bar tab') { prefill.barSplit = data.payment.barSplit; } else if (added === 'Ticket sales split') { prefill.ticketSalesSplit = data.payment.ticketSalesSplit; prefill.ticketingHandledBy = data.payment.ticketingHandledBy; } setNightFields(i, prefill); }} multi />
                          </Field>
                          {activeModels.includes('Flat fee') && (() => { const minVal = parseFloat(night.feeMin); const maxVal = parseFloat(night.feeMax); const maxError = night.feeMax !== '' && night.feeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal; return (<Field label="FEE RANGE"><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><View style={{ width: 90 }}><CurrencyInput value={night.feeMin} onChangeText={(v: string) => setNight(i, 'feeMin', v)} placeholder="Min" /></View><View style={{ width: 90 }}><CurrencyInput value={night.feeMax} onChangeText={(v: string) => setNight(i, 'feeMax', v)} placeholder="Max" error={maxError} /></View><View style={{ flex: 1 }}><Select options={['Per band', 'Per set', 'Per hour']} value={night.feeBasis} onSelect={(v: string) => setNight(i, 'feeBasis', v)} /></View></View>{maxError && <Text style={{ fontSize: 12, color: Colors.danger }}>Max must be higher than min.</Text>}</Field>); })()}
                          {activeModels.includes('Door split') && (<Field label="DOOR SPLIT TERMS"><Input value={night.doorSplit} onChangeText={(v: string) => setNight(i, 'doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" /></Field>)}
                          {activeModels.includes('Bar tab') && (<Field label="BAR SPLIT TERMS"><Input value={night.barSplit} onChangeText={(v: string) => setNight(i, 'barSplit', v)} placeholder="e.g. 10% of bar sales during set" /></Field>)}
                          {activeModels.includes('Ticket sales split') && (<Field label="TICKET SALES SPLIT"><Input value={night.ticketSalesSplit} onChangeText={(v: string) => setNight(i, 'ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" /><View style={{ marginTop: 8 }}><Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={night.ticketingHandledBy} onSelect={(v: string) => setNight(i, 'ticketingHandledBy', v)} /></View></Field>)}
                          <Field label="PAYMENT METHOD"><Pills options={PAY_METHODS} value={night.paymentMethod || ''} onSelect={(v: string) => setNight(i, 'paymentMethod', v)} /></Field>
                          <Field label="GENRES" helper="Select the styles that suit this slot. Leave blank to use your venue's default genres."><Pills options={GENRES} value={night.genres || []} onSelect={(v: string[]) => setNight(i, 'genres', v)} multi /></Field>
                          <Field label="MINIMUM NOTICE" helper="How much lead time you need before this slot's date."><Pills options={['No minimum', '24 hours', '48 hours', '1 week', '2 weeks', '1 month']} value={night.minNotice || 'No minimum'} onSelect={(v: string) => setNight(i, 'minNotice', v === 'No minimum' ? '' : v)} /></Field>
                          <Field label="NOTES" helper="Add anything artists should know before enquiring — format, dress code, load-in quirks, etc."><Input value={night.notes} onChangeText={(v: string) => setNight(i, 'notes', v)} placeholder="e.g. Acoustic only, strict 45 min sets, artists must supply own PA..." multiline /></Field>
                          <View style={s.itemBtnRow}>
                            <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => crossConfirm('Remove Gig Slot', "This will delete the slot and any pending enquiries tied to it. This can't be undone.", () => removeNight(i), true)}><Text style={s.removeBtnText}>Remove Gig</Text></TouchableOpacity>
                            <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}><Text style={s.itemSaveBtnText}>Save</Text></TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
                {data.gigNights.length < 7 && (<TouchableOpacity style={s.addBtn} onPress={addNight}><Text style={s.addBtnText}>+ Add Gig Slot</Text></TouchableOpacity>)}
              </View>
            )}

            {/* ── TECH SPECS ── */}
            {activeTab === 'Tech Specs' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Specs</Text>
                <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Venue-wide info that applies no matter which room an artist plays. Backline, monitoring, power, and room-specific notes are entered per room in the Rooms tab.</Text>
                <Field label="Load-in"><Input value={data.techSpecs?.loadIn || data.techSpecs?.loadInParking || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, loadIn: v, loadInParking: v })} placeholder="e.g. rear loading dock, access via laneway" /></Field>
                <Field label="Parking"><Input value={data.techSpecs?.parking || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, parking: v })} placeholder="e.g. street parking only, 2hr limit after 6pm" /></Field>
                <Field label="Curfew / Noise Restrictions"><Input value={data.techSpecs?.curfew || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, curfew: v })} placeholder="e.g. 11pm hard curfew, council noise limit" /></Field>
                <TouchableOpacity style={[s.checkRow, { borderBottomWidth: 0, paddingTop: 2 }]} onPress={() => set('techSpecs', { ...data.techSpecs, soundEngineer: !data.techSpecs?.soundEngineer })}>
                  <View style={[s.checkbox, { borderColor: colors.border }, data.techSpecs?.soundEngineer && s.checkboxChecked]}>{data.techSpecs?.soundEngineer && <Text style={s.checkmark}>✓</Text>}</View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>In-house sound engineer</Text>
                </TouchableOpacity>
                {data.techSpecs?.soundEngineer && (<View style={{ marginBottom: 14 }}><Input value={data.techSpecs?.soundEngineerDetails || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, soundEngineerDetails: v })} placeholder="e.g. included in the booking, or available at extra cost" /></View>)}
                <Field label="Green Room">
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }} activeOpacity={0.7} onPress={() => set('techSpecs', { ...data.techSpecs, greenRoom: !data.techSpecs?.greenRoom })}>
                    <View style={[s.checkbox, { borderColor: colors.border }, data.techSpecs?.greenRoom && s.checkboxChecked]}>{data.techSpecs?.greenRoom && <Text style={s.checkmark}>✓</Text>}</View>
                    <Text style={{ fontSize: 14, color: colors.black }}>Available</Text>
                  </TouchableOpacity>
                  {data.techSpecs?.greenRoom && (<Input value={data.techSpecs?.greenRoomDetails || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, greenRoomDetails: v })} placeholder="e.g. shared green room, fridge and couch" />)}
                </Field>
                <Field label="General Venue Notes"><Input value={data.techSpecs?.notes || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, notes: v })} placeholder="Anything acts should know about the venue in general" multiline /></Field>
              </View>
            )}

            {/* ── PAYMENTS ── */}
            {activeTab === 'Payments' && (
              <View style={s.section}>

                {/* Payment Structure */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Structure</Text>
                  <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Set your standard payment terms. Artists will see these when browsing your venue and when reviewing booking details.</Text>
                  <Field label="Payment Model/s">
                    <Pills options={PAYMENT_MODELS} value={data.payment.models} onSelect={(v: string[]) => setPayment('models', v)} multi />
                  </Field>
                  {data.payment.models.includes('Flat fee') && (() => {
                    const minVal = parseFloat(data.payment.setFeeMin);
                    const maxVal = parseFloat(data.payment.setFeeMax);
                    const maxError = data.payment.setFeeMax !== '' && data.payment.setFeeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal;
                    return (
                      <>
                        <Field label="Flat Fee Range">
                          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <View style={{ width: 100 }}><CurrencyInput value={data.payment.setFeeMin} onChangeText={(v: string) => setPayment('setFeeMin', v)} placeholder="Min" /></View>
                            <View style={{ width: 100 }}><CurrencyInput value={data.payment.setFeeMax} onChangeText={(v: string) => setPayment('setFeeMax', v)} placeholder="Max" error={maxError} /></View>
                            <View style={{ flex: 1 }}><Select options={['Per band', 'Per set', 'Per hour']} value={data.payment.feeBasis} onSelect={(v: string) => setPayment('feeBasis', v)} /></View>
                          </View>
                          {maxError && <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 6 }}>Max must be higher than min.</Text>}
                        </Field>
                        <Field label="Weekday Rate (optional)">
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekdayFeeMin} onChangeText={(v: string) => setPayment('weekdayFeeMin', v)} placeholder="Min" /></View>
                            <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekdayFeeMax} onChangeText={(v: string) => setPayment('weekdayFeeMax', v)} placeholder="Max" /></View>
                          </View>
                        </Field>
                        <Field label="Weekend Rate (optional)">
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekendFeeMin} onChangeText={(v: string) => setPayment('weekendFeeMin', v)} placeholder="Min" /></View>
                            <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekendFeeMax} onChangeText={(v: string) => setPayment('weekendFeeMax', v)} placeholder="Max" /></View>
                          </View>
                        </Field>
                      </>
                    );
                  })()}
                  {data.payment.models.includes('Door split') && (
                    <>
                      <Field label="Door Split Terms">
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ flex: 3 }}><Input value={data.payment.doorSplit} onChangeText={(v: string) => setPayment('doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" /></View>
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10 }}>
                            <Text style={{ fontSize: 14, color: Colors.grey, marginRight: 2 }}>$</Text>
                            <TextInput style={{ flex: 1, fontSize: 14, color: colors.black, paddingVertical: 12 }} value={data.payment.coverCharge} onChangeText={(v: string) => setPayment('coverCharge', v)} placeholder="Cover" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                          </View>
                        </View>
                      </Field>
                      <Field label="Split Notes"><Input value={data.payment.splitNotes} onChangeText={(v: string) => setPayment('splitNotes', v)} placeholder="Any extra detail about how the split works" multiline /></Field>
                    </>
                  )}
                  {data.payment.models.includes('Guarantee + split') && (
                    <Field label="Guarantee + Split Terms"><Input value={data.payment.splitNotes} onChangeText={(v: string) => setPayment('splitNotes', v)} placeholder="e.g. $200 guarantee + 50% of door after costs" multiline /></Field>
                  )}
                  {data.payment.models.includes('Bar tab') && (
                    <Field label="Bar Split Terms"><Input value={data.payment.barSplit} onChangeText={(v: string) => setPayment('barSplit', v)} placeholder="e.g. 10% of bar sales during the set" /></Field>
                  )}
                  {data.payment.models.includes('Ticket sales split') && (
                    <>
                      <Field label="Ticket Sales Split Terms"><Input value={data.payment.ticketSalesSplit} onChangeText={(v: string) => setPayment('ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" /></Field>
                      <Field label="Ticketing Handled By"><Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={data.payment.ticketingHandledBy} onSelect={(v: string) => setPayment('ticketingHandledBy', v)} /></Field>
                    </>
                  )}
                </View>

                {/* What's Included */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>What's Included</Text>
                  <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Let artists know what's covered in the booking beyond the fee.</Text>
                  <Field label="Backline Provided">
                    <Pills options={BACKLINE_OFFER} value={data.payment.backlineProvided} onSelect={(v: string[]) => setPayment('backlineProvided', v)} multi />
                  </Field>
                  <Field label="Guest List Allowance">
                    <Input value={data.payment.guestListAllowance} onChangeText={(v: string) => setPayment('guestListAllowance', v)} placeholder="e.g. 2 guests per act" />
                  </Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Meals / Hospitality Provided</Text>
                    <Switch value={data.payment.mealsProvided} onValueChange={(v: boolean) => setPayment('mealsProvided', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  {data.payment.mealsProvided && (
                    <Field label="Hospitality Details"><Input value={data.payment.mealsNotes} onChangeText={(v: string) => setPayment('mealsNotes', v)} placeholder="e.g. meal voucher for each performer" /></Field>
                  )}
                </View>

                {/* Payment Logistics */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Logistics</Text>
                  <Field label="Accepted Payment Methods">
                    <Pills options={PAY_METHODS} value={data.payment.paymentMethods} onSelect={(v: string[]) => setPayment('paymentMethods', v)} multi />
                  </Field>
                  <Field label="Payment Timing">
                    <Select options={PAY_TIMING} value={data.payment.timing} onSelect={(v: string) => setPayment('timing', v)} />
                  </Field>
                  {data.payment.timing === 'Other' && (
                    <Field label="Timing Details"><Input value={data.payment.timingOther} onChangeText={(v: string) => setPayment('timingOther', v)} placeholder="Describe your payment timing" /></Field>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.payment.depositRequired ? 14 : 0 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Deposit Required</Text>
                    <Switch value={data.payment.depositRequired} onValueChange={(v: boolean) => setPayment('depositRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  {data.payment.depositRequired && (
                    <>
                      <Field label="Deposit Amount"><CurrencyInput value={data.payment.depositAmount} onChangeText={(v: string) => setPayment('depositAmount', v)} placeholder="Amount" /></Field>
                      <Field label="Deposit Due"><Input value={data.payment.depositDue} onChangeText={(v: string) => setPayment('depositDue', v)} placeholder="e.g. 7 days before the gig" /></Field>
                    </>
                  )}
                  <Field label="Late Payment Contact"><Input value={data.payment.latePaymentContact} onChangeText={(v: string) => setPayment('latePaymentContact', v)} placeholder="e.g. bookings@yourvenue.com.au" keyboardType="email-address" /></Field>
                </View>

                {/* Tax & Invoicing */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Tax and Invoicing</Text>
                  <Field label="Venue ABN"><Input value={data.payment.abn} onChangeText={(v: string) => setPayment('abn', v)} placeholder="e.g. 12 345 678 901" keyboardType="numeric" /></Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>GST Registered</Text>
                    <Switch value={data.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Requires Artist ABN</Text>
                    <Switch value={data.payment.requiresArtistAbn} onValueChange={(v: boolean) => setPayment('requiresArtistAbn', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Invoice Required</Text>
                    <Switch value={data.payment.invoiceRequired} onValueChange={(v: boolean) => setPayment('invoiceRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  {data.payment.invoiceRequired && (
                    <Field label="Invoice Direction">
                      <Select options={INVOICE_DIRS} value={data.payment.invoiceDirection} onSelect={(v: string) => setPayment('invoiceDirection', v)} />
                    </Field>
                  )}
                  <Field label="Invoice Templates">
                    <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 10, lineHeight: 19 }}>Upload any preferred invoice format or RCTI template for artists to use.</Text>
                    {(data.payment.invoiceDocs || []).map((doc, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                        <Text style={{ flex: 1, fontSize: 13, color: colors.black }} numberOfLines={1}>↓ {doc.name}</Text>
                        <TouchableOpacity onPress={() => setPayment('invoiceDocs', data.payment.invoiceDocs.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={{ fontSize: 14, color: '#e94560', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity style={s.addBtn} onPress={pickInvoiceDocument} disabled={invoiceDocUploading}>
                      <Text style={s.addBtnText}>{invoiceDocUploading ? 'Uploading…' : '+ Upload Document'}</Text>
                    </TouchableOpacity>
                  </Field>
                </View>

                {/* Cancellation & Policies */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Cancellation and Policies</Text>
                  <Field label="Cancellation Terms"><Input value={data.payment.cancellationTerms} onChangeText={(v: string) => setPayment('cancellationTerms', v)} placeholder="e.g. Full fee if cancelled within 48 hours of the gig." multiline /></Field>
                  <Field label="Public Liability Insurance">
                    <Select options={PL_OPTIONS} value={data.payment.publicLiability} onSelect={(v: string) => setPayment('publicLiability', v)} />
                  </Field>
                </View>

                {/* Additional Notes */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Additional Notes</Text>
                  <Input value={data.payment.additionalNotes} onChangeText={(v: string) => setPayment('additionalNotes', v)} placeholder="Anything else artists should know about payment at your venue" multiline />
                </View>

              </View>
            )}

            {/* ── PHOTOS & VIDEOS ── */}
            {activeTab === 'Photos & Videos' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Photos</Text>
                <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 12, lineHeight: 19 }}>Tap the photo in the sidebar to upload or change your main venue photo.</Text>
                <View style={s.photoGrid}>
                  {data.photos.map((url, i) => (
                    <View key={i} style={s.photoItem}>
                      <Image source={{ uri: url }} style={s.photoImg} />
                      <TouchableOpacity style={s.photoRemove} onPress={() => set('photos', data.photos.filter((_, idx) => idx !== i))}><Text style={{ color: '#fff', fontSize: 14 }}>✕</Text></TouchableOpacity>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={s.addBtn} onPress={addGalleryPhoto}><Text style={s.addBtnText}>+ Add Photo</Text></TouchableOpacity>
                <Text style={[s.sectionTitle, { color: colors.black, marginTop: 28 }]}>Videos</Text>
                {(data.videos || []).map((url, i) => (
                  <View key={i} style={[s.videoRow, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                    <Text style={[s.videoUrl, { color: colors.black }]} numberOfLines={1}>{url}</Text>
                    <TouchableOpacity onPress={() => set('videos', data.videos.filter((_, idx) => idx !== i))}><Text style={{ fontSize: 16, color: Colors.orange, paddingHorizontal: 4 }}>✕</Text></TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={[s.addBtn, { marginBottom: 8 }]} onPress={pickVideoFile} disabled={videoUploading}><Text style={s.addBtnText}>{videoUploading ? 'Uploading…' : '+ Upload Video'}</Text></TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[s.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]} placeholder="Or paste YouTube / Vimeo URL" placeholderTextColor={Colors.greyLight} value={newVideoUrl} onChangeText={setNewVideoUrl} autoCapitalize="none" onSubmitEditing={addVideo} returnKeyType="done" />
                  <TouchableOpacity style={[s.removeBtn, { borderColor: Colors.orange, justifyContent: 'center' }]} onPress={addVideo}><Text style={[s.removeBtnText, { color: Colors.orange }]}>+ Link</Text></TouchableOpacity>
                </View>
              </View>
            )}

          </ScrollView>

          {/* ── Onboarding side panel (steps 2-7) ── */}
          {onboardingStep >= 2 && onboardingStep <= 7 && (() => {
            const step = VENUE_ONBOARDING[onboardingStep];
            return (
              <View style={[evd.onboardingPanel, { borderLeftColor: colors.border, backgroundColor: colors.bg }]}>
                <View style={evd.onboardingPanelInner}>
                  <View style={evd.onboardingStepRow}>
                    <Text style={evd.onboardingStepLabel}>STEP {onboardingStep} OF 8</Text>
                    <TouchableOpacity onPress={skipOnboarding}><Text style={evd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
                  </View>
                  <View style={evd.onboardingProgress}>
                    <View style={[evd.onboardingProgressFill, { width: `${(onboardingStep / 8) * 100}%` as any }]} />
                  </View>
                  <Text style={[evd.onboardingTitle, { color: colors.black }]}>{step.title}</Text>
                  <Text style={evd.onboardingBody}>{step.body}</Text>
                  {step.body2 && <Text style={[evd.onboardingBody, { marginTop: 10 }]}>{step.body2}</Text>}
                  {step.fieldsLabel && step.fields && (
                    <View style={{ marginTop: 14 }}>
                      <Text style={evd.onboardingFieldsLabel}>{step.fieldsLabel}</Text>
                      {step.fields.map((f, i) => (
                        <View key={i} style={evd.onboardingBulletRow}>
                          <View style={evd.onboardingBulletDot} />
                          <Text style={evd.onboardingBulletText}>{f}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {step.footer && <Text style={[evd.onboardingBody, { marginTop: 12, fontStyle: 'italic' }]}>{step.footer}</Text>}
                  <View style={evd.onboardingBtns}>
                    <TouchableOpacity style={evd.onboardingNextBtn} onPress={advanceOnboarding}>
                      <Text style={evd.onboardingNextBtnText}>{step.nextLabel}</Text>
                    </TouchableOpacity>
                    {onboardingStep > 1 && (
                      <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                        <Text style={evd.onboardingBackText}>Back</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })()}

        </View>

        {/* ── Step 1: Verified modal ── */}
        {onboardingStep === 1 && (
          <View style={evd.modalOverlay}>
            <View style={[evd.welcomeCard, { backgroundColor: colors.bg }]}>
              <View style={evd.onboardingStepRow}>
                <Text style={evd.onboardingStepLabel}>STEP 1 OF 8</Text>
                <TouchableOpacity onPress={skipOnboarding}><Text style={evd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
              </View>
              <View style={[evd.onboardingProgress, { marginBottom: 20 }]}>
                <View style={[evd.onboardingProgressFill, { width: '12.5%' as any }]} />
              </View>
              <Text style={[evd.onboardingTitle, { color: colors.black, fontSize: 22 }]}>Verified</Text>
              <Text style={[evd.onboardingBody, { marginBottom: 24 }]}>{VENUE_ONBOARDING[1].body}</Text>
              <TouchableOpacity style={evd.onboardingNextBtn} onPress={advanceOnboarding}>
                <Text style={evd.onboardingNextBtnText}>Get started</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 7: Go Live card (bottom-left) ── */}
        {onboardingStep === 8 && (
          <View style={evd.goLiveCard}>
            <View style={[evd.goLiveCardInner, { backgroundColor: colors.bg }]}>
              <View style={evd.onboardingStepRow}>
                <Text style={evd.onboardingStepLabel}>STEP 8 OF 8</Text>
                <TouchableOpacity onPress={skipOnboarding}><Text style={evd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
              </View>
              <View style={[evd.onboardingProgress, { marginBottom: 16 }]}>
                <View style={[evd.onboardingProgressFill, { width: '100%' as any }]} />
              </View>
              <Text style={[evd.onboardingTitle, { color: colors.black }]}>Go Live</Text>
              <Text style={evd.onboardingBody}>{VENUE_ONBOARDING[8].body}</Text>
              <Text style={[evd.onboardingBody, { marginTop: 8 }]}>{VENUE_ONBOARDING[8].body2}</Text>
              <View style={[evd.onboardingBtns, { marginTop: 20 }]}>
                <TouchableOpacity style={evd.onboardingNextBtn} onPress={finishOnboarding}>
                  <Text style={evd.onboardingNextBtnText}>Go to my timetable</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                  <Text style={evd.onboardingBackText}>Back</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── Replay setup tour button ── */}
        {onboardingStep === 0 && onboardingComplete && (
          <TouchableOpacity style={evd.replayBtn} onPress={replayOnboarding} activeOpacity={0.8}>
            <Text style={evd.replayBtnText}>Replay setup tour</Text>
          </TouchableOpacity>
        )}

      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          setShowStickySave(e.nativeEvent.contentOffset.y > titleBarBottomRef.current);
        }}
        scrollEventThrottle={100}
      >

        {/* ── Banner + title bar + tab errors ── */}
        <View>
          <View style={{ marginTop: 20 }}>
            <RepositionablePhoto
              uri={data.photoUrl || null}
              position={data.photoPosition ?? { x: 50, y: 50 }}
              onPositionChange={pos => set('photoPosition', pos)}
              onChangePhoto={pickBannerPhoto}
              height={270}
              uploading={photoUploading}
              placeholderText="Tap to add venue photo"
            />
          </View>

          <View
            style={[s.titleBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}
            onLayout={(e) => {
              titleBarBottomRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.headerTitle, { color: colors.black }]}>Edit Venue Profile</Text>
              <Text style={[s.headerSub, { color: colors.black }]}>{data.name || '—'}</Text>
            </View>
            <View style={s.headerBtns}>
              <TouchableOpacity style={[s.backBtnInline, { borderColor: colors.border }]} onPress={handleBack}>
                <Text style={[s.backBtnInlineText, { color: colors.black }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, (saving || justSaved) && { opacity: justSaved ? 1 : 0.6 }, justSaved && { backgroundColor: '#22c55e' }]} onPress={handleSave} disabled={saving}>
                <Text style={s.saveBtnText}>{saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {tabErrors.length > 0 && (
            <View style={s.tabErrors}>
              <Text style={s.tabErrorsLabel}>Please complete: </Text>
              {tabErrors.map(t => <Text key={t} style={s.tabErrorPill}>{t}</Text>)}
            </View>
          )}
        </View>

        {/* ── Tab bar (sticky) ── */}
        <View style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.tabBar, { borderBottomWidth: 0 }]} contentContainerStyle={s.tabBarContent}>
            {activeTabs.map(tab => (
              <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={[s.tab, activeTab === tab && s.tabActive]}>
                <Text style={[s.tabText, { color: colors.black }, activeTab === tab && s.tabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {showStickySave && (
            <TouchableOpacity
              style={[s.saveBtn, { position: 'absolute', right: 12, top: '100%', marginTop: 10, zIndex: 10 }, (saving || justSaved) && { opacity: justSaved ? 1 : 0.6 }, justSaved && { backgroundColor: '#22c55e' }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={s.saveBtnText}>{saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.body}>

        {/* ── SETTINGS ── */}
        {activeTab === 'Settings' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Notification Preferences</Text>
            <TouchableOpacity
              style={[s.checkRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => set('settings', { ...data.settings, emailOnNewEnquiry: !data.settings.emailOnNewEnquiry })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailOnNewEnquiry && s.checkboxChecked]}>
                {data.settings.emailOnNewEnquiry && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me when new enquiry is received</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.checkRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => set('settings', { ...data.settings, emailEnquiryReminders: !data.settings.emailEnquiryReminders })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailEnquiryReminders && s.checkboxChecked]}>
                {data.settings.emailEnquiryReminders && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me enquiry reminders</Text>
            </TouchableOpacity>


            <Text style={[s.sectionTitle, { color: colors.black, marginTop: 24 }]}>Account</Text>
            <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
              <Text style={[s.toggleLabel, { color: colors.black }]}>Dark Mode</Text>
              <Switch
                value={isDark}
                onValueChange={toggleDark}
                trackColor={{ false: '#e0e0e0', true: Colors.orange }}
                thumbColor="#ffffff"
              />
            </View>
            <TouchableOpacity style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]} onPress={async () => { await signOut(auth); router.replace('/'); }}>
              <Text style={[s.toggleLabel, { color: Colors.danger }]}>Log out</Text>
            </TouchableOpacity>

            <View style={[s.dangerSection, { borderColor: Colors.danger + '44' }]}>
              <Text style={s.dangerTitle}>Danger Zone</Text>
              <Text style={[s.dangerDesc, { color: colors.black }]}>
                Deactivating your listing will hide it from all bands browsing Twaylo. This action can be reversed at any time.
              </Text>
              <TouchableOpacity
                style={[s.dangerBtn, data.settings.listed ? {} : s.dangerBtnActive]}
                onPress={() => {
                  const willDeactivate = data.settings.listed;
                  crossConfirm(
                    willDeactivate ? 'Deactivate Venue Listing?' : 'Reactivate Venue Listing?',
                    willDeactivate
                      ? 'Are you sure? This will deactivate your account and hide it from view. You can reactivate at any time.'
                      : 'This will make your venue visible to musicians again.',
                    async () => {
                      const { venueId } = profile ?? {};
                      if (!venueId) return;
                      const newListed = !willDeactivate;
                      await updateDoc(doc(db, 'venues', venueId), { 'settings.listed': newListed });
                      set('settings', { ...data.settings, listed: newListed });
                    },
                    willDeactivate,
                  );
                }}
              >
                <Text style={s.dangerBtnText}>
                  {data.settings.listed ? 'Deactivate Venue Listing' : 'Reactivate Venue Listing'}
                </Text>
              </TouchableOpacity>

              <Text style={[s.dangerDesc, { color: colors.grey, marginTop: 20 }]}>
                Permanently delete your venue and account. This action cannot be undone.
              </Text>
              <TouchableOpacity
                style={[s.dangerBtn, s.dangerBtnActive]}
                onPress={() => {
                  crossConfirm(
                    'Delete Account',
                    'This will permanently delete your venue profile and account from the database. This action cannot be undone.',
                    async () => {
                      try {
                        const { venueId, uid } = profile ?? {};
                        if (venueId) await deleteDoc(doc(db, 'venues', venueId));
                        if (uid) {
                          await deleteDoc(doc(db, 'users', uid));
                          await deleteDoc(doc(db, 'venueApplications', uid));
                        }
                        const cu = auth.currentUser;
                        if (cu) await deleteUser(cu);
                      } catch (e: any) {
                        Alert.alert('Error', e.message ?? 'Could not delete account. Please try again.');
                      } finally {
                        await signOut(auth).catch(() => {});
                        router.replace('/');
                      }
                    },
                    true,
                  );
                }}
              >
                <Text style={s.dangerBtnText}>Delete Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── BASIC INFO ── */}
        {activeTab === 'Basic Info' && (
          <View style={s.section}>

            {/* Venue Details */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Venue Details</Text>
              <Field label="Venue name *" error={showErrors && !data.name?.trim()}>
                <Input value={data.name} onChangeText={(v: string) => set('name', v)} placeholder="Venue name" error={showErrors && !data.name?.trim()} />
              </Field>
              <Field label="Street address *" error={showErrors && !data.streetAddress?.trim()}>
                <Input value={data.streetAddress} onChangeText={(v: string) => set('streetAddress', v)} placeholder="123 Main St" error={showErrors && !data.streetAddress?.trim()} />
              </Field>
              <Field label="Location *" error={showErrors && !data.location?.trim()}>
                <SuburbSearch value={data.location} onChange={(v: string) => set('location', v)} onAutofill={(suburb, state, postcode) => { set('location', [suburb, state, postcode].filter(Boolean).join(', ')); set('suburb', suburb); set('state', state); set('postcode', postcode); }} error={showErrors && !data.location?.trim()} />
              </Field>
            </View>

            {/* Map Coordinates */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Map Coordinates</Text>
              <Text style={{ fontSize: 13, color: colors.grey, marginBottom: 12, lineHeight: 18 }}>Internal only. Not shown publicly. Used for future map features.</Text>
              <Field label="Latitude">
                <Input value={data.latitude} onChangeText={(v: string) => set('latitude', v)} placeholder="e.g. -33.8688" keyboardType="decimal-pad" />
              </Field>
              <Field label="Longitude">
                <Input value={data.longitude} onChangeText={(v: string) => set('longitude', v)} placeholder="e.g. 151.2093" keyboardType="decimal-pad" />
              </Field>
            </View>

            {/* Contact */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Contact</Text>
              <Field label="Email *" error={showErrors && !data.email?.trim()}>
                <Input value={data.email} onChangeText={(v: string) => set('email', v)} placeholder="Email *" keyboardType="email-address" error={showErrors && !data.email?.trim()} />
              </Field>
              <Field label="Phone number *" error={showErrors && !data.phone?.trim()}>
                <Input value={data.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone *" keyboardType="phone-pad" error={showErrors && !data.phone?.trim()} />
              </Field>
              <Field label="Website *" error={showErrors && !data.website?.trim()}>
                <Input value={data.website} onChangeText={(v: string) => set('website', v)} placeholder="Website *" error={showErrors && !data.website?.trim()} />
              </Field>
            </View>

            {/* Description */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Description</Text>
              <Input value={data.description} onChangeText={(v: string) => set('description', v)} placeholder="Tell musicians about your venue…" multiline />
            </View>


          </View>
        )}

        {/* ── ROOMS ── */}
        {activeTab === 'Rooms' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Rooms</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Add the spaces at your venue where live music happens. PA, lighting rig, and stage dimensions are entered per room, since they can differ between spaces. Rooms can be tied to specific gigs on your timetable so artists know exactly where they'll be playing.</Text>
            {data.rooms.map((room, i) => {
              const isOpen = expandedRoom === i;
              const hasError = showErrors && (!room.name?.trim() || !room.capacity?.toString().trim());
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedRoom(isOpen ? null : i)}>
                    <Text style={s.cardHeaderText}>{room.name || 'Unnamed room'}{room.capacity ? ` · Cap. ${room.capacity}` : ''}</Text>
                    <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={{ paddingTop: 14, gap: 12 }}>
                      <Field label="Room name *" error={showErrors && !room.name?.trim()}>
                        <Input value={room.name} onChangeText={(v: string) => setRoom(i, 'name', v)} placeholder="e.g. Main Room" error={showErrors && !room.name?.trim()} />
                      </Field>
                      <Field label="Capacity *" error={showErrors && !room.capacity?.toString().trim()}>
                        <Input value={room.capacity} onChangeText={(v: string) => setRoom(i, 'capacity', v)} placeholder="e.g. 200" keyboardType="numeric" error={showErrors && !room.capacity?.toString().trim()} />
                      </Field>
                      <Field label="Stage & Dimensions">
                        <Input value={room.stage} onChangeText={(v: string) => setRoom(i, 'stage', v)} placeholder="e.g. Elevated stage, 6m × 4m" autoGrow />
                      </Field>
                      <Field label="Lighting">
                        <Input value={room.lighting} onChangeText={(v: string) => setRoom(i, 'lighting', v)} placeholder="e.g. Full rig with follow spot" autoGrow />
                      </Field>
                      <Field label="PA System">
                        <Input value={room.pa} onChangeText={(v: string) => setRoom(i, 'pa', v)} placeholder="e.g. d&b audiotechnik J-Series" autoGrow />
                      </Field>
                      <Field label="Backline">
                        <Input value={room.backline} onChangeText={(v: string) => setRoom(i, 'backline', v)} placeholder="e.g. house drum kit, 2x guitar amps" autoGrow />
                      </Field>
                      <Field label="Monitoring">
                        <Input value={room.monitoring} onChangeText={(v: string) => setRoom(i, 'monitoring', v)} placeholder="e.g. 4x wedges, 2 mixes" autoGrow />
                      </Field>
                      <Field label="Power">
                        <Input value={room.power} onChangeText={(v: string) => setRoom(i, 'power', v)} placeholder="e.g. 4x 15A outlets on stage" autoGrow />
                      </Field>
                      <Field label="Notes for Acts">
                        <Input value={room.notes} onChangeText={(v: string) => setRoom(i, 'notes', v)} placeholder="Anything acts should know about this room" multiline />
                      </Field>
                      <Field label="Tech Spec Documents">
                        {(room.documents || []).map((doc, idx) => (
                          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name || doc.url}</Text>
                            <TouchableOpacity
                              style={s.removeBtn}
                              onPress={() => setRoom(i, 'documents', (room.documents || []).filter((_: any, di: number) => di !== idx))}
                            >
                              <Text style={s.removeBtnText}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                        <TouchableOpacity style={s.addBtn} onPress={() => pickRoomDocument(i)} disabled={roomDocUploading === i}>
                          <Text style={s.addBtnText}>{roomDocUploading === i ? 'Uploading…' : '+ Add Document'}</Text>
                        </TouchableOpacity>
                      </Field>
                      <View style={s.itemBtnRow}>
                        <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeRoom(i)}>
                          <Text style={s.removeBtnText}>Remove Room</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}>
                          <Text style={s.itemSaveBtnText}>{room._isNew ? 'Add Room' : 'Save'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={addRoom}>
              <Text style={s.addBtnText}>+ Add Room</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── GIG NIGHTS ── */}
        {activeTab === 'Timetable' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Gig Timetable</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Add your gig slots and set terms for each one. Artists browse your timetable and send enquiries for slots that suit them.</Text>
            {sortedNights(data.gigNights).map(night => {
              const i = data.gigNights.indexOf(night);
              const isOpen = expandedNight === i;
              const nightDays2 = night.days?.length ? night.days : (night.day ? [night.day] : []);
              const nightAllowedDow2 = nightDays2.map(d => DAY_NAMES_DOW[d]).filter((n): n is number => n !== undefined);
              const hasError = showErrors && (!(night.days?.length || night.day) || !night.startTime || !night.startDate || (!night.continuous && !night.endDate));
              const fmtTime = (t: string) => {
                if (!t) return '';
                const [h, m] = t.split(':').map(Number);
                return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
              };
              const dayStr2 = nightDays2.join(', ');
              const summaryParts = [
                night.name || dayStr2 || 'New slot',
                night.startTime ? fmtTime(night.startTime) : null,
                night.room || null,
                night.duration ? `${night.duration} min` : null,
              ].filter(Boolean).join(' · ');
              const activeModels = night.paymentModels?.length ? night.paymentModels : (night.paymentModel ? [night.paymentModel] : []);
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedNight(isOpen ? null : i)}>
                    <Text style={[s.cardHeaderText, { color: colors.black }]}>{summaryParts}</Text>
                    <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={{ paddingTop: 14, gap: 12 }}>
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.black, marginBottom: 4 }}>{night._isNew ? 'Add a Gig Slot' : 'Edit Gig Slot'}</Text>
                        <Text style={{ fontSize: 13, color: Colors.grey, lineHeight: 19 }}>Set the day, time, and terms for this slot. Artists will see this exact info when they enquire.</Text>
                      </View>
                      <Field label="NAME" helper="Optional. Give this slot a name, like 'Summer Sunday Sessions'. Shown to artists when they enquire.">
                        <Input value={night.name} onChangeText={(v: string) => setNight(i, 'name', v)} placeholder="e.g. Friday Night Sessions" />
                      </Field>
                      <Field label="DAY *" error={showErrors && !nightDays2.length}>
                        <Pills options={CANONICAL_DAYS} value={nightDays2} onSelect={(v: string[]) => setNightFields(i, { days: v, day: v[0] || '' })} multi />
                      </Field>
                      <Field label="SLOT TYPE" helper="Helps artists know what kind of set you're booking for.">
                        <Pills options={SLOT_TYPES} value={night.slotType || 'Headline'} onSelect={(v: string) => setNight(i, 'slotType', v)} />
                      </Field>
                      <Field label="ROOM" helper="Choose 'Any room' if this slot isn't tied to a specific space.">
                        <Pills options={['Any room', ...data.rooms.map(r => r.name).filter(Boolean)]} value={night.room || 'Any room'} onSelect={(v: string) => setNight(i, 'room', v === 'Any room' ? '' : v)} />
                      </Field>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 2 }}>
                          <Field label="START TIME *" error={showErrors && !night.startTime}>
                            <TimePicker value={night.startTime} onChange={(v: string) => setNightFields(i, { startTime: v, loadIn: subtractMinutes(v, 150), soundcheck: subtractMinutes(v, 90) })} defaultValue="19:00" />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="PER SET DURATION (MIN)" helper="How long each artist's set runs.">
                            <Input value={night.duration > 0 ? String(night.duration) : ''} onChangeText={(v: string) => setNight(i, 'duration', Number(v) || 0)} keyboardType="numeric" placeholder="60" />
                          </Field>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="LOAD-IN TIME">
                            <TimePicker value={night.loadIn} onChange={(v: string) => setNight(i, 'loadIn', v)} />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="SOUNDCHECK">
                            <TimePicker value={night.soundcheck} onChange={(v: string) => setNight(i, 'soundcheck', v)} />
                          </Field>
                        </View>
                      </View>
                      <Text style={{ fontSize: 12, color: Colors.grey, marginTop: -8, marginBottom: 2 }}>Optional — lets artists plan their arrival.</Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="START DATE *" error={showErrors && !night.startDate}>
                            <DatePicker value={night.startDate} onChange={(v: string) => setNight(i, 'startDate', v)} allowedDays={nightAllowedDow2} />
                          </Field>
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}
                            onPress={() => { setNight(i, 'continuous', !night.continuous); if (!night.continuous) setNight(i, 'endDate', ''); }}
                          >
                            <View style={[s.checkbox, { borderColor: colors.border }, night.continuous && s.checkboxChecked]}>
                              {night.continuous && <Text style={s.checkmark}>✓</Text>}
                            </View>
                            <Text style={[s.checkLabel, { color: colors.black }]}>Continuous (No end date)</Text>
                          </TouchableOpacity>
                          <Text style={{ fontSize: 12, color: Colors.grey, marginTop: 6 }}>Uncheck to set an end date for a limited run, like a residency.</Text>
                        </View>
                        {!night.continuous && (
                          <View style={{ flex: 1 }}>
                            <Field label="END DATE *" error={showErrors && !night.endDate}>
                              <DatePicker value={night.endDate} onChange={(v: string) => setNight(i, 'endDate', v)} allowedDays={nightAllowedDow2} rangeStart={night.startDate} />
                            </Field>
                          </View>
                        )}
                      </View>
                      <Field label="PAYMENT MODEL" helper="Artists will see this before they enquire. Clear terms mean better enquiries.">
                        <Pills options={PAYMENT_MODELS} value={activeModels} onSelect={(newModels: string[]) => { const added = newModels.find(m => !activeModels.includes(m)); const prefill: Partial<Night> = { paymentModels: newModels, paymentModel: '' }; if (added === 'Flat fee') { prefill.feeMin = data.payment.setFeeMin; prefill.feeMax = data.payment.setFeeMax; prefill.feeBasis = data.payment.feeBasis; } else if (added === 'Door split') { prefill.doorSplit = data.payment.doorSplit; prefill.coverCharge = data.payment.coverCharge; } else if (added === 'Bar tab') { prefill.barSplit = data.payment.barSplit; } else if (added === 'Ticket sales split') { prefill.ticketSalesSplit = data.payment.ticketSalesSplit; prefill.ticketingHandledBy = data.payment.ticketingHandledBy; } setNightFields(i, prefill); }} multi />
                      </Field>
                      {activeModels.includes('Flat fee') && (() => { const minVal = parseFloat(night.feeMin); const maxVal = parseFloat(night.feeMax); const maxError = night.feeMax !== '' && night.feeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal; return (<Field label="FEE RANGE"><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><View style={{ width: 90 }}><CurrencyInput value={night.feeMin} onChangeText={(v: string) => setNight(i, 'feeMin', v)} placeholder="Min" /></View><View style={{ width: 90 }}><CurrencyInput value={night.feeMax} onChangeText={(v: string) => setNight(i, 'feeMax', v)} placeholder="Max" error={maxError} /></View><View style={{ flex: 1 }}><Select options={['Per band', 'Per set', 'Per hour']} value={night.feeBasis} onSelect={(v: string) => setNight(i, 'feeBasis', v)} /></View></View>{maxError && <Text style={{ fontSize: 12, color: Colors.danger }}>Max must be higher than min.</Text>}</Field>); })()}
                      {activeModels.includes('Door split') && (<Field label="DOOR SPLIT TERMS"><Input value={night.doorSplit} onChangeText={(v: string) => setNight(i, 'doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" /></Field>)}
                      {activeModels.includes('Bar tab') && (<Field label="BAR SPLIT TERMS"><Input value={night.barSplit} onChangeText={(v: string) => setNight(i, 'barSplit', v)} placeholder="e.g. 10% of bar sales during set" /></Field>)}
                      {activeModels.includes('Ticket sales split') && (<Field label="TICKET SALES SPLIT"><Input value={night.ticketSalesSplit} onChangeText={(v: string) => setNight(i, 'ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" /><View style={{ marginTop: 8 }}><Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={night.ticketingHandledBy} onSelect={(v: string) => setNight(i, 'ticketingHandledBy', v)} /></View></Field>)}
                      <Field label="PAYMENT METHOD"><Pills options={PAY_METHODS} value={night.paymentMethod || ''} onSelect={(v: string) => setNight(i, 'paymentMethod', v)} /></Field>
                      <Field label="GENRES" helper="Select the styles that suit this slot. Leave blank to use your venue's default genres.">
                        <Pills options={GENRES} value={night.genres || []} onSelect={(v: string[]) => setNight(i, 'genres', v)} multi />
                      </Field>
                      <Field label="MINIMUM NOTICE" helper="How much lead time you need before this slot's date.">
                        <Pills options={['No minimum', '24 hours', '48 hours', '1 week', '2 weeks', '1 month']} value={night.minNotice || 'No minimum'} onSelect={(v: string) => setNight(i, 'minNotice', v === 'No minimum' ? '' : v)} />
                      </Field>
                      <Field label="NOTES" helper="Add anything artists should know before enquiring — format, dress code, load-in quirks, etc.">
                        <Input value={night.notes} onChangeText={(v: string) => setNight(i, 'notes', v)} placeholder="e.g. Acoustic only, strict 45 min sets, artists must supply own PA..." multiline />
                      </Field>
                      <View style={s.itemBtnRow}>
                        <TouchableOpacity
                          style={[s.removeBtn, { flex: 1, marginTop: 0 }]}
                          onPress={() => crossConfirm('Remove Gig Slot', "This will delete the slot and any pending enquiries tied to it. This can't be undone.", () => removeNight(i), true)}
                        >
                          <Text style={s.removeBtnText}>Remove Gig</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}>
                          <Text style={s.itemSaveBtnText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
            {data.gigNights.length < 7 && (
              <TouchableOpacity style={s.addBtn} onPress={addNight}>
                <Text style={s.addBtnText}>+ Add Gig Slot</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── TECH SPECS ── */}
        {activeTab === 'Tech Specs' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Specs</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Venue-wide info that applies no matter which room an artist plays. Backline, monitoring, power, and room-specific notes are entered per room in the Rooms tab.</Text>

            <Field label="Load-in">
              <Input value={data.techSpecs?.loadIn || data.techSpecs?.loadInParking || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, loadIn: v, loadInParking: v })} placeholder="e.g. rear loading dock, access via laneway" />
            </Field>
            <Field label="Parking">
              <Input value={data.techSpecs?.parking || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, parking: v })} placeholder="e.g. street parking only, 2hr limit after 6pm" />
            </Field>
            <Field label="Curfew / Noise Restrictions">
              <Input value={data.techSpecs?.curfew || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, curfew: v })} placeholder="e.g. 11pm hard curfew, council noise limit" />
            </Field>

            <TouchableOpacity
              style={[s.checkRow, { borderBottomWidth: 0, paddingTop: 2 }]}
              onPress={() => set('techSpecs', { ...data.techSpecs, soundEngineer: !data.techSpecs?.soundEngineer })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, data.techSpecs?.soundEngineer && s.checkboxChecked]}>
                {data.techSpecs?.soundEngineer && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>In-house sound engineer</Text>
            </TouchableOpacity>
            {data.techSpecs?.soundEngineer && (
              <View style={{ marginBottom: 14 }}>
                <Input
                  value={data.techSpecs?.soundEngineerDetails || ''}
                  onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, soundEngineerDetails: v })}
                  placeholder="e.g. included in the booking, or available at extra cost"
                />
              </View>
            )}

            <Field label="Green Room">
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}
                activeOpacity={0.7}
                onPress={() => set('techSpecs', { ...data.techSpecs, greenRoom: !data.techSpecs?.greenRoom })}
              >
                <View style={[s.checkbox, { borderColor: colors.border }, data.techSpecs?.greenRoom && s.checkboxChecked]}>
                  {data.techSpecs?.greenRoom && <Text style={s.checkmark}>✓</Text>}
                </View>
                <Text style={{ fontSize: 14, color: colors.black }}>Available</Text>
              </TouchableOpacity>
              {data.techSpecs?.greenRoom && (
                <Input
                  value={data.techSpecs?.greenRoomDetails || ''}
                  onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, greenRoomDetails: v })}
                  placeholder="e.g. shared green room, fridge and couch"
                />
              )}
            </Field>

            <Field label="General Venue Notes">
              <Input value={data.techSpecs?.notes || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, notes: v })} placeholder="Anything acts should know about the venue in general" multiline />
            </Field>
          </View>
        )}

        {/* ── PAYMENTS ── */}
        {activeTab === 'Payments' && (
          <View style={s.section}>

            {/* Payment Structure */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Structure</Text>
              <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Set your standard payment terms. Artists will see these when browsing your venue and when reviewing booking details.</Text>
              <Field label="Payment Model/s">
                <Pills options={PAYMENT_MODELS} value={data.payment.models} onSelect={(v: string[]) => setPayment('models', v)} multi />
              </Field>
              {data.payment.models.includes('Flat fee') && (() => {
                const minVal = parseFloat(data.payment.setFeeMin);
                const maxVal = parseFloat(data.payment.setFeeMax);
                const maxError = data.payment.setFeeMax !== '' && data.payment.setFeeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal;
                return (
                  <>
                    <Field label="Flat Fee Range">
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <View style={{ width: 100 }}><CurrencyInput value={data.payment.setFeeMin} onChangeText={(v: string) => setPayment('setFeeMin', v)} placeholder="Min" /></View>
                        <View style={{ width: 100 }}><CurrencyInput value={data.payment.setFeeMax} onChangeText={(v: string) => setPayment('setFeeMax', v)} placeholder="Max" error={maxError} /></View>
                        <View style={{ flex: 1 }}><Select options={['Per band', 'Per set', 'Per hour']} value={data.payment.feeBasis} onSelect={(v: string) => setPayment('feeBasis', v)} /></View>
                      </View>
                      {maxError && <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 6 }}>Max must be higher than min.</Text>}
                    </Field>
                    <Field label="Weekday Rate (optional)">
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekdayFeeMin} onChangeText={(v: string) => setPayment('weekdayFeeMin', v)} placeholder="Min" /></View>
                        <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekdayFeeMax} onChangeText={(v: string) => setPayment('weekdayFeeMax', v)} placeholder="Max" /></View>
                      </View>
                    </Field>
                    <Field label="Weekend Rate (optional)">
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekendFeeMin} onChangeText={(v: string) => setPayment('weekendFeeMin', v)} placeholder="Min" /></View>
                        <View style={{ flex: 1 }}><CurrencyInput value={data.payment.weekendFeeMax} onChangeText={(v: string) => setPayment('weekendFeeMax', v)} placeholder="Max" /></View>
                      </View>
                    </Field>
                  </>
                );
              })()}
              {data.payment.models.includes('Door split') && (
                <>
                  <Field label="Door Split Terms">
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 3 }}>
                        <Input value={data.payment.doorSplit} onChangeText={(v: string) => setPayment('doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" />
                      </View>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 14, color: Colors.grey, marginRight: 2 }}>$</Text>
                        <TextInput style={{ flex: 1, fontSize: 14, color: colors.black, paddingVertical: 12 }} value={data.payment.coverCharge} onChangeText={(v: string) => setPayment('coverCharge', v)} placeholder="Cover" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                      </View>
                    </View>
                  </Field>
                  <Field label="Split Notes"><Input value={data.payment.splitNotes} onChangeText={(v: string) => setPayment('splitNotes', v)} placeholder="Any extra detail about how the split works" multiline /></Field>
                </>
              )}
              {data.payment.models.includes('Guarantee + split') && (
                <Field label="Guarantee + Split Terms"><Input value={data.payment.splitNotes} onChangeText={(v: string) => setPayment('splitNotes', v)} placeholder="e.g. $200 guarantee + 50% of door after costs" multiline /></Field>
              )}
              {data.payment.models.includes('Bar tab') && (
                <Field label="Bar Split Terms"><Input value={data.payment.barSplit} onChangeText={(v: string) => setPayment('barSplit', v)} placeholder="e.g. 10% of bar sales during the set" /></Field>
              )}
              {data.payment.models.includes('Ticket sales split') && (
                <>
                  <Field label="Ticket Sales Split Terms"><Input value={data.payment.ticketSalesSplit} onChangeText={(v: string) => setPayment('ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" /></Field>
                  <Field label="Ticketing Handled By"><Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={data.payment.ticketingHandledBy} onSelect={(v: string) => setPayment('ticketingHandledBy', v)} /></Field>
                </>
              )}
            </View>

            {/* What's Included */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>What's Included</Text>
              <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Let artists know what's covered in the booking beyond the fee.</Text>
              <Field label="Backline Provided">
                <Pills options={BACKLINE_OFFER} value={data.payment.backlineProvided} onSelect={(v: string[]) => setPayment('backlineProvided', v)} multi />
              </Field>
              <Field label="Guest List Allowance">
                <Input value={data.payment.guestListAllowance} onChangeText={(v: string) => setPayment('guestListAllowance', v)} placeholder="e.g. 2 guests per act" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Meals / Hospitality Provided</Text>
                <Switch value={data.payment.mealsProvided} onValueChange={(v: boolean) => setPayment('mealsProvided', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              {data.payment.mealsProvided && (
                <Field label="Hospitality Details"><Input value={data.payment.mealsNotes} onChangeText={(v: string) => setPayment('mealsNotes', v)} placeholder="e.g. meal voucher for each performer" /></Field>
              )}
            </View>

            {/* Payment Logistics */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Logistics</Text>
              <Field label="Accepted Payment Methods">
                <Pills options={PAY_METHODS} value={data.payment.paymentMethods} onSelect={(v: string[]) => setPayment('paymentMethods', v)} multi />
              </Field>
              <Field label="Payment Timing">
                <Select options={PAY_TIMING} value={data.payment.timing} onSelect={(v: string) => setPayment('timing', v)} />
              </Field>
              {data.payment.timing === 'Other' && (
                <Field label="Timing Details"><Input value={data.payment.timingOther} onChangeText={(v: string) => setPayment('timingOther', v)} placeholder="Describe your payment timing" /></Field>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.payment.depositRequired ? 14 : 0 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Deposit Required</Text>
                <Switch value={data.payment.depositRequired} onValueChange={(v: boolean) => setPayment('depositRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              {data.payment.depositRequired && (
                <>
                  <Field label="Deposit Amount"><CurrencyInput value={data.payment.depositAmount} onChangeText={(v: string) => setPayment('depositAmount', v)} placeholder="Amount" /></Field>
                  <Field label="Deposit Due"><Input value={data.payment.depositDue} onChangeText={(v: string) => setPayment('depositDue', v)} placeholder="e.g. 7 days before the gig" /></Field>
                </>
              )}
              <Field label="Late Payment Contact">
                <Input value={data.payment.latePaymentContact} onChangeText={(v: string) => setPayment('latePaymentContact', v)} placeholder="e.g. bookings@yourvenue.com.au" keyboardType="email-address" />
              </Field>
            </View>

            {/* Tax & Invoicing */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Tax and Invoicing</Text>
              <Field label="Venue ABN">
                <Input value={data.payment.abn} onChangeText={(v: string) => setPayment('abn', v)} placeholder="e.g. 12 345 678 901" keyboardType="numeric" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>GST Registered</Text>
                <Switch value={data.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Requires Artist ABN</Text>
                <Switch value={data.payment.requiresArtistAbn} onValueChange={(v: boolean) => setPayment('requiresArtistAbn', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Invoice Required</Text>
                <Switch value={data.payment.invoiceRequired} onValueChange={(v: boolean) => setPayment('invoiceRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              {data.payment.invoiceRequired && (
                <Field label="Invoice Direction">
                  <Select options={INVOICE_DIRS} value={data.payment.invoiceDirection} onSelect={(v: string) => setPayment('invoiceDirection', v)} />
                </Field>
              )}
              <Field label="Invoice Templates">
                <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 10, lineHeight: 19 }}>Upload any preferred invoice format or RCTI template for artists to use.</Text>
                {(data.payment.invoiceDocs || []).map((doc, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, color: colors.black }} numberOfLines={1}>↓ {doc.name}</Text>
                    <TouchableOpacity onPress={() => setPayment('invoiceDocs', data.payment.invoiceDocs.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 14, color: '#e94560', fontWeight: '700' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={s.addBtn} onPress={pickInvoiceDocument} disabled={invoiceDocUploading}>
                  <Text style={s.addBtnText}>{invoiceDocUploading ? 'Uploading…' : '+ Upload Document'}</Text>
                </TouchableOpacity>
              </Field>
            </View>

            {/* Cancellation & Policies */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Cancellation and Policies</Text>
              <Field label="Cancellation Terms">
                <Input value={data.payment.cancellationTerms} onChangeText={(v: string) => setPayment('cancellationTerms', v)} placeholder="e.g. Full fee if cancelled within 48 hours of the gig." multiline />
              </Field>
              <Field label="Public Liability Insurance">
                <Select options={PL_OPTIONS} value={data.payment.publicLiability} onSelect={(v: string) => setPayment('publicLiability', v)} />
              </Field>
            </View>

            {/* Additional Notes */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Additional Notes</Text>
              <Input value={data.payment.additionalNotes} onChangeText={(v: string) => setPayment('additionalNotes', v)} placeholder="Anything else artists should know about payment at your venue" multiline />
            </View>

          </View>
        )}

        {/* ── PHOTOS & VIDEOS ── */}
        {activeTab === 'Photos & Videos' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Photos</Text>
            <View style={s.photoGrid}>
              {data.photos.map((url, i) => (
                <View key={i} style={s.photoItem}>
                  <Image source={{ uri: url }} style={s.photoImg} />
                  <TouchableOpacity
                    style={s.photoRemove}
                    onPress={() => set('photos', data.photos.filter((_, idx) => idx !== i))}
                  >
                    <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <TouchableOpacity style={s.addBtn} onPress={addGalleryPhoto}>
              <Text style={s.addBtnText}>+ Add Photo</Text>
            </TouchableOpacity>

            <Text style={[s.sectionTitle, { color: colors.black, marginTop: 28 }]}>Videos</Text>
            {(data.videos || []).map((url, i) => (
              <View key={i} style={[s.videoRow, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                <Text style={[s.videoUrl, { color: colors.black }]} numberOfLines={1}>{url}</Text>
                <TouchableOpacity onPress={() => set('videos', data.videos.filter((_, idx) => idx !== i))}>
                  <Text style={{ fontSize: 16, color: Colors.orange, paddingHorizontal: 4 }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={[s.addBtn, { marginBottom: 8 }]} onPress={pickVideoFile} disabled={videoUploading}>
              <Text style={s.addBtnText}>{videoUploading ? 'Uploading…' : '+ Upload Video'}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[s.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
                placeholder="Or paste YouTube / Vimeo URL"
                placeholderTextColor={Colors.greyLight}
                value={newVideoUrl}
                onChangeText={setNewVideoUrl}
                autoCapitalize="none"
                onSubmitEditing={addVideo}
                returnKeyType="done"
              />
              <TouchableOpacity style={[s.removeBtn, { borderColor: Colors.orange, justifyContent: 'center' }]} onPress={addVideo}>
                <Text style={[s.removeBtnText, { color: Colors.orange }]}>+ Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        </View>
      </ScrollView>

      {/* ── Mobile onboarding overlay ── */}
      {onboardingStep >= 1 && onboardingStep <= 8 && (() => {
        const step = VENUE_ONBOARDING[onboardingStep];
        const isFirst = onboardingStep === 1;
        return (
          <Modal visible transparent animationType="slide">
            <View style={s.mobileOnboardingOverlay}>
              <View style={[s.mobileOnboardingCard, { backgroundColor: colors.bg }]}>
                <View style={evd.onboardingStepRow}>
                  <Text style={evd.onboardingStepLabel}>STEP {onboardingStep} OF 8</Text>
                  <TouchableOpacity onPress={skipOnboarding}><Text style={evd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
                </View>
                <View style={[evd.onboardingProgress, { marginBottom: 16 }]}>
                  <View style={[evd.onboardingProgressFill, { width: `${(onboardingStep / 8) * 100}%` as any }]} />
                </View>
                <Text style={[evd.onboardingTitle, { color: colors.black }]}>{step.title}</Text>
                <Text style={evd.onboardingBody}>{step.body}</Text>
                {step.body2 && <Text style={[evd.onboardingBody, { marginTop: 8 }]}>{step.body2}</Text>}
                {step.fieldsLabel && step.fields && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={evd.onboardingFieldsLabel}>{step.fieldsLabel}</Text>
                    {step.fields.map((f, i) => (
                      <View key={i} style={evd.onboardingBulletRow}>
                        <View style={evd.onboardingBulletDot} />
                        <Text style={evd.onboardingBulletText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {step.footer && <Text style={[evd.onboardingBody, { marginTop: 10, fontStyle: 'italic' }]}>{step.footer}</Text>}
                <View style={[evd.onboardingBtns, { marginTop: 20 }]}>
                  <TouchableOpacity style={evd.onboardingNextBtn} onPress={onboardingStep === 8 ? finishOnboarding : advanceOnboarding}>
                    <Text style={evd.onboardingNextBtnText}>{step.nextLabel}</Text>
                  </TouchableOpacity>
                  {!isFirst && (
                    <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                      <Text style={evd.onboardingBackText}>Back</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.bg },
  titleBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  headerBtns:    { flexDirection: 'row', gap: 8, alignItems: 'center' },
  backBtnInline: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  backBtnInlineText: { fontSize: 14, fontWeight: '600' },
  headerTitle:   { fontSize: 18, fontWeight: '800', color: Colors.black, letterSpacing: -0.2 },
  headerSub:     { fontSize: 13, color: Colors.grey },
  saveBtn:       { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText:   { fontSize: 14, fontWeight: '700', color: Colors.black },
  tabErrors:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 10, paddingHorizontal: 16, backgroundColor: 'rgba(233,69,96,0.06)', borderBottomWidth: 1, borderBottomColor: 'rgba(233,69,96,0.2)' },
  tabErrorsLabel:{ fontSize: 12, fontWeight: '700', color: Colors.danger },
  tabErrorPill:  { fontSize: 12, fontWeight: '700', color: Colors.danger, borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  tabBar:        { borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.bg, flexGrow: 0 },
  tabBarContent: { paddingHorizontal: 12 },
  tab:           { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive:     { borderBottomColor: Colors.orange },
  tabText:       { fontSize: 13, color: Colors.grey, fontWeight: '500' },
  tabTextActive: { color: Colors.orange, fontWeight: '700' },
  body:          { padding: 20, paddingHorizontal: Platform.OS === 'web' ? 40 : 20, paddingTop: 24, paddingBottom: 60 },
  banner:        { width: '100%', height: 220, overflow: 'hidden', backgroundColor: Colors.bgFaint },
  bannerError:   { borderWidth: 2, borderColor: Colors.danger },
  bannerImg:     { width: '100%', height: '100%' },
  bannerPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { fontSize: 14, color: Colors.greyLight },
  bannerEditBadge: { position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  bannerEditBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  section:       { gap: 4 },
  sectionBlock:  { paddingVertical: 20, borderTopWidth: 1, borderTopColor: 'transparent' },
  sectionBox:    { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginBottom: 16 },
  input:         { backgroundColor: Colors.bgFaint, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.black },
  textarea:      { minHeight: 100, textAlignVertical: 'top' },
  inputError:    { borderColor: Colors.danger, backgroundColor: 'rgba(233,69,96,0.04)' },
  pill:          { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillActive:    { borderColor: Colors.orange, backgroundColor: 'rgba(250,131,12,0.08)' },
  pillText:      { fontSize: 13, color: Colors.grey },
  pillTextActive:{ color: Colors.orange, fontWeight: '700' },
  toggleRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  toggleLabel:   { fontSize: 14, color: Colors.black, flex: 1 },
  card:          { backgroundColor: Colors.bgFaint, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 12 },
  cardError:     { borderColor: Colors.danger },
  cardHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderText:{ fontSize: 14, fontWeight: '600', color: Colors.black, flex: 1 },
  cardChevron:   { fontSize: 11, color: Colors.greyLight },
  addBtn:        { borderWidth: 1, borderColor: 'rgba(250,131,12,0.4)', borderStyle: 'dashed', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  addBtnText:    { fontSize: 14, color: Colors.orange, fontWeight: '600' },
  removeBtn:     { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 4 },
  removeBtnText: { fontSize: 13, color: Colors.grey },
  itemBtnRow:      { flexDirection: 'row', gap: 8, marginTop: 4 },
  itemSaveBtn:     { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, padding: 10, alignItems: 'center' },
  itemSaveBtnText: { fontSize: 13, color: Colors.black, fontWeight: '600' },
  photoGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  photoItem:     { width: '47%', aspectRatio: 4/3, borderRadius: 10, overflow: 'hidden' },
  photoImg:      { width: '100%', height: '100%' },
  photoRemove:   { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  videoRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, gap: 8 },
  videoUrl:      { flex: 1, fontSize: 13 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText:     { fontSize: 15, color: Colors.grey, textAlign: 'center' },
  mobileOnboardingOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  mobileOnboardingCard:    { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, paddingBottom: 40 },
  // Checkbox row
  checkRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  checkbox:      { width: 20, height: 20, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxChecked: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkmark:     { fontSize: 13, color: '#fff', fontWeight: '700', lineHeight: 16 },
  checkLabel:    { fontSize: 14, flex: 1 },
  // Danger zone
  dangerSection: { marginTop: 32, borderWidth: 1, borderRadius: 12, padding: 16 },
  dangerTitle:   { fontSize: 11, fontWeight: '700', color: Colors.danger, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  dangerDesc:    { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  dangerBtn:       { borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 18, alignSelf: 'flex-start', opacity: 0.5 },
  dangerBtnActive: { opacity: 1 },
  dangerBtnText:   { fontSize: 14, fontWeight: '600', color: Colors.danger },
});

const evd = StyleSheet.create({
  row:           { flex: 1, flexDirection: 'row' },
  sidebar:       { width: 224, borderRightWidth: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  photoWrap:     { marginBottom: 14 },
  photo:         { width: 72, height: 72, borderRadius: 8 },
  name:          { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, marginBottom: 3 },
  sub:           { fontSize: 12, marginBottom: 16 },
  divider:       { height: 1, marginVertical: 18 },
  navItem:       { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 7, marginBottom: 2 },
  navItemActive: { backgroundColor: Colors.orange + '18' },
  navRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navText:       { fontSize: 14, fontWeight: '600' },
  navErrorDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.danger },
  saveBtn:       { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  saveBtnText:   { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  backBtn:       { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  backBtnText:   { fontSize: 13, fontWeight: '600' },
  main:          { flex: 1 },
  mainContent:   { paddingHorizontal: 40, paddingVertical: 32, paddingBottom: 60 },
  navCheck:             { fontSize: 13, color: Colors.orange, fontWeight: '700' },
  // Onboarding panel (right column, steps 2-6)
  onboardingPanel:      { width: 248, borderLeftWidth: 1, paddingTop: 32 },
  onboardingPanelInner: { paddingHorizontal: 24, paddingBottom: 32 },
  onboardingStepRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  onboardingStepLabel:  { fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8 },
  onboardingSkip:       { fontSize: 12, color: Colors.grey },
  onboardingProgress:   { height: 3, backgroundColor: Colors.border, borderRadius: 2, marginBottom: 20, overflow: 'hidden' },
  onboardingProgressFill: { height: 3, backgroundColor: Colors.orange, borderRadius: 2 },
  onboardingTitle:      { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, marginBottom: 10 },
  onboardingBody:       { fontSize: 13, color: Colors.grey, lineHeight: 19 },
  onboardingFieldsLabel:{ fontSize: 10, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  onboardingBulletRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  onboardingBulletDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.orange, flexShrink: 0 },
  onboardingBulletText: { fontSize: 12, color: Colors.grey, flex: 1 },
  onboardingBtns:       { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 24 },
  onboardingNextBtn:    { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  onboardingNextBtnText:{ fontSize: 13, fontWeight: '700', color: '#ffffff' },
  onboardingBackText:   { fontSize: 13, color: Colors.grey, fontWeight: '600' },
  // Welcome modal overlay (step 1)
  modalOverlay:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  welcomeCard:          { width: 400, borderRadius: 16, padding: 32, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  // Go Live card (step 7, bottom-left)
  goLiveCard:           { position: 'absolute', bottom: 32, left: 244, zIndex: 100 },
  goLiveCardInner:      { width: 320, borderRadius: 14, padding: 24, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  // Replay button (bottom-right)
  replayBtn:            { position: 'absolute', bottom: 24, right: 24, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, zIndex: 50 },
  replayBtnText:        { fontSize: 13, fontWeight: '600', color: '#ffffff' },
});
