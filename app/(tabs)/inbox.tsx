import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages,
  updateEnquiryStatus, sendMessage, cancelEnquiry,
  bookSlotOnTimetable, cancelAcceptance,
  type Enquiry,
} from '@/lib/useEnquiries';

const isWeb = Platform.OS === 'web';

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

function formatDate(iso: string): string {
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

// ── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <View style={[av.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[av.text, { fontSize: size * 0.3 }]}>{getInitials(name)}</Text>
    </View>
  );
}
const av = StyleSheet.create({
  circle: { backgroundColor: 'rgba(250,131,12,0.12)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text:   { color: Colors.orange, fontWeight: '700', letterSpacing: 0.3 },
});

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'Pending',    color: '#888888', bg: 'rgba(0,0,0,0.06)'     },
  discussing: { label: 'Discussing', color: '#f5a623', bg: 'rgba(245,166,35,0.1)' },
  accepted:   { label: 'Accepted',   color: '#fa830c', bg: 'rgba(250,131,12,0.1)' },
  declined:   { label: 'Declined',   color: '#999999', bg: 'rgba(0,0,0,0.05)'     },
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

// ── Enquiry card (shown first in thread, from band's perspective) ───────────

function EnquiryCard({ enquiry }: { enquiry: Enquiry }) {
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const slotStr = [day, date, time, room, slotType, setLength].filter(Boolean).join(' · ');
  const genres: string[] = enquiry.genre ?? [];

  return (
    <View style={ec.wrap}>
      <Text style={ec.label}>{enquiry.bandName} · Enquiry sent {formatDate(enquiry.submittedAt)}</Text>
      <View style={ec.card}>
        {/* Identity row */}
        <View style={ec.identityRow}>
          <Text style={ec.bandName}>{enquiry.bandName}</Text>
          {enquiry.artistType ? (
            <View style={ec.typePill}>
              <Text style={ec.typeText}>{enquiry.artistType}</Text>
            </View>
          ) : null}
        </View>
        {genres.length > 0 ? (
          <View style={ec.genreRow}>
            {genres.map(g => (
              <View key={g} style={ec.genrePill}>
                <Text style={ec.genreText}>{g}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {enquiry.location ? <Text style={ec.location}>📍 {enquiry.location}</Text> : null}

        {/* Slot row */}
        <View style={ec.section}>
          <Text style={ec.sectionLabel}>SLOT REQUEST</Text>
          <Text style={ec.sectionBody}>{slotStr}</Text>
        </View>
        {enquiry.additionalInfo ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>ADDITIONAL INFO</Text>
            <Text style={ec.sectionBody}>{enquiry.additionalInfo}</Text>
          </View>
        ) : null}
        {enquiry.about ? (
          <View style={ec.section}>
            <Text style={ec.sectionLabel}>ABOUT</Text>
            <Text style={ec.sectionBody}>{enquiry.about}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ec = StyleSheet.create({
  wrap:        { alignItems: 'flex-start', marginBottom: 4 },
  label:       { fontSize: 11, color: '#aaaaaa', marginBottom: 4 },
  card:        { backgroundColor: '#f0f0f0', borderRadius: 12, borderBottomLeftRadius: 2, padding: 14, maxWidth: isWeb ? '70%' : '85%' },
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

// ── Thread tile ────────────────────────────────────────────────────────────

function ThreadTile({ item, isVenue, isSelected, onPress }: {
  item: Enquiry; isVenue: boolean; isSelected: boolean; onPress: () => void;
}) {
  const who = isVenue ? item.bandName : item.venueName;
  const { day, time, room } = item.requestedSlot;
  const slotStr = `${day} · ${time}${room ? ` · ${room}` : ''}`;
  const preview = item.additionalInfo?.trim() || null;
  const dateStr = formatDate(item.submittedAt);

  return (
    <TouchableOpacity
      style={[tt.tile, isSelected && tt.tileActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Avatar name={who} size={38} />
      <View style={tt.info}>
        <View style={tt.row1}>
          <Text style={tt.name} numberOfLines={1}>{who}</Text>
          <Text style={tt.time}>{dateStr}</Text>
        </View>
        <View style={tt.row2}>
          <Text style={tt.slot} numberOfLines={1}>{slotStr}</Text>
          <StatusBadge status={item.status} />
        </View>
        {preview ? <Text style={tt.preview} numberOfLines={1}>{preview}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const tt = StyleSheet.create({
  tile:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa' },
  tileActive: { backgroundColor: '#fff4e8', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  info:       { flex: 1, minWidth: 0, gap: 3 },
  row1:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row2:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name:       { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:       { fontSize: 11, color: '#aaaaaa', flexShrink: 0 },
  slot:       { fontSize: 12, color: '#666666', flex: 1 },
  preview:    { fontSize: 12, color: '#999999' },
});

// ── Thread panel (conversation) ────────────────────────────────────────────

function ThreadPanel({ enquiry, isVenue, onBack }: {
  enquiry: Enquiry; isVenue: boolean; onBack: () => void;
}) {
  const { user } = useAuth();
  const messages = useMessages(enquiry.id);
  const [chatText,      setChatText]      = useState('');
  const [formText,      setFormText]      = useState('');
  const [activeForm,    setActiveForm]    = useState<null | 'discuss' | 'decline' | 'accept'>(null);
  const [listingChoice, setListingChoice] = useState<'pending' | 'booked'>('pending');
  const [submitting,    setSubmitting]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const slotDesc = [day, date, time, room, slotType, setLength].filter(Boolean).join(' · ');

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

  // ── Chat input (shared by discussing / accepted / artist) ────────────────
  function ChatInput() {
    return (
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: isWeb ? '#fafafa' : Colors.bgFaint }}>
        <View style={ph.inputArea}>
          <TextInput
            style={ph.input}
            placeholder="Type a message…"
            placeholderTextColor="#aaaaaa"
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
      style={{ flex: 1, backgroundColor: isWeb ? '#ffffff' : Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={ph.header}>
        {!isWeb && (
          <TouchableOpacity onPress={onBack} style={{ marginRight: 12 }}>
            <Text style={ph.back}>← Back</Text>
          </TouchableOpacity>
        )}
        <Avatar name={who} size={44} />
        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text style={ph.name} numberOfLines={1}>{who}</Text>
          <Text style={ph.slot} numberOfLines={1}>{slotDesc}</Text>
        </View>
        <StatusBadge status={enquiry.status} />
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={ph.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {/* Enquiry card always first */}
        <EnquiryCard enquiry={enquiry} />

        {messages.length === 0 && (
          <View style={ph.noMsgs}>
            <Text style={ph.noMsgsText}>
              {enquiry.status === 'pending' ? 'Respond to this enquiry below' : 'No messages yet'}
            </Text>
          </View>
        )}

        {messages.map(m => {
          const mine = m.sender === user?.uid;
          return (
            <View key={m.id} style={[ph.msgRow, mine ? ph.msgRowMine : ph.msgRowTheirs]}>
              {!mine ? <Avatar name={who} size={30} /> : null}
              <View style={[ph.msgCol, mine && ph.msgColMine]}>
                <Text style={ph.msgLabel}>{mine ? 'You' : who}</Text>
                <View style={[ph.bubble, mine ? ph.bubbleMine : ph.bubbleTheirs]}>
                  <Text style={ph.bubbleText}>{m.text}</Text>
                </View>
                <Text style={ph.msgTime}>
                  {new Date(m.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* ── Bottom action area ── */}

      {/* Closed */}
      {isClosed ? (
        <View style={ph.banner}>
          <Text style={ph.bannerText}>Enquiry {enquiry.status}.</Text>
        </View>
      ) : isVenue && enquiry.status === 'pending' ? (
        // Venue pending — inline forms + three buttons
        <View style={ph.actionArea}>
          {/* Inline form */}
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
              {/* Listing choice */}
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

          {/* Three trigger buttons */}
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
        // Artist pending — cancel link + no chat
        <View style={ph.cancelRow}>
          <TouchableOpacity onPress={async () => { await cancelEnquiry(enquiry.id); onBack(); }}>
            <Text style={ph.cancelText}>Cancel enquiry</Text>
          </TouchableOpacity>
        </View>
      ) : isVenue && enquiry.status === 'accepted' ? (
        // Venue accepted — timetable management bar + chat
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
        // Discussing / artist accepted — chat input
        <ChatInput />
      )}
    </KeyboardAvoidingView>
  );
}

const ph = StyleSheet.create({
  header:          { flexDirection: 'row', alignItems: 'center', padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, borderBottomColor: '#e8e8e8', backgroundColor: '#fafafa', flexShrink: 0 },
  back:            { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  name:            { fontSize: isWeb ? 18 : 16, fontWeight: '700', color: '#111111', letterSpacing: -0.3 },
  slot:            { fontSize: 13, color: '#666666', marginTop: 2 },
  msgList:         { padding: isWeb ? 24 : 16, gap: 16, flexGrow: 1 },
  noMsgs:          { alignItems: 'center', paddingTop: 12 },
  noMsgsText:      { fontSize: 14, color: '#aaaaaa' },
  msgRow:          { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  msgRowMine:      { flexDirection: 'row-reverse' as const },
  msgRowTheirs:    {},
  msgCol:          { flexDirection: 'column', maxWidth: '65%' },
  msgColMine:      { alignItems: 'flex-end' },
  msgLabel:        { fontSize: 11, color: '#aaaaaa', marginBottom: 4 },
  bubble:          { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine:      { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs:    { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4 },
  bubbleText:      { fontSize: 14, color: '#111111', lineHeight: 21 },
  msgTime:         { fontSize: 11, color: '#bbbbbb', marginTop: 4 },
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
  triggerTextActive:{ color: '#ffffff' },
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
      <SafeAreaView style={s.safe}>
        <View style={s.listHeader}>
          <Text style={s.title}>{title}</Text>
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
        <View style={wb.sidebar}>
          <View style={wb.sidebarHead}>
            <Text style={wb.sidebarTitle}>{title}</Text>
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
        <View style={wb.panel}>
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
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <ThreadPanel enquiry={selected} isVenue={isVenue} onBack={() => setSelected(null)} />
      </SafeAreaView>
    );
  }

  // ── NATIVE: list ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.listHeader}>
        <Text style={s.title}>{title}</Text>
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
