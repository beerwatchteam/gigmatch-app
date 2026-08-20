import { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { addEnquiry } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';

const SET_LENGTHS = ['30 min', '45 min', '60 min', '90 min'];
const SLOT_PREFS  = ['Headline', 'Support', 'Either'];

type SectionKey = 'about' | 'music' | 'gigHistory' | 'upcomingGigs' | 'socials' | 'techRider' | 'photos';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'about',       label: 'Bio / About' },
  { key: 'music',       label: 'Music Links' },
  { key: 'gigHistory',  label: 'Gig History' },
  { key: 'upcomingGigs',label: 'Upcoming Gigs' },
  { key: 'socials',     label: 'Social Links' },
  { key: 'techRider',   label: 'Tech Rider' },
  { key: 'photos',      label: 'Photos' },
];

export default function EnquireScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    venueId: string;
    venueName: string;
    day: string;
    date?: string;
    time: string;
    room?: string;
    slotType: string;
  }>();

  const [musicianDoc, setMusicianDoc] = useState<Record<string, any> | null>(null);
  const [setLength,     setSetLength]     = useState('45 min');
  const [slotPref,      setSlotPref]      = useState('Either');
  const [additionalInfo,setAdditionalInfo]= useState('');
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    about: true, music: true, gigHistory: true, upcomingGigs: true,
    socials: true, techRider: false, photos: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);

  // Load full musician profile for snapshot fields
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
      if (snap.exists()) setMusicianDoc(snap.data());
    }).catch(() => {});
  }, [user?.uid]);

  function toggleSection(key: SectionKey) {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit() {
    if (!user || !profile) return;
    setSubmitting(true);
    try {
      await addEnquiry({
        bandName:   musicianDoc?.name || profile?.displayName || user.email || 'Unknown',
        venueName:  params.venueName,
        venueId:    params.venueId,
        createdBy:  user.uid,
        status:     'pending',
        submittedAt: new Date().toISOString(),
        additionalInfo,
        requestedSlot: {
          day:      params.day,
          date:     params.date ?? null,
          time:     params.time,
          room:     params.room ?? null,
          slotType: params.slotType,
          setLength,
        },
        slotPreference: slotPref,
        sharedSections: sections,
        // band profile snapshot — always send core fields
        genre:      musicianDoc?.genre,
        location:   musicianDoc?.location,
        artistType: musicianDoc?.artistType,
        photoUrl:   musicianDoc?.photoUrl,
        // conditionally shared fields based on section toggles
        ...(sections.about       && { about:       musicianDoc?.about }),
        ...(sections.music       && {
          songs:      musicianDoc?.songs,
          spotify:    musicianDoc?.spotify,
          appleMusic: musicianDoc?.appleMusic,
          youtube:    musicianDoc?.youtube,
        }),
        ...(sections.gigHistory  && { gigHistory:  musicianDoc?.gigHistory }),
        ...(sections.upcomingGigs&& { upcomingGigs:musicianDoc?.upcomingGigs }),
        ...(sections.socials     && {
          instagram:   musicianDoc?.instagram,
          tiktok:      musicianDoc?.tiktok,
          facebook:    musicianDoc?.facebook,
          customLinks: musicianDoc?.customLinks,
        }),
        ...(sections.techRider   && {
          techRider:  musicianDoc?.techRider,
          stagePlot:  musicianDoc?.stagePlot,
          inputList:  musicianDoc?.inputList,
        }),
        // contact info
        email:      musicianDoc?.email,
        phone:      musicianDoc?.phone,
      });
      setSubmitted(true);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not submit enquiry.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.successWrap}>
          <Text style={styles.successIcon}>🎉</Text>
          <Text style={styles.successTitle}>Enquiry Sent!</Text>
          <Text style={styles.successSub}>
            Your enquiry to {params.venueName} has been submitted. You'll hear back via your inbox.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(tabs)/inbox')}
          >
            <Text style={styles.primaryBtnText}>View Inbox</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => router.canGoBack() ? router.back() : router.replace(`/venue/${params.venueId}`)}
          >
            <Text style={styles.ghostBtnText}>Back to Venue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Enquire</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Slot summary */}
        <View style={[styles.slotCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
          <Text style={[styles.slotVenue, { color: colors.black }]}>{params.venueName}</Text>
          <Text style={[styles.slotDetail, { color: colors.grey }]}>
            {params.day}{params.date ? ` · ${params.date}` : ''} · {params.time}
          </Text>
          {params.room ? (
            <Text style={styles.slotDetail}>Room: {params.room}</Text>
          ) : null}
          <View style={styles.slotPill}>
            <Text style={styles.slotPillText}>{params.slotType}</Text>
          </View>
        </View>

        {/* Set length */}
        <Text style={[styles.sectionLabel, { color: colors.black }]}>Set length *</Text>
        <View style={styles.pillRow}>
          {SET_LENGTHS.map(l => (
            <TouchableOpacity
              key={l}
              style={[styles.pill, setLength === l && styles.pillActive]}
              onPress={() => setSetLength(l)}
            >
              <Text style={[styles.pillText, setLength === l && styles.pillTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Slot preference */}
        <Text style={[styles.sectionLabel, { color: colors.black }]}>Slot preference</Text>
        <View style={styles.pillRow}>
          {SLOT_PREFS.map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.pill, slotPref === p && styles.pillActive]}
              onPress={() => setSlotPref(p)}
            >
              <Text style={[styles.pillText, slotPref === p && styles.pillTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Share with venue */}
        <Text style={[styles.sectionLabel, { color: colors.black }]}>Share with venue</Text>
        <Text style={[styles.sectionSub, { color: colors.grey }]}>Choose what the venue can see from your profile</Text>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s.key}
            style={styles.toggleRow}
            onPress={() => toggleSection(s.key)}
          >
            <Text style={[styles.toggleLabel, { color: colors.black }]}>{s.label}</Text>
            <View style={[styles.toggle, sections[s.key] && styles.toggleOn]}>
              <View style={[styles.toggleThumb, sections[s.key] && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>
        ))}

        {/* Additional info */}
        <Text style={[styles.sectionLabel, { color: colors.black }]}>Additional info</Text>
        <TextInput
          style={[styles.textarea, { backgroundColor: colors.bgFaint, color: colors.black, borderColor: colors.border }]}
          placeholder="Anything you'd like the venue to know..."
          placeholderTextColor={Colors.greyLight}
          multiline
          numberOfLines={4}
          value={additionalInfo}
          onChangeText={setAdditionalInfo}
          textAlignVertical="top"
        />

        {/* Submit */}
        <TouchableOpacity
          style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={Colors.black} />
            : <Text style={styles.primaryBtnText}>Send Enquiry</Text>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 64 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.black },

  scroll: { padding: 20, gap: 4 },

  slotCard: {
    backgroundColor: Colors.bgFaint,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
    gap: 4,
  },
  slotVenue:  { fontSize: 17, fontWeight: '700', color: Colors.black },
  slotDetail: { fontSize: 14, color: Colors.grey },
  slotPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: Colors.orange + '22',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  slotPillText: { fontSize: 12, color: Colors.orange, fontWeight: '600' },

  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.black,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionSub: {
    fontSize: 13,
    color: Colors.grey,
    marginTop: -8,
    marginBottom: 10,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillActive: { borderColor: Colors.orange, backgroundColor: Colors.orange + '18' },
  pillText:   { fontSize: 13, color: Colors.grey, fontWeight: '500' },
  pillTextActive: { color: Colors.orange, fontWeight: '700' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderFaint,
  },
  toggleLabel: { fontSize: 14, color: Colors.black },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: Colors.orange },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },

  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.black,
    backgroundColor: Colors.bgFaint,
    minHeight: 100,
    marginTop: 4,
  },

  primaryBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.black },

  ghostBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: Colors.grey },

  // Success
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  successIcon:  { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 26, fontWeight: '800', color: Colors.black, marginBottom: 12 },
  successSub: {
    fontSize: 15,
    color: Colors.grey,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
});
