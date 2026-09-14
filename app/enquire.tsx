import { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform, Image,
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

const SET_LENGTHS = ['30 min', '45 min', '60 min', '90 min'];
const SLOT_PREFS = ['Headline', 'Other'] as const;

type SectionKey = 'about' | 'music' | 'gigHistory' | 'upcomingGigs' | 'socials' | 'techRider' | 'photos' | 'contact';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'about',        label: 'About'          },
  { key: 'music',        label: 'Music'           },
  { key: 'gigHistory',   label: 'Gig history'     },
  { key: 'upcomingGigs', label: 'Upcoming gigs'   },
  { key: 'socials',      label: 'Socials'         },
  { key: 'techRider',    label: 'Tech rider'      },
  { key: 'photos',       label: 'Photos & videos' },
  { key: 'contact',      label: 'Contact'         },
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
    room?: string; slotType?: string; duration?: string; capacity?: string; slotNote?: string;
  }>();

  // Locked by venue
  const lockedDuration = params.duration ? `${params.duration} min` : null;
  const lockedSlotType = (params.slotType === 'Headline' || params.slotType === 'Other') ? params.slotType : null;

  const [band, setBand]           = useState<Record<string, any>>({});
  const [setLength, setSetLength] = useState(lockedDuration || '45 min');
  const [slotPref,  setSlotPref]  = useState<string>(lockedSlotType || 'Headline');
  const [otherNote, setOtherNote] = useState('');
  const [note, setNote]           = useState('');
  const [sections, setSections]   = useState<Record<SectionKey, boolean>>({
    about: true, music: true, gigHistory: true, upcomingGigs: true,
    socials: true, techRider: true, photos: true, contact: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Redirect non-artist accounts
  useEffect(() => {
    if (profile && profile.type !== 'artist') {
      router.replace(`/venue/${params.venueId}` as any);
    }
  }, [profile?.type]);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
      if (snap.exists()) setBand(snap.data());
    }).catch(() => {});
  }, [user?.uid]);

  function toggleSection(key: SectionKey) {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll() {
    setSections({ about: true, music: true, gigHistory: true, upcomingGigs: true,
                  socials: true, techRider: true, photos: true, contact: true });
  }

  function sectionPreview(key: SectionKey): string {
    switch (key) {
      case 'about':       return truncate(band.about, 60);
      case 'music':       return (band.songs || []).map((s: any) => s.title).filter(Boolean).join(' · ') || 'None listed';
      case 'gigHistory':  return (band.gigHistory || []).map((g: any) => g.venue).filter(Boolean).join(' · ') || 'None listed';
      case 'upcomingGigs':return (band.upcomingGigs || []).map((g: any) => g.venue).filter(Boolean).join(' · ') || 'None listed';
      case 'socials': {
        const parts: string[] = [];
        if (band.instagram)  parts.push('Instagram');
        if (band.tiktok)     parts.push('TikTok');
        if (band.spotify)    parts.push('Spotify');
        if (band.appleMusic) parts.push('Apple Music');
        (band.customLinks || []).filter((l: any) => l.label && l.url).forEach((l: any) => parts.push(l.label));
        return parts.join(', ') || 'None listed';
      }
      case 'techRider': {
        const tr = band.techRider || {};
        const pages = [band.stagePlot, band.inputList, tr.monitoring, tr.backlineNeeded].filter(Boolean);
        if (pages.length === 0) return 'None listed';
        return `${pages.length} item${pages.length > 1 ? 's' : ''} included`;
      }
      case 'photos':  return band.photoUrl ? 'Profile photo included' : 'No photos uploaded yet';
      case 'contact': {
        const parts: string[] = [];
        if (band.email) parts.push('Email');
        if (band.phone) parts.push('Mobile');
        return parts.join(' · ') || 'None listed';
      }
      default: return '';
    }
  }

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
        submittedAt: new Date().toISOString(),
        additionalInfo: note,
        requestedSlot: {
          day:       params.day,
          date:      params.date || null,
          time:      params.time,
          room:      params.room ?? null,
          slotType:  slotPref,
          slotNote:  slotPref === 'Other' ? otherNote : undefined,
          setLength,
        },
        sharedSections: sections,
        genre:      band.genre,
        location:   band.location,
        artistType: band.artistType,
        photoUrl:   sections.photos ? band.photoUrl : undefined,
        ...(sections.about        && { about:       band.about }),
        ...(sections.music        && { songs: band.songs, spotify: band.spotify, appleMusic: band.appleMusic }),
        ...(sections.gigHistory   && { gigHistory:   band.gigHistory }),
        ...(sections.upcomingGigs && { upcomingGigs: band.upcomingGigs }),
        ...(sections.socials      && { instagram: band.instagram, tiktok: band.tiktok, facebook: band.facebook, customLinks: band.customLinks }),
        ...(sections.techRider    && { techRider: band.techRider, stagePlot: band.stagePlot, inputList: band.inputList }),
        ...(sections.contact      && { email: band.email, phone: band.phone }),
      }) as any);
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || 'Could not submit enquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const genres: string[] = band.genre ?? [];
  const selectedCount = Object.values(sections).filter(Boolean).length;

  // Slot detail line
  const slotParts = [
    params.day,
    params.date,
    params.time,
    params.room,
    params.capacity ? `${params.capacity} cap` : null,
  ].filter(Boolean);

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

  // ── Form content ───────────────────────────────────────────────────────────
  const formContent = (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[s.scroll, isWeb && s.scrollWeb]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <View style={s.formHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.enquiryLabel}>ENQUIRY</Text>
            <Text style={[s.venueName, { color: colors.black }]}>{params.venueName}</Text>
            <Text style={s.slotDetail}>{slotParts.join(' · ')}</Text>
            {params.slotNote ? <Text style={s.slotNote}>{params.slotNote}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => router.back()} style={[s.closeBtn, { borderColor: colors.border }]}>
            <Text style={[s.closeBtnText, { color: colors.black }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Band row ──────────────────────────────────────────── */}
        <View style={[s.bandRow, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
          {band.photoUrl ? (
            <Image source={{ uri: band.photoUrl }} style={s.bandPhoto} />
          ) : (
            <View style={[s.bandPhotoPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={s.bandPhotoLabel}>photo</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={[s.bandName, { color: colors.black }]} numberOfLines={1}>
                {band.name || profile?.displayName || 'Your Band'}
              </Text>
              {band.artistType ? (
                <View style={s.typeBadge}>
                  <Text style={s.typeBadgeText}>{(band.artistType || '').toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[s.bandMeta, { color: colors.grey }]} numberOfLines={1}>
              {[
                genres.slice(0, 3).join(' · '),
                band.location,
                band.drawSize ? `${band.drawSize} draw` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* ── Set length ────────────────────────────────────────── */}
        <View style={s.fieldBlock}>
          <Text style={[s.fieldLabel, { color: colors.black }]}>Set length</Text>
          {lockedDuration ? (
            <View style={s.lockedRow}>
              <Text style={[s.lockedValue, { color: colors.black }]}>{lockedDuration}</Text>
              <Text style={s.lockedHint}>Set by venue</Text>
            </View>
          ) : (
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
          )}
        </View>

        {/* ── Slot preference ───────────────────────────────────── */}
        <View style={s.fieldBlock}>
          <Text style={[s.fieldLabel, { color: colors.black }]}>Slot preference</Text>
          {lockedSlotType ? (
            <View style={s.lockedRow}>
              <Text style={[s.lockedValue, { color: colors.black }]}>{lockedSlotType}</Text>
              <Text style={s.lockedHint}>Set by venue</Text>
            </View>
          ) : (
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
          )}
          {(slotPref === 'Other' || lockedSlotType === 'Other') && (
            <TextInput
              style={[s.textarea, { backgroundColor: colors.bgFaint, color: colors.black, borderColor: colors.border, marginTop: 10 }]}
              placeholder="Describe the type of slot you're looking for..."
              placeholderTextColor={colors.greyLight}
              multiline
              numberOfLines={2}
              value={otherNote}
              onChangeText={setOtherNote}
              textAlignVertical="top"
            />
          )}
        </View>

        {/* ── Note to the venue ─────────────────────────────────── */}
        <View style={s.fieldBlock}>
          <View style={s.noteLabelRow}>
            <Text style={[s.fieldLabel, { color: colors.black }]}>Note to the venue</Text>
            <Text style={s.optionalLabel}>Optional</Text>
          </View>
          <TextInput
            style={[s.textarea, { backgroundColor: colors.bgFaint, color: colors.black, borderColor: colors.border }]}
            placeholder="Draw size, PA requirements, similar rooms you've played…"
            placeholderTextColor={colors.greyLight}
            multiline
            numberOfLines={3}
            value={note}
            onChangeText={setNote}
            textAlignVertical="top"
          />
        </View>

        {/* ── Profile sections shared ───────────────────────────── */}
        <View style={s.sectionsBlock}>
          <View style={s.sectionsHeader}>
            <Text style={[s.sectionsTitle, { color: colors.grey }]}>PROFILE SECTIONS SHARED</Text>
            <TouchableOpacity onPress={selectAll}>
              <Text style={s.selectAll}>Select all</Text>
            </TouchableOpacity>
          </View>
          <View style={s.checkGrid}>
            {SECTIONS.map(sec => {
              const checked = sections[sec.key];
              const preview = sectionPreview(sec.key);
              return (
                <TouchableOpacity
                  key={sec.key}
                  style={[s.checkCell, { borderColor: colors.border, backgroundColor: checked ? Colors.orange + '0d' : colors.bg }]}
                  onPress={() => toggleSection(sec.key)}
                  activeOpacity={0.75}
                >
                  <View style={[s.checkbox, checked && s.checkboxOn]}>
                    {checked ? <Text style={s.checkMark}>✓</Text> : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.checkLabel, { color: colors.black }]}>{sec.label}</Text>
                    {preview ? (
                      <Text style={[s.checkPreview, { color: colors.grey }]} numberOfLines={1}>{preview}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Error ─────────────────────────────────────────────── */}
        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Footer bar ────────────────────────────────────────────── */}
      <View style={[s.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <Text style={[s.footerSummary, { color: colors.grey }]} numberOfLines={1}>
          {setLength} · {slotPref} · {selectedCount} of {SECTIONS.length} sections shared
        </Text>
        <View style={s.footerActions}>
          <TouchableOpacity
            style={[s.cancelBtn, { borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[s.cancelBtnText, { color: colors.black }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.sendBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color="#111111" size="small" />
              : <Text style={s.sendBtnText}>Send enquiry</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={s.sheetHandle} />
      {formContent}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#d0d0d0', alignSelf: 'center', marginTop: 10, marginBottom: 4 },

  // ── Web overlay ──────────────────────────────────────────────────────────
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
    overflow: 'hidden' as any,
  },
  cardWeb: {
    maxWidth: 520,
    maxHeight: '92%' as any,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 40,
  },

  // ── Scroll ───────────────────────────────────────────────────────────────
  scroll:    { padding: 20, gap: 20 },
  scrollWeb: { padding: 28, paddingBottom: 12 },

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

  // ── Form header ───────────────────────────────────────────────────────────
  formHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  enquiryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 1,
    marginBottom: 4,
  },
  venueName:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  slotDetail: { fontSize: 13, color: Colors.grey, marginTop: 3 },
  slotNote:   { fontSize: 13, color: Colors.grey, marginTop: 4, fontStyle: 'italic' },
  closeBtn:     { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  closeBtnText: { fontSize: 14, fontWeight: '600' },

  // ── Field blocks ─────────────────────────────────────────────────────────
  fieldBlock: { gap: 10 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  noteLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionalLabel: { fontSize: 13, color: Colors.grey },

  // ── Pills ─────────────────────────────────────────────────────────────────
  pillGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flex: 1,
    minWidth: 70,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pillActive:     { borderColor: Colors.orange, backgroundColor: Colors.orange + '14' },
  pillText:       { fontSize: 13, fontWeight: '500' },
  pillTextActive: { color: Colors.orange, fontWeight: '700' },

  // ── Locked field ──────────────────────────────────────────────────────────
  lockedRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockedValue: { fontSize: 13, fontWeight: '400' },
  lockedHint: { fontSize: 12, color: Colors.grey },

  // ── Textarea ──────────────────────────────────────────────────────────────
  textarea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    lineHeight: 20,
  },

  // ── Band row ──────────────────────────────────────────────────────────────
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  bandPhoto: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  bandPhotoPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandPhotoLabel: { fontSize: 8, color: '#999999' },
  bandName: { fontSize: 13, fontWeight: '700' },
  typeBadge: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  typeBadgeText: { fontSize: 9, fontWeight: '700', color: '#666666', letterSpacing: 0.5 },
  bandMeta:    { fontSize: 11 },
  previewLink: { fontSize: 13, fontWeight: '600', color: Colors.orange },

  // ── Profile sections ──────────────────────────────────────────────────────
  sectionsBlock: { gap: 12 },
  sectionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionsTitle:  { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  selectAll:      { fontSize: 13, fontWeight: '600', color: Colors.orange },

  checkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkCell: {
    width: '48%' as any,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkMark:  { fontSize: 11, color: '#ffffff', fontWeight: '800', lineHeight: 14 },
  checkLabel: { fontSize: 13, fontWeight: '600' },
  checkPreview: { fontSize: 11, opacity: 0.7 },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: { fontSize: 13, color: '#e94560', textAlign: 'center' },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    gap: 12,
    flexShrink: 0,
  },
  footerSummary: { fontSize: 12, flex: 1 },
  footerActions: { flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 0 },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600' },
  sendBtn: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

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
