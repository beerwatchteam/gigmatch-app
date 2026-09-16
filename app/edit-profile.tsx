import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform, Modal, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { db, storage, auth } from '@/lib/firebase';
import { signOut, deleteUser } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { RepositionablePhoto } from '@/components/RepositionablePhoto';

const GENRES    = ['Rock','Jazz','Blues','Pop','Indie','Electronic / DJ','Hip-Hop','Country','Acoustic / Folk','Cover Bands','Original','Classical','Metal','Other'];
const ACT_TYPES   = ['Solo Artist','Duo','Trio','Band','Cover Band','Acoustic Act','DJ','Choir / Vocal Group','Other'];
const INSTRUMENTS = ['Vocals','Guitar (Acoustic)','Guitar (Electric)','Bass','Drums','Keys / Piano','Violin / Strings','Saxophone','Trumpet / Brass','Trombone','Harmonica','Banjo / Mandolin','Ukulele','Cello','Flute','Synth / Sampler','Turntables / CDJs','Percussion','Other'];
const PLATFORMS = [
  { key: 'instagram',  label: 'Instagram',   placeholder: 'Profile URL or a post/reel URL to embed' },
  { key: 'tiktok',     label: 'TikTok',      placeholder: 'TikTok profile URL' },
  { key: 'spotify',    label: 'Spotify',     placeholder: 'Artist, track, album or playlist URL' },
  { key: 'appleMusic', label: 'Apple Music', placeholder: 'Apple Music URL' },
];
const TABS = ['Settings','Basic Info','About','Music','Past Gigs','Timetable','Tech Rider','Photos'];

type Song    = { title: string; url: string; notes: string };
type Gig     = { venue: string; suburb: string; date: string; endDate?: string; notes: string; attendance?: string; socialPostUrl?: string; ticketUrl?: string; type?: 'gig' | 'away' | 'free'; _isNew?: boolean };
type Profile = {
  name: string; username: string; artistType: string; otherArtistType: string;
  genre: string[]; otherGenres: string; instruments: string[]; location: string;
  email: string; phone: string; feeMin: string; feeMax: string; averageDraw: string;
  about: string; photoUrl: string; photoPosition: { x: number; y: number };
  instagram: string; tiktok: string; spotify: string; appleMusic: string;
  customLinks: { label: string; url: string }[];
  songs: Song[]; gigHistory: Gig[]; upcomingGigs: Gig[];
  techRider: Record<string, string>;
  techRiderDocs: { url: string; name: string }[];
  photos: string[]; videos: string[];
  settings: { emailOnEnquiryResponse: boolean; emailOnNewConnection: boolean; listed: boolean };
};

