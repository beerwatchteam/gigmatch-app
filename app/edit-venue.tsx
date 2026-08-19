import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, storage } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const CANONICAL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const AU_STATES      = ['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'];
const SLOT_TYPES     = ['Any','Headline','Support'];

type Room = { name: string; capacity: string; stage: string; lighting: string; pa: string };
type Night = {
  day: string; startTime: string; duration: number; slotType: string;
  startDate: string; endDate: string; continuous: boolean;
  feeMin: string; feeMax: string; loadIn: string; soundcheck: string;
  room: string; genres: string[]; notes: string;
};
type VenueData = {
  id?: string; name: string; streetAddress: string; suburb: string;
  state: string; postcode: string; phone: string; email: string;
  website: string; description: string; photoUrl: string;
  rooms: Room[]; gigNights: Night[];
  techSpecs: Record<string, any>;
  settings: { emailOnNewInquiry: boolean; emailOnExpiry: boolean; listed: boolean };
  photos: string[]; videos: string[];
  slots?: Record<string, any>;
  photoPosition?: { x: number; y: number };
};

const BLANK: VenueData = {
  name: '', streetAddress: '', suburb: '', state: '', postcode: '',
  phone: '', email: '', website: '', description: '', photoUrl: '',
  rooms: [], gigNights: [], techSpecs: {},
  settings: { emailOnNewInquiry: true, emailOnExpiry: false, listed: true },
  photos: [], videos: [],
};

const TABS = ['Settings','Basic Info','Rooms','Gig Nights','Tech Specs','Photos'];

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

