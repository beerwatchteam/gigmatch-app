import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform, Modal,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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
const SLOT_TYPES     = ['Headline','Other'];

type Room = { name: string; capacity: string; stage: string; lighting: string; pa: string; _isNew?: boolean };
type Night = {
  day: string; startTime: string; duration: number; slotType: string;
  startDate: string; endDate: string; continuous: boolean;
  feeMin: string; feeMax: string; feeBasis: string; loadIn: string; soundcheck: string;
  room: string; genres: string[]; notes: string; paymentModel: string; paymentModels?: string[];
  doorSplit: string; coverCharge: string;
  barSplit: string;
  ticketSalesSplit: string; ticketingHandledBy: string;
  _isNew?: boolean;
};
type Payment = {
  models: string[];
  setFeeMin: string; setFeeMax: string; feeBasis: string;
  doorSplit: string; coverCharge: string;
  barSplit: string;
  ticketSalesSplit: string; ticketingHandledBy: string;
  timing: string;
  invoiceRequired: boolean;
  invoiceDoc?: { url: string; name: string } | null;
  gstRegistered: boolean;
  cancellationTerms: string;
  additionalNotes: string;
};
type VenueData = {
  id?: string; name: string; streetAddress: string; suburb: string;
  state: string; postcode: string; phone: string; email: string;
  website: string; description: string; photoUrl: string;
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
  doorSplit: '', coverCharge: '', barSplit: '',
  ticketSalesSplit: '', ticketingHandledBy: '',
  timing: '', invoiceRequired: true, invoiceDoc: null, gstRegistered: false,
  cancellationTerms: '', additionalNotes: '',
};

const BLANK: VenueData = {
  name: '', streetAddress: '', suburb: '', state: '', postcode: '',
  phone: '', email: '', website: '', description: '', photoUrl: '',
  rooms: [], gigNights: [], techSpecs: {},
  settings: { emailOnNewEnquiry: true, emailEnquiryReminders: false, listed: true },
  photos: [], videos: [],
  payment: { ...BLANK_PAYMENT },
  photoPosition: { x: 50, y: 50 },
};

const TABS = ['Settings','Basic Info','Rooms','Timetable','Tech Specs','Photos & Videos'];

