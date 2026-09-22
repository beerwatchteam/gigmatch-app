import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform, Modal, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { searchSuburbs, AreaResult } from '@/lib/suburbSearch';
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

const GENRES    = ['Rock','Jazz','Blues','Pop','Indie','Electronic / DJ','Hip-Hop','Country','Acoustic / Folk','Cover Bands','Original','Classical','Metal','Other'];
const ACT_TYPES   = ['Solo Artist','Duo','Trio','Band','Cover Band','Acoustic Act','DJ','Choir / Vocal Group','Other'];
const INSTRUMENTS = ['Vocals','Guitar (Acoustic)','Guitar (Electric)','Bass','Drums','Keys / Piano','Violin / Strings','Saxophone','Trumpet / Brass','Trombone','Harmonica','Banjo / Mandolin','Ukulele','Cello','Flute','Synth / Sampler','Turntables / CDJs','Percussion','Other'];
const PLATFORMS = [
  { key: 'instagram',  label: 'Instagram',   placeholder: 'Profile URL or a post/reel URL to embed' },
  { key: 'tiktok',     label: 'TikTok',      placeholder: 'TikTok profile URL' },
  { key: 'spotify',    label: 'Spotify',     placeholder: 'Artist, track, album or playlist URL' },
  { key: 'appleMusic', label: 'Apple Music', placeholder: 'Apple Music URL' },
];
const ARTIST_PAY_METHODS = ['Cash', 'Bank transfer', 'PayPal', 'Stripe', 'Other'];
const ARTIST_PAY_TIMING  = ['On the night', 'Within 7 days', 'Within 14 days', 'Within 30 days', 'Other'];

type ArtistPayment = {
  methods: string[];
  typicalFee: string;
  minimumFee: string;
  abn: string;
  gstRegistered: boolean;
  canProvideInvoice: boolean;
  invoicingName: string;
  bankTransferNote: string;
  timing: string;
  timingOther: string;
  publicLiabilityHeld: boolean;
  publicLiabilityCoverage: string;
  insuranceCertAvailable: boolean;
  paymentNotes: string;
};

const BLANK_ARTIST_PAYMENT: ArtistPayment = {
  methods: [], typicalFee: '', minimumFee: '',
  abn: '', gstRegistered: false, canProvideInvoice: false, invoicingName: '',
  bankTransferNote: '', timing: '', timingOther: '',
  publicLiabilityHeld: false, publicLiabilityCoverage: '', insuranceCertAvailable: false,
  paymentNotes: '',
};

const TABS = ['Settings','Basic Info','About','Music','Tech Rider','Payment','Photos'];

const STEP_TAB: Record<number, string | null> = {
  1: null, 2: 'Basic Info', 3: 'About', 4: 'Music',
  5: 'Tech Rider', 6: 'Payment', 7: 'Photos', 8: null, 9: null, 10: 'Photos',
};

type OnboardingStepData = {
  title: string;
  body: string;
  body2?: string;
  fieldsLabel?: string;
  fields?: string[];
  nextLabel: string;
};

const ONBOARDING_DATA: Record<number, OnboardingStepData> = {
  1: {
    title: 'Welcome',
    body: "Your account is set up. Now let's build your profile so venues can find you, listen to you, and book you.",
    nextLabel: 'Get started',
  },
  2: {
    title: 'Basic Info',
    body: 'This is what venues see first. Fill it in properly. A half-finished profile gets ignored.',
    fieldsLabel: 'FIELDS TO COMPLETE',
    fields: ['Stage name', 'Username', 'Act type (solo, duo, band, DJ, etc.)', 'Genres', 'Instruments / What you play', 'Location', 'Contact details', 'Fee range', 'Average draw', 'Social links'],
    nextLabel: 'Next: About',
  },
  3: {
    title: 'About',
    body: "Write a short bio. Keep it tight. Venues are busy. Tell them who you are, what you sound like, and why they should book you.",
    body2: 'Two or three sentences is enough. You can always expand it later.',
    nextLabel: 'Next: Music',
  },
  4: {
    title: 'Music',
    body: 'Adds links to your music. This is the most important part of your profile. Venues will listen before they respond.',
    body2: 'Spotify, YouTube, SoundCloud, Bandcamp: anything that lets them hear you immediately. No links means no bookings.',
    nextLabel: 'Next: Tech Rider',
  },
  5: {
    title: 'Tech Rider',
    body: 'Upload your rider PDF if you have one. It can cover most of the fields. Then fill in the stage setup, hospitality, and logistics details so venues know exactly what to expect.',
    fieldsLabel: 'SECTIONS TO COMPLETE',
    fields: ['Rider PDF (upload)', 'Stage plot (upload)', 'Input list and monitoring', 'Backline needed / brought', 'Hospitality (meals, drinks, green room)', 'Technical (set length, soundcheck, PA)', 'Logistics (load-in, merch, accommodation)'],
    nextLabel: 'Next: Payment',
  },
  6: {
    title: 'Payment',
    body: 'Let venues know how you prefer to be paid and what to expect upfront. Clear payment terms save back-and-forth later.',
    fieldsLabel: 'COVERS',
    fields: ['Preferred payment methods', 'Typical fee and minimum floor', 'ABN and invoicing details', 'Payment timing expectation', 'Public liability insurance'],
    nextLabel: 'Next: Photos',
  },
  7: {
    title: 'Photos',
    body: 'Upload photos of your act. Venues use these for promotional material when they confirm a booking, so give them something worth using.',
    body2: "Live shots perform better than studio portraits. Show them what the room will look like when you're on stage.",
    nextLabel: 'Next: My Gigs',
  },
  8: {
    title: 'My Gigs',
    body: "My Gigs is your private gig ledger. Add upcoming shows, past performances, and away periods: they feed into your public profile automatically.",
    body2: "Upcoming gigs appear on your public Timetable. Past gigs show in the Past Gigs section of your Overview. Away periods also show on your Timetable so venues know when you're unavailable. Confirmed bookings from enquiries appear here too.",
    nextLabel: 'Next: Dashboard',
  },
  9: {
    title: 'Dashboard',
    body: "Your financial snapshot. Track confirmed and pending earnings across any time period: this month, this quarter, this financial year, or a custom range.",
    body2: "Export a PDF or CSV for your accountant or tax records. Only you can see this. It never appears on your public profile.",
    nextLabel: 'Next: Go live',
  },
  10: {
    title: 'Go Live',
    body: "Your profile is ready. Hit save and you'll appear in the musicians directory.",
    body2: "Venues browse here when they have open slots to fill. Keep your profile current and your music links working.",
    nextLabel: 'Publish my profile',
  },
};

type Song    = { title: string; url: string; notes: string };
type Profile = {
  name: string; username: string; artistType: string; otherArtistType: string;
  genre: string[]; otherGenres: string; instruments: string[]; location: string;
  email: string; phone: string; feeMin: string; feeMax: string; averageDraw: string;
  about: string; photoUrl: string; photoPosition: { x: number; y: number };
  instagram: string; tiktok: string; spotify: string; appleMusic: string;
  customLinks: { label: string; url: string }[];
  songs: Song[];
  techRider: Record<string, string>;
  techRiderDocs: { url: string; name: string }[];
  techRiderBools: Record<string, boolean>;
  photos: string[]; videos: string[];
  payment: ArtistPayment;
  settings: { emailOnEnquiryResponse: boolean; emailOnNewConnection: boolean; listed: boolean };
};

const BLANK: Profile = {
  name: '', username: '', artistType: '', otherArtistType: '', genre: [], otherGenres: '', instruments: [], location: '', email: '', phone: '',
  feeMin: '', feeMax: '', averageDraw: '', about: '', photoUrl: '', photoPosition: { x: 50, y: 50 },
  instagram: '', tiktok: '', spotify: '', appleMusic: '',
  customLinks: [], songs: [],
  techRider: {}, techRiderDocs: [], techRiderBools: {}, photos: [], videos: [],
  payment: { ...BLANK_ARTIST_PAYMENT },
  settings: { emailOnEnquiryResponse: true, emailOnNewConnection: false, listed: true },
};

function Field({ label, error, children }: { label: string; error?: boolean; children: React.ReactNode }) {
  return (
    <View style={f.wrap}>
      <Text style={[f.label, error && { color: Colors.danger }]}>{label}</Text>
      {children}
    </View>
  );
}
const f = StyleSheet.create({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
});

function Input({ value, onChangeText, placeholder, multiline, keyboardType, error, secureTextEntry }: any) {
  const { colors } = useTheme();
  return (
    <TextInput
      style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }, multiline && s.textarea, error && s.inputError]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={Colors.greyLight}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      textAlignVertical={multiline ? 'top' : 'auto'}
    />
  );
}