function Input({ value, onChangeText, placeholder, multiline, keyboardType, error }: any) {
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
      autoCapitalize="none"
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
            <Text style={[s.pillText, { color: colors.grey }, active && s.pillTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function EditVenueScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const venueId = profile?.venueId ?? '';

  const [data, setData]           = useState<VenueData>(BLANK);
  const [saved, setSaved]         = useState<VenueData>(BLANK);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [activeTab, setActiveTab] = useState('Settings');
  const [showErrors, setShowErrors] = useState(false);
  const [tabErrors, setTabErrors]   = useState<string[]>([]);
  const [expandedRoom,  setExpandedRoom]  = useState<number | null>(null);
  const [expandedNight, setExpandedNight] = useState<number | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

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
        setData(d); setSaved(d);
      }
    }).finally(() => setLoading(false));
  }, [venueId]);

  function set<K extends keyof VenueData>(field: K, value: VenueData[K]) {
    setData(prev => ({ ...prev, [field]: value }));
  }

  // ── Rooms ──
  function setRoom(i: number, field: keyof Room, val: string) {
    setData(prev => ({ ...prev, rooms: prev.rooms.map((r, idx) => idx === i ? { ...r, [field]: val } : r) }));
  }
  function addRoom() {
    setData(prev => {
      const rooms = [...prev.rooms, { name: '', capacity: '', stage: '', lighting: '', pa: '' }];
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
  function addNight() {
    const usedDays = data.gigNights.map(n => n.day);
    const day = CANONICAL_DAYS.find(d => !usedDays.includes(d)) || 'Monday';
    setData(prev => {
      const nights = [...prev.gigNights, {
        day, startTime: '', duration: 60, slotType: 'Any',
        startDate: '', endDate: '', continuous: true,
        feeMin: '', feeMax: '', loadIn: '', soundcheck: '',
        room: '', genres: [], notes: '',
      }];
      setExpandedNight(nights.length - 1);
      return { ...prev, gigNights: nights };
    });
  }
  function removeNight(i: number) {
    setData(prev => ({ ...prev, gigNights: prev.gigNights.filter((_, idx) => idx !== i) }));
    setExpandedNight(null);
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
    if (!data.photoUrl)                        errors.push('Venue Photo');
    if (!data.name?.trim() || !data.streetAddress?.trim() || !data.suburb?.trim() ||
        !data.state?.trim() || !data.postcode?.trim() || !data.email?.trim() || !data.website?.trim())
      errors.push('Basic Info');
    if (data.rooms.some(r => !r.name?.trim() || !r.capacity?.toString().trim()))
      errors.push('Rooms');
    if (data.gigNights.some(n => !n.day || !n.startTime || !n.startDate || (!n.continuous && !n.endDate)))
      errors.push('Gig Nights');

    if (errors.length > 0) { setTabErrors(errors); return; }
    setTabErrors([]);
    setSaving(true);

    try {
      const { id, ...fields } = data as any;
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
            slotType: night.slotType || 'Any',
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
      setShowErrors(false);
      Alert.alert('Saved', 'Your venue profile has been updated.');
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    const isDirty = JSON.stringify(data) !== JSON.stringify(saved);
    if (isDirty) {
      Alert.alert('Unsaved changes', 'Any unsaved changes will be lost. Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }

  if (loading) return <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>;

  if (!venueId) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <View style={s.center}>
          <Text style={[s.emptyText, { color: colors.grey }]}>No venue linked to your account.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false}>

        {/* ── Banner + title bar + tab errors ── */}
        <View>
          <TouchableOpacity onPress={pickBannerPhoto} style={[s.banner, showErrors && !data.photoUrl && s.bannerError]}>
            {data.photoUrl
              ? <Image source={{ uri: data.photoUrl }} style={s.bannerImg} />
              : <View style={s.bannerPlaceholder}>
                  <Text style={s.bannerPlaceholderText}>{photoUploading ? 'Uploading…' : 'Tap to add venue photo *'}</Text>
                </View>
            }
            <View style={s.bannerEditBadge}><Text style={s.bannerEditBadgeText}>{data.photoUrl ? 'Change photo' : '+ Photo'}</Text></View>
          </TouchableOpacity>

          <View style={[s.titleBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.headerTitle, { color: colors.black }]}>Edit Venue Profile</Text>
              <Text style={[s.headerSub, { color: colors.grey }]}>{data.name || '—'}</Text>
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
              onPress={() => set('settings', { ...data.settings, emailOnNewInquiry: !data.settings.emailOnNewInquiry })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailOnNewInquiry && s.checkboxChecked]}>
                {data.settings.emailOnNewInquiry && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me when a new enquiry arrives</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.checkRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => set('settings', { ...data.settings, emailOnExpiry: !data.settings.emailOnExpiry })}
            >
              <View style={[s.checkbox, { borderColor: colors.border }, data.settings.emailOnExpiry && s.checkboxChecked]}>
                {data.settings.emailOnExpiry && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.checkLabel, { color: colors.black }]}>Email me when an enquiry expires</Text>
            </TouchableOpacity>

            <Text style={[s.sectionTitle, { color: colors.grey, marginTop: 24 }]}>Visibility</Text>
            <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
              <Text style={[s.toggleLabel, { color: colors.black }]}>Listed on GigMatch</Text>
              <Switch
                value={data.settings.listed}
                onValueChange={v => set('settings', { ...data.settings, listed: v })}
                trackColor={{ true: Colors.orange }}
                thumbColor="#fff"
              />
            </View>

            <View style={[s.dangerSection, { borderColor: Colors.danger + '44' }]}>
              <Text style={s.dangerTitle}>Danger Zone</Text>
              <Text style={[s.dangerDesc, { color: colors.grey }]}>
                Deactivating your listing will hide it from all bands browsing GigMatch. This action can be reversed at any time.
              </Text>
              <TouchableOpacity style={s.dangerBtn} disabled activeOpacity={1}>
                <Text style={s.dangerBtnText}>Deactivate Venue Listing</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── BASIC INFO ── */}
        {activeTab === 'Basic Info' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Basic Info</Text>
            <Field label="Venue name *" error={showErrors && !data.name?.trim()}>
              <Input value={data.name} onChangeText={(v: string) => set('name', v)} placeholder="Venue name" error={showErrors && !data.name?.trim()} />
            </Field>
            <Field label="Street address *" error={showErrors && !data.streetAddress?.trim()}>
              <Input value={data.streetAddress} onChangeText={(v: string) => set('streetAddress', v)} placeholder="123 Main St" error={showErrors && !data.streetAddress?.trim()} />
            </Field>
            <Field label="Suburb *" error={showErrors && !data.suburb?.trim()}>
              <Input value={data.suburb} onChangeText={(v: string) => set('suburb', v)} placeholder="Suburb" error={showErrors && !data.suburb?.trim()} />
            </Field>
            <Field label="State *" error={showErrors && !data.state?.trim()}>
              <Pills options={AU_STATES} value={data.state} onSelect={(v: string) => set('state', v)} />
            </Field>
            <Field label="Postcode *" error={showErrors && !data.postcode?.trim()}>
              <Input value={data.postcode} onChangeText={(v: string) => set('postcode', v)} placeholder="3000" keyboardType="numeric" error={showErrors && !data.postcode?.trim()} />
            </Field>
            <Field label="Phone">
              <Input value={data.phone} onChangeText={(v: string) => set('phone', v)} placeholder="Phone number" keyboardType="phone-pad" />
            </Field>
            <Field label="Email *" error={showErrors && !data.email?.trim()}>
              <Input value={data.email} onChangeText={(v: string) => set('email', v)} placeholder="Email" keyboardType="email-address" error={showErrors && !data.email?.trim()} />
            </Field>
            <Field label="Website *" error={showErrors && !data.website?.trim()}>
              <Input value={data.website} onChangeText={(v: string) => set('website', v)} placeholder="https://…" error={showErrors && !data.website?.trim()} />
            </Field>
            <Field label="Description">
              <Input value={data.description} onChangeText={(v: string) => set('description', v)} placeholder="Tell musicians about your venue…" multiline />
            </Field>
          </View>
        )}

        {/* ── ROOMS ── */}
        {activeTab === 'Rooms' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Rooms</Text>
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
                      <Field label="Stage description">
                        <Input value={room.stage} onChangeText={(v: string) => setRoom(i, 'stage', v)} placeholder="e.g. Elevated 6m × 4m stage" />
                      </Field>
                      <Field label="Lighting">
                        <Input value={room.lighting} onChangeText={(v: string) => setRoom(i, 'lighting', v)} placeholder="e.g. Full rig with follow spot" />
                      </Field>
                      <Field label="PA">
                        <Input value={room.pa} onChangeText={(v: string) => setRoom(i, 'pa', v)} placeholder="e.g. d&b audiotechnik J-Series" />
                      </Field>
                      <TouchableOpacity style={s.removeBtn} onPress={() => removeRoom(i)}>
                        <Text style={s.removeBtnText}>Remove Room</Text>
                      </TouchableOpacity>
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
        {activeTab === 'Gig Nights' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Gig Nights</Text>
            {data.gigNights.map((night, i) => {
              const isOpen = expandedNight === i;
              const hasError = showErrors && (!night.day || !night.startTime || !night.startDate || (!night.continuous && !night.endDate));
              return (
                <View key={i} style={[s.card, { backgroundColor: colors.bgFaint, borderColor: colors.border }, hasError && s.cardError]}>
                  <TouchableOpacity style={s.cardHeader} onPress={() => setExpandedNight(isOpen ? null : i)}>
                    <Text style={s.cardHeaderText}>{night.day || 'New night'}{night.startTime ? ` · ${night.startTime}` : ''}</Text>
                    <Text style={s.cardChevron}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={{ paddingTop: 14, gap: 12 }}>
                      <Field label="Day *">
                        <Pills options={CANONICAL_DAYS} value={night.day} onSelect={(v: string) => setNight(i, 'day', v)} />
                      </Field>
                      <Field label="Start time * (HH:MM)" error={showErrors && !night.startTime}>
                        <Input value={night.startTime} onChangeText={(v: string) => setNight(i, 'startTime', v)} placeholder="20:00" error={showErrors && !night.startTime} />
                      </Field>
                      <Field label="Set duration (min)">
                        <Input value={String(night.duration || 60)} onChangeText={(v: string) => setNight(i, 'duration', Number(v))} keyboardType="numeric" placeholder="60" />
                      </Field>
                      <Field label="Slot type">
                        <Pills options={SLOT_TYPES} value={night.slotType || 'Any'} onSelect={(v: string) => setNight(i, 'slotType', v)} />
                      </Field>
                      <Field label="Start date * (YYYY-MM-DD)" error={showErrors && !night.startDate}>
                        <Input value={night.startDate} onChangeText={(v: string) => setNight(i, 'startDate', v)} placeholder="2025-01-01" error={showErrors && !night.startDate} />
                      </Field>
                      <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
                        <Text style={[s.toggleLabel, { color: colors.black }]}>Continuous (no end date)</Text>
                        <Switch
                          value={night.continuous}
                          onValueChange={v => { setNight(i, 'continuous', v); if (v) setNight(i, 'endDate', ''); }}
                          trackColor={{ true: Colors.orange }}
                          thumbColor="#fff"
                        />
                      </View>
                      {!night.continuous && (
                        <Field label="End date * (YYYY-MM-DD)" error={showErrors && !night.endDate}>
                          <Input value={night.endDate} onChangeText={(v: string) => setNight(i, 'endDate', v)} placeholder="2025-12-31" error={showErrors && !night.endDate} />
                        </Field>
                      )}
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Fee min ($)">
                            <Input value={night.feeMin} onChangeText={(v: string) => setNight(i, 'feeMin', v)} placeholder="200" keyboardType="numeric" />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="Fee max ($)">
                            <Input value={night.feeMax} onChangeText={(v: string) => setNight(i, 'feeMax', v)} placeholder="500" keyboardType="numeric" />
                          </Field>
                        </View>
                      </View>
                      <Field label="Load-in time">
                        <Input value={night.loadIn} onChangeText={(v: string) => setNight(i, 'loadIn', v)} placeholder="e.g. 5:00 PM" />
                      </Field>
                      <Field label="Soundcheck">
                        <Input value={night.soundcheck} onChangeText={(v: string) => setNight(i, 'soundcheck', v)} placeholder="e.g. 5:30 PM" />
                      </Field>
                      {data.rooms.length > 0 && (
                        <Field label="Room">
                          <Pills options={['Any room', ...data.rooms.map(r => r.name).filter(Boolean)]} value={night.room || 'Any room'} onSelect={(v: string) => setNight(i, 'room', v === 'Any room' ? '' : v)} />
                        </Field>
                      )}
                      <Field label="Notes">
                        <Input value={night.notes} onChangeText={(v: string) => setNight(i, 'notes', v)} placeholder="Any notes for acts" />
                      </Field>
                      <TouchableOpacity style={s.removeBtn} onPress={() => removeNight(i)}>
                        <Text style={s.removeBtnText}>Remove Night</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
            {data.gigNights.length < 7 && (
              <TouchableOpacity style={s.addBtn} onPress={addNight}>
                <Text style={s.addBtnText}>+ Add Night</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── TECH SPECS ── */}
        {activeTab === 'Tech Specs' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Tech Specs / Rider</Text>
            {(['pa','monitoring','backline','lighting','parking'] as const).map(f => (
              <Field key={f} label={f.charAt(0).toUpperCase() + f.slice(1)}>
                <Input
                  value={data.techSpecs?.[f] || ''}
                  onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, [f]: v })}
                  placeholder={f === 'pa' ? 'e.g. d&b J-Series' : ''}
                />
              </Field>
            ))}
            <View style={[s.toggleRow, { borderBottomColor: colors.borderFaint }]}>
              <Text style={[s.toggleLabel, { color: colors.black }]}>Green room available</Text>
              <Switch
                value={data.techSpecs?.greenRoom || false}
                onValueChange={v => set('techSpecs', { ...data.techSpecs, greenRoom: v })}
                trackColor={{ true: Colors.orange }}
                thumbColor="#fff"
              />
            </View>
            {data.techSpecs?.greenRoom && (
              <Field label="Green room details">
                <Input value={data.techSpecs?.greenRoomDetails || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, greenRoomDetails: v })} placeholder="Describe the green room" />
              </Field>
            )}
            <Field label="Notes for acts">
              <Input value={data.techSpecs?.notes || ''} onChangeText={(v: string) => set('techSpecs', { ...data.techSpecs, notes: v })} placeholder="Any additional info" multiline />
            </Field>
          </View>
        )}

        {/* ── PHOTOS ── */}
        {activeTab === 'Photos' && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.grey }]}>Photo Gallery</Text>
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
  body:          { padding: 20, paddingTop: 24, paddingBottom: 60 },
  banner:        { width: '100%', height: 220, overflow: 'hidden', backgroundColor: Colors.bgFaint },
  bannerError:   { borderWidth: 2, borderColor: Colors.danger },
  bannerImg:     { width: '100%', height: '100%' },
  bannerPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText: { fontSize: 14, color: Colors.greyLight },
  bannerEditBadge: { position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  bannerEditBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  section:       { gap: 4 },
  sectionTitle:  { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
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
  photoGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  photoItem:     { width: '47%', aspectRatio: 4/3, borderRadius: 10, overflow: 'hidden' },
  photoImg:      { width: '100%', height: '100%' },
  photoRemove:   { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
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
  dangerBtn:     { borderWidth: 1, borderColor: Colors.danger, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 18, alignSelf: 'flex-start', opacity: 0.5 },
  dangerBtnText: { fontSize: 14, fontWeight: '600', color: Colors.danger },
});
