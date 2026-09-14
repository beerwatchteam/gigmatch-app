import { useState, useEffect, useRef } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Image, Linking, useWindowDimensions, Modal, Animated, Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOP_TAB_H, BOTTOM_TAB_H, WEB_TAB_H } from './_layout';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages, useSupportEnquiries,
  useParticipants,
  updateEnquiryStatus, sendMessage, cancelEnquiry, archiveEnquiry,
  bookSlotOnTimetable, cancelAcceptance, markEnquiryRead,
  inviteParticipants, leaveGig, removeParticipantFromGig,
  confirmHeadliner, ensureVenueParticipant,
  normalizeEnquiryStatus,
  fetchVenuePastCollaborators, fetchHeadlinerPastCollaborators,
  type Enquiry, type Participant,
} from '@/lib/useEnquiries';
import {
  useDMConversations, useDMMessages,
  sendDMMessage, acceptDMRequest, deleteDMConv,
  type DMConv,
} from '@/lib/useDirectMessages';
import { doc, getDoc, updateDoc, getDocs, collection, query, where, limit, arrayRemove, addDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { Toast } from '@/components/Toast';

/** Fetches and caches a venue's photoUrl for display in artist-side tiles/threads. */
function useVenuePhoto(venueId: string | null | undefined): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!venueId) return;
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) setPhoto(snap.data().photoUrl ?? null);
    }).catch(() => {});
  }, [venueId]);
  return photo;
}

