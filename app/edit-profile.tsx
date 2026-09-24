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
import { signOut, deleteUser, sendPasswordResetEmail } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { RepositionablePhoto } from '@/components/RepositionablePhoto';
import { CalendarSync } from '@/components/CalendarSync';

// ── Constants ────────────────────────────────────────────────────────────
const GENRES = ['Rock','Indie','Pop','Punk','Metal','Jazz','Blues','Soul / R&B','Funk','Hip-hop','Electronic','Country','Folk','Reggae','Classical','Other'];
const ACT_TYPES = ['Solo artist','Duo','Trio','Band','DJ','Other'];
const SET_LENGTHS = ['30 min','45 min','60 min','90 min','2 × 45 min','3 × 45 min'];
const AGE_OPTS = ['All ages','18+ only','Both'];
const SET_TYPE_OPTS = ['Originals','Covers','Mixed'];
const INSTRUMENT_SUGGESTIONS = ['Vocals','Guitar (acoustic)','Guitar (electric)','Bass','Drums','Keys / piano','Violin / strings','Saxophone','Trumpet / brass','Trombone','Harmonica','Banjo / mandolin','Ukulele','Cello','Flute','Synth / sampler','Turntables / CDJs','Percussion'];
const AVERAGE_DRAW_OPTS = ['Under 25','25-50','50-100','100-250','250+'];
const TRAVEL_OPTS = ['Local (within 30 km)','Up to 100 km','Anywhere in my state','Interstate'];
const MONITORING_OPTS = ['Wedges','In-ears','Both','Not needed'];
const BACKLINE_NEEDED_OPTS = ['PA system','Stage monitors','Microphones + stands','Drum kit','Bass amp','Guitar amp','Keys stand','DI boxes','Lighting'];
const BACKLINE_BRING_OPTS = ['Drum kit','Cymbals','Bass amp','Guitar amp','Keys','Pedalboards','In-ear rig','Own mics'];
const COVERAGE_OPTS = ['$5 million','$10 million','$20 million','Other'];
const LOAD_IN_OPTS = ['30 min before doors','1 hour before doors','2 hours before doors','Other'];
const SOUNDCHECK_OPTS = ['15 min','30 min','45 min','60 min','Other'];
const MEAL_COUNT_OPTS = ['1','2','3','4','5','6','7','8','9','10'];
const PAY_METHODS = ['Bank transfer','Cash','PayPal','Stripe','Other'];
const PAY_TIMING = ['On the night','7 days after','14 days after','30 days after','Other'];

const NAV_GROUPS = [
  { label: 'PROFILE', tabs: ['Basic info','About','Music','Photos'] },
  { label: 'BOOKING',  tabs: ['Rates & reach','Tech rider','Hospitality'] },
  { label: 'ACCOUNT',  tabs: ['Invoicing','Settings'] },
];
const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs);

// ── Types ─────────────────────────────────────────────────────────────────
type Song    = { title: string; url: string; notes: string };
type Member  = { name: string; role: string };
type Channel = { source: string; micDi: string };

type ArtistPayment = {
  methods: string[]; abn: string; gstRegistered: boolean;
  canProvideInvoice: boolean; invoicingName: string;
  timing: string; timingOther: string; paymentNotes: string;
  publicLiabilityHeld: boolean; publicLiabilityCoverage: string; insuranceCertAvailable: boolean;
};

type Hospitality = {
  mealsRequired: boolean; mealCount: string; dietaryReqs: string; drinks: string;
  greenRoom: boolean; merchTable: boolean; parkingLoading: string; accommodation: boolean;
};

type Profile = {
  name: string; username: string; artistType: string; otherArtistType: string;
  genre: string[]; otherGenres: string; instruments: string[];
  location: string; email: string; phone: string;
  feeMin: string; feeMax: string; averageDraw: string; travel: string;
  memberCount: string; members: Member[]; formed: string;
  setType: string; ageRestriction: string; setLengths: string[];
  about: string; photoUrl: string; photoPosition: { x: number; y: number };
  instagram: string; tiktok: string; spotify: string; appleMusic: string; youtube: string;
  customLinks: { label: string; url: string }[];
  songs: Song[]; photos: string[]; videos: string[];
  techRider: Record<string, string>;
  techRiderDocs: { url: string; name: string }[];
  techRiderBools: Record<string, boolean>;
  inputChannels: Channel[];
  backlineFromVenue: string[]; backlineBring: string[];
  hospitality: Hospitality;
  payment: ArtistPayment;
  settings: { emailOnEnquiryResponse: boolean; emailOnNewMessages: boolean; emailOnNewConnection: boolean; listed: boolean };
};

const BLANK_PAYMENT: ArtistPayment = {
  methods: [], abn: '', gstRegistered: false, canProvideInvoice: false,
  invoicingName: '', timing: '', timingOther: '', paymentNotes: '',
  publicLiabilityHeld: false, publicLiabilityCoverage: '', insuranceCertAvailable: false,
};
const BLANK_HOSP: Hospitality = {
  mealsRequired: false, mealCount: '', dietaryReqs: '', drinks: '',
  greenRoom: false, merchTable: false, parkingLoading: '', accommodation: false,
};
const BLANK: Profile = {
  name: '', username: '', artistType: '', otherArtistType: '', genre: [], otherGenres: '',
  instruments: [], location: '', email: '', phone: '',
  feeMin: '', feeMax: '', averageDraw: '', travel: '',
  memberCount: '', members: [], formed: '',
  setType: '', ageRestriction: '', setLengths: [],
  about: '', photoUrl: '', photoPosition: { x: 50, y: 50 },
  instagram: '', tiktok: '', spotify: '', appleMusic: '', youtube: '',
  customLinks: [], songs: [], photos: [], videos: [],
  techRider: {}, techRiderDocs: [], techRiderBools: {},
  inputChannels: [], backlineFromVenue: [], backlineBring: [],
  hospitality: { ...BLANK_HOSP },
  payment: { ...BLANK_PAYMENT },
  settings: { emailOnEnquiryResponse: true, emailOnNewMessages: true, emailOnNewConnection: false, listed: true },
};

const STEP_TAB: Record<number, string | null> = {
  1: null, 2: 'Basic info', 3: 'About', 4: 'Music',
  5: 'Tech rider', 6: 'Invoicing', 7: 'Photos', 8: null, 9: null, 10: 'Photos',
};

// ── Shared helpers ────────────────────────────────────────────────────────
function detectPlatform(url: string): string {
  if (!url) return '';
  if (url.includes('spotify.com')) return 'Spotify';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('soundcloud.com')) return 'SoundCloud';
  if (url.includes('bandcamp.com')) return 'Bandcamp';
  if (url.includes('music.apple.com')) return 'Apple Music';
  return 'Link';
}

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

