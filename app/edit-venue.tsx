import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform, Modal, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
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
import { CalendarSync } from '@/components/CalendarSync';
import { isValidABN, formatABN } from '@/lib/abn';
import { lookupABN, type AbnLookupResult } from '@/lib/abn-lookup';
import { isValidACN, formatACN } from '@/lib/acn';
import { LegalIdentity, LegalEntityType, BLANK_LEGAL, isLegalIdentityComplete } from '@/lib/legalIdentity';

const CANONICAL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const GENRES = ['Rock','Indie','Pop','Punk','Metal','Jazz','Blues','Soul / R&B','Funk','Hip-hop','Electronic','Country','Folk','Reggae','Classical','Other'];
const SETS_BOOK_OPTS = ['Originals','Covers','Mixed'];
const AU_STATES      = ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'];
const ENTITY_TYPES: LegalEntityType[] = ['Sole trader', 'Company', 'Partnership', 'Trust', 'Association / club'];
const SLOT_TYPES     = ['Headline','Support','Open Mic','Residency','Other'];
const PAYMENT_MODELS = ['Flat fee', 'Door split', 'Guarantee + door', 'Ticket split', 'Unpaid', 'Other'];
const PAY_METHODS    = ['Cash','Bank transfer','PayPal','Stripe','Other'];
const PAY_TIMING     = ['Same night','Within 7 days','Within 14 days','Within 30 days','Other'];
const BACKLINE_OFFER = ['PA system','Stage monitors','Microphones + stands','Drum kit','Bass amp','Guitar amp','Keys / DI','Lighting rig'];
const INVOICE_DIRS   = ['Artist invoices venue','Venue issues RCTI to artist','Not required'];
const PL_OPTIONS          = ['Required','Preferred','Not required'];
const VENUE_TYPES         = ['Live music venue','Pub','Bar','RSL / Club','Theatre','Café','DIY space','Festival site','Other'];
const VENUE_AGE_RESTRICTIONS = ['All ages','18+ only','Varies by gig'];

