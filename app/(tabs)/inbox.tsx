import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Image, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages,
  updateEnquiryStatus, sendMessage, cancelEnquiry,
  bookSlotOnTimetable, cancelAcceptance,
  type Enquiry,
} from '@/lib/useEnquiries';

const isWeb = Platform.OS === 'web';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMsgTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function fmtSlotDate(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
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
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString('en-AU', { weekday: 'long' });
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

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'Pending',    color: '#888888', bg: 'rgba(0,0,0,0.06)'     },
  discussing: { label: 'Discussing', color: '#f5a623', bg: 'rgba(245,166,35,0.1)' },
  accepted:   { label: 'Accepted',   color: '#00cc6a', bg: 'rgba(0,204,106,0.1)'  },
  declined:   { label: 'Declined',   color: '#555555', bg: 'rgba(0,0,0,0.05)'     },
  cancelled:  { label: 'Cancelled',  color: '#999999', bg: 'rgba(0,0,0,0.05)'     },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <View style={{ backgroundColor: cfg.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', borderWidth: 1, borderColor: cfg.color + '55' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

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

// ── Enquiry card ───────────────────────────────────────────────────────────

function EnquiryCard({ enquiry, isVenue }: { enquiry: Enquiry; isVenue: boolean }) {
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotStr = [day, dateStr, time, room, slotType, setLength].filter(Boolean).join(' · ');
  const genres: string[] = enquiry.genre ?? [];

  return (
    <View style={isVenue ? ec.wrapVenue : ec.wrapArtist}>
      <Text style={[ec.label, !isVenue && ec.labelRight]}>
        {isVenue
          ? `${enquiry.bandName} · Enquiry sent ${formatTileDate(enquiry.submittedAt)}`
          : `Enquiry sent to ${enquiry.venueName} · ${formatTileDate(enquiry.submittedAt)}`}
      </Text>
      <View style={[ec.card, isVenue ? ec.cardVenue : ec.cardArtist]}>
        {enquiry.photoUrl ? (
          <Image source={{ uri: enquiry.photoUrl }} style={ec.photo} />
        ) : null}
        <View style={ec.identityRow}>
          <Text style={ec.bandName}>{enquiry.bandName}</Text>
          {enquiry.artistType ? (
            <View style={ec.typePill}><Text style={ec.typeText}>{enquiry.artistType}</Text></View>
          ) : null}
        </View>
        {genres.length > 0 ? (
          <View style={ec.genreRow}>
            {genres.map(g => (
              <View key={g} style={ec.genrePill}><Text style={ec.genreText}>{g}</Text></View>
            ))}
          </View>
        ) : null}
        {enquiry.location ? <Text style={ec.location}>📍 {enquiry.location}</Text> : null}

        <View style={ec.section}>
          <Text style={ec.sectionLabel}>SLOT REQUEST</Text>
          <Text style={ec.sectionBody}>{slotStr}</Text>
        </View>

        {enquiry.about ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>ABOUT</Text>
            <Text style={ec.sectionBody}>{enquiry.about}</Text>
          </View>
        ) : null}
        {enquiry.songs ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>MUSIC</Text>
            <Text style={ec.sectionBody}>{enquiry.songs}</Text>
          </View>
        ) : null}
        {enquiry.gigHistory ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>GIG HISTORY</Text>
            <Text style={ec.sectionBody}>{enquiry.gigHistory}</Text>
          </View>
        ) : null}
        {enquiry.upcomingGigs ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>UPCOMING GIGS</Text>
            <Text style={ec.sectionBody}>{enquiry.upcomingGigs}</Text>
          </View>
        ) : null}
        {(enquiry.instagram || enquiry.tiktok || enquiry.spotify || enquiry.appleMusic) ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>SOCIALS</Text>
            {enquiry.instagram  ? <Text style={ec.sectionBody}>Instagram: {enquiry.instagram}</Text>  : null}
            {enquiry.tiktok     ? <Text style={ec.sectionBody}>TikTok: {enquiry.tiktok}</Text>        : null}
            {enquiry.spotify    ? <Text style={ec.sectionBody}>Spotify: {enquiry.spotify}</Text>      : null}
            {enquiry.appleMusic ? <Text style={ec.sectionBody}>Apple Music: {enquiry.appleMusic}</Text> : null}
          </View>
        ) : null}
        {enquiry.techRider ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>TECH RIDER</Text>
            <Text style={ec.sectionBody}>{enquiry.techRider}</Text>
          </View>
        ) : null}
        {enquiry.additionalInfo ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>ADDITIONAL INFO</Text>
            <Text style={ec.sectionBody}>{enquiry.additionalInfo}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ec = StyleSheet.create({
  wrapVenue:   { alignItems: 'flex-start', marginBottom: 4 },
  wrapArtist:  { alignItems: 'flex-end',   marginBottom: 4 },
  label:       { fontSize: 11, color: '#aaaaaa', marginBottom: 4 },
  labelRight:  { textAlign: 'right' },
  card:        { borderRadius: 12, padding: 14, maxWidth: isWeb ? '70%' : '85%' },
  cardVenue:   { backgroundColor: '#f0f0f0', borderBottomLeftRadius: 2 },
  cardArtist:  { backgroundColor: Colors.orange + '22', borderBottomRightRadius: 2 },
  photo:       { width: 48, height: 48, borderRadius: 24, marginBottom: 8 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 4 },
  bandName:    { fontSize: 15, fontWeight: '700', color: '#111111' },
  typePill:    { backgroundColor: '#fa830c', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  typeText:    { fontSize: 11, fontWeight: '600', color: '#111111' },
  genreRow:    { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, marginBottom: 4 },
  genrePill:   { borderWidth: 1, borderColor: '#dddddd', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 1 },
  genreText:   { fontSize: 12, color: '#444444' },
  location:    { fontSize: 12, color: '#888888', marginBottom: 4 },
  section:     { borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingTop: 8, marginTop: 8 },
  sectionLabel:{ fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 3 },
  sectionBody: { fontSize: 13, color: '#111111', lineHeight: 19 },
});

// ── Band profile panel (venue view — expandable in thread header) ───────────

function BandProfilePanel({ enquiry }: { enquiry: Enquiry }) {
  const [open, setOpen] = useState(false);
  const genres: string[] = enquiry.genre ?? [];

  return (
    <View style={bp.wrap}>
      <TouchableOpacity style={bp.toggle} onPress={() => setOpen(v => !v)}>
        <Text style={bp.toggleText}>View Band Profile {open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={bp.panel}>
          {enquiry.photoUrl ? (
            <Image source={{ uri: enquiry.photoUrl }} style={bp.photo} />
          ) : null}
          {enquiry.artistType ? (
            <View style={bp.typePill}><Text style={bp.typeText}>{enquiry.artistType}</Text></View>
          ) : null}
          {genres.length > 0 ? (
            <View style={bp.genreRow}>
              {genres.map(g => (
                <View key={g} style={bp.genrePill}><Text style={bp.genreText}>{g}</Text></View>
              ))}
            </View>
          ) : null}
          {enquiry.location ? <Text style={bp.location}>📍 {enquiry.location}</Text> : null}
          {enquiry.about ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>ABOUT</Text>
              <Text style={bp.sectionBody}>{enquiry.about}</Text>
            </View>
          ) : null}
          {enquiry.songs ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>MUSIC</Text>
              <Text style={bp.sectionBody}>{enquiry.songs}</Text>
            </View>
          ) : null}
          {enquiry.gigHistory ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>GIG HISTORY</Text>
              <Text style={bp.sectionBody}>{enquiry.gigHistory}</Text>
            </View>
          ) : null}
          {enquiry.upcomingGigs ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>UPCOMING GIGS</Text>
              <Text style={bp.sectionBody}>{enquiry.upcomingGigs}</Text>
            </View>
          ) : null}
          {(enquiry.instagram || enquiry.tiktok || enquiry.spotify || enquiry.appleMusic) ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>SOCIALS</Text>
              {enquiry.instagram  ? <TouchableOpacity onPress={() => Linking.openURL(enquiry.instagram!)}><Text style={bp.link}>Instagram: {enquiry.instagram}</Text></TouchableOpacity>  : null}
              {enquiry.tiktok     ? <TouchableOpacity onPress={() => Linking.openURL(enquiry.tiktok!)}><Text style={bp.link}>TikTok: {enquiry.tiktok}</Text></TouchableOpacity>            : null}
              {enquiry.spotify    ? <TouchableOpacity onPress={() => Linking.openURL(enquiry.spotify!)}><Text style={bp.link}>Spotify: {enquiry.spotify}</Text></TouchableOpacity>        : null}
              {enquiry.appleMusic ? <TouchableOpacity onPress={() => Linking.openURL(enquiry.appleMusic!)}><Text style={bp.link}>Apple Music: {enquiry.appleMusic}</Text></TouchableOpacity> : null}
            </View>
          ) : null}
          {enquiry.techRider ? (
            <View style={bp.section}>
              <Text style={bp.sectionLabel}>TECH RIDER</Text>
              <Text style={bp.sectionBody}>{enquiry.techRider}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const bp = StyleSheet.create({
  wrap:        { borderTopWidth: 1, borderTopColor: '#e8e8e8', paddingTop: 10, marginTop: 10 },
  toggle:      { alignSelf: 'flex-start' },
  toggleText:  { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  panel:       { marginTop: 12, gap: 6 },
  photo:       { width: 56, height: 56, borderRadius: 28, marginBottom: 8 },
  typePill:    { alignSelf: 'flex-start', backgroundColor: '#fa830c', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2, marginBottom: 6 },
  typeText:    { fontSize: 11, fontWeight: '600', color: '#111111' },
  genreRow:    { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, marginBottom: 6 },
  genrePill:   { borderWidth: 1, borderColor: '#dddddd', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 1 },
  genreText:   { fontSize: 12, color: '#444444' },
  location:    { fontSize: 12, color: '#888888' },
  section:     { borderTopWidth: 1, borderTopColor: '#eeeeee', paddingTop: 8, marginTop: 8 },
  sectionLabel:{ fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 3 },
  sectionBody: { fontSize: 13, color: '#111111', lineHeight: 19 },
  link:        { fontSize: 13, color: Colors.orange, lineHeight: 20 },
});

// ── Thread tile ────────────────────────────────────────────────────────────

function ThreadTile({ item, isVenue, isSelected, onPress }: {
  item: Enquiry; isVenue: boolean; isSelected: boolean; onPress: () => void;
}) {
  const who = isVenue ? item.bandName : item.venueName;
  const { day, date, time, slotType } = item.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotStr = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const statusCfg = STATUS_MAP[item.status] ?? STATUS_MAP.pending;

  return (
    <TouchableOpacity
      style={[tt.tile, isSelected && tt.tileActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={tt.info}>
        <View style={tt.row1}>
          <Text style={tt.name} numberOfLines={1}>{who}</Text>
          <Text style={tt.time}>{formatTileDate(item.submittedAt)}</Text>
        </View>
        <Text style={tt.slot} numberOfLines={1}>{slotStr}</Text>
        <StatusBadge status={item.status} />
      </View>
      <View style={[tt.dot, { backgroundColor: statusCfg.color }]} />
    </TouchableOpacity>
  );
}

const tt = StyleSheet.create({
  tile:       { flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa', position: 'relative' as const },
  tileActive: { backgroundColor: '#fff4e8', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  info:       { flex: 1, minWidth: 0, gap: 3, paddingRight: 20 },
  row1:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name:       { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:       { fontSize: 11, color: '#aaaaaa', flexShrink: 0 },
  slot:       { fontSize: 12, color: '#666666' },
  dot:        { position: 'absolute' as const, top: 14, right: 14, width: 8, height: 8, borderRadius: 4 },
});

// ── Thread panel (conversation) ────────────────────────────────────────────

function ThreadPanel({ enquiry, isVenue, onBack }: {
  enquiry: Enquiry; isVenue: boolean; onBack: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const messages = useMessages(enquiry.id);
  const [chatText,      setChatText]      = useState('');
  const [formText,      setFormText]      = useState('');
  const [activeForm,    setActiveForm]    = useState<null | 'discuss' | 'decline' | 'accept'>(null);
  const [listingChoice, setListingChoice] = useState<'pending' | 'booked'>('pending');
  const [submitting,    setSubmitting]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotDesc = [day, dateStr, time, room, slotType, setLength].filter(Boolean).join(' · ');
  const declineReason = (enquiry as any).declineReason || (enquiry as any).reason;

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  function toggleForm(form: 'discuss' | 'decline' | 'accept') {
    setActiveForm(prev => prev === form ? null : form);
    setFormText('');
  }

  async function handleSendChat() {
    if (!chatText.trim() || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, chatText.trim());
    setChatText('');
    setSubmitting(false);
  }

  async function handleDiscuss() {
    if (!formText.trim() || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, formText.trim());
    await updateEnquiryStatus(enquiry.id, 'discussing');
    setActiveForm(null); setFormText('');
    setSubmitting(false);
  }

  async function handleDecline() {
    setSubmitting(true);
    if (formText.trim() && user) await sendMessage(enquiry.id, user.uid, formText.trim());
    await updateEnquiryStatus(enquiry.id, 'declined', formText.trim() || undefined);
    setActiveForm(null); setFormText('');
    setSubmitting(false);
  }

  async function handleAccept() {
    if (!formText.trim() || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, formText.trim());
    await updateEnquiryStatus(enquiry.id, 'accepted');
    await bookSlotOnTimetable(enquiry, listingChoice === 'booked');
    setActiveForm(null); setFormText('');
    setSubmitting(false);
  }

  const isClosed = enquiry.status === 'declined' || enquiry.status === 'cancelled';

  function ChatInput() {
    return (
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
        <View style={[ph.inputArea, { backgroundColor: colors.bgFaint, borderTopColor: colors.border }]}>
          <TextInput
            style={[ph.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
            placeholder="Type a message…"
            placeholderTextColor={colors.greyLight}
            value={chatText}
            onChangeText={setChatText}
            multiline
          />
          <TouchableOpacity
            style={[ph.sendBtn, !chatText.trim() && ph.sendBtnDisabled]}
            onPress={handleSendChat}
            disabled={!chatText.trim() || submitting}
          >
            {submitting
              ? <ActivityIndicator color="#111111" size="small" />
              : <Text style={[ph.sendText, !chatText.trim() && ph.sendTextDisabled]}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[ph.header, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
        <View style={ph.headerTop}>
          {!isWeb && (
            <TouchableOpacity onPress={onBack} style={{ marginRight: 12 }}>
              <Text style={ph.back}>← Back</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[ph.name, { color: colors.black }]} numberOfLines={1}>{who}</Text>
            <Text style={[ph.slot, { color: colors.grey }]} numberOfLines={1}>{slotDesc}</Text>
          </View>
          <StatusBadge status={enquiry.status} />
        </View>

        {/* Venue — expandable band profile */}
        {isVenue && <BandProfilePanel enquiry={enquiry} />}

        {/* Artist — view venue profile link */}
        {!isVenue && (
          <TouchableOpacity
            style={ph.viewProfileLink}
            onPress={() => router.push(`/venue/${enquiry.venueId}`)}
          >
            <Text style={ph.viewProfileText}>View Venue Profile →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={ph.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <EnquiryCard enquiry={enquiry} isVenue={isVenue} />

        {messages.length === 0 && (
          <View style={ph.noMsgs}>
            <Text style={ph.noMsgsText}>
              {enquiry.status === 'pending' ? 'Respond to this enquiry below' : 'No messages yet'}
            </Text>
          </View>
        )}

        {messages.map((m, idx) => {
          const mine = m.sender === user?.uid;
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showSep = !prevMsg || !isSameDay(prevMsg.timestamp, m.timestamp);
          return (
            <View key={m.id}>
              {showSep && <DateSep label={getDateLabel(m.timestamp)} />}
              <View style={[ph.msgRow, mine ? ph.msgRowMine : ph.msgRowTheirs]}>
                <View style={[ph.msgCol, mine && ph.msgColMine]}>
                  <Text style={[ph.msgLabel, mine && ph.msgLabelRight]}>{mine ? 'You' : who}</Text>
                  <View style={[ph.bubble, mine ? ph.bubbleMine : ph.bubbleTheirs]}>
                    <Text style={[ph.bubbleText, mine && ph.bubbleTextMine]}>{m.text}</Text>
                  </View>
                  <Text style={[ph.msgTime, mine && ph.msgTimeRight]}>{fmtMsgTime(m.timestamp)}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {/* Decline reason */}
        {(enquiry.status === 'declined' || enquiry.status === 'cancelled') && declineReason ? (
          <View style={ph.bannerReason}>
            <Text style={ph.bannerReasonLabel}>REASON</Text>
            <Text style={ph.bannerReasonText}>{declineReason}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Bottom action area ── */}

      {isClosed ? (
        <View style={ph.banner}>
          <Text style={ph.bannerText}>Enquiry {enquiry.status}.</Text>
        </View>
      ) : isVenue && enquiry.status === 'pending' ? (
        <View style={ph.actionArea}>
          {activeForm === 'decline' ? (
            <View style={ph.actionForm}>
              <Text style={ph.formLabel}>DECLINE — REASON OPTIONAL</Text>
              <TextInput
                style={ph.formTextarea}
                placeholder="e.g. Sorry, Thursdays are rock only"
                placeholderTextColor="#aaaaaa"
                value={formText}
                onChangeText={setFormText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={ph.formBtns}>
                <TouchableOpacity style={ph.cancelFormBtn} onPress={() => toggleForm('decline')}>
                  <Text style={ph.cancelFormText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ph.submitFormBtn, { backgroundColor: '#ef4444' }]}
                  onPress={handleDecline}
                  disabled={submitting}
                >
                  <Text style={ph.submitFormText}>Send Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {activeForm === 'discuss' ? (
            <View style={ph.actionForm}>
              <Text style={ph.formLabel}>START DISCUSSION — MESSAGE REQUIRED</Text>
              <TextInput
                style={ph.formTextarea}
                placeholder="e.g. Can you tell us more about your draw in the area?"
                placeholderTextColor="#aaaaaa"
                value={formText}
                onChangeText={setFormText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={ph.formBtns}>
                <TouchableOpacity style={ph.cancelFormBtn} onPress={() => toggleForm('discuss')}>
                  <Text style={ph.cancelFormText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ph.submitFormBtn, { backgroundColor: formText.trim() ? '#f5a623' : '#cccccc' }]}
                  onPress={handleDiscuss}
                  disabled={!formText.trim() || submitting}
                >
                  <Text style={[ph.submitFormText, { color: formText.trim() ? '#111111' : '#888888' }]}>Start Discussion</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {activeForm === 'accept' ? (
            <View style={ph.actionForm}>
              <Text style={ph.formLabel}>ACCEPT — MESSAGE REQUIRED</Text>
              <TextInput
                style={ph.formTextarea}
                placeholder="e.g. Great, we'd love to have you. A few things to confirm..."
                placeholderTextColor="#aaaaaa"
                value={formText}
                onChangeText={setFormText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={{ gap: 8, marginBottom: 12 }}>
                {([
                  { value: 'pending', label: 'List as Pending', sub: 'slot reserved, not publicly booked yet' },
                  { value: 'booked',  label: 'List as Booked now', sub: 'band name appears on public timetable immediately' },
                ] as const).map(opt => (
                  <TouchableOpacity key={opt.value} style={ph.radioRow} onPress={() => setListingChoice(opt.value)}>
                    <View style={[ph.radioCircle, listingChoice === opt.value && ph.radioCircleActive]}>
                      {listingChoice === opt.value ? <View style={ph.radioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ph.radioLabel}><Text style={{ fontWeight: '700' }}>{opt.label}</Text> — <Text style={ph.radioSub}>{opt.sub}</Text></Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={ph.formBtns}>
                <TouchableOpacity style={ph.cancelFormBtn} onPress={() => toggleForm('accept')}>
                  <Text style={ph.cancelFormText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ph.submitFormBtn, { backgroundColor: formText.trim() ? '#00cc6a' : '#cccccc' }]}
                  onPress={handleAccept}
                  disabled={!formText.trim() || submitting}
                >
                  <Text style={[ph.submitFormText, { color: formText.trim() ? '#ffffff' : '#888888' }]}>Confirm Acceptance</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={ph.threeButtons}>
            {([
              { id: 'discuss', label: 'Discuss', activeColor: '#f5a623' },
              { id: 'decline', label: 'Decline', activeColor: '#ef4444' },
              { id: 'accept',  label: 'Accept',  activeColor: '#00cc6a' },
            ] as const).map((btn, i) => (
              <TouchableOpacity
                key={btn.id}
                style={[
                  ph.triggerBtn,
                  i < 2 && ph.triggerBtnBorder,
                  activeForm === btn.id && { backgroundColor: btn.activeColor },
                ]}
                onPress={() => toggleForm(btn.id)}
              >
                <Text style={[
                  ph.triggerText,
                  activeForm === btn.id && { color: btn.id === 'discuss' ? '#111111' : '#ffffff' },
                ]}>
                  {btn.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : !isVenue && enquiry.status === 'pending' ? (
        <View style={ph.cancelRow}>
          <TouchableOpacity onPress={async () => { await cancelEnquiry(enquiry.id); onBack(); }}>
            <Text style={ph.cancelText}>Cancel enquiry</Text>
          </TouchableOpacity>
        </View>
      ) : isVenue && enquiry.status === 'accepted' ? (
        <View>
          <View style={ph.timetableBar}>
            <Text style={ph.timetableLabel}>Timetable:</Text>
            <View style={[ph.timetablePill, enquiry.listAsBooked ? ph.timetablePillBooked : ph.timetablePillPending]}>
              <Text style={[ph.timetablePillText, enquiry.listAsBooked ? ph.timetablePillTextBooked : ph.timetablePillTextPending]}>
                {enquiry.listAsBooked ? 'Booked' : 'Pending'}
              </Text>
            </View>
            {!enquiry.listAsBooked ? (
              <TouchableOpacity
                style={ph.timetableActionBtn}
                onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, true); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={[ph.timetableActionText, { color: '#00cc6a' }]}>List as Booked</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={ph.timetableActionBtn}
                onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, false); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={[ph.timetableActionText, { color: '#f5a623' }]}>List as Pending</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[ph.timetableActionBtn, { marginLeft: 'auto' as any }]}
              onPress={async () => { setSubmitting(true); await cancelAcceptance(enquiry); setSubmitting(false); }}
              disabled={submitting}
            >
              <Text style={[ph.timetableActionText, { color: '#888888' }]}>Cancel Acceptance</Text>
            </TouchableOpacity>
          </View>
          <ChatInput />
        </View>
      ) : (
        <ChatInput />
      )}
    </KeyboardAvoidingView>
  );
}

const ph = StyleSheet.create({
  header:          { padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, borderBottomColor: '#e8e8e8', backgroundColor: '#fafafa', flexShrink: 0 },
  headerTop:       { flexDirection: 'row', alignItems: 'center' },
  back:            { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  name:            { fontSize: isWeb ? 18 : 16, fontWeight: '700', color: '#111111', letterSpacing: -0.3 },
  slot:            { fontSize: 13, color: '#666666', marginTop: 2 },
  viewProfileLink: { marginTop: 10 },
  viewProfileText: { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  msgList:         { padding: isWeb ? 24 : 16, gap: 16, flexGrow: 1 },
  noMsgs:          { alignItems: 'center', paddingTop: 12 },
  noMsgsText:      { fontSize: 14, color: '#aaaaaa' },
  msgRow:          { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  msgRowMine:      { justifyContent: 'flex-end' },
  msgRowTheirs:    {},
  msgCol:          { flexDirection: 'column', maxWidth: '65%' },
  msgColMine:      { alignItems: 'flex-end' },
  msgLabel:        { fontSize: 11, color: '#aaaaaa', marginBottom: 4 },
  msgLabelRight:   { textAlign: 'right' },
  bubble:          { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine:      { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs:    { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4 },
  bubbleText:      { fontSize: 14, color: '#111111', lineHeight: 21 },
  bubbleTextMine:  { color: '#111111' },
  msgTime:         { fontSize: 11, color: '#bbbbbb', marginTop: 4 },
  msgTimeRight:    { textAlign: 'right' },
  // Decline reason banner (in message list)
  bannerReason:    { backgroundColor: '#fef3cd', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#fcd34d', marginTop: 8 },
  bannerReasonLabel:{ fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 3 },
  bannerReasonText: { fontSize: 13, color: '#333333' },
  // Closed banner
  banner:          { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e8e8e8', backgroundColor: '#fafafa' },
  bannerText:      { fontSize: 14, color: '#aaaaaa', fontStyle: 'italic' },
  // Artist cancel
  cancelRow:       { alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  cancelText:      { fontSize: 13, color: '#ef4444' },
  // Venue pending action area
  actionArea:      { borderTopWidth: 1, borderTopColor: '#e8e8e8', backgroundColor: '#fafafa', flexShrink: 0 },
  actionForm:      { padding: isWeb ? 16 : 14, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  formLabel:       { fontSize: 11, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 8 },
  formTextarea:    { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, fontSize: 14, color: '#111111', backgroundColor: '#ffffff', minHeight: 80, marginBottom: 10 },
  formBtns:        { flexDirection: 'row', gap: 8 },
  cancelFormBtn:   { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8 },
  cancelFormText:  { fontSize: 13, color: '#888888' },
  submitFormBtn:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  submitFormText:  { fontSize: 13, fontWeight: '700' },
  threeButtons:    { flexDirection: 'row' },
  triggerBtn:      { flex: 1, paddingVertical: 14, alignItems: 'center', backgroundColor: 'transparent' },
  triggerBtnBorder:{ borderRightWidth: 1, borderRightColor: '#e8e8e8' },
  triggerText:     { fontSize: 13, fontWeight: '700', color: '#888888' },
  // Radio buttons (accept form)
  radioRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  radioCircle:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#cccccc', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  radioCircleActive:{ borderColor: '#00cc6a' },
  radioDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00cc6a' },
  radioLabel:      { fontSize: 13, color: '#333333', lineHeight: 18 },
  radioSub:        { fontSize: 12, color: '#888888' },
  // Timetable management bar (accepted)
  timetableBar:    { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, paddingVertical: 10, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1, borderTopColor: '#e8e8e8', backgroundColor: '#fafafa' },
  timetableLabel:  { fontSize: 13, color: '#888888' },
  timetablePill:   { borderRadius: 4, paddingHorizontal: 12, paddingVertical: 4 },
  timetablePillBooked:  { backgroundColor: '#00cc6a' },
  timetablePillPending: { backgroundColor: 'rgba(0,0,0,0.07)' },
  timetablePillText:      { fontSize: 12, fontWeight: '700' },
  timetablePillTextBooked:  { color: '#ffffff' },
  timetablePillTextPending: { color: '#555555' },
  timetableActionBtn:  { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 6 },
  timetableActionText: { fontSize: 12, fontWeight: '600' },
  // Chat input
  inputArea:       { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 14, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1, borderTopColor: '#e8e8e8', backgroundColor: isWeb ? '#fafafa' : Colors.bgFaint },
  input:           { flex: 1, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111111', backgroundColor: '#ffffff', maxHeight: 120 },
  sendBtn:         { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#e0e0e0' },
  sendText:        { fontWeight: '700', color: '#111111', fontSize: 14 },
  sendTextDisabled:{ color: '#aaaaaa' },
});

// ── Filter config ──────────────────────────────────────────────────────────

type FilterKey = 'all' | 'pending' | 'discussing' | 'accepted' | 'declined';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',        label: 'All'        },
  { key: 'pending',    label: 'Pending'    },
  { key: 'discussing', label: 'Discussing' },
  { key: 'accepted',   label: 'Accepted'   },
  { key: 'declined',   label: 'Declined'   },
];

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

  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [filter, setFilter]     = useState<FilterKey>('all');

  const sorted   = [...enquiries].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const filtered = filter === 'all' ? sorted : sorted.filter(e => e.status === filter);
  const title    = isVenue ? 'Inbox' : 'My Enquiries';

  // ── Not signed in ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <View style={[s.listHeader, { borderBottomColor: colors.border }]}>
          <Text style={[s.title, { color: colors.black }]}>{title}</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={s.emptyTitle}>Sign in to view your inbox</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.push('/login')}>
            <Text style={s.btnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Shared filter bar render ─────────────────────────────────────────────
  function FilterBar({ compact }: { compact?: boolean }) {
    return (
      <View style={[wb.filters, compact && { paddingVertical: 0 }]}>
        {FILTERS.map(f => {
          const count  = f.key === 'all' ? enquiries.length : enquiries.filter(e => e.status === f.key).length;
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
    );
  }

  // ── WEB: two-column layout ───────────────────────────────────────────────
  if (isWeb) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' as any }}>

        {/* Sidebar */}
        <View style={[wb.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
          <View style={[wb.sidebarHead, { borderBottomColor: colors.border }]}>
            <Text style={[wb.sidebarTitle, { color: colors.black }]}>{title}</Text>
            <FilterBar />
          </View>

          {loading ? (
            <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
          ) : filtered.length === 0 ? (
            <Text style={wb.emptyText}>
              {enquiries.length === 0 ? 'No enquiries yet' : 'No conversations'}
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
          )}
        </View>

        {/* Right panel */}
        <View style={[wb.panel, { backgroundColor: colors.bg }]}>
          {!selected ? (
            <View style={wb.panelEmpty}>
              <Text style={wb.panelEmptyText}>Select a conversation</Text>
            </View>
          ) : (
            <ThreadPanel enquiry={selected} isVenue={isVenue} onBack={() => setSelected(null)} />
          )}
        </View>

      </View>
    );
  }

  // ── NATIVE: thread open — full screen ───────────────────────────────────
  if (selected) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ThreadPanel enquiry={selected} isVenue={isVenue} onBack={() => setSelected(null)} />
      </SafeAreaView>
    );
  }

  // ── NATIVE: list ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={[s.listHeader, { borderBottomColor: colors.border }]}>
        <Text style={[s.title, { color: colors.black }]}>{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map(f => {
            const count  = f.key === 'all' ? enquiries.length : enquiries.filter(e => e.status === f.key).length;
            const active = filter === f.key;
            return (
              <TouchableOpacity key={f.key} style={[s.filterPill, active && s.filterPillActive]} onPress={() => setFilter(f.key)}>
                <Text style={[s.filterText, active && s.filterTextActive]}>
                  {f.label}{count > 0 ? ` (${count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>📭</Text>
          <Text style={s.emptyTitle}>{enquiries.length === 0 ? 'No enquiries yet' : 'No matches'}</Text>
          <Text style={s.emptySub}>
            {enquiries.length === 0
              ? (isVenue ? 'Enquiries from musicians will appear here' : 'Your enquiries to venues will appear here')
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
      )}
    </SafeAreaView>
  );
}

// ── Web styles ────────────────────────────────────────────────────────────

const wb = StyleSheet.create({
  sidebar:          { width: 320, borderRightWidth: 1, borderRightColor: '#e8e8e8', flexDirection: 'column', backgroundColor: '#fafafa' },
  sidebarHead:      { padding: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  sidebarTitle:     { fontSize: 18, fontWeight: '700', color: '#111111', letterSpacing: -0.3, marginBottom: 12 },
  filters:          { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  filterBtn:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: 'transparent' },
  filterBtnActive:  { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 12, fontWeight: '500', color: '#666666' },
  filterTextActive: { color: '#111111' },
  filterCount:      { backgroundColor: 'rgba(128,128,128,0.15)', borderRadius: 10, paddingHorizontal: 6 },
  filterCountActive:{ backgroundColor: 'rgba(0,0,0,0.2)' },
  filterCountText:  { fontSize: 11, fontWeight: '600', color: '#666666' },
  filterCountTextActive: { color: '#111111' },
  emptyText:        { textAlign: 'center', color: '#999999', fontSize: 14, padding: 40 },
  panel:            { flex: 1, flexDirection: 'column', backgroundColor: '#ffffff' },
  panelEmpty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panelEmptyText:   { fontSize: 15, color: '#aaaaaa' },
});

// ── Native styles ─────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.bg },
  listHeader: { padding: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title:      { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.black, marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 14, color: Colors.grey, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn:        { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:    { fontSize: 15, fontWeight: '700', color: Colors.black },
  filterPill:       { borderRadius: 20, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Colors.bg },
  filterPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 13, color: Colors.grey, fontWeight: '600' },
  filterTextActive: { color: Colors.black },
});
