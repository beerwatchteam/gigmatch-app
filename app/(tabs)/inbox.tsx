import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Image, Linking,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages,
  updateEnquiryStatus, sendMessage, cancelEnquiry, archiveEnquiry,
  bookSlotOnTimetable, cancelAcceptance,
  type Enquiry,
} from '@/lib/useEnquiries';
import {
  useDMConversations, useDMMessages,
  sendDMMessage, acceptDMRequest, deleteDMConv,
  type DMConv,
} from '@/lib/useDirectMessages';

const isWeb = Platform.OS === 'web';

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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffMs = today.getTime() - d.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
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
  switch (status) {
    case 'pending':
      return isVenue
        ? { label: 'NEEDS REPLY',    color: '#f5a623', bg: 'rgba(245,166,35,0.12)' }
        : { label: 'AWAITING REPLY', color: '#888888', bg: 'rgba(0,0,0,0.06)'      };
    case 'discussing':
      return { label: 'DISCUSSING', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
    case 'accepted':
      return { label: 'CONFIRMED',  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'  };
    case 'declined':
      return { label: 'DECLINED',   color: '#dc2626', bg: 'rgba(220,38,38,0.1)'  };
    case 'cancelled':
      return { label: 'CANCELLED',  color: '#888888', bg: 'rgba(0,0,0,0.06)'     };
    default:
      return { label: status.toUpperCase(), color: '#888888', bg: 'rgba(0,0,0,0.06)' };
  }
}

function StatusBadge({ status, isVenue }: { status: string; isVenue: boolean }) {
  const cfg = getStatusCfg(status, isVenue);
  return (
    <View style={[sb.wrap, { backgroundColor: cfg.bg, borderColor: cfg.color + '44' }]}>
      <Text style={[sb.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap: {
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3,
    alignSelf: 'flex-start', borderWidth: 1,
  },
  text: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});

// ── Date separator ─────────────────────────────────────────────────────────

function DateSep({ label }: { label: string }) {
  return (
    <View style={ds.wrap}>
      <View style={ds.line} />
      <Text style={ds.text}>{label}</Text>
      <View style={ds.line} />
    </View>
  );
}
const ds = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  line: { flex: 1, height: 1, backgroundColor: '#eeeeee' },
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

// ── Deal sheet row ─────────────────────────────────────────────────────────

function DealSheetRow({ enquiry }: { enquiry: Enquiry }) {
  const { date, day, time, slotType, setLength } = enquiry.requestedSlot;
  const dateStr  = date ? fmtSlotDateFull(date) : day || '—';
  const setStr   = [time, setLength].filter(Boolean).join(' · ') || '—';
  const billing  = slotType || '—';
  const fee      = enquiry.fee ? `$${enquiry.fee}` : '—';
  const backline = (enquiry.techRider?.backlineNeeded || enquiry.backline) ?? '—';

  const cols: { label: string; value: string }[] = [
    { label: 'DATE',      value: dateStr },
    { label: 'SET',       value: setStr  },
    { label: 'BILLING',   value: billing },
    { label: 'FEE ASKED', value: fee     },
    { label: 'BACKLINE',  value: typeof backline === 'string' ? backline : '—' },
  ];

  return (
    <View style={deal.row}>
      {cols.map((col, i) => (
        <View key={col.label} style={[deal.col, i < cols.length - 1 && deal.colBorder]}>
          <Text style={deal.label}>{col.label}</Text>
          <Text style={deal.value} numberOfLines={2}>{col.value}</Text>
        </View>
      ))}
    </View>
  );
}

const deal = StyleSheet.create({
  row:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#efefef', marginTop: 12 },
  col:       { flex: 1, paddingTop: 10, paddingRight: 6 },
  colBorder: { borderRightWidth: 1, borderRightColor: '#efefef', marginRight: 6 },
  label:     { fontSize: 9, fontWeight: '700', color: '#bbbbbb', letterSpacing: 0.7, marginBottom: 4, textTransform: 'uppercase' as const },
  value:     { fontSize: 12, fontWeight: '600', color: '#111111', lineHeight: 17 },
});

// ── Enquiry header card ────────────────────────────────────────────────────

function EnquiryHeader({ enquiry, isVenue }: { enquiry: Enquiry; isVenue: boolean }) {
  const router = useRouter();
  const genres: string[] = enquiry.genre ?? [];
  const who = isVenue ? enquiry.bandName : enquiry.venueName;

  const listenUrl  = enquiry.spotify || enquiry.appleMusic || (enquiry as any).soundcloud;
  const hasTechRider = !!(
    enquiry.techRider &&
    typeof enquiry.techRider === 'object' &&
    Object.keys(enquiry.techRider).length > 0
  );

  return (
    <View style={eh.card}>
      {/* Identity row */}
      <View style={eh.top}>
        <Avatar photoUrl={enquiry.photoUrl} name={who} size={52} />
        <View style={eh.identity}>
          <Text style={eh.name} numberOfLines={1}>{who}</Text>
          <View style={eh.pillRow}>
            {enquiry.artistType ? (
              <View style={eh.typePill}>
                <Text style={eh.typeText}>
                  {enquiry.artistType.toUpperCase()}
                  {(enquiry as any).memberCount ? ` · ${(enquiry as any).memberCount}PC` : ''}
                </Text>
              </View>
            ) : null}
            {enquiry.location ? <Text style={eh.location}>{enquiry.location}</Text> : null}
          </View>
          {genres.length > 0 && (
            <View style={eh.genres}>
              {genres.slice(0, 4).map(g => (
                <View key={g} style={eh.genrePill}>
                  <Text style={eh.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <StatusBadge status={enquiry.status} isVenue={isVenue} />
      </View>

      {/* Links row */}
      {isVenue ? (
        (enquiry.profileUrl || listenUrl || hasTechRider) ? (
          <View style={eh.links}>
            {enquiry.profileUrl ? (
              <TouchableOpacity onPress={() => Linking.openURL(enquiry.profileUrl!)}>
                <Text style={eh.link}>Full profile →</Text>
              </TouchableOpacity>
            ) : null}
            {listenUrl ? (
              <TouchableOpacity onPress={() => Linking.openURL(listenUrl)}>
                <Text style={eh.link}>Listen →</Text>
              </TouchableOpacity>
            ) : null}
            {hasTechRider ? (
              <Text style={eh.link}>Tech rider →</Text>
            ) : null}
          </View>
        ) : null
      ) : (
        <View style={eh.links}>
          <TouchableOpacity onPress={() => router.push(`/venue/${enquiry.venueId}`)}>
            <Text style={eh.link}>View venue →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Deal sheet */}
      <DealSheetRow enquiry={enquiry} />
    </View>
  );
}

const eh = StyleSheet.create({
  card:      { padding: isWeb ? 20 : 16, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa', flexShrink: 0 },
  top:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  identity:  { flex: 1, gap: 4 },
  name:      { fontSize: 16, fontWeight: '800', color: '#111111', letterSpacing: -0.3 },
  pillRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  typePill:  { backgroundColor: Colors.orange + '1a', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:  { fontSize: 10, fontWeight: '800', color: Colors.orange, letterSpacing: 0.3 },
  location:  { fontSize: 12, color: '#999999' },
  genres:    { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 5, marginTop: 2 },
  genrePill: { borderWidth: 1, borderColor: '#e4e4e4', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  genreText: { fontSize: 11, color: '#555555' },
  links:     { flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#efefef' },
  link:      { fontSize: 13, color: Colors.orange, fontWeight: '600' },
});

// ── Thread tile ────────────────────────────────────────────────────────────

function ThreadTile({ item, isVenue, isSelected, onPress }: {
  item: Enquiry; isVenue: boolean; isSelected: boolean; onPress: () => void;
}) {
  const who = isVenue ? item.bandName : item.venueName;
  const { day, date, time, slotType } = item.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotStr = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const cfg  = getStatusCfg(item.status, isVenue);
  const fee  = (item as any).fee ? `$${(item as any).fee}` : null;

  return (
    <TouchableOpacity
      style={[tt.tile, isSelected && tt.tileActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Avatar photoUrl={item.photoUrl} name={who} size={40} />
      <View style={tt.body}>
        <View style={tt.topRow}>
          <Text style={[tt.name, isSelected && { color: Colors.orange }]} numberOfLines={1}>{who}</Text>
          <Text style={tt.time}>{formatTileDate(item.submittedAt)}</Text>
        </View>
        <Text style={tt.slot} numberOfLines={1}>{slotStr || 'No slot specified'}</Text>
        <View style={tt.bottomRow}>
          <View style={[tt.badge, { backgroundColor: cfg.bg, borderColor: cfg.color + '44' }]}>
            <Text style={[tt.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {fee ? <Text style={tt.fee}>{fee}</Text> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const tt = StyleSheet.create({
  tile:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa' },
  tileActive: { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  body:       { flex: 1, minWidth: 0, gap: 3 },
  topRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bottomRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  name:       { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:       { fontSize: 11, color: '#bbbbbb', flexShrink: 0 },
  slot:       { fontSize: 12, color: '#777777' },
  badge:      { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  badgeText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  fee:        { fontSize: 12, fontWeight: '600', color: '#444444' },
});

// ── Thread panel ───────────────────────────────────────────────────────────

function ThreadPanel({ enquiry, isVenue, venueId, onBack }: {
  enquiry: Enquiry; isVenue: boolean; venueId: string | null; onBack: () => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const messages = useMessages(enquiry.id);
  const scrollRef = useRef<ScrollView>(null);

  const [chatText,      setChatText]      = useState('');
  const [replyText,     setReplyText]     = useState('');
  const [confirmText,   setConfirmText]   = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [expandedForm,  setExpandedForm]  = useState<null | 'decline' | 'confirm'>(null);
  const [counterMode,   setCounterMode]   = useState(false);
  const [listingChoice, setListingChoice] = useState<'pending' | 'booked'>('pending');
  const [submitting,    setSubmitting]    = useState(false);

  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const declineReasonSaved = (enquiry as any).declineReason || (enquiry as any).reason;
  const isClosed = enquiry.status === 'declined' || enquiry.status === 'cancelled';

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  function toggleForm(form: 'decline' | 'confirm') {
    setExpandedForm(prev => prev === form ? null : form);
  }

  async function handleSendReply() {
    const msg = replyText.trim();
    if (!msg || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, msg);
    if (enquiry.status === 'pending') await updateEnquiryStatus(enquiry.id, 'discussing');
    setReplyText('');
    setCounterMode(false);
    setSubmitting(false);
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
    const msg = confirmText.trim();
    if (!msg || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, msg);
    await updateEnquiryStatus(enquiry.id, 'accepted');
    await bookSlotOnTimetable(enquiry, listingChoice === 'booked');
    setExpandedForm(null);
    setConfirmText('');
    setSubmitting(false);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Back bar (mobile only) */}
      {!isWeb && (
        <View style={[tp.backBar, { borderBottomColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <TouchableOpacity onPress={onBack}>
            <Text style={tp.back}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Always-visible enquiry header + deal sheet */}
      <EnquiryHeader enquiry={enquiry} isVenue={isVenue} />

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={tp.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 && (
          <View style={tp.noMsgs}>
            <Text style={tp.noMsgsText}>
              {enquiry.status === 'pending'
                ? (isVenue ? 'Respond to this enquiry below.' : 'Awaiting a response from the venue.')
                : 'No messages yet.'}
            </Text>
          </View>
        )}

        {messages.map((m, idx) => {
          const mine    = m.sender === user?.uid;
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showSep = !prevMsg || !isSameDay(prevMsg.timestamp, m.timestamp);
          const senderLabel = mine ? 'YOU' : who.toUpperCase();
          return (
            <View key={m.id}>
              {showSep && <DateSep label={getDateLabel(m.timestamp)} />}
              <View style={[tp.msgRow, mine ? tp.rowMine : tp.rowTheirs]}>
                <View style={[tp.msgCol, mine && tp.msgColMine]}>
                  <Text style={[tp.msgLabel, mine && tp.msgLabelRight]}>
                    {senderLabel} · {fmtMsgTime(m.timestamp)}
                  </Text>
                  <View style={[tp.bubble, mine ? tp.bubbleMine : tp.bubbleTheirs]}>
                    <Text style={[tp.bubbleText, mine && tp.bubbleTextMine]}>{m.text}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}

        {/* Decline reason */}
        {isClosed && declineReasonSaved ? (
          <View style={tp.reasonBanner}>
            <Text style={tp.reasonLabel}>REASON</Text>
            <Text style={tp.reasonText}>{declineReasonSaved}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Bottom action area ─────────────────────────────────────── */}

      {isClosed ? (
        <View style={[tp.closedBanner, { borderTopColor: colors.border }]}>
          <Text style={tp.closedText}>
            {enquiry.status === 'cancelled' ? 'Enquiry cancelled.' : 'Enquiry declined.'}
          </Text>
        </View>

      ) : isVenue && enquiry.status === 'pending' ? (
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
                <TextInput
                  style={vp.formTextarea}
                  placeholder="e.g. Great, we'd love to have you. A few details to confirm…"
                  placeholderTextColor="#aaaaaa"
                  value={confirmText}
                  onChangeText={setConfirmText}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  autoFocus
                />
                <View style={{ gap: 6, marginBottom: 10 }}>
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
                <View style={vp.formRow}>
                  <TouchableOpacity
                    style={vp.cancelBtn}
                    onPress={() => { setExpandedForm(null); setConfirmText(''); }}
                  >
                    <Text style={vp.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[vp.confirmSubmit, !confirmText.trim() && vp.confirmSubmitOff]}
                    onPress={handleConfirm}
                    disabled={!confirmText.trim() || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color="#111111" size="small" />
                      : <Text style={[vp.confirmSubmitText, !confirmText.trim() && { color: '#aaaaaa' }]}>
                          Confirm Booking
                        </Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Reply row */}
            <View style={vp.replyRow}>
              <TextInput
                style={vp.replyInput}
                placeholder={counterMode ? `Counter-offer to ${who}…` : `Reply to ${who}…`}
                placeholderTextColor="#aaaaaa"
                value={replyText}
                onChangeText={setReplyText}
                multiline
              />
              <TouchableOpacity
                style={[vp.sendBtn, !replyText.trim() && vp.sendBtnOff]}
                onPress={handleSendReply}
                disabled={!replyText.trim() || submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#111111" size="small" />
                  : <Text style={[vp.sendBtnText, !replyText.trim() && vp.sendBtnTextOff]}>Send</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Action buttons */}
            <View style={vp.actionRow}>
              <TouchableOpacity
                style={[vp.outlineBtn, counterMode && vp.outlineBtnActive]}
                onPress={() => { setCounterMode(v => !v); setExpandedForm(null); }}
              >
                <Text style={[vp.outlineBtnText, counterMode && { color: Colors.orange }]}>Counter-offer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[vp.outlineBtn, expandedForm === 'decline' && vp.declineBtnActive]}
                onPress={() => { toggleForm('decline'); setCounterMode(false); }}
              >
                <Text style={[vp.outlineBtnText, expandedForm === 'decline' && { color: '#dc2626' }]}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={vp.confirmBtn}
                onPress={() => { toggleForm('confirm'); setCounterMode(false); }}
              >
                <Text style={vp.confirmBtnText}>Confirm booking</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

      ) : !isVenue && enquiry.status === 'pending' ? (
        // ── Artist pending: awaiting response
        <SafeAreaView
          edges={['bottom']}
          style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgFaint }}
        >
          <View style={tp.awaitingRow}>
            <Text style={tp.awaitingText}>Awaiting response from {enquiry.venueName}</Text>
            <TouchableOpacity onPress={async () => { await cancelEnquiry(enquiry.id); onBack(); }}>
              <Text style={tp.cancelText}>Cancel enquiry</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : isVenue && enquiry.status === 'accepted' ? (
        // ── Venue accepted: timetable management + chat
        <View>
          <View style={[tp.timetableBar, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <Text style={tp.timetableLabel}>Timetable:</Text>
            <View style={[tp.timetablePill, enquiry.listAsBooked ? tp.timetablePillBooked : tp.timetablePillPending]}>
              <Text style={[tp.timetablePillText, enquiry.listAsBooked ? { color: '#ffffff' } : { color: '#555555' }]}>
                {enquiry.listAsBooked ? 'Booked' : 'Pending'}
              </Text>
            </View>
            {!enquiry.listAsBooked ? (
              <TouchableOpacity
                style={tp.timetableBtn}
                onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, true); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={[tp.timetableBtnText, { color: '#16a34a' }]}>List as Booked</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={tp.timetableBtn}
                onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, false); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={[tp.timetableBtnText, { color: '#f5a623' }]}>List as Pending</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[tp.timetableBtn, { marginLeft: 'auto' as any }]}
              onPress={async () => { setSubmitting(true); await cancelAcceptance(enquiry); setSubmitting(false); }}
              disabled={submitting}
            >
              <Text style={[tp.timetableBtnText, { color: '#888888' }]}>Cancel Acceptance</Text>
            </TouchableOpacity>
          </View>
          {/* Chat input */}
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
            <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
              <TextInput
                style={[ci.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
                placeholder="Type a message…"
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
                  : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>Send</Text>
                }
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>

      ) : (
        // ── Default: chat input (discussing, or non-pending states)
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TextInput
              style={[ci.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
              placeholder="Type a message…"
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
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>Send</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* Delete conversation */}
      <View style={[tp.deleteRow, { borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={async () => {
          if (!user) return;
          await archiveEnquiry(enquiry.id, isVenue ? (venueId ?? user.uid) : user.uid);
          onBack();
        }}>
          <Text style={tp.deleteText}>Delete conversation</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Venue pending action bar styles
const vp = StyleSheet.create({
  wrap:               { borderTopWidth: 1, backgroundColor: '#fafafa', padding: 14, paddingHorizontal: isWeb ? 24 : 16, gap: 10 },
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
  replyRow:           { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  replyInput:         { flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111111', backgroundColor: '#ffffff', maxHeight: 100 },
  sendBtn:            { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minWidth: 60 },
  sendBtnOff:         { backgroundColor: '#e8e8e8' },
  sendBtnText:        { fontSize: 14, fontWeight: '700', color: '#111111' },
  sendBtnTextOff:     { color: '#aaaaaa' },
  actionRow:          { flexDirection: 'row', gap: 8 },
  outlineBtn:         { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1.5, borderColor: '#e0e0e0', alignItems: 'center' },
  outlineBtnActive:   { borderColor: Colors.orange, backgroundColor: Colors.orange + '10' },
  outlineBtnText:     { fontSize: 13, fontWeight: '600', color: '#666666' },
  declineBtnActive:   { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.06)' },
  confirmBtn:         { flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.orange, alignItems: 'center' },
  confirmBtnText:     { fontSize: 13, fontWeight: '700', color: '#111111' },
});

// Chat input styles
const ci = StyleSheet.create({
  wrap:        { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 14, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1 },
  input:       { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 120 },
  send:        { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minWidth: 60 },
  sendOff:     { backgroundColor: '#e0e0e0' },
  sendText:    { fontSize: 14, fontWeight: '700', color: '#111111' },
  sendTextOff: { color: '#aaaaaa' },
});

// Thread panel shared styles
const tp = StyleSheet.create({
  backBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  back:         { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  msgList:      { padding: isWeb ? 24 : 16, gap: 16, flexGrow: 1 },
  noMsgs:       { alignItems: 'center', paddingTop: 12 },
  noMsgsText:   { fontSize: 14, color: '#aaaaaa', textAlign: 'center', lineHeight: 20 },
  msgRow:       { flexDirection: 'row' },
  rowMine:      { justifyContent: 'flex-end' },
  rowTheirs:    {},
  msgCol:       { maxWidth: '70%', flexDirection: 'column' },
  msgColMine:   { alignItems: 'flex-end' },
  msgLabel:     { fontSize: 10, fontWeight: '700', color: '#aaaaaa', letterSpacing: 0.5, marginBottom: 4 },
  msgLabelRight:{ textAlign: 'right' },
  bubble:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine:   { backgroundColor: '#111111', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4 },
  bubbleText:   { fontSize: 14, color: '#111111', lineHeight: 21 },
  bubbleTextMine: { color: '#ffffff' },
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
  deleteRow:    { paddingHorizontal: isWeb ? 24 : 16, paddingVertical: 10, alignItems: 'flex-end', borderTopWidth: 1 },
  deleteText:   { fontSize: 13, color: '#ef4444', fontWeight: '600' },
});

// ── DM tile ────────────────────────────────────────────────────────────────

function DMTile({ conv, myUid, isSelected, onPress }: {
  conv: DMConv; myUid: string; isSelected: boolean; onPress: () => void;
}) {
  const otherUid  = conv.participants.find(p => p !== myUid) ?? '';
  const otherName = conv.participantNames[otherUid] ?? 'Unknown';
  const otherPhoto = conv.participantPhotos?.[otherUid] ?? null;
  const isRequest = conv.initiatedBy !== myUid && !conv.acceptedBy.includes(myUid);

  return (
    <TouchableOpacity
      style={[tt.tile, isSelected && tt.tileActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Avatar photoUrl={otherPhoto} name={otherName} size={40} />
      <View style={tt.body}>
        <View style={tt.topRow}>
          <Text style={[tt.name, isSelected && { color: Colors.orange }]} numberOfLines={1}>{otherName}</Text>
          <Text style={tt.time}>{formatTileDate(conv.lastMessageAt)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={tt.slot} numberOfLines={1}>{conv.lastMessage}</Text>
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

// ── DM thread panel ────────────────────────────────────────────────────────

function DMThreadPanel({ conv, myUid, onBack, colors }: {
  conv: DMConv; myUid: string; onBack: () => void; colors: any;
}) {
  const messages   = useDMMessages(conv.id);
  const otherUid   = conv.participants.find(p => p !== myUid) ?? '';
  const otherName  = conv.participantNames[otherUid]  ?? 'User';
  const otherPhoto = conv.participantPhotos?.[otherUid] ?? null;
  const isAccepted  = conv.acceptedBy.includes(myUid);
  const isInitiator = conv.initiatedBy === myUid;
  const otherAccepted = conv.acceptedBy.includes(otherUid);
  const canSend    = isAccepted && (isInitiator ? otherAccepted : true);

  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
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
    onBack();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={[dmp.header, { borderBottomColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <TouchableOpacity onPress={onBack}>
          <Text style={dmp.back}>← Back</Text>
        </TouchableOpacity>
        <Avatar photoUrl={otherPhoto} name={otherName} size={32} />
        <Text style={[dmp.name, { color: colors.black }]} numberOfLines={1}>{otherName}</Text>
      </View>

      {/* Messages */}
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={tp.msgList}>
        {messages.length === 0 && (
          <View style={tp.noMsgs}><Text style={tp.noMsgsText}>No messages yet.</Text></View>
        )}
        {messages.map(msg => {
          const isMine = msg.senderId === myUid;
          return (
            <View key={msg.id} style={[tp.msgRow, isMine ? tp.rowMine : tp.rowTheirs]}>
              <View style={[tp.msgCol, isMine && tp.msgColMine]}>
                <Text style={[tp.msgLabel, isMine && tp.msgLabelRight]}>
                  {isMine ? 'YOU' : otherName.toUpperCase()} · {fmtMsgTime(msg.createdAt)}
                </Text>
                <View style={[tp.bubble, isMine ? tp.bubbleMine : tp.bubbleTheirs]}>
                  <Text style={[tp.bubbleText, isMine && tp.bubbleTextMine]}>{msg.text}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Accept banner */}
      {!isAccepted && !isInitiator && (
        <View style={[dm.banner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <Text style={[dm.bannerText, { color: colors.grey }]}>{otherName} sent you a message request.</Text>
          <TouchableOpacity style={dm.acceptBtn} onPress={() => acceptDMRequest(conv.id, myUid)}>
            <Text style={dm.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Waiting banner */}
      {isInitiator && !otherAccepted && (
        <View style={[dm.banner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <Text style={[dm.bannerText, { color: colors.grey }]}>
            Waiting for {otherName} to accept your message request.
          </Text>
        </View>
      )}

      {/* Chat input */}
      {canSend && (
        <View style={[ci.wrap, { backgroundColor: colors.bgFaint, borderTopColor: colors.border }]}>
          <TextInput
            style={[ci.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
            placeholder="Type a message…"
            placeholderTextColor="#aaaaaa"
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[ci.send, !text.trim() && ci.sendOff]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator color="#111111" size="small" />
              : <Text style={[ci.sendText, !text.trim() && ci.sendTextOff]}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Delete */}
      <View style={[tp.deleteRow, { borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={handleDelete}>
          <Text style={tp.deleteText}>Delete conversation</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const dmp = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 10 },
  back:   { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  name:   { fontSize: 16, fontWeight: '700', flex: 1 },
});

const dm = StyleSheet.create({
  reqBadge:     { backgroundColor: Colors.orange + '22', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  reqBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.orange },
  banner:       { padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1, alignItems: 'center', gap: 12 },
  bannerText:   { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  acceptBtn:    { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  acceptBtnText:{ fontSize: 14, fontWeight: '700', color: '#111111' },
});

// ── Filter config ──────────────────────────────────────────────────────────

type FilterKey = 'pending' | 'discussing' | 'settled';

function getFilterConfig(isVenue: boolean) {
  return [
    { key: 'pending'    as FilterKey, label: isVenue ? 'Needs reply' : 'Awaiting',  statuses: ['pending'] },
    { key: 'discussing' as FilterKey, label: 'Discussing', statuses: ['discussing'] },
    { key: 'settled'    as FilterKey, label: 'Settled',    statuses: ['accepted', 'declined', 'cancelled'] },
  ];
}

function matchesFilter(enquiry: Enquiry, filter: FilterKey): boolean {
  const cfg = getFilterConfig(true).find(f => f.key === filter);
  return cfg ? cfg.statuses.includes(enquiry.status) : true;
}

// ── Main inbox screen ──────────────────────────────────────────────────────

export default function InboxScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const isVenue = profile?.type === 'venue';
  const venueId = profile?.venueId ?? null;

  const artistData = useArtistEnquiries(!isVenue ? (user?.uid ?? null) : null);
  const venueData  = useVenueEnquiries(isVenue ? venueId : null);
  const { enquiries, loading } = isVenue ? venueData : artistData;

  const [selected,  setSelected]  = useState<Enquiry | null>(null);
  const [filter,    setFilter]    = useState<FilterKey>('pending');
  const [inboxTab,  setInboxTab]  = useState<'enquiries' | 'messages'>('enquiries');
  const [dmFilter,  setDmFilter]  = useState<'accepted' | 'requests'>('accepted');
  const [selectedDMId, setSelectedDMId] = useState<string | null>(null);

  const myUid   = user?.uid ?? '';
  const myName  = (profile as any)?.name || user?.email || '';
  const myPhoto = (profile as any)?.photoUrl ?? null;

  const dmConvs     = useDMConversations(user?.uid ?? null);
  const acceptedDMs = dmConvs.filter(c => c.acceptedBy.includes(myUid));
  const requestDMs  = dmConvs.filter(c => !c.acceptedBy.includes(myUid) && c.initiatedBy !== myUid);
  const filteredDMs = dmFilter === 'accepted' ? acceptedDMs : requestDMs;
  const selectedDM  = dmConvs.find(c => c.id === selectedDMId) ?? null;

  const FILTERS = getFilterConfig(isVenue);
  const sorted   = [...enquiries].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const filtered = sorted.filter(e => matchesFilter(e, filter));

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

  // ── WEB: two-column layout ───────────────────────────────────────────────
  if (isWeb) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' as any }}>

        {/* Sidebar */}
        <View style={[wb.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
          {/* Header */}
          <View style={[wb.sidebarHead, { borderBottomColor: colors.border }]}>
            <View style={wb.sidebarTitleRow}>
              <Text style={[wb.sidebarTitle, { color: colors.black }]}>
                {isVenue ? 'Inbox' : 'My Enquiries'}
              </Text>
              {/* Messages tab button */}
              <TouchableOpacity
                style={[wb.msgTabBtn, inboxTab === 'messages' && wb.msgTabBtnActive]}
                onPress={() => setInboxTab(inboxTab === 'messages' ? 'enquiries' : 'messages')}
              >
                <Text style={[wb.msgTabText, inboxTab === 'messages' && wb.msgTabTextActive]}>
                  Messages{dmConvs.length > 0 ? ` ${dmConvs.length}` : ''}
                </Text>
              </TouchableOpacity>
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
                    isSelected={selected?.id === item.id}
                    onPress={() => setSelected(item)}
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
                onBack={() => setSelected(null)}
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
                onBack={() => setSelectedDMId(null)}
              />
            )
          )}
        </View>
      </View>
    );
  }

  // ── NATIVE: thread open — full screen ─────────────────────────────────────
  if (selected) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ThreadPanel enquiry={selected} isVenue={isVenue} venueId={venueId} onBack={() => setSelected(null)} />
      </View>
    );
  }

  // ── NATIVE: list ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Page header */}
      <View style={[s.listHeader, { borderBottomColor: colors.border }]}>
        <View style={s.listHeaderTop}>
          <Text style={[s.title, { color: colors.black }]}>
            {isVenue ? 'Inbox' : 'My Enquiries'}
          </Text>
          <TouchableOpacity
            style={[s.msgTabBtn, inboxTab === 'messages' && s.msgTabBtnActive]}
            onPress={() => setInboxTab(inboxTab === 'messages' ? 'enquiries' : 'messages')}
          >
            <Text style={[s.msgTabText, inboxTab === 'messages' && s.msgTabTextActive]}>
              Messages{dmConvs.length > 0 ? ` (${dmConvs.length})` : ''}
            </Text>
          </TouchableOpacity>
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
                  <Text style={[s.filterText, active && s.filterTextActive]}>
                    {f.label}{count > 0 ? ` (${count})` : ''}
                  </Text>
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
                    {f === 'accepted' ? 'Accepted' : 'Requests'}{count > 0 ? ` (${count})` : ''}
                  </Text>
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
              <ThreadTile item={item} isVenue={isVenue} isSelected={false} onPress={() => setSelected(item)} />
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
  msgTabBtn:        { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0' },
  msgTabBtnActive:  { backgroundColor: '#111111', borderColor: '#111111' },
  msgTabText:       { fontSize: 12, fontWeight: '600', color: '#666666' },
  msgTabTextActive: { color: '#ffffff' },
  filterRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  filterBtn:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0' },
  filterBtnActive:  { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 12, fontWeight: '600', color: '#777777' },
  filterTextActive: { color: '#111111' },
  filterCount:      { backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 10, paddingHorizontal: 6 },
  filterCountActive:{ backgroundColor: 'rgba(0,0,0,0.18)' },
  filterCountText:  { fontSize: 11, fontWeight: '700', color: '#777777' },
  filterCountTextActive: { color: '#111111' },
  emptyText:        { textAlign: 'center', color: '#999999', fontSize: 14, padding: 40 },
  panel:            { flex: 1, flexDirection: 'column' },
  panelEmpty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panelEmptyText:   { fontSize: 15, color: '#bbbbbb' },
});

// ── Native styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1 },
  listHeader:    { padding: 20, paddingBottom: 14, borderBottomWidth: 1 },
  listHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  msgTabBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0' },
  msgTabBtnActive: { backgroundColor: '#111111', borderColor: '#111111' },
  msgTabText:    { fontSize: 12, fontWeight: '600', color: '#666666' },
  msgTabTextActive: { color: '#ffffff' },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySub:      { fontSize: 14, color: '#999999', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn:           { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:       { fontSize: 15, fontWeight: '700', color: '#111111' },
  filterPill:    { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7 },
  filterPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:    { fontSize: 13, color: '#777777', fontWeight: '600' },
  filterTextActive: { color: '#111111' },
});