type Room = {
  name: string; capacity: string;
  // legacy freetext stage/monitoring; new structured fields below
  stage: string; monitoring: string; backline: string;
  stageWidth: string; stageDepth: string;
  monitoringType: string; monitoringMixes: string;
  backlineItems: string[];
  pa: string; lighting: string; power: string; notes: string;
  documents: { url: string; name: string }[];
  _isNew?: boolean;
};
type Night = {
  name: string;
  day: string; days?: string[]; startTime: string; duration: number; slotType: string;
  startDate: string; endDate: string; continuous: boolean; ongoing: boolean;
  feeMin: string; feeMax: string; feeBasis: string;
  loadIn: string | null; soundcheck: string | null;
  room: string; genres: string[] | null; notes: string;
  paymentModel: string; paymentModels?: string[];
  doorSplit: string; coverCharge: string; barSplit: string;
  ticketSalesSplit: string; ticketingHandledBy: string;
  negotiable: boolean;
  paymentMethod: string; paymentMethods?: string[];
  minNotice: string;
  useVenueGenres: boolean;
  useDefaultPay: boolean;
  useDefaultHospitality: boolean;
  guestList: string; meals: boolean; mealsDetails: string; drinks: boolean; drinksDetails: string;
  guaranteeAmount: string; guaranteeSplit: string;
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
type Video = { url: string; title: string };
type VenueData = {
  id?: string; name: string; streetAddress: string; location: string; suburb: string;
  state: string; postcode: string; phone: string; email: string;
  website: string; instagram: string; facebook: string; description: string; photoUrl: string;
  venueType: string; venueTypes?: string[]; genrePreferences: string[]; setsYouBook?: string[]; ageRestriction: string;
  latitude: string; longitude: string;
  rooms: Room[]; gigNights: Night[];
  techSpecs: Record<string, any>;
  settings: { emailOnNewEnquiry: boolean; emailEnquiryReminders: boolean; listed: boolean; emailOnNewMessage?: boolean; reminderHours?: string; theme?: string };
  photos: string[]; videos: string[]; videoObjects?: Video[];
  payment: Payment;
  slots?: Record<string, any>;
  photoPosition?: { x: number; y: number };
  // new fields
  username?: string;
  logoUrl?: string;
  showPhone?: boolean;
  bookingContactName?: string;
  bookingContactPhone?: string;
  invoicingMode?: string;
  invoicingNotes?: string;
  accountsContactName?: string;
  accountsContactEmail?: string;
  legalEntityName?: string;
  bookingTerms?: {
    payModels: string[]; negotiable: boolean;
    flatFeeMin: string; flatFeeMax: string; flatFeeBasis: string;
    doorSplit: string; guaranteeAmount: string; guaranteeSplit: string;
    barSplit: string; ticketSplitPct: string; ticketingBy: string;
    methods: string[]; paymentTiming: string;
    depositRequired: boolean; depositAmount: string; depositDue: string;
    minNotice: string;
    guestList: string; meals: boolean; mealsDetails: string; drinks: boolean; drinksDetails: string;
  };
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

const BLANK_BOOKING_TERMS: {
  payModels: string[]; negotiable: boolean;
  flatFeeMin: string; flatFeeMax: string; flatFeeBasis: string;
  doorSplit: string; guaranteeAmount: string; guaranteeSplit: string;
  barSplit: string; ticketSplitPct: string; ticketingBy: string;
  methods: string[]; paymentTiming: string;
  depositRequired: boolean; depositAmount: string; depositDue: string;
  minNotice: string;
  guestList: string; meals: boolean; mealsDetails: string; drinks: boolean; drinksDetails: string;
} = {
  payModels: [], negotiable: true,
  flatFeeMin: '', flatFeeMax: '', flatFeeBasis: 'Per act',
  doorSplit: '', guaranteeAmount: '', guaranteeSplit: '',
  barSplit: '', ticketSplitPct: '', ticketingBy: 'Venue',
  methods: [], paymentTiming: '',
  depositRequired: false, depositAmount: '', depositDue: '',
  minNotice: '1 week',
  guestList: '', meals: false, mealsDetails: '', drinks: false, drinksDetails: '',
};

const BLANK: VenueData = {
  name: '', streetAddress: '', location: '', suburb: '', state: '', postcode: '',
  phone: '', email: '', website: '', instagram: '', facebook: '', description: '', photoUrl: '',
  venueType: '', venueTypes: [], genrePreferences: [], setsYouBook: [], ageRestriction: '',
  latitude: '', longitude: '',
  rooms: [], gigNights: [], techSpecs: {},
  settings: { emailOnNewEnquiry: true, emailEnquiryReminders: false, listed: true },
  photos: [], videos: [], videoObjects: [],
  payment: { ...BLANK_PAYMENT },
  photoPosition: { x: 50, y: 50 },
  username: '', logoUrl: '', showPhone: false,
  bookingContactName: '', bookingContactPhone: '',
  invoicingMode: 'actsInvoice', invoicingNotes: '',
  accountsContactName: '', accountsContactEmail: '',
  legalEntityName: '',
  bookingTerms: { ...BLANK_BOOKING_TERMS },
};

const TABS = ['Basic info','Photos & video','Rooms','Access & facilities','Gig slots','Booking terms','Invoicing','Verification','Settings'];

const VENUE_NAV_GROUPS = [
  { label: 'VENUE',   tabs: ['Basic info', 'Photos & video', 'Rooms', 'Access & facilities'] },
  { label: 'BOOKING', tabs: ['Gig slots', 'Booking terms'] },
  { label: 'ACCOUNT', tabs: ['Invoicing', 'Verification', 'Settings'] },
];

const VENUE_STEP_TAB: Record<number, string | null> = {
  1: null, 2: 'Basic info', 3: 'Rooms', 4: 'Gig slots', 5: 'Access & facilities', 6: 'Booking terms', 7: 'Photos & video', 8: null,
};

const SET_LENGTHS_OPTS = ['30 min','45 min','60 min','90 min','2 × 45 min','3 × 45 min'];
const PARKING_OPTS = ['Street parking','Off-street parking','Loading zone','None'];
const GREEN_ROOM_OPTS = ['Private','Shared','None'];
const ENGINEER_COST_OPTS = ['Included','Extra cost','Not provided'];
const ACCESSIBILITY_STATES = ['Yes','No','Not sure'];
const CURFEW_OPTS = ['No curfew','10:00 pm','10:30 pm','11:00 pm','11:30 pm','12:00 am','12:30 am','1:00 am','1:30 am','2:00 am','2:30 am','3:00 am'];
const GUEST_LIST_OPTS = ['0','1','2','3','4','5','6','7','8','10','Negotiable'];
const MONITORING_PILL_OPTS = ['Wedges','In-ears','Both','None'];
const BACKLINE_PILL_OPTS = ['Drum kit','Cymbals','Bass amp','Guitar amp','Keys','Keys stand','Mics + stands','DI boxes','Lighting rig'];
const PAY_MODELS = ['Flat fee','Door split','Guarantee + split','Bar split','Ticket split','Unpaid'];
const FEE_BASIS_OPTS = ['Per act','Per set','Per hour'];
const TICKETING_BY_OPTS = ['Venue','Artist','Third party'];
const MIN_NOTICE_OPTS = ['No minimum','24 hours','48 hours','1 week','2 weeks','1 month'];
const REMIND_AFTER_OPTS = ['24 hours','48 hours','3 days'];
const PAY_TIMING_OPTS = ['On the night','Within 7 days','Within 14 days','Within 30 days','Discuss per gig'];
const DEPOSIT_DUE_OPTS = ['On booking','14 days before','7 days before'];

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
    body2: "Open slots are what artists browse. The more complete your timetable, the more enquiries you'll get. When a booking is confirmed, the gig details including load-in and soundcheck times go straight to the artist's My Gigs.",
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

function Input({ value, onChangeText, onBlur, placeholder, multiline, autoGrow, keyboardType, error }: any) {
  const { colors } = useTheme();
  return (
    <TextInput
      style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }, multiline && s.textarea, error && s.inputError]}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
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
            style={[s.pill, { borderColor: active ? colors.black : colors.border, backgroundColor: active ? colors.black : 'transparent' }]}
            onPress={() => {
              if (multi) {
                const arr = value as string[];
                onSelect(active ? arr.filter(x => x !== opt) : [...arr, opt]);
              } else {
                onSelect(opt);
              }
            }}
          >
            <Text style={[s.pillText, { color: active ? colors.bg : colors.black }]}>{opt}</Text>
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

// ── FieldRow ──────────────────────────────────────────────────────

function FieldRow({ label, sublabel, children, last, error }: {
  label: string; sublabel?: string; children: React.ReactNode; last?: boolean; error?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <>
      <View style={fr.row}>
        <View style={fr.labelCol}>
          <Text style={[fr.label, { color: error ? Colors.danger : colors.black }]}>{label}</Text>
          {sublabel ? <Text style={[fr.sublabel, { color: colors.grey }]}>{sublabel}</Text> : null}
        </View>
        <View style={fr.controlCol}>{children}</View>
      </View>
      {!last && <View style={[fr.divider, { backgroundColor: colors.border }]} />}
    </>
  );
}
const fr = StyleSheet.create({
  row:        { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, alignItems: 'flex-start', gap: 12 },
  labelCol:   { flex: 2, paddingTop: 2 },
  label:      { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  sublabel:   { fontSize: 12, lineHeight: 17, marginTop: 3 },
  controlCol: { flex: 3 },
  divider:    { height: 1, marginHorizontal: 16 },
});

// ── SectionCard ───────────────────────────────────────────────────

function SectionCard({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[sc.card, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      <View style={[sc.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[sc.title, { color: colors.black }]}>{title}</Text>
          {subtitle ? <Text style={[sc.subtitle, { color: colors.grey }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}
const sc = StyleSheet.create({
  card:     { borderWidth: 1, borderRadius: 14, marginBottom: 16 },
  header:   { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { fontSize: 14, fontWeight: '700', letterSpacing: -0.1 },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 2 },
});

// ── Tab page header metadata ──────────────────────────────────────

const TAB_META: Record<string, { title: string; desc: string }> = {
  'Settings':            { title: 'Settings',            desc: 'Notifications, calendar sync and your account.' },
  'Basic info':          { title: 'Basic info',          desc: 'How artists find and recognise your venue.' },
  'Rooms':               { title: 'Rooms',               desc: 'Each stage you book, with its own capacity and tech.' },
  'Gig slots':           { title: 'Gig slots',           desc: 'Your recurring slots. Artists see these on your timetable and enquire against them.' },
  'Access & facilities': { title: 'Access & facilities', desc: 'Arrival, sound, curfew and accessibility. Applies to every room.' },
  'Booking terms':       { title: 'Booking terms',       desc: 'Your defaults for every slot. Any slot can override them.' },
  'Photos & video':      { title: 'Photos & video',      desc: 'Show artists the room before they enquire.' },
  'Invoicing':           { title: 'Invoicing',           desc: 'How acts get paid on paper. Shared once a booking is confirmed.' },
  'Verification':        { title: 'Verification',        desc: 'Verified venues can list in Discover and receive enquiries.' },
};

const ns = StyleSheet.create({
  pageHeader: { marginBottom: 24 },
  pageTitle:  { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, lineHeight: 32 },
  pageDesc:   { fontSize: 14, lineHeight: 21, marginTop: 8 },
});

// ── Main component ────────────────────────────────────────────────

export default function EditVenueScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, isDark, toggleDark } = useTheme();
  const { agentVenueId, tab: tabParam } = useLocalSearchParams<{ agentVenueId?: string; tab?: string }>();
  const isAgentEdit = !!agentVenueId && profile?.type === 'agent';
  const venueId = (agentVenueId as string) || (profile?.venueId ?? '');
  const activeTabs = isAgentEdit ? TABS.filter(t => t !== 'Settings') : TABS;

  const [data, setData]           = useState<VenueData>(BLANK);
  const [saved, setSaved]         = useState<VenueData>(BLANK);
  const [loading, setLoading]     = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [venueAbnTouched, setVenueAbnTouched] = useState(false);
  const [venueAcnTouched, setVenueAcnTouched] = useState(false);
  const [legalIdentity,   setLegalIdentityState] = useState<LegalIdentity>(BLANK_LEGAL);
  const [savedLegal,      setSavedLegal]         = useState<LegalIdentity>(BLANK_LEGAL);
  const [activeTab, setActiveTab] = useState(tabParam || (isAgentEdit ? 'Basic info' : 'Basic info'));
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors, setTabErrors]   = useState<string[]>([]);
  const [expandedRoom,  setExpandedRoom]  = useState<number | null>(null);
  const [expandedNight, setExpandedNight] = useState<number | null>(null);
  const [touchedNights, setTouchedNights] = useState<Set<number>>(new Set());

  const [photoUploading, setPhotoUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [roomDocUploading, setRoomDocUploading] = useState<number | null>(null);
  const [stageDocUploading, setStageDocUploading] = useState(false);
  const [invoiceDocUploading, setInvoiceDocUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [showStickySave, setShowStickySave] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(true);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying]   = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [abnLookupLoading, setAbnLookupLoading] = useState(false);
  const [abnLookupResult, setAbnLookupResult] = useState<AbnLookupResult | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingVisited, setOnboardingVisited] = useState<string[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const titleBarBottomRef = useRef(Infinity);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    const ownerUid = profile?.uid || auth.currentUser?.uid;

    Promise.all([
      getDoc(doc(db, 'venues', venueId)),
      ownerUid ? getDoc(doc(db, 'users', ownerUid)) : Promise.resolve(null),
    ]).then(([snap, userSnap]) => {
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
        // Normalise legacy "Set Fee" → "Flat fee" and deduplicate
        if (d.payment.models?.length) {
          const seen = new Set<string>();
          d.payment.models = d.payment.models
            .map((m: string) => /^set.?fee$/i.test(m.trim()) ? 'Flat fee' : m)
            .filter((m: string) => { if (seen.has(m)) return false; seen.add(m); return true; });
        }
        // Back-fill location from suburb/state/postcode for existing venues
        if (!d.location && d.suburb) {
          d.location = [d.suburb, d.state, d.postcode].filter(Boolean).join(', ');
        }
        // Back-fill signup data (email, username, name) from users doc if missing on venue doc
        if (userSnap?.exists()) {
          const u = userSnap.data();
          if (!d.email    && u.email)       d.email    = u.email;
          if (!d.username && u.username)    d.username = u.username;
          if (!d.name     && u.displayName) d.name     = u.displayName;
        }
        // Also backfill from auth as a final fallback
        const cu = auth.currentUser;
        if (cu) {
          if (!d.email && cu.email) d.email = cu.email;
          if (!d.name  && cu.displayName) d.name = cu.displayName;
        }

        setData(d); setSaved(d);
        const isComplete = snap.data().onboardingComplete === true;
        setOnboardingComplete(isComplete);
        if (!isComplete) setOnboardingStep(1);

        // Load private legal identity (separate subcollection, may not exist yet)
        getDoc(doc(db, 'venues', venueId, 'private', 'legal')).then(lSnap => {
          if (lSnap.exists()) {
            const l = { ...BLANK_LEGAL, ...lSnap.data() } as LegalIdentity;
            setLegalIdentityState(l);
            setSavedLegal(l);
          }
        }).catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, [venueId]);

  function set<K extends keyof VenueData>(field: K, value: VenueData[K]) {

    setData(prev => ({ ...prev, [field]: value }));
  }

  function setPayment<K extends keyof Payment>(field: K, value: Payment[K]) {

    setData(prev => ({ ...prev, payment: { ...prev.payment, [field]: value } }));
  }
  function setLegal<K extends keyof LegalIdentity>(field: K, value: LegalIdentity[K]) {

    setLegalIdentityState(prev => ({ ...prev, [field]: value }));
  }

  // ── Rooms ──
  function setRoom(i: number, field: keyof Room, val: any) {
    setData(prev => ({ ...prev, rooms: prev.rooms.map((r, idx) => idx === i ? { ...r, [field]: val } : r) }));
  }
  function addRoom() {
    setData(prev => {
      const rooms = [...prev.rooms, { name: '', capacity: '', stage: '', stageWidth: '', stageDepth: '', lighting: '', pa: '', backline: '', backlineItems: [], monitoring: '', monitoringType: '', monitoringMixes: '', power: '', notes: '', documents: [], _isNew: true }];
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

    setData(prev => ({ ...prev, gigNights: prev.gigNights.map((n, idx) => idx === i ? { ...n, [field]: val } : n) }));
  }
  function setNightFields(i: number, fields: Partial<Night>) {

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
        startDate: '', endDate: '', continuous: true, ongoing: true,
        feeMin: '', feeMax: '', feeBasis: '', loadIn: null, soundcheck: null,
        room: '', genres: null, notes: '', paymentModel: '', paymentModels: [],
        doorSplit: '', coverCharge: '', barSplit: '', ticketSalesSplit: '', ticketingHandledBy: '',
        negotiable: true, guaranteeAmount: '', guaranteeSplit: '',
        paymentMethod: '', paymentMethods: [], minNotice: '',
        useVenueGenres: true, useDefaultPay: true, useDefaultHospitality: true,
        guestList: '', meals: false, mealsDetails: '', drinks: false, drinksDetails: '',
        _isNew: true,
      }];
      setTouchedNights(prev => new Set([...prev, nights.length - 1]));
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
    if (!data.name?.trim() || !data.email?.trim())
      errors.push('Basic Info');
    if (data.rooms.some(r => r.name?.trim() && !r.capacity?.toString().trim()))
      errors.push('Rooms');
    if (data.gigNights.some((n, idx) => touchedNights.has(idx) && (!(n.days?.length || n.day) || !n.startTime || !n.startDate || (!n.ongoing && !n.continuous && !n.endDate))))
      errors.push('Timetable');
    const venueAbn = data.payment.abn.replace(/\s/g, '');
    if (venueAbn && !isValidABN(venueAbn)) errors.push('Payments');
    if (data.payment.gstRegistered && (!venueAbn || !isValidABN(venueAbn))) errors.push('Payments');

    if (errors.length > 0) { setTabErrors(errors); return; }
    setTabErrors([]);
    setSaveState('saving');
    let didError = false;

    try {
      const { id, ...fields } = data as any;
      fields.rooms = data.rooms.map(({ _isNew, ...r }: any) => r);
      fields.gigNights = data.gigNights.map(({ _isNew, ...n }: any) => n);
      // Store ABN digits-only in Firestore; display formatting is client-side only
      if (fields.payment) fields.payment = { ...fields.payment, abn: (fields.payment.abn || '').replace(/\s/g, '') };
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

      const legalPayload: LegalIdentity = {
        ...legalIdentity,
        acn: legalIdentity.acn.replace(/\s/g, ''),
        updatedAt: Date.now(),
      };
      await updateDoc(doc(db, 'venues', venueId), { ...fields, slots: newSlots });
      setDoc(doc(db, 'venues', venueId, 'private', 'legal'), legalPayload)
        .then(() => setSavedLegal(legalIdentity))
        .catch(() => {});
      const cleanedData = {
        ...data,
        rooms: data.rooms.map(({ _isNew, ...r }: any) => r),
        gigNights: data.gigNights.map(({ _isNew, ...n }: any) => n),
      };
      setSaved(cleanedData);
      setData(cleanedData);
      setShowErrors(false);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveState('saved');
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
    } catch (e: any) {
      didError = true;
      Alert.alert('Save failed', e.message);
    } finally {
      if (didError) setSaveState('idle');
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
    const isDirty = JSON.stringify(data) !== JSON.stringify(saved) ||
      JSON.stringify(legalIdentity) !== JSON.stringify(savedLegal);
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

  // ── Page header ─────────────────────────────────────────────────

  function renderPageHeader(tab: string) {
    const meta = TAB_META[tab];
    if (!meta) return null;
    return (
      <View style={ns.pageHeader}>
        <Text style={[ns.pageTitle, { color: colors.black }]}>{meta.title}</Text>
        <Text style={[ns.pageDesc, { color: colors.grey }]}>{meta.desc}</Text>
      </View>
    );
  }

  // ── Tab render functions ─────────────────────────────────────────

  function renderSettings() {
    const bookingEmail = data.bookingContactName
      ? `${data.bookingContactName} (${data.email || ''})`
      : (data.email || '');
    return (
      <View style={s.section}>
        {renderPageHeader('Settings')}

        <SectionCard title="Email notifications" subtitle={bookingEmail ? `Sent to: ${bookingEmail}` : undefined}>
          <FieldRow label="New enquiries" sublabel="When an artist submits an enquiry">
            <Switch value={data.settings.emailOnNewEnquiry} onValueChange={(v) => set('settings', { ...data.settings, emailOnNewEnquiry: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
          </FieldRow>
          <FieldRow label="New messages" sublabel="When an artist sends a message">
            <Switch value={data.settings.emailOnNewMessage || false} onValueChange={(v) => set('settings', { ...data.settings, emailOnNewMessage: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
          </FieldRow>
          <FieldRow label="Reminders" sublabel="Follow-up emails for pending enquiries" last={!data.settings.emailEnquiryReminders}>
            <Switch value={data.settings.emailEnquiryReminders} onValueChange={(v) => set('settings', { ...data.settings, emailEnquiryReminders: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
          </FieldRow>
          {data.settings.emailEnquiryReminders && (
            <FieldRow label="Remind me after" last>
              <Select
                options={REMIND_AFTER_OPTS}
                value={data.settings.reminderHours || '48 hours'}
                onSelect={(v: string) => set('settings', { ...data.settings, reminderHours: v })}
              />
            </FieldRow>
          )}
        </SectionCard>

        <CalendarSync />

        <SectionCard title="Appearance">
          <FieldRow label="Theme" last>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['Light', 'Dark', 'System'] as const).map(opt => {
                const active = (data.settings.theme || 'System') === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => {
                      set('settings', { ...data.settings, theme: opt });
                      if (opt === 'Light' && isDark) toggleDark();
                      if (opt === 'Dark' && !isDark) toggleDark();
                    }}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: active ? colors.black : colors.border, backgroundColor: active ? colors.black : 'transparent' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : colors.black }}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Sign-in">
          <FieldRow label="Login email" sublabel={auth.currentUser?.email || ''}>
            <TouchableOpacity>
              <Text style={{ fontSize: 14, color: Colors.orange, fontWeight: '600' }}>Change</Text>
            </TouchableOpacity>
          </FieldRow>
          <FieldRow label="Password" last>
            <TouchableOpacity>
              <Text style={{ fontSize: 14, color: Colors.orange, fontWeight: '600' }}>Update</Text>
            </TouchableOpacity>
          </FieldRow>
        </SectionCard>

        <View style={[s.dangerSection, { borderColor: Colors.danger + '44' }]}>
          <Text style={s.dangerTitle}>Delete account</Text>
          <Text style={[s.dangerDesc, { color: colors.black }]}>
            To pause without losing anything, turn off Listed in Discover on Basic info instead.
          </Text>
          <Text style={[s.dangerDesc, { color: colors.grey, marginTop: 8 }]}>
            Permanently delete your venue and account. This cannot be undone.
          </Text>
          <TouchableOpacity
            style={[s.dangerBtn, s.dangerBtnActive]}
            onPress={() => {
              crossConfirm(
                'Delete account',
                'This will permanently delete your venue profile and account. This cannot be undone.',
                async () => {
                  try {
                    const { venueId: vId, uid } = profile ?? {};
                    if (vId) await deleteDoc(doc(db, 'venues', vId));
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
            <Text style={s.dangerBtnText}>Delete account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderBasicInfo() {
    const isVerified = !!data.techSpecs?.verifiedAt;
    const descLen = (data.description || '').length;
    return (
      <View style={s.section}>
        {renderPageHeader('Basic info')}

        {/* Listing / go-live hierarchy */}
        <SectionCard title="Listing">
          {(() => {
            const stages = [
              {
                num: 1,
                label: 'Go live',
                desc: 'Required to appear in search.',
                fields: [
                  { label: 'Venue name',      done: !!data.name?.trim(),                                             tab: 'Basic info' },
                  { label: 'Username',        done: !!data.username?.trim(),                                         tab: 'Basic info' },
                  { label: 'Venue type',      done: !!(data.venueTypes?.length || data.venueType?.trim()),            tab: 'Basic info' },
                  { label: 'Location',        done: !!(data.suburb?.trim() || data.streetAddress?.trim()),            tab: 'Basic info' },
                  { label: 'Booking contact', done: !!data.email?.trim(),                                            tab: 'Basic info' },
                ],
              },
              {
                num: 2,
                label: 'Build your profile',
                desc: 'Helps artists find the right fit.',
                fields: [
                  { label: 'About',      done: !!data.description?.trim(),                   tab: 'Basic info' },
                  { label: 'Photos',     done: (data.photos?.length ?? 0) > 0,               tab: 'Photos & video' },
                  { label: 'Genres',     done: (data.genrePreferences?.length ?? 0) > 0,     tab: 'Basic info' },
                  { label: 'Sets',       done: (data.setsYouBook?.length ?? 0) > 0,          tab: 'Basic info' },
                  { label: 'Age policy', done: !!data.ageRestriction?.trim(),                 tab: 'Basic info' },
                ],
              },
              {
                num: 3,
                label: 'Booking ready',
                desc: 'Tells artists what to expect when enquiring.',
                fields: [
                  { label: 'Payment terms', done: !!(data.bookingTerms?.payModels?.length),  tab: 'Booking terms' },
                  { label: 'Gig slots',     done: (data.gigNights?.length ?? 0) > 0,         tab: 'Gig slots' },
                  { label: 'Rooms',         done: (data.rooms?.length ?? 0) > 0,              tab: 'Rooms' },
                ],
              },
              {
                num: 4,
                label: 'Fully set up',
                desc: 'For professional venue listings.',
                fields: [
                  { label: 'Tech specs',   done: data.rooms?.some(r => (r.backlineItems?.length ?? 0) > 0 || !!r.pa?.trim()) ?? false, tab: 'Rooms' },
                  { label: 'Invoicing',    done: !!data.payment?.abn?.trim(),                                                         tab: 'Invoicing' },
                  { label: 'Social links', done: !!(data.instagram || data.facebook || data.website),                                 tab: 'Basic info' },
                ],
              },
            ];
            const liveStage = stages[0];
            const liveDone = liveStage.fields.every(f => f.done);
            return (
              <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
                {stages.map((stage, si) => {
                  const done = stage.fields.filter(f => f.done).length;
                  const total = stage.fields.length;
                  const allDone = done === total;
                  const isLive = si === 0;
                  return (
                    <View key={stage.num} style={{ marginBottom: si < stages.length - 1 ? 18 : 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: allDone ? '#2F7A4B' : colors.bgFaint, borderWidth: 1, borderColor: allDone ? '#2F7A4B' : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: allDone ? '#fff' : colors.grey }}>{allDone ? '✓' : stage.num}</Text>
                          </View>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>{stage.label}</Text>
                          {isLive && (
                            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: liveDone ? '#2F7A4B22' : '#FF000011', borderWidth: 1, borderColor: liveDone ? '#2F7A4B55' : '#FF000033' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: liveDone ? '#2F7A4B' : '#CC0000' }}>{liveDone ? 'LIVE' : 'NOT LIVE'}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 11, color: allDone ? '#2F7A4B' : colors.grey, fontWeight: '600' }}>{done}/{total}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.grey, marginBottom: 8 }}>{stage.desc}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                        {stage.fields.map(f => (
                          <TouchableOpacity
                            key={f.label}
                            onPress={() => { setActiveTab(f.tab); if (isMobileLayout) setMobileShowList(false); }}
                            activeOpacity={0.7}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: f.done ? '#2F7A4B44' : colors.border, backgroundColor: f.done ? '#2F7A4B11' : 'transparent' }}
                          >
                            <Text style={{ fontSize: 11, color: f.done ? '#2F7A4B' : colors.grey }}>{f.done ? '✓' : '○'}</Text>
                            <Text style={{ fontSize: 11, color: f.done ? '#2F7A4B' : colors.grey, fontWeight: f.done ? '600' : '400' }}>{f.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
          <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 16 }} />
          <FieldRow label="Listed in Discover" sublabel="Artists can find you in search and send enquiries. Turn off to pause your listing without deleting anything." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch
                value={data.settings.listed}
                onValueChange={async v => {
                  set('settings', { ...data.settings, listed: v });
                }}
                trackColor={{ false: colors.border, true: Colors.orange }}
                thumbColor="#fff"
              />
            </View>
          </FieldRow>
        </SectionCard>

        {/* Venue details */}
        <SectionCard title="Venue details">
          <FieldRow label="Venue name" error={showErrors && !data.name?.trim()}>
            <Input value={data.name} onChangeText={(v: string) => set('name', v)} placeholder="The Lantern Room" error={showErrors && !data.name?.trim()} />
          </FieldRow>
          <FieldRow label="Username" sublabel="Your public profile link.">
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}>
                <View style={{ paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgFaint }}>
                  <Text style={{ fontSize: 13, color: colors.grey }}>twaylo.com.au/</Text>
                </View>
                <TextInput
                  value={data.username || ''}
                  onChangeText={(v) => set('username', v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="thelanternroom"
                  placeholderTextColor={colors.grey}
                  style={{ flex: 1, fontSize: 14, padding: 11, color: colors.black }}
                  autoCapitalize="none"
                />
              </View>
              {data.username ? <Text style={{ fontSize: 12, color: '#2F7A4B', marginTop: 4 }}>Available</Text> : null}
            </View>
          </FieldRow>
          <FieldRow label="Venue type" sublabel="Select all that apply.">
            <Pills options={VENUE_TYPES} value={data.venueTypes?.length ? data.venueTypes : (data.venueType ? [data.venueType] : [])} onSelect={(v: string[]) => set('venueTypes', v)} multi />
          </FieldRow>
          <FieldRow label="Genres you book" sublabel="Artists in these genres see you first in Discover.">
            <Pills options={GENRES} value={data.genrePreferences || []} onSelect={(v: string[]) => set('genrePreferences', v)} multi />
          </FieldRow>
          <FieldRow label="Sets you book" sublabel="What kind of sets does your venue typically book?">
            <Pills options={SETS_BOOK_OPTS} value={data.setsYouBook || []} onSelect={(v: string[]) => set('setsYouBook', v)} multi />
          </FieldRow>
          <FieldRow label="Age policy" last>
            <Pills options={['All ages','18+ only','Varies by gig']} value={data.ageRestriction === 'Both' ? 'Varies by gig' : (data.ageRestriction || '')} onSelect={(v: string) => set('ageRestriction', v)} />
          </FieldRow>
        </SectionCard>

        {/* Location */}
        <SectionCard title="Location">
          <FieldRow label="Street address" sublabel="Street number and name. Shown on your profile.">
            <Input
              value={data.streetAddress}
              onChangeText={(v: string) => set('streetAddress', v)}
              placeholder="212 High St"
              error={showErrors && !data.streetAddress?.trim()}
            />
          </FieldRow>
          <FieldRow label="Suburb" sublabel="Start typing to search. Fills state and postcode automatically.">
            <SuburbSearch
              value={data.suburb || ''}
              onChange={(v: string) => set('suburb', v)}
              onAutofill={(suburb, state, postcode) => {
                set('suburb', suburb);
                set('state', state);
                set('postcode', postcode);
              }}
            />
          </FieldRow>
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Field label="STATE">
                <Select options={AU_STATES} value={data.state || ''} onSelect={(v: string) => set('state', v)} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="POSTCODE">
                <Input
                  value={data.postcode || ''}
                  onChangeText={(v: string) => set('postcode', v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="3070"
                  keyboardType="numeric"
                />
              </Field>
            </View>
          </View>
          {data.latitude && data.longitude ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
              <Text style={{ fontSize: 11, color: colors.grey, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}>
                {parseFloat(data.latitude).toFixed(4)}, {parseFloat(data.longitude).toFixed(4)}
              </Text>
            </View>
          ) : null}
        </SectionCard>

        {/* About the venue */}
        <SectionCard title="About the venue">
          <View style={{ padding: 16 }}>
            {!data.description?.trim() && (
              <TouchableOpacity
                onPress={() => set('description', `${data.name || 'We'} ${data.venueTypes?.length ? `is a ${data.venueTypes[0].toLowerCase()}` : 'is a live music venue'} located in ${data.suburb || '[suburb]'}. We host live music throughout the week across ${data.rooms?.length ? `${data.rooms.length} room${data.rooms.length > 1 ? 's' : ''}` : 'our venue'}. ${(data.genrePreferences?.length ?? 0) > 0 ? `We book ${data.genrePreferences!.slice(0, 3).join(', ')} and more.` : ''} Artists can browse our open slots and send an enquiry directly through Twaylo.`.trim())}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, alignSelf: 'flex-start' }}
                activeOpacity={0.7}
              >
                <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: Colors.orange + '55', backgroundColor: Colors.orange + '11' }}>
                  <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Start with a template</Text>
                </View>
              </TouchableOpacity>
            )}
            <Input value={data.description} onChangeText={(v: string) => set('description', v)} placeholder="Upstairs band room and front bar on High Street..." multiline />
            <Text style={{ fontSize: 12, color: colors.grey, textAlign: 'right', marginTop: 4 }}>{descLen} / 600</Text>
          </View>
        </SectionCard>

        {/* Public contact */}
        <SectionCard title="Public contact" subtitle="Shown on your public profile.">
          <FieldRow label="Website">
            <Input
              value={data.website}
              onChangeText={(v: string) => set('website', v)}
              onBlur={() => {
                const w = (data.website || '').trim();
                if (w && !w.startsWith('http://') && !w.startsWith('https://')) set('website', 'https://' + w);
              }}
              placeholder="https://thelanternroom.com.au"
              keyboardType="url"
            />
          </FieldRow>
          <FieldRow label="Instagram">
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgFaint }}>
                <Text style={{ fontSize: 13, color: colors.grey }}>instagram.com/</Text>
              </View>
              <TextInput value={data.instagram || ''} onChangeText={(v) => set('instagram', v)} placeholder="thelanternroom" placeholderTextColor={colors.grey} style={{ flex: 1, fontSize: 14, padding: 11, color: colors.black }} autoCapitalize="none" />
            </View>
          </FieldRow>
          <FieldRow label="Facebook">
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgFaint }}>
                <Text style={{ fontSize: 13, color: colors.grey }}>facebook.com/</Text>
              </View>
              <TextInput value={data.facebook || ''} onChangeText={(v) => set('facebook', v)} placeholder="thelanternroom" placeholderTextColor={colors.grey} style={{ flex: 1, fontSize: 14, padding: 11, color: colors.black }} autoCapitalize="none" />
            </View>
          </FieldRow>
          <FieldRow label="Phone">
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgFaint }}>
                <Text style={{ fontSize: 13, color: colors.grey }}>+61</Text>
              </View>
              <TextInput value={data.phone || ''} onChangeText={(v) => set('phone', v)} placeholder="3 9489 1234" placeholderTextColor={colors.grey} keyboardType="phone-pad" style={{ flex: 1, fontSize: 14, padding: 11, color: colors.black }} />
            </View>
          </FieldRow>
          <FieldRow label="Show phone on profile" sublabel="Off by default. Most venues prefer booking enquiries through Twaylo." last>
            <Switch value={data.showPhone || false} onValueChange={(v) => set('showPhone', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
          </FieldRow>
        </SectionCard>

        {/* Booking contact */}
        <SectionCard title="Booking contact" subtitle="Never shown publicly. Artists reach you through Twaylo messages; this is who gets notified.">
          <FieldRow label="Name">
            <Input value={data.bookingContactName || ''} onChangeText={(v: string) => set('bookingContactName', v)} placeholder="Jess Nguyen" />
          </FieldRow>
          <FieldRow label="Email" sublabel="Enquiry, reminder and verification emails go here." error={showErrors && !data.email?.trim()}>
            <Input value={data.email} onChangeText={(v: string) => set('email', v)} placeholder="bookings@thevenue.com.au" keyboardType="email-address" error={showErrors && !data.email?.trim()} />
          </FieldRow>
          <FieldRow label="Phone" sublabel="Optional." last>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgFaint }}>
                <Text style={{ fontSize: 13, color: colors.grey }}>+61</Text>
              </View>
              <TextInput value={data.bookingContactPhone || ''} onChangeText={(v) => set('bookingContactPhone', v)} placeholder="4XX XXX XXX" placeholderTextColor={colors.grey} keyboardType="phone-pad" style={{ flex: 1, fontSize: 14, padding: 11, color: colors.black }} />
            </View>
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderRooms() {
    const totalCapacity = data.rooms.reduce((sum, r) => sum + (parseInt(r.capacity) || 0), 0);
    const slotCountForRoom = (roomName: string) => data.gigNights.filter(n => n.room === roomName).length;
    return (
      <View style={s.section}>
        {renderPageHeader('Rooms')}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Text style={{ fontSize: 14, color: colors.grey }}>
            {data.rooms.length} room{data.rooms.length !== 1 ? 's' : ''}
            {data.rooms.length > 1 && totalCapacity
              ? ` · ${data.rooms.filter(r => parseInt(r.capacity) > 0).map(r => r.capacity).join(' and ')} cap`
              : totalCapacity ? ` · ${totalCapacity} cap` : ''}
          </Text>
          <TouchableOpacity onPress={addRoom} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.black }}>+ Add room</Text>
          </TouchableOpacity>
        </View>
        {data.rooms.map((room, i) => {
          const isOpen = expandedRoom === i;
          const slotCount = slotCountForRoom(room.name);
          const stageW = room.stageWidth || (room.stage?.match(/(\d+)\s*[x×]/i)?.[1] ?? '');
          const stageD = room.stageDepth || (room.stage?.match(/[x×]\s*(\d+)/i)?.[1] ?? '');
          const backlineItems: string[] = room.backlineItems?.length ? room.backlineItems : [];
          const monType = room.monitoringType || room.monitoring || '';
          return (
            <View key={i} style={[{ borderWidth: 1, borderRadius: 14, marginBottom: 14, backgroundColor: colors.bg, borderColor: colors.border }]}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }} onPress={() => setExpandedRoom(isOpen ? null : i)}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.black }}>{room.name || 'Unnamed room'}</Text>
                    {slotCount === 0 && room.name ? (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#FF000011', borderWidth: 1, borderColor: '#FF000033' }}>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: '#CC0000' }}>No slots</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 13, color: colors.grey, marginTop: 2 }}>
                    {[room.capacity ? `${room.capacity} cap` : null, (stageW && stageD) ? `${stageW} × ${stageD} m stage` : null, slotCount ? `${slotCount} slot${slotCount !== 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.grey, fontWeight: '500' }}>{isOpen ? 'Close' : 'Edit'}</Text>
              </TouchableOpacity>
              {isOpen && (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 20 }}>
                  <FieldRow label="Room name">
                    <Input value={room.name} onChangeText={(v: string) => setRoom(i, 'name', v)} placeholder="e.g. Band room" />
                  </FieldRow>
                  <FieldRow label="Capacity" sublabel="Licensed capacity.">
                    <Input value={room.capacity} onChangeText={(v: string) => setRoom(i, 'capacity', v)} placeholder="350" keyboardType="numeric" style={{ width: 100 }} />
                  </FieldRow>
                  <FieldRow label="Stage size" sublabel="Metres, width × depth.">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Input value={room.stageWidth || ''} onChangeText={(v: string) => setRoom(i, 'stageWidth', v)} placeholder="6" keyboardType="decimal-pad" style={{ width: 72 }} />
                      <Text style={{ color: colors.grey }}>×</Text>
                      <Input value={room.stageDepth || ''} onChangeText={(v: string) => setRoom(i, 'stageDepth', v)} placeholder="4" keyboardType="decimal-pad" style={{ width: 72 }} />
                    </View>
                  </FieldRow>
                  <FieldRow label="PA system">
                    <Input value={room.pa} onChangeText={(v: string) => setRoom(i, 'pa', v)} placeholder="e.g. d&b Y-series, Midas M32, 24 channels" />
                  </FieldRow>
                  <FieldRow label="Monitoring">
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {MONITORING_PILL_OPTS.map(opt => {
                          const active = monType === opt;
                          return (
                            <TouchableOpacity key={opt} onPress={() => setRoom(i, 'monitoringType', active ? '' : opt)} style={{ borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: active ? colors.black : 'transparent', borderColor: active ? colors.black : colors.border }}>
                              <Text style={{ fontSize: 13, fontWeight: active ? '600' : '400', color: active ? '#fff' : colors.black }}>{opt}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Input value={room.monitoringMixes || ''} onChangeText={(v: string) => setRoom(i, 'monitoringMixes', v)} placeholder="e.g. 4 wedge mixes" />
                    </View>
                  </FieldRow>
                  <FieldRow label="Backline available" sublabel="Matched against what artists list as needed from the venue.">
                    <View>
                      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                        {([
                          { label: 'PA only',    items: ['Mics + stands', 'DI boxes'] },
                          { label: 'Rock band',  items: ['Drum kit', 'Cymbals', 'Bass amp', 'Guitar amp', 'Mics + stands', 'DI boxes'] },
                          { label: 'Full house', items: BACKLINE_PILL_OPTS },
                        ] as { label: string; items: string[] }[]).map(preset => (
                          <TouchableOpacity
                            key={preset.label}
                            onPress={() => setRoom(i, 'backlineItems', preset.items)}
                            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: Colors.orange + '55', backgroundColor: Colors.orange + '11' }}
                          >
                            <Text style={{ fontSize: 11, color: Colors.orange, fontWeight: '600' }}>{preset.label}</Text>
                          </TouchableOpacity>
                        ))}
                        {backlineItems.length > 0 && (
                          <TouchableOpacity
                            onPress={() => setRoom(i, 'backlineItems', [])}
                            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}
                          >
                            <Text style={{ fontSize: 11, color: colors.grey }}>Clear</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {BACKLINE_PILL_OPTS.map(opt => {
                          const active = backlineItems.includes(opt);
                          return (
                            <TouchableOpacity key={opt} onPress={() => setRoom(i, 'backlineItems', active ? backlineItems.filter(b => b !== opt) : [...backlineItems, opt])} style={{ borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: active ? colors.black : 'transparent', borderColor: active ? colors.black : colors.border }}>
                              <Text style={{ fontSize: 13, fontWeight: active ? '600' : '400', color: active ? '#fff' : colors.black }}>{opt}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </FieldRow>
                  <FieldRow label="Lighting">
                    <Input value={room.lighting} onChangeText={(v: string) => setRoom(i, 'lighting', v)} placeholder="e.g. 8 LED pars, hazer, operator on weekends" />
                  </FieldRow>
                  <FieldRow label="Power">
                    <Input value={room.power} onChangeText={(v: string) => setRoom(i, 'power', v)} placeholder="e.g. 4 × 10A stage left, 2 × 10A stage right" />
                  </FieldRow>
                  <FieldRow label="Notes for acts">
                    <Input value={room.notes} onChangeText={(v: string) => setRoom(i, 'notes', v)} placeholder="Anything specific to this room: stairs to the stage, low ceiling, house kit rules." multiline />
                  </FieldRow>
                  <FieldRow label="Tech spec documents" sublabel="Stage plot, input list, full spec sheet.">
                    <View style={{ gap: 8 }}>
                      {(room.documents || []).map((doc, idx) => (
                        <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
                          <Text style={{ flex: 1, fontSize: 13, color: colors.black }} numberOfLines={1}>{doc.name || doc.url}</Text>
                          <TouchableOpacity onPress={() => setRoom(i, 'documents', (room.documents || []).filter((_: any, di: number) => di !== idx))}>
                            <Text style={{ fontSize: 16, color: colors.grey }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity onPress={() => pickRoomDocument(i)} disabled={roomDocUploading === i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.black }}>{roomDocUploading === i ? 'Uploading...' : 'Upload'}</Text>
                      </TouchableOpacity>
                    </View>
                  </FieldRow>
                  <TouchableOpacity onPress={() => crossConfirm('Remove room', 'This will remove the room and any gig slots assigned to it.', () => removeRoom(i), true)} style={{ alignSelf: 'flex-end', borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 13, color: Colors.danger, fontWeight: '600' }}>Remove room</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  function renderGigSlots() {
    const fmtTime = (t: string | null) => {
      if (!t) return '';
      const [h, m] = t.split(':').map(Number);
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
    };
    const venueGenresSummary = (data.genrePreferences || []).length
      ? (data.genrePreferences || []).slice(0, 3).join(', ') + ((data.genrePreferences || []).length > 3 ? ` +${(data.genrePreferences || []).length - 3}` : '')
      : 'None set';
    const defaultPaySummary = () => {
      const bt = data.bookingTerms;
      if (!bt?.payModels?.length) return 'Using venue terms';
      const parts = [...bt.payModels];
      if (bt.negotiable) parts.push('negotiable');
      return parts.join(', ');
    };
    const defaultHospSummary = () => {
      const bt = data.bookingTerms;
      if (!bt) return 'Using venue terms';
      const parts: string[] = [];
      if (bt.guestList && bt.guestList !== '0') parts.push(`${bt.guestList} guests`);
      if (bt.meals) parts.push('Meals');
      if (bt.drinks) parts.push('Drinks');
      return parts.length ? parts.join(', ') : 'Using venue terms';
    };

    return (
      <View style={s.section}>
        {renderPageHeader('Gig slots')}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: colors.grey, flex: 1, lineHeight: 19 }}>
            Recurring slots artists can browse and enquire against. One-off changes are managed on the timetable.
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 12 }}
            onPress={addNight}
          >
            <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>+ Add slot</Text>
          </TouchableOpacity>
        </View>

        {sortedNights(data.gigNights).map(night => {
          const i = data.gigNights.indexOf(night);
          const isOpen = expandedNight === i;
          const nightDays = night.days?.length ? night.days : (night.day ? [night.day] : []);
          const nightAllowedDow = nightDays.map(d => DAY_NAMES_DOW[d]).filter((n): n is number => n !== undefined);
          const hasError = showErrors && touchedNights.has(i) && (!(night.days?.length || night.day) || !night.startTime || !night.startDate || (!night.ongoing && !night.continuous && !night.endDate));
          const isOngoing = night.ongoing !== false && night.continuous !== false;
          const activeModels = night.paymentModels?.length ? night.paymentModels : (night.paymentModel ? [night.paymentModel] : []);
          const slotLabel = night.name || (night.slotType ? `${night.slotType} slot` : 'New slot');
          const daySummary = nightDays.map(d => d.slice(0, 3)).join(', ');
          const timeSummary = night.startTime ? fmtTime(night.startTime) : '';
          const lenSummary = night.duration ? `${night.duration} min` : '';
          const roomSummary = night.room || '';
          const payLabel = night.useDefaultPay !== false
            ? defaultPaySummary()
            : (activeModels.length ? activeModels.join(' or ') + (night.negotiable ? ', negotiable' : '') : '');
          const summaryLine = [daySummary, timeSummary, lenSummary, roomSummary, payLabel].filter(Boolean).join(' · ');

          // Auto load-in / soundcheck
          const autoLoadIn = night.startTime ? subtractMinutes(night.startTime, 120) : null;
          const autoSoundcheck = night.startTime ? subtractMinutes(night.startTime, 60) : null;
          const loadInIsAuto = night.loadIn === null || night.loadIn === undefined || night.loadIn === autoLoadIn;
          const soundcheckIsAuto = night.soundcheck === null || night.soundcheck === undefined || night.soundcheck === autoSoundcheck;

          return (
            <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: hasError ? Colors.danger : colors.border, marginBottom: 12 }]}>
              <TouchableOpacity style={s.cardHeader} onPress={() => { if (!isOpen) setTouchedNights(prev => new Set([...prev, i])); setExpandedNight(isOpen ? null : i); }} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.black }}>{slotLabel}</Text>
                    {night.slotType ? (
                      <View style={{ backgroundColor: colors.border, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, color: colors.grey, fontWeight: '600' }}>{night.slotType}</Text>
                      </View>
                    ) : null}
                  </View>
                  {summaryLine ? <Text style={{ fontSize: 12, color: colors.grey, lineHeight: 17 }} numberOfLines={1}>{summaryLine}</Text> : null}
                </View>
                <Text style={[s.cardChevron, { marginLeft: 8 }]}>{isOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {isOpen && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 0 }}>

                  {/* WHEN */}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 10 }}>When</Text>

                  <Field label="NAME" helper="Optional. Shown to artists on your timetable.">
                    <View style={{ gap: 6 }}>
                      <Input value={night.name} onChangeText={(v: string) => setNight(i, 'name', v)} placeholder="e.g. Friday Night Sessions" />
                      {!night.name && nightDays.length > 0 && night.startTime && (() => {
                        const suggestedName = `${nightDays[0]} ${fmtTime(night.startTime)} ${night.slotType ? night.slotType : 'Live Music'}`;
                        return (
                          <TouchableOpacity onPress={() => setNight(i, 'name', suggestedName)} activeOpacity={0.7} style={{ alignSelf: 'flex-start' }}>
                            <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Suggest: "{suggestedName}"</Text>
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                  </Field>

                  <Field label="DAYS" error={showErrors && touchedNights.has(i) && !nightDays.length}>
                    <Pills options={CANONICAL_DAYS} value={nightDays} onSelect={(v: string[]) => setNightFields(i, { days: v, day: v[0] || '' })} multi />
                  </Field>

                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 2 }}>
                      <Field label="START TIME" error={showErrors && touchedNights.has(i) && !night.startTime}>
                        <TimePicker
                          value={night.startTime}
                          onChange={(v: string) => setNightFields(i, {
                            startTime: v,
                            loadIn: night.loadIn === null || night.loadIn === undefined ? null : subtractMinutes(v, 120),
                            soundcheck: night.soundcheck === null || night.soundcheck === undefined ? null : subtractMinutes(v, 60),
                          })}
                          defaultValue="19:00"
                        />
                      </Field>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="SET LENGTH">
                        <Select
                          options={SET_LENGTHS_OPTS}
                          value={night.duration > 0 ? (SET_LENGTHS_OPTS.find(o => parseInt(o) === night.duration) || `${night.duration} min`) : ''}
                          onSelect={(v: string) => setNight(i, 'duration', parseInt(v) || 0)}
                        />
                      </Field>
                    </View>
                  </View>

                  {/* Load-in + soundcheck with Auto chip */}
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Field label="LOAD-IN">
                        {loadInIsAuto ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1, pointerEvents: 'none', opacity: 0.5 }}>
                              <Input value={autoLoadIn ? fmtTime(autoLoadIn) : ''} placeholder="Auto" />
                            </View>
                            <View style={{ backgroundColor: Colors.orange + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontSize: 11, color: Colors.orange, fontWeight: '700' }}>Auto</Text>
                            </View>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <TimePicker value={night.loadIn || ''} onChange={(v: string) => setNight(i, 'loadIn', v)} />
                            </View>
                            <TouchableOpacity onPress={() => setNight(i, 'loadIn', null)}>
                              <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Reset</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </Field>
                      {loadInIsAuto && (
                        <TouchableOpacity onPress={() => setNight(i, 'loadIn', autoLoadIn || '')} style={{ marginTop: -6, marginBottom: 8 }}>
                          <Text style={{ fontSize: 12, color: Colors.orange }}>Edit</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="SOUNDCHECK">
                        {soundcheckIsAuto ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1, pointerEvents: 'none', opacity: 0.5 }}>
                              <Input value={autoSoundcheck ? fmtTime(autoSoundcheck) : ''} placeholder="Auto" />
                            </View>
                            <View style={{ backgroundColor: Colors.orange + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontSize: 11, color: Colors.orange, fontWeight: '700' }}>Auto</Text>
                            </View>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <TimePicker value={night.soundcheck || ''} onChange={(v: string) => setNight(i, 'soundcheck', v)} />
                            </View>
                            <TouchableOpacity onPress={() => setNight(i, 'soundcheck', null)}>
                              <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Reset</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </Field>
                      {soundcheckIsAuto && (
                        <TouchableOpacity onPress={() => setNight(i, 'soundcheck', autoSoundcheck || '')} style={{ marginTop: -6, marginBottom: 8 }}>
                          <Text style={{ fontSize: 12, color: Colors.orange }}>Edit</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Runs from + Ongoing */}
                  <Field label="RUNS FROM" error={showErrors && touchedNights.has(i) && !night.startDate}>
                    <DatePicker value={night.startDate} onChange={(v: string) => setNight(i, 'startDate', v)} allowedDays={nightAllowedDow} />
                  </Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Switch
                      value={isOngoing}
                      onValueChange={(v) => setNightFields(i, { ongoing: v, continuous: v, endDate: v ? '' : night.endDate })}
                      trackColor={{ false: colors.border, true: Colors.orange }}
                      thumbColor="#fff"
                    />
                    <Text style={{ fontSize: 14, color: colors.black }}>Ongoing (no end date)</Text>
                  </View>
                  {!isOngoing && (
                    <Field label="END DATE" error={showErrors && touchedNights.has(i) && !night.endDate}>
                      <DatePicker value={night.endDate} onChange={(v: string) => setNight(i, 'endDate', v)} allowedDays={nightAllowedDow} rangeStart={night.startDate} />
                    </Field>
                  )}

                  {/* WHERE AND WHAT */}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 }}>Where and what</Text>

                  <Field label="SLOT TYPE">
                    <Pills options={SLOT_TYPES} value={night.slotType || 'Headline'} onSelect={(v: string) => setNight(i, 'slotType', v)} />
                  </Field>

                  <Field label="ROOM" helper="'Any room' if not tied to a specific space.">
                    <Pills
                      options={['Any room', ...data.rooms.map(r => r.name).filter(Boolean)]}
                      value={night.room || 'Any room'}
                      onSelect={(v: string) => setNight(i, 'room', v === 'Any room' ? '' : v)}
                    />
                  </Field>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>Use your venue genres</Text>
                      <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{venueGenresSummary}</Text>
                    </View>
                    <Switch
                      value={night.useVenueGenres !== false}
                      onValueChange={(v) => setNightFields(i, { useVenueGenres: v, genres: v ? null : (night.genres || []) })}
                      trackColor={{ false: colors.border, true: Colors.orange }}
                      thumbColor="#fff"
                    />
                  </View>
                  {night.useVenueGenres === false && (
                    <Field label="GENRES FOR THIS SLOT">
                      <Pills options={GENRES} value={night.genres || []} onSelect={(v: string[]) => setNight(i, 'genres', v)} multi />
                    </Field>
                  )}

                  {/* PAY */}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 }}>Pay</Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>Use your default pay</Text>
                      <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{defaultPaySummary()}</Text>
                    </View>
                    <Switch
                      value={night.useDefaultPay !== false}
                      onValueChange={(v) => setNight(i, 'useDefaultPay', v)}
                      trackColor={{ false: colors.border, true: Colors.orange }}
                      thumbColor="#fff"
                    />
                  </View>

                  {night.useDefaultPay === false && (
                    <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, marginBottom: 14, gap: 12 }}>
                      <Field label="PAYMENT MODELS">
                        <Pills
                          options={PAY_MODELS}
                          value={activeModels}
                          onSelect={(newModels: string[]) => {
                            const last = newModels[newModels.length - 1];
                            const next = last === 'Unpaid' ? ['Unpaid'] : newModels.filter(m => m !== 'Unpaid');
                            setNightFields(i, { paymentModels: next, paymentModel: '' });
                          }}
                          multi
                        />
                      </Field>
                      {activeModels.includes('Flat fee') && (() => {
                        const minV = parseFloat(night.feeMin), maxV = parseFloat(night.feeMax);
                        const maxErr = night.feeMax !== '' && night.feeMin !== '' && !isNaN(minV) && !isNaN(maxV) && maxV < minV;
                        return (
                          <Field label="FLAT FEE RANGE">
                            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                              <View style={{ width: 90 }}><CurrencyInput value={night.feeMin} onChangeText={(v: string) => setNight(i, 'feeMin', v)} placeholder="Min" /></View>
                              <View style={{ width: 90 }}><CurrencyInput value={night.feeMax} onChangeText={(v: string) => setNight(i, 'feeMax', v)} placeholder="Max" error={maxErr} /></View>
                              <View style={{ flex: 1 }}><Select options={FEE_BASIS_OPTS} value={night.feeBasis || 'Per act'} onSelect={(v: string) => setNight(i, 'feeBasis', v)} /></View>
                            </View>
                            {maxErr && <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 4 }}>Max must be higher than min.</Text>}
                          </Field>
                        );
                      })()}
                      {activeModels.includes('Door split') && (
                        <Field label="DOOR SPLIT TERMS">
                          <Input value={night.doorSplit} onChangeText={(v: string) => setNight(i, 'doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" />
                        </Field>
                      )}
                      {activeModels.includes('Guarantee + split') && (
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Field label="GUARANTEE ($)">
                              <CurrencyInput value={night.guaranteeAmount} onChangeText={(v: string) => setNight(i, 'guaranteeAmount', v)} placeholder="0" />
                            </Field>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Field label="SPLIT TERMS">
                              <Input value={night.guaranteeSplit} onChangeText={(v: string) => setNight(i, 'guaranteeSplit', v)} placeholder="e.g. 60/40 after" />
                            </Field>
                          </View>
                        </View>
                      )}
                      {activeModels.includes('Bar split') && (
                        <Field label="BAR SPLIT TERMS">
                          <Input value={night.barSplit} onChangeText={(v: string) => setNight(i, 'barSplit', v)} placeholder="e.g. 10% of bar takings" />
                        </Field>
                      )}
                      {activeModels.includes('Ticket split') && (
                        <Field label="TICKET SPLIT">
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1 }}><Input value={night.ticketSalesSplit} onChangeText={(v: string) => setNight(i, 'ticketSalesSplit', v)} placeholder="% to acts" keyboardType="numeric" /></View>
                            <View style={{ flex: 1 }}><Select options={TICKETING_BY_OPTS} value={night.ticketingHandledBy || 'Venue'} onSelect={(v: string) => setNight(i, 'ticketingHandledBy', v)} /></View>
                          </View>
                        </Field>
                      )}
                      {activeModels.includes('Unpaid') && (
                        <View style={{ backgroundColor: Colors.orange + '11', borderRadius: 8, padding: 10 }}>
                          <Text style={{ fontSize: 13, color: Colors.orange, lineHeight: 19 }}>This slot will be clearly labelled as unpaid on your timetable.</Text>
                        </View>
                      )}
                      {!activeModels.includes('Unpaid') && activeModels.length > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 14, color: colors.black }}>Open to negotiation</Text>
                          <Switch
                            value={night.negotiable !== false}
                            onValueChange={(v) => setNight(i, 'negotiable', v)}
                            trackColor={{ false: colors.border, true: Colors.orange }}
                            thumbColor="#fff"
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* WHAT ACTS GET */}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 }}>What acts get</Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>Use your default hospitality</Text>
                      <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{defaultHospSummary()}</Text>
                    </View>
                    <Switch
                      value={night.useDefaultHospitality !== false}
                      onValueChange={(v) => setNight(i, 'useDefaultHospitality', v)}
                      trackColor={{ false: colors.border, true: Colors.orange }}
                      thumbColor="#fff"
                    />
                  </View>

                  {night.useDefaultHospitality === false && (
                    <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, marginBottom: 14, gap: 12 }}>
                      <Field label="GUEST LIST PER ACT">
                        <Select options={GUEST_LIST_OPTS} value={night.guestList || '0'} onSelect={(v: string) => setNight(i, 'guestList', v)} />
                      </Field>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.black }}>Meals</Text>
                        <Switch
                          value={night.meals || false}
                          onValueChange={(v) => setNight(i, 'meals', v)}
                          trackColor={{ false: colors.border, true: Colors.orange }}
                          thumbColor="#fff"
                        />
                      </View>
                      {night.meals && (
                        <Input value={night.mealsDetails} onChangeText={(v: string) => setNight(i, 'mealsDetails', v)} placeholder="e.g. meal voucher per performer" />
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ fontSize: 14, color: colors.black }}>Drinks</Text>
                        <Switch
                          value={night.drinks || false}
                          onValueChange={(v) => setNight(i, 'drinks', v)}
                          trackColor={{ false: colors.border, true: Colors.orange }}
                          thumbColor="#fff"
                        />
                      </View>
                      {night.drinks && (
                        <Input value={night.drinksDetails} onChangeText={(v: string) => setNight(i, 'drinksDetails', v)} placeholder="e.g. 2 drinks each" />
                      )}
                    </View>
                  )}

                  {/* FOR ARTISTS */}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 10 }}>For artists</Text>

                  <Field label="MINIMUM NOTICE">
                    <Select
                      options={['Default (use booking terms)', ...MIN_NOTICE_OPTS]}
                      value={night.minNotice || 'Default (use booking terms)'}
                      onSelect={(v: string) => setNight(i, 'minNotice', v === 'Default (use booking terms)' ? '' : v)}
                    />
                  </Field>

                  <Field label="NOTES FOR ARTISTS" helper="Anything acts should know before they enquire for this slot.">
                    <Input value={night.notes} onChangeText={(v: string) => setNight(i, 'notes', v)} placeholder="e.g. Acoustic only. Strict 45-minute sets." multiline />
                  </Field>

                  {showErrors && touchedNights.has(i) && (() => {
                    const missing: string[] = [];
                    if (!nightDays.length) missing.push('Days');
                    if (!night.startTime) missing.push('Start time');
                    if (!night.startDate) missing.push('Runs from date');
                    if (!isOngoing && !night.endDate) missing.push('End date');
                    if (missing.length === 0) return null;
                    return (
                      <View style={{ backgroundColor: 'rgba(233,69,96,0.06)', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(233,69,96,0.25)' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.danger, marginBottom: 6 }}>Complete before saving:</Text>
                        {missing.map(m => (
                          <Text key={m} style={{ fontSize: 13, color: Colors.danger, lineHeight: 20 }}>{`\u2022 ${m}`}</Text>
                        ))}
                      </View>
                    );
                  })()}

                  {/* Slot footer */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <TouchableOpacity
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                      onPress={() => {
                        const copy = { ...night, name: (night.name ? `${night.name} (copy)` : ''), _isNew: true };
                        setData(prev => {
                          const nights = [...prev.gigNights, copy];
                          setTouchedNights(p => new Set([...p, nights.length - 1]));
                          setExpandedNight(nights.length - 1);
                          return { ...prev, gigNights: nights };
                        });
                      }}
                    >
                      <Text style={{ fontSize: 13, color: colors.black, fontWeight: '600' }}>Duplicate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                      onPress={() => crossConfirm('Delete slot', "This will remove the slot and any open enquiries tied to it. This can't be undone.", () => removeNight(i), true)}
                    >
                      <Text style={{ fontSize: 13, color: Colors.danger, fontWeight: '600' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {data.gigNights.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
            <Text style={{ fontSize: 15, color: colors.grey }}>No slots yet.</Text>
            <Text style={{ fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 }}>Add a recurring slot and artists can start enquiring against it.</Text>
          </View>
        )}
      </View>
    );
  }

  function renderAccessFacilities() {
    const ts = data.techSpecs || {};
    const setTs = (updates: Record<string, any>) => set('techSpecs', { ...ts, ...updates });
    return (
      <View style={s.section}>
        {renderPageHeader('Access & facilities')}

        <SectionCard title="Arrival">
          <FieldRow label="Load-in access" sublabel="Instructions for getting gear in">
            <Input value={ts.loadIn || ts.loadInParking || ''} onChangeText={(v: string) => setTs({ loadIn: v, loadInParking: v })} placeholder="e.g. rear loading dock, access via laneway" />
          </FieldRow>
          <FieldRow label="Parking" last>
            <Pills options={PARKING_OPTS} value={ts.parkingOptions || []} onSelect={(v: string[]) => setTs({ parkingOptions: v })} multi />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Sound and curfew">
          <FieldRow label="In-house engineer">
            <Pills options={ENGINEER_COST_OPTS} value={ts.engineerCost || ''} onSelect={(v: string) => setTs({ engineerCost: v, soundEngineer: v !== 'Not provided' })} />
          </FieldRow>
          {ts.engineerCost && ts.engineerCost !== 'Not provided' && (
            <FieldRow label="Engineer notes">
              <Input value={ts.soundEngineerDetails || ''} onChangeText={(v: string) => setTs({ soundEngineerDetails: v })} placeholder="e.g. available for all shows, contact in advance" />
            </FieldRow>
          )}
          <FieldRow label="Curfew">
            <Select options={CURFEW_OPTS} value={ts.curfew || 'No curfew'} onSelect={(v: string) => setTs({ curfew: v === 'No curfew' ? '' : v })} />
          </FieldRow>
          <FieldRow label="Noise restrictions" sublabel="Council or venue rules" last>
            <Input value={ts.noiseRestrictions || ts.noiseNotes || ''} onChangeText={(v: string) => setTs({ noiseRestrictions: v, noiseNotes: v })} placeholder="e.g. hard limit 95dB at FOH after 11pm" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Artist facilities">
          <FieldRow label="Green room">
            <Pills options={GREEN_ROOM_OPTS} value={ts.greenRoomType || ''} onSelect={(v: string) => setTs({ greenRoomType: v, greenRoom: v !== 'None' })} />
          </FieldRow>
          {ts.greenRoomType && ts.greenRoomType !== 'None' && (
            <FieldRow label="Green room details">
              <Input value={ts.greenRoomDetails || ''} onChangeText={(v: string) => setTs({ greenRoomDetails: v })} placeholder="e.g. fridge, couch, mirror" />
            </FieldRow>
          )}
          <FieldRow label="Merch table" sublabel="Area for acts to sell merchandise" last>
            <Switch value={ts.merchSpace || false} onValueChange={(v) => setTs({ merchSpace: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Accessibility">
          {([
            { label: 'Wheelchair access',   stateKey: 'wheelchairAccessState' },
            { label: 'Accessible bathroom', stateKey: 'accessibleBathroomState' },
            { label: 'Step-free stage',     stateKey: 'stepFreeStageState' },
            { label: 'Accessible parking',  stateKey: 'wheelchairParkingState' },
          ] as { label: string; stateKey: string }[]).map((item, idx, arr) => (
            <FieldRow key={item.stateKey} label={item.label} last={idx === arr.length - 1}>
              <Pills
                options={ACCESSIBILITY_STATES}
                value={ts[item.stateKey] || ''}
                onSelect={(v: string) => setTs({ [item.stateKey]: v })}
              />
            </FieldRow>
          ))}
        </SectionCard>

        <SectionCard title="General notes">
          <View style={{ padding: 16 }}>
            <Input value={ts.notes || ''} onChangeText={(v: string) => setTs({ notes: v })} placeholder="Anything acts should know about the venue that doesn't fit above" multiline />
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderBookingTerms() {
    const bt = data.bookingTerms || { ...BLANK_BOOKING_TERMS };
    const setBt = (updates: Partial<typeof BLANK_BOOKING_TERMS>) =>
      set('bookingTerms', { ...bt, ...updates });
    const activeModels = bt.payModels || [];

    return (
      <View style={s.section}>
        {renderPageHeader('Booking terms')}

        {/* Three-step strip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 20, gap: 4 }}>
          {['Booking terms (defaults)', 'Gig slot (can override)', 'Booking (confirmed deal)'].map((label, idx) => (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={{ alignItems: 'center', flex: 1 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: idx === 0 ? Colors.orange : colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: idx === 0 ? '#fff' : colors.grey }}>{idx + 1}</Text>
                </View>
                <Text style={{ fontSize: 10, color: idx === 0 ? Colors.orange : colors.grey, textAlign: 'center', lineHeight: 13, fontWeight: idx === 0 ? '600' : '400' }}>{label}</Text>
              </View>
              {idx < 2 && <Text style={{ fontSize: 14, color: colors.border, marginBottom: 14 }}>›</Text>}
            </View>
          ))}
        </View>

        <SectionCard title="How you pay acts">
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            <Field label="PAYMENT MODELS">
              <Pills
                options={PAY_MODELS}
                value={activeModels}
                onSelect={(newModels: string[]) => {
                  const last = newModels[newModels.length - 1];
                  const next = last === 'Unpaid' ? ['Unpaid'] : newModels.filter(m => m !== 'Unpaid');
                  setBt({ payModels: next });
                }}
                multi
              />
            </Field>
            {activeModels.includes('Flat fee') && (() => {
              const minV = parseFloat(bt.flatFeeMin), maxV = parseFloat(bt.flatFeeMax);
              const maxErr = bt.flatFeeMax !== '' && bt.flatFeeMin !== '' && !isNaN(minV) && !isNaN(maxV) && maxV < minV;
              return (
                <Field label="FLAT FEE RANGE">
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={{ width: 90 }}><CurrencyInput value={bt.flatFeeMin} onChangeText={(v: string) => setBt({ flatFeeMin: v })} placeholder="Min" /></View>
                    <View style={{ width: 90 }}><CurrencyInput value={bt.flatFeeMax} onChangeText={(v: string) => setBt({ flatFeeMax: v })} placeholder="Max" error={maxErr} /></View>
                    <View style={{ flex: 1 }}><Select options={FEE_BASIS_OPTS} value={bt.flatFeeBasis || 'Per act'} onSelect={(v: string) => setBt({ flatFeeBasis: v })} /></View>
                  </View>
                  {maxErr && <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 4 }}>Max must be higher than min.</Text>}
                </Field>
              );
            })()}
            {activeModels.includes('Door split') && (
              <Field label="DOOR SPLIT TERMS">
                <Input value={bt.doorSplit} onChangeText={(v: string) => setBt({ doorSplit: v })} placeholder="e.g. 70/30 artist/venue after $200 covered" />
              </Field>
            )}
            {activeModels.includes('Guarantee + split') && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Field label="GUARANTEE ($)"><CurrencyInput value={bt.guaranteeAmount} onChangeText={(v: string) => setBt({ guaranteeAmount: v })} placeholder="0" /></Field></View>
                <View style={{ flex: 1 }}><Field label="SPLIT TERMS"><Input value={bt.guaranteeSplit} onChangeText={(v: string) => setBt({ guaranteeSplit: v })} placeholder="e.g. 60/40 after" /></Field></View>
              </View>
            )}
            {activeModels.includes('Bar split') && (
              <Field label="BAR SPLIT TERMS">
                <Input value={bt.barSplit} onChangeText={(v: string) => setBt({ barSplit: v })} placeholder="e.g. 10% of bar takings" />
              </Field>
            )}
            {activeModels.includes('Ticket split') && (
              <Field label="TICKET SPLIT">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Input value={bt.ticketSplitPct} onChangeText={(v: string) => setBt({ ticketSplitPct: v })} placeholder="% to acts" keyboardType="numeric" /></View>
                  <View style={{ flex: 1 }}><Select options={TICKETING_BY_OPTS} value={bt.ticketingBy || 'Venue'} onSelect={(v: string) => setBt({ ticketingBy: v })} /></View>
                </View>
              </Field>
            )}
            {activeModels.includes('Unpaid') && (
              <View style={{ backgroundColor: Colors.orange + '11', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: Colors.orange, lineHeight: 19 }}>Slots using these defaults will be clearly labelled as unpaid on your timetable.</Text>
              </View>
            )}
            {!activeModels.includes('Unpaid') && activeModels.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Open to negotiation</Text>
                <Switch value={bt.negotiable !== false} onValueChange={(v) => setBt({ negotiable: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
            )}
            <Field label="PAYMENT METHODS">
              <Pills options={['Bank transfer', 'Cash', 'PayPal', 'Stripe', 'Other']} value={bt.methods || []} onSelect={(v: string[]) => setBt({ methods: v })} multi />
            </Field>
            <Field label="WHEN ACTS ARE PAID">
              <Select options={PAY_TIMING_OPTS} value={bt.paymentTiming || ''} onSelect={(v: string) => setBt({ paymentTiming: v })} />
            </Field>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: bt.depositRequired ? 8 : 0 }}>
              <Text style={{ fontSize: 14, color: colors.black }}>Deposit required</Text>
              <Switch value={bt.depositRequired || false} onValueChange={(v) => setBt({ depositRequired: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
            </View>
            {bt.depositRequired && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 12 }}>
                <View style={{ flex: 1 }}><Field label="AMOUNT ($)"><CurrencyInput value={bt.depositAmount} onChangeText={(v: string) => setBt({ depositAmount: v })} placeholder="0" /></Field></View>
                <View style={{ flex: 1 }}><Field label="DUE"><Select options={DEPOSIT_DUE_OPTS} value={bt.depositDue || 'On booking'} onSelect={(v: string) => setBt({ depositDue: v })} /></Field></View>
              </View>
            )}
          </View>
        </SectionCard>

        <SectionCard title="Booking rules">
          <FieldRow label="Default minimum notice" sublabel="How much lead time you need. Slots can override this." last>
            <Select options={MIN_NOTICE_OPTS} value={bt.minNotice || '1 week'} onSelect={(v: string) => setBt({ minNotice: v })} />
          </FieldRow>
        </SectionCard>

        <SectionCard title="What acts get">
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            <Field label="GUEST LIST PER ACT">
              <Select options={GUEST_LIST_OPTS} value={bt.guestList || '0'} onSelect={(v: string) => setBt({ guestList: v })} />
            </Field>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: bt.meals ? 8 : 16 }}>
              <Text style={{ fontSize: 14, color: colors.black }}>Meals</Text>
              <Switch value={bt.meals || false} onValueChange={(v) => setBt({ meals: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
            </View>
            {bt.meals && (
              <View style={{ marginBottom: 16 }}>
                <Input value={bt.mealsDetails} onChangeText={(v: string) => setBt({ mealsDetails: v })} placeholder="e.g. meal voucher per performer" />
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: bt.drinks ? 8 : 4 }}>
              <Text style={{ fontSize: 14, color: colors.black }}>Drinks</Text>
              <Switch value={bt.drinks || false} onValueChange={(v) => setBt({ drinks: v })} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
            </View>
            {bt.drinks && (
              <View style={{ marginBottom: 8 }}>
                <Input value={bt.drinksDetails} onChangeText={(v: string) => setBt({ drinksDetails: v })} placeholder="e.g. 2 drinks each" />
              </View>
            )}
            <Text style={{ fontSize: 12, color: colors.grey, lineHeight: 17, marginTop: 8, marginBottom: 8 }}>
              Backline is set per room. Green room and merch space are in Access and facilities.
            </Text>
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderInvoicing() {
    const abnDigits = data.payment.abn.replace(/\s/g, '');
    const abnFilled = abnDigits.length > 0;
    const abnValid  = abnFilled && isValidABN(abnDigits);
    const abnError  = (venueAbnTouched || showErrors) && abnFilled && !abnValid;
    const invoiceMode = data.invoicingMode || 'actsInvoice';

    return (
      <View style={s.section}>
        {renderPageHeader('Invoicing')}

        <SectionCard title="Business details">
          <FieldRow label="Legal entity name" sublabel="The name on invoices and contracts.">
            <Input
              value={data.legalEntityName || ''}
              onChangeText={(v: string) => set('legalEntityName', v)}
              placeholder="e.g. The Crown Hotel Pty Ltd"
            />
          </FieldRow>
          <FieldRow label="ABN" sublabel="Required for invoicing and contracts. Register free at abr.business.gov.au." error={abnError}>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Input
                    value={data.payment.abn}
                    onChangeText={(v: string) => {
                      const cleaned = v.replace(/[^\d\s]/g, '');
                      setPayment('abn', cleaned);
                      if (!cleaned.replace(/\s/g, '')) { setPayment('gstRegistered', false); setAbnLookupResult(null); }
                    }}
                    onBlur={() => {
                      setVenueAbnTouched(true);
                      if (data.payment.abn.trim()) setPayment('abn', formatABN(data.payment.abn));
                    }}
                    placeholder="e.g. 12 345 678 901"
                    keyboardType="numeric"
                    error={abnError}
                  />
                </View>
                {abnValid && (
                  <TouchableOpacity
                    style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: abnLookupResult ? '#2F7A4B' : Colors.orange, backgroundColor: abnLookupResult ? '#2F7A4B11' : Colors.orange + '18' }}
                    disabled={abnLookupLoading}
                    onPress={async () => {
                      setAbnLookupLoading(true);
                      try {
                        const result = await lookupABN(data.payment.abn);
                        if (!result) {
                          Alert.alert('ABN Lookup not configured', 'Add your ABR GUID to the .env file as EXPO_PUBLIC_ABR_GUID. Register free at abr.business.gov.au/Tools/ABRXMLSearch');
                          return;
                        }
                        if ('error' in result) { Alert.alert('Lookup failed', result.error); return; }
                        setAbnLookupResult(result);
                        if (!data.legalEntityName && result.entityName) set('legalEntityName', result.entityName);
                        if (result.gstRegistered !== data.payment.gstRegistered) setPayment('gstRegistered', result.gstRegistered);
                      } finally {
                        setAbnLookupLoading(false);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: abnLookupResult ? '#2F7A4B' : Colors.orange }}>
                      {abnLookupLoading ? 'Looking up...' : abnLookupResult ? 'Verified' : 'Verify'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {abnError && <Text style={{ fontSize: 12, color: Colors.danger }}>Invalid ABN. Check the 11-digit number and try again.</Text>}
              {abnLookupResult && !('error' in abnLookupResult) && (
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#2F7A4B11', borderWidth: 1, borderColor: '#2F7A4B44', gap: 3 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#2F7A4B' }}>{abnLookupResult.entityName}</Text>
                  <Text style={{ fontSize: 12, color: '#2F7A4B' }}>
                    {abnLookupResult.entityType}{abnLookupResult.gstRegistered ? '  ·  Registered for GST' : '  ·  Not registered for GST'}
                  </Text>
                </View>
              )}
            </View>
          </FieldRow>
          <FieldRow label="Registered for GST" last>
            <View style={{ opacity: abnValid ? 1 : 0.4 }}>
              <Switch value={data.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} disabled={!abnValid} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="How invoicing works">
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            <Field label="INVOICING MODEL">
              <Pills
                options={['Acts invoice you', 'You issue RCTIs', 'Not required']}
                value={invoiceMode === 'actsInvoice' ? 'Acts invoice you' : invoiceMode === 'rcti' ? 'You issue RCTIs' : 'Not required'}
                onSelect={(v: string) => set('invoicingMode', v === 'Acts invoice you' ? 'actsInvoice' : v === 'You issue RCTIs' ? 'rcti' : 'none')}
              />
            </Field>
            {invoiceMode !== 'none' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Acts must have an ABN</Text>
                <Switch value={data.payment.requiresArtistAbn} onValueChange={(v: boolean) => setPayment('requiresArtistAbn', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
            )}
            {invoiceMode === 'rcti' && (
              <View style={{ backgroundColor: Colors.orange + '11', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: Colors.orange, lineHeight: 19 }}>RCTIs require a written agreement with each act before the first payment. Keep records.</Text>
              </View>
            )}
            {invoiceMode !== 'none' && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  {invoiceMode === 'rcti' ? 'RCTI TEMPLATE' : 'INVOICE TEMPLATE'}
                </Text>
                <Text style={{ fontSize: 13, color: colors.grey, marginBottom: 8, lineHeight: 19 }}>
                  Optional. Upload a preferred format for acts to use.
                </Text>
                {(data.payment.invoiceDocs || []).map((doc, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, color: colors.black }} numberOfLines={1}>↓ {doc.name}</Text>
                    <TouchableOpacity onPress={() => setPayment('invoiceDocs', data.payment.invoiceDocs.filter((_, i) => i !== idx))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 14, color: Colors.danger, fontWeight: '700' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={s.addBtn} onPress={pickInvoiceDocument} disabled={invoiceDocUploading}>
                  <Text style={s.addBtnText}>{invoiceDocUploading ? 'Uploading...' : '+ Upload template'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </SectionCard>

        <SectionCard title="Accounts contact">
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}>
            <Text style={{ fontSize: 13, color: colors.grey, lineHeight: 19, marginBottom: 12 }}>Shared with acts once a booking is confirmed. Not shown publicly.</Text>
          </View>
          <FieldRow label="Name">
            <Input value={data.accountsContactName || ''} onChangeText={(v: string) => set('accountsContactName', v)} placeholder={data.bookingContactName || 'e.g. Alex Johnson'} />
          </FieldRow>
          <FieldRow label="Email" last>
            <View style={{ gap: 6 }}>
              <Input value={data.accountsContactEmail || ''} onChangeText={(v: string) => set('accountsContactEmail', v)} placeholder={data.email || 'accounts@yourvenue.com.au'} keyboardType="email-address" />
              {!data.accountsContactEmail && (data.bookingContactName || data.email) && (
                <TouchableOpacity
                  onPress={() => { if (data.accountsContactName === '' && data.bookingContactName) set('accountsContactName', data.bookingContactName); if (data.email) set('accountsContactEmail', data.email); }}
                  activeOpacity={0.7}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Same as booking contact</Text>
                </TouchableOpacity>
              )}
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Notes for acts">
          <View style={{ padding: 16 }}>
            <Input value={data.invoicingNotes || ''} onChangeText={(v: string) => set('invoicingNotes', v)} placeholder="Anything else acts should know about invoicing at your venue" multiline />
          </View>
        </SectionCard>

        {renderContractDetails()}
      </View>
    );
  }

  function renderVerification() {
    const isVerified = !!data.techSpecs?.verifiedAt;
    const verifiedDate = data.techSpecs?.verifiedAt
      ? new Date(data.techSpecs.verifiedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

    async function handleVerify() {
      if (!verifyCode.trim()) return;
      setVerifying(true);
      setVerifyError('');
      try {
        const appSnap = await getDoc(doc(db, 'venueApplications', profile?.uid || ''));
        const storedCode = appSnap.data()?.verificationCode;
        if (!storedCode || storedCode !== verifyCode.trim()) {
          setVerifyError('Incorrect code. Check your email and try again.');
          return;
        }
        const now = Date.now();
        await updateDoc(doc(db, 'venues', venueId), {
          'techSpecs.verifiedAt': now,
          'techSpecs.verified': true,
        });
        set('techSpecs', { ...data.techSpecs, verifiedAt: now, verified: true });
      } catch (e: any) {
        setVerifyError(e.message || 'Verification failed. Please try again.');
      } finally {
        setVerifying(false);
      }
    }

    return (
      <View style={s.section}>
        {renderPageHeader('Verification')}

        {isVerified ? (
          <View style={{ backgroundColor: '#f0faf4', borderWidth: 1, borderColor: '#2F7A4B44', borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#2F7A4B', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>✓</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#2F7A4B' }}>Venue verified</Text>
            </View>
            {verifiedDate && <Text style={{ fontSize: 13, color: '#2F7A4B', marginBottom: 10 }}>Verified {verifiedDate}</Text>}
            <Text style={{ fontSize: 13, color: '#2F7A4B', lineHeight: 19 }}>
              Changing your venue name, address, or ABN triggers a quick re-check. Your listing stays live during review.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 0 }}>
            {/* Timeline */}
            {[
              { label: 'Details submitted', desc: 'Your venue details have been received.', done: true },
              { label: 'Twaylo review', desc: 'We check your ABN and address match a real venue. Usually within 2 business days.', done: false, active: true },
              { label: 'Enter your code', desc: 'Once approved, you will receive a verification code by email.', done: false },
            ].map((step, idx) => (
              <View key={idx} style={{ flexDirection: 'row', gap: 14, marginBottom: 20 }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: step.done ? '#2F7A4B' : step.active ? Colors.orange : colors.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                      {step.done ? '✓' : String(idx + 1)}
                    </Text>
                  </View>
                  {idx < 2 && <View style={{ width: 1, flex: 1, backgroundColor: colors.border, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, paddingTop: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: step.active ? Colors.orange : colors.black, marginBottom: 3 }}>{step.label}</Text>
                  <Text style={{ fontSize: 13, color: colors.grey, lineHeight: 19 }}>{step.desc}</Text>
                </View>
              </View>
            ))}

            {/* Code entry */}
            <View style={{ backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, marginTop: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.black, marginBottom: 6 }}>Enter your verification code</Text>
              <Text style={{ fontSize: 13, color: colors.grey, lineHeight: 19, marginBottom: 14 }}>
                Check your email for the code from Twaylo. It expires after 48 hours.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[s.input, { backgroundColor: colors.bg, borderColor: verifyError ? Colors.danger : colors.border, color: colors.black, letterSpacing: 4, fontSize: 18, fontWeight: '700', textAlign: 'center' }]}
                    value={verifyCode}
                    onChangeText={(v) => { setVerifyCode(v.toUpperCase()); setVerifyError(''); }}
                    placeholder="A1B2C3"
                    placeholderTextColor={Colors.greyLight}
                    autoCapitalize="characters"
                    maxLength={8}
                    returnKeyType="done"
                    onSubmitEditing={handleVerify}
                  />
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' }}
                  onPress={handleVerify}
                  disabled={verifying || !verifyCode.trim()}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{verifying ? '...' : 'Verify'}</Text>
                </TouchableOpacity>
              </View>
              {verifyError ? <Text style={{ fontSize: 13, color: Colors.danger, marginTop: 8 }}>{verifyError}</Text> : null}
            </View>
          </View>
        )}
      </View>
    );
  }

  // Legacy fallback — renderPayments redirects to renderBookingTerms
  function renderPayments() { return renderBookingTerms(); }
  function renderContractDetails() {
    const acnDigits = legalIdentity.acn.replace(/\s/g, '');
    const acnFilled = acnDigits.length > 0;
    const acnValid  = acnFilled && isValidACN(acnDigits);
    const acnError  = (venueAcnTouched || showErrors) && acnFilled && !acnValid;
    const needsAcn  = legalIdentity.entityType === 'Company';
    const complete  = isLegalIdentityComplete(legalIdentity);
    return (
      <SectionCard
        title="Contract details"
        subtitle="Used on gig contracts. Not shown publicly."
        right={
          complete ? (
            <View style={{ backgroundColor: '#e8f5e9', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#2e7d32' }}>Complete</Text>
            </View>
          ) : null
        }
      >
        <FieldRow label="Entity type">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {ENTITY_TYPES.map(opt => {
              const active = legalIdentity.entityType === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setLegal('entityType', opt)}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: active ? colors.black : colors.border, backgroundColor: active ? colors.black : 'transparent' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '500', color: active ? '#fff' : colors.black }}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </FieldRow>
        <FieldRow label="Legal name" sublabel="The name on contracts and invoices.">
          <Input value={legalIdentity.legalName} onChangeText={(v: string) => setLegal('legalName', v)} placeholder="e.g. The Crown Hotel Pty Ltd" />
        </FieldRow>
        {needsAcn && (
          <FieldRow label="ACN" error={acnError}>
            <View>
              <Input
                value={legalIdentity.acn}
                onChangeText={(v: string) => setLegal('acn', v.replace(/[^\d\s]/g, ''))}
                onBlur={() => { setVenueAcnTouched(true); if (legalIdentity.acn.trim()) setLegal('acn', formatACN(legalIdentity.acn)); }}
                placeholder="123 456 789"
                keyboardType="numeric"
                error={acnError}
              />
              {acnError && <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 4 }}>Invalid ACN. Check the 9-digit number and try again.</Text>}
            </View>
          </FieldRow>
        )}
        <FieldRow label="Signatory name" sublabel="Who signs contracts on behalf of the venue.">
          <Input value={legalIdentity.signatoryName} onChangeText={(v: string) => setLegal('signatoryName', v)} placeholder="e.g. Alex Johnson" />
        </FieldRow>
        <FieldRow label="Signatory role" sublabel="Their title or position.">
          <Input value={legalIdentity.signatoryRole} onChangeText={(v: string) => setLegal('signatoryRole', v)} placeholder="e.g. Director or General Manager" />
        </FieldRow>
        <FieldRow label="Registered address">
          <Input value={legalIdentity.addressLine} onChangeText={(v: string) => setLegal('addressLine', v)} placeholder="Street address" />
        </FieldRow>
        <FieldRow label="Suburb">
          <Input value={legalIdentity.suburb} onChangeText={(v: string) => setLegal('suburb', v)} placeholder="e.g. Collingwood" />
        </FieldRow>
        <FieldRow label="State">
          <Pills options={AU_STATES} value={legalIdentity.state} onSelect={(v: string) => setLegal('state', v)} />
        </FieldRow>
        <FieldRow label="Postcode" last>
          <Input value={legalIdentity.postcode} onChangeText={(v: string) => setLegal('postcode', v.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 3066" keyboardType="numeric" />
        </FieldRow>
      </SectionCard>
    );
  }

  function renderPhotosVideos() {
    const detectSource = (url: string) => {
      if (!url) return null;
      if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
      if (url.includes('vimeo.com')) return 'Vimeo';
      if (url.includes('firebasestorage') || url.endsWith('.mp4')) return 'Uploaded';
      return 'Link';
    };
    const videoObjects: Video[] = data.videoObjects?.length
      ? data.videoObjects
      : (data.videos || []).map(url => ({ url, title: '' }));

    return (
      <View style={s.section}>
        {renderPageHeader('Photos & video')}

        {/* Logo */}
        <SectionCard title="Logo" subtitle="Square, at least 400 × 400px.">
          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {data.logoUrl
              ? <Image source={{ uri: data.logoUrl }} style={{ width: 64, height: 64, borderRadius: 10 }} resizeMode="cover" />
              : <View style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, color: colors.grey }}>No logo</Text>
                </View>
            }
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={pickBannerPhoto} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.black }}>{data.logoUrl ? 'Replace' : 'Upload'}</Text>
              </TouchableOpacity>
              {data.logoUrl ? (
                <TouchableOpacity onPress={() => set('logoUrl', '')} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ fontSize: 13, color: colors.grey }}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </SectionCard>

        {/* Cover photo */}
        <SectionCard title="Cover photo" subtitle="3:1 banner shown at the top of your venue profile.">
          <View style={{ padding: 16 }}>
            {data.photoUrl ? (
              <RepositionablePhoto
                uri={data.photoUrl}
                position={data.photoPosition || { x: 50, y: 50 }}
                onPositionChange={(pos) => set('photoPosition', pos)}
                onChangePhoto={pickBannerPhoto}
                height={160}
              />
            ) : (
              <View style={{ height: 120, borderRadius: 10, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Text style={{ color: colors.grey, fontSize: 13 }}>No cover photo</Text>
              </View>
            )}
            <TouchableOpacity style={s.addBtn} onPress={pickBannerPhoto} disabled={photoUploading}>
              <Text style={s.addBtnText}>{photoUploading ? 'Uploading...' : data.photoUrl ? 'Replace cover photo' : '+ Upload cover photo'}</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        {/* Gallery */}
        <SectionCard title="Gallery" subtitle={`Up to 12 photos. ${data.photos.length}/12 — Include stage from audience, stage from band view, and green room.`}>
          <View style={{ padding: 16 }}>
            <View style={s.photoGrid}>
              {data.photos.filter(u => u !== data.photoUrl).map((url, i) => (
                <View key={i} style={s.photoItem}>
                  <Image source={{ uri: url }} style={s.photoImg} />
                  <TouchableOpacity style={s.photoRemove} onPress={() => set('photos', data.photos.filter(p => p !== url))}>
                    <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            {data.photos.length < 12 && (
              <TouchableOpacity style={s.addBtn} onPress={addGalleryPhoto}>
                <Text style={s.addBtnText}>+ Add photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </SectionCard>

        {/* Video */}
        <SectionCard title="Video" subtitle="MP4 up to 200 MB. Links load faster.">
          <View style={{ padding: 16 }}>
            {videoObjects.map((vid, i) => {
              const source = detectSource(vid.url);
              return (
                <View key={i} style={{ backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 10, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {source && (
                      <View style={{ backgroundColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.grey }}>{source}</Text>
                      </View>
                    )}
                    <Text style={{ flex: 1, fontSize: 12, color: colors.grey }} numberOfLines={1}>{vid.url}</Text>
                    <TouchableOpacity onPress={() => {
                      const next = videoObjects.filter((_, idx) => idx !== i);
                      set('videoObjects', next);
                      set('videos', next.map(v => v.url));
                    }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 14, color: Colors.danger, fontWeight: '700' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={[s.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.black }]}
                    placeholder="Title (optional)"
                    placeholderTextColor={Colors.greyLight}
                    value={vid.title}
                    onChangeText={(t) => {
                      const next = videoObjects.map((v, idx) => idx === i ? { ...v, title: t } : v);
                      set('videoObjects', next);
                    }}
                    autoCapitalize="words"
                  />
                </View>
              );
            })}
            <TouchableOpacity style={[s.addBtn, { marginBottom: 8 }]} onPress={pickVideoFile} disabled={videoUploading}>
              <Text style={s.addBtnText}>{videoUploading ? 'Uploading...' : '+ Upload file'}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[s.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
                placeholder="Paste YouTube or Vimeo URL"
                placeholderTextColor={Colors.greyLight}
                value={newVideoUrl}
                onChangeText={setNewVideoUrl}
                autoCapitalize="none"
                onSubmitEditing={() => {
                  const url = newVideoUrl.trim();
                  if (!url) return;
                  const next = [...videoObjects, { url, title: '' }];
                  set('videoObjects', next);
                  set('videos', next.map(v => v.url));
                  setNewVideoUrl('');
                }}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={{ backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}
                onPress={() => {
                  const url = newVideoUrl.trim();
                  if (!url) return;
                  const next = [...videoObjects, { url, title: '' }];
                  set('videoObjects', next);
                  set('videos', next.map(v => v.url));
                  setNewVideoUrl('');
                }}
              >
                <Text style={{ fontSize: 14, color: colors.black, fontWeight: '600' }}>Add link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderActiveTab() {
    switch (activeTab) {
      case 'Basic info':          return renderBasicInfo();
      case 'Photos & video':      return renderPhotosVideos();
      case 'Rooms':               return renderRooms();
      case 'Access & facilities': return renderAccessFacilities();
      case 'Gig slots':           return renderGigSlots();
      case 'Booking terms':       return renderBookingTerms();
      case 'Invoicing':           return renderInvoicing();
      case 'Verification':        return renderVerification();
      case 'Settings':            return renderSettings();
      // legacy fallbacks
      case 'Basic Info':          return renderBasicInfo();
      case 'Timetable':           return renderGigSlots();
      case 'Tech Specs':          return renderAccessFacilities();
      case 'Payments':            return renderBookingTerms();
      case 'Photos & Videos':     return renderPhotosVideos();
      default:                    return null;
    }
  }

  // ────────────────────────────────────────────────────────────────

  const hasUnsaved = JSON.stringify(data) !== JSON.stringify(saved) ||
    JSON.stringify(legalIdentity) !== JSON.stringify(savedLegal);

  function handleDiscard() {
    setData(saved);
    setLegalIdentityState(savedLegal);
  }

  function renderUnsavedBar() {
    if (!hasUnsaved && saveState === 'idle') return null;
    return (
      <View style={[evd.unsavedBar, { backgroundColor: '#16161A', borderTopColor: '#2a2a2a' }]}>
        <Text style={evd.unsavedText}>{saveState === 'saved' ? 'All changes saved' : 'Unsaved changes'}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {saveState !== 'saved' && (
            <TouchableOpacity onPress={handleDiscard}>
              <Text style={evd.discardText}>Discard</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{ backgroundColor: saveState === 'saved' ? '#2F7A4B' : Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}
            onPress={() => { if (saveState === 'idle') handleSave(); }}
            activeOpacity={saveState === 'idle' ? 0.8 : 1}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>{saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
    const venueInitial = (data.name || 'V')[0].toUpperCase();
    return (
      <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
        {/* Top bar */}
        <View style={[evd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={handleBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
              <Text style={{ fontSize: 14, color: colors.grey }}>Venue</Text>
            </TouchableOpacity>
            <View style={evd.logoSquare}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>T</Text>
            </View>
            <Text style={[evd.logoText, { color: colors.black }]}>Twaylo</Text>
            <Text style={{ color: colors.grey, fontSize: 14 }}>/</Text>
            <Text style={{ color: colors.grey, fontSize: 14 }}>Settings</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {saveState === 'saved' && <Text style={{ fontSize: 13, color: '#2F7A4B' }}>Saved just now</Text>}
            <TouchableOpacity style={[evd.outlineBtn, { borderColor: colors.border }]} onPress={() => router.push(`/venue/${venueId}?preview=true` as any)}>
              <Text style={[evd.outlineBtnText, { color: colors.black }]}>View public profile</Text>
            </TouchableOpacity>
            <View style={[evd.avatarCircle, { backgroundColor: colors.border }]}>
              {data.photoUrl
                ? <Image source={{ uri: data.photoUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} resizeMode="cover" />
                : <Text style={{ fontSize: 12, fontWeight: '700', color: colors.grey }}>{venueInitial}</Text>
              }
            </View>
          </View>
        </View>

        <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>
          {/* Sidebar */}
          <View style={[evd.sidebarNew, { backgroundColor: colors.bg, borderRightColor: colors.border }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* Venue header */}
              <View style={evd.sidebarUser}>
                {data.photoUrl
                  ? <Image source={{ uri: data.photoUrl }} style={evd.sidebarPhoto} resizeMode="cover" />
                  : <View style={[evd.sidebarPhoto, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 10, color: colors.grey }}>{venueInitial}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={[evd.sidebarName, { color: colors.black }]} numberOfLines={1}>{data.name || 'Your venue'}</Text>
                  <Text style={[evd.sidebarHandle, { color: colors.grey }]} numberOfLines={1}>Venue{data.location ? ` · ${data.location}` : ''}</Text>
                </View>
              </View>

              {/* Nav groups */}
              {VENUE_NAV_GROUPS.map(group => (
                <View key={group.label} style={{ marginBottom: 4 }}>
                  <Text style={[evd.navGroupLabel, { color: colors.grey }]}>{group.label}</Text>
                  {group.tabs.filter(t => activeTabs.includes(t)).map(tab => {
                    const active = activeTab === tab;
                    return (
                      <TouchableOpacity
                        key={tab}
                        style={[evd.navItemNew, active && { backgroundColor: '#EFEEEB' }]}
                        onPress={() => setActiveTab(tab)}
                        activeOpacity={0.7}
                      >
                        <Text style={[evd.navTextNew, { color: colors.black, fontWeight: active ? '700' : '500' }]}>{tab}</Text>
                        {onboardingStep > 0 && onboardingVisited.includes(tab)
                          ? <Text style={evd.navCheck}>✓</Text>
                          : tabErrors.includes(tab) && <View style={evd.navErrorDot} />
                        }
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              <View style={[evd.navDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity style={evd.navItemNew} onPress={() => crossConfirm('Log out', 'Are you sure you want to log out?', async () => { await signOut(auth); router.replace('/'); })}>
                <Text style={[evd.navTextNew, { color: colors.grey, fontWeight: '400' }]}>Log out</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Main content */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={evd.contentPad}>
            {tabErrors.length > 0 && (
              <View style={[s.tabErrors, { marginBottom: 24, borderRadius: 8 }]}>
                <Text style={s.tabErrorsLabel}>Please complete: </Text>
                {tabErrors.map(t => <Text key={t} style={s.tabErrorPill}>{t}</Text>)}
              </View>
            )}
            {renderActiveTab()}
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

        {renderUnsavedBar()}

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

  // Mobile list view
  if (mobileShowList) {
    return (
      <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
        <View style={[evd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={handleBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
              <Text style={{ fontSize: 14, color: colors.grey }}>Venue</Text>
            </TouchableOpacity>
            <View style={evd.logoSquare}><Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>T</Text></View>
            <Text style={[evd.logoText, { color: colors.black }]}>Twaylo</Text>
            <Text style={{ color: colors.grey }}>/</Text>
            <Text style={{ color: colors.grey }}>Settings</Text>
          </View>
          <View style={[evd.avatarCircle, { backgroundColor: colors.border }]}>
            {data.photoUrl ? <Image source={{ uri: data.photoUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} resizeMode="cover" /> : null}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={evd.sidebarUser}>
            {data.photoUrl
              ? <Image source={{ uri: data.photoUrl }} style={evd.sidebarPhoto} resizeMode="cover" />
              : <View style={[evd.sidebarPhoto, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]} />
            }
            <View>
              <Text style={[evd.sidebarName, { color: colors.black }]}>{data.name || 'Your venue'}</Text>
              <Text style={[evd.sidebarHandle, { color: colors.grey }]}>Venue{data.location ? ` · ${data.location}` : ''}</Text>
            </View>
          </View>

          {VENUE_NAV_GROUPS.map(group => (
            <View key={group.label}>
              <Text style={[evd.navGroupLabel, { color: colors.grey, paddingHorizontal: 20 }]}>{group.label}</Text>
              {group.tabs.filter(t => activeTabs.includes(t)).map(tab => (
                <TouchableOpacity key={tab} style={[evd.mobileListItem, { backgroundColor: colors.bg, borderBottomColor: colors.border }]} onPress={() => { setActiveTab(tab); setMobileShowList(false); }} activeOpacity={0.7}>
                  <Text style={[evd.navTextNew, { color: colors.black }]}>{tab}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {tabErrors.includes(tab) && <View style={evd.navErrorDot} />}
                    <Text style={{ color: colors.grey, fontSize: 18 }}>›</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <View style={{ height: 12 }} />
            </View>
          ))}

          <View style={[{ height: 1, backgroundColor: colors.border, marginHorizontal: 20, marginBottom: 12 }]} />
          <TouchableOpacity style={[evd.mobileListItem, { backgroundColor: colors.bg, borderBottomColor: colors.border }]} onPress={() => crossConfirm('Log out', 'Are you sure?', async () => { await signOut(auth); router.replace('/'); })}>
            <Text style={[evd.navTextNew, { color: colors.grey, fontWeight: '400' }]}>Log out</Text>
          </TouchableOpacity>
        </ScrollView>
        {renderUnsavedBar()}
      </SafeAreaView>
    );
  }

  // Mobile section view
  return (
    <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
      <View style={[evd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => setMobileShowList(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
          <Text style={{ fontSize: 14, color: colors.grey }}>All settings</Text>
        </TouchableOpacity>
        {saveState === 'saved' && <Text style={{ fontSize: 13, color: '#2F7A4B' }}>Saved</Text>}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {tabErrors.length > 0 && (
          <View style={[s.tabErrors, { marginBottom: 20, borderRadius: 8 }]}>
            <Text style={s.tabErrorsLabel}>Please complete: </Text>
            {tabErrors.map(t => <Text key={t} style={s.tabErrorPill}>{t}</Text>)}
          </View>
        )}
        {renderActiveTab()}
      </ScrollView>
      {renderUnsavedBar()}

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
  pill:          { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText:      { fontSize: 13 },
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
  // Legacy (kept for onboarding panel references)
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
  navCheck:      { fontSize: 13, color: Colors.orange, fontWeight: '700' },

  // New musician-style layout
  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  logoSquare:     { width: 28, height: 28, borderRadius: 6, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  logoText:       { fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
  avatarCircle:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  outlineBtn:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  outlineBtnText: { fontSize: 13, fontWeight: '600' },

  sidebarNew:     { width: 192, borderRightWidth: 1, paddingTop: 20 },
  sidebarUser:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 20 },
  sidebarPhoto:   { width: 36, height: 36, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  sidebarName:    { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, lineHeight: 19 },
  sidebarHandle:  { fontSize: 12, lineHeight: 17 },

  navGroupLabel:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 16, marginTop: 16, marginBottom: 4 },
  navItemNew:     { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginHorizontal: 8, marginBottom: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navTextNew:     { fontSize: 14 },
  navDivider:     { height: 1, marginHorizontal: 16, marginVertical: 12 },
  contentPad:     { padding: 32, paddingBottom: 100 },

  unsavedBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1 },
  unsavedText:        { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  discardText:        { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
  saveChangesBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveChangesBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  mobileListItem:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
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
  replayBtn:            { position: 'absolute', bottom: 80, right: 24, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, zIndex: 50 },
  replayBtnText:        { fontSize: 13, fontWeight: '600', color: '#ffffff' },
});
