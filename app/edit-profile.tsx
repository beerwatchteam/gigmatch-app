import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, storage, auth } from '@/lib/firebase';
import { signOut, deleteUser } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const GENRES    = ['Rock','Jazz','Blues','Pop','Indie','Electronic / DJ','Hip-Hop','Country','Acoustic / Folk','Cover Bands','Original','Classical','Metal','Other'];
const ACT_TYPES = ['Band','Solo','Duo','DJ','Other'];
const PLATFORMS = [
  { key: 'instagram',  label: 'Instagram' },
  { key: 'tiktok',     label: 'TikTok' },
  { key: 'spotify',    label: 'Spotify' },
  { key: 'appleMusic', label: 'Apple Music' },
];
const TABS = ['Settings','Basic Info','About','Music','Gig History','Upcoming','Tech Specs','Photos'];

type Song    = { title: string; url: string; notes: string };
type Gig     = { venue: string; suburb: string; date: string; notes: string; attendance?: string };
type Profile = {
  name: string; username: string; artistType: string; otherArtistType: string;
  genre: string[]; otherGenres: string; location: string;
  email: string; phone: string; feeMin: string; feeMax: string;
  about: string; photoUrl: string;
  instagram: string; tiktok: string; spotify: string; appleMusic: string;
  customLinks: { label: string; url: string }[];
  songs: Song[]; gigHistory: Gig[]; upcomingGigs: Gig[];
  techRider: Record<string, string>;
  photos: string[]; videos: string[];
  settings: { emailOnEnquiryResponse: boolean; emailOnNewConnection: boolean; listed: boolean };
};