const BLANK: Profile = {
  name: '', username: '', artistType: '', otherArtistType: '', genre: [], otherGenres: '', instruments: [], location: '', email: '', phone: '',
  feeMin: '', feeMax: '', averageDraw: '', about: '', photoUrl: '', photoPosition: { x: 50, y: 50 },
  instagram: '', tiktok: '', spotify: '', appleMusic: '',
  customLinks: [], songs: [], gigHistory: [], upcomingGigs: [],
  techRider: {}, techRiderDocs: [], photos: [], videos: [],
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
  const { uid: uidParam } = useLocalSearchParams<{ uid?: string }>();
  const uid = uidParam ?? user?.uid ?? '';

  const originalUsername = useRef('');

  const [profile, setProfile] = useState<Profile>(BLANK);
  const [saved,   setSaved]   = useState<Profile>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors,  setTabErrors]  = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [showStickySave, setShowStickySave] = useState(false);
  const titleBarBottomRef = useRef(Infinity);

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
      d.gigHistory  = d.gigHistory  || [];
      d.upcomingGigs = d.upcomingGigs || [];
      d.photos      = d.photos      || [];
      d.videos      = d.videos      || [];
      d.techRiderDocs = d.techRiderDocs || [];
      d.customLinks = d.customLinks || [];
      d.settings    = d.settings    || BLANK.settings;
      originalUsername.current = d.username || '';
      setProfile(d); setSaved(d);
    }).finally(() => setLoading(false));
  }, [uid]);

  function set<K extends keyof Profile>(field: K, value: Profile[K]) {
    setJustSaved(false);
    setProfile(prev => ({ ...prev, [field]: value }));
  }

  // ── Songs ──
  function setSong(i: number, field: keyof Song, val: string) {
    setProfile(prev => ({ ...prev, songs: prev.songs.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }));
  }
  function addSong() { setProfile(prev => ({ ...prev, songs: [...prev.songs, { title: '', url: '', notes: '' }] })); }
  function removeSong(i: number) { setProfile(prev => ({ ...prev, songs: prev.songs.filter((_, idx) => idx !== i) })); }

  // ── Gig History ──
  function setGig(i: number, field: keyof Gig, val: string) {
    setProfile(prev => ({ ...prev, gigHistory: prev.gigHistory.map((g, idx) => idx === i ? { ...g, [field]: val } : g) }));
  }
  function addGig() { setProfile(prev => ({ ...prev, gigHistory: [{ venue: '', suburb: '', date: '', notes: '', attendance: '', _isNew: true }, ...prev.gigHistory] })); }
  function removeGig(i: number) { setProfile(prev => ({ ...prev, gigHistory: prev.gigHistory.filter((_, idx) => idx !== i) })); }

  // ── Upcoming ──
  function setUpcoming(i: number, field: keyof Gig, val: string) {
    setProfile(prev => ({ ...prev, upcomingGigs: prev.upcomingGigs.map((g, idx) => idx === i ? { ...g, [field]: val } : g) }));
  }
  function addUpcoming() { setProfile(prev => ({ ...prev, upcomingGigs: [...prev.upcomingGigs, { venue: '', suburb: '', date: '', notes: '', socialPostUrl: '', ticketUrl: '', type: 'gig' as const, _isNew: true }] })); }
  function removeUpcoming(i: number) { setProfile(prev => ({ ...prev, upcomingGigs: prev.upcomingGigs.filter((_, idx) => idx !== i) })); }

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
    if (profile.gigHistory.some(g => !g.venue?.trim() || !g.suburb?.trim() || !g.date?.trim()))
      errors.push('Past Gigs');
    if (profile.upcomingGigs.some(g => !g.date?.trim() || ((g.type || 'gig') === 'gig' && (!g.venue?.trim() || !g.suburb?.trim()))))
      errors.push('Timetable');

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
        gigHistory:   profile.gigHistory.map(({ _isNew, ...g }: any) => g),
        upcomingGigs: profile.upcomingGigs.map(({ _isNew, ...g }: any) => g),
      };
      await setDoc(doc(db, 'bandProfiles', uid), payload, { merge: true });
      // Also update username in users doc
      await updateDoc(doc(db, 'users', uid), { username: newUsername });
      originalUsername.current = newUsername;
      setSaved(profile);
      setProfile(prev => ({
        ...prev,
        gigHistory:   prev.gigHistory.map(({ _isNew, ...g }: any) => g),
        upcomingGigs: prev.upcomingGigs.map(({ _isNew, ...g }: any) => g),
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
                  {tabErrors.includes(tab) && <View style={epd.navErrorDot} />}
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
                  <Text style={[s.dangerDesc, { color: colors.black }]}>Deactivating your listing will hide it from all venues browsing GigMatch. This action can be reversed at any time.</Text>
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
                  <View style={{ marginBottom: 14 }}><Input value={profile.location} onChangeText={(v: string) => set('location', v)} placeholder="Location *" error={showErrors && !profile.location?.trim()} /></View>
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
                <Text style={s.hint}>Show venues where you've played. A solid track record builds credibility and gives bookers confidence in your professionalism.</Text>
                {profile.gigHistory.map((gig, i) => {
                  const hasError = showErrors && (!gig.venue?.trim() || !gig.suburb?.trim() || !gig.date?.trim());
                  return (
                    <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput style={[s.input, { flex: 2 }, showErrors && !gig.venue?.trim() ? s.inputError : {}]} value={gig.venue} onChangeText={v => setGig(i, 'venue', v)} placeholder="Venue / Event *" placeholderTextColor={Colors.greyLight} />
                        <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.suburb?.trim() ? s.inputError : {}]} value={gig.suburb} onChangeText={v => setGig(i, 'suburb', v)} placeholder="Suburb *" placeholderTextColor={Colors.greyLight} />
                      </View>
                      <View style={{ height: 8 }} />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}><DatePicker value={gig.date} onChange={v => setGig(i, 'date', v)} /></View>
                        <TextInput style={[s.input, { flex: 1 }]} value={gig.attendance || ''} onChangeText={v => setGig(i, 'attendance', v)} placeholder="Attendance" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                      </View>
                      <View style={{ height: 8 }} />
                      <TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setGig(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                      <View style={s.itemBtnRow}>
                        <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeGig(i)}><Text style={s.removeBtnText}>Remove Gig</Text></TouchableOpacity>
                        <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}><Text style={s.itemSaveBtnText}>{gig._isNew ? 'Add Gig' : 'Save'}</Text></TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
                <TouchableOpacity style={s.addBtn} onPress={addGig}><Text style={s.addBtnText}>+ Add Gig</Text></TouchableOpacity>
              </View>
            )}

            {activeTab === 'Timetable' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Timetable</Text>
                <Text style={s.hint}>Let venues know where you're already booked. It shows you're active and in demand — and helps them spot scheduling conflicts early.</Text>
                {profile.upcomingGigs.map((gig, i) => {
                  const entryType = gig.type || 'gig';
                  const hasError = showErrors && (!gig.date?.trim() || (entryType === 'gig' && (!gig.venue?.trim() || !gig.suburb?.trim())));
                  return (
                    <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                      <Field label="Type"><Pills options={['Gig', 'Away']} value={entryType === 'away' ? 'Away' : 'Gig'} onSelect={(v: string) => setUpcoming(i, 'type', v.toLowerCase() as 'gig' | 'away')} /></Field>
                      {entryType === 'gig' && (<><View style={{ height: 10 }} /><View style={{ flexDirection: 'row', gap: 8 }}><TextInput style={[s.input, { flex: 2 }, showErrors && !gig.venue?.trim() ? s.inputError : {}]} value={gig.venue} onChangeText={v => setUpcoming(i, 'venue', v)} placeholder="Venue / Event *" placeholderTextColor={Colors.greyLight} /><TextInput style={[s.input, { flex: 1 }, showErrors && !gig.suburb?.trim() ? s.inputError : {}]} value={gig.suburb} onChangeText={v => setUpcoming(i, 'suburb', v)} placeholder="Suburb *" placeholderTextColor={Colors.greyLight} /></View></>)}
                      <View style={{ height: 8 }} />
                      {entryType === 'away' ? (
                        <><View style={{ flexDirection: 'row', gap: 8 }}><View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}><DatePicker value={gig.date} onChange={v => setUpcoming(i, 'date', v)} placeholder="From" /></View><View style={{ flex: 1 }}><DatePicker value={gig.endDate || ''} onChange={v => setUpcoming(i, 'endDate', v)} placeholder="To (optional)" /></View></View><View style={{ height: 8 }} /><TextInput style={s.input} value={gig.notes} onChangeText={v => setUpcoming(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} /></>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 8 }}><View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}><DatePicker value={gig.date} onChange={v => setUpcoming(i, 'date', v)} /></View><TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setUpcoming(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} /></View>
                      )}
                      {entryType === 'gig' && (<><View style={{ height: 8 }} /><TextInput style={s.input} value={gig.socialPostUrl || ''} onChangeText={v => setUpcoming(i, 'socialPostUrl', v)} placeholder="Social post link (Instagram, Facebook, etc.)" placeholderTextColor={Colors.greyLight} autoCapitalize="none" keyboardType="url" /><View style={{ height: 8 }} /><TextInput style={s.input} value={gig.ticketUrl || ''} onChangeText={v => setUpcoming(i, 'ticketUrl', v)} placeholder="Ticket link (Moshtix, Eventbrite, etc.)" placeholderTextColor={Colors.greyLight} autoCapitalize="none" keyboardType="url" /></>)}
                      <View style={s.itemBtnRow}>
                        <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeUpcoming(i)}><Text style={s.removeBtnText}>Remove</Text></TouchableOpacity>
                        <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}><Text style={s.itemSaveBtnText}>{gig._isNew ? 'Add' : 'Save'}</Text></TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
                <TouchableOpacity style={s.addBtn} onPress={addUpcoming}><Text style={s.addBtnText}>+ Add Gig</Text></TouchableOpacity>
              </View>
            )}

            {activeTab === 'Tech Rider' && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Rider</Text>
                <Text style={s.hint}>Your tech rider is basically your "here's what I need to play" sheet: your stage setup, backline, mics/DI boxes, power, and sound requirements.{'\n\n'}Having it on your profile means venues can see straight away whether their space can handle your set (or what they'd need to sort out) before you even message them, so you skip the back-and-forth and only get enquiries from venues that are actually a good fit.</Text>
                <Field label="Tech Spec / Hospitality Rider Documents">
                  {(profile.techRiderDocs || []).map((doc, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name}</Text>
                      <TouchableOpacity style={s.removeInlineBtn} onPress={() => set('techRiderDocs', (profile.techRiderDocs || []).filter((_, i) => i !== idx))}><Text style={s.removeInlineBtnText}>Remove</Text></TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addBtn} onPress={pickDocument} disabled={docUploading}><Text style={s.addBtnText}>{docUploading ? 'Uploading…' : '+ Upload Spec Sheet (PDF)'}</Text></TouchableOpacity>
                </Field>
                {[
                  { field: 'monitoring',     label: 'Monitoring',       placeholder: 'e.g. 3 separate monitor mixes' },
                  { field: 'backlineNeeded', label: 'Backline needed',  placeholder: 'e.g. Drum kit only' },
                  { field: 'stageSize',      label: 'Stage size',       placeholder: 'e.g. Minimum 4m × 3m' },
                  { field: 'soundcheck',     label: 'Soundcheck time',  placeholder: 'e.g. 45 minutes' },
                ].map(({ field: f, label, placeholder }) => (
                  <Field key={f} label={label}><Input value={profile.techRider?.[f] || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, [f]: v })} placeholder={placeholder} /></Field>
                ))}
                <Field label="Notes"><Input value={profile.techRider?.notes || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, notes: v })} placeholder="Any additional notes for the venue's sound team" multiline /></Field>
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
                Deactivating your listing will hide it from all venues browsing GigMatch. This action can be reversed at any time.
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
                <Input value={profile.location} onChangeText={(v: string) => set('location', v)} placeholder="Location *" error={showErrors && !profile.location?.trim()} />
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
            <Text style={s.hint}>Show venues where you've played. A solid track record builds credibility and gives bookers confidence in your professionalism.</Text>
            {profile.gigHistory.map((gig, i) => {
              const hasError = showErrors && (!gig.venue?.trim() || !gig.suburb?.trim() || !gig.date?.trim());
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[s.input, { flex: 2 }, showErrors && !gig.venue?.trim() ? s.inputError : {}]} value={gig.venue} onChangeText={v => setGig(i, 'venue', v)} placeholder="Venue / Event *" placeholderTextColor={Colors.greyLight} />
                    <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.suburb?.trim() ? s.inputError : {}]} value={gig.suburb} onChangeText={v => setGig(i, 'suburb', v)} placeholder="Suburb *" placeholderTextColor={Colors.greyLight} />
                  </View>
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}>
                      <DatePicker value={gig.date} onChange={v => setGig(i, 'date', v)} />
                    </View>
                    <TextInput style={[s.input, { flex: 1 }]} value={gig.attendance || ''} onChangeText={v => setGig(i, 'attendance', v)} placeholder="Attendance" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                  </View>
                  <View style={{ height: 8 }} />
                  <TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setGig(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                  <View style={s.itemBtnRow}>
                    <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeGig(i)}>
                      <Text style={s.removeBtnText}>Remove Gig</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}>
                      <Text style={s.itemSaveBtnText}>{gig._isNew ? 'Add Gig' : 'Save'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={addGig}>
              <Text style={s.addBtnText}>+ Add Gig</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── UPCOMING ── */}
        {activeTab === 'Timetable' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Timetable</Text>
            <Text style={s.hint}>Let venues know where you're already booked. It shows you're active and in demand — and helps them spot scheduling conflicts early.</Text>
            {profile.upcomingGigs.map((gig, i) => {
              const entryType = gig.type || 'gig';
              const hasError = showErrors && (!gig.date?.trim() || (entryType === 'gig' && (!gig.venue?.trim() || !gig.suburb?.trim())));
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <Field label="Type">
                    <Pills
                      options={['Gig', 'Away']}
                      value={entryType === 'away' ? 'Away' : 'Gig'}
                      onSelect={(v: string) => setUpcoming(i, 'type', v.toLowerCase() as 'gig' | 'away')}
                    />
                  </Field>
                  {entryType === 'gig' && (
                    <>
                      <View style={{ height: 10 }} />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput style={[s.input, { flex: 2 }, showErrors && !gig.venue?.trim() ? s.inputError : {}]} value={gig.venue} onChangeText={v => setUpcoming(i, 'venue', v)} placeholder="Venue / Event *" placeholderTextColor={Colors.greyLight} />
                        <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.suburb?.trim() ? s.inputError : {}]} value={gig.suburb} onChangeText={v => setUpcoming(i, 'suburb', v)} placeholder="Suburb *" placeholderTextColor={Colors.greyLight} />
                      </View>
                    </>
                  )}
                  <View style={{ height: 8 }} />
                  {entryType === 'away' ? (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}>
                          <DatePicker value={gig.date} onChange={v => setUpcoming(i, 'date', v)} placeholder="From" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <DatePicker value={gig.endDate || ''} onChange={v => setUpcoming(i, 'endDate', v)} placeholder="To (optional)" />
                        </View>
                      </View>
                      <View style={{ height: 8 }} />
                      <TextInput style={s.input} value={gig.notes} onChangeText={v => setUpcoming(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                    </>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={[{ flex: 1 }, showErrors && !gig.date?.trim() ? { borderColor: Colors.danger, borderWidth: 1, borderRadius: 10 } : {}]}>
                        <DatePicker value={gig.date} onChange={v => setUpcoming(i, 'date', v)} />
                      </View>
                      <TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setUpcoming(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                    </View>
                  )}
                  {entryType === 'gig' && (
                    <>
                      <View style={{ height: 8 }} />
                      <TextInput style={s.input} value={gig.socialPostUrl || ''} onChangeText={v => setUpcoming(i, 'socialPostUrl', v)} placeholder="Social post link (Instagram, Facebook, etc.)" placeholderTextColor={Colors.greyLight} autoCapitalize="none" keyboardType="url" />
                      <View style={{ height: 8 }} />
                      <TextInput style={s.input} value={gig.ticketUrl || ''} onChangeText={v => setUpcoming(i, 'ticketUrl', v)} placeholder="Ticket link (Moshtix, Eventbrite, etc.)" placeholderTextColor={Colors.greyLight} autoCapitalize="none" keyboardType="url" />
                    </>
                  )}
                  <View style={s.itemBtnRow}>
                    <TouchableOpacity style={[s.removeBtn, { flex: 1, marginTop: 0 }]} onPress={() => removeUpcoming(i)}>
                      <Text style={s.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.itemSaveBtn} onPress={handleSave}>
                      <Text style={s.itemSaveBtnText}>{gig._isNew ? 'Add' : 'Save'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={addUpcoming}>
              <Text style={s.addBtnText}>+ Add Gig</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── TECH SPECS ── */}
        {activeTab === 'Tech Rider' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.black }]}>Tech Rider</Text>
            <Text style={s.hint}>Your tech rider is basically your "here's what I need to play" sheet: your stage setup, backline, mics/DI boxes, power, and sound requirements.{'\n\n'}Having it on your profile means venues can see straight away whether their space can handle your set (or what they'd need to sort out) before you even message them, so you skip the back-and-forth and only get enquiries from venues that are actually a good fit.</Text>

            <Field label="Tech Spec / Hospitality Rider Documents">
              {(profile.techRiderDocs || []).map((doc, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={[{ flex: 1, fontSize: 13 }, { color: colors.black }]} numberOfLines={1}>↓ {doc.name}</Text>
                  <TouchableOpacity
                    style={s.removeInlineBtn}
                    onPress={() => set('techRiderDocs', (profile.techRiderDocs || []).filter((_, i) => i !== idx))}
                  >
                    <Text style={s.removeInlineBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={s.addBtn} onPress={pickDocument} disabled={docUploading}>
                <Text style={s.addBtnText}>{docUploading ? 'Uploading…' : '+ Upload Spec Sheet (PDF)'}</Text>
              </TouchableOpacity>
            </Field>

            {[
              { field: 'monitoring',     label: 'Monitoring',       placeholder: 'e.g. 3 separate monitor mixes' },
              { field: 'backlineNeeded', label: 'Backline needed',  placeholder: 'e.g. Drum kit only' },
              { field: 'stageSize',      label: 'Stage size',       placeholder: 'e.g. Minimum 4m × 3m' },
              { field: 'soundcheck',     label: 'Soundcheck time',  placeholder: 'e.g. 45 minutes' },
            ].map(({ field: f, label, placeholder }) => (
              <Field key={f} label={label}>
                <Input value={profile.techRider?.[f] || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, [f]: v })} placeholder={placeholder} />
              </Field>
            ))}
            <Field label="Notes">
              <Input value={profile.techRider?.notes || ''} onChangeText={(v: string) => set('techRider', { ...profile.techRider, notes: v })} placeholder="Any additional notes for the venue's sound team" multiline />
            </Field>
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
  saveBtn:       { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  saveBtnText:   { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  backBtn:       { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  backBtnText:   { fontSize: 13, fontWeight: '600' },
  main:          { flex: 1 },
  mainContent:   { paddingHorizontal: 40, paddingVertical: 32, paddingBottom: 60 },
});
