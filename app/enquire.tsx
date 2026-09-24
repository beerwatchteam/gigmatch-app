import { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform, Image,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { addEnquiry, normalizeEnquiryStatus } from '@/lib/useEnquiries';
import { useTheme } from '@/lib/theme-context';

const isWeb = Platform.OS === 'web';

const SET_LENGTHS = ['30 min', '45 min', '60 min', '90 min'];
const SLOT_PREFS = ['Headline', 'Support', 'Open Mic', 'Other'] as const;

type SectionKey = 'about' | 'music' | 'socials' | 'techRider' | 'gigs' | 'contact';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'about',     label: 'About'          },
  { key: 'music',     label: 'Music'          },
  { key: 'socials',   label: 'Socials'        },
  { key: 'techRider', label: 'Tech rider'     },
  { key: 'gigs',      label: 'My Gigs'        },
  { key: 'contact',   label: 'Contact'        },
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
    room?: string; slotType?: string; duration?: string; capacity?: string;
    slotName?: string; slotNote?: string;
    paymentModels?: string; feeMin?: string; feeMax?: string; paymentMethod?: string;
    minNotice?: string; venueTimezone?: string;
  }>();

  // Locked by venue
  const lockedDuration = params.duration ? `${params.duration} min` : null;
  const lockedSlotType = (['Headline', 'Support', 'Open Mic', 'Other'] as string[]).includes(params.slotType ?? '') ? params.slotType! : null;

  const [band, setBand]             = useState<Record<string, any>>({});
  const [gigHistory, setGigHistory] = useState<{ venue: string | null; suburb: string | null; date: string; attendance: number | null }[]>([]);
  const [computedDraw, setComputedDraw] = useState<number | null>(null);
  const [setLength, setSetLength] = useState(lockedDuration || '45 min');
  const [slotPref,  setSlotPref]  = useState<string>(lockedSlotType || 'Headline');
  const [otherNote, setOtherNote] = useState('');
  const [note, setNote]           = useState('');
  const [sections, setSections]   = useState<Record<SectionKey, boolean>>({
    about: true, music: true, socials: true, techRider: true, gigs: true, contact: true,
  });
  const [availConfirmed, setAvailConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

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

  // Past confirmed gigs: last 3 shown in the preview, full set used to compute average draw
  useEffect(() => {
    if (!user) return;
    getDocs(query(
      collection(db, 'gigs'),
      where('artistUid', '==', user.uid),
      where('status', '==', 'confirmed'),
    )).then(snap => {
      const now = new Date();
      const past = snap.docs
        .map(d => d.data() as any)
        .filter(g => g.startAt?.toDate?.() < now)
        .sort((a, b) => b.startAt.toDate().getTime() - a.startAt.toDate().getTime());

      const withAttendance = past.filter(g => g.attendance != null && g.attendance > 0);
      if (withAttendance.length > 0) {
        const avg = Math.round(withAttendance.reduce((s: number, g: any) => s + g.attendance, 0) / withAttendance.length);
        setComputedDraw(avg);
      }

      setGigHistory(past.slice(0, 3).map(g => ({
        venue:      g.venueName ?? null,
        suburb:     g.locationText ?? null,
        date:       g.startAt.toDate().toISOString().slice(0, 10),
        attendance: g.attendance ?? null,
      })));
    }).catch(() => {});
  }, [user?.uid]);

  // Block re-enquiry for the same venue+date
  useEffect(() => {
    if (!user || !params.venueId || !params.date) return;
    getDocs(query(
      collection(db, 'inquiries'),
      where('createdBy', '==', user.uid),
      where('venueId', '==', params.venueId),
    )).then(snap => {
      for (const d of snap.docs) {
        const e = d.data();
        if (e.requestedSlot?.date !== params.date) continue;
        const s = normalizeEnquiryStatus(e.status as any);
        if (s === 'confirmed') { setBlockedReason('You already have a confirmed booking for this date.'); return; }
        if (s === 'declined')  { setBlockedReason('Your previous enquiry for this date was declined.'); return; }
        if (s !== 'cancelled') { setBlockedReason('You already have an active enquiry for this date.'); return; }
      }
    }).catch(() => {});
  }, [user?.uid, params.venueId, params.date]);

  // Subscribe to the venue doc so slot info (payment, notes) stays current while the form is open.
  const [liveSlot, setLiveSlot] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!params.venueId || !params.day || !params.time) return;
    return onSnapshot(doc(db, 'venues', params.venueId), snap => {
      if (!snap.exists()) return;
      const daySlots: any[] = snap.data().slots?.[params.day] ?? [];
      const normRoom = (params.room || '').toLowerCase().trim();
      // Prefer a date-specific slot matching params.date, fall back to the recurring template.
      const match =
        daySlots.find((s: any) => s.time === params.time && (s.room || '').toLowerCase().trim() === normRoom && s.date === params.date) ??
        daySlots.find((s: any) => s.time === params.time && (s.room || '').toLowerCase().trim() === normRoom && !s.date) ??
        daySlots.find((s: any) => s.time === params.time && (s.room || '').toLowerCase().trim() === normRoom);
      if (match) setLiveSlot(match);
    });
  }, [params.venueId, params.day, params.time, params.room, params.date]);

  // Merge Twaylo confirmed gigs + manually entered profile gigs, deduplicated, max 3 by date desc
  const displayGigHistory = (() => {
    const manual: typeof gigHistory = ((band.gigHistory ?? []) as any[])
      .filter((g: any) => g.date && (g.venue || g.suburb))
      .map((g: any) => ({
        venue:      g.venue ?? null,
        suburb:     g.suburb ?? null,
        date:       typeof g.date === 'string' ? g.date : '',
        attendance: g.attendance ?? null,
      }));
    const seen = new Set<string>();
    return [...gigHistory, ...manual]
      .filter(g => {
        const key = `${g.venue ?? ''}|${g.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  })();

  function toggleSection(key: SectionKey) {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll() {
    setSections({ about: true, music: true, socials: true, techRider: true, gigs: true, contact: true });
  }

  function sectionPreview(key: SectionKey): string {
    switch (key) {
      case 'about':       return truncate(band.about, 60);
      case 'music':       return (band.songs || []).map((s: any) => s.title).filter(Boolean).join(' · ') || 'None listed';
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
        const items = [
          (tr.stageWidth || tr.stageDepth)                    ? 'Stage size'        : null,
          (tr.monitoringType || tr.monitoring)                 ? 'Monitoring'        : null,
          (band.backlineFromVenue || []).length > 0            ? 'Backline'          : null,
          band.techRiderBools?.ownPA                           ? 'Own PA'            : null,
          (band.inputChannels || []).length > 0                ? 'Input list'        : null,
          tr.stagePlotUrl                                      ? 'Stage plot'        : null,
          tr.inputListUrl                                      ? 'Input list file'   : null,
          (band.techRiderDocs || []).length > 0
            ? `${band.techRiderDocs.length} rider doc${band.techRiderDocs.length > 1 ? 's' : ''}` : null,
        ].filter(Boolean) as string[];
        return items.length > 0 ? items.join(' · ') : 'None listed';
      }
      case 'gigs':
        return displayGigHistory.length > 0
          ? displayGigHistory.map(g => g.venue).filter(Boolean).join(' · ')
          : 'None listed';
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
        ...(params.venueTimezone ? { venueTimezone: params.venueTimezone } : {}),
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
        genre:       band.genre,
        location:    band.location,
        artistType:  band.artistType,
        photoUrl:    band.photoUrl,
        feeMin:      band.feeMin,
        feeMax:      band.feeMax,
        averageDraw: computedDraw ?? undefined,
        ...(sections.gigs && displayGigHistory.length > 0 && { gigHistory: displayGigHistory }),
        ...(sections.about        && { about:       band.about }),
        ...(sections.music        && { songs: band.songs, spotify: band.spotify, appleMusic: band.appleMusic }),
        ...(sections.socials      && { instagram: band.instagram, tiktok: band.tiktok, facebook: band.facebook, customLinks: band.customLinks }),
        ...(sections.techRider    && {
          techRider:        band.techRider,
          backlineFromVenue: band.backlineFromVenue,
          backlineBring:    band.backlineBring,
          techRiderBools:   band.techRiderBools,
          inputChannels:    band.inputChannels,
          techRiderDocs:    band.techRiderDocs,
        }),
        ...(sections.contact      && { email: band.email, phone: band.phone }),
      }) as any);
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || 'Could not submit enquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Payment / slot info (from venue slot, live if available) ─────────────────
  const paymentModels: string[] = liveSlot
    ? (liveSlot.paymentModels?.length ? liveSlot.paymentModels : liveSlot.paymentModel ? [liveSlot.paymentModel] : [])
    : (params.paymentModels ? params.paymentModels.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
  const feeMin          = liveSlot ? (liveSlot.feeMin    ?? null) : (params.feeMin    ? Number(params.feeMin)    : null);
  const feeMax          = liveSlot ? (liveSlot.feeMax    ?? null) : (params.feeMax    ? Number(params.feeMax)    : null);
  const paymentMethod   = liveSlot ? (liveSlot.paymentMethod ?? null) : (params.paymentMethod ?? null);
  const minNotice       = liveSlot ? (liveSlot.minNotice ?? null) : (params.minNotice ?? null);
  const slotNote        = liveSlot ? (liveSlot.notes     ?? null) : (params.slotNote  ?? null);
  const slotName        = liveSlot ? (liveSlot.name      ?? null) : (params.slotName  ?? null);
  const hasPayment = paymentModels.length > 0;

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
            {slotName ? (
              <Text style={[s.slotName, { color: colors.grey }]}>{slotName}</Text>
            ) : null}
            <Text style={s.slotDetail}>{slotParts.join(' · ')}</Text>
          </View>
          <TouchableOpacity onPress={() => router.back()} style={[s.closeBtn, { borderColor: colors.border }]}>
            <Text style={[s.closeBtnText, { color: colors.black }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Set Details ───────────────────────────────────────── */}
        <View style={s.setDetailsBlock}>
          <Text style={[s.setDetailsHeading, { color: colors.grey }]}>SET DETAILS</Text>
          <View style={s.setDetailRow}>
            <Text style={[s.setDetailLabel, { color: colors.grey }]}>Per Set Duration (Min)</Text>
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
          <View style={s.setDetailRow}>
            <Text style={[s.setDetailLabel, { color: colors.grey }]}>Slot Type</Text>
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
        </View>

        {/* ── Slot info rows ────────────────────────────────────── */}
        {(hasPayment || paymentMethod || minNotice || slotNote) ? (
          <View style={[s.slotInfoBlock, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
            {paymentModels.map((model, idx) => {
              const isFirst = idx === 0;
              let valueText = model;
              if (model === 'Flat fee' && feeMin != null) {
                const range = feeMax != null && feeMax !== feeMin ? `$${feeMin}-$${feeMax}` : `$${feeMin}`;
                valueText = `Flat fee · ${range}`;
              }
              return (
                <View key={model} style={[s.slotInfoRow, !isFirst && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <Text style={[s.slotInfoLabel, { color: colors.grey }]}>{isFirst ? 'Payment' : ''}</Text>
                  <Text style={[s.slotInfoText, { color: colors.black }]}>{valueText}</Text>
                </View>
              );
            })}
            {paymentMethod ? (
              <View style={[s.slotInfoRow, hasPayment ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
                <Text style={[s.slotInfoLabel, { color: colors.grey }]}>Via</Text>
                <Text style={[s.slotInfoText, { color: colors.black }]}>{paymentMethod}</Text>
              </View>
            ) : null}
            {minNotice ? (
              <View style={[s.slotInfoRow, (hasPayment || paymentMethod) ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
                <Text style={[s.slotInfoLabel, { color: colors.grey }]}>Min. notice</Text>
                <Text style={[s.slotInfoText, { color: colors.black }]}>{minNotice}</Text>
              </View>
            ) : null}
            {slotNote ? (
              <View style={[s.slotInfoRow, (hasPayment || paymentMethod || minNotice) ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
                <Text style={[s.slotInfoLabel, { color: colors.grey }]}>Venue notes</Text>
                <Text style={[s.slotInfoText, { color: colors.black }]}>{slotNote}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
                computedDraw != null ? `~${computedDraw} draw` : null,
                (band.feeMin != null && band.feeMax != null) ? `$${band.feeMin}-$${band.feeMax}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* ── What you're sending ───────────────────────────────── */}
        <View style={s.sectionsBlock}>
          <View style={s.sectionsHeader}>
            <Text style={[s.sectionsTitle, { color: colors.grey }]}>WHAT YOU'RE SENDING</Text>
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
                  style={[s.checkCell, { borderColor: checked ? Colors.orange : colors.border, backgroundColor: checked ? Colors.orange + '0d' : colors.bg }]}
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

        {/* ── Note to the venue ─────────────────────────────────── */}
        <View style={s.fieldBlock}>
          <View style={s.noteLabelRow}>
            <Text style={[s.fieldLabel, { color: colors.black }]}>Note to the venue</Text>
            <Text style={s.optionalLabel}>Optional</Text>
          </View>
          <TextInput
            style={[s.textarea, { backgroundColor: colors.bgFaint, color: colors.black, borderColor: colors.border }]}
            placeholder="Draw size, PA requirements, similar rooms you've played..."
            placeholderTextColor={colors.greyLight}
            multiline
            numberOfLines={3}
            value={note}
            onChangeText={setNote}
            textAlignVertical="top"
          />
        </View>

        {/* ── Availability confirmation ──────────────────────────── */}
        <TouchableOpacity
          style={[s.availRow, { borderColor: availConfirmed ? Colors.orange : colors.border, backgroundColor: availConfirmed ? Colors.orange + '0d' : colors.bgFaint }]}
          onPress={() => setAvailConfirmed(v => !v)}
          activeOpacity={0.75}
        >
          <View style={[s.checkbox, availConfirmed && s.checkboxOn]}>
            {availConfirmed ? <Text style={s.checkMark}>✓</Text> : null}
          </View>
          <Text style={[s.availLabel, { color: colors.black }]}>I confirm I'm available on this date and time.</Text>
        </TouchableOpacity>

        {/* ── Error ─────────────────────────────────────────────── */}
        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Footer bar ────────────────────────────────────────────── */}
      <View style={[s.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        {blockedReason ? (
          <View style={s.blockedBanner}>
            <Text style={s.blockedBannerText}>{blockedReason}</Text>
          </View>
        ) : (
          <View style={{ width: '100%', gap: 10 }}>
            <Text style={[s.footerMeta, { color: colors.grey }]}>{selectedCount} of {SECTIONS.length} profile sections included</Text>
            <Text style={[s.whatsNextText, { color: colors.grey }]}>
              The venue will review your enquiry and respond in your inbox. You won't be charged or booked until they accept.
            </Text>
            <View style={s.footerActions}>
              <TouchableOpacity
                style={[s.cancelBtn, { borderColor: colors.border }]}
                onPress={() => router.back()}
              >
                <Text style={[s.cancelBtnText, { color: colors.black }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sendBtn, (submitting || !availConfirmed) && { opacity: 0.5 }]}
                onPress={handleSubmit}
                disabled={submitting || !availConfirmed}
              >
                {submitting
                  ? <ActivityIndicator color="#ffffff" size="small" />
                  : <Text style={s.sendBtnText}>Send Enquiry</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  slotName:   { fontSize: 14, fontWeight: '600', marginTop: 2 },
  slotDetail: { fontSize: 13, color: Colors.grey, marginTop: 3 },
  slotNote:   { fontSize: 13, color: Colors.grey, marginTop: 4, fontStyle: 'italic' },
  closeBtn:     { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  closeBtnText: { fontSize: 14, fontWeight: '600' },

  // ── Slot info block ───────────────────────────────────────────────────────
  slotInfoBlock: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden' as any,
  },
  slotInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slotInfoLabel: { fontSize: 12, fontWeight: '600', lineHeight: 20, width: 90 },
  slotInfoText:  { fontSize: 13, fontWeight: '500', flex: 1, lineHeight: 20 },

  // ── Profile sections ──────────────────────────────────────────────────────
  sectionsBlock: { gap: 10 },
  sectionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionsTitle:  { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  selectAll:      { fontSize: 13, fontWeight: '600', color: Colors.orange },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkCell: {
    width: '48%' as any,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  checkLabel:   { fontSize: 13, fontWeight: '600' },
  checkPreview: { fontSize: 11, opacity: 0.7 },

  // ── Footer meta ───────────────────────────────────────────────────────────
  footerMeta: { fontSize: 12, textAlign: 'center' },

  // ── What you're sending ───────────────────────────────────────────────────
  sendingDesc: { fontSize: 13, lineHeight: 19 },

  // ── Set details block ─────────────────────────────────────────────────────
  setDetailsBlock: { gap: 12 },
  setDetailsHeading: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: -4 },
  setDetailRow: { gap: 8 },
  setDetailLabel: { fontSize: 13, fontWeight: '600' },

  // ── Availability confirmation ─────────────────────────────────────────────
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 8,
    padding: 12,
  },
  availLabel: { fontSize: 14, fontWeight: '500', flex: 1 },

  // ── What happens next ─────────────────────────────────────────────────────
  whatsNextText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },

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

  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkMark:  { fontSize: 11, color: '#ffffff', fontWeight: '800', lineHeight: 14 },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: { fontSize: 13, color: '#e94560', textAlign: 'center' },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    flexShrink: 0,
  },
  footerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  blockedBanner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  blockedBannerText: { fontSize: 13, color: Colors.grey, fontWeight: '600', textAlign: 'center' },
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
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

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