/** Resolves a user's real display name and photo from their profile collections. */
function useUserDisplayInfo(uid: string | null): { name: string | null; photoUrl: string | null } {
  const [info, setInfo] = useState<{ name: string | null; photoUrl: string | null }>({ name: null, photoUrl: null });
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDoc(doc(db, 'users', uid)).then(async userSnap => {
      if (cancelled || !userSnap.exists()) return;
      const userData = userSnap.data();
      const name = userData.displayName || null;
      const type = userData.type as string;
      const venueId = userData.venueId as string | undefined;
      let photoUrl: string | null = null;
      if (type === 'artist') {
        const bpSnap = await getDoc(doc(db, 'bandProfiles', uid));
        if (!cancelled && bpSnap.exists()) photoUrl = bpSnap.data().photoUrl ?? null;
      } else if (type === 'venue' && venueId) {
        const vSnap = await getDoc(doc(db, 'venues', venueId));
        if (!cancelled && vSnap.exists()) photoUrl = vSnap.data().photoUrl ?? null;
      }
      if (!cancelled) setInfo({ name, photoUrl });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [uid]);
  return info;
}

const isWeb = Platform.OS === 'web';

// Persists tab choice within the session; defaults to 'enquiries' on fresh load
let _sessionInboxTab: 'enquiries' | 'messages' = 'enquiries';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMsgTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function fmtSlotDate(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function fmtSlotDateFull(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getDateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}


function formatTileDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return (name || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ── Status config (viewer-aware) ───────────────────────────────────────────

type StatusCfg = { label: string; color: string; bg: string };

function getStatusCfg(status: string, isVenue: boolean): StatusCfg {
  const s = normalizeEnquiryStatus(status as Enquiry['status']);
  switch (s) {
    case 'enquired':
      return isVenue
        ? { label: 'AWAITING RESPONSE', color: '#f5a623', bg: 'rgba(245,166,35,0.12)' }
        : { label: 'AWAITING REPLY',    color: '#888888', bg: 'rgba(0,0,0,0.06)'      };
    case 'discussing':
      return { label: 'DISCUSSING', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
    case 'confirmed':
      return { label: 'CONFIRMED',  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'  };
    case 'declined':
      return { label: 'DECLINED',   color: '#dc2626', bg: 'rgba(220,38,38,0.1)'  };
    case 'cancelled':
      return { label: 'CANCELLED',  color: '#888888', bg: 'rgba(0,0,0,0.06)'     };
    default:
      return { label: s.toUpperCase(), color: '#888888', bg: 'rgba(0,0,0,0.06)' };
  }
}

function StatusBadge({ status, isVenue }: { status: string; isVenue: boolean }) {
  const cfg = getStatusCfg(status, isVenue);
  return (
    <View style={sb.wrap}>
      <Text style={[sb.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start', borderWidth: 1, borderColor: '#d0ccc7', backgroundColor: '#ffffff',
  },
  text: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
});

// ── Date separator ─────────────────────────────────────────────────────────

function DateSep({ label }: { label: string }) {
  return (
    <View style={ds.wrap}>
      <Text style={ds.text}>{label}</Text>
    </View>
  );
}
const ds = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: 8 },
  text: { fontSize: 11, color: '#aaaaaa', fontWeight: '600' },
});

// ── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ photoUrl, name, size }: { photoUrl?: string | null; name: string; size: number }) {
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e8e8e8' }}
      />
    );
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#999999' }}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

// ── AvatarStack — overlapping avatars for group gig tiles ──────────────────

function AvatarStack({
  participants,
  venuePhoto,
  size = 36,
}: {
  participants: Participant[];
  venuePhoto: string | null;
  size?: number;
}) {
  // Show venue first, then up to 2 more, then +N badge
  const active = participants.filter(p => p.role !== 'venue' && (p.state === 'confirmed' || p.state === 'invited'));
  const shown  = active.slice(0, 2);
  const extra  = active.length - shown.length;
  const overlap = Math.round(size * 0.4);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', width: size + (shown.length) * (size - overlap) + (extra > 0 ? size * 0.6 : 0) }}>
      {/* Venue avatar */}
      <View style={{ zIndex: 10, borderRadius: size / 2, borderWidth: 2, borderColor: '#ffffff' }}>
        <Avatar photoUrl={venuePhoto} name="Venue" size={size} />
      </View>
      {shown.map((p, i) => (
        <View
          key={p.id}
          style={{ marginLeft: -overlap, zIndex: 9 - i, borderRadius: size / 2, borderWidth: 2, borderColor: '#ffffff' }}
        >
          <Avatar photoUrl={p.photoUrl} name={p.displayName} size={size} />
        </View>
      ))}
      {extra > 0 && (
        <View style={{
          marginLeft: -overlap, zIndex: 1,
          width: size * 0.75, height: size * 0.75, borderRadius: size * 0.375,
          backgroundColor: '#e0e0e0', alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: '#ffffff',
        }}>
          <Text style={{ fontSize: size * 0.28, fontWeight: '700', color: '#666666' }}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// ── Deal sheet bar (horizontal) ────────────────────────────────────────────

function DealSheetGrid({ enquiry, onDetails }: { enquiry: Enquiry; onDetails: () => void }) {
  const { setLength, time, date, day } = enquiry.requestedSlot;
  const dateStr = date ? fmtSlotDateFull(date) : (day || '—');
  const setStr  = [time, setLength].filter(Boolean).join(' · ') || '—';

  return (
    <View style={dg.bar}>
      <View style={[dg.col, dg.colDivider]}>
        <Text style={dg.label}>DATE</Text>
        <Text style={dg.value} numberOfLines={1}>{dateStr}</Text>
      </View>
      <View style={[dg.col, dg.colDivider]}>
        <Text style={dg.label}>SET</Text>
        <Text style={dg.value} numberOfLines={1}>{setStr}</Text>
      </View>
      <TouchableOpacity style={dg.detailsBtn} onPress={onDetails} activeOpacity={0.7}>
        <Text style={dg.detailsText}>More Details →</Text>
      </TouchableOpacity>
    </View>
  );
}

const dg = StyleSheet.create({
  bar:         { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eeeeee', marginTop: 12 },
  col:         { flex: 1, paddingVertical: 10, paddingHorizontal: 8 },
  colDivider:  { borderRightWidth: 1, borderRightColor: '#eeeeee' },
  label:       { fontSize: 9, fontWeight: '700', color: '#aaaaaa', letterSpacing: 0.7, marginBottom: 4, textTransform: 'uppercase' as const },
  value:       { fontSize: 13, fontWeight: '700', color: '#111111' },
  detailsBtn:  { paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  detailsText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
});

// ── Enquiry header (compact) ───────────────────────────────────────────────

function EnquiryHeader({ enquiry, isVenue, onBack, onDelete, onScrollToProfile, onScrollToMusic, onScrollToTech, participants, currentUserUid, onOpenSubThread, onInvite, onRemove }: {
  enquiry: Enquiry; isVenue: boolean; onBack?: () => void; onDelete?: () => void;
  onScrollToProfile?: () => void; onScrollToMusic?: () => void; onScrollToTech?: () => void;
  participants?: Participant[];
  currentUserUid?: string;
  onOpenSubThread?: OnOpenSubThread;
  onInvite?: () => void;
  onRemove?: (p: Participant) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const { day, date, time, slotType, setLength } = enquiry.requestedSlot;
  const dateStr    = date ? fmtSlotDate(date) : '';
  const dateStrFull = date ? fmtSlotDateFull(date) : (day || '—');
  const slotStr    = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const setStr     = [time, setLength].filter(Boolean).join(' · ') || '—';
  const billing    = slotType || '—';
  const fee        = (enquiry as any).fee ? `$${(enquiry as any).fee}` : '—';

  const [menuOpen,    setMenuOpen]    = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notes,            setNotes]            = useState<string>((enquiry as any).importantNotes ?? '');
  const [notesEdited,      setNotesEdited]      = useState(false);
  const [notesSaving,      setNotesSaving]      = useState(false);
  const [paymentInfo,      setPaymentInfo]      = useState<string>((enquiry as any).paymentInfo ?? '');
  const [paymentInfoEdited,setPaymentInfoEdited]= useState(false);
  const [paymentInfoSaving,setPaymentInfoSaving]= useState(false);
  const [notesDoc,         setNotesDoc]         = useState<{ url: string; name: string } | null>((enquiry as any).notesDoc ?? null);
  const [notesDocUploading,setNotesDocUploading]= useState(false);
  const [loadInTime,       setLoadInTime]       = useState<string>(enquiry.loadInTime ?? '');
  const [soundCheckTime,   setSoundCheckTime]   = useState<string>(enquiry.soundCheckTime ?? '');
  const [scheduleEdited,   setScheduleEdited]   = useState(false);
  const [scheduleSaving,   setScheduleSaving]   = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const { width: windowWidth } = useWindowDimensions();

  const [slotPaymentModel,    setSlotPaymentModel]    = useState<string | null>(null);
  const [venuePaymentModels,  setVenuePaymentModels]  = useState<string[]>([]);
  const [paymentFetched,      setPaymentFetched]      = useState(false);
  const [paymentPickerOpen,   setPaymentPickerOpen]   = useState(false);
  const [enquiryPaymentModel, setEnquiryPaymentModel] = useState<string | null>((enquiry as any).paymentModel ?? null);

  async function fetchPaymentData() {
    if (paymentFetched) return;
    try {
      const venueSnap = await getDoc(doc(db, 'venues', enquiry.venueId));
      if (venueSnap.exists()) {
        const venueData = venueSnap.data();
        const { day, time } = enquiry.requestedSlot;
        const slots: any[] = venueData.slots?.[day] || [];
        const match = slots.find((s: any) => s.time === time && !s.date);
        setSlotPaymentModel(match?.paymentModel || null);
        setVenuePaymentModels(venueData.payment?.models || []);
        // Pre-populate load in / sound check from the slot if the enquiry has no saved value
        if (!enquiry.loadInTime && match?.loadIn) setLoadInTime(match.loadIn);
        if (!enquiry.soundCheckTime && match?.soundcheck) setSoundCheckTime(match.soundcheck);
      }
    } catch {}
    setPaymentFetched(true);
  }

  function openDetails() {
    setDetailsOpen(true);
    fetchPaymentData();
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }

  function closeDetails(onClosed?: () => void) {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start(() => {
      setDetailsOpen(false);
      onClosed?.();
    });
  }

  async function saveSchedule() {
    setScheduleSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), {
      loadInTime: loadInTime.trim(),
      soundCheckTime: soundCheckTime.trim(),
    });
    setScheduleEdited(false);
    setScheduleSaving(false);
  }

  async function saveNotes() {
    setNotesSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), { importantNotes: notes.trim() });
    setNotesEdited(false);
    setNotesSaving(false);
  }

  async function pickNotesDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setNotesDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `enquiry-docs/${enquiry.id}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      const newDoc = { url, name: asset.name };
      await updateDoc(doc(db, 'inquiries', enquiry.id), { notesDoc: newDoc });
      setNotesDoc(newDoc);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setNotesDocUploading(false);
    }
  }

  const quickLinks = [
    { label: 'Profile',    onPress: onScrollToProfile },
    { label: 'Music',      onPress: onScrollToMusic   },
    { label: 'Tech Specs', onPress: onScrollToTech    },
  ].filter(l => l.onPress);

  const DRAWER_WIDTH = isWeb ? 340 : windowWidth;

  return (
    <>
      <View style={[eh.card, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
        <View style={eh.titleRow}>
          {onBack && (
            <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={eh.back}>←</Text>
            </TouchableOpacity>
          )}
          <View style={eh.titleInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
              <Text style={[eh.name, { color: colors.black }]} numberOfLines={1}>{who}</Text>
              <StatusBadge status={enquiry.status} isVenue={isVenue} />
            </View>
            {slotStr ? (
              <Text style={[eh.slot, { color: colors.grey }]} numberOfLines={1}>{slotStr}</Text>
            ) : null}
            <View style={eh.quickLinks}>
              {quickLinks.map((l, i) => (
                <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {i > 0 && <Text style={eh.quickLinkSep}>·</Text>}
                  <TouchableOpacity onPress={l.onPress} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <Text style={eh.quickLinkText}>{l.label}</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {quickLinks.length > 0 && <Text style={eh.quickLinkSep}>·</Text>}
              <TouchableOpacity onPress={openDetails} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <Text style={eh.detailsLink}>Details</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Details drawer */}
      <Modal visible={detailsOpen} transparent animationType="none" onRequestClose={() => closeDetails()}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <TouchableOpacity style={eh.drawerBackdrop} activeOpacity={1} onPress={() => closeDetails()} />
          <Animated.View style={[
            eh.drawerPanel,
            { width: DRAWER_WIDTH, backgroundColor: colors.bg, borderLeftColor: colors.border },
            { transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [DRAWER_WIDTH, 0] }) }] },
          ]}>
            {/* Drawer header */}
            <View style={[eh.drawerHeader, { borderBottomColor: colors.border, paddingTop: (isWeb ? 0 : insets.top) + 16 }]}>
              <Text style={[eh.drawerTitle, { color: colors.black }]}>Details</Text>
              <TouchableOpacity onPress={() => closeDetails()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={eh.drawerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={eh.drawerContent} showsVerticalScrollIndicator={false}>

              {/* Gig info */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Gig Info</Text>
              <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                {[
                  { key: 'Date',     val: dateStrFull },
                  { key: 'Set Time', val: setStr      },
                ].map((row, i) => (
                  <View key={row.key} style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                    <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>{row.key}</Text>
                    <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{row.val}</Text>
                  </View>
                ))}
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Load In</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={loadInTime}
                    onChangeText={t => { setLoadInTime(t); setScheduleEdited(true); }}
                    placeholder="e.g. 4:00 PM"
                    placeholderTextColor="#aaaaaa"
                  />
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Sound Check</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={soundCheckTime}
                    onChangeText={t => { setSoundCheckTime(t); setScheduleEdited(true); }}
                    placeholder="e.g. 5:00 PM"
                    placeholderTextColor="#aaaaaa"
                  />
                </View>
                <View style={eh.drawerInfoRow}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Slot</Text>
                  <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{billing}</Text>
                </View>
              </View>
              {scheduleEdited && (
                <View style={eh.drawerNotesBtns}>
                  <TouchableOpacity
                    style={eh.drawerCancelBtn}
                    onPress={() => {
                      setLoadInTime(enquiry.loadInTime ?? '');
                      setSoundCheckTime(enquiry.soundCheckTime ?? '');
                      setScheduleEdited(false);
                    }}
                  >
                    <Text style={eh.drawerCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={eh.drawerSaveBtn} onPress={saveSchedule} disabled={scheduleSaving}>
                    {scheduleSaving
                      ? <ActivityIndicator color="#111111" size="small" />
                      : <Text style={eh.drawerSaveBtnText}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {/* Participants — always shown for venues; also shown when participants exist */}
              {(isVenue || (participants && participants.length > 0)) && onInvite && (() => {
                const visible   = (participants ?? []).filter(p => p.state !== 'left');
                const myPart    = (participants ?? []).find(p => p.userId === currentUserUid);
                const canInvite = isVenue || myPart?.role === 'headliner';
                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Participants</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      {visible.length === 0 && (
                        <View style={eh.drawerInfoRow}>
                          <Text style={{ fontSize: 14, color: colors.grey }}>No participants yet.</Text>
                        </View>
                      )}
                      {visible.map((p, i) => {
                        const isMe = p.userId === currentUserUid;
                        const pending = p.state === 'invited';
                        return (
                          <TouchableOpacity
                            key={p.id}
                            style={[eh.drawerInfoRow, i < visible.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                            onPress={() => { if (!isMe && onOpenSubThread) { closeDetails(); setTimeout(() => onOpenSubThread(p.userId, p.displayName, p.photoUrl), 350); } }}
                            activeOpacity={isMe ? 1 : 0.7}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                              <Avatar photoUrl={p.photoUrl} name={p.displayName} size={28} />
                              <View>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }} numberOfLines={1}>{p.displayName}</Text>
                                <Text style={{ fontSize: 11, color: colors.grey }}>
                                  {p.role === 'venue' ? 'Venue' : p.role === 'headliner' ? 'Headliner' : 'Support Act'}
                                </Text>
                              </View>
                            </View>
                            {pending && (
                              <Text style={{ fontSize: 11, fontWeight: '600', color: '#888888' }}>Invited</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      {canInvite && (
                        <TouchableOpacity
                          style={[eh.drawerInfoRow, { borderTopWidth: visible.length > 0 ? 1 : 0, borderTopColor: colors.border }]}
                          onPress={() => { closeDetails(); setTimeout(() => onInvite!(), 350); }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.orange }}>+ Invite Support Act</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                );
              })()}

              {/* Payment method */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Payment Method</Text>
              {(() => {
                const displayModel = slotPaymentModel || enquiryPaymentModel;
                if (displayModel) {
                  return (
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      <View style={eh.drawerInfoRow}>
                        <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Method</Text>
                        <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{displayModel}</Text>
                      </View>
                    </View>
                  );
                }
                if (!isVenue) {
                  return (
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      <View style={eh.drawerInfoRow}>
                        <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Method</Text>
                        <Text style={[eh.drawerInfoVal, { color: colors.grey }]}>Not set</Text>
                      </View>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border, paddingVertical: 14, alignItems: 'center' }]}
                    onPress={() => setPaymentPickerOpen(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.orange }}>+ Add Payment Method</Text>
                  </TouchableOpacity>
                );
              })()}
              <TextInput
                style={[eh.drawerNotesInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border, minHeight: 72, marginTop: 6 }]}
                value={paymentInfo}
                onChangeText={t => { setPaymentInfo(t); setPaymentInfoEdited(true); }}
                placeholder="Add payment details for this gig, e.g. agreed amount, timing, special terms..."
                placeholderTextColor="#aaaaaa"
                multiline
                textAlignVertical="top"
              />
              {paymentInfoEdited && (
                <View style={eh.drawerNotesBtns}>
                  <TouchableOpacity
                    style={eh.drawerCancelBtn}
                    onPress={() => { setPaymentInfo((enquiry as any).paymentInfo ?? ''); setPaymentInfoEdited(false); }}
                  >
                    <Text style={eh.drawerCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={eh.drawerSaveBtn}
                    onPress={async () => {
                      setPaymentInfoSaving(true);
                      await updateDoc(doc(db, 'inquiries', enquiry.id), { paymentInfo: paymentInfo.trim() });
                      setPaymentInfoEdited(false);
                      setPaymentInfoSaving(false);
                    }}
                    disabled={paymentInfoSaving}
                  >
                    {paymentInfoSaving
                      ? <ActivityIndicator color="#111111" size="small" />
                      : <Text style={eh.drawerSaveBtnText}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {/* Quick links */}
              {quickLinks.length > 0 && (
                <>
                  <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Quick View</Text>
                  <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                    {quickLinks.map((l, i, arr) => (
                      <TouchableOpacity
                        key={l.label}
                        style={[eh.drawerInfoRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                        onPress={() => { closeDetails(); setTimeout(() => l.onPress?.(), 350); }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.orange }}>{l.label}</Text>
                        <Text style={{ fontSize: 14, color: Colors.orange }}>→</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Important Notes */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Important Notes</Text>
              <TextInput
                style={[eh.drawerNotesInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
                value={notes}
                onChangeText={t => { setNotes(t); setNotesEdited(true); }}
                placeholder="Add key details, agreements, requirements, anything worth pinning..."
                placeholderTextColor="#aaaaaa"
                multiline
                textAlignVertical="top"
              />
              {notesEdited && (
                <View style={eh.drawerNotesBtns}>
                  <TouchableOpacity
                    style={eh.drawerCancelBtn}
                    onPress={() => { setNotes((enquiry as any).importantNotes ?? ''); setNotesEdited(false); }}
                  >
                    <Text style={eh.drawerCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={eh.drawerSaveBtn} onPress={saveNotes} disabled={notesSaving}>
                    {notesSaving
                      ? <ActivityIndicator color="#111111" size="small" />
                      : <Text style={eh.drawerSaveBtnText}>Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {/* Notes document */}
              {notesDoc ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginTop: 10 }}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => Linking.openURL(notesDoc.url)}>
                    <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }} numberOfLines={1}>↓ {notesDoc.name}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      await updateDoc(doc(db, 'inquiries', enquiry.id), { notesDoc: null });
                      setNotesDoc(null);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontSize: 14, color: '#e94560', fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={{ marginTop: 10, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.bgFaint }}
                  onPress={pickNotesDocument}
                  disabled={notesDocUploading}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.orange }}>
                    {notesDocUploading ? 'Uploading…' : '+ Attach Document'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Delete conversation */}
              {onDelete && (
                <TouchableOpacity
                  style={{ marginTop: 24, marginBottom: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', backgroundColor: 'rgba(220,38,38,0.04)' }}
                  onPress={() => closeDetails(() => setConfirmOpen(true))}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>Delete this conversation</Text>
                </TouchableOpacity>
              )}

            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
          <View style={[md.confirm, { backgroundColor: colors.bg }]}>
            <Text style={[md.confirmTitle, { color: colors.black }]}>Delete conversation?</Text>
            <Text style={[md.confirmBody, { color: colors.grey }]}>
              This will remove the conversation from your inbox. This can't be undone.
            </Text>
            <View style={md.confirmBtns}>
              <TouchableOpacity style={[md.confirmBtn, { borderColor: colors.border }]} onPress={() => setConfirmOpen(false)}>
                <Text style={[md.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmOpen(false); onDelete?.(); }}>
                <Text style={md.confirmBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={paymentPickerOpen} transparent animationType="fade" onRequestClose={() => setPaymentPickerOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setPaymentPickerOpen(false)}>
          <View style={[md.sheet, { backgroundColor: colors.bg }]}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#888888', letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 }}>Select Payment Method</Text>
            {venuePaymentModels.length === 0 ? (
              <View style={{ paddingHorizontal: 24, paddingVertical: 16 }}>
                <Text style={{ fontSize: 14, color: '#888888' }}>No payment methods set up on your venue profile yet.</Text>
              </View>
            ) : (
              venuePaymentModels.map((model) => (
                <TouchableOpacity
                  key={model}
                  style={md.sheetItem}
                  onPress={async () => {
                    await updateDoc(doc(db, 'inquiries', enquiry.id), { paymentModel: model });
                    setEnquiryPaymentModel(model);
                    setPaymentPickerOpen(false);
                  }}
                >
                  <Text style={[md.sheetText, { color: colors.black }]}>{model}</Text>
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity style={[md.sheetItem, md.sheetCancelItem]} onPress={() => setPaymentPickerOpen(false)}>
              <Text style={[md.sheetText, { color: colors.grey }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const eh = StyleSheet.create({
  card:              { paddingTop: isWeb ? 16 : 14, paddingHorizontal: isWeb ? 24 : 16, paddingBottom: 14, borderBottomWidth: 1, flexShrink: 0 },
  titleRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 },
  rightCol:          { alignItems: 'flex-end', flexShrink: 0, marginRight: 4 },
  detailsLink:       { fontSize: 13, fontWeight: '600', color: '#111111' },
  back:              { fontSize: 18, color: Colors.orange, fontWeight: '600', marginRight: 2 },
  titleInfo:         { flex: 1, minWidth: 0 },
  name:              { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  slot:              { fontSize: 15, marginTop: 2 },
  quickLinks:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  quickLinkText:     { fontSize: 12, fontWeight: '600', color: Colors.orange },
  quickLinkSep:      { fontSize: 12, color: '#cccccc', marginRight: 6 },
  dots:              { fontSize: 22, color: '#aaaaaa', letterSpacing: 1, marginLeft: 4 },
  // Details drawer
  drawerBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawerPanel:       { position: 'absolute' as any, top: 0, right: 0, bottom: 0, borderLeftWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: -4, height: 0 }, elevation: 12 },
  drawerHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  drawerTitle:       { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  drawerClose:       { fontSize: 18, color: '#aaaaaa', fontWeight: '600' },
  drawerContent:     { padding: 20, gap: 6, paddingBottom: 40 },
  drawerSectionLabel:{ fontSize: 15, fontWeight: '800', color: '#111111', letterSpacing: -0.2, marginTop: 20, marginBottom: 8 },
  drawerInfoCard:    { borderRadius: 12, borderWidth: 1, overflow: 'hidden' as const },
  drawerInfoRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  drawerInfoKey:     { fontSize: 13, fontWeight: '600' },
  drawerInfoVal:     { fontSize: 13, fontWeight: '700' },
  drawerInlineInput: { fontSize: 13, fontWeight: '700', textAlign: 'right', flex: 1, paddingLeft: 8 },
  drawerNotesInput:  { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 14, minHeight: 120, lineHeight: 21, marginTop: 0 },
  drawerNotesBtns:   { flexDirection: 'row', gap: 10, marginTop: 10 },
  drawerCancelBtn:   { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  drawerCancelBtnText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  drawerSaveBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.orange, alignItems: 'center' },
  drawerSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
});

// ── Participant strip ───────────────────────────────────────────────────────

type OnOpenSubThread = (otherUid: string, otherName: string, otherPhoto: string | null) => void;

function ParticipantStrip({
  participants,
  currentUserUid,
  enquiryId,
  venueName,
  gigDate,
  onOpenSubThread,
  onInvite,
  onRemove,
}: {
  participants: Participant[];
  currentUserUid: string;
  enquiryId: string;
  venueName: string;
  gigDate: string;
  onOpenSubThread: OnOpenSubThread;
  onInvite: () => void;
  onRemove: (p: Participant) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const myParticipant = participants.find(p => p.userId === currentUserUid);
  const canInvite = myParticipant?.role === 'venue' || myParticipant?.role === 'headliner';
  const canRemove = myParticipant?.role === 'venue';

  // Active = invited or confirmed (shown in strip). Declined shown de-emphasised. Left = hidden.
  const active   = participants.filter(p => p.state === 'invited' || p.state === 'confirmed');
  const declined = participants.filter(p => p.state === 'declined');

  const [contextMenu, setContextMenu] = useState<{ participant: Participant; x: number; y: number } | null>(null);

  function stateTag(p: Participant) {
    if (p.role === 'venue') return null;
    if (p.state === 'confirmed') return { label: 'Confirmed', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', border: '#bbf7d0' };
    if (p.state === 'invited')   return { label: 'Invited',   color: '#888888', bg: 'rgba(0,0,0,0.05)',    border: '#d0ccc7' };
    return null;
  }

  return (
    <>
      <View style={[ps.strip, { borderBottomColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ps.row}
        >
          {active.map(p => {
            const tag  = stateTag(p);
            const isMe = p.userId === currentUserUid;
            return (
              <TouchableOpacity
                key={p.id}
                style={ps.avatarCol}
                onPress={() => {
                  if (!isMe) onOpenSubThread(p.userId, p.displayName, p.photoUrl);
                }}
                onLongPress={e => {
                  if (canRemove && !isMe && p.role !== 'venue' && p.role !== 'headliner') {
                    const { pageX, pageY } = e.nativeEvent;
                    setContextMenu({ participant: p, x: pageX, y: pageY });
                  }
                }}
                activeOpacity={isMe ? 1 : 0.7}
              >
                <View style={ps.avatarWrap}>
                  <Avatar photoUrl={p.photoUrl} name={p.displayName} size={30} />
                </View>
                <Text style={[ps.avatarName, { color: colors.black }]} numberOfLines={1}>{p.displayName}</Text>
                {tag && (
                  <View style={[ps.stateTag, { backgroundColor: tag.bg, borderColor: tag.border }]}>
                    <Text style={[ps.stateTagText, { color: tag.color }]}>{tag.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {declined.map(p => (
            <View key={p.id} style={[ps.avatarCol, ps.avatarColDeclined]}>
              <View style={[ps.avatarWrap, { opacity: 0.4 }]}>
                <Avatar photoUrl={p.photoUrl} name={p.displayName} size={40} />
              </View>
              <Text style={[ps.avatarName, { color: colors.grey }]} numberOfLines={1}>{p.displayName}</Text>
              <View style={[ps.stateTag, { backgroundColor: 'rgba(220,38,38,0.08)', borderColor: '#fca5a5' }]}>
                <Text style={[ps.stateTagText, { color: '#dc2626' }]}>Declined</Text>
              </View>
            </View>
          ))}

          {canInvite && (
            <TouchableOpacity style={ps.inviteBtn} onPress={onInvite} activeOpacity={0.7}>
              <View style={[ps.inviteCircle, { borderColor: colors.border }]}>
                <Text style={[ps.invitePlus, { color: Colors.orange }]}>+</Text>
              </View>
              <Text style={[ps.avatarName, { color: Colors.orange }]}>Invite</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Action sheet for venue removing a participant */}
      {contextMenu && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
          <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setContextMenu(null)}>
            <View style={[md.sheet, { backgroundColor: colors.bg }]}>
              <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#888888', fontWeight: '600' }}>
                  {contextMenu.participant.displayName}
                </Text>
              </View>
              <TouchableOpacity
                style={md.sheetItem}
                onPress={() => { setContextMenu(null); onRemove(contextMenu.participant); }}
              >
                <Text style={md.sheetDanger}>Remove from gig</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[md.sheetItem, md.sheetCancelItem]} onPress={() => setContextMenu(null)}>
                <Text style={[md.sheetText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}

const ps = StyleSheet.create({
  strip:           { borderBottomWidth: 1 },
  row:             { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 2, alignItems: 'flex-start' },
  avatarCol:       { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  avatarColDeclined: { opacity: 0.7 },
  avatarWrap:      { borderRadius: 16 },
  avatarName:      { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  stateTag:        { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1 },
  stateTagText:    { fontSize: 8, fontWeight: '700', letterSpacing: 0.2 },
  inviteBtn:       { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  inviteCircle:    { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  invitePlus:      { fontSize: 18, fontWeight: '300', lineHeight: 22, marginTop: -1 },
});

// ── Invite sheet ────────────────────────────────────────────────────────────

type MusicianRow = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  genre?: string;
  location?: string;
};

function InviteSheet({
  visible,
  onClose,
  enquiryId,
  participants,
  inviterUid,
  inviterName,
  inviterRole,
  venueId,
  venueName,
  onInvited,
}: {
  visible: boolean;
  onClose: () => void;
  enquiryId: string;
  participants: Participant[];
  inviterUid: string;
  inviterName: string;
  inviterRole: 'venue' | 'headliner';
  venueId: string;
  venueName: string;
  onInvited: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch]           = useState('');
  const [allMusicians, setAll]        = useState<MusicianRow[]>([]);
  const [pastCollabs, setPastCollabs] = useState<MusicianRow[]>([]);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [loading, setLoading]         = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const alreadyIn = new Set(participants.map(p => p.userId));

  useEffect(() => {
    if (!visible) { setSearch(''); setSelected(new Set()); return; }
    setLoading(true);

    async function load() {
      try {
        // Load past collaborators
        if (inviterRole === 'venue') {
          const collabs = await fetchVenuePastCollaborators(venueId);
          setPastCollabs(collabs.filter(c => !alreadyIn.has(c.userId)));
        } else {
          const collabs = await fetchHeadlinerPastCollaborators(inviterUid);
          setPastCollabs(collabs.filter(c => !alreadyIn.has(c.userId)));
        }

        // Load all band profiles
        const snap = await getDocs(query(collection(db, 'bandProfiles'), limit(200)));
        const rows: MusicianRow[] = snap.docs
          .map(d => ({
            userId:      d.id,
            displayName: d.data().name || d.data().bandName || 'Unknown',
            photoUrl:    d.data().photoUrl ?? null,
            genre:       (d.data().genre || []).slice(0, 2).join(', '),
            location:    d.data().location ?? '',
          }))
          .filter(r => !alreadyIn.has(r.userId));
        setAll(rows);
      } catch (e) {
        console.error('InviteSheet load:', e);
      }
      setLoading(false);
    }
    load();
  }, [visible, enquiryId]);

  const pastCollabIds = new Set(pastCollabs.map(c => c.userId));
  const filteredAll   = allMusicians.filter(m =>
    !pastCollabIds.has(m.userId) &&
    (!search || m.displayName.toLowerCase().includes(search.toLowerCase()) || (m.location ?? '').toLowerCase().includes(search.toLowerCase()))
  );
  const filteredPast  = pastCollabs.filter(m =>
    !search || m.displayName.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(userId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  async function handleInvite() {
    if (selected.size === 0) return;
    setSubmitting(true);
    const invitees = [...selected].map(uid => {
      const m = allMusicians.find(r => r.userId === uid) || pastCollabs.find(r => r.userId === uid);
      return { userId: uid, displayName: m?.displayName ?? 'Unknown', photoUrl: m?.photoUrl ?? null };
    });
    try {
      await inviteParticipants(enquiryId, invitees, inviterUid, inviterName);
      onInvited();
      onClose();
    } catch (e) {
      console.error('inviteParticipants:', e);
    }
    setSubmitting(false);
  }

  function MusicianItem({ m }: { m: MusicianRow }) {
    const checked = selected.has(m.userId);
    return (
      <TouchableOpacity
        style={[inv.row, checked && { backgroundColor: 'rgba(245,166,35,0.07)' }]}
        onPress={() => toggle(m.userId)}
        activeOpacity={0.7}
      >
        <Avatar photoUrl={m.photoUrl} name={m.displayName} size={38} />
        <View style={inv.rowInfo}>
          <Text style={[inv.rowName, { color: colors.black }]}>{m.displayName}</Text>
          {(m.genre || m.location) ? (
            <Text style={[inv.rowSub, { color: colors.grey }]} numberOfLines={1}>
              {[m.genre, m.location].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={[inv.checkbox, checked && inv.checkboxChecked]}>
          {checked && <Text style={inv.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isWeb ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={inv.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[inv.sheet, { backgroundColor: colors.bg }]}>
          {/* Handle / header */}
          <View style={[inv.header, { borderBottomColor: colors.border }]}>
            <Text style={[inv.title, { color: colors.black }]}>Invite musicians</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[inv.close, { color: colors.grey }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={[inv.searchWrap, { borderBottomColor: colors.border }]}>
            <TextInput
              style={[inv.searchInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
              placeholder="Search musicians"
              placeholderTextColor="#aaaaaa"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {loading ? (
            <View style={inv.loadingWrap}><ActivityIndicator color={Colors.orange} /></View>
          ) : (
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {filteredPast.length > 0 && (
                <>
                  <Text style={[inv.sectionLabel, { color: colors.grey }]}>Past collaborators</Text>
                  {filteredPast.map(m => <MusicianItem key={m.userId} m={m} />)}
                </>
              )}
              {filteredAll.length > 0 && (
                <>
                  <Text style={[inv.sectionLabel, { color: colors.grey }]}>All musicians</Text>
                  {filteredAll.map(m => <MusicianItem key={m.userId} m={m} />)}
                </>
              )}
              {filteredPast.length === 0 && filteredAll.length === 0 && (
                <Text style={[inv.empty, { color: colors.grey }]}>No musicians found</Text>
              )}
            </ScrollView>
          )}

          {/* Invite button — appears once someone is selected */}
          {selected.size > 0 && (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bg }}>
              <View style={[inv.footer, { borderTopColor: colors.border }]}>
                <TouchableOpacity
                  style={[inv.inviteBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleInvite}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#111111" size="small" />
                    : <Text style={inv.inviteBtnText}>Invite {selected.size}</Text>
                  }
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const inv = StyleSheet.create({
  backdrop:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:        { borderTopLeftRadius: isWeb ? 0 : 20, borderTopRightRadius: isWeb ? 0 : 20, maxHeight: '85%', minHeight: 300, ...(isWeb && { borderRadius: 16, maxWidth: 480, width: '100%', alignSelf: 'center', marginBottom: 'auto', marginTop: 'auto', maxHeight: '80%' } as any) },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingHorizontal: 20, borderBottomWidth: 1 },
  title:        { fontSize: 16, fontWeight: '800' },
  close:        { fontSize: 18 },
  searchWrap:   { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  searchInput:  { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  loadingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, textTransform: 'uppercase' as const },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowInfo:      { flex: 1, minWidth: 0 },
  rowName:      { fontSize: 14, fontWeight: '700' },
  rowSub:       { fontSize: 12, marginTop: 1 },
  checkbox:     { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#d0ccc7', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxChecked: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkMark:    { fontSize: 13, fontWeight: '700', color: '#111111' },
  empty:        { textAlign: 'center', padding: 40, fontSize: 14 },
  footer:       { borderTopWidth: 1, padding: 14, paddingHorizontal: 16 },
  inviteBtn:    { backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  inviteBtnText:{ fontSize: 15, fontWeight: '800', color: '#111111' },
});

// ── Thread tile ────────────────────────────────────────────────────────────

const STATUS_MOVE_OPTIONS: { status: Enquiry['status']; label: string }[] = [
  { status: 'enquired',   label: 'Enquired'   },
  { status: 'discussing', label: 'Discuss'    },
  { status: 'confirmed',  label: 'Confirm'    },
  { status: 'declined',   label: 'Decline'    },
];

function ThreadTile({ item, isVenue, isSelected, myUid, onPress, onDelete }: {
  item: Enquiry; isVenue: boolean; isSelected: boolean; myUid: string; onPress: () => void; onDelete?: () => void;
}) {
  const who = isVenue ? item.bandName : item.venueName;
  const venuePhoto  = useVenuePhoto(!isVenue ? item.venueId : null);
  const avatarPhoto = isVenue ? (item.photoUrl ?? null) : venuePhoto;

  // Group gig detection: enquiry has more than 2 participantUids (venue + headliner + support)
  const isGroup = Array.isArray(item.participantUids) && item.participantUids.length > 2;
  const participants = useParticipants(isGroup ? item.id : null);

  const isUnread = !!(
    item.lastMessageAt &&
    (!item.lastReadAt?.[myUid] || item.lastMessageAt > item.lastReadAt[myUid])
  );
  const { day, date, time, slotType } = item.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotStr = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const cfg = getStatusCfg(item.status, isVenue);
  const fee = (item as any).fee ? `$${(item as any).fee}` : null;

  const badgeRef   = useRef<View>(null);
  const swipeRef   = useRef<Swipeable>(null);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [menuPos,     setMenuPos]     = useState<{ x: number; y: number } | null>(null);
  const [confirmDel,  setConfirmDel]  = useState(false);

  function openMenu(e: any) {
    e.stopPropagation?.();
    (badgeRef.current as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
      setMenuPos({ x, y: y + h + 4 });
      setMenuOpen(true);
    });
  }

  async function pickStatus(status: Enquiry['status']) {
    setMenuOpen(false);
    await updateEnquiryStatus(item.id, status);
  }

  const normStatus = normalizeEnquiryStatus(item.status);
  const options = STATUS_MOVE_OPTIONS.filter(o => {
    if (normalizeEnquiryStatus(o.status) === normStatus) return false;
    if (normStatus === 'discussing') return o.status === 'confirmed' || o.status === 'declined';
    if (normStatus === 'confirmed')  return o.status === 'discussing' || o.status === 'declined';
    return true;
  });

  function renderRightActions() {
    if (!onDelete) return null;
    return (
      <TouchableOpacity
        style={tt.swipeDelete}
        onPress={() => { swipeRef.current?.close(); setConfirmDel(true); }}
        activeOpacity={0.85}
      >
        <Text style={tt.swipeDeleteText}>Delete</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false} friction={2}>
      <TouchableOpacity
        style={[tt.tile, isSelected && tt.tileActive]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        {isGroup && participants.length > 0 ? (
          <AvatarStack participants={participants} venuePhoto={isVenue ? null : venuePhoto} size={40} />
        ) : (
          <Avatar photoUrl={avatarPhoto} name={who} size={44} />
        )}
        <View style={tt.body}>
          <View style={tt.topRow}>
            <Text style={[tt.name, isSelected && { color: Colors.orange }, isUnread && { fontWeight: '800' }]} numberOfLines={1}>{who}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {isUnread && <View style={tt.unreadDot} />}
              <Text style={tt.time}>{formatTileDate(item.submittedAt)}</Text>
            </View>
          </View>
          <Text style={tt.slot} numberOfLines={1}>{slotStr || 'No slot specified'}</Text>
          <View style={tt.bottomRow}>
            {isVenue ? (
              <TouchableOpacity
                ref={badgeRef}
                onPress={openMenu}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <View style={[tt.badge, { borderColor: '#d0ccc7' }]}>
                  <Text style={[tt.badgeText, { color: cfg.color }]}>{cfg.label} ▾</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={[tt.badge, { borderColor: '#d0ccc7' }]}>
                <Text style={[tt.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            )}
            {fee ? <Text style={tt.fee}>{fee}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
      </Swipeable>

      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          {menuPos && (
            <View style={[tt.menuCard, { top: menuPos.y, left: menuPos.x }]}>
              {options.map((opt, i) => {
                const optCfg = getStatusCfg(opt.status, isVenue);
                return (
                  <TouchableOpacity
                    key={opt.status}
                    style={[tt.menuItem, i < options.length - 1 && tt.menuItemBorder]}
                    onPress={() => pickStatus(opt.status)}
                    activeOpacity={0.75}
                  >
                    <View style={[tt.menuDot, { backgroundColor: optCfg.color }]} />
                    <Text style={[tt.menuLabel, { color: optCfg.color }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      </Modal>

      <Modal visible={confirmDel} transparent animationType="fade" onRequestClose={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
          <View style={[md.confirm, { backgroundColor: '#ffffff' }]}>
            <Text style={md.confirmTitle}>Delete conversation?</Text>
            <Text style={md.confirmBody}>This will remove it from your inbox. This can't be undone.</Text>
            <View style={md.confirmBtns}>
              <TouchableOpacity style={[md.confirmBtn, { borderColor: '#e8e8e8' }]} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
                <Text style={[md.confirmBtnText, { color: '#888888' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmDel(false); onDelete?.(); }}>
                <Text style={md.confirmBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const tt = StyleSheet.create({
  tile:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa' },
  tileActive:     { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  body:           { flex: 1, minWidth: 0, gap: 3 },
  topRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bottomRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  name:           { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:           { fontSize: 11, color: '#bbbbbb', flexShrink: 0 },
  slot:           { fontSize: 12, color: '#777777' },
  badge:          { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, backgroundColor: '#ffffff' },
  badgeText:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  fee:            { fontSize: 12, fontWeight: '600', color: '#444444' },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
  menuCard:       { position: 'absolute', backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e8e8e8', minWidth: 150, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuDot:        { width: 8, height: 8, borderRadius: 4 },
  menuLabel:      { fontSize: 13, fontWeight: '700' },
  swipeDelete:    { backgroundColor: '#dc2626', justifyContent: 'center', alignItems: 'center', width: 80 },
  swipeDeleteText:{ fontSize: 14, fontWeight: '700', color: '#ffffff' },
});

// ── Enquiry details bubble (expandable from header, venue view) ────────────

function EnquiryBubble({ enquiry, isVenue, profileRef, musicRef, techRef }: {
  enquiry: Enquiry; isVenue: boolean;
  profileRef?: React.RefObject<View>; musicRef?: React.RefObject<View>; techRef?: React.RefObject<View>;
}) {
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const dateStr  = date ? fmtSlotDate(date) : '';
  const slotStr  = [day, dateStr, time, room, slotType, setLength].filter(Boolean).join(' · ');
  const genres: string[] = enquiry.genre ?? [];
  const sentLabel = isVenue ? enquiry.bandName : 'You';
  const sentDate  = formatTileDate(enquiry.submittedAt);

  // Venue views: artist sent this (grey theirs bubble)
  // Artist views: they sent this (dark mine bubble)
  const isMine = !isVenue;

  const songs: any[]      = Array.isArray(enquiry.songs) ? enquiry.songs : [];
  const gigHistory: any[] = Array.isArray(enquiry.gigHistory) ? enquiry.gigHistory : [];
  const upcoming: any[]   = Array.isArray(enquiry.upcomingGigs) ? enquiry.upcomingGigs : [];
  const techRider         = enquiry.techRider && typeof enquiry.techRider === 'object' ? enquiry.techRider : null;

  const textColor = isMine ? '#ffffff' : '#111111';
  const dimColor  = isMine ? 'rgba(255,255,255,0.55)' : '#888888';
  const divColor  = isMine ? 'rgba(255,255,255,0.15)' : '#e8e8e8';

  function Section({ label, children, sectionRef }: { label: string; children: React.ReactNode; sectionRef?: React.RefObject<View> }) {
    return (
      <View ref={sectionRef as any} style={[eq.section, { borderTopColor: divColor }]}>
        <Text style={[eq.sectionLabel, { color: dimColor }]}>{label}</Text>
        {children}
      </View>
    );
  }

  return (
    <View>
      <Text style={tp.enquirySentLabel}>{sentLabel} · {sentDate}</Text>
      <View style={[tp.msgRow, isMine ? tp.rowMine : tp.rowTheirs]}>
      <View style={[tp.msgCol, isMine && tp.msgColMine]}>
        <View style={[eq.bubble, isMine ? tp.bubbleMine : tp.bubbleTheirs]}>

          {/* Artist type + genres */}
          {(enquiry.artistType || genres.length > 0) ? (
            <View style={[eq.pillsRow]}>
              {enquiry.artistType ? (
                <View style={[eq.typePill, { borderColor: isMine ? 'rgba(255,255,255,0.35)' : Colors.orange + '55', backgroundColor: isMine ? 'rgba(255,255,255,0.12)' : Colors.orange + '18' }]}>
                  <Text style={[eq.typeText, { color: isMine ? '#ffffff' : Colors.orange }]}>{enquiry.artistType}</Text>
                </View>
              ) : null}
              {genres.map(g => (
                <View key={g} style={[eq.genrePill, { borderColor: divColor }]}>
                  <Text style={[eq.genreText, { color: isMine ? 'rgba(255,255,255,0.75)' : '#555555' }]}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Location */}
          {enquiry.location ? (
            <Text style={[eq.meta, { color: dimColor }]}>{enquiry.location}</Text>
          ) : null}

          {/* About */}
          {enquiry.about ? (
            <Section label="ABOUT" sectionRef={profileRef}>
              <Text style={[eq.body, { color: textColor }]}>{enquiry.about}</Text>
            </Section>
          ) : null}

          {/* Music */}
          {songs.length > 0 ? (
            <Section label="MUSIC" sectionRef={musicRef}>
              {songs.map((s: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {s.title}{s.url ? ` — ${s.url}` : ''}{s.notes ? ` (${s.notes})` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Gig history */}
          {gigHistory.length > 0 ? (
            <Section label="GIG HISTORY">
              {gigHistory.map((g: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {g.venue}{g.suburb ? `, ${g.suburb}` : ''}{g.date ? ` · ${g.date}` : ''}{g.notes ? ` — ${g.notes}` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Upcoming gigs */}
          {upcoming.length > 0 ? (
            <Section label="UPCOMING GIGS">
              {upcoming.map((g: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {g.venue}{g.suburb ? `, ${g.suburb}` : ''}{g.date ? ` · ${g.date}` : ''}{g.notes ? ` — ${g.notes}` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Socials */}
          {(enquiry.instagram || enquiry.tiktok || enquiry.spotify || enquiry.appleMusic) ? (
            <Section label="SOCIALS">
              {enquiry.instagram  ? <Text style={[eq.body, { color: textColor }]}>Instagram: {enquiry.instagram}</Text>  : null}
              {enquiry.tiktok     ? <Text style={[eq.body, { color: textColor }]}>TikTok: {enquiry.tiktok}</Text>        : null}
              {enquiry.spotify    ? <Text style={[eq.body, { color: textColor }]}>Spotify: {enquiry.spotify}</Text>      : null}
              {enquiry.appleMusic ? <Text style={[eq.body, { color: textColor }]}>Apple Music: {enquiry.appleMusic}</Text> : null}
            </Section>
          ) : null}

          {/* Tech rider */}
          {techRider && Object.keys(techRider).length > 0 ? (
            <Section label="TECH RIDER" sectionRef={techRef}>
              {Object.entries(techRider).map(([k, v]: [string, any]) => (
                <Text key={k} style={[eq.body, { color: textColor }]}>{k}: {String(v)}</Text>
              ))}
            </Section>
          ) : null}

          {/* Additional info */}
          {enquiry.additionalInfo ? (
            <Section label="ADDITIONAL INFO">
              <Text style={[eq.body, { color: textColor }]}>{enquiry.additionalInfo}</Text>
            </Section>
          ) : null}
        </View>
      </View>
      </View>
    </View>
  );
}

const eq = StyleSheet.create({
  bubble:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, maxWidth: isWeb ? 480 : '90%' },
  slotRow:      { marginBottom: 8 },
  slotText:     { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  pillsRow:     { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 },
  typePill:     { borderRadius: 4, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:     { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  genrePill:    { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  genreText:    { fontSize: 11 },
  meta:         { fontSize: 12, marginBottom: 4 },
  section:      { borderTopWidth: 1, paddingTop: 8, marginTop: 8, gap: 3 },
  sectionLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginBottom: 2, textTransform: 'uppercase' as const },
  body:         { fontSize: 13, lineHeight: 19 },
});

// ── Thread panel ───────────────────────────────────────────────────────────

function ThreadPanel({ enquiry, isVenue, venueId, onBack }: {
  enquiry: Enquiry; isVenue: boolean; venueId: string | null; onBack?: () => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const messages     = useMessages(enquiry.id);
  const participants = useParticipants(enquiry.id);
  const scrollRef    = useRef<ScrollView>(null);
  const profileRef   = useRef<View>(null);
  const musicRef     = useRef<View>(null);
  const techRef      = useRef<View>(null);

  function scrollToRef(ref: React.RefObject<View>) {
    ref.current?.measureLayout(
      scrollRef.current as any,
      (_x: number, y: number) => scrollRef.current?.scrollTo({ y, animated: true }),
      () => {},
    );
  }

  const [chatText,      setChatText]      = useState('');
  const [confirmText,   setConfirmText]   = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [expandedForm,  setExpandedForm]  = useState<null | 'decline' | 'confirm'>(null);
  const [listingChoice, setListingChoice] = useState<'pending' | 'booked'>('pending');
  const [submitting,    setSubmitting]    = useState(false);
  const [inviteOpen,    setInviteOpen]    = useState(false);
  const [toastVisible,  setToastVisible]  = useState(false);
  const [toastMsg,      setToastMsg]      = useState('');
  const [undoData,      setUndoData]      = useState<{ participantId: string; uid: string } | null>(null);

  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const venueThreadPhoto = useVenuePhoto(!isVenue ? enquiry.venueId : null);
  const otherPhotoResolved = isVenue ? (enquiry.photoUrl ?? null) : venueThreadPhoto;
  const declineReasonSaved = (enquiry as any).declineReason || (enquiry as any).reason;
  const isClosed = enquiry.status === 'declined' || enquiry.status === 'cancelled';

  // Determine my participant record (for group gig role checks)
  const myParticipant = participants.find(p => p.userId === user?.uid);
  const isGroupGig    = participants.length > 0;
  const isSupportAct  = myParticipant?.role === 'support';
  const myDisplayName = myParticipant?.displayName ?? (user as any)?.displayName ?? '';

  // Venue profile for invite sheet + confirm headliner
  const [venueDisplayName, setVenueDisplayName] = useState('');
  const [venuePhotoUrl,    setVenuePhotoUrl]    = useState<string | null>(null);
  const [venueOwnerUid,    setVenueOwnerUid]    = useState<string | null>(null);
  useEffect(() => {
    if (!enquiry.venueId) return;
    // Fetch venue doc for name/photo
    getDoc(doc(db, 'venues', enquiry.venueId)).then(snap => {
      if (snap.exists()) {
        setVenueDisplayName(snap.data().name ?? enquiry.venueName ?? '');
        setVenuePhotoUrl(snap.data().photoUrl ?? null);
      }
    }).catch(() => {});
    // Fetch venue owner UID from users collection
    getDocs(query(collection(db, 'users'), where('venueId', '==', enquiry.venueId), limit(1))).then(snap => {
      if (!snap.empty) setVenueOwnerUid(snap.docs[0].id);
    }).catch(() => {});
  }, [enquiry.venueId]);

  // Auto-add venue as a participant when the thread is opened.
  // When the viewer IS the venue, use their uid directly (no lookup needed).
  // When the viewer is an artist, use the looked-up venueOwnerUid.
  useEffect(() => {
    const uid  = isVenue ? user?.uid : venueOwnerUid;
    const name = venueDisplayName || enquiry.venueName;
    if (!uid || !enquiry.id || !name || participants.length === 0) return;
    ensureVenueParticipant(enquiry.id, uid, name, venuePhotoUrl).catch(() => {});
  }, [isVenue, user?.uid, venueOwnerUid, enquiry.id, venueDisplayName, venuePhotoUrl, participants.length]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  // Mark thread as read whenever it's open and new messages arrive
  useEffect(() => {
    if (user?.uid) markEnquiryRead(enquiry.id, user.uid).catch(() => {});
  }, [enquiry.id, user?.uid, messages.length]);

  function toggleForm(form: 'decline' | 'confirm') {
    setExpandedForm(prev => prev === form ? null : form);
  }

  async function handleSendChat() {
    const msg = chatText.trim();
    if (!msg || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, msg);
    setChatText('');
    setSubmitting(false);
  }

  async function handleDecline() {
    setSubmitting(true);
    if (declineReason.trim() && user) {
      await sendMessage(enquiry.id, user.uid, declineReason.trim());
    }
    await updateEnquiryStatus(enquiry.id, 'declined', declineReason.trim() || undefined);
    setExpandedForm(null);
    setDeclineReason('');
    setSubmitting(false);
  }

  async function handleConfirm() {
    if (!user) return;
    setSubmitting(true);
    if (confirmText.trim()) await sendMessage(enquiry.id, user.uid, confirmText.trim());
    await updateEnquiryStatus(enquiry.id, 'confirmed');
    await bookSlotOnTimetable(enquiry, listingChoice === 'booked');
    // Create participant records for headliner + venue
    await confirmHeadliner(
      enquiry.id,
      enquiry.createdBy,
      user.uid,
      venueDisplayName || enquiry.venueName,
      venuePhotoUrl,
    ).catch(() => {});
    setExpandedForm(null);
    setConfirmText('');
    setSubmitting(false);
  }

  async function handleDelete() {
    if (!user) return;
    // Support acts in a group gig: delete-as-leave with undo toast
    if (isGroupGig && isSupportAct && myParticipant) {
      await leaveGig(enquiry.id, myParticipant.id, user.uid, myDisplayName);
      setToastMsg(`Left ${enquiry.venueName}`);
      setUndoData({ participantId: myParticipant.id, uid: user.uid });
      setToastVisible(true);
      onBack?.();
    } else {
      // Standard archive for venue / headliner (non-group or existing flow)
      await archiveEnquiry(enquiry.id, isVenue ? (venueId ?? user.uid) : user.uid);
      onBack?.();
    }
  }

  async function handleUndoLeave() {
    if (!undoData || !user) return;
    const { participantId, uid } = undoData;
    await Promise.all([
      updateDoc(doc(db, 'inquiries', enquiry.id, 'participants', participantId), {
        state: 'confirmed',
        leftAt: null,
      }),
      updateDoc(doc(db, 'inquiries', enquiry.id), {
        deletedBy: arrayRemove(uid),
      }),
    ]);
    setUndoData(null);
  }

  function handleOpenSubThread(otherUid: string, otherName: string, otherPhoto: string | null) {
    const { day, date, time } = enquiry.requestedSlot;
    const dateStr = date ? fmtSlotDate(date) : (day || '');
    router.push({
      pathname: '/sub-thread',
      params: {
        enquiryId: enquiry.id,
        otherUid,
        otherName,
        venueName:  enquiry.venueName,
        gigDate:    [dateStr, time].filter(Boolean).join(' · '),
      },
    } as any);
  }

  async function handleRemoveParticipant(p: Participant) {
    if (!user) return;
    await removeParticipantFromGig(
      enquiry.id,
      p.id,
      p.userId,
      p.displayName,
      venueDisplayName || enquiry.venueName,
    ).catch(console.error);
  }

  // Bootstrap headliner + venue participant records if they don't exist yet,
  // then open the invite sheet. This allows venues to start a group line-up
  // on any enquiry, including ones created before the multi-party feature.
  async function handleOpenInvite() {
    const now = new Date().toISOString();
    const existingUids = new Set(participants.map(p => p.userId));
    // Ensure headliner exists
    if (!existingUids.has(enquiry.createdBy)) {
      await addDoc(collection(db, 'inquiries', enquiry.id, 'participants'), {
        userId:      enquiry.createdBy,
        role:        'headliner',
        state:       'invited',
        invitedBy:   null,
        displayName: enquiry.bandName,
        photoUrl:    enquiry.photoUrl ?? null,
        joinedAt:    now,
        respondedAt: null,
        leftAt:      null,
      }).catch(() => {});
    }
    // Ensure venue exists — use current user uid when they are the venue
    const venueUid = isVenue ? user?.uid : venueOwnerUid;
    if (venueUid) {
      await ensureVenueParticipant(enquiry.id, venueUid, venueDisplayName || enquiry.venueName, venuePhotoUrl).catch(() => {});
    }
    setInviteOpen(true);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg, overflow: 'hidden' as any }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header: always pinned — name, gig info, deal sheet */}
      <EnquiryHeader
        enquiry={enquiry}
        isVenue={isVenue}
        onBack={onBack}
        onDelete={handleDelete}
        onScrollToProfile={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy } })}
        onScrollToMusic={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy, tab: 'music' } })}
        onScrollToTech={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy } })}
        participants={participants}
        currentUserUid={user?.uid}
        onOpenSubThread={handleOpenSubThread}
        onInvite={handleOpenInvite}
        onRemove={handleRemoveParticipant}
      />

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={tp.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {/* Enquiry details always shown as first item */}
        <EnquiryBubble enquiry={enquiry} isVenue={isVenue} profileRef={profileRef} musicRef={musicRef} techRef={techRef} />
        {(() => {
          // Build sender groups for avatar + timestamp logic
          // System messages are rendered separately — not grouped with chat messages
          type MsgGroup = { sender: string; msgs: typeof messages; startMs: number; endMs: number };
          const groups: MsgGroup[] = [];
          for (const m of messages) {
            if (m.type === 'system') {
              // System messages break the group and render inline
              groups.push({ sender: '__system__', msgs: [m], startMs: new Date(m.timestamp).getTime(), endMs: new Date(m.timestamp).getTime() });
              continue;
            }
            const last = groups[groups.length - 1];
            const ms = new Date(m.timestamp).getTime();
            if (last && last.sender === m.sender && last.sender !== '__system__') {
              last.msgs.push(m);
              last.endMs = ms;
            } else {
              groups.push({ sender: m.sender, msgs: [m], startMs: ms, endMs: ms });
            }
          }

          // Resolve sender photo for group gigs
          function senderPhoto(senderUid: string): string | null {
            const p = participants.find(pt => pt.userId === senderUid);
            return p?.photoUrl ?? (senderUid === user?.uid ? null : otherPhotoResolved);
          }
          function senderName(senderUid: string): string {
            const p = participants.find(pt => pt.userId === senderUid);
            return p?.displayName ?? who;
          }

          return groups.map(group => {
            // System message — centered event label
            if (group.sender === '__system__') {
              const m = group.msgs[0];
              return (
                <View key={m.id} style={tp.systemMsgRow}>
                  <Text style={tp.systemMsgText}>{m.text}</Text>
                </View>
              );
            }

            const spansHour = group.endMs - group.startMs > 3600000;
            return group.msgs.map((m, i) => {
              const mine = m.sender === user?.uid;
              const isLast = i === group.msgs.length - 1;
              const showTimestamp = spansHour || isLast;
              const prevM = i > 0 ? group.msgs[i - 1] : null;
              const prevMsgTimestamp = (() => {
                if (prevM) return prevM.timestamp;
                const gIdx = groups.indexOf(group);
                if (gIdx === 0) return null;
                const prevGroup = groups[gIdx - 1];
                return prevGroup.msgs[prevGroup.msgs.length - 1].timestamp;
              })();
              const showSep = prevMsgTimestamp
                ? new Date(m.timestamp).getTime() - new Date(prevMsgTimestamp).getTime() > 60 * 60 * 1000
                : false;
              const photo = mine ? null : (isGroupGig ? senderPhoto(m.sender) : otherPhotoResolved);
              const name  = mine ? '' : (isGroupGig ? senderName(m.sender) : who);
              return (
                <View key={m.id}>
                  {showSep && <DateSep label={getDateLabel(m.timestamp)} />}
                  {/* Sender name in group gigs for non-mine messages */}
                  {!mine && isGroupGig && i === 0 && (
                    <Text style={[tp.senderName, { color: colors.grey }]}>{name}</Text>
                  )}
                  <View style={[tp.msgRow, mine ? tp.rowMine : tp.rowTheirs, i > 0 && { marginTop: 2 }]}>
                    {!mine && (
                      isLast
                        ? <Avatar photoUrl={photo} name={name} size={28} />
                        : <View style={{ width: 28 }} />
                    )}
                    <View style={[tp.msgCol, mine && tp.msgColMine]}>
                      <View style={[tp.bubble, mine ? tp.bubbleMine : tp.bubbleTheirs]}>
                        <Text style={[tp.bubbleText, mine && tp.bubbleTextMine]}>{m.text}</Text>
                      </View>
                      {showTimestamp && (
                        <Text style={[tp.msgTime, mine && tp.msgTimeRight]}>{fmtMsgTime(m.timestamp)}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            });
          });
        })()}

        {/* Decline reason */}
        {isClosed && declineReasonSaved ? (
          <View style={tp.reasonBanner}>
            <Text style={tp.reasonLabel}>REASON</Text>
            <Text style={tp.reasonText}>{declineReasonSaved}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Invite sheet */}
      <InviteSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        enquiryId={enquiry.id}
        participants={participants}
        inviterUid={user?.uid ?? ''}
        inviterName={myDisplayName}
        inviterRole={isVenue ? 'venue' : 'headliner'}
        venueId={enquiry.venueId}
        venueName={enquiry.venueName}
        onInvited={() => setInviteOpen(false)}
      />

      {/* Undo toast (leave gig) */}
      <Toast
        visible={toastVisible}
        message={toastMsg}
        onUndo={undoData ? handleUndoLeave : undefined}
        onDismiss={() => { setToastVisible(false); setUndoData(null); }}
      />

      {/* ── Bottom action area ─────────────────────────────────────── */}
      <View>

      {isClosed ? (
        <View style={[tp.closedBanner, { borderTopColor: colors.border }]}>
          <Text style={tp.closedText}>
            {enquiry.status === 'cancelled' ? 'Enquiry cancelled.' : 'Enquiry declined.'}
          </Text>
        </View>

      ) : isVenue && (enquiry.status === 'pending' || enquiry.status === 'enquired') ? (
        // ── Venue pending: reply + action buttons
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fafafa' }}>
          <View style={[vp.wrap, { borderTopColor: colors.border }]}>

            {/* Decline expanded form */}
            {expandedForm === 'decline' && (
              <View style={vp.form}>
                <Text style={vp.formLabel}>DECLINE — REASON OPTIONAL</Text>
                <TextInput
                  style={vp.formTextarea}
                  placeholder="e.g. Thursdays are rock only — let us know if you have other dates"
                  placeholderTextColor="#aaaaaa"
                  value={declineReason}
                  onChangeText={setDeclineReason}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  autoFocus
                />
                <View style={vp.formRow}>
                  <TouchableOpacity
                    style={vp.cancelBtn}
                    onPress={() => { setExpandedForm(null); setDeclineReason(''); }}
                  >
                    <Text style={vp.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={vp.declineSubmit} onPress={handleDecline} disabled={submitting}>
                    {submitting
                      ? <ActivityIndicator color="#ffffff" size="small" />
                      : <Text style={vp.declineSubmitText}>Send Decline</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Confirm booking expanded form */}
            {expandedForm === 'confirm' && (
              <View style={vp.form}>
                <Text style={vp.formLabel}>CONFIRM BOOKING</Text>
                <View style={{ gap: 6, marginBottom: 4 }}>
                  {([
                    { value: 'pending', label: 'Reserve (pending)', sub: 'slot reserved, not publicly listed yet' },
                    { value: 'booked',  label: 'List as booked now', sub: 'band appears on public timetable' },
                  ] as const).map(opt => (
                    <TouchableOpacity key={opt.value} style={vp.radioRow} onPress={() => setListingChoice(opt.value)}>
                      <View style={[vp.radioCircle, listingChoice === opt.value && vp.radioCircleActive]}>
                        {listingChoice === opt.value ? <View style={vp.radioDot} /> : null}
                      </View>
                      <Text style={vp.radioLabel}>
                        <Text style={{ fontWeight: '700' }}>{opt.label}</Text>
                        {' — '}{opt.sub}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={vp.formTextarea}
                  placeholder="Optional message to the artist…"
                  placeholderTextColor="#aaaaaa"
                  value={confirmText}
                  onChangeText={setConfirmText}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
                <View style={vp.formRow}>
                  <TouchableOpacity
                    style={vp.cancelBtn}
                    onPress={() => { setExpandedForm(null); setConfirmText(''); }}
                  >
                    <Text style={vp.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[vp.confirmSubmit, submitting && vp.confirmSubmitOff]}
                    onPress={handleConfirm}
                    disabled={submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color="#111111" size="small" />
                      : <Text style={vp.confirmSubmitText}>Confirm Booking</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Pending action buttons */}
            <View style={vp.pendingActionsRow}>
              <TouchableOpacity
                style={[vp.pendingBtn, vp.pendingBtnDecline, expandedForm === 'decline' && vp.pendingBtnDeclineActive]}
                onPress={() => toggleForm('decline')}
              >
                {submitting && expandedForm === 'decline'
                  ? <ActivityIndicator color="#dc2626" size="small" />
                  : <Text style={[vp.pendingBtnText, vp.pendingBtnTextDecline]}>Decline</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[vp.pendingBtn, vp.pendingBtnDiscuss]}
                onPress={async () => {
                  if (!user) return;
                  setSubmitting(true);
                  await updateEnquiryStatus(enquiry.id, 'discussing');
                  await ensureVenueParticipant(enquiry.id, user.uid, venueDisplayName || enquiry.venueName, venuePhotoUrl).catch(() => {});
                  setSubmitting(false);
                }}
                disabled={submitting}
              >
                {submitting && expandedForm === null
                  ? <ActivityIndicator color="#111111" size="small" />
                  : <Text style={[vp.pendingBtnText, vp.pendingBtnTextDiscuss]}>Discuss</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[vp.pendingBtn, vp.pendingBtnConfirm, expandedForm === 'confirm' && vp.pendingBtnConfirmActive]}
                onPress={() => toggleForm('confirm')}
              >
                <Text style={[vp.pendingBtnText, vp.pendingBtnTextConfirm]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

      ) : !isVenue && (enquiry.status === 'pending' || enquiry.status === 'enquired') ? (
        // ── Artist pending: awaiting response
        <SafeAreaView
          edges={['bottom']}
          style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgFaint }}
        >
          <View style={tp.awaitingRow}>
            <Text style={tp.awaitingText}>Awaiting response from {enquiry.venueName}</Text>
            <TouchableOpacity onPress={async () => { await cancelEnquiry(enquiry.id); onBack?.(); }}>
              <Text style={tp.cancelText}>Cancel enquiry</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : isVenue && (enquiry.status === 'accepted' || enquiry.status === 'confirmed') ? (
        // ── Venue accepted: compact single row — chat + timetable controls
        <SafeAreaView edges={['bottom']} style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgFaint }}>
          <View style={[vp.wrap, { borderTopWidth: 0 }]}>
            <View style={vp.combinedRow}>
              <TextInput
                style={vp.replyInput}
                placeholder={`Message ${who}…`}
                placeholderTextColor={colors.greyLight}
                value={chatText}
                onChangeText={setChatText}
                multiline
              />
              {chatText.trim() ? (
                <TouchableOpacity
                  style={[vp.sendBtn, submitting && vp.sendBtnOff]}
                  onPress={handleSendChat}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#111111" size="small" />
                    : <Text style={vp.sendBtnText}>↑</Text>
                  }
                </TouchableOpacity>
              ) : null}
              <View style={[tp.timetablePill, enquiry.listAsBooked ? tp.timetablePillBooked : tp.timetablePillPending]}>
                <Text style={[tp.timetablePillText, enquiry.listAsBooked ? { color: '#ffffff' } : { color: '#555555' }]}>
                  {enquiry.listAsBooked ? 'Booked' : 'Pending'}
                </Text>
              </View>
              {!enquiry.listAsBooked ? (
                <TouchableOpacity
                  style={vp.outlineBtn}
                  onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, true); setSubmitting(false); }}
                  disabled={submitting}
                >
                  <Text style={[vp.outlineBtnText, { color: '#16a34a' }]}>List as Booked</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={vp.outlineBtn}
                  onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, false); setSubmitting(false); }}
                  disabled={submitting}
                >
                  <Text style={[vp.outlineBtnText, { color: '#f5a623' }]}>List as Pending</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={vp.outlineBtn}
                onPress={async () => { setSubmitting(true); await cancelAcceptance(enquiry); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={vp.outlineBtnText}>Cancel Acceptance</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

      ) : (
        // ── Default: chat input (discussing, or non-pending states)
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TextInput
              style={[ci.input, { color: colors.black }]}
              placeholder="Message…"
              placeholderTextColor={colors.greyLight}
              value={chatText}
              onChangeText={setChatText}
              multiline
            />
            <TouchableOpacity
              style={[ci.send, !chatText.trim() && ci.sendOff]}
              onPress={handleSendChat}
              disabled={!chatText.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#111111" size="small" />
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      </View>
    </KeyboardAvoidingView>
  );
}

// Venue pending action bar styles
const vp = StyleSheet.create({
  wrap:               { borderTopWidth: 1, backgroundColor: '#fafafa', paddingVertical: 10, paddingHorizontal: isWeb ? 24 : 16, gap: 8 },
  form:               { backgroundColor: '#f4f4f4', borderRadius: 10, padding: 12, gap: 8 },
  formLabel:          { fontSize: 10, fontWeight: '700', color: '#999999', letterSpacing: 0.6 },
  formTextarea:       { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, fontSize: 14, color: '#111111', backgroundColor: '#ffffff', minHeight: 56, textAlignVertical: 'top' as const },
  formRow:            { flexDirection: 'row', gap: 8 },
  cancelBtn:          { paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8 },
  cancelBtnText:      { fontSize: 13, color: '#888888', fontWeight: '600' },
  declineSubmit:      { flex: 1, backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  declineSubmitText:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  confirmSubmit:      { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  confirmSubmitOff:   { backgroundColor: '#e8e8e8' },
  confirmSubmitText:  { fontSize: 13, fontWeight: '700', color: '#111111' },
  radioRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  radioCircle:        { width: 17, height: 17, borderRadius: 9, borderWidth: 2, borderColor: '#cccccc', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  radioCircleActive:  { borderColor: Colors.orange },
  radioDot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange },
  radioLabel:         { fontSize: 13, color: '#333333', lineHeight: 18, flex: 1 },
  combinedRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyInput:         { flex: 1, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: '#111111', maxHeight: 80, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, backgroundColor: '#ffffff' },
  sendBtn:            { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:         { backgroundColor: '#e8e8e8' },
  sendBtnText:        { fontSize: 17, fontWeight: '700', color: '#ffffff', lineHeight: 19, marginTop: -1 },
  sendBtnTextOff:     { color: '#bbbbbb' },
  outlineBtn:         { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: '#e0e0e0', alignItems: 'center' },
  outlineBtnActive:   { borderColor: Colors.orange, backgroundColor: Colors.orange + '10' },
  outlineBtnText:     { fontSize: 13, fontWeight: '600', color: '#666666' },
  declineBtnActive:   { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.06)' },
  confirmBtn:         { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, backgroundColor: Colors.orange, alignItems: 'center' },
  confirmBtnText:     { fontSize: 13, fontWeight: '700', color: '#111111' },
  // Pending state: three action buttons
  pendingActionsRow:       { flexDirection: 'row', gap: 10 },
  pendingBtn:              { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pendingBtnDecline:       { borderColor: '#e0e0e0', backgroundColor: '#ffffff' },
  pendingBtnDeclineActive: { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.06)' },
  pendingBtnDiscuss:       { borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  pendingBtnConfirm:       { borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  pendingBtnConfirmActive: { borderColor: Colors.orange, backgroundColor: 'rgba(245,166,35,0.08)' },
  pendingBtnText:          { fontSize: 14, fontWeight: '700' },
  pendingBtnTextDecline:   { color: '#dc2626' },
  pendingBtnTextDiscuss:   { color: '#444444' },
  pendingBtnTextConfirm:   { color: '#444444' },
});

// Chat input styles
const ci = StyleSheet.create({
  wrap:        { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 10, borderTopWidth: 1 },
  input:       { flex: 1, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120, backgroundColor: '#ffffff' },
  send:        { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendOff:     { backgroundColor: '#e0e0e0' },
  sendText:    { fontSize: 18, fontWeight: '700', color: '#ffffff', lineHeight: 20, marginTop: -1 },
  sendTextOff: { color: '#bbbbbb' },
});

// Thread panel shared styles
const tp = StyleSheet.create({
  msgList:           { paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 16, gap: 4, flexGrow: 1 },
  enquirySentLabel:  { textAlign: 'center', fontSize: 11, fontWeight: '500', color: '#aaaaaa', letterSpacing: 0.3, marginBottom: 8 },
  noMsgs:       { alignItems: 'center', paddingTop: 12 },
  noMsgsText:   { fontSize: 14, color: '#aaaaaa', textAlign: 'center', lineHeight: 20 },
  msgRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:       { justifyContent: 'flex-end' },
  rowTheirs:     {},
  msgCol:        { maxWidth: '72%' },
  msgColMine:    { alignItems: 'flex-end' },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:    { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs:  { backgroundColor: '#f0ede8', borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, color: '#111111', lineHeight: 22 },
  bubbleTextMine:{ color: '#ffffff' },
  msgTime:        { fontSize: 10, color: '#bbbbbb', marginTop: 3, marginLeft: 2 },
  msgTimeRight:   { textAlign: 'right', marginLeft: 0, marginRight: 2 },
  systemMsgRow:   { alignItems: 'center', marginVertical: 10 },
  systemMsgText:  { fontSize: 12, color: '#aaaaaa', fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 16 },
  senderName:     { fontSize: 11, color: '#888888', fontWeight: '600', marginBottom: 2, marginLeft: 36 },
  reasonBanner: { backgroundColor: '#fef3cd', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#fcd34d', marginTop: 8 },
  reasonLabel:  { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 3 },
  reasonText:   { fontSize: 13, color: '#333333' },
  closedBanner: { padding: 16, alignItems: 'center', borderTopWidth: 1, backgroundColor: '#fafafa' },
  closedText:   { fontSize: 14, color: '#aaaaaa', fontStyle: 'italic' },
  awaitingRow:  { padding: 14, paddingHorizontal: isWeb ? 24 : 16, alignItems: 'center', gap: 8 },
  awaitingText: { fontSize: 13, color: '#888888', textAlign: 'center' },
  cancelText:   { fontSize: 13, color: '#ef4444', fontWeight: '600' },
  timetableBar: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, paddingVertical: 10, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1 },
  timetableLabel:  { fontSize: 13, color: '#888888' },
  timetablePill:   { borderRadius: 4, paddingHorizontal: 12, paddingVertical: 4 },
  timetablePillBooked:  { backgroundColor: '#16a34a' },
  timetablePillPending: { backgroundColor: 'rgba(0,0,0,0.07)' },
  timetablePillText:    { fontSize: 12, fontWeight: '700' },
  timetableBtn:    { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 6 },
  timetableBtnText:{ fontSize: 12, fontWeight: '600' },
});

// ── DM tile ────────────────────────────────────────────────────────────────

function DMTile({ conv, myUid, isSelected, onPress }: {
  conv: DMConv; myUid: string; isSelected: boolean; onPress: () => void;
}) {
  const otherUid   = conv.participants.find(p => p !== myUid) ?? '';
  const resolved   = useUserDisplayInfo(otherUid || null);
  const otherName  = resolved.name ?? conv.participantNames[otherUid] ?? 'Unknown';
  const otherPhoto = resolved.photoUrl ?? conv.participantPhotos?.[otherUid] ?? null;
  const isRequest  = conv.initiatedBy !== myUid && !conv.acceptedBy.includes(myUid);

  return (
    <TouchableOpacity
      style={[dmt.tile, isSelected && dmt.tileActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Avatar photoUrl={otherPhoto} name={otherName} size={44} />
      <View style={dmt.body}>
        <View style={dmt.topRow}>
          <Text style={[dmt.name, isSelected && { color: Colors.orange }]} numberOfLines={1}>{otherName}</Text>
          <Text style={dmt.time}>{formatTileDate(conv.lastMessageAt)}</Text>
        </View>
        <View style={dmt.previewRow}>
          <Text style={dmt.preview} numberOfLines={1}>{conv.lastMessage || 'No messages yet'}</Text>
          {isRequest && (
            <View style={dm.reqBadge}>
              <Text style={dm.reqBadgeText}>Request</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Shared menu / confirm dialog styles ────────────────────────────────────
const md = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:            { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, overflow: 'hidden' },
  sheetItem:        { paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' },
  sheetCancelItem:  { borderTopWidth: 8, borderTopColor: '#f0f0f0' },
  sheetDanger:      { fontSize: 16, fontWeight: '600', color: '#ef4444' },
  sheetText:        { fontSize: 16, fontWeight: '500' },
  confirm:          { marginHorizontal: 32, marginTop: 'auto' as any, marginBottom: 'auto' as any, borderRadius: 16, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  confirmTitle:     { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  confirmBody:      { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  confirmBtns:      { flexDirection: 'row', gap: 10, marginTop: 4 },
  confirmBtn:       { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmBtnText:   { fontSize: 15, fontWeight: '600' },
  confirmBtnDanger: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center' },
  confirmBtnDangerText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
});

const dmt = StyleSheet.create({
  tile:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  tileActive: { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  body:       { flex: 1, minWidth: 0, gap: 4 },
  topRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name:       { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:       { fontSize: 11, color: '#bbbbbb', flexShrink: 0 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview:    { fontSize: 13, color: '#888888', flex: 1 },
});

// ── DM thread panel ────────────────────────────────────────────────────────

function DMThreadPanel({ conv, myUid, onBack, colors }: {
  conv: DMConv; myUid: string; onBack?: () => void; colors: any;
}) {
  const messages    = useDMMessages(conv.id);
  const otherUid    = conv.participants.find(p => p !== myUid) ?? '';
  const resolved    = useUserDisplayInfo(otherUid || null);
  const otherName   = resolved.name ?? conv.participantNames[otherUid] ?? 'User';
  const otherPhoto  = resolved.photoUrl ?? conv.participantPhotos?.[otherUid] ?? null;
  const isAccepted  = conv.acceptedBy.includes(myUid);
  const isInitiator = conv.initiatedBy === myUid;
  const otherAccepted = conv.acceptedBy.includes(otherUid);
  const canSend     = isAccepted && (isInitiator ? otherAccepted : true);

  const [text, setText]             = useState('');
  const [sending, setSending]       = useState(false);
  const [menuOpen, setMenuOpen]     = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    await sendDMMessage(conv.id, myUid, text.trim());
    setText('');
    setSending(false);
  }

  async function handleDelete() {
    await deleteDMConv(conv.id, myUid);
    onBack?.();
  }

  // Build sender groups for avatar + timestamp logic
  type DMGroup = { senderId: string; msgs: typeof messages; startMs: number; endMs: number };
  const dmGroups: DMGroup[] = [];
  for (const msg of messages) {
    const last = dmGroups[dmGroups.length - 1];
    const ms = new Date(msg.createdAt).getTime();
    if (last && last.senderId === msg.senderId) { last.msgs.push(msg); last.endMs = ms; }
    else dmGroups.push({ senderId: msg.senderId, msgs: [msg], startMs: ms, endMs: ms });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={[dmp.header, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={dmp.back}>←</Text>
          </TouchableOpacity>
        )}
        <Avatar photoUrl={otherPhoto} name={otherName} size={36} />
        <View style={dmp.headerInfo}>
          <Text style={[dmp.name, { color: colors.black }]} numberOfLines={1}>{otherName}</Text>
        </View>
        <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={dmp.deleteIcon}>⋯</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={dmp.msgList}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={dmp.emptyWrap}>
            <Text style={dmp.emptyText}>Say hello to {otherName} 👋</Text>
          </View>
        )}
        {dmGroups.map(group => {
          const spansHour = group.endMs - group.startMs > 3600000;
          return group.msgs.map((msg, i) => {
            const isMine = msg.senderId === myUid;
            const isLast = i === group.msgs.length - 1;
            const showTimestamp = spansHour || isLast;
            return (
              <View
                key={msg.id}
                style={[dmp.msgRow, isMine ? dmp.rowMine : dmp.rowTheirs, i > 0 && { marginTop: 2 }]}
              >
                {!isMine && (
                  isLast
                    ? <Avatar photoUrl={otherPhoto} name={otherName} size={28} />
                    : <View style={{ width: 28 }} />
                )}
                <View style={[dmp.msgCol, isMine && dmp.msgColMine]}>
                  <View style={[dmp.bubble, isMine ? dmp.bubbleMine : dmp.bubbleTheirs]}>
                    <Text style={[dmp.bubbleText, isMine && dmp.bubbleTextMine]}>{msg.text}</Text>
                  </View>
                  {showTimestamp && (
                    <Text style={[dmp.time, isMine && dmp.timeRight]}>{fmtMsgTime(msg.createdAt)}</Text>
                  )}
                </View>
              </View>
            );
          });
        })}
      </ScrollView>

      {/* Message request banners */}
      {!isAccepted && !isInitiator && (
        <View style={[dmp.requestBanner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <Text style={[dmp.requestText, { color: colors.grey }]}>
            <Text style={{ fontWeight: '700', color: colors.black }}>{otherName}</Text> wants to connect with you.
          </Text>
          <View style={dmp.requestBtns}>
            <TouchableOpacity style={dmp.declineBtn} onPress={handleDelete}>
              <Text style={dmp.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dmp.acceptBtn} onPress={() => acceptDMRequest(conv.id, myUid)}>
              <Text style={dmp.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {isInitiator && !otherAccepted && (
        <View style={[dmp.waitingBanner, { borderTopColor: colors.border }]}>
          <Text style={dmp.waitingText}>Waiting for {otherName} to accept</Text>
        </View>
      )}

      {/* Input */}
      {canSend && (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={dmp.inputRow}>
            <TextInput
              style={[dmp.input, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
              placeholder={`Message ${otherName}…`}
              placeholderTextColor="#aaaaaa"
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity
              style={[dmp.sendBtn, !text.trim() && dmp.sendBtnOff]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={[dmp.sendIcon, !text.trim() && dmp.sendIconOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={[md.sheet, { backgroundColor: colors.bg }]}>
            <TouchableOpacity style={md.sheetItem} onPress={() => { setMenuOpen(false); setConfirmOpen(true); }}>
              <Text style={md.sheetDanger}>Delete this conversation</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[md.sheetItem, md.sheetCancelItem]} onPress={() => setMenuOpen(false)}>
              <Text style={[md.sheetText, { color: colors.grey }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
          <View style={[md.confirm, { backgroundColor: colors.bg }]}>
            <Text style={[md.confirmTitle, { color: colors.black }]}>Delete conversation?</Text>
            <Text style={[md.confirmBody, { color: colors.grey }]}>
              This will remove the conversation from your inbox. This can't be undone.
            </Text>
            <View style={md.confirmBtns}>
              <TouchableOpacity style={[md.confirmBtn, { borderColor: colors.border }]} onPress={() => setConfirmOpen(false)}>
                <Text style={[md.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmOpen(false); handleDelete(); }}>
                <Text style={md.confirmBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const dmp = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 10 },
  back:          { fontSize: 20, color: Colors.orange, fontWeight: '400', marginRight: 2 },
  headerInfo:    { flex: 1, minWidth: 0 },
  name:          { fontSize: 15, fontWeight: '700' },
  deleteIcon:    { fontSize: 22, color: '#aaaaaa', letterSpacing: 1 },
  msgList:       { paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 16, gap: 3, flexGrow: 1 },
  emptyWrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  emptyText:     { fontSize: 15, color: '#aaaaaa' },
  msgRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:       { justifyContent: 'flex-end' },
  rowTheirs:     {},
  msgCol:        { maxWidth: '72%' },
  msgColMine:    { alignItems: 'flex-end' },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:    { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs:  { backgroundColor: '#f0ede8', borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, color: '#111111', lineHeight: 22 },
  bubbleTextMine:{ color: '#ffffff' },
  time:          { fontSize: 10, color: '#bbbbbb', marginTop: 3, marginLeft: 2 },
  timeRight:     { textAlign: 'right', marginLeft: 0, marginRight: 2 },
  requestBanner: { borderTopWidth: 1, padding: 20, paddingHorizontal: isWeb ? 24 : 16, gap: 14, alignItems: 'center' },
  requestText:   { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  requestBtns:   { flexDirection: 'row', gap: 10 },
  declineBtn:    { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  declineBtnText:{ fontSize: 14, fontWeight: '600', color: '#888888' },
  acceptBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.orange, alignItems: 'center' },
  acceptBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  waitingBanner: { borderTopWidth: 1, padding: 12, alignItems: 'center', backgroundColor: '#fafafa' },
  waitingText:   { fontSize: 13, color: '#aaaaaa', fontStyle: 'italic' },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  input:         { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120 },
  sendBtn:       { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:    { backgroundColor: '#e0e0e0' },
  sendIcon:      { fontSize: 18, fontWeight: '700', color: '#ffffff', lineHeight: 20, marginTop: -1 },
  sendIconOff:   { color: '#bbbbbb' },
});

const dm = StyleSheet.create({
  reqBadge:     { backgroundColor: Colors.orange + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  reqBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.orange },
});

// ── Filter config ──────────────────────────────────────────────────────────

type FilterKey = 'enquired' | 'discussing' | 'confirmed';

function getFilterConfig(isVenue: boolean) {
  return [
    { key: 'enquired'   as FilterKey, label: isVenue ? 'Awaiting Response' : 'Enquired', statuses: ['enquired', 'pending'] },
    { key: 'discussing' as FilterKey, label: 'Discussing', statuses: ['discussing'] },
    { key: 'confirmed'  as FilterKey, label: 'Confirmed',  statuses: ['confirmed', 'accepted'] },
  ];
}

function matchesFilter(enquiry: Enquiry, filter: FilterKey): boolean {
  const cfg = getFilterConfig(true).find(f => f.key === filter);
  if (!cfg) return true;
  const norm = normalizeEnquiryStatus(enquiry.status);
  return cfg.statuses.includes(enquiry.status) || cfg.statuses.includes(norm);
}

// ── Main inbox screen ──────────────────────────────────────────────────────

export default function InboxScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isWideWeb = isWeb && screenWidth >= 768;
  // Explicit pixel height for mobile web thread panel (avoids outer page scroll)
  const mobileWebHeight = isWeb && !isWideWeb
    ? screenHeight - (insets.top + TOP_TAB_H) - (BOTTOM_TAB_H + insets.bottom)
    : undefined;
  const isVenue = profile?.type === 'venue';
  const venueId = profile?.venueId ?? null;

  const artistData   = useArtistEnquiries(!isVenue ? (user?.uid ?? null) : null);
  const supportData  = useSupportEnquiries(!isVenue ? (user?.uid ?? null) : null);
  const venueData    = useVenueEnquiries(isVenue ? venueId : null);
  const rawArtist    = isVenue ? venueData : artistData;
  // Merge artist headliner enquiries + support-act invites (deduplicate by id)
  const mergedEnquiries = isVenue
    ? rawArtist.enquiries
    : [...artistData.enquiries, ...supportData.enquiries.filter(s => !artistData.enquiries.find(a => a.id === s.id))];
  const { enquiries, loading } = isVenue
    ? venueData
    : { enquiries: mergedEnquiries, loading: artistData.loading && supportData.loading };

  const [selected,  setSelected]  = useState<Enquiry | null>(null);
  const [filter,    setFilter]    = useState<FilterKey>('enquired');
  const [inboxTab,  setInboxTabRaw]  = useState<'enquiries' | 'messages'>(_sessionInboxTab);
  function setInboxTab(tab: 'enquiries' | 'messages') { _sessionInboxTab = tab; setInboxTabRaw(tab); }
  const [dmFilter,  setDmFilter]  = useState<'accepted' | 'requests'>('accepted');
  const [selectedDMId, setSelectedDMId] = useState<string | null>(null);

  const myUid   = user?.uid ?? '';
  const myName  = profile?.displayName || user?.email || '';
  const [myPhoto, setMyPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !profile) return;
    if (profile.type === 'artist') {
      getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
        if (snap.exists()) setMyPhoto(snap.data().photoUrl ?? null);
      }).catch(() => {});
    } else if (profile.type === 'venue' && profile.venueId) {
      getDoc(doc(db, 'venues', profile.venueId)).then(snap => {
        if (snap.exists()) setMyPhoto(snap.data().photoUrl ?? null);
      }).catch(() => {});
    }
  }, [user?.uid, profile?.type, profile?.venueId]);

  const dmConvs     = useDMConversations(user?.uid ?? null);
  const acceptedDMs = dmConvs.filter(c => c.acceptedBy.includes(myUid));
  const requestDMs  = dmConvs.filter(c => !c.acceptedBy.includes(myUid) && c.initiatedBy !== myUid);
  const filteredDMs = dmFilter === 'accepted' ? acceptedDMs : requestDMs;
  const selectedDM  = dmConvs.find(c => c.id === selectedDMId) ?? null;

  const FILTERS = getFilterConfig(isVenue);
  const sorted   = [...enquiries].filter(e => !(isVenue && e.status === 'declined')).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const filtered = sorted.filter(e => matchesFilter(e, filter));
  const enquiryNotifCount = !isVenue
    ? enquiries.filter(e => e.status !== 'declined' && e.status !== 'cancelled').length
    : 0;

  // Lock browser page scroll on web — inner ScrollViews handle their own scroll
  useEffect(() => {
    if (!isWeb) return;
    (document as any).documentElement.style.overflow = 'hidden';
    (document as any).body.style.overflow = 'hidden';
    return () => {
      (document as any).documentElement.style.overflow = '';
      (document as any).body.style.overflow = '';
    };
  }, []);

  // ── Not signed in ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
        <View style={s.center}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={[s.emptyTitle, { color: colors.black }]}>Sign in to view your inbox</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.push('/login')}>
            <Text style={s.btnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── WEB: two-column layout (wide screens only) ───────────────────────────
  if (isWideWeb) {
    return (
      <View style={{
        position: 'fixed' as any,
        top: WEB_TAB_H,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        overflow: 'hidden' as any,
        zIndex: 1,
        backgroundColor: colors.bg,
      } as any}>

        {/* Sidebar */}
        <View style={[wb.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
          {/* Header */}
          <View style={[wb.sidebarHead, { borderBottomColor: colors.border }]}>
            <View style={wb.sidebarTitleRow}>
              <View style={wb.segControl}>
                  <TouchableOpacity
                    style={[wb.segBtn, inboxTab === 'enquiries' && wb.segBtnActive]}
                    onPress={() => setInboxTab('enquiries')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[wb.segText, inboxTab === 'enquiries' && wb.segTextActive]}>
                        {isVenue ? 'Enquiries' : 'My Enquiries'}
                      </Text>
                      {enquiryNotifCount > 0 && (
                        <View style={[wb.segBadge, inboxTab === 'enquiries' && wb.segBadgeActive]}>
                          <Text style={[wb.segBadgeText, inboxTab === 'enquiries' && wb.segBadgeTextActive]}>{enquiryNotifCount}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[wb.segBtn, inboxTab === 'messages' && wb.segBtnActive]}
                    onPress={() => setInboxTab('messages')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[wb.segText, inboxTab === 'messages' && wb.segTextActive]}>Messages</Text>
                      {dmConvs.length > 0 && (
                        <View style={[wb.segBadge, inboxTab === 'messages' && wb.segBadgeActive]}>
                          <Text style={[wb.segBadgeText, inboxTab === 'messages' && wb.segBadgeTextActive]}>{dmConvs.length}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                </View>
            </View>

            {/* Enquiry filter pills */}
            {inboxTab === 'enquiries' && (
              <View style={wb.filterRow}>
                {FILTERS.map(f => {
                  const count  = sorted.filter(e => matchesFilter(e, f.key)).length;
                  const active = filter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[wb.filterBtn, active && wb.filterBtnActive]}
                      onPress={() => setFilter(f.key)}
                    >
                      <Text style={[wb.filterText, active && wb.filterTextActive]}>{f.label}</Text>
                      {count > 0 && (
                        <View style={[wb.filterCount, active && wb.filterCountActive]}>
                          <Text style={[wb.filterCountText, active && wb.filterCountTextActive]}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* DM sub-filter */}
            {inboxTab === 'messages' && (
              <View style={wb.filterRow}>
                {(['accepted', 'requests'] as const).map(f => {
                  const count  = f === 'accepted' ? acceptedDMs.length : requestDMs.length;
                  const active = dmFilter === f;
                  return (
                    <TouchableOpacity
                      key={f}
                      style={[wb.filterBtn, active && wb.filterBtnActive]}
                      onPress={() => setDmFilter(f)}
                    >
                      <Text style={[wb.filterText, active && wb.filterTextActive]}>
                        {f === 'accepted' ? 'Accepted' : 'Requests'}
                      </Text>
                      {count > 0 && (
                        <View style={[wb.filterCount, active && wb.filterCountActive]}>
                          <Text style={[wb.filterCountText, active && wb.filterCountTextActive]}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Tile list */}
          {inboxTab === 'enquiries' ? (
            loading ? (
              <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
            ) : filtered.length === 0 ? (
              <Text style={wb.emptyText}>
                {enquiries.length === 0 ? 'No enquiries yet' : 'None in this filter'}
              </Text>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                {filtered.map(item => (
                  <ThreadTile
                    key={item.id}
                    item={item}
                    isVenue={isVenue}
                    myUid={myUid}
                    isSelected={selected?.id === item.id}
                    onPress={() => setSelected(item)}
                    onDelete={() => archiveEnquiry(item.id, isVenue ? (venueId ?? myUid) : myUid)}
                  />
                ))}
              </ScrollView>
            )
          ) : (
            filteredDMs.length === 0 ? (
              <Text style={wb.emptyText}>
                {dmFilter === 'requests' ? 'No message requests' : 'No accepted messages yet'}
              </Text>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                {filteredDMs.map(c => (
                  <DMTile
                    key={c.id}
                    conv={c}
                    myUid={myUid}
                    isSelected={selectedDMId === c.id}
                    onPress={() => setSelectedDMId(c.id)}
                  />
                ))}
              </ScrollView>
            )
          )}
        </View>

        {/* Right panel */}
        <View style={[wb.panel, { backgroundColor: colors.bg }]}>
          {inboxTab === 'enquiries' ? (
            !selected ? (
              <View style={wb.panelEmpty}>
                <Text style={wb.panelEmptyText}>Select a conversation</Text>
              </View>
            ) : (
              <ThreadPanel
                enquiry={selected}
                isVenue={isVenue}
                venueId={venueId}
                onBack={undefined}
              />
            )
          ) : (
            !selectedDM ? (
              <View style={wb.panelEmpty}>
                <Text style={wb.panelEmptyText}>Select a conversation</Text>
              </View>
            ) : (
              <DMThreadPanel
                conv={selectedDM}
                myUid={myUid}
                colors={colors}
                onBack={undefined}
              />
            )
          )}
        </View>
      </View>
    );
  }

  // ── NATIVE/MOBILE: thread open — full screen ──────────────────────────────
  if (selected) {
    const topOffset    = insets.top + TOP_TAB_H;
    const bottomOffset = BOTTOM_TAB_H + insets.bottom;
    return (
      <View style={isWeb ? {
        position: 'fixed' as any,
        top: topOffset,
        left: 0,
        right: 0,
        bottom: bottomOffset,
        backgroundColor: colors.bg,
        overflow: 'hidden' as any,
        zIndex: 500,
      } : {
        flex: 1,
        backgroundColor: colors.bg,
      }}>
        <ThreadPanel enquiry={selected} isVenue={isVenue} venueId={venueId} onBack={() => setSelected(null)} />
      </View>
    );
  }

  // ── NATIVE: list ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Page header */}
      <View style={[s.listHeader, { borderBottomColor: colors.border }, (isWeb && !isWideWeb) && { paddingTop: TOP_TAB_H + 20 }]}>
        <View style={s.listHeaderTop}>
          <View style={s.segControl}>
            <TouchableOpacity
              style={[s.segBtn, inboxTab === 'enquiries' && s.segBtnActive]}
              onPress={() => setInboxTab('enquiries')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[s.segText, inboxTab === 'enquiries' && s.segTextActive]}>
                  {isVenue ? 'Enquiries' : 'My Enquiries'}
                </Text>
                {enquiryNotifCount > 0 && (
                  <View style={[s.segBadge, inboxTab === 'enquiries' && s.segBadgeActive]}>
                    <Text style={[s.segBadgeText, inboxTab === 'enquiries' && s.segBadgeTextActive]}>{enquiryNotifCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.segBtn, inboxTab === 'messages' && s.segBtnActive]}
              onPress={() => setInboxTab('messages')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[s.segText, inboxTab === 'messages' && s.segTextActive]}>Messages</Text>
                {dmConvs.length > 0 && (
                  <View style={[s.segBadge, inboxTab === 'messages' && s.segBadgeActive]}>
                    <Text style={[s.segBadgeText, inboxTab === 'messages' && s.segBadgeTextActive]}>{dmConvs.length}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Filter pills — horizontal scroll */}
        {inboxTab === 'enquiries' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {FILTERS.map(f => {
              const count  = sorted.filter(e => matchesFilter(e, f.key)).length;
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.filterPill, active && s.filterPillActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
                  {count > 0 && (
                    <View style={[s.filterBadge, active && s.filterBadgeActive]}>
                      <Text style={[s.filterBadgeText, active && s.filterBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {inboxTab === 'messages' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {(['accepted', 'requests'] as const).map(f => {
              const count  = f === 'accepted' ? acceptedDMs.length : requestDMs.length;
              const active = dmFilter === f;
              return (
                <TouchableOpacity key={f} style={[s.filterPill, active && s.filterPillActive]} onPress={() => setDmFilter(f)}>
                  <Text style={[s.filterText, active && s.filterTextActive]}>
                    {f === 'accepted' ? 'Accepted' : 'Requests'}
                  </Text>
                  {count > 0 && (
                    <View style={[s.filterBadge, active && s.filterBadgeActive]}>
                      <Text style={[s.filterBadgeText, active && s.filterBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Content */}
      {inboxTab === 'enquiries' ? (
        loading ? (
          <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
        ) : filtered.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>📭</Text>
            <Text style={[s.emptyTitle, { color: colors.black }]}>
              {enquiries.length === 0 ? 'No enquiries yet' : 'None in this filter'}
            </Text>
            <Text style={s.emptySub}>
              {enquiries.length === 0
                ? (isVenue
                    ? 'Enquiries from musicians will appear here'
                    : 'Your enquiries to venues will appear here')
                : 'Try a different filter'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <ThreadTile item={item} isVenue={isVenue} myUid={myUid} isSelected={false} onPress={() => setSelected(item)} onDelete={() => archiveEnquiry(item.id, isVenue ? (venueId ?? myUid) : myUid)} />
            )}
          />
        )
      ) : (
        filteredDMs.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>💬</Text>
            <Text style={[s.emptyTitle, { color: colors.black }]}>
              {dmFilter === 'requests' ? 'No message requests' : 'No messages yet'}
            </Text>
            <Text style={s.emptySub}>
              {dmFilter === 'accepted'
                ? 'Accepted conversations will appear here'
                : 'Message requests from others will appear here'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredDMs}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <DMTile
                conv={item}
                myUid={myUid}
                isSelected={false}
                onPress={() => {
                  const otherUid  = item.participants.find(p => p !== myUid) ?? '';
                  const otherName = item.participantNames[otherUid] ?? 'User';
                  router.push({ pathname: '/messages/[id]', params: { id: otherUid, name: otherName } });
                }}
              />
            )}
          />
        )
      )}
    </SafeAreaView>
  );
}

// ── Web sidebar styles ─────────────────────────────────────────────────────

const wb = StyleSheet.create({
  sidebar:          { width: 340, borderRightWidth: 1, flexDirection: 'column' },
  sidebarHead:      { padding: 20, paddingBottom: 14, borderBottomWidth: 1 },
  sidebarTitleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sidebarTitle:     { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  segControl:   { flexDirection: 'row', backgroundColor: '#f0ede8', borderRadius: 10, padding: 4, gap: 2 },
  segBtn:       { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  segBtnActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText:      { fontSize: 13, fontWeight: '600', color: '#888888' },
  segTextActive:{ color: '#111111', fontWeight: '700' },
  segBadge:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segBadgeActive:    { backgroundColor: '#b0aca7' },
  segBadgeText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  segBadgeTextActive:{ color: '#111111' },
  filterRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  filterBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  filterBtnActive:  { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 12, fontWeight: '600', color: '#777777' },
  filterTextActive: { color: '#111111' },
  filterCount:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterCountActive:    { backgroundColor: 'rgba(0,0,0,0.15)' },
  filterCountText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  filterCountTextActive:{ color: '#111111' },
  emptyText:        { textAlign: 'center', color: '#999999', fontSize: 14, padding: 40 },
  panel:            { flex: 1, flexDirection: 'column', overflow: 'hidden' as any },
  panelEmpty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panelEmptyText:   { fontSize: 15, color: '#bbbbbb' },
});

// ── Native styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1 },
  listHeader:    { padding: 20, paddingBottom: 14, borderBottomWidth: 1 },
  listHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  segControl:    { flexDirection: 'row', backgroundColor: '#f0ede8', borderRadius: 10, padding: 4, gap: 2 },
  segBtn:        { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  segBtnActive:  { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText:       { fontSize: 13, fontWeight: '600', color: '#888888' },
  segTextActive: { color: '#111111', fontWeight: '700' },
  segBadge:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segBadgeActive:    { backgroundColor: '#b0aca7' },
  segBadgeText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  segBadgeTextActive:{ color: '#111111' },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySub:      { fontSize: 14, color: '#999999', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn:           { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:       { fontSize: 15, fontWeight: '700', color: '#111111' },
  filterPill:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, borderColor: '#d0ccc7', paddingHorizontal: 12, paddingVertical: 7, minHeight: 34, backgroundColor: '#ffffff' },
  filterPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 13, color: '#777777', fontWeight: '600' },
  filterTextActive: { color: '#111111' },
  filterBadge:       { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterBadgeActive: { backgroundColor: 'rgba(0,0,0,0.15)' },
  filterBadgeText:   { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  filterBadgeTextActive: { color: '#111111' },
});