function Pills({ options, value, onSelect, multi }: { options: string[]; value: string | string[]; onSelect: (v: any) => void; multi?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const active = multi ? (value as string[]).includes(opt) : value === opt;
        return (
          <TouchableOpacity key={opt} style={[s.pill, { borderColor: colors.border }, active && s.pillActive]} onPress={() => {
            if (multi) {
              const arr = value as string[];
              onSelect(active ? arr.filter(x => x !== opt) : [...arr, opt]);
            } else {
              onSelect(opt);
            }
          }}>
            <Text style={[s.pillText, { color: colors.black }, active && s.pillTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SuburbSearch({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const { colors } = useTheme();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AreaResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  function handleChange(text: string) {
    setQuery(text);
    onChange(text);
    if (text.length >= 1) {
      const found = searchSuburbs(text, 7);
      setResults(found);
      setOpen(found.length > 0);
    } else {
      setResults([]);
      setOpen(false);
    }
  }

  function select(r: AreaResult) {
    setQuery(r.label);
    onChange(r.label);
    setResults([]);
    setOpen(false);
  }

  return (
    <View>
      <TextInput
        style={[s.input, { backgroundColor: colors.bgFaint, borderColor: error ? Colors.danger : colors.border, color: colors.black }]}
        value={query}
        onChangeText={handleChange}
        placeholder="Suburb, State, Postcode"
        placeholderTextColor={Colors.greyLight}
        autoCapitalize="words"
      />
      {open && (
        <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 4, overflow: 'hidden', zIndex: 999 }}>
          {results.map((r, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => select(r)}
              style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: i < results.length - 1 ? 1 : 0, borderBottomColor: colors.borderFaint }}
            >
              <Text style={{ fontSize: 14, color: colors.black }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
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

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function DatePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const dayScrollRef   = useRef<ScrollView>(null);
  const monthScrollRef = useRef<ScrollView>(null);
  const yearScrollRef  = useRef<ScrollView>(null);

  const START_YEAR = new Date().getFullYear() - 10;
  const years = Array.from({ length: 2099 - START_YEAR + 1 }, (_, i) => START_YEAR + i);

  const daysInMonth = (m: number, y: number) => new Date(y, m, 0).getDate();

  const parse = (v: string) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const t = new Date();
      return { day: t.getDate(), month: t.getMonth() + 1, year: t.getFullYear() };
    }
    const [y, m, d] = v.split('-').map(Number);
    return { day: d, month: m, year: y };
  };
  const toInternal = (d: number, m: number, y: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const display = (v: string) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || '--/--/----';
    const { day, month, year } = parse(v);
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  };

  const ITEM_H = 20;

  function handleOpen() {
    const today = new Date();
    const initial = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : toInternal(today.getDate(), today.getMonth() + 1, today.getFullYear());
    setDraft(initial);
    setOpen(true);
    const { day, month, year } = parse(initial);
    setTimeout(() => {
      dayScrollRef.current?.scrollTo({ y: (day - 1) * ITEM_H, animated: false });
      monthScrollRef.current?.scrollTo({ y: (month - 1) * ITEM_H, animated: false });
      yearScrollRef.current?.scrollTo({ y: Math.max(0, year - START_YEAR) * ITEM_H, animated: false });
    }, 50);
  }

  const { day, month, year } = parse(draft);
  const days = Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1);

  return (
    <View>
      <TouchableOpacity
        onPress={handleOpen}
        style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 }]}
      >
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight }}>{value ? display(value) : (placeholder || '--/--/----')}</Text>
        <Text style={{ fontSize: 11, color: Colors.grey }}>📅</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 24, width: 320, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.black, marginBottom: 4 }}>Select Date</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 20 }}>{display(draft)}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Day</Text>
                <ScrollView ref={dayScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {days.map(d => (
                    <TouchableOpacity key={d} onPress={() => setDraft(toInternal(d, month, year))} style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: d === day ? Colors.orange : 'transparent', alignItems: 'center' }}>
                      <Text style={{ fontSize: 15, color: d === day ? '#fff' : colors.black, fontWeight: d === day ? '700' : '400' }}>{String(d).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Month</Text>
                <ScrollView ref={monthScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {MONTHS_SHORT.map((name, idx) => {
                    const m = idx + 1;
                    return (
                      <TouchableOpacity key={m} onPress={() => setDraft(toInternal(Math.min(day, daysInMonth(m, year)), m, year))} style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: m === month ? Colors.orange : 'transparent', alignItems: 'center' }}>
                        <Text style={{ fontSize: 15, color: m === month ? '#fff' : colors.black, fontWeight: m === month ? '700' : '400' }}>{name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Year</Text>
                <ScrollView ref={yearScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {years.map(y => (
                    <TouchableOpacity key={y} onPress={() => setDraft(toInternal(Math.min(day, daysInMonth(month, y)), month, y))} style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: y === year ? Colors.orange : 'transparent', alignItems: 'center' }}>
                      <Text style={{ fontSize: 15, color: y === year ? '#fff' : colors.black, fontWeight: y === year ? '700' : '400' }}>{y}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: colors.black, fontWeight: '600', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { onChange(draft); setOpen(false); }} style={{ flex: 2, backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark, toggleDark } = useTheme();
  const { uid: uidParam, tab: tabParam } = useLocalSearchParams<{ uid?: string; tab?: string }>();
  const uid = uidParam ?? user?.uid ?? '';

  const originalUsername = useRef('');

  const [profile, setProfile] = useState<Profile>(BLANK);
  const [saved,   setSaved]   = useState<Profile>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [activeTab, setActiveTab] = useState(tabParam || 'Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors,  setTabErrors]  = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [stagePlotUploading, setStagePlotUploading] = useState(false);
  const [showStickySave, setShowStickySave] = useState(false);
  const titleBarBottomRef = useRef(Infinity);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingVisited, setOnboardingVisited] = useState<string[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    getDoc(doc(db, 'bandProfiles', uid)).then(snap => {
      const raw = snap.exists() ? snap.data() : {};
      const d: Profile = {
        ...BLANK,
        ...raw,
        feeMin:      raw.feeMin      != null ? String(raw.feeMin)      : '',
        feeMax:      raw.feeMax      != null ? String(raw.feeMax)      : '',
        averageDraw: raw.averageDraw != null ? String(raw.averageDraw) : '',
      };
      d.songs       = d.songs       || [];
      d.photos      = d.photos      || [];
      d.videos      = d.videos      || [];
      d.techRiderDocs = d.techRiderDocs || [];
      d.techRiderBools = d.techRiderBools || {};
      d.customLinks = d.customLinks || [];
      d.settings    = d.settings    || BLANK.settings;
      d.payment     = d.payment     ? { ...BLANK_ARTIST_PAYMENT, ...d.payment } : { ...BLANK_ARTIST_PAYMENT };
      originalUsername.current = d.username || '';
      setProfile(d); setSaved(d);
      const isComplete = raw.onboardingComplete === true;
      setOnboardingComplete(isComplete);
      if (!isComplete) setOnboardingStep(1);
    }).finally(() => setLoading(false));
  }, [uid]);

  function set<K extends keyof Profile>(field: K, value: Profile[K]) {
    setJustSaved(false);
    setProfile(prev => ({ ...prev, [field]: value }));
  }

  function setPayment<K extends keyof ArtistPayment>(field: K, value: ArtistPayment[K]) {
    setJustSaved(false);
    setProfile(prev => ({ ...prev, payment: { ...prev.payment, [field]: value } }));
  }

  function setRiderBool(field: string, value: boolean) {
    setJustSaved(false);
    setProfile(prev => ({ ...prev, techRiderBools: { ...prev.techRiderBools, [field]: value } }));
  }

  // ── Songs ──
  function setSong(i: number, field: keyof Song, val: string) {
    setProfile(prev => ({ ...prev, songs: prev.songs.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }));
  }
  function addSong() { setProfile(prev => ({ ...prev, songs: [...prev.songs, { title: '', url: '', notes: '' }] })); }
  function removeSong(i: number) { setProfile(prev => ({ ...prev, songs: prev.songs.filter((_, idx) => idx !== i) })); }

  // ── Photo upload ──
  async function pickBannerPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUploading(true);
    try {
      const uri  = result.assets[0].uri;
      const res  = await fetch(uri);
      const blob = await res.blob();
      const ref  = sRef(storage, `photos/bands/${uid}/photo`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('photoUrl', url);
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
      const ref  = sRef(storage, `photos/bands/${uid}/gallery/${Date.now()}.jpg`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('photos', [...profile.photos, url]);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    }
  }

  // ── Document (spec sheet) upload ──
  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `riders/${uid}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('techRiderDocs', [...(profile.techRiderDocs || []), { url, name: asset.name }]);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setDocUploading(false);
    }
  }

  // ── Stage plot image upload ──
  async function pickStagePlot() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setStagePlotUploading(true);
    try {
      const uri  = result.assets[0].uri;
      const res  = await fetch(uri);
      const blob = await res.blob();
      const ref  = sRef(storage, `riders/${uid}/stage-plot-${Date.now()}.jpg`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      set('techRider', { ...profile.techRider, stagePlotUrl: url });
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setStagePlotUploading(false);
    }
  }

  // ── Save ──
  async function handleSave() {
    setShowErrors(true);
    const errors: string[] = [];

    if (!profile.name?.trim() || !profile.username?.trim() || !profile.artistType?.trim() ||
        (profile.artistType === 'Other' && !profile.otherArtistType?.trim()) ||
        !(profile.genre?.length > 0) || !profile.location?.trim() || !profile.email?.trim())
      errors.push('Basic Info');
    if (!profile.about?.trim())                      errors.push('About');
    if (profile.songs.some(s => !s.title?.trim() || !s.url?.trim()))
      errors.push('Music');

    if (errors.length > 0) { setTabErrors(errors); return; }
    setTabErrors([]);

    // Username uniqueness check if it changed
    const newUsername = profile.username.trim().toLowerCase();
    if (newUsername !== originalUsername.current) {
      const [bpSnap, uSnap] = await Promise.all([
        getDocs(query(collection(db, 'bandProfiles'), where('username', '==', newUsername))),
        getDocs(query(collection(db, 'users'),        where('username', '==', newUsername))),
      ]);
      const taken = bpSnap.docs.some(d => d.id !== uid) || !uSnap.empty;
      if (taken) {
        Alert.alert('Username taken', 'That username is already in use. Please choose a different one.');
        return;
      }
    }

    setSaving(true);

    try {
      const toNum = (v: string) => { const n = Number(v); return isNaN(n) || v === '' ? null : n; };
      const payload = {
        ...profile,
        username:    newUsername,
        feeMin:      toNum(profile.feeMin),
        feeMax:      toNum(profile.feeMax),
        averageDraw: toNum(profile.averageDraw),
      };
      await setDoc(doc(db, 'bandProfiles', uid), payload, { merge: true });
      // Also update username in users doc
      await updateDoc(doc(db, 'users', uid), { username: newUsername });
      originalUsername.current = newUsername;
      setSaved(profile);
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
      router.replace(`/musician/${uid}` as any);
    }
  }

  function handleBack() {
    const isDirty = JSON.stringify(profile) !== JSON.stringify(saved);
    if (isDirty) {
      crossConfirm('Unsaved changes', 'Any unsaved changes will be lost. Are you sure?', goBack, true);
      return;
    }
    const hasErrors =
      !profile.name?.trim() || !profile.username?.trim() || !profile.artistType?.trim() ||
      (profile.artistType === 'Other' && !profile.otherArtistType?.trim()) ||
      !(profile.genre?.length > 0) || !profile.location?.trim() || !profile.email?.trim() ||
      !profile.about?.trim();
    if (hasErrors) {
      setShowErrors(true);
      crossConfirm('Profile incomplete', "Some required fields are missing. Your profile won't be visible until complete. Leave anyway?", goBack, true);
      return;
    }
    goBack();
  }

  function advanceOnboarding() {
    if (onboardingStep === 10) { finishOnboarding(); return; }
    const curTab = STEP_TAB[onboardingStep];
    if (curTab) setOnboardingVisited(prev => prev.includes(curTab) ? prev : [...prev, curTab]);
    const next = onboardingStep + 1;
    const nextTab = STEP_TAB[next];
    if (nextTab && nextTab !== activeTab) setActiveTab(nextTab);
    setOnboardingStep(next);
  }

  function backOnboarding() {
    if (onboardingStep <= 1) return;
    const prev = onboardingStep - 1;
    const prevTab = STEP_TAB[prev];
    if (prevTab && prevTab !== activeTab) setActiveTab(prevTab);
    setOnboardingStep(prev);
  }

  async function skipOnboarding() {
    setOnboardingStep(0);
    setOnboardingComplete(true);
    updateDoc(doc(db, 'bandProfiles', uid), { onboardingComplete: true }).catch(() => {});
  }

  function finishOnboarding() {
    setOnboardingStep(0);
    setOnboardingComplete(true);
    updateDoc(doc(db, 'bandProfiles', uid), { onboardingComplete: true }).catch(() => {});
    handleSave();
  }

  function replayOnboarding() {
    setOnboardingVisited([]);
    setActiveTab('Basic Info');
    setOnboardingStep(1);
  }

  const errStyle = (bad: boolean) => bad ? { borderColor: Colors.danger, backgroundColor: 'rgba(233,69,96,0.04)' } : {};
  const isWeb = Platform.OS === 'web';
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;

  if (loading) return <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>;

  // ── Web desktop dashboard layout ────────────────────────────────────
  if (isWeb && !isMobileLayout) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <View style={epd.row}>

          {/* Sidebar */}
          <View style={[epd.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
            <TouchableOpacity onPress={pickBannerPhoto} activeOpacity={0.8} style={epd.photoWrap}>
              {photoUploading
                ? <View style={[epd.photo, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                    <ActivityIndicator color={Colors.orange} />
                  </View>
                : profile.photoUrl
                  ? <Image source={{ uri: profile.photoUrl }} style={epd.photo} resizeMode="cover" />
                  : <View style={[epd.photo, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 11, color: colors.grey, textAlign: 'center' }}>Add photo</Text>
                    </View>}
            </TouchableOpacity>
            <Text style={[epd.name, { color: colors.black }]} numberOfLines={2}>
              {profile.name || 'Your profile'}
            </Text>
            {profile.username ? (
              <Text style={[epd.handle, { color: colors.grey }]}>@{profile.username}</Text>
            ) : null}

            <View style={[epd.divider, { backgroundColor: colors.border }]} />

            {TABS.map(tab => (
              <TouchableOpacity
                key={tab}
                style={[epd.navItem, activeTab === tab && epd.navItemActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.75}
              >
                <View style={epd.navRow}>
                  <Text style={[epd.navText, { color: activeTab === tab ? Colors.orange : colors.black }]}>
                    {tab}
                  </Text>
                  {onboardingStep > 0 && onboardingVisited.includes(tab)
                    ? <Text style={epd.navCheck}>✓</Text>
                    : tabErrors.includes(tab) && <View style={epd.navErrorDot} />
                  }
                </View>
              </TouchableOpacity>
            ))}

            <View style={[epd.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={[epd.saveBtn, saving && { opacity: 0.6 }, justSaved && { backgroundColor: '#22c55e' }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={epd.saveBtnText}>{saving ? 'Saving...' : justSaved ? 'Saved ✓' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[epd.backBtn, { borderColor: colors.border }]}
              onPress={handleBack}
              activeOpacity={0.75}
            >
              <Text style={[epd.backBtnText, { color: colors.black }]}>Back</Text>
            </TouchableOpacity>
          </View>

          {/* Main content */}
          <ScrollView style={epd.main} showsVerticalScrollIndicator={false} contentContainerStyle={epd.mainContent}>
            {tabErrors.length > 0 && (
              <View style={[s.tabErrors, { marginBottom: 24, borderRadius: 8 }]}>
                <Text style={s.tabErrorsLabel}>Please complete: </Text>
                {tabErrors.map(t => <Text key={t} style={s.tabErrorPill}>{t}</Text>)}
              </View>
            )}

            {activeTab === 'Settings' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Notification Preferences</Text>
                <TouchableOpacity style={[s.checkRow, { borderBottomColor: colors.borderFaint }]} onPress={() => set('settings', { ...profile.settings, emailOnEnquiryResponse: !profile.settings.emailOnEnquiryResponse })}>
                  <View style={[s.checkbox, { borderColor: colors.border }, profile.settings.emailOnEnquiryResponse && s.checkboxChecked]}>{profile.settings.emailOnEnquiryResponse && <Text style={s.checkmark}>✓</Text>}</View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>Email me when an enquiry is responded to</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.checkRow, { borderBottomColor: colors.borderFaint }]} onPress={() => set('settings', { ...profile.settings, emailOnNewConnection: !profile.settings.emailOnNewConnection })}>
                  <View style={[s.checkbox, { borderColor: colors.border }, profile.settings.emailOnNewConnection && s.checkboxChecked]}>{profile.settings.emailOnNewConnection && <Text style={s.checkmark}>✓</Text>}</View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>Email me when a new connection is received</Text>
                </TouchableOpacity>
                <CalendarSync />
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
                  <Text style={[s.dangerDesc, { color: colors.black }]}>Deactivating your listing will hide it from all venues browsing Twaylo. This action can be reversed at any time.</Text>
                  <TouchableOpacity style={[s.dangerBtn, profile.settings.listed ? {} : s.dangerBtnActive]} onPress={() => { const willDeactivate = profile.settings.listed; crossConfirm(willDeactivate ? 'Deactivate Musician Listing?' : 'Reactivate Musician Listing?', willDeactivate ? 'Are you sure? This will deactivate your account and hide it from view. You can reactivate at any time.' : 'This will make your profile visible to venues again.', async () => { const uid = user?.uid; if (!uid) return; const newListed = !willDeactivate; await updateDoc(doc(db, 'bandProfiles', uid), { 'settings.listed': newListed }); set('settings', { ...profile.settings, listed: newListed }); }, willDeactivate); }}>
                    <Text style={s.dangerBtnText}>{profile.settings.listed ? 'Deactivate Musician Listing' : 'Reactivate Musician Listing'}</Text>
                  </TouchableOpacity>
                  <Text style={[s.dangerDesc, { color: colors.grey, marginTop: 20 }]}>Permanently delete your profile and account. This action cannot be undone.</Text>
                  <TouchableOpacity style={[s.dangerBtn, s.dangerBtnActive]} onPress={() => { crossConfirm('Delete Account', 'This will permanently delete your profile and account from the database. This action cannot be undone.', async () => { try { const uid = user?.uid; if (uid) { await deleteDoc(doc(db, 'bandProfiles', uid)); await deleteDoc(doc(db, 'users', uid)); } const cu = auth.currentUser; if (cu) await deleteUser(cu); } catch (e: any) { Alert.alert('Error', e.message ?? 'Could not delete account. Please try again.'); } finally { await signOut(auth).catch(() => {}); router.replace('/'); } }, true); }}>
                    <Text style={s.dangerBtnText}>Delete Account</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {activeTab === 'Basic Info' && (
              <View style={s.section}>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Stage Details</Text>
                  <Field label="Stage Name *" error={showErrors && !profile.name?.trim()}><Input value={profile.name} onChangeText={(v: string) => set('name', v)} placeholder="Your stage name" error={showErrors && !profile.name?.trim()} /></Field>
                  <Field label="Username *" error={showErrors && !profile.username?.trim()}>
                    <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: showErrors && !profile.username?.trim() ? Colors.danger : colors.border }]}>
                      <Text style={[s.prefixSymbol, { color: colors.grey }]}>@</Text>
                      <TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.username} onChangeText={(v: string) => set('username', v.toLowerCase().replace(/\s/g, ''))} placeholder="username" placeholderTextColor={Colors.greyLight} autoCapitalize="none" />
                    </View>
                  </Field>
                  <Field label="Act Type *" error={showErrors && !profile.artistType?.trim()}><Pills options={ACT_TYPES} value={profile.artistType} onSelect={(v: string) => set('artistType', v)} /></Field>
                  {profile.artistType === 'Other' && (<Field label="Describe your act *" error={showErrors && !profile.otherArtistType?.trim()}><Input value={profile.otherArtistType} onChangeText={(v: string) => set('otherArtistType', v)} placeholder="e.g. Acapella Group, String Quartet" error={showErrors && !profile.otherArtistType?.trim()} /></Field>)}
                  <Field label="Genres *" error={showErrors && !(profile.genre?.length > 0)}><Pills options={GENRES} value={profile.genre} onSelect={(v: string[]) => set('genre', v)} multi /></Field>
                  {profile.genre?.includes('Other') && (<Field label="Other genres"><Input value={profile.otherGenres} onChangeText={(v: string) => set('otherGenres', v)} placeholder="e.g. Bluegrass, Afrobeat, Cumbia" /></Field>)}
                  <Field label="Instruments / What You Play"><Pills options={INSTRUMENTS} value={profile.instruments || []} onSelect={(v: string[]) => set('instruments', v)} multi /></Field>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Contact</Text>
                  <View style={{ marginBottom: 14 }}><SuburbSearch value={profile.location} onChange={(v: string) => set('location', v)} error={showErrors && !profile.location?.trim()} /></View>
                  <View style={{ marginBottom: 14 }}><Input value={profile.email} onChangeText={(v: string) => set('email', v)} placeholder="Email *" keyboardType="email-address" error={showErrors && !profile.email?.trim()} /></View>
                  <View style={{ marginBottom: 14 }}><Input value={profile.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone" keyboardType="phone-pad" /></View>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Fee Range</Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={[s.prefixInput, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border }]}><Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text><TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.feeMin} onChangeText={(v: string) => set('feeMin', v)} placeholder="Min" placeholderTextColor={Colors.greyLight} keyboardType="numeric" /></View>
                    <View style={[s.prefixInput, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border }]}><Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text><TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.feeMax} onChangeText={(v: string) => set('feeMax', v)} placeholder="Max" placeholderTextColor={Colors.greyLight} keyboardType="numeric" /></View>
                  </View>
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Average Draw Per Show</Text>
                  <Input value={profile.averageDraw} onChangeText={(v: string) => set('averageDraw', v)} placeholder="Avg. audience size (optional), e.g. 120" keyboardType="numeric" />
                </View>
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Social Links</Text>
                  {PLATFORMS.map(p => (<Field key={p.key} label={p.label}><Input value={(profile as any)[p.key] || ''} onChangeText={(v: string) => set(p.key as any, v)} placeholder={p.placeholder} /></Field>))}
                  {profile.customLinks.map((link, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <TextInput style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, width: 110 }]} value={link.label} onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, label: v } : l))} placeholder="Label" placeholderTextColor={Colors.greyLight} />
                      <TextInput style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, flex: 1 }]} value={link.url} onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, url: v } : l))} placeholder="URL" placeholderTextColor={Colors.greyLight} autoCapitalize="none" />
                      <TouchableOpacity onPress={() => set('customLinks', profile.customLinks.filter((_, idx) => idx !== i))}><Text style={{ fontSize: 18, color: Colors.orange, paddingHorizontal: 4 }}>✕</Text></TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addBtn} onPress={() => set('customLinks', [...profile.customLinks, { label: '', url: '' }])}><Text style={s.addBtnText}>+ Add Link</Text></TouchableOpacity>
                </View>
              </View>
            )}

            {activeTab === 'About' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>About *</Text>
                <Text style={s.hint}>Tell venues who you are, what you play, and how many people you draw.</Text>
                <Input value={profile.about} onChangeText={(v: string) => set('about', v)} placeholder="We're a 4-piece indie rock band from Melbourne's south-east…" multiline error={showErrors && !profile.about?.trim()} />
              </View>
            )}

            {activeTab === 'Music' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Music</Text>
                <Text style={s.hint}>Add links to your tracks so venues can hear what you sound like before booking. Spotify, SoundCloud, YouTube — whatever best represents your sound.</Text>
                {profile.songs.map((song, i) => {
                  const hasError = showErrors && (!song.title?.trim() || !song.url?.trim());
                  return (
                    <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                      <Input value={song.title} onChangeText={(v: string) => setSong(i, 'title', v)} placeholder="Song title *" error={showErrors && !song.title?.trim()} />
                      <View style={{ height: 8 }} />
                      <Input value={song.url} onChangeText={(v: string) => setSong(i, 'url', v)} placeholder="Spotify / stream URL *" error={showErrors && !song.url?.trim()} />
                      <View style={{ height: 8 }} />
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <TextInput style={[s.input, { flex: 1 }]} value={song.notes} onChangeText={v => setSong(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                        <TouchableOpacity style={s.removeInlineBtn} onPress={() => removeSong(i)}><Text style={s.removeInlineBtnText}>Remove</Text></TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
                <TouchableOpacity style={s.addBtn} onPress={addSong}><Text style={s.addBtnText}>+ Add Song</Text></TouchableOpacity>
              </View>
            )}

            {activeTab === 'Past Gigs' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Past Gigs</Text>
                <Text style={s.hint}>Your gig history is now managed in My Gigs. Past confirmed gigs appear automatically on your public profile once they have passed.</Text>
                <TouchableOpacity style={s.addBtn} onPress={() => router.push('/(tabs)/gigs' as any)}>
                  <Text style={s.addBtnText}>Go to My Gigs</Text>
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'Timetable' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Timetable</Text>
                <Text style={s.hint}>Your upcoming gigs are now managed in My Gigs. Confirmed public gigs appear on your profile timetable automatically.</Text>
                <TouchableOpacity style={s.addBtn} onPress={() => router.push('/(tabs)/gigs' as any)}>
                  <Text style={s.addBtnText}>Go to My Gigs</Text>
                </TouchableOpacity>
              </View>
            )}

            {activeTab === 'Tech Rider' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Rider</Text>
                <Text style={s.hint}>Upload your full rider PDF below if you have one. It can cover most of the questions here, so you may not need to fill in every field.{'\n\n'}Having a rider on your profile lets venues see straight away whether their space can handle your act, so you skip the back-and-forth and only hear from venues that are a real fit.</Text>

                {/* ── Rider PDF ── */}
                <Field label="Rider Document (PDF)">
                  {(profile.techRiderDocs || []).map((doc, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name}</Text>
                      <TouchableOpacity style={s.removeInlineBtn} onPress={() => set('techRiderDocs', (profile.techRiderDocs || []).filter((_, i) => i !== idx))}><Text style={s.removeInlineBtnText}>Remove</Text></TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addBtn} onPress={pickDocument} disabled={docUploading}><Text style={s.addBtnText}>{docUploading ? 'Uploading…' : '+ Upload Rider PDF'}</Text></TouchableOpacity>
                </Field>

                {/* ── Stage Plot ── */}
                <Field label="Stage Plot">
                  {profile.techRider?.stagePlotUrl ? (
                    <View>
                      <Image source={{ uri: profile.techRider.stagePlotUrl }} style={{ width: '100%', height: 180, borderRadius: 6, marginBottom: 8 }} resizeMode="contain" />
                      <TouchableOpacity style={s.removeInlineBtn} onPress={() => set('techRider', { ...profile.techRider, stagePlotUrl: '' })}><Text style={s.removeInlineBtnText}>Remove</Text></TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.addBtn} onPress={pickStagePlot} disabled={stagePlotUploading}><Text style={s.addBtnText}>{stagePlotUploading ? 'Uploading…' : '+ Upload Stage Plot'}</Text></TouchableOpacity>
                  )}
                </Field>

                {/* ── Stage Setup ── */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Stage Setup</Text>
                  <Field label="Number of performers"><Input value={profile.techRider?.performers || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, performers: v })} placeholder="e.g. 5" keyboardType="numeric" /></Field>
                  <Field label="Input list"><Input value={profile.techRider?.inputList || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, inputList: v })} placeholder="e.g. Kick, Snare, 2x Guitar amp, Bass DI, 3x Vocal" multiline /></Field>
                  <Field label="Monitoring"><Input value={profile.techRider?.monitoring || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, monitoring: v })} placeholder="e.g. 3 wedge mixes, no IEM" /></Field>
                  <Field label="Backline needed from venue"><Input value={profile.techRider?.backlineNeeded || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, backlineNeeded: v })} placeholder="e.g. Drum kit only" /></Field>
                  <Field label="Backline artist brings"><Input value={profile.techRider?.backlineBrings || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, backlineBrings: v })} placeholder="e.g. Fender Twin, pedalboard, keyboard" /></Field>
                  <Field label="Minimum stage size"><Input value={profile.techRider?.stageSize || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, stageSize: v })} placeholder="e.g. 4m × 3m" /></Field>
                </View>

                {/* ── Hospitality ── */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Hospitality</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Meals required</Text>
                    <Switch value={profile.techRiderBools?.mealsRequired || false} onValueChange={(v: boolean) => setRiderBool('mealsRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  {profile.techRiderBools?.mealsRequired && (
                    <Field label="Number of people"><Input value={profile.techRider?.mealCount || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, mealCount: v })} placeholder="e.g. 5" keyboardType="numeric" /></Field>
                  )}
                  <Field label="Dietary requirements"><Input value={profile.techRider?.dietaryReqs || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, dietaryReqs: v })} placeholder="e.g. 1 vegan, 1 gluten-free" /></Field>
                  <Field label="Drinks / refreshments"><Input value={profile.techRider?.drinks || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, drinks: v })} placeholder="e.g. Water + 2 beers per band member" /></Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Green room / private space required</Text>
                    <Switch value={profile.techRiderBools?.greenRoom || false} onValueChange={(v: boolean) => setRiderBool('greenRoom', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Parking / loading dock access needed</Text>
                    <Switch value={profile.techRiderBools?.parking || false} onValueChange={(v: boolean) => setRiderBool('parking', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                </View>

                {/* ── Technical / Production ── */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Technical / Production</Text>
                  <Field label="Set length"><Input value={profile.techRider?.setLength || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, setLength: v })} placeholder="e.g. 45 minutes" /></Field>
                  <Field label="Soundcheck time required"><Input value={profile.techRider?.soundcheck || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, soundcheck: v })} placeholder="e.g. 30 minutes" /></Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Touring with own PA / sound engineer</Text>
                    <Switch value={profile.techRiderBools?.ownPA || false} onValueChange={(v: boolean) => setRiderBool('ownPA', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <Field label="Lighting requirements (optional)"><Input value={profile.techRider?.lighting || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, lighting: v })} placeholder="e.g. Standard stage wash is fine" /></Field>
                  <Field label="Power requirements"><Input value={profile.techRider?.power || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, power: v })} placeholder="e.g. 4 x 10A power outlets" /></Field>
                </View>

                {/* ── Logistics ── */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Logistics</Text>
                  <Field label="Load-in time needed"><Input value={profile.techRider?.loadIn || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, loadIn: v })} placeholder="e.g. 1 hour before doors" /></Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Merch table required</Text>
                    <Switch value={profile.techRiderBools?.merchTable || false} onValueChange={(v: boolean) => setRiderBool('merchTable', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Accommodation required</Text>
                    <Switch value={profile.techRiderBools?.accommodation || false} onValueChange={(v: boolean) => setRiderBool('accommodation', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                </View>

                {/* ── Notes ── */}
                <Field label="Additional notes"><Input value={profile.techRider?.notes || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, notes: v })} placeholder="Anything else the venue's sound team should know" multiline /></Field>
              </View>
            )}

            {activeTab === 'Payment' && (
              <View style={s.section}>

                {/* Payment Preferences */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Preferences</Text>
                  <Field label="Preferred Payment Method/s">
                    <Pills options={ARTIST_PAY_METHODS} value={profile.payment.methods} onSelect={(v: string[]) => setPayment('methods', v)} multi />
                  </Field>
                  <Field label="Typical Fee Expectation">
                    <Input value={profile.payment.typicalFee} onChangeText={(v: string) => setPayment('typicalFee', v)} placeholder="e.g. $200-$400, or negotiable for door deals" />
                  </Field>
                  <Field label="Minimum Fee (optional)">
                    <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                      <TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.payment.minimumFee} onChangeText={(v: string) => setPayment('minimumFee', v)} placeholder="Floor rate" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                    </View>
                  </Field>
                </View>

                {/* Tax & Invoicing */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Tax and Invoicing</Text>
                  <Field label="ABN">
                    <Input value={profile.payment.abn} onChangeText={(v: string) => setPayment('abn', v)} placeholder="e.g. 12 345 678 901" keyboardType="numeric" />
                  </Field>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>GST Registered</Text>
                    <Switch value={profile.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Can Provide Invoice</Text>
                    <Switch value={profile.payment.canProvideInvoice} onValueChange={(v: boolean) => setPayment('canProvideInvoice', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  <Field label="Business / Invoicing Name">
                    <Input value={profile.payment.invoicingName} onChangeText={(v: string) => setPayment('invoicingName', v)} placeholder="If different from your stage name" />
                  </Field>
                </View>

                {/* Payment Logistics */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Logistics</Text>
                  <Field label="Payment Timing Expectation">
                    <Pills options={ARTIST_PAY_TIMING} value={profile.payment.timing} onSelect={(v: string) => setPayment('timing', v)} />
                  </Field>
                  {profile.payment.timing === 'Other' && (
                    <Field label="Timing Details">
                      <Input value={profile.payment.timingOther} onChangeText={(v: string) => setPayment('timingOther', v)} placeholder="e.g. invoice within 14 days of performance" />
                    </Field>
                  )}
                  <Field label="Bank Transfer">
                    <Text style={{ fontSize: 12, color: Colors.grey, marginBottom: 8, lineHeight: 17 }}>BSB and account numbers are not stored here. Once a booking is confirmed, exchange bank details directly through the Twaylo message thread.</Text>
                    <Input value={profile.payment.bankTransferNote} onChangeText={(v: string) => setPayment('bankTransferNote', v)} placeholder="e.g. Bank transfer details provided on confirmation" />
                  </Field>
                </View>

                {/* Legal / Compliance */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Legal and Compliance</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Public Liability Insurance Held</Text>
                    <Switch value={profile.payment.publicLiabilityHeld} onValueChange={(v: boolean) => setPayment('publicLiabilityHeld', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                  {profile.payment.publicLiabilityHeld && (
                    <Field label="Coverage Amount (optional)">
                      <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                        <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                        <TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.payment.publicLiabilityCoverage} onChangeText={(v: string) => setPayment('publicLiabilityCoverage', v)} placeholder="e.g. 10,000,000" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                      </View>
                    </Field>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.black }}>Certificate of Insurance Available on Request</Text>
                    <Switch value={profile.payment.insuranceCertAvailable} onValueChange={(v: boolean) => setPayment('insuranceCertAvailable', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
                  </View>
                </View>

                {/* Notes */}
                <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                  <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Notes</Text>
                  <Input value={profile.payment.paymentNotes} onChangeText={(v: string) => setPayment('paymentNotes', v)} placeholder="e.g. Happy to discuss door splits for original shows. Invoice required for corporate bookings." multiline />
                </View>

              </View>
            )}

            {activeTab === 'Photos' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Profile Photo</Text>
                <RepositionablePhoto
                  uri={profile.photoUrl || null}
                  position={profile.photoPosition ?? { x: 50, y: 50 }}
                  onPositionChange={pos => set('photoPosition', pos)}
                  onChangePhoto={pickBannerPhoto}
                  height={200}
                  uploading={photoUploading}
                  placeholderText="Tap to add profile photo"
                />
                <Text style={[s.sectionTitle, { color: colors.black, marginTop: 24 }]}>Photo Gallery</Text>
                <View style={s.photoGrid}>
                  {profile.photos.map((url, i) => (
                    <View key={i} style={s.photoItem}>
                      <Image source={{ uri: url }} style={s.photoImg} />
                      <TouchableOpacity style={s.photoRemove} onPress={() => set('photos', profile.photos.filter((_, idx) => idx !== i))}><Text style={{ color: '#fff', fontSize: 14 }}>✕</Text></TouchableOpacity>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={s.addBtn} onPress={addGalleryPhoto}><Text style={s.addBtnText}>+ Add Photo</Text></TouchableOpacity>
              </View>
            )}

          </ScrollView>

          {/* ── Onboarding side panel (steps 2-8) ── */}
          {onboardingStep >= 2 && onboardingStep <= 9 && (() => {
            const data = ONBOARDING_DATA[onboardingStep];
            return (
              <View style={[epd.onboardingPanel, { borderLeftColor: colors.border, backgroundColor: colors.bg }]}>
                <View style={epd.onboardingPanelInner}>
                  <View style={epd.onboardingStepRow}>
                    <Text style={epd.onboardingStepLabel}>STEP {onboardingStep} OF 10</Text>
                    <TouchableOpacity onPress={skipOnboarding}><Text style={epd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
                  </View>
                  <View style={epd.onboardingProgress}>
                    <View style={[epd.onboardingProgressFill, { width: `${(onboardingStep / 10) * 100}%` as any }]} />
                  </View>
                  <Text style={[epd.onboardingTitle, { color: colors.black }]}>{data.title}</Text>
                  <Text style={epd.onboardingBody}>{data.body}</Text>
                  {data.body2 && <Text style={[epd.onboardingBody, { marginTop: 10 }]}>{data.body2}</Text>}
                  {data.fieldsLabel && data.fields && (
                    <View style={{ marginTop: 14 }}>
                      <Text style={epd.onboardingFieldsLabel}>{data.fieldsLabel}</Text>
                      {data.fields.map((f, i) => (
                        <View key={i} style={epd.onboardingBulletRow}>
                          <View style={epd.onboardingBulletDot} />
                          <Text style={epd.onboardingBulletText}>{f}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={epd.onboardingBtns}>
                    <TouchableOpacity style={epd.onboardingNextBtn} onPress={advanceOnboarding}>
                      <Text style={epd.onboardingNextBtnText}>{data.nextLabel}</Text>
                    </TouchableOpacity>
                    {onboardingStep > 1 && (
                      <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                        <Text style={epd.onboardingBackText}>Back</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })()}

        </View>

        {/* ── Step 1: Welcome modal ── */}
        {onboardingStep === 1 && (
          <View style={epd.modalOverlay}>
            <View style={[epd.welcomeCard, { backgroundColor: colors.bg }]}>
              <View style={epd.onboardingStepRow}>
                <Text style={epd.onboardingStepLabel}>STEP 1 OF 10</Text>
                <TouchableOpacity onPress={skipOnboarding}><Text style={epd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
              </View>
              <View style={[epd.onboardingProgress, { marginBottom: 20 }]}>
                <View style={[epd.onboardingProgressFill, { width: '10%' as any }]} />
              </View>
              <Text style={[epd.onboardingTitle, { color: colors.black, fontSize: 22 }]}>Welcome</Text>
              <Text style={[epd.onboardingBody, { marginBottom: 24 }]}>{ONBOARDING_DATA[1].body}</Text>
              <TouchableOpacity style={epd.onboardingNextBtn} onPress={advanceOnboarding}>
                <Text style={epd.onboardingNextBtnText}>Get started</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 10: Go Live card (bottom-left) ── */}
        {onboardingStep === 10 && (
          <View style={epd.goLiveCard}>
            <View style={[epd.goLiveCardInner, { backgroundColor: colors.bg }]}>
              <View style={epd.onboardingStepRow}>
                <Text style={epd.onboardingStepLabel}>STEP 10 OF 10</Text>
                <TouchableOpacity onPress={skipOnboarding}><Text style={epd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
              </View>
              <View style={[epd.onboardingProgress, { marginBottom: 16 }]}>
                <View style={[epd.onboardingProgressFill, { width: '100%' as any }]} />
              </View>
              <Text style={[epd.onboardingTitle, { color: colors.black }]}>Go Live</Text>
              <Text style={epd.onboardingBody}>{ONBOARDING_DATA[10].body}</Text>
              <Text style={[epd.onboardingBody, { marginTop: 8 }]}>{ONBOARDING_DATA[10].body2}</Text>
              <View style={[epd.onboardingBtns, { marginTop: 20 }]}>
                <TouchableOpacity style={epd.onboardingNextBtn} onPress={finishOnboarding}>
                  <Text style={epd.onboardingNextBtnText}>Publish my profile</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                  <Text style={epd.onboardingBackText}>Back</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── Replay setup tour button ── */}
        {onboardingStep === 0 && onboardingComplete && (
          <TouchableOpacity style={epd.replayBtn} onPress={replayOnboarding} activeOpacity={0.8}>
            <Text style={epd.replayBtnText}>Replay setup tour</Text>
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
              uri={profile.photoUrl || null}
              position={profile.photoPosition ?? { x: 50, y: 50 }}
              onPositionChange={pos => set('photoPosition', pos)}
              onChangePhoto={pickBannerPhoto}
              height={270}
              uploading={photoUploading}
              placeholderText="Tap to add profile photo"
            />
          </View>

          <View
            style={[s.titleBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}
            onLayout={(e) => {
              titleBarBottomRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.headerTitle, { color: colors.black }]}>Edit Profile</Text>
              <Text style={[s.headerSub, { color: colors.black }]}>{profile.name || '—'}</Text>
            </View>
            <View style={s.headerBtns}>
              <TouchableOpacity style={[s.backBtnInline, { borderColor: colors.border }]} onPress={handleBack}>
                <Text style={[s.backBtnInlineText, { color: colors.black }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }, justSaved && { backgroundColor: '#22c55e' }]} onPress={handleSave} disabled={saving}>
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
            {TABS.map(tab => (
              <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={[s.tab, activeTab === tab && s.tabActive]}>
                <Text style={[s.tabText, { color: colors.black }, activeTab === tab && s.tabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {showStickySave && (
            <TouchableOpacity
              style={[s.saveBtn, { position: 'absolute', right: 12, top: '100%', marginTop: 10, zIndex: 10 }, saving && { opacity: 0.6 }, justSaved && { backgroundColor: '#22c55e' }]}
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
              onPress={() => set('settings', { ...profile.settings, emailOnEnquiryResponse: !profile.settings.emailOnEnquiryResponse })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, profile.settings.emailOnEnquiryResponse && s.checkboxChecked]}>
                {profile.settings.emailOnEnquiryResponse && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me when an enquiry is responded to</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.checkRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => set('settings', { ...profile.settings, emailOnNewConnection: !profile.settings.emailOnNewConnection })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, profile.settings.emailOnNewConnection && s.checkboxChecked]}>
                {profile.settings.emailOnNewConnection && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me when a new connection is received</Text>
            </TouchableOpacity>

            <CalendarSync />
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
                Deactivating your listing will hide it from all venues browsing Twaylo. This action can be reversed at any time.
              </Text>
              <TouchableOpacity
                style={[s.dangerBtn, profile.settings.listed ? {} : s.dangerBtnActive]}
                onPress={() => {
                  const willDeactivate = profile.settings.listed;
                  crossConfirm(
                    willDeactivate ? 'Deactivate Musician Listing?' : 'Reactivate Musician Listing?',
                    willDeactivate
                      ? 'Are you sure? This will deactivate your account and hide it from view. You can reactivate at any time.'
                      : 'This will make your profile visible to venues again.',
                    async () => {
                      const uid = user?.uid;
                      if (!uid) return;
                      const newListed = !willDeactivate;
                      await updateDoc(doc(db, 'bandProfiles', uid), { 'settings.listed': newListed });
                      set('settings', { ...profile.settings, listed: newListed });
                    },
                    willDeactivate,
                  );
                }}
              >
                <Text style={s.dangerBtnText}>
                  {profile.settings.listed ? 'Deactivate Musician Listing' : 'Reactivate Musician Listing'}
                </Text>
              </TouchableOpacity>

              <Text style={[s.dangerDesc, { color: colors.grey, marginTop: 20 }]}>
                Permanently delete your profile and account. This action cannot be undone.
              </Text>
              <TouchableOpacity
                style={[s.dangerBtn, s.dangerBtnActive]}
                onPress={() => {
                  crossConfirm(
                    'Delete Account',
                    'This will permanently delete your profile and account from the database. This action cannot be undone.',
                    async () => {
                      try {
                        const uid = user?.uid;
                        if (uid) {
                          await deleteDoc(doc(db, 'bandProfiles', uid));
                          await deleteDoc(doc(db, 'users', uid));
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

            {/* Stage Details */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Stage Details</Text>
              <Field label="Stage Name *" error={showErrors && !profile.name?.trim()}>
                <Input value={profile.name} onChangeText={(v: string) => set('name', v)} placeholder="Your stage name" error={showErrors && !profile.name?.trim()} />
              </Field>
              <Field label="Username *" error={showErrors && !profile.username?.trim()}>
                <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: showErrors && !profile.username?.trim() ? Colors.danger : colors.border }]}>
                  <Text style={[s.prefixSymbol, { color: colors.grey }]}>@</Text>
                  <TextInput
                    style={[s.prefixTextInput, { color: colors.black }]}
                    value={profile.username}
                    onChangeText={(v: string) => set('username', v.toLowerCase().replace(/\s/g, ''))}
                    placeholder="username"
                    placeholderTextColor={Colors.greyLight}
                    autoCapitalize="none"
                  />
                </View>
              </Field>
              <Field label="Act Type *" error={showErrors && !profile.artistType?.trim()}>
                <Pills options={ACT_TYPES} value={profile.artistType} onSelect={(v: string) => set('artistType', v)} />
              </Field>
              {profile.artistType === 'Other' && (
                <Field label="Describe your act *" error={showErrors && !profile.otherArtistType?.trim()}>
                  <Input value={profile.otherArtistType} onChangeText={(v: string) => set('otherArtistType', v)} placeholder="e.g. Acapella Group, String Quartet" error={showErrors && !profile.otherArtistType?.trim()} />
                </Field>
              )}
              <Field label="Genres *" error={showErrors && !(profile.genre?.length > 0)}>
                <Pills options={GENRES} value={profile.genre} onSelect={(v: string[]) => set('genre', v)} multi />
              </Field>
              {profile.genre?.includes('Other') && (
                <Field label="Other genres">
                  <Input
                    value={profile.otherGenres}
                    onChangeText={(v: string) => set('otherGenres', v)}
                    placeholder="e.g. Bluegrass, Afrobeat, Cumbia"
                  />
                </Field>
              )}
              <Field label="Instruments / What You Play">
                <Pills options={INSTRUMENTS} value={profile.instruments || []} onSelect={(v: string[]) => set('instruments', v)} multi />
              </Field>
            </View>

            {/* Contact */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Contact</Text>
              <View style={{ marginBottom: 14 }}>
                <SuburbSearch value={profile.location} onChange={(v: string) => set('location', v)} error={showErrors && !profile.location?.trim()} />
              </View>
              <View style={{ marginBottom: 14 }}>
                <Input value={profile.email} onChangeText={(v: string) => set('email', v)} placeholder="Email *" keyboardType="email-address" error={showErrors && !profile.email?.trim()} />
              </View>
              <View style={{ marginBottom: 14 }}>
                <Input value={profile.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone" keyboardType="phone-pad" />
              </View>
            </View>

            {/* Fee Range */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Fee Range</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[s.prefixInput, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                  <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                  <TextInput
                    style={[s.prefixTextInput, { color: colors.black }]}
                    value={profile.feeMin}
                    onChangeText={(v: string) => set('feeMin', v)}
                    placeholder="Min"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="numeric"
                  />
                </View>
                <View style={[s.prefixInput, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                  <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                  <TextInput
                    style={[s.prefixTextInput, { color: colors.black }]}
                    value={profile.feeMax}
                    onChangeText={(v: string) => set('feeMax', v)}
                    placeholder="Max"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>

            {/* Average Draw */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Average Draw Per Show</Text>
              <Input
                value={profile.averageDraw}
                onChangeText={(v: string) => set('averageDraw', v)}
                placeholder="Avg. audience size (optional), e.g. 120"
                keyboardType="numeric"
              />
            </View>

            {/* Social Links */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Social Links</Text>
              {PLATFORMS.map(p => (
                <Field key={p.key} label={p.label}>
                  <Input value={(profile as any)[p.key] || ''} onChangeText={(v: string) => set(p.key as any, v)} placeholder={p.placeholder} />
                </Field>
              ))}
              {profile.customLinks.map((link, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <TextInput
                    style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, width: 110 }]}
                    value={link.label}
                    onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, label: v } : l))}
                    placeholder="Label"
                    placeholderTextColor={Colors.greyLight}
                  />
                  <TextInput
                    style={[s.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, flex: 1 }]}
                    value={link.url}
                    onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, url: v } : l))}
                    placeholder="URL"
                    placeholderTextColor={Colors.greyLight}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => set('customLinks', profile.customLinks.filter((_, idx) => idx !== i))}>
                    <Text style={{ fontSize: 18, color: Colors.orange, paddingHorizontal: 4 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={s.addBtn} onPress={() => set('customLinks', [...profile.customLinks, { label: '', url: '' }])}>
                <Text style={s.addBtnText}>+ Add Link</Text>
              </TouchableOpacity>
            </View>

          </View>
        )}

        {/* ── ABOUT ── */}
        {activeTab === 'About' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>About *</Text>
            <Text style={s.hint}>Tell venues who you are, what you play, and how many people you draw.</Text>
            <Input value={profile.about} onChangeText={(v: string) => set('about', v)} placeholder="We're a 4-piece indie rock band from Melbourne's south-east…" multiline error={showErrors && !profile.about?.trim()} />
          </View>
        )}

        {/* ── MUSIC ── */}
        {activeTab === 'Music' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Music</Text>
            <Text style={s.hint}>Add links to your tracks so venues can hear what you sound like before booking. Spotify, SoundCloud, YouTube — whatever best represents your sound.</Text>
            {profile.songs.map((song, i) => {
              const hasError = showErrors && (!song.title?.trim() || !song.url?.trim());
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <Input value={song.title} onChangeText={(v: string) => setSong(i, 'title', v)} placeholder="Song title *" error={showErrors && !song.title?.trim()} />
                  <View style={{ height: 8 }} />
                  <Input value={song.url} onChangeText={(v: string) => setSong(i, 'url', v)} placeholder="Spotify / stream URL *" error={showErrors && !song.url?.trim()} />
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      value={song.notes}
                      onChangeText={v => setSong(i, 'notes', v)}
                      placeholder="Notes"
                      placeholderTextColor={Colors.greyLight}
                    />
                    <TouchableOpacity style={s.removeInlineBtn} onPress={() => removeSong(i)}>
                      <Text style={s.removeInlineBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={addSong}>
              <Text style={s.addBtnText}>+ Add Song</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── GIG HISTORY ── */}
        {activeTab === 'Past Gigs' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Past Gigs</Text>
            <Text style={s.hint}>Your gig history is now managed in My Gigs. Past confirmed gigs appear automatically on your public profile once they have passed.</Text>
            <TouchableOpacity style={s.addBtn} onPress={() => router.push('/(tabs)/gigs' as any)}>
              <Text style={s.addBtnText}>Go to My Gigs</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── UPCOMING ── */}
        {activeTab === 'Timetable' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Timetable</Text>
            <Text style={s.hint}>Your upcoming gigs are now managed in My Gigs. Confirmed public gigs appear on your profile timetable automatically.</Text>
            <TouchableOpacity style={s.addBtn} onPress={() => router.push('/(tabs)/gigs' as any)}>
              <Text style={s.addBtnText}>Go to My Gigs</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── TECH RIDER ── */}
        {activeTab === 'Tech Rider' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Rider</Text>
            <Text style={s.hint}>Upload your full rider PDF below if you have one. It can cover most of the questions here, so you may not need to fill in every field.{'\n\n'}Having a rider on your profile lets venues see straight away whether their space can handle your act, so you skip the back-and-forth and only hear from venues that are a real fit.</Text>

            {/* ── Rider PDF ── */}
            <Field label="Rider Document (PDF)">
              {(profile.techRiderDocs || []).map((doc, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name}</Text>
                  <TouchableOpacity style={s.removeInlineBtn} onPress={() => set('techRiderDocs', (profile.techRiderDocs || []).filter((_, i) => i !== idx))}>
                    <Text style={s.removeInlineBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={s.addBtn} onPress={pickDocument} disabled={docUploading}>
                <Text style={s.addBtnText}>{docUploading ? 'Uploading…' : '+ Upload Rider PDF'}</Text>
              </TouchableOpacity>
            </Field>

            {/* ── Stage Plot ── */}
            <Field label="Stage Plot">
              {profile.techRider?.stagePlotUrl ? (
                <View>
                  <Image source={{ uri: profile.techRider.stagePlotUrl }} style={{ width: '100%', height: 200, borderRadius: 6, marginBottom: 8 }} resizeMode="contain" />
                  <TouchableOpacity style={s.removeInlineBtn} onPress={() => set('techRider', { ...profile.techRider, stagePlotUrl: '' })}>
                    <Text style={s.removeInlineBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={s.addBtn} onPress={pickStagePlot} disabled={stagePlotUploading}>
                  <Text style={s.addBtnText}>{stagePlotUploading ? 'Uploading…' : '+ Upload Stage Plot'}</Text>
                </TouchableOpacity>
              )}
            </Field>

            {/* ── Stage Setup ── */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Stage Setup</Text>
              <Field label="Number of performers">
                <Input value={profile.techRider?.performers || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, performers: v })} placeholder="e.g. 5" keyboardType="numeric" />
              </Field>
              <Field label="Input list">
                <Input value={profile.techRider?.inputList || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, inputList: v })} placeholder="e.g. Kick, Snare, 2x Guitar amp, Bass DI, 3x Vocal" multiline />
              </Field>
              <Field label="Monitoring">
                <Input value={profile.techRider?.monitoring || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, monitoring: v })} placeholder="e.g. 3 wedge mixes, no IEM" />
              </Field>
              <Field label="Backline needed from venue">
                <Input value={profile.techRider?.backlineNeeded || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, backlineNeeded: v })} placeholder="e.g. Drum kit only" />
              </Field>
              <Field label="Backline artist brings">
                <Input value={profile.techRider?.backlineBrings || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, backlineBrings: v })} placeholder="e.g. Fender Twin, pedalboard, keyboard" />
              </Field>
              <Field label="Minimum stage size">
                <Input value={profile.techRider?.stageSize || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, stageSize: v })} placeholder="e.g. 4m × 3m" />
              </Field>
            </View>

            {/* ── Hospitality ── */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Hospitality</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Meals required</Text>
                <Switch value={profile.techRiderBools?.mealsRequired || false} onValueChange={(v: boolean) => setRiderBool('mealsRequired', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              {profile.techRiderBools?.mealsRequired && (
                <Field label="Number of people">
                  <Input value={profile.techRider?.mealCount || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, mealCount: v })} placeholder="e.g. 5" keyboardType="numeric" />
                </Field>
              )}
              <Field label="Dietary requirements">
                <Input value={profile.techRider?.dietaryReqs || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, dietaryReqs: v })} placeholder="e.g. 1 vegan, 1 gluten-free" />
              </Field>
              <Field label="Drinks / refreshments">
                <Input value={profile.techRider?.drinks || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, drinks: v })} placeholder="e.g. Water + 2 beers per band member" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Green room / private space required</Text>
                <Switch value={profile.techRiderBools?.greenRoom || false} onValueChange={(v: boolean) => setRiderBool('greenRoom', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Parking / loading dock access needed</Text>
                <Switch value={profile.techRiderBools?.parking || false} onValueChange={(v: boolean) => setRiderBool('parking', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
            </View>

            {/* ── Technical / Production ── */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Technical / Production</Text>
              <Field label="Set length">
                <Input value={profile.techRider?.setLength || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, setLength: v })} placeholder="e.g. 45 minutes" />
              </Field>
              <Field label="Soundcheck time required">
                <Input value={profile.techRider?.soundcheck || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, soundcheck: v })} placeholder="e.g. 30 minutes" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Touring with own PA / sound engineer</Text>
                <Switch value={profile.techRiderBools?.ownPA || false} onValueChange={(v: boolean) => setRiderBool('ownPA', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <Field label="Lighting requirements (optional)">
                <Input value={profile.techRider?.lighting || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, lighting: v })} placeholder="e.g. Standard stage wash is fine" />
              </Field>
              <Field label="Power requirements">
                <Input value={profile.techRider?.power || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, power: v })} placeholder="e.g. 4 x 10A power outlets" />
              </Field>
            </View>

            {/* ── Logistics ── */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Logistics</Text>
              <Field label="Load-in time needed">
                <Input value={profile.techRider?.loadIn || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, loadIn: v })} placeholder="e.g. 1 hour before doors" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Merch table required</Text>
                <Switch value={profile.techRiderBools?.merchTable || false} onValueChange={(v: boolean) => setRiderBool('merchTable', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Accommodation required</Text>
                <Switch value={profile.techRiderBools?.accommodation || false} onValueChange={(v: boolean) => setRiderBool('accommodation', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
            </View>

            {/* ── Notes ── */}
            <Field label="Additional notes">
              <Input value={profile.techRider?.notes || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, notes: v })} placeholder="Anything else the venue's sound team should know" multiline />
            </Field>
          </View>
        )}

        {/* ── PAYMENT ── */}
        {activeTab === 'Payment' && (
          <View style={s.section}>

            {/* Payment Preferences */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Preferences</Text>
              <Field label="Preferred Payment Method/s">
                <Pills options={ARTIST_PAY_METHODS} value={profile.payment.methods} onSelect={(v: string[]) => setPayment('methods', v)} multi />
              </Field>
              <Field label="Typical Fee Expectation">
                <Input value={profile.payment.typicalFee} onChangeText={(v: string) => setPayment('typicalFee', v)} placeholder="e.g. $200-$400, or negotiable for door deals" />
              </Field>
              <Field label="Minimum Fee (optional)">
                <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                  <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                  <TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.payment.minimumFee} onChangeText={(v: string) => setPayment('minimumFee', v)} placeholder="Floor rate" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                </View>
              </Field>
            </View>

            {/* Tax & Invoicing */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Tax and Invoicing</Text>
              <Field label="ABN">
                <Input value={profile.payment.abn} onChangeText={(v: string) => setPayment('abn', v)} placeholder="e.g. 12 345 678 901" keyboardType="numeric" />
              </Field>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>GST Registered</Text>
                <Switch value={profile.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Can Provide Invoice</Text>
                <Switch value={profile.payment.canProvideInvoice} onValueChange={(v: boolean) => setPayment('canProvideInvoice', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              <Field label="Business / Invoicing Name">
                <Input value={profile.payment.invoicingName} onChangeText={(v: string) => setPayment('invoicingName', v)} placeholder="If different from your stage name" />
              </Field>
            </View>

            {/* Payment Logistics */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Logistics</Text>
              <Field label="Payment Timing Expectation">
                <Pills options={ARTIST_PAY_TIMING} value={profile.payment.timing} onSelect={(v: string) => setPayment('timing', v)} />
              </Field>
              {profile.payment.timing === 'Other' && (
                <Field label="Timing Details">
                  <Input value={profile.payment.timingOther} onChangeText={(v: string) => setPayment('timingOther', v)} placeholder="e.g. invoice within 14 days of performance" />
                </Field>
              )}
              <Field label="Bank Transfer">
                <Text style={{ fontSize: 12, color: Colors.grey, marginBottom: 8, lineHeight: 17 }}>BSB and account numbers are not stored here. Once a booking is confirmed, exchange bank details directly through the Twaylo message thread.</Text>
                <Input value={profile.payment.bankTransferNote} onChangeText={(v: string) => setPayment('bankTransferNote', v)} placeholder="e.g. Bank transfer details provided on confirmation" />
              </Field>
            </View>

            {/* Legal / Compliance */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Legal and Compliance</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Public Liability Insurance Held</Text>
                <Switch value={profile.payment.publicLiabilityHeld} onValueChange={(v: boolean) => setPayment('publicLiabilityHeld', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
              {profile.payment.publicLiabilityHeld && (
                <Field label="Coverage Amount (optional)">
                  <View style={[s.prefixInput, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                    <Text style={[s.prefixSymbol, { color: colors.grey }]}>$</Text>
                    <TextInput style={[s.prefixTextInput, { color: colors.black }]} value={profile.payment.publicLiabilityCoverage} onChangeText={(v: string) => setPayment('publicLiabilityCoverage', v)} placeholder="e.g. 10,000,000" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                  </View>
                </Field>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={{ fontSize: 14, color: colors.black }}>Certificate of Insurance Available on Request</Text>
                <Switch value={profile.payment.insuranceCertAvailable} onValueChange={(v: boolean) => setPayment('insuranceCertAvailable', v)} trackColor={{ false: colors.border, true: Colors.orange }} thumbColor="#fff" />
              </View>
            </View>

            {/* Notes */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment Notes</Text>
              <Input value={profile.payment.paymentNotes} onChangeText={(v: string) => setPayment('paymentNotes', v)} placeholder="e.g. Happy to discuss door splits for original shows. Invoice required for corporate bookings." multiline />
            </View>

          </View>
        )}

        {/* ── PHOTOS ── */}
        {activeTab === 'Photos' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Photo Gallery</Text>
            <View style={s.photoGrid}>
              {profile.photos.map((url, i) => (
                <View key={i} style={s.photoItem}>
                  <Image source={{ uri: url }} style={s.photoImg} />
                  <TouchableOpacity style={s.photoRemove} onPress={() => set('photos', profile.photos.filter((_, idx) => idx !== i))}>
                    <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <TouchableOpacity style={s.addBtn} onPress={addGalleryPhoto}>
              <Text style={s.addBtnText}>+ Add Photo</Text>
            </TouchableOpacity>
          </View>
        )}

        </View>
      </ScrollView>

      {/* ── Mobile onboarding overlay ── */}
      {onboardingStep >= 1 && onboardingStep <= 10 && (() => {
        const data = ONBOARDING_DATA[onboardingStep];
        const isFirst = onboardingStep === 1;
        return (
          <Modal visible transparent animationType="slide">
            <View style={s.mobileOnboardingOverlay}>
              <View style={[s.mobileOnboardingCard, { backgroundColor: colors.bg }]}>
                <View style={epd.onboardingStepRow}>
                  <Text style={epd.onboardingStepLabel}>STEP {onboardingStep} OF 10</Text>
                  <TouchableOpacity onPress={skipOnboarding}><Text style={epd.onboardingSkip}>Skip setup</Text></TouchableOpacity>
                </View>
                <View style={[epd.onboardingProgress, { marginBottom: 16 }]}>
                  <View style={[epd.onboardingProgressFill, { width: `${(onboardingStep / 10) * 100}%` as any }]} />
                </View>
                <Text style={[epd.onboardingTitle, { color: colors.black }]}>{data.title}</Text>
                <Text style={epd.onboardingBody}>{data.body}</Text>
                {data.body2 && <Text style={[epd.onboardingBody, { marginTop: 8 }]}>{data.body2}</Text>}
                {data.fieldsLabel && data.fields && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={epd.onboardingFieldsLabel}>{data.fieldsLabel}</Text>
                    {data.fields.map((f, i) => (
                      <View key={i} style={epd.onboardingBulletRow}>
                        <View style={epd.onboardingBulletDot} />
                        <Text style={epd.onboardingBulletText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={[epd.onboardingBtns, { marginTop: 20 }]}>
                  <TouchableOpacity style={epd.onboardingNextBtn} onPress={onboardingStep === 10 ? finishOnboarding : advanceOnboarding}>
                    <Text style={epd.onboardingNextBtnText}>{data.nextLabel}</Text>
                  </TouchableOpacity>
                  {!isFirst && (
                    <TouchableOpacity onPress={backOnboarding} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                      <Text style={epd.onboardingBackText}>Back</Text>
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
  safe:               { flex: 1, backgroundColor: Colors.bg },
  titleBar:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  headerBtns:         { flexDirection: 'row', gap: 8, alignItems: 'center' },
  backBtnInline:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  backBtnInlineText:  { fontSize: 14, fontWeight: '600' },
  headerTitle:        { fontSize: 18, fontWeight: '800', color: Colors.black, letterSpacing: -0.2 },
  headerSub:          { fontSize: 13, color: Colors.grey },
  saveBtn:            { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText:        { fontSize: 14, fontWeight: '700', color: Colors.black },
  tabErrors:          { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 10, paddingHorizontal: 16, backgroundColor: 'rgba(233,69,96,0.06)', borderBottomWidth: 1, borderBottomColor: 'rgba(233,69,96,0.2)' },
  tabErrorsLabel:     { fontSize: 12, fontWeight: '700', color: Colors.danger },
  tabErrorPill:       { fontSize: 12, fontWeight: '700', color: Colors.danger, borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  tabBar:             { borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.bg, flexGrow: 0 },
  tabBarContent:      { paddingHorizontal: 12 },
  tab:                { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive:          { borderBottomColor: Colors.orange },
  tabText:            { fontSize: 13, color: Colors.grey, fontWeight: '500' },
  tabTextActive:      { color: Colors.orange, fontWeight: '700' },
  body:               { padding: 20, paddingHorizontal: Platform.OS === 'web' ? 40 : 20, paddingTop: 24, paddingBottom: 60 },
  banner:             { width: '100%', height: 220, overflow: 'hidden', backgroundColor: Colors.bgFaint },
  bannerError:        { borderWidth: 2, borderColor: Colors.danger },
  bannerImg:          { width: '100%', height: '100%' },
  bannerPlaceholder:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { fontSize: 14, color: Colors.greyLight },
  bannerEditBadge:    { position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  bannerEditBadgeText:{ color: '#fff', fontSize: 12, fontWeight: '600' },
  section:            { gap: 4 },
  sectionBlock:       { paddingVertical: 20, borderTopWidth: 1, borderTopColor: 'transparent' },
  sectionBox:         { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  prefixInput:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  prefixSymbol:       { fontSize: 14, fontWeight: '600', marginRight: 4 },
  prefixTextInput:    { flex: 1, fontSize: 14, padding: 0 },
  sectionTitle:       { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginBottom: 16 },
  hint:               { fontSize: 13, color: Colors.grey, fontStyle: 'italic', marginBottom: 12 },
  input:              { backgroundColor: Colors.bgFaint, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.black },
  textarea:           { minHeight: 120, textAlignVertical: 'top' },
  inputError:         { borderColor: Colors.danger, backgroundColor: 'rgba(233,69,96,0.04)' },
  pill:               { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillActive:         { borderColor: Colors.orange, backgroundColor: 'rgba(250,131,12,0.08)' },
  pillText:           { fontSize: 13, color: Colors.grey },
  pillTextActive:     { color: Colors.orange, fontWeight: '700' },
  toggleRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  toggleLabel:        { fontSize: 14, color: Colors.black, flex: 1 },
  card:               { backgroundColor: Colors.bgFaint, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 12 },
  cardError:          { borderColor: Colors.danger },
  addBtn:             { borderWidth: 1, borderColor: 'rgba(250,131,12,0.4)', borderStyle: 'dashed', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  addBtnText:         { fontSize: 14, color: Colors.orange, fontWeight: '600' },
  removeBtn:          { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, alignItems: 'center' as const },
  removeBtnText:      { fontSize: 13, color: Colors.grey },
  itemBtnRow:         { flexDirection: 'row', gap: 8, marginTop: 8 },
  itemSaveBtn:        { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, padding: 10, alignItems: 'center' },
  itemSaveBtnText:    { fontSize: 13, color: Colors.black, fontWeight: '600' },
  removeInlineBtn:    { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexShrink: 0 },
  removeInlineBtnText:{ fontSize: 12, color: Colors.grey },
  photoGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  photoItem:          { width: '47%', aspectRatio: 4/3, borderRadius: 10, overflow: 'hidden' },
  photoImg:           { width: '100%', height: '100%' },
  photoRemove:        { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Checkbox row
  checkRow:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  checkbox:           { width: 20, height: 20, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxChecked:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkmark:          { fontSize: 13, color: '#fff', fontWeight: '700', lineHeight: 16 },
  checkLabel:         { fontSize: 14, flex: 1 },
  // Danger zone
  dangerSection:      { marginTop: 32, borderWidth: 1, borderRadius: 12, padding: 16 },
  dangerTitle:        { fontSize: 11, fontWeight: '700', color: Colors.danger, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  dangerDesc:         { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  dangerBtn:          { borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 18, alignSelf: 'flex-start', opacity: 0.5 },
  dangerBtnActive:    { opacity: 1 },
  dangerBtnText:      { fontSize: 14, fontWeight: '600', color: Colors.danger },
  // Mobile onboarding modal
  mobileOnboardingOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  mobileOnboardingCard:    { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 } },
});

const epd = StyleSheet.create({
  row:           { flex: 1, flexDirection: 'row' },
  sidebar:       { width: 224, borderRightWidth: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  photoWrap:     { marginBottom: 14 },
  photo:         { width: 72, height: 72, borderRadius: 8 },
  name:          { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, marginBottom: 3 },
  handle:        { fontSize: 12, marginBottom: 16 },
  divider:       { height: 1, marginVertical: 18 },
  navItem:       { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 7, marginBottom: 2 },
  navItemActive: { backgroundColor: Colors.orange + '18' },
  navRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navText:       { fontSize: 14, fontWeight: '600' },
  navErrorDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.danger },
  navCheck:      { fontSize: 13, color: Colors.orange, fontWeight: '700' },
  saveBtn:       { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  saveBtnText:   { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  backBtn:       { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  backBtnText:   { fontSize: 13, fontWeight: '600' },
  main:          { flex: 1 },
  mainContent:   { paddingHorizontal: 40, paddingVertical: 32, paddingBottom: 60 },
  // Onboarding panel (right column, steps 2-8)
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
  // Go Live card (step 10, bottom-left)
  goLiveCard:           { position: 'absolute', bottom: 32, left: 244, zIndex: 100 },
  goLiveCardInner:      { width: 320, borderRadius: 14, padding: 24, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  // Replay button (bottom-right)
  replayBtn:            { position: 'absolute', bottom: 24, right: 24, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, zIndex: 50 },
  replayBtnText:        { fontSize: 13, fontWeight: '600', color: '#ffffff' },
});