// ── SuburbSearch ──────────────────────────────────────────────────────────
function SuburbSearch({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const { colors } = useTheme();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AreaResult[]>([]);
  const [open, setOpen] = useState(false);

  async function handleChange(text: string) {
    setQuery(text);
    onChange(text);
    if (text.length >= 2) {
      const r = await searchSuburbs(text);
      setResults(r);
      setOpen(r.length > 0);
    } else {
      setOpen(false);
    }
  }
  function select(r: AreaResult) {
    setQuery(r.label);
    onChange(r.label);
    setOpen(false);
  }
  return (
    <View>
      <TextInput
        style={[sh.input, { backgroundColor: colors.bgFaint, borderColor: error ? Colors.danger : colors.border, color: colors.black }]}
        value={query}
        onChangeText={handleChange}
        placeholder="Suburb, State, Postcode"
        placeholderTextColor={Colors.greyLight}
        autoCapitalize="words"
      />
      {open && (
        <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 4, overflow: 'hidden', zIndex: 999 }}>
          {results.map((r, i) => (
            <TouchableOpacity key={i} onPress={() => select(r)} style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: i < results.length - 1 ? 1 : 0, borderBottomColor: colors.borderFaint }}>
              <Text style={{ fontSize: 14, color: colors.black }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── FieldRow ──────────────────────────────────────────────────────────────
function FieldRow({ label, sublabel, children, last, error }: { label: string; sublabel?: string; children: React.ReactNode; last?: boolean; error?: boolean }) {
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

// ── SectionCard ───────────────────────────────────────────────────────────
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
  card:     { borderWidth: 1, borderRadius: 12, marginBottom: 16 },
  header:   { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  title:    { fontSize: 14, fontWeight: '700', letterSpacing: -0.1 },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 2 },
});

// ── Input ─────────────────────────────────────────────────────────────────
function Input({ value, onChangeText, placeholder, multiline, keyboardType, error, secureTextEntry }: any) {
  const { colors } = useTheme();
  return (
    <TextInput
      style={[sh.input, multiline && sh.textarea, { backgroundColor: colors.bgFaint, borderColor: error ? Colors.danger : colors.border, color: colors.black }]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={Colors.greyLight}
      multiline={multiline}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      textAlignVertical={multiline ? 'top' : 'center'}
    />
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────
function Pills({ options, value, onSelect, multi, max }: { options: string[]; value: string | string[]; onSelect: (v: any) => void; multi?: boolean; max?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const active = multi ? (value as string[]).includes(opt) : value === opt;
        const atMax = multi && max != null && (value as string[]).length >= max && !active;
        return (
          <TouchableOpacity
            key={opt}
            disabled={atMax}
            style={[sh.pill, { borderColor: active ? colors.black : colors.border, backgroundColor: active ? colors.black : 'transparent' }]}
            onPress={() => {
              if (multi) {
                const arr = value as string[];
                onSelect(active ? arr.filter(x => x !== opt) : [...arr, opt]);
              } else {
                onSelect(opt);
              }
            }}
          >
            <Text style={[sh.pillText, { color: active ? '#fff' : colors.black, opacity: atMax ? 0.4 : 1 }]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── TagInput ──────────────────────────────────────────────────────────────
function TagInput({ tags, suggestions, onChange, placeholder }: { tags: string[]; suggestions: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const { colors } = useTheme();
  const filtered = suggestions.filter(s => !tags.includes(s) && s.toLowerCase().includes(search.toLowerCase()));
  const showDrop = focused && (filtered.length > 0 || search.trim().length > 0);

  function addTag(tag: string) {
    const t = tag.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setSearch('');
  }

  return (
    <View style={[ti.container, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      {tags.length > 0 && (
        <View style={ti.tagsRow}>
          {tags.map(tag => (
            <View key={tag} style={[ti.tag, { backgroundColor: colors.black }]}>
              <Text style={ti.tagText}>{tag}</Text>
              <TouchableOpacity onPress={() => onChange(tags.filter(t => t !== tag))}>
                <Text style={ti.tagX}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <TextInput
        style={[ti.input, { color: colors.black }]}
        value={search}
        onChangeText={setSearch}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder || 'Search instruments'}
        placeholderTextColor={Colors.greyLight}
        onSubmitEditing={() => { if (search.trim()) addTag(search); }}
        returnKeyType="done"
      />
      {showDrop && (
        <View style={[ti.drop, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          {filtered.slice(0, 8).map(s => (
            <TouchableOpacity key={s} onPress={() => addTag(s)} style={[ti.dropItem, { borderBottomColor: colors.borderFaint }]}>
              <Text style={{ fontSize: 14, color: colors.black }}>{s}</Text>
            </TouchableOpacity>
          ))}
          {search.trim() && !suggestions.includes(search.trim()) && !tags.includes(search.trim()) && (
            <TouchableOpacity onPress={() => addTag(search)} style={[ti.dropItem, { borderBottomColor: colors.borderFaint }]}>
              <Text style={{ fontSize: 14, color: Colors.orange }}>Add "{search.trim()}"</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
const ti = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 10, overflow: 'visible' },
  tagsRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 10, paddingBottom: 4 },
  tag:       { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingVertical: 4, paddingLeft: 10, paddingRight: 8, gap: 4 },
  tagText:   { fontSize: 13, color: '#fff', fontWeight: '500' },
  tagX:      { fontSize: 16, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  input:     { paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  drop:      { borderTopWidth: 1, maxHeight: 240 },
  dropItem:  { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1 },
});

// ── SelectField ───────────────────────────────────────────────────────────
function SelectField({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();

  if (Platform.OS === 'web') {
    return (
      <View style={[sel.btn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <select
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          style={{ flex: 1, fontSize: 14, color: value ? (colors.black as string) : (Colors.greyLight as string), backgroundColor: 'transparent', border: 'none', outline: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' } as any}
        >
          {!value && <option value="">{placeholder || 'Select'}</option>}
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={[sel.btn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight, flex: 1 }}>{value || placeholder || 'Select'}</Text>
        <Text style={{ fontSize: 10, color: colors.grey }}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[sel.modal, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <ScrollView>
              {options.map(opt => (
                <TouchableOpacity key={opt} onPress={() => { onChange(opt); setOpen(false); }} style={[sel.option, { borderBottomColor: colors.borderFaint }]}>
                  <Text style={[{ fontSize: 15, color: colors.black }, opt === value && { fontWeight: '700', color: Colors.orange }]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const sel = StyleSheet.create({
  btn:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  modal:  { width: 300, maxHeight: 400, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  option: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
});

// ── Shared styles ─────────────────────────────────────────────────────────
const sh = StyleSheet.create({
  input:    { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  pill:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 13, fontWeight: '500' },
});

// ═══════════════════════════════════════════════════════════════════════════
export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { uid: uidParam, tab: tabParam } = useLocalSearchParams<{ uid?: string; tab?: string }>();
  const uid = uidParam ?? user?.uid ?? '';
  const originalUsername = useRef('');

  const [profile,  setProfile]  = useState<Profile>(BLANK);
  const [saved,    setSaved]    = useState<Profile>(BLANK);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [activeTab, setActiveTab] = useState(tabParam || 'Basic info');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors,  setTabErrors]  = useState<string[]>([]);
  const [photoUploading,     setPhotoUploading]     = useState(false);
  const [docUploading,       setDocUploading]       = useState(false);
  const [stagePlotUploading, setStagePlotUploading] = useState(false);
  const [inputListUploading, setInputListUploading] = useState(false);
  const [onboardingStep,     setOnboardingStep]     = useState(0);
  const [onboardingVisited,  setOnboardingVisited]  = useState<string[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [bannerDismissed,    setBannerDismissed]    = useState(false);
  const [mobileShowList,     setMobileShowList]     = useState(true);

  const isWeb = Platform.OS === 'web';
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;

  const hasUnsaved = JSON.stringify(profile) !== JSON.stringify(saved);

  // ── Load ────────────────────────────────────────────────────────────────
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
      d.songs            = d.songs            || [];
      d.photos           = d.photos           || [];
      d.videos           = d.videos           || [];
      d.members          = d.members          || [];
      d.inputChannels    = d.inputChannels    || [];
      d.backlineFromVenue= d.backlineFromVenue|| [];
      d.backlineBring    = d.backlineBring    || [];
      d.setLengths       = d.setLengths       || [];
      d.customLinks      = d.customLinks      || [];
      d.techRiderDocs    = d.techRiderDocs    || [];
      d.techRiderBools   = d.techRiderBools   || {};
      d.techRider        = d.techRider        || {};
      d.settings         = { ...BLANK.settings,  ...(d.settings   || {}) };
      d.hospitality      = { ...BLANK_HOSP,       ...(d.hospitality|| {}) };
      d.payment          = { ...BLANK_PAYMENT,    ...(d.payment    || {}) };
      originalUsername.current = d.username || '';
      setProfile(d); setSaved(d);
      const isComplete = raw.onboardingComplete === true;
      setOnboardingComplete(isComplete);
      if (!isComplete) setOnboardingStep(1);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [uid]);

  // clear justSaved when edits are made
  useEffect(() => { if (hasUnsaved) setJustSaved(false); }, [hasUnsaved]);

  // ── Setters ──────────────────────────────────────────────────────────────
  function set<K extends keyof Profile>(field: K, value: Profile[K]) {
    setProfile(prev => ({ ...prev, [field]: value }));
  }
  function setPayment<K extends keyof ArtistPayment>(field: K, value: ArtistPayment[K]) {
    setProfile(prev => ({ ...prev, payment: { ...prev.payment, [field]: value } }));
  }
  function setHosp<K extends keyof Hospitality>(field: K, value: Hospitality[K]) {
    setProfile(prev => ({ ...prev, hospitality: { ...prev.hospitality, [field]: value } }));
  }
  function setRider(field: string, value: string) {
    setProfile(prev => ({ ...prev, techRider: { ...prev.techRider, [field]: value } }));
  }
  function setRiderBool(field: string, value: boolean) {
    setProfile(prev => ({ ...prev, techRiderBools: { ...prev.techRiderBools, [field]: value } }));
  }
  function setSong(i: number, field: keyof Song, val: string) {
    setProfile(prev => ({ ...prev, songs: prev.songs.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }));
  }
  function addSong()         { setProfile(prev => ({ ...prev, songs: [...prev.songs, { title: '', url: '', notes: '' }] })); }
  function removeSong(i: number) { setProfile(prev => ({ ...prev, songs: prev.songs.filter((_, idx) => idx !== i) })); }

  function addMember()       { setProfile(prev => ({ ...prev, members: [...prev.members, { name: '', role: '' }] })); }
  function removeMember(i: number) { setProfile(prev => ({ ...prev, members: prev.members.filter((_, idx) => idx !== i) })); }
  function setMember(i: number, field: keyof Member, val: string) {
    setProfile(prev => ({ ...prev, members: prev.members.map((m, idx) => idx === i ? { ...m, [field]: val } : m) }));
  }

  function addChannel()      { setProfile(prev => ({ ...prev, inputChannels: [...prev.inputChannels, { source: '', micDi: '' }] })); }
  function removeChannel(i: number) { setProfile(prev => ({ ...prev, inputChannels: prev.inputChannels.filter((_, idx) => idx !== i) })); }
  function setChannel(i: number, field: keyof Channel, val: string) {
    setProfile(prev => ({ ...prev, inputChannels: prev.inputChannels.map((c, idx) => idx === i ? { ...c, [field]: val } : c) }));
  }

  // ── Uploads ───────────────────────────────────────────────────────────────
  async function pickBannerPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUploading(true);
    try {
      const uri  = result.assets[0].uri;
      const blob = await (await fetch(uri)).blob();
      const ref  = sRef(storage, `photos/bands/${uid}/photo`);
      await uploadBytes(ref, blob);
      set('photoUrl', await getDownloadURL(ref));
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setPhotoUploading(false); }
  }

  async function addGalleryPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true });
    if (result.canceled) return;
    setPhotoUploading(true);
    try {
      const urls: string[] = [];
      for (const asset of result.assets) {
        const blob = await (await fetch(asset.uri)).blob();
        const ref  = sRef(storage, `photos/bands/${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
        await uploadBytes(ref, blob);
        urls.push(await getDownloadURL(ref));
      }
      set('photos', [...profile.photos, ...urls].slice(0, 12));
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setPhotoUploading(false); }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setDocUploading(true);
    try {
      const asset = result.assets[0];
      const blob  = await (await fetch(asset.uri)).blob();
      const ref   = sRef(storage, `riders/${uid}/${Date.now()}.pdf`);
      await uploadBytes(ref, blob);
      set('techRiderDocs', [...(profile.techRiderDocs || []), { url: await getDownloadURL(ref), name: asset.name }]);
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setDocUploading(false); }
  }

  async function pickInputList() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setInputListUploading(true);
    try {
      const asset = result.assets[0];
      const ext   = asset.name.split('.').pop() || 'pdf';
      const blob  = await (await fetch(asset.uri)).blob();
      const ref   = sRef(storage, `riders/${uid}/input-list.${ext}`);
      await uploadBytes(ref, blob);
      setRider('inputListUrl',  await getDownloadURL(ref));
      setRider('inputListName', asset.name);
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setInputListUploading(false); }
  }

  async function pickStagePlot() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setStagePlotUploading(true);
    try {
      const blob = await (await fetch(result.assets[0].uri)).blob();
      const ref  = sRef(storage, `riders/${uid}/stage-plot-${Date.now()}.jpg`);
      await uploadBytes(ref, blob);
      setRider('stagePlotUrl', await getDownloadURL(ref));
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setStagePlotUploading(false); }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setShowErrors(true);
    const errors: string[] = [];
    if (!profile.name?.trim() || !profile.username?.trim() || !profile.artistType?.trim() ||
        (profile.artistType === 'Other' && !profile.otherArtistType?.trim()) ||
        !(profile.genre?.length > 0) || !profile.location?.trim() || !profile.email?.trim())
      errors.push('Basic info');
    if (!profile.about?.trim()) errors.push('About');
    if (profile.songs.some(s => !s.title?.trim() || !s.url?.trim())) errors.push('Music');
    if (errors.length > 0) { setTabErrors(errors); return; }
    setTabErrors([]);

    const newUsername = profile.username.trim().toLowerCase();
    if (newUsername !== originalUsername.current) {
      const [bpSnap, uSnap] = await Promise.all([
        getDocs(query(collection(db, 'bandProfiles'), where('username', '==', newUsername))),
        getDocs(query(collection(db, 'users'),        where('username', '==', newUsername))),
      ]);
      if (bpSnap.docs.some(d => d.id !== uid) || !uSnap.empty) {
        Alert.alert('Username taken', 'That username is already in use. Please choose another.');
        return;
      }
    }

    setSaving(true);
    try {
      const toNum = (v: string) => { const n = Number(v); return isNaN(n) || v === '' ? null : n; };
      const payload = { ...profile, username: newUsername, feeMin: toNum(profile.feeMin), feeMax: toNum(profile.feeMax), averageDraw: toNum(profile.averageDraw) };
      await setDoc(doc(db, 'bandProfiles', uid), payload, { merge: true });
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

  function handleDiscard() {
    setProfile(saved);
    setShowErrors(false);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace(`/musician/${uid}` as any);
  }

  function handleBack() {
    if (hasUnsaved) {
      crossConfirm('Unsaved changes', 'Any unsaved changes will be lost.', goBack, true);
      return;
    }
    goBack();
  }

  // ── Onboarding ────────────────────────────────────────────────────────────
  function advanceOnboarding() {
    if (onboardingStep === 10) { finishOnboarding(); return; }
    const curTab = STEP_TAB[onboardingStep];
    if (curTab) setOnboardingVisited(prev => prev.includes(curTab) ? prev : [...prev, curTab]);
    const next = onboardingStep + 1;
    const nextTab = STEP_TAB[next];
    if (nextTab && nextTab !== activeTab) { setActiveTab(nextTab); if (isMobileLayout) setMobileShowList(false); }
    setOnboardingStep(next);
  }
  function backOnboarding() {
    if (onboardingStep <= 1) return;
    const prev = onboardingStep - 1;
    const prevTab = STEP_TAB[prev];
    if (prevTab) { setActiveTab(prevTab); if (isMobileLayout) setMobileShowList(false); }
    setOnboardingStep(prev);
  }
  function skipOnboarding() {
    setOnboardingStep(0); setOnboardingComplete(true);
    updateDoc(doc(db, 'bandProfiles', uid), { onboardingComplete: true }).catch(() => {});
  }
  function finishOnboarding() {
    setOnboardingStep(0); setOnboardingComplete(true);
    updateDoc(doc(db, 'bandProfiles', uid), { onboardingComplete: true }).catch(() => {});
    handleSave();
  }

  // ── Completion ────────────────────────────────────────────────────────────
  const completionFields = [
    { label: 'Stage name',    done: !!profile.name?.trim() },
    { label: 'Genres',        done: profile.genre?.length > 0 },
    { label: 'Bio',           done: !!profile.about?.trim() },
    { label: 'Profile photo', done: !!profile.photoUrl },
    { label: 'Location',      done: !!profile.location?.trim() },
    { label: 'Music tracks',  done: profile.songs?.length > 0 },
    { label: 'Fee range',     done: !!profile.feeMin && !!profile.feeMax },
    { label: 'Average draw',  done: !!profile.averageDraw },
    { label: 'Travel',        done: !!profile.travel },
  ];
  const doneCount    = completionFields.filter(f => f.done).length;
  const completionPct= Math.round((doneCount / completionFields.length) * 100);
  const missingLabels= completionFields.filter(f => !f.done).map(f => f.label);

  // ── Renderers ──────────────────────────────────────────────────────────────

  function renderPageHeader(title: string, desc: string) {
    return (
      <View style={{ marginBottom: 20 }}>
        <Text style={[pd.pageTitle, { color: colors.black }]}>{title}</Text>
        <Text style={[pd.pageDesc, { color: colors.grey }]}>{desc}</Text>
      </View>
    );
  }

  function renderBasicInfo() {
    return (
      <View>
        {renderPageHeader('Basic info', 'The first thing venues see when they find you.')}

        <SectionCard title="Listing">
          <FieldRow label="Listed in Discover" sublabel="Venues can find you in search and send enquiries. Turn off to pause your listing without deleting anything." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch
                value={profile.settings.listed}
                onValueChange={async v => {
                  set('settings', { ...profile.settings, listed: v });
                  if (uid) await updateDoc(doc(db, 'bandProfiles', uid), { 'settings.listed': v }).catch(() => {});
                }}
                trackColor={{ false: '#e0e0e0', true: Colors.orange }}
                thumbColor="#fff"
              />
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Identity">
          <FieldRow label="Profile photo" sublabel="Square, at least 800 x 800px. Shown on enquiries and in search.">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {photoUploading
                ? <View style={pd.photoThumb}><ActivityIndicator color={Colors.orange} /></View>
                : profile.photoUrl
                  ? <Image source={{ uri: profile.photoUrl }} style={pd.photoThumb} resizeMode="cover" />
                  : <View style={[pd.photoThumb, { backgroundColor: colors.bgFaint, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 9, color: Colors.greyLight }}>photo</Text>
                    </View>
              }
              <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={pickBannerPhoto}>
                <Text style={[pd.outlineBtnText, { color: colors.black }]}>Replace</Text>
              </TouchableOpacity>
              {profile.photoUrl ? (
                <TouchableOpacity onPress={() => set('photoUrl', '')}>
                  <Text style={{ fontSize: 14, color: colors.grey }}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </FieldRow>
          <FieldRow label="Stage name" sublabel="How venues and fans see you." error={showErrors && !profile.name?.trim()}>
            <Input value={profile.name} onChangeText={(v: string) => set('name', v)} placeholder="The Dahlias" error={showErrors && !profile.name?.trim()} />
          </FieldRow>
          <FieldRow label="Username" sublabel="Your public profile link." error={showErrors && !profile.username?.trim()}>
            <View>
              <View style={[pd.prefixRow, { borderColor: showErrors && !profile.username?.trim() ? Colors.danger : colors.border, backgroundColor: colors.bgFaint }]}>
                <Text style={[pd.prefixText, { color: colors.grey }]}>twaylo.com.au/</Text>
                <TextInput
                  style={[pd.prefixInput, { color: colors.black }]}
                  value={profile.username}
                  onChangeText={(v: string) => set('username', v.toLowerCase().replace(/\s/g, ''))}
                  placeholder="yourname"
                  placeholderTextColor={Colors.greyLight}
                  autoCapitalize="none"
                />
              </View>
              {profile.username?.trim() && (
                <Text style={{ fontSize: 12, color: '#2F7A4B', marginTop: 4 }}>Available</Text>
              )}
            </View>
          </FieldRow>
          <FieldRow label="Act type" error={showErrors && !profile.artistType?.trim()}>
            <View style={{ gap: 8 }}>
              <Pills options={ACT_TYPES} value={profile.artistType} onSelect={(v: string) => set('artistType', v)} />
              {profile.artistType === 'Other' && (
                <Input value={profile.otherArtistType} onChangeText={(v: string) => set('otherArtistType', v)} placeholder="Describe your act, e.g. string quartet" error={showErrors && !profile.otherArtistType?.trim()} />
              )}
            </View>
          </FieldRow>
          <FieldRow label="Genres" sublabel="Pick up to 3. Used to match you with venues." error={showErrors && !(profile.genre?.length > 0)}>
            <View style={{ gap: 8 }}>
              <Pills options={GENRES} value={profile.genre} onSelect={(v: string[]) => set('genre', v)} multi max={3} />
              {profile.genre?.includes('Other') && (
                <Input value={profile.otherGenres} onChangeText={(v: string) => set('otherGenres', v)} placeholder="Your genre, e.g. surf rock" />
              )}
            </View>
          </FieldRow>
          <FieldRow label="Instruments" sublabel="What the act plays on stage." last>
            <TagInput tags={profile.instruments || []} suggestions={INSTRUMENT_SUGGESTIONS} onChange={(t: string[]) => set('instruments', t)} placeholder="Search instruments" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Your show" subtitle="What venues are booking. These answer the first questions most venues ask.">
          <FieldRow label="Set type">
            <Pills options={SET_TYPE_OPTS} value={profile.setType} onSelect={(v: string) => set('setType', v)} />
          </FieldRow>
          <FieldRow label="Age suitability" sublabel="Whether your show suits all-ages events.">
            <Pills options={AGE_OPTS} value={profile.ageRestriction} onSelect={(v: string) => set('ageRestriction', v)} />
          </FieldRow>
          <FieldRow label="Set lengths" sublabel="Every length you can play. You'll choose one when you enquire." last>
            <Pills options={SET_LENGTHS} value={profile.setLengths} onSelect={(v: string[]) => set('setLengths', v)} multi />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Contact" subtitle="Your suburb is shown on your profile. Email and phone are only shared with a venue once a booking is confirmed.">
          <FieldRow label="Location" sublabel="Your home base. Used for travel distance and local search." error={showErrors && !profile.location?.trim()}>
            <SuburbSearch value={profile.location} onChange={(v: string) => set('location', v)} error={showErrors && !profile.location?.trim()} />
          </FieldRow>
          <FieldRow label="Email" error={showErrors && !profile.email?.trim()}>
            <Input value={profile.email} onChangeText={(v: string) => set('email', v)} placeholder="you@example.com" keyboardType="email-address" error={showErrors && !profile.email?.trim()} />
          </FieldRow>
          <FieldRow label="Phone" sublabel="Optional. Never shown publicly." last>
            <View style={[pd.prefixRow, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[pd.prefixText, { color: colors.grey }]}>+61</Text>
              <TextInput style={[pd.prefixInput, { color: colors.black }]} value={profile.phone} onChangeText={(v: string) => set('phone', v)} placeholder="412 345 678" placeholderTextColor={Colors.greyLight} keyboardType="phone-pad" />
            </View>
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderAbout() {
    const memberCount = profile.members?.length || 0;
    const memberLabel = memberCount === 1 ? 'Solo' : memberCount > 1 ? `${memberCount}-piece` : '';
    return (
      <View>
        {renderPageHeader('About', 'Your story and who\'s on stage.')}

        <SectionCard title="Bio">
          <FieldRow label="Your story" sublabel="Two or three sentences: who you are, what you sound like, where you've played." last>
            <View>
              <TextInput
                style={[sh.input, sh.textarea, { backgroundColor: colors.bgFaint, borderColor: showErrors && !profile.about?.trim() ? Colors.danger : colors.border, color: colors.black, minHeight: 120 }]}
                value={profile.about}
                onChangeText={(v: string) => { if (v.length <= 600) set('about', v); }}
                placeholder="Four-piece indie rock band from the Mornington Peninsula..."
                placeholderTextColor={Colors.greyLight}
                multiline
                textAlignVertical="top"
                maxLength={600}
              />
              <Text style={{ fontSize: 12, color: colors.grey, textAlign: 'right', marginTop: 4 }}>{profile.about?.length || 0} / 600</Text>
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Line-up" right={memberLabel ? <Text style={{ fontSize: 13, color: colors.grey }}>{memberLabel}</Text> : undefined}>
          <FieldRow label="Members" sublabel="Your performer count is taken from this list and used in your tech and hospitality riders." last>
            <View style={{ gap: 8 }}>
              {(profile.members || []).map((m, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput
                    style={[sh.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
                    value={m.name}
                    onChangeText={(v: string) => setMember(i, 'name', v)}
                    placeholder="Name"
                    placeholderTextColor={Colors.greyLight}
                  />
                  <TextInput
                    style={[sh.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
                    value={m.role}
                    onChangeText={(v: string) => setMember(i, 'role', v)}
                    placeholder="Role"
                    placeholderTextColor={Colors.greyLight}
                  />
                  <TouchableOpacity onPress={() => removeMember(i)}>
                    <Text style={{ fontSize: 18, color: colors.grey, paddingHorizontal: 4 }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={[pd.addBtn, { borderColor: colors.border }]} onPress={addMember}>
                <Text style={{ fontSize: 14, color: colors.grey }}>+ Add member</Text>
              </TouchableOpacity>
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Formed">
          <FieldRow label="Year" sublabel="Optional." last>
            <Input value={profile.formed} onChangeText={(v: string) => set('formed', v)} placeholder="2021" keyboardType="numeric" />
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderMusic() {
    return (
      <View>
        {renderPageHeader('Music', 'Tracks venues can listen to before they book you.')}

        <SectionCard
          title="Tracks"
          subtitle="Your first track plays at the top of your profile. Live recordings help venues most."
          right={
            <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={addSong}>
              <Text style={[pd.outlineBtnText, { color: colors.black }]}>+ Add track</Text>
            </TouchableOpacity>
          }
        >
          <View style={{ paddingBottom: 8 }}>
            {profile.songs.length === 0 && (
              <Text style={{ fontSize: 14, color: colors.grey, padding: 16 }}>No tracks added yet.</Text>
            )}
            {profile.songs.map((song, i) => {
              const badge = detectPlatform(song.url);
              const hasErr = showErrors && (!song.title?.trim() || !song.url?.trim());
              return (
                <View key={i} style={[pd.trackRow, { borderBottomColor: colors.border }, i === profile.songs.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={[pd.trackNum, { color: colors.grey }]}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput
                        style={[sh.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: hasErr && !song.title?.trim() ? Colors.danger : colors.border, color: colors.black }]}
                        value={song.title}
                        onChangeText={v => setSong(i, 'title', v)}
                        placeholder="Song title"
                        placeholderTextColor={Colors.greyLight}
                      />
                      <View style={{ flexDirection: 'row', flex: 1, gap: 6, alignItems: 'center' }}>
                        <TextInput
                          style={[sh.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: hasErr && !song.url?.trim() ? Colors.danger : colors.border, color: colors.black }]}
                          value={song.url}
                          onChangeText={v => setSong(i, 'url', v)}
                          placeholder="https://open.spotify.com/..."
                          placeholderTextColor={Colors.greyLight}
                          autoCapitalize="none"
                        />
                        {badge ? <View style={[pd.badge, { borderColor: colors.border }]}><Text style={{ fontSize: 11, color: colors.grey, fontWeight: '600' }}>{badge}</Text></View> : null}
                      </View>
                    </View>
                    <TextInput
                      style={[sh.input, { backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]}
                      value={song.notes}
                      onChangeText={v => setSong(i, 'notes', v)}
                      placeholder="Notes (optional), e.g. live recording, our most-requested song"
                      placeholderTextColor={Colors.greyLight}
                    />
                  </View>
                  <TouchableOpacity onPress={() => removeSong(i)} style={{ paddingLeft: 4 }}>
                    <Text style={{ fontSize: 18, color: colors.grey }}>×</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderPhotos() {
    return (
      <View>
        {renderPageHeader('Photos', 'Your cover photo and gallery.')}

        <SectionCard title="Cover photo" subtitle="The wide banner across the top of your profile.">
          <View style={{ padding: 16 }}>
            <RepositionablePhoto
              uri={profile.photoUrl || null}
              position={profile.photoPosition ?? { x: 50, y: 50 }}
              onPositionChange={pos => set('photoPosition', pos)}
              onChangePhoto={pickBannerPhoto}
              height={220}
              uploading={photoUploading}
              placeholderText="Click or drag to set the focal point"
            />
            <Text style={{ fontSize: 12, color: colors.grey, marginTop: 8 }}>Click or drag to set the focal point. It stays in frame on every screen size.</Text>
          </View>
        </SectionCard>

        <SectionCard title="Gallery" subtitle="Up to 12 photos. Live shots with a crowd work best.">
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {profile.photos.map((url, i) => (
                <View key={i} style={{ width: 140, height: 105, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                  <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <TouchableOpacity onPress={() => set('photos', profile.photos.filter((_, idx) => idx !== i))} style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 13 }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {profile.photos.length < 12 && (
                <TouchableOpacity onPress={addGalleryPhoto} disabled={photoUploading} style={[pd.galleryAdd, { borderColor: colors.border }]}>
                  {photoUploading
                    ? <ActivityIndicator color={Colors.orange} />
                    : <Text style={{ fontSize: 14, color: colors.grey }}>+ Add photos</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderRatesAndReach() {
    return (
      <View>
        {renderPageHeader('Rates & reach', 'Help venues judge fit before they enquire.')}

        <SectionCard title="Fees" subtitle="Shown as a range on your profile. The final fee is agreed per gig.">
          <FieldRow label="Fee range" sublabel="Per gig, AUD, excluding GST." last>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[pd.prefixRow, { flex: 1, borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                <Text style={[pd.prefixText, { color: colors.grey }]}>$</Text>
                <TextInput style={[pd.prefixInput, { color: colors.black }]} value={profile.feeMin} onChangeText={v => set('feeMin', v)} placeholder="400" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
              </View>
              <Text style={{ color: colors.grey }}>to</Text>
              <View style={[pd.prefixRow, { flex: 1, borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                <Text style={[pd.prefixText, { color: colors.grey }]}>$</Text>
                <TextInput style={[pd.prefixInput, { color: colors.black }]} value={profile.feeMax} onChangeText={v => set('feeMax', v)} placeholder="900" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
              </View>
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Audience & travel">
          <FieldRow label="Average draw" sublabel="Typical headcount you bring to a show.">
            <SelectField value={profile.averageDraw} options={AVERAGE_DRAW_OPTS} onChange={v => set('averageDraw', v)} placeholder="Select" />
          </FieldRow>
          <FieldRow label="Travel" sublabel="How far you'll go for a gig." last>
            <SelectField value={profile.travel} options={TRAVEL_OPTS} onChange={v => set('travel', v)} placeholder="Select" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Social links">
          {[
            { key: 'instagram',  label: 'Instagram',    prefix: 'instagram.com/' },
            { key: 'tiktok',     label: 'TikTok',       prefix: 'tiktok.com/@' },
            { key: 'spotify',    label: 'Spotify',      prefix: 'open.spotify.com/artist/' },
            { key: 'appleMusic', label: 'Apple Music',  prefix: 'music.apple.com/' },
            { key: 'youtube',    label: 'YouTube',      prefix: 'youtube.com/@' },
          ].map((p, i, arr) => (
            <FieldRow key={p.key} label={p.label} last={i === arr.length - 1 && profile.customLinks.length === 0}>
              <View style={[pd.prefixRow, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
                <Text style={[pd.prefixText, { color: colors.grey, fontSize: 12 }]}>{p.prefix}</Text>
                <TextInput style={[pd.prefixInput, { color: colors.black }]} value={(profile as any)[p.key] || ''} onChangeText={v => set(p.key as any, v)} placeholder="username" placeholderTextColor={Colors.greyLight} autoCapitalize="none" />
              </View>
            </FieldRow>
          ))}
          {profile.customLinks.map((link, i) => (
            <FieldRow key={i} label="Custom link" last={i === profile.customLinks.length - 1}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput style={[sh.input, { width: 110, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]} value={link.label} onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, label: v } : l))} placeholder="Label" placeholderTextColor={Colors.greyLight} />
                <TextInput style={[sh.input, { flex: 1, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black }]} value={link.url} onChangeText={v => set('customLinks', profile.customLinks.map((l, idx) => idx === i ? { ...l, url: v } : l))} placeholder="https://..." placeholderTextColor={Colors.greyLight} autoCapitalize="none" />
                <TouchableOpacity onPress={() => set('customLinks', profile.customLinks.filter((_, idx) => idx !== i))}>
                  <Text style={{ fontSize: 18, color: colors.grey }}>×</Text>
                </TouchableOpacity>
              </View>
            </FieldRow>
          ))}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <TouchableOpacity style={[pd.addBtn, { borderColor: colors.border }]} onPress={() => set('customLinks', [...profile.customLinks, { label: '', url: '' }])}>
              <Text style={{ fontSize: 14, color: colors.grey }}>+ Add link</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        <SectionCard title="Insurance">
          <FieldRow label="Public liability insurance" sublabel="Many venues require it. Insured acts get a badge on their profile.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.payment.publicLiabilityHeld} onValueChange={(v: boolean) => setPayment('publicLiabilityHeld', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          {profile.payment.publicLiabilityHeld && (
            <FieldRow label="Coverage">
              <SelectField value={profile.payment.publicLiabilityCoverage} options={COVERAGE_OPTS} onChange={(v: string) => setPayment('publicLiabilityCoverage', v)} placeholder="Select" />
            </FieldRow>
          )}
          <FieldRow label="Certificate available on request" sublabel="Venues can ask for your certificate of currency before confirming." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.payment.insuranceCertAvailable} onValueChange={(v: boolean) => setPayment('insuranceCertAvailable', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderTechRider() {
    const memberCount = profile.members?.length || parseInt(profile.memberCount || '0') || 0;
    return (
      <View>
        {renderPageHeader('Tech rider', 'What you need on stage. Attached to every enquiry you send.')}

        <SectionCard title="Documents">
          <FieldRow label="Rider" sublabel="Your full rider, if you have one. Venues can download it from the enquiry.">
            <View style={{ gap: 8 }}>
              {(profile.techRiderDocs || []).map((d, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.grey, fontWeight: '600' }}>PDF</Text>
                  <Text style={[{ flex: 1, fontSize: 13, color: colors.black }]} numberOfLines={1}>{d.name}</Text>
                  <TouchableOpacity onPress={() => set('techRiderDocs', profile.techRiderDocs.filter((_, i) => i !== idx))}>
                    <Text style={{ fontSize: 16, color: colors.grey }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border, alignSelf: 'flex-start' }]} onPress={pickDocument} disabled={docUploading}>
                <Text style={[pd.outlineBtnText, { color: colors.black }]}>{docUploading ? 'Uploading...' : 'Upload PDF'}</Text>
              </TouchableOpacity>
            </View>
          </FieldRow>
          <FieldRow label="Stage plot" sublabel="PNG, JPG or PDF, up to 10MB." last>
            {profile.techRider?.stagePlotUrl ? (
              <View style={{ gap: 8 }}>
                <Image source={{ uri: profile.techRider.stagePlotUrl }} style={{ width: '100%', height: 120, borderRadius: 8 }} resizeMode="contain" />
                <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border, alignSelf: 'flex-start' }]} onPress={() => setRider('stagePlotUrl', '')}>
                  <Text style={[pd.outlineBtnText, { color: Colors.danger }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[pd.addBtn, { borderColor: colors.border }]} onPress={pickStagePlot} disabled={stagePlotUploading}>
                <Text style={{ fontSize: 14, color: colors.grey }}>{stagePlotUploading ? 'Uploading...' : 'Drop an image or browse'}</Text>
              </TouchableOpacity>
            )}
          </FieldRow>
        </SectionCard>

        <SectionCard title="Stage">
          <FieldRow label="Performers" sublabel="From your line-up.">
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 14, color: colors.black, fontWeight: '600' }}>{memberCount || '-'}</Text>
            </View>
          </FieldRow>
          <FieldRow label="Minimum stage size">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput style={[sh.input, { width: 64, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, textAlign: 'center' }]} value={profile.techRider?.stageWidth || ''} onChangeText={(v: string) => setRider('stageWidth', v)} placeholder="4" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
              <Text style={{ color: colors.grey }}>×</Text>
              <TextInput style={[sh.input, { width: 64, backgroundColor: colors.bgFaint, borderColor: colors.border, color: colors.black, textAlign: 'center' }]} value={profile.techRider?.stageDepth || ''} onChangeText={(v: string) => setRider('stageDepth', v)} placeholder="3" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
              <Text style={{ fontSize: 13, color: colors.grey }}>metres, width × depth</Text>
            </View>
          </FieldRow>
          <FieldRow label="Monitoring" last>
            <View style={{ gap: 8 }}>
              <Pills options={MONITORING_OPTS} value={profile.techRider?.monitoringType || ''} onSelect={v => setRider('monitoringType', v)} />
              <Input value={profile.techRider?.monitoring || ''} onChangeText={(v: string) => setRider('monitoring', v)} placeholder="Mixes needed, e.g. 3 wedge mixes, vocals in all" />
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard
          title="Input list"
          subtitle="Sent to the venue's sound engineer."
          right={
            <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={addChannel}>
              <Text style={[pd.outlineBtnText, { color: colors.black }]}>+ Add channel</Text>
            </TouchableOpacity>
          }
        >
          <View style={{ paddingBottom: 8 }}>
            {profile.inputChannels.length > 0 && (
              <View style={[pd.tableHeader, { borderBottomColor: colors.border }]}>
                <Text style={[pd.tableHeaderText, { color: colors.grey, width: 32 }]}>Ch</Text>
                <Text style={[pd.tableHeaderText, { color: colors.grey, flex: 1 }]}>Source</Text>
                <Text style={[pd.tableHeaderText, { color: colors.grey, flex: 1 }]}>Mic / DI</Text>
                <View style={{ width: 24 }} />
              </View>
            )}
            {profile.inputChannels.map((ch, i) => (
              <View key={i} style={[pd.tableRow, { borderBottomColor: colors.border }]}>
                <Text style={[pd.tableHeaderText, { color: colors.grey, width: 32 }]}>{String(i + 1).padStart(2, '0')}</Text>
                <TextInput style={[{ flex: 1, fontSize: 14, color: colors.black }]} value={ch.source} onChangeText={(v: string) => setChannel(i, 'source', v)} placeholder="Kick" placeholderTextColor={Colors.greyLight} />
                <TextInput style={[{ flex: 1, fontSize: 14, color: colors.black }]} value={ch.micDi} onChangeText={(v: string) => setChannel(i, 'micDi', v)} placeholder="Beta 52" placeholderTextColor={Colors.greyLight} />
                <TouchableOpacity onPress={() => removeChannel(i)}>
                  <Text style={{ fontSize: 16, color: colors.grey }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            {profile.inputChannels.length === 0 && (
              <Text style={{ fontSize: 14, color: colors.grey, padding: 16 }}>No channels added yet.</Text>
            )}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.grey, fontWeight: '600' }}>Upload input list</Text>
            <Text style={{ fontSize: 12, color: colors.greyLight }}>PDF or image. Downloadable from your profile and any enquiry.</Text>
            {profile.techRider?.inputListUrl ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.black, flex: 1 }} numberOfLines={1}>
                  {profile.techRider.inputListName || 'Input list'}
                </Text>
                <TouchableOpacity onPress={() => { setRider('inputListUrl', ''); setRider('inputListName', ''); }}>
                  <Text style={{ fontSize: 13, color: Colors.danger }}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border, alignSelf: 'flex-start' }]} onPress={pickInputList} disabled={inputListUploading}>
                <Text style={[pd.outlineBtnText, { color: colors.black }]}>{inputListUploading ? 'Uploading...' : 'Upload file'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </SectionCard>

        <SectionCard title="Backline">
          <FieldRow label="Needed from venue" sublabel="Gear the venue supplies.">
            <Pills options={BACKLINE_NEEDED_OPTS} value={profile.backlineFromVenue} onSelect={v => set('backlineFromVenue', v)} multi />
          </FieldRow>
          <FieldRow label="You bring" sublabel="Gear you'll load in yourselves." last>
            <Pills options={BACKLINE_BRING_OPTS} value={profile.backlineBring} onSelect={v => set('backlineBring', v)} multi />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Production">
          <FieldRow label="Touring with own PA and engineer" sublabel="Venues without in-house sound will see you're self-sufficient.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.techRiderBools?.ownPA || false} onValueChange={(v: boolean) => setRiderBool('ownPA', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="Lighting">
            <Input value={profile.techRider?.lighting || ''} onChangeText={(v: string) => setRider('lighting', v)} placeholder="e.g. house lights fine, no strobes" />
          </FieldRow>
          <FieldRow label="Power" last>
            <Input value={profile.techRider?.power || ''} onChangeText={(v: string) => setRider('power', v)} placeholder="e.g. 2 × 10A outlets stage left" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Timings">
          <FieldRow label="Load-in">
            <SelectField value={profile.techRider?.loadIn || ''} options={LOAD_IN_OPTS} onChange={v => setRider('loadIn', v)} placeholder="Select" />
          </FieldRow>
          <FieldRow label="Soundcheck" last>
            <SelectField value={profile.techRider?.soundcheck || ''} options={SOUNDCHECK_OPTS} onChange={v => setRider('soundcheck', v)} placeholder="Select" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Additional notes">
          <View style={{ padding: 16 }}>
            <Input value={profile.techRider?.notes || ''} onChangeText={(v: string) => setRider('notes', v)} placeholder="Anything else the venue or engineer should know." multiline />
          </View>
        </SectionCard>
      </View>
    );
  }

  function renderHospitality() {
    const memberCount = profile.members?.length || 0;
    return (
      <View>
        {renderPageHeader('Hospitality', 'What you need off stage. Shared with the venue once a booking is confirmed.')}

        <SectionCard title="Food & drink">
          <FieldRow label="Meals">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.hospitality.mealsRequired} onValueChange={(v: boolean) => setHosp('mealsRequired', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          {profile.hospitality.mealsRequired && (
            <FieldRow label="How many">
              <View style={{ gap: 4 }}>
                <SelectField value={profile.hospitality.mealCount} options={MEAL_COUNT_OPTS} onChange={v => setHosp('mealCount', v)} placeholder="Select" />
                {memberCount > 0 && <Text style={{ fontSize: 12, color: colors.grey }}>Your line-up has {memberCount} performer{memberCount !== 1 ? 's' : ''}.</Text>}
              </View>
            </FieldRow>
          )}
          <FieldRow label="Dietary requirements">
            <Input value={profile.hospitality.dietaryReqs} onChangeText={(v: string) => setHosp('dietaryReqs', v)} placeholder="e.g. 1 vegetarian, 1 gluten-free" />
          </FieldRow>
          <FieldRow label="Drinks" last>
            <Input value={profile.hospitality.drinks} onChangeText={(v: string) => setHosp('drinks', v)} placeholder="e.g. water on stage, drink tickets" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Venue">
          <FieldRow label="Green room" sublabel="A private space to prepare before the set.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.hospitality.greenRoom} onValueChange={(v: boolean) => setHosp('greenRoom', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="Merch table" sublabel="A table and power near the room.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.hospitality.merchTable} onValueChange={(v: boolean) => setHosp('merchTable', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="Parking & loading" last>
            <Input value={profile.hospitality.parkingLoading} onChangeText={(v: string) => setHosp('parkingLoading', v)} placeholder="e.g. one van, rear loading dock access" />
          </FieldRow>
        </SectionCard>

        <SectionCard title="Travel">
          <FieldRow label="Accommodation" sublabel="Usually only for regional or interstate shows." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.hospitality.accommodation} onValueChange={(v: boolean) => setHosp('accommodation', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderInvoicing() {
    return (
      <View>
        {renderPageHeader('Invoicing', 'How venues pay you. Shared once a booking is confirmed.')}

        <SectionCard title="Business details" subtitle="Twaylo doesn't process payments. Venues pay you directly.">
          <FieldRow label="Invoicing name" sublabel="The name on your invoices, if different from your stage name.">
            <Input value={profile.payment.invoicingName} onChangeText={(v: string) => setPayment('invoicingName', v)} placeholder="The Dahlias Pty Ltd" />
          </FieldRow>
          <FieldRow label="ABN">
            <Input value={profile.payment.abn} onChangeText={(v: string) => setPayment('abn', v)} placeholder="51 824 753 556" keyboardType="numeric" />
          </FieldRow>
          <FieldRow label="Registered for GST" sublabel="Your fee range is shown excluding GST.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.payment.gstRegistered} onValueChange={(v: boolean) => setPayment('gstRegistered', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="Can provide an invoice" sublabel="Most venues need one to pay you." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.payment.canProvideInvoice} onValueChange={(v: boolean) => setPayment('canProvideInvoice', v)} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Getting paid">
          <FieldRow label="Accepted methods">
            <Pills options={PAY_METHODS} value={profile.payment.methods} onSelect={v => setPayment('methods', v)} multi />
          </FieldRow>
          <FieldRow label="Payment timing">
            <View style={{ gap: 8 }}>
              <Pills options={PAY_TIMING} value={profile.payment.timing} onSelect={v => setPayment('timing', v)} />
              {profile.payment.timing === 'Other' && (
                <Input value={profile.payment.timingOther} onChangeText={(v: string) => setPayment('timingOther', v)} placeholder="e.g. invoice within 14 days of performance" />
              )}
            </View>
          </FieldRow>
          <FieldRow label="Notes for venues" sublabel="Deposits, cash handling, anything else. Put bank details on your invoice, not here." last>
            <Input value={profile.payment.paymentNotes} onChangeText={(v: string) => setPayment('paymentNotes', v)} placeholder="e.g. Cash on the night preferred for gigs under $500." multiline />
          </FieldRow>
        </SectionCard>
      </View>
    );
  }

  function renderSettings() {
    return (
      <View>
        {renderPageHeader('Settings', 'Notifications, calendar sync and your account.')}

        <SectionCard title="Email notifications">
          <FieldRow label="Enquiry responses" sublabel="When a venue accepts, declines or replies to your enquiry.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.settings.emailOnEnquiryResponse} onValueChange={(v: boolean) => set('settings', { ...profile.settings, emailOnEnquiryResponse: v })} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="New messages" sublabel="When a venue messages you directly.">
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.settings.emailOnNewMessages} onValueChange={(v: boolean) => set('settings', { ...profile.settings, emailOnNewMessages: v })} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
          <FieldRow label="New connections" sublabel="When a venue connects with you." last>
            <View style={{ alignItems: 'flex-end' }}>
              <Switch value={profile.settings.emailOnNewConnection} onValueChange={(v: boolean) => set('settings', { ...profile.settings, emailOnNewConnection: v })} trackColor={{ false: '#e0e0e0', true: Colors.orange }} thumbColor="#fff" />
            </View>
          </FieldRow>
        </SectionCard>

        <CalendarSync />

        <SectionCard title="Appearance">
          <FieldRow label="Theme" last>
            <View style={{ alignItems: 'flex-end' }}>
              <View style={[pd.segmented, { borderColor: colors.border }]}>
                {(['Light','Dark','System'] as const).map((label, i) => {
                  const key = label.toLowerCase() as 'light' | 'dark' | 'system';
                  const active = themeMode === key;
                  return (
                    <TouchableOpacity key={label} onPress={() => setThemeMode(key)} style={[pd.segBtn, { backgroundColor: active ? colors.black : 'transparent' }, i < 2 && { borderRightWidth: 1, borderRightColor: colors.border }]}>
                      <Text style={{ fontSize: 13, fontWeight: '500', color: active ? '#fff' : colors.black }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </FieldRow>
        </SectionCard>

        <SectionCard title="Sign-in">
          <FieldRow label="Login email" sublabel={user?.email ?? ''}>
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={() => Alert.alert('Change email', 'To change your login email, please contact support.')}>
                <Text style={[pd.outlineBtnText, { color: colors.black }]}>Change</Text>
              </TouchableOpacity>
            </View>
          </FieldRow>
          <FieldRow label="Password" sublabel="Send a password reset link to your email." last>
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={async () => {
                if (!user?.email) return;
                try {
                  await sendPasswordResetEmail(auth, user.email);
                  Alert.alert('Email sent', 'Check your inbox for a password reset link.');
                } catch (e: any) {
                  Alert.alert('Error', e.message ?? 'Could not send reset email.');
                }
              }}>
                <Text style={[pd.outlineBtnText, { color: colors.black }]}>Update</Text>
              </TouchableOpacity>
            </View>
          </FieldRow>
        </SectionCard>

        <View style={[pd.deleteCard, { borderColor: Colors.danger + '44', backgroundColor: colors.bg }]}>
          <Text style={[{ fontSize: 14, fontWeight: '700', marginBottom: 6, color: colors.black }]}>Delete account</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.grey, marginBottom: 14 }}>
            Permanently removes your profile, enquiries and messages. To take a break instead, turn off Listed in Discover.
          </Text>
          <TouchableOpacity
            style={pd.deleteBtn}
            onPress={() => crossConfirm('Delete Account', 'This will permanently delete your profile and account. This action cannot be undone.', async () => {
              try {
                const currentUid = user?.uid;
                if (currentUid) {
                  await deleteDoc(doc(db, 'bandProfiles', currentUid));
                  await deleteDoc(doc(db, 'users', currentUid));
                }
                const cu = auth.currentUser;
                if (cu) await deleteUser(cu);
              } catch (e: any) {
                Alert.alert('Error', e.message ?? 'Could not delete account.');
              } finally {
                await signOut(auth).catch(() => {});
                router.replace('/');
              }
            }, true)}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.danger }}>Delete account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderActiveTab() {
    switch (activeTab) {
      case 'Basic info':    return renderBasicInfo();
      case 'About':         return renderAbout();
      case 'Music':         return renderMusic();
      case 'Photos':        return renderPhotos();
      case 'Rates & reach': return renderRatesAndReach();
      case 'Tech rider':    return renderTechRider();
      case 'Hospitality':   return renderHospitality();
      case 'Invoicing':     return renderInvoicing();
      case 'Settings':      return renderSettings();
      default:              return null;
    }
  }

  // ── Completion banner ─────────────────────────────────────────────────────
  function renderCompletionBanner() {
    if (bannerDismissed || completionPct >= 100) return null;
    const missing = missingLabels.join(', ').toLowerCase();
    return (
      <View style={[pd.banner, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[pd.bannerPct, { color: colors.black }]}>Profile {completionPct}% complete</Text>
            <View style={[pd.bannerTrack, { backgroundColor: colors.borderFaint }]}>
              <View style={[pd.bannerFill, { width: `${completionPct}%` as any, backgroundColor: colors.black }]} />
            </View>
          </View>
          {missingLabels.length > 0 && <Text style={{ fontSize: 12, color: colors.grey }}>{missing.charAt(0).toUpperCase() + missing.slice(1)} remaining</Text>}
        </View>
        <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={() => {
          const firstMissing = completionFields.find(f => !f.done);
          if (firstMissing) {
            const tabForField: Record<string, string> = { 'Stage name': 'Basic info', 'Genres': 'Basic info', 'Profile photo': 'Photos', 'Location': 'Basic info', 'Music tracks': 'Music', 'Fee range': 'Rates & reach', 'Average draw': 'Rates & reach', 'Travel': 'Rates & reach', 'Bio': 'About' };
            const tab = tabForField[firstMissing.label] || 'Basic info';
            setActiveTab(tab);
            if (isMobileLayout) setMobileShowList(false);
          }
        }}>
          <Text style={[pd.outlineBtnText, { color: colors.black }]}>Finish setup</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setBannerDismissed(true)} style={{ paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 16, color: colors.grey }}>×</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Unsaved changes bar ────────────────────────────────────────────────────
  function renderUnsavedBar() {
    if (!hasUnsaved) return null;
    return (
      <View style={[pd.unsavedBar, { backgroundColor: '#16161A', borderTopColor: '#2a2a2a' }]}>
        <Text style={pd.unsavedText}>Unsaved changes</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={handleDiscard}>
            <Text style={pd.discardText}>Discard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={pd.saveChangesBtn} onPress={handleSave} disabled={saving}>
            <Text style={pd.saveChangesBtnText}>{saving ? 'Saving...' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bg }]}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Desktop layout
  // ═══════════════════════════════════════════════════════════════════════════
  if (isWeb && !isMobileLayout) {
    const initials = (profile.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return (
      <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
        {/* Top bar */}
        <View style={[pd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={pd.logoSquare}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>T</Text>
            </View>
            <Text style={[pd.logoText, { color: colors.black }]}>Twaylo</Text>
            <Text style={{ color: colors.grey, fontSize: 14 }}>/</Text>
            <Text style={{ color: colors.grey, fontSize: 14 }}>Settings</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {justSaved && <Text style={{ fontSize: 13, color: '#2F7A4B' }}>Saved just now</Text>}
            <TouchableOpacity style={[pd.outlineBtn, { borderColor: colors.border }]} onPress={() => router.push(`/musician/${uid}` as any)}>
              <Text style={[pd.outlineBtnText, { color: colors.black }]}>View public profile</Text>
            </TouchableOpacity>
            <View style={[pd.avatarCircle, { backgroundColor: colors.border }]}>
              {profile.photoUrl
                ? <Image source={{ uri: profile.photoUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                : <Text style={{ fontSize: 12, fontWeight: '700', color: colors.grey }}>{initials}</Text>
              }
            </View>
          </View>
        </View>

        <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>
          {/* Sidebar */}
          <View style={[pd.sidebar, { backgroundColor: colors.bg, borderRightColor: colors.border }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* User header */}
              <View style={pd.sidebarUser}>
                {profile.photoUrl
                  ? <Image source={{ uri: profile.photoUrl }} style={pd.sidebarPhoto} resizeMode="cover" />
                  : <View style={[pd.sidebarPhoto, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 10, color: colors.grey }}>{initials}</Text>
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={[pd.sidebarName, { color: colors.black }]} numberOfLines={1}>{profile.name || 'Your profile'}</Text>
                  <Text style={[pd.sidebarHandle, { color: colors.grey }]} numberOfLines={1}>Artist{profile.username ? ` · @${profile.username}` : ''}</Text>
                </View>
              </View>

              {/* Nav groups */}
              {NAV_GROUPS.map(group => (
                <View key={group.label} style={{ marginBottom: 4 }}>
                  <Text style={[pd.navGroupLabel, { color: colors.grey }]}>{group.label}</Text>
                  {group.tabs.map(tab => {
                    const active = activeTab === tab;
                    const showDot = tab === 'Rates & reach' && (!profile.feeMin || !profile.feeMax || !profile.averageDraw || !profile.travel);
                    return (
                      <TouchableOpacity
                        key={tab}
                        style={[pd.navItem, active && { backgroundColor: '#EFEEEB' }]}
                        onPress={() => setActiveTab(tab)}
                        activeOpacity={0.7}
                      >
                        <Text style={[pd.navText, { color: colors.black, fontWeight: active ? '700' : '500' }]}>{tab}</Text>
                        {showDot && <View style={pd.navDot} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              <View style={[pd.navDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity style={pd.navItem} onPress={() => crossConfirm('Log out', 'Are you sure you want to log out?', async () => { await signOut(auth); router.replace('/'); })}>
                <Text style={[pd.navText, { color: colors.grey, fontWeight: '400' }]}>Log out</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Content */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={pd.contentPad}>
            {renderCompletionBanner()}
            {tabErrors.length > 0 && (
              <View style={pd.errBanner}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.danger }}>Please complete: </Text>
                {tabErrors.map(t => <Text key={t} style={pd.errPill}>{t}</Text>)}
              </View>
            )}
            {renderActiveTab()}
          </ScrollView>
        </View>

        {renderUnsavedBar()}

        {/* Onboarding overlays */}
        {onboardingStep === 1 && (
          <View style={pd.overlay}>
            <View style={[pd.welcomeCard, { backgroundColor: colors.bg }]}>
              <Text style={[{ fontSize: 11, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }]}>STEP 1 OF 9</Text>
              <Text style={[{ fontSize: 22, fontWeight: '800', color: colors.black, marginBottom: 10 }]}>Welcome</Text>
              <Text style={{ fontSize: 15, color: colors.grey, lineHeight: 22, marginBottom: 24 }}>Your account is set up. Now let's build your profile so venues can find you, listen to you, and book you.</Text>
              <TouchableOpacity style={pd.primaryBtn} onPress={advanceOnboarding}>
                <Text style={pd.primaryBtnText}>Get started</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mobile layout
  // ═══════════════════════════════════════════════════════════════════════════
  if (mobileShowList) {
    return (
      <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
        <View style={[pd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={pd.logoSquare}><Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>T</Text></View>
            <Text style={[pd.logoText, { color: colors.black }]}>Twaylo</Text>
            <Text style={{ color: colors.grey }}>/</Text>
            <Text style={{ color: colors.grey }}>Settings</Text>
          </View>
          <View style={[pd.avatarCircle, { backgroundColor: colors.border }]}>
            {profile.photoUrl ? <Image source={{ uri: profile.photoUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : null}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={pd.sidebarUser}>
            {profile.photoUrl
              ? <Image source={{ uri: profile.photoUrl }} style={pd.sidebarPhoto} resizeMode="cover" />
              : <View style={[pd.sidebarPhoto, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]} />
            }
            <View>
              <Text style={[pd.sidebarName, { color: colors.black }]}>{profile.name || 'Your profile'}</Text>
              <Text style={[pd.sidebarHandle, { color: colors.grey }]}>Artist{profile.username ? ` · @${profile.username}` : ''}</Text>
            </View>
          </View>

          {NAV_GROUPS.map(group => (
            <View key={group.label}>
              <Text style={[pd.navGroupLabel, { color: colors.grey, paddingHorizontal: 20 }]}>{group.label}</Text>
              {group.tabs.map(tab => {
                const showDot = tab === 'Rates & reach' && (!profile.feeMin || !profile.feeMax);
                return (
                  <TouchableOpacity key={tab} style={[pd.mobileListItem, { backgroundColor: colors.bg, borderBottomColor: colors.border }]} onPress={() => { setActiveTab(tab); setMobileShowList(false); }} activeOpacity={0.7}>
                    <Text style={[pd.navText, { color: colors.black }]}>{tab}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {showDot && <View style={pd.navDot} />}
                      <Text style={{ color: colors.grey, fontSize: 18 }}>›</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 12 }} />
            </View>
          ))}

          <View style={[{ height: 1, backgroundColor: colors.border, marginHorizontal: 20, marginBottom: 12 }]} />
          <TouchableOpacity style={[pd.mobileListItem, { backgroundColor: colors.bg, borderBottomColor: colors.border }]} onPress={() => crossConfirm('Log out', 'Are you sure?', async () => { await signOut(auth); router.replace('/'); })}>
            <Text style={[pd.navText, { color: colors.grey, fontWeight: '400' }]}>Log out</Text>
          </TouchableOpacity>
        </ScrollView>
        {renderUnsavedBar()}
      </SafeAreaView>
    );
  }

  // Mobile section view
  return (
    <SafeAreaView style={[{ flex: 1 }, { backgroundColor: colors.bgFaint }]}>
      <View style={[pd.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => setMobileShowList(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
          <Text style={{ fontSize: 14, color: colors.grey }}>All settings</Text>
        </TouchableOpacity>
        {justSaved && <Text style={{ fontSize: 13, color: '#2F7A4B' }}>Saved</Text>}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {renderCompletionBanner()}
        {tabErrors.length > 0 && (
          <View style={pd.errBanner}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.danger }}>Please complete: </Text>
            {tabErrors.map(t => <Text key={t} style={pd.errPill}>{t}</Text>)}
          </View>
        )}
        {renderActiveTab()}
      </ScrollView>
      {renderUnsavedBar()}

      {/* Mobile onboarding overlay */}
      {onboardingStep >= 1 && onboardingStep <= 9 && (() => {
        const ONBOARDING: Record<number, { title: string; body: string; next: string }> = {
          1: { title: 'Welcome', body: "Your account is set up. Now let's build your profile so venues can find you, listen to you, and book you.", next: 'Get started' },
          2: { title: 'Basic info', body: 'This is what venues see first. Fill it in properly. A half-finished profile gets ignored.', next: 'Next: About' },
          3: { title: 'About', body: 'Write a short bio. Keep it tight. Venues are busy.', next: 'Next: Music' },
          4: { title: 'Music', body: 'Add links to your music. Venues will listen before they respond.', next: 'Next: Tech rider' },
          5: { title: 'Tech rider', body: 'Upload your rider and fill in your stage requirements.', next: 'Next: Invoicing' },
          6: { title: 'Invoicing', body: 'Let venues know how you prefer to be paid.', next: 'Next: Photos' },
          7: { title: 'Photos', body: 'Upload photos of your act.', next: "Next: Go live" },
          8: { title: 'Go live', body: 'Your profile is ready. Hit save to appear in the musicians directory.', next: 'Publish my profile' },
          9: { title: 'Go live', body: 'Your profile is ready. Hit save to appear in the musicians directory.', next: 'Publish my profile' },
        };
        const data = ONBOARDING[onboardingStep];
        return (
          <Modal visible transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <View style={[{ borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, paddingBottom: 44 }, { backgroundColor: colors.bg }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.grey, textTransform: 'uppercase', letterSpacing: 1 }}>STEP {onboardingStep} OF 9</Text>
                  <TouchableOpacity onPress={skipOnboarding}><Text style={{ fontSize: 13, color: colors.grey }}>Skip setup</Text></TouchableOpacity>
                </View>
                <Text style={[{ fontSize: 20, fontWeight: '800', color: colors.black, marginBottom: 10 }]}>{data.title}</Text>
                <Text style={{ fontSize: 15, color: colors.grey, lineHeight: 22, marginBottom: 24 }}>{data.body}</Text>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <TouchableOpacity style={pd.primaryBtn} onPress={onboardingStep >= 8 ? finishOnboarding : advanceOnboarding}>
                    <Text style={pd.primaryBtnText}>{data.next}</Text>
                  </TouchableOpacity>
                  {onboardingStep > 1 && (
                    <TouchableOpacity onPress={backOnboarding}>
                      <Text style={{ fontSize: 14, color: colors.grey }}>Back</Text>
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

// ── Styles ────────────────────────────────────────────────────────────────
const pd = StyleSheet.create({
  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  logoSquare:     { width: 28, height: 28, borderRadius: 6, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center' },
  logoText:       { fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
  avatarCircle:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  sidebar:        { width: 192, borderRightWidth: 1, paddingTop: 20 },
  sidebarUser:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 20 },
  sidebarPhoto:   { width: 36, height: 36, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  sidebarName:    { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, lineHeight: 19 },
  sidebarHandle:  { fontSize: 12, lineHeight: 17 },

  navGroupLabel:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: 16, marginTop: 16, marginBottom: 4 },
  navItem:        { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginHorizontal: 8, marginBottom: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navText:        { fontSize: 14 },
  navDot:         { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange },
  navDivider:     { height: 1, marginHorizontal: 16, marginVertical: 12 },

  contentPad:     { padding: 32, paddingBottom: 100 },

  pageTitle:      { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: 6 },
  pageDesc:       { fontSize: 14, lineHeight: 21 },

  photoThumb:     { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  prefixRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  prefixText:     { fontSize: 13, fontWeight: '500', marginRight: 2, flexShrink: 0 },
  prefixInput:    { flex: 1, fontSize: 14, padding: 0 },

  outlineBtn:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  outlineBtnText: { fontSize: 13, fontWeight: '600' },

  addBtn:         { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },

  trackRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  trackNum:       { fontSize: 13, fontWeight: '600', width: 24, paddingTop: 12 },
  badge:          { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexShrink: 0 },

  galleryAdd:     { width: 140, height: 105, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },

  tableHeader:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  tableHeaderText:{ fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },

  segmented:      { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  segBtn:         { paddingVertical: 7, paddingHorizontal: 14 },

  deleteCard:     { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  deleteBtn:      { borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start' },

  banner:         { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24 },
  bannerPct:      { fontSize: 14, fontWeight: '700' },
  bannerTrack:    { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  bannerFill:     { height: 4 },

  unsavedBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1 },
  unsavedText:    { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  discardText:    { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
  saveChangesBtn: { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveChangesBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  errBanner:      { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(233,69,96,0.06)', borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(233,69,96,0.2)' },
  errPill:        { fontSize: 12, fontWeight: '700', color: Colors.danger, borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },

  mobileListItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },

  overlay:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  welcomeCard:    { borderRadius: 16, padding: 32, width: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24 },
  primaryBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, alignSelf: 'flex-start' },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