const BLANK: Profile = {
  name: '', username: '', artistType: '', otherArtistType: '', genre: [], otherGenres: '', location: '', email: '', phone: '',
  feeMin: '', feeMax: '', about: '', photoUrl: '',
  instagram: '', tiktok: '', spotify: '', appleMusic: '',
  customLinks: [], songs: [], gigHistory: [], upcomingGigs: [],
  techRider: {}, photos: [], videos: [],
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
            <Text style={[s.pillText, { color: colors.grey }, active && s.pillTextActive]}>{opt}</Text>
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

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark, toggleDark } = useTheme();
  const uid = user?.uid ?? '';

  const originalUsername = useRef('');

  const [profile, setProfile] = useState<Profile>(BLANK);
  const [saved,   setSaved]   = useState<Profile>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [activeTab, setActiveTab] = useState('Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors,  setTabErrors]  = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    getDoc(doc(db, 'bandProfiles', uid)).then(snap => {
      const d = snap.exists() ? { ...BLANK, ...snap.data() } as Profile : BLANK;
      d.songs       = d.songs       || [];
      d.gigHistory  = d.gigHistory  || [];
      d.upcomingGigs = d.upcomingGigs || [];
      d.photos      = d.photos      || [];
      d.videos      = d.videos      || [];
      d.customLinks = d.customLinks || [];
      d.settings    = d.settings    || BLANK.settings;
      originalUsername.current = d.username || '';
      setProfile(d); setSaved(d);
    }).finally(() => setLoading(false));
  }, [uid]);

  function set<K extends keyof Profile>(field: K, value: Profile[K]) {
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
  function addGig() { setProfile(prev => ({ ...prev, gigHistory: [...prev.gigHistory, { venue: '', suburb: '', date: '', notes: '', attendance: '' }] })); }
  function removeGig(i: number) { setProfile(prev => ({ ...prev, gigHistory: prev.gigHistory.filter((_, idx) => idx !== i) })); }

  // ── Upcoming ──
  function setUpcoming(i: number, field: keyof Gig, val: string) {
    setProfile(prev => ({ ...prev, upcomingGigs: prev.upcomingGigs.map((g, idx) => idx === i ? { ...g, [field]: val } : g) }));
  }
  function addUpcoming() { setProfile(prev => ({ ...prev, upcomingGigs: [...prev.upcomingGigs, { venue: '', suburb: '', date: '', notes: '' }] })); }
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
      errors.push('Gig History');
    if (profile.upcomingGigs.some(g => !g.venue?.trim() || !g.suburb?.trim() || !g.date?.trim()))
      errors.push('Upcoming');

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
      await setDoc(doc(db, 'bandProfiles', uid), { ...profile, username: newUsername }, { merge: true });
      // Also update username in users doc
      await updateDoc(doc(db, 'users', uid), { username: newUsername });
      originalUsername.current = newUsername;
      setSaved(profile);
      setShowErrors(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    const isDirty = JSON.stringify(profile) !== JSON.stringify(saved);
    if (isDirty) {
      Alert.alert('Unsaved changes', 'Any unsaved changes will be lost. Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    const hasErrors =
      !profile.name?.trim() || !profile.username?.trim() || !profile.artistType?.trim() ||
      (profile.artistType === 'Other' && !profile.otherArtistType?.trim()) ||
      !(profile.genre?.length > 0) || !profile.location?.trim() || !profile.email?.trim() ||
      !profile.about?.trim();
    if (hasErrors) {
      setShowErrors(true);
      Alert.alert('Profile incomplete', 'Some required fields are missing. Your profile won\'t be visible until complete.', [
        { text: 'Stay & Complete', style: 'cancel' },
        { text: 'Leave Anyway', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  }

  const errStyle = (bad: boolean) => bad ? { borderColor: Colors.danger, backgroundColor: 'rgba(233,69,96,0.04)' } : {};

  if (loading) return <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false}>

        {/* ── Banner + title bar + tab errors ── */}
        <View>
          <TouchableOpacity onPress={pickBannerPhoto} style={s.banner}>
            {profile.photoUrl
              ? <Image source={{ uri: profile.photoUrl }} style={s.bannerImg} />
              : <View style={s.bannerPlaceholder}>
                  <Text style={s.bannerPlaceholderText}>{photoUploading ? 'Uploading…' : 'Tap to add profile photo'}</Text>
                </View>
            }
            <View style={s.bannerEditBadge}><Text style={s.bannerEditBadgeText}>{profile.photoUrl ? 'Change photo' : '+ Photo'}</Text></View>
          </TouchableOpacity>

          <View style={[s.titleBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.headerTitle, { color: colors.black }]}>Edit Profile</Text>
              <Text style={[s.headerSub, { color: colors.grey }]}>{profile.name || '—'}</Text>
            </View>
            <View style={s.headerBtns}>
              <TouchableOpacity style={[s.backBtnInline, { borderColor: colors.border }]} onPress={handleBack}>
                <Text style={[s.backBtnInlineText, { color: colors.grey }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.tabBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]} contentContainerStyle={s.tabBarContent}>
          {TABS.map(tab => (
            <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={[s.tab, activeTab === tab && s.tabActive]}>
              <Text style={[s.tabText, { color: colors.grey }, activeTab === tab && s.tabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.body}>

        {/* ── SETTINGS ── */}
        {activeTab === 'Settings' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Notification Preferences</Text>
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

            <Text style={[s.sectionTitle, { color: colors.grey, marginTop: 24 }]}>Visibility</Text>
            <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
              <Text style={[s.toggleLabel, { color: colors.black }]}>Listed on GigMatch</Text>
              <Switch value={profile.settings.listed} onValueChange={v => set('settings', { ...profile.settings, listed: v })} trackColor={{ true: Colors.orange }} thumbColor="#fff" />
            </View>

            <Text style={[s.sectionTitle, { color: colors.grey, marginTop: 24 }]}>Account</Text>
            <TouchableOpacity style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]} onPress={toggleDark}>
              <Text style={[s.toggleLabel, { color: colors.black }]}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
              <Text style={{ fontSize: 18 }}>{isDark ? '🌙' : '☀️'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]} onPress={() => signOut(auth)}>
              <Text style={[s.toggleLabel, { color: Colors.danger }]}>Log out</Text>
            </TouchableOpacity>

            <View style={[s.dangerSection, { borderColor: Colors.danger + '44' }]}>
              <Text style={s.dangerTitle}>Danger Zone</Text>
              <Text style={[s.dangerDesc, { color: colors.grey }]}>
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
                    'Are you sure you want to delete your account? This action cannot be undone.',
                    async () => {
                      try {
                        const uid = user?.uid;
                        if (uid) await deleteDoc(doc(db, 'bandProfiles', uid));
                        if (uid) await deleteDoc(doc(db, 'users', uid));
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

            {/* Stage Details */}
            <View style={s.sectionBlock}>
              <Text style={[s.sectionTitle, { color: colors.grey }]}>Stage Details</Text>
              <Field label="Stage Name *" error={showErrors && !profile.name?.trim()}>
                <Input value={profile.name} onChangeText={(v: string) => set('name', v)} placeholder="Your stage name" error={showErrors && !profile.name?.trim()} />
              </Field>
              <Field label="Username *" error={showErrors && !profile.username?.trim()}>
                <Input value={profile.username} onChangeText={(v: string) => set('username', v.toLowerCase().replace(/\s/g, ''))} placeholder="e.g. thedahlias" error={showErrors && !profile.username?.trim()} />
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
            </View>

            {/* Contact */}
            <View style={[s.sectionBlock, { borderTopColor: colors.borderFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.grey }]}>Contact</Text>
              <Field label="Location *" error={showErrors && !profile.location?.trim()}>
                <Input value={profile.location} onChangeText={(v: string) => set('location', v)} placeholder="e.g. Frankston City, VIC" error={showErrors && !profile.location?.trim()} />
              </Field>
              <Field label="Email *" error={showErrors && !profile.email?.trim()}>
                <Input value={profile.email} onChangeText={(v: string) => set('email', v)} placeholder="Email address" keyboardType="email-address" error={showErrors && !profile.email?.trim()} />
              </Field>
              <Field label="Phone">
                <Input value={profile.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone number" keyboardType="phone-pad" />
              </Field>
            </View>

            {/* Fee Range */}
            <View style={[s.sectionBlock, { borderTopColor: colors.borderFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.grey }]}>Fee Range</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Min ($)">
                    <Input value={profile.feeMin} onChangeText={(v: string) => set('feeMin', v)} placeholder="0" keyboardType="numeric" />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Max ($)">
                    <Input value={profile.feeMax} onChangeText={(v: string) => set('feeMax', v)} placeholder="0" keyboardType="numeric" />
                  </Field>
                </View>
              </View>
            </View>

            {/* Social Links */}
            <View style={[s.sectionBlock, { borderTopColor: colors.borderFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.grey }]}>Social Links</Text>
              {PLATFORMS.map(p => (
                <Field key={p.key} label={p.label}>
                  <Input value={(profile as any)[p.key] || ''} onChangeText={(v: string) => set(p.key as any, v)} placeholder={`${p.label} URL`} />
                </Field>
              ))}
            </View>

            {/* Custom Links */}
            <View style={[s.sectionBlock, { borderTopColor: colors.borderFaint }]}>
              <Text style={[s.sectionTitle, { color: colors.grey }]}>Custom Links</Text>
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
            <Text style={[s.sectionTitle, { color: colors.grey }]}>About *</Text>
            <Text style={s.hint}>Tell venues who you are, what you play, and how many people you draw.</Text>
            <Input value={profile.about} onChangeText={(v: string) => set('about', v)} placeholder="We're a 4-piece indie rock band from Melbourne's south-east…" multiline error={showErrors && !profile.about?.trim()} />
          </View>
        )}

        {/* ── MUSIC ── */}
        {activeTab === 'Music' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Music</Text>
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
        {activeTab === 'Gig History' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Gig History</Text>
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
                    <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.date?.trim() ? s.inputError : {}]} value={gig.date} onChangeText={v => setGig(i, 'date', v)} placeholder="Date *" placeholderTextColor={Colors.greyLight} />
                    <TextInput style={[s.input, { flex: 1 }]} value={gig.attendance || ''} onChangeText={v => setGig(i, 'attendance', v)} placeholder="Attendance" placeholderTextColor={Colors.greyLight} keyboardType="numeric" />
                  </View>
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setGig(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                    <TouchableOpacity style={s.removeInlineBtn} onPress={() => removeGig(i)}>
                      <Text style={s.removeInlineBtnText}>Remove</Text>
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
        {activeTab === 'Upcoming' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Upcoming Gigs</Text>
            {profile.upcomingGigs.map((gig, i) => {
              const hasError = showErrors && (!gig.venue?.trim() || !gig.suburb?.trim() || !gig.date?.trim());
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput style={[s.input, { flex: 2 }, showErrors && !gig.venue?.trim() ? s.inputError : {}]} value={gig.venue} onChangeText={v => setUpcoming(i, 'venue', v)} placeholder="Venue / Event *" placeholderTextColor={Colors.greyLight} />
                    <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.suburb?.trim() ? s.inputError : {}]} value={gig.suburb} onChangeText={v => setUpcoming(i, 'suburb', v)} placeholder="Suburb *" placeholderTextColor={Colors.greyLight} />
                  </View>
                  <View style={{ height: 8 }} />
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput style={[s.input, { flex: 1 }, showErrors && !gig.date?.trim() ? s.inputError : {}]} value={gig.date} onChangeText={v => setUpcoming(i, 'date', v)} placeholder="Date *" placeholderTextColor={Colors.greyLight} />
                    <TextInput style={[s.input, { flex: 1 }]} value={gig.notes} onChangeText={v => setUpcoming(i, 'notes', v)} placeholder="Notes" placeholderTextColor={Colors.greyLight} />
                    <TouchableOpacity style={s.removeInlineBtn} onPress={() => removeUpcoming(i)}>
                      <Text style={s.removeInlineBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={addUpcoming}>
              <Text style={s.addBtnText}>+ Add Upcoming Gig</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── TECH SPECS ── */}
        {activeTab === 'Tech Specs' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Tech Rider</Text>
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
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Photo Gallery</Text>
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
  body:               { padding: 20, paddingTop: 24, paddingBottom: 60 },
  banner:             { width: '100%', height: 220, overflow: 'hidden', backgroundColor: Colors.bgFaint },
  bannerError:        { borderWidth: 2, borderColor: Colors.danger },
  bannerImg:          { width: '100%', height: '100%' },
  bannerPlaceholder:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { fontSize: 14, color: Colors.greyLight },
  bannerEditBadge:    { position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  bannerEditBadgeText:{ color: '#fff', fontSize: 12, fontWeight: '600' },
  section:            { gap: 4 },
  sectionBlock:       { paddingVertical: 20, borderTopWidth: 1, borderTopColor: 'transparent' },
  sectionTitle:       { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
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