// ── Shared sub-components ────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: boolean; children: React.ReactNode }) {
  return (
    <View style={field.wrap}>
      <Text style={[field.label, error && { color: Colors.danger }]}>{label}</Text>
      {children}
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

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const dayScrollRef   = useRef<ScrollView>(null);
  const monthScrollRef = useRef<ScrollView>(null);
  const yearScrollRef  = useRef<ScrollView>(null);

  const START_YEAR = new Date().getFullYear();
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
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '--/--/----';
    const { day, month, year } = parse(v);
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  };

  const ITEM_H = 20;

  function handleOpen() {
    const today = new Date();
    const initial = value || toInternal(today.getDate(), today.getMonth() + 1, today.getFullYear());
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
        <Text style={{ fontSize: 14, color: value ? colors.black : Colors.greyLight }}>{display(value)}</Text>
        <Text style={{ fontSize: 11, color: Colors.grey }}>📅</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 24, width: 320, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.black, marginBottom: 4 }}>Select Date</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 20 }}>{display(draft)}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {/* Day */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Day</Text>
                <ScrollView ref={dayScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {days.map(d => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => setDraft(toInternal(d, month, year))}
                      style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: d === day ? Colors.orange : 'transparent', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: d === day ? '#fff' : colors.black, fontWeight: d === day ? '700' : '400' }}>{String(d).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* Month */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Month</Text>
                <ScrollView ref={monthScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {MONTHS.map((name, idx) => {
                    const m = idx + 1;
                    return (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setDraft(toInternal(Math.min(day, daysInMonth(m, year)), m, year))}
                        style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: m === month ? Colors.orange : 'transparent', alignItems: 'center' }}
                      >
                        <Text style={{ fontSize: 15, color: m === month ? '#fff' : colors.black, fontWeight: m === month ? '700' : '400' }}>{name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              {/* Year */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center', marginBottom: 8 }}>Year</Text>
                <ScrollView ref={yearScrollRef} style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {years.map(y => (
                    <TouchableOpacity
                      key={y}
                      onPress={() => setDraft(toInternal(Math.min(day, daysInMonth(month, y)), month, y))}
                      style={{ paddingVertical: 9, borderRadius: 8, marginBottom: 2, backgroundColor: y === year ? Colors.orange : 'transparent', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 15, color: y === year ? '#fff' : colors.black, fontWeight: y === year ? '700' : '400' }}>{y}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
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
  const venueId = profile?.venueId ?? '';

  const [data, setData]           = useState<VenueData>(BLANK);
  const [saved, setSaved]         = useState<VenueData>(BLANK);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors, setTabErrors]   = useState<string[]>([]);
  const [expandedRoom,  setExpandedRoom]  = useState<number | null>(null);
  const [expandedNight, setExpandedNight] = useState<number | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [stageDocUploading, setStageDocUploading] = useState(false);
  const [invoiceDocUploading, setInvoiceDocUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [showStickySave, setShowStickySave] = useState(false);
  const titleBarBottomRef = useRef(Infinity);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) {
        const d = { ...BLANK, id: snap.id, ...snap.data() } as VenueData;
        d.rooms     = d.rooms     || [];
        d.gigNights = d.gigNights || [];
        d.photos    = d.photos    || [];
        d.videos    = d.videos    || [];
        d.settings  = d.settings  || BLANK.settings;
        d.payment   = d.payment   ? { ...BLANK_PAYMENT, ...d.payment } : { ...BLANK_PAYMENT };
        setData(d); setSaved(d);
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
      const rooms = [...prev.rooms, { name: '', capacity: '', stage: '', lighting: '', pa: '', _isNew: true }];
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
        day, startTime: '', duration: 60, slotType: 'Headline',
        startDate: '', endDate: '', continuous: true,
        feeMin: '', feeMax: '', feeBasis: '', loadIn: '', soundcheck: '',
        room: '', genres: [], notes: '', paymentModel: '', paymentModels: [],
        doorSplit: '', coverCharge: '', barSplit: '', ticketSalesSplit: '', ticketingHandledBy: '',
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
    return [...nights].sort((a, b) => CANONICAL_DAYS.indexOf(a.day) - CANONICAL_DAYS.indexOf(b.day));
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
      setPayment('invoiceDoc', { url, name: asset.name });
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
    if (!data.name?.trim() || !data.streetAddress?.trim() || !data.suburb?.trim() ||
        !data.state?.trim() || !data.postcode?.trim() || !data.email?.trim() || !data.phone?.trim() || !data.website?.trim())
      errors.push('Basic Info');
    if (data.rooms.some(r => !r.name?.trim() || !r.capacity?.toString().trim()))
      errors.push('Rooms');
    if (data.gigNights.some(n => !n.day || !n.startTime || !n.startDate || (!n.continuous && !n.endDate)))
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
        const keepers    = (existingSlots[day] || []).filter((s: any) => s.date || s.status !== 'open');
        const nightsForDay = data.gigNights.filter(n => n.day === day && n.startTime);
        const openSlots  = nightsForDay.map((night, idx) => {
          const [h, m] = (night.startTime || '00:00').split(':').map(Number);
          const period = h >= 12 ? 'PM' : 'AM';
          const time   = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
          return {
            id: `open-${day.toLowerCase()}-${idx}`,
            time, status: 'open',
            slotType: night.slotType || 'Headline',
            room: night.room || '',
            feeMin: night.feeMin !== '' ? Number(night.feeMin) : null,
            feeMax: night.feeMax !== '' ? Number(night.feeMax) : null,
            genres: night.genres || [],
            duration: night.duration || 60,
            loadIn: night.loadIn || '', soundcheck: night.soundcheck || '',
            notes: night.notes || '',
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
      !data.name?.trim() || !data.streetAddress?.trim() ||
      !data.suburb?.trim() || !data.state?.trim() || !data.postcode?.trim() ||
      !data.email?.trim() || !data.phone?.trim() || !data.website?.trim();
    if (hasErrors) {
      setShowErrors(true);
      crossConfirm('Venue profile incomplete', "Some required fields are missing. Your venue won't be visible until complete. Leave anyway?", goBack, true);
      return;
    }
    goBack();
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
            {TABS.map(tab => (
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
                Deactivating your listing will hide it from all bands browsing GigMatch. This action can be reversed at any time.
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
                    'Are you sure you want to delete your account? This action cannot be undone.',
                    async () => {
                      try {
                        const { venueId, uid } = profile ?? {};
                        if (venueId) await deleteDoc(doc(db, 'venues', venueId));
                        if (uid)     await deleteDoc(doc(db, 'users', uid));
                        const cu = auth.currentUser;
                        if (cu) await deleteUser(cu);
                      } catch (e: any) {
                        Alert.alert('Error', e.message ?? 'Could not delete account. Please try again.');
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
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 2 }}>
                  <Field label="Suburb *" error={showErrors && !data.suburb?.trim()}>
                    <Input value={data.suburb} onChangeText={(v: string) => set('suburb', v)} placeholder="Suburb" error={showErrors && !data.suburb?.trim()} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Postcode *" error={showErrors && !data.postcode?.trim()}>
                    <Input value={data.postcode} onChangeText={(v: string) => set('postcode', v)} placeholder="3000" keyboardType="numeric" error={showErrors && !data.postcode?.trim()} />
                  </Field>
                </View>
              </View>
              <Field label="State *" error={showErrors && !data.state?.trim()}>
                <Pills options={AU_STATES} value={data.state} onSelect={(v: string) => set('state', v)} />
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

            {/* Payment */}
            <View style={[s.sectionBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.black }]}>Payment</Text>
              <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Set out how you pay artists so everyone's on the same page before a gig is booked. Clear payment terms build trust and reduce back-and-forth.</Text>

              <Field label="Choose Your Payment Model/s">
                <Pills
                  options={['Set Fee', 'Door Split', 'Ticket Sales Split', 'Bar Split', 'No Payment (exposure / covers only)']}
                  value={data.payment.models}
                  onSelect={(v: string[]) => setPayment('models', v)}
                  multi
                />
              </Field>

              {data.payment.models.includes('Set Fee') && (() => {
                const minVal = parseFloat(data.payment.setFeeMin);
                const maxVal = parseFloat(data.payment.setFeeMax);
                const maxError = data.payment.setFeeMax !== '' && data.payment.setFeeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal;
                return (
                  <Field label="Set Fee">
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <View style={{ width: 100 }}>
                        <CurrencyInput value={data.payment.setFeeMin} onChangeText={(v: string) => setPayment('setFeeMin', v)} placeholder="Min" />
                      </View>
                      <View style={{ width: 100 }}>
                        <CurrencyInput value={data.payment.setFeeMax} onChangeText={(v: string) => setPayment('setFeeMax', v)} placeholder="Max" error={maxError} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Select options={['Per band', 'Per set', 'Per hour']} value={data.payment.feeBasis} onSelect={(v: string) => setPayment('feeBasis', v)} />
                      </View>
                    </View>
                    {maxError && (
                      <Text style={{ fontSize: 12, color: Colors.danger, marginTop: 6 }}>Max must be higher than min.</Text>
                    )}
                  </Field>
                );
              })()}

              {data.payment.models.includes('Door Split') && (
                <>
                  <Field label="Door Split">
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 3 }}>
                        <Input value={data.payment.doorSplit} onChangeText={(v: string) => setPayment('doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" />
                      </View>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 14, color: Colors.grey, marginRight: 2 }}>$</Text>
                        <TextInput
                          style={{ flex: 1, fontSize: 14, color: colors.black, paddingVertical: 12 }}
                          value={data.payment.coverCharge}
                          onChangeText={(v: string) => setPayment('coverCharge', v)}
                          placeholder="Cover"
                          placeholderTextColor={Colors.greyLight}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                  </Field>
                </>
              )}

              {data.payment.models.includes('Ticket Sales Split') && (
                <>
                  <Field label="Ticket Sales Split Terms">
                    <Input value={data.payment.ticketSalesSplit} onChangeText={(v: string) => setPayment('ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" />
                  </Field>
                  <Field label="Ticketing Handled By">
                    <Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={data.payment.ticketingHandledBy} onSelect={(v: string) => setPayment('ticketingHandledBy', v)} />
                  </Field>
                </>
              )}

              {data.payment.models.includes('Bar Split') && (
                <Field label="Bar Split Terms">
                  <Input value={data.payment.barSplit} onChangeText={(v: string) => setPayment('barSplit', v)} placeholder="e.g. 10% of bar sales during set" />
                </Field>
              )}

              <View style={{ marginTop: 12 }}>
                <Field label="Payment Timing">
                  <Pills options={['Same night', 'Within 7 days', 'Within 30 days', 'Other']} value={data.payment.timing} onSelect={(v: string) => setPayment('timing', v)} />
                </Field>
              </View>

              {/* Invoice */}
              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.borderFaint }}>
                <Text style={[s.sectionTitle, { color: colors.black, marginBottom: 12 }]}>Invoice</Text>

                <TouchableOpacity
                  style={[s.checkRow, { borderBottomColor: colors.borderFaint }]}
                  activeOpacity={0.7}
                  onPress={() => setPayment('invoiceRequired', !data.payment.invoiceRequired)}
                >
                  <View style={[s.checkbox, { borderColor: colors.border }, data.payment.invoiceRequired && s.checkboxChecked]}>
                    {data.payment.invoiceRequired && <Text style={s.checkmark}>✓</Text>}
                  </View>
                  <Text style={[s.checkLabel, { color: colors.black }]}>Invoice Required</Text>
                </TouchableOpacity>

                <Text style={{ fontSize: 13, color: Colors.grey, marginTop: 14, marginBottom: 10, lineHeight: 19 }}>
                  Do you have a preferred invoice document? Upload it here.
                </Text>

                {data.payment.invoiceDoc ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }}>
                    <Text style={{ flex: 1, fontSize: 13, color: colors.black }} numberOfLines={1}>↓ {data.payment.invoiceDoc.name}</Text>
                    <TouchableOpacity onPress={() => setPayment('invoiceDoc', null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 14, color: '#e94560', fontWeight: '700' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={s.addBtn} onPress={pickInvoiceDocument} disabled={invoiceDocUploading}>
                    <Text style={s.addBtnText}>{invoiceDocUploading ? 'Uploading…' : '+ Upload Invoice Template'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={{ marginTop: 12 }}>
                <Field label="Deposit / Cancellation Terms">
                  <Input value={data.payment.cancellationTerms} onChangeText={(v: string) => setPayment('cancellationTerms', v)} placeholder="e.g. No deposit required. 48hr cancellation notice needed to avoid forfeiting fee." multiline />
                </Field>
              </View>

              <Field label="Additional Payment Notes">
                <Input value={data.payment.additionalNotes} onChangeText={(v: string) => setPayment('additionalNotes', v)} placeholder="Any other payment info artists should know" multiline />
              </Field>
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
            <Text style={[s.sectionTitle, { color: colors.black }]}>Timetable</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Set the recurring nights you host live music. Artists browse your timetable to find available slots and send booking enquiries. You can assign a specific room to each night so artists know where they'll be playing.</Text>
            {sortedNights(data.gigNights).map(night => {
              const i = data.gigNights.indexOf(night);
              const isOpen = expandedNight === i;
              const hasError = showErrors && (!night.day || !night.startTime || !night.startDate || (!night.continuous && !night.endDate));
              const fmtTime = (t: string) => {
                if (!t) return '';
                const [h, m] = t.split(':').map(Number);
                return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
              };
              const summaryParts = [
                night.day || 'New night',
                night.startTime ? fmtTime(night.startTime) : null,
                night.room || null,
                night.duration ? `${night.duration} min` : null,
              ].filter(Boolean).join(' · ');
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedNight(isOpen ? null : i)}>
                    <Text style={[s.cardHeaderText, { color: colors.black }]}>{summaryParts}</Text>
                    <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={{ paddingTop: 14, gap: 12 }}>
                      <Field label="Day *">
                        <Pills options={CANONICAL_DAYS} value={night.day} onSelect={(v: string) => setNight(i, 'day', v)} />
                      </Field>
                      <Field label="Slot Type">
                        <Pills options={SLOT_TYPES} value={night.slotType || 'Headline'} onSelect={(v: string) => setNight(i, 'slotType', v)} />
                      </Field>
                      {night.slotType === 'Other' && (
                        <Field label="Note for artists">
                          <Input value={night.notes} onChangeText={(v: string) => setNight(i, 'notes', v)} placeholder="Describe this slot e.g. support act, acoustic set, residency..." multiline />
                        </Field>
                      )}
                      {data.rooms.length > 0 && (
                        <Field label="Room">
                          <Pills options={['Any room', ...data.rooms.map(r => r.name).filter(Boolean)]} value={night.room || 'Any room'} onSelect={(v: string) => setNight(i, 'room', v === 'Any room' ? '' : v)} />
                        </Field>
                      )}
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 2 }}>
                          <Field label="Start Time *" error={showErrors && !night.startTime}>
                            <TimePicker value={night.startTime} onChange={(v: string) => setNightFields(i, { startTime: v, loadIn: subtractMinutes(v, 150), soundcheck: subtractMinutes(v, 90) })} defaultValue="19:00" />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="Per Set Duration (Min)">
                            <Input value={night.duration > 0 ? String(night.duration) : ''} onChangeText={(v: string) => setNight(i, 'duration', Number(v) || 0)} keyboardType="numeric" placeholder="60" />
                          </Field>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Load-in Time">
                            <TimePicker value={night.loadIn} onChange={(v: string) => setNight(i, 'loadIn', v)} />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="Soundcheck">
                            <TimePicker value={night.soundcheck} onChange={(v: string) => setNight(i, 'soundcheck', v)} />
                          </Field>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Start Date *" error={showErrors && !night.startDate}>
                            <DatePicker value={night.startDate} onChange={(v: string) => setNight(i, 'startDate', v)} />
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
                        </View>
                        {!night.continuous && (
                          <View style={{ flex: 1 }}>
                            <Field label="End Date *" error={showErrors && !night.endDate}>
                              <DatePicker value={night.endDate} onChange={(v: string) => setNight(i, 'endDate', v)} />
                            </Field>
                          </View>
                        )}
                      </View>
                      {data.payment.models.length > 0 ? (
                        <Field label="Payment">
                          <Pills
                            options={data.payment.models}
                            value={night.paymentModels || (night.paymentModel ? [night.paymentModel] : [])}
                            onSelect={(newModels: string[]) => {
                              const current = night.paymentModels || (night.paymentModel ? [night.paymentModel] : []);
                              const added = newModels.find(m => !current.includes(m));
                              const prefill: Partial<Night> = { paymentModels: newModels, paymentModel: '' };
                              if (added === 'Set Fee') {
                                prefill.feeMin = data.payment.setFeeMin;
                                prefill.feeMax = data.payment.setFeeMax;
                                prefill.feeBasis = data.payment.feeBasis;
                              } else if (added === 'Door Split') {
                                prefill.doorSplit = data.payment.doorSplit;
                                prefill.coverCharge = data.payment.coverCharge;
                              } else if (added === 'Bar Split') {
                                prefill.barSplit = data.payment.barSplit;
                              } else if (added === 'Ticket Sales Split') {
                                prefill.ticketSalesSplit = data.payment.ticketSalesSplit;
                                prefill.ticketingHandledBy = data.payment.ticketingHandledBy;
                              }
                              setNightFields(i, prefill);
                            }}
                            multi
                          />
                          {(() => { const activeModels = night.paymentModels || (night.paymentModel ? [night.paymentModel] : []); return activeModels.includes('Set Fee'); })() && (() => {
                            const minVal = parseFloat(night.feeMin);
                            const maxVal = parseFloat(night.feeMax);
                            const maxError = night.feeMax !== '' && night.feeMin !== '' && !isNaN(minVal) && !isNaN(maxVal) && maxVal < minVal;
                            return (
                              <View style={{ marginTop: 10, gap: 8 }}>
                                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                  <View style={{ width: 100 }}>
                                    <CurrencyInput value={night.feeMin} onChangeText={(v: string) => setNight(i, 'feeMin', v)} placeholder="Min" />
                                  </View>
                                  <View style={{ width: 100 }}>
                                    <CurrencyInput value={night.feeMax} onChangeText={(v: string) => setNight(i, 'feeMax', v)} placeholder="Max" error={maxError} />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Select options={['Per band', 'Per set', 'Per hour']} value={night.feeBasis} onSelect={(v: string) => setNight(i, 'feeBasis', v)} />
                                  </View>
                                </View>
                                {maxError && (
                                  <Text style={{ fontSize: 12, color: Colors.danger }}>Max must be higher than min.</Text>
                                )}
                              </View>
                            );
                          })()}
                          {(night.paymentModels || (night.paymentModel ? [night.paymentModel] : [])).includes('Door Split') && (
                            <View style={{ marginTop: 10, gap: 8 }}>
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <View style={{ flex: 3 }}>
                                  <Input value={night.doorSplit} onChangeText={(v: string) => setNight(i, 'doorSplit', v)} placeholder="e.g. 70/30 artist/venue after $200 covered" />
                                </View>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10 }}>
                                  <Text style={{ fontSize: 14, color: Colors.grey, marginRight: 2 }}>$</Text>
                                  <TextInput
                                    style={{ flex: 1, fontSize: 14, color: colors.black, paddingVertical: 12 }}
                                    value={night.coverCharge}
                                    onChangeText={(v: string) => setNight(i, 'coverCharge', v)}
                                    placeholder="Cover"
                                    placeholderTextColor={Colors.greyLight}
                                    keyboardType="numeric"
                                  />
                                </View>
                              </View>
                            </View>
                          )}
                          {(night.paymentModels || (night.paymentModel ? [night.paymentModel] : [])).includes('Bar Split') && (
                            <View style={{ marginTop: 10 }}>
                              <Input value={night.barSplit} onChangeText={(v: string) => setNight(i, 'barSplit', v)} placeholder="e.g. 10% of bar sales during set" />
                            </View>
                          )}
                          {(night.paymentModels || (night.paymentModel ? [night.paymentModel] : [])).includes('Ticket Sales Split') && (
                            <View style={{ marginTop: 10, gap: 8 }}>
                              <Input value={night.ticketSalesSplit} onChangeText={(v: string) => setNight(i, 'ticketSalesSplit', v)} placeholder="e.g. 80% of ticket sales via venue's platform" />
                              <Pills options={['Venue', 'Artist', 'Third-party (Moshtix, Eventbrite, etc.)']} value={night.ticketingHandledBy} onSelect={(v: string) => setNight(i, 'ticketingHandledBy', v)} />
                            </View>
                          )}
                        </Field>
                      ) : (
                        <View style={{ paddingVertical: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.grey, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Payment</Text>
                          <Text style={{ fontSize: 13, color: Colors.grey, fontStyle: 'italic', marginBottom: 8 }}>Set up payment models in Basic Info first.</Text>
                          <TouchableOpacity
                            onPress={() => setActiveTab('Basic Info')}
                            style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                          >
                            <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }}>+ Add</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      <Field label="Genres">
                        <Pills
                          options={GENRES}
                          value={night.genres || []}
                          onSelect={(v: string[]) => setNight(i, 'genres', v)}
                          multi
                        />
                      </Field>
                      <View style={s.itemBtnRow}>
                        <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeNight(i)}>
                          <Text style={s.removeBtnText}>Remove Gig</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}>
                          <Text style={s.itemSaveBtnText}>{night._isNew ? 'Add Gig' : 'Save'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
            {data.gigNights.length < 7 && (
              <TouchableOpacity style={s.addBtn} onPress={addNight}>
                <Text style={s.addBtnText}>+ Add Gig</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── TECH SPECS ── */}
        {activeTab === 'Tech Specs' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Specs</Text>
            <Text style={{ fontSize: 13, color: Colors.grey, marginBottom: 16, lineHeight: 19 }}>Venue-wide info that's true regardless of which room an artist plays. PA, lighting, and stage dimensions are entered per room.</Text>

            <Field label="Documents">
              {(data.techSpecs?.documents || []).map((doc: { url: string; name: string }, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name || doc.url}</Text>
                  <TouchableOpacity style={s.removeBtn} onPress={() => set('techSpecs', { ...data.techSpecs, documents: (data.techSpecs?.documents || []).filter((_: any, i: number) => i !== idx) })}>
                    <Text style={s.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={s.addBtn} onPress={pickDocument} disabled={docUploading}>
                <Text style={s.addBtnText}>{docUploading ? 'Uploading…' : '+ Add Document'}</Text>
              </TouchableOpacity>
            </Field>

            <Field label="Backline">
              <Input value={data.techSpecs?.backline || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, backline: v })} placeholder="e.g. house drum kit, 2x guitar amps" />
            </Field>
            <Field label="Monitoring">
              <Input value={data.techSpecs?.monitoring || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, monitoring: v })} placeholder="e.g. 4x wedges, 2 mixes" />
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
                  placeholder="e.g. included, or available at cost"
                />
              </View>
            )}

            <Field label="Power">
              <Input value={data.techSpecs?.power || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, power: v })} placeholder="e.g. 4x 15A outlets on stage" />
            </Field>
            <Field label="Load-in & Parking">
              <Input value={data.techSpecs?.loadInParking || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, loadInParking: v })} placeholder="e.g. rear loading dock, street parking only" />
            </Field>
            <Field label="Curfew / Noise Restrictions">
              <Input value={data.techSpecs?.curfew || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, curfew: v })} placeholder="e.g. 11pm hard curfew, council noise limit" />
            </Field>

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
                  placeholder="Any additional info"
                />
              )}
            </Field>
            <Field label="Notes for Acts">
              <Input value={data.techSpecs?.notes || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, notes: v })} placeholder="Any additional info" multiline />
            </Field>
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
