import { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform,
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

const isWeb = Platform.OS === 'web';

const SET_LENGTHS  = ['30 min', '45 min', '60 min', '90 min'];
const SLOT_PREFS   = ['Headline', 'Support Act', 'Either'];

type SectionKey = 'about' | 'music' | 'gigHistory' | 'upcomingGigs' | 'socials' | 'techRider' | 'photos';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'about',        label: 'About'           },
  { key: 'music',        label: 'Music'            },
  { key: 'gigHistory',   label: 'Gig History'      },
  { key: 'upcomingGigs', label: 'Upcoming Gigs'    },
  { key: 'socials',      label: 'Socials'          },
  { key: 'techRider',    label: 'Tech Rider'       },
  { key: 'photos',       label: 'Photos & Videos'  },
];

function truncate(str: string | undefined, n: number): string {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export default function EnquireScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    venueId: string; venueName: string;
    day: string; date?: string; time: string;
    room?: string; slotType: string;
  }>();

  const [band, setBand]               = useState<Record<string, any>>({});
  const [setLength, setSetLength]     = useState('45 min');
  const [slotPref, setSlotPref]       = useState('Either');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    about: true, music: true, gigHistory: true, upcomingGigs: true,
    socials: true, techRider: true, photos: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
      if (snap.exists()) setBand(snap.data());
    }).catch(() => {});
  }, [user?.uid]);

  function toggleSection(key: SectionKey) {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function sectionPreview(key: SectionKey): string {
    switch (key) {
      case 'about':       return truncate(band.about, 80);
      case 'music':       return (band.songs || []).map((s: any) => s.title).filter(Boolean).join(' · ') || '—';
      case 'gigHistory':  return (band.gigHistory || []).map((g: any) => g.venue).filter(Boolean).join(' · ') || '—';
      case 'upcomingGigs':return (band.upcomingGigs || []).map((g: any) => g.venue).filter(Boolean).join(' · ') || '—';
      case 'socials': {
        const parts: string[] = [];
        if (band.email)      parts.push('Email');
        if (band.phone)      parts.push('Phone');
        if (band.instagram)  parts.push('Instagram');
        if (band.tiktok)     parts.push('TikTok');
        if (band.spotify)    parts.push('Spotify');
        if (band.appleMusic) parts.push('Apple Music');
        (band.customLinks || []).filter((l: any) => l.label && l.url).forEach((l: any) => parts.push(l.label));
        return parts.join(', ') || '—';
      }
      case 'techRider': {
        const parts: string[] = [];
        if (band.stagePlot)                 parts.push(`Stage plot: ${band.stagePlot}`);
        if (band.inputList)                 parts.push(`Input list: ${band.inputList}`);
        if (band.techRider?.monitoring)     parts.push(band.techRider.monitoring);
        if (band.techRider?.backlineNeeded) parts.push(band.techRider.backlineNeeded);
        return truncate(parts.join(' · '), 80) || '—';
      }
      case 'photos': return band.photoUrl ? 'Profile photo included' : 'No photos uploaded yet';
      default: return '';
    }
  }

  // Firestore rejects undefined values — strip them before saving
  function clean(obj: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v])
    );
  }

  async function handleSubmit() {
    if (!user || !profile) return;
    setSubmitting(true);
    setError(null);
    try {
      await addEnquiry(clean({
        bandName:    band.name || profile?.displayName || user.email || 'Unknown',
        venueName:   params.venueName,
        venueId:     params.venueId,
        createdBy:   user.uid,
        status:      'pending',
        submittedAt: new Date().toISOString(),
        additionalInfo,
        requestedSlot: {
          day:      params.day,
          date:     params.date || null,
          time:     params.time,
          room:     params.room ?? null,
          slotType: slotPref,
          setLength,
        },
        sharedSections: sections,
        genre:      band.genre,
        location:   band.location,
        artistType: band.artistType,
        photoUrl:   sections.photos ? band.photoUrl : undefined,
        ...(sections.about       && { about:       band.about }),
        ...(sections.music       && { songs: band.songs, spotify: band.spotify, appleMusic: band.appleMusic }),
        ...(sections.gigHistory  && { gigHistory:   band.gigHistory }),
        ...(sections.upcomingGigs&& { upcomingGigs: band.upcomingGigs }),
        ...(sections.socials     && { instagram: band.instagram, tiktok: band.tiktok, facebook: band.facebook, customLinks: band.customLinks }),
        ...(sections.techRider   && { techRider: band.techRider, stagePlot: band.stagePlot, inputList: band.inputList }),
        email: band.email,
        phone: band.phone,
      }) as any);
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || 'Could not submit enquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const genres: string[] = band.genre ?? [];

  // ── Success ────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: isWeb ? 'rgba(0,0,0,0.45)' : colors.bg }]}>
        <View style={isWeb ? s.webOverlay : { flex: 1 }}>
          <View style={[s.card, isWeb && s.cardWeb, { backgroundColor: colors.bg }]}>
            <View style={s.successWrap}>
              <View style={s.successCircle}>
                <Text style={s.successCheck}>✓</Text>
              </View>
              <Text style={[s.successTitle, { color: colors.black }]}>Enquiry sent to {params.venueName}</Text>
              <Text style={[s.successSub, { color: colors.grey }]}>You can track this in your Inbox</Text>
              <TouchableOpacity style={s.sendBtn} onPress={() => router.replace('/(tabs)/inbox')}>
                <Text style={s.sendBtnText}>View Inbox</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cancelBtn, { borderColor: colors.border }]}
                onPress={() => router.canGoBack() ? router.back() : router.replace(`/venue/${params.venueId}`)}
              >
                <Text style={[s.cancelBtnText, { color: colors.black }]}>Back to Venue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const formContent = (
    <ScrollView
      contentContainerStyle={[s.scroll, isWeb && s.scrollWeb]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={s.formHeader}>
        <Text style={[s.title, { color: colors.black }]}>Review your enquiry</Text>
        {isWeb ? (
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
            <Text style={[s.closeBtnText, { color: colors.black }]}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Slot summary */}
      <View style={[s.slotCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[s.slotVenue, { color: colors.black }]}>{params.venueName}</Text>
        <Text style={s.slotDetail}>
          {params.day}{params.date ? ` · ${params.date}` : ''} · {params.time}
          {params.room ? ` · ${params.room}` : ''}
        </Text>
        {params.slotType ? <Text style={s.slotDetail}>{params.slotType}</Text> : null}
      </View>

      {/* Set length + Slot preference — side by side */}
      <View style={s.fieldRow}>
        <View style={s.fieldCol}>
          <Text style={[s.fieldLabel, { color: colors.black }]}>Set length</Text>
          <View style={s.pillGroup}>
            {SET_LENGTHS.map(l => (
              <TouchableOpacity
                key={l}
                style={[s.pill, { borderColor: colors.border }, setLength === l && s.pillActive]}
                onPress={() => setSetLength(l)}
              >
                <Text style={[s.pillText, { color: colors.grey }, setLength === l && s.pillTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={s.fieldCol}>
          <Text style={[s.fieldLabel, { color: colors.black }]}>Slot preference</Text>
          <View style={s.pillGroup}>
            {SLOT_PREFS.map(p => (
              <TouchableOpacity
                key={p}
                style={[s.pill, { borderColor: colors.border }, slotPref === p && s.pillActive]}
                onPress={() => setSlotPref(p)}
              >
                <Text style={[s.pillText, { color: colors.grey }, slotPref === p && s.pillTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Additional info */}
      <View style={s.fieldBlock}>
        <Text style={[s.fieldLabel, { color: colors.black }]}>Additional information</Text>
        <TextInput
          style={[s.textarea, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
          placeholder="Optional — anything you'd like the venue to know (e.g. draw size, PA requirements, past experience at similar venues)"
          placeholderTextColor={colors.greyLight}
          multiline
          numberOfLines={3}
          value={additionalInfo}
          onChangeText={setAdditionalInfo}
          textAlignVertical="top"
        />
      </View>

      {/* What the venue will see */}
      <View style={[s.previewCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[s.previewTitle, { color: colors.black }]}>WHAT THE VENUE WILL SEE</Text>

        {/* Always-shown identity */}
        <View style={s.identityBlock}>
          <View style={s.identityRow}>
            <Text style={[s.bandName, { color: colors.black }]}>
              {band.name || profile?.displayName || 'Your Band'}
            </Text>
            {band.artistType ? (
              <View style={s.typePill}>
                <Text style={s.typePillText}>{band.artistType}</Text>
              </View>
            ) : null}
          </View>
          {genres.length > 0 && (
            <View style={s.genreRow}>
              {genres.map(g => (
                <View key={g} style={s.genrePill}>
                  <Text style={s.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
          {band.location ? (
            <Text style={[s.locationText, { color: colors.grey }]}>📍 {band.location}</Text>
          ) : null}
        </View>

        {/* Section toggles */}
        <View style={[s.sectionList, { borderTopColor: colors.border }]}>
          {SECTIONS.map((sec, idx) => {
            const included = sections[sec.key];
            const preview  = sectionPreview(sec.key);
            const isLast   = idx === SECTIONS.length - 1;
            return (
              <View
                key={sec.key}
                style={[s.sectionRow, { borderBottomColor: colors.border }, isLast && s.sectionRowLast]}
              >
                <View style={s.sectionLeft}>
                  <Text style={[
                    s.sectionLabel,
                    { color: included ? colors.black : colors.greyLight },
                    !included && s.sectionLabelHidden,
                  ]}>
                    {sec.label}
                  </Text>
                  {included && preview ? (
                    <Text style={[s.sectionPreview, { color: colors.grey }]} numberOfLines={1}>
                      {preview}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => toggleSection(sec.key)} style={[s.toggle, included && s.toggleOn]} activeOpacity={0.8}>
                  <View style={[s.toggleThumb, included && s.toggleThumbOn]} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      </View>

      {/* Error */}
      {error ? (
        <Text style={s.errorText}>{error}</Text>
      ) : null}

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity
          style={[s.cancelBtn, { borderColor: colors.border }, isWeb && s.cancelBtnWeb]}
          onPress={() => router.back()}
        >
          <Text style={[s.cancelBtnText, { color: colors.black }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.sendBtn, s.sendBtnFlex, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#111111" size="small" />
            : <Text style={s.sendBtnText}>Send Enquiry</Text>
          }
        </TouchableOpacity>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );

  if (isWeb) {
    return (
      <View style={s.webOverlayFull}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => router.back()} activeOpacity={1} />
        <View style={[s.card, s.cardWeb, { backgroundColor: colors.bg }]}>
          {formContent}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      {/* Native header */}
      <View style={[s.nativeHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.nativeTitle, { color: colors.black }]}>Enquire</Text>
        <View style={{ width: 64 }} />
      </View>
      {formContent}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  // ── Web overlay ───────────────────────────────────────────────────────────
  webOverlayFull: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  webOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    borderRadius: 16,
  },
  cardWeb: {
    maxWidth: 620,
    maxHeight: '90%' as any,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 40,
  },

  // ── Scroll content ────────────────────────────────────────────────────────
  scroll:    { padding: 20, gap: 20 },
  scrollWeb: { padding: 36 },

  // ── Form header ───────────────────────────────────────────────────────────
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700' },
  closeBtn: { padding: 4, paddingHorizontal: 8 },
  closeBtnText: { fontSize: 18 },

  // ── Native header ─────────────────────────────────────────────────────────
  nativeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn:     { width: 64 },
  backText:    { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  nativeTitle: { fontSize: 18, fontWeight: '700' },

  // ── Slot card ─────────────────────────────────────────────────────────────
  slotCard: {
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    gap: 4,
  },
  slotVenue:  { fontSize: 15, fontWeight: '600' },
  slotDetail: { fontSize: 13, color: Colors.orange },

  // ── Field row (set length + slot pref side by side) ───────────────────────
  fieldRow: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 16,
  },
  fieldCol:   { flex: 1, gap: 10 },
  fieldBlock: { gap: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '500' },
  pillGroup:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillActive:     { borderColor: Colors.orange, backgroundColor: Colors.orange + '18' },
  pillText:       { fontSize: 13, fontWeight: '500' },
  pillTextActive: { color: Colors.orange, fontWeight: '700' },

  // ── Textarea ──────────────────────────────────────────────────────────────
  textarea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 80,
    lineHeight: 20,
  },

  // ── What the venue will see ───────────────────────────────────────────────
  previewCard: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    gap: 16,
  },
  previewTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  // Identity block
  identityBlock: { gap: 6 },
  identityRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bandName:      { fontSize: 15, fontWeight: '700' },
  typePill: {
    backgroundColor: Colors.orange,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  typePillText: { fontSize: 11, fontWeight: '600', color: '#111111' },
  genreRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill: {
    borderWidth: 1,
    borderColor: Colors.orange,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  genreText:    { fontSize: 12, color: Colors.orange, fontWeight: '500' },
  locationText: { fontSize: 12 },

  // Section list
  sectionList:    { borderTopWidth: 1 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  sectionRowLast: { borderBottomWidth: 0 },
  sectionLeft:    { flex: 1, gap: 3, paddingRight: 12 },
  sectionLabel:   { fontSize: 14, fontWeight: '500' },
  sectionLabelHidden: { textDecorationLine: 'line-through' },
  sectionPreview: { fontSize: 12, opacity: 0.55 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#dddddd',
    padding: 2,
    justifyContent: 'center',
    marginLeft: 12,
    flexShrink: 0,
  },
  toggleOn:      { backgroundColor: Colors.orange },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: { fontSize: 13, color: '#e94560', textAlign: 'center' },

  // ── Actions ───────────────────────────────────────────────────────────────
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: isWeb ? 'flex-end' : 'stretch',
  },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnWeb: { alignSelf: 'flex-end' },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
  sendBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
  },
  sendBtnFlex: { flex: isWeb ? 0 : 1 },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },

  // ── Success ───────────────────────────────────────────────────────────────
  successWrap: {
    alignItems: 'center',
    gap: 14,
    padding: isWeb ? 32 : 48,
  },
  successCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.orange + '1f',
    borderWidth: 2,
    borderColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCheck: { fontSize: 26, color: Colors.orange, fontWeight: '700' },
  successTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  successSub:   { fontSize: 14, textAlign: 'center' },
});
