import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages,
  updateEnquiryStatus, sendMessage, cancelEnquiry,
  type Enquiry, type Message,
} from '@/lib/useEnquiries';

// ── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Enquiry['status'] }) {
  const map: Record<Enquiry['status'], { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',   color: '#b45309', bg: '#fef3c7' },
    accepted:  { label: 'Accepted',  color: '#166534', bg: '#dcfce7' },
    declined:  { label: 'Declined',  color: '#991b1b', bg: '#fee2e2' },
    cancelled: { label: 'Cancelled', color: Colors.grey, bg: Colors.bgFaint },
  };
  const s = map[status] ?? map.pending;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: s.color }}>{s.label}</Text>
    </View>
  );
}

// ── Enquiry list item ────────────────────────────────────────────────────────
function EnquiryCard({
  item, isVenue, onPress,
}: { item: Enquiry; isVenue: boolean; onPress: () => void }) {
  const { day, time, room, slotType } = item.requestedSlot;
  const who = isVenue ? item.bandName : item.venueName;
  const sub  = `${day} · ${time}${room ? ` · ${room}` : ''} · ${slotType}`;
  const dateStr = item.submittedAt
    ? new Date(item.submittedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    : '';

  return (
    <TouchableOpacity style={eStyles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={eStyles.cardTop}>
        <Text style={eStyles.who} numberOfLines={1}>{who}</Text>
        <Text style={eStyles.date}>{dateStr}</Text>
      </View>
      <Text style={eStyles.sub} numberOfLines={1}>{sub}</Text>
      <View style={{ marginTop: 8 }}>
        <StatusBadge status={item.status} />
      </View>
    </TouchableOpacity>
  );
}

const eStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  who:  { fontSize: 15, fontWeight: '700', color: Colors.black, flex: 1, marginRight: 8 },
  date: { fontSize: 12, color: Colors.grey },
  sub:  { fontSize: 13, color: Colors.grey },
});

// ── Thread view ──────────────────────────────────────────────────────────────
function ThreadView({
  enquiry,
  isVenue,
  onBack,
}: { enquiry: Enquiry; isVenue: boolean; onBack: () => void }) {
  const { user } = useAuth();
  const messages = useMessages(enquiry.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  async function handleSend() {
    if (!text.trim() || !user) return;
    setSending(true);
    await sendMessage(enquiry.id, user.uid, text.trim());
    setText('');
    setSending(false);
  }

  async function handleAccept() {
    await updateEnquiryStatus(enquiry.id, 'accepted');
  }

  async function handleDecline() {
    setDeclining(true);
    await updateEnquiryStatus(enquiry.id, 'declined');
    setDeclining(false);
  }

  async function handleCancel() {
    await cancelEnquiry(enquiry.id);
    onBack();
  }

  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Thread header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.bg }}>
        <View style={tStyles.header}>
          <TouchableOpacity onPress={onBack} style={{ width: 64 }}>
            <Text style={tStyles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={tStyles.headerTitle} numberOfLines={1}>
            {isVenue ? enquiry.bandName : enquiry.venueName}
          </Text>
          <View style={{ width: 64 }} />
        </View>

        {/* Slot summary strip */}
        <View style={tStyles.slotStrip}>
          <Text style={tStyles.slotText}>
            {day}{date ? ` · ${date}` : ''} · {time}{room ? ` · ${room}` : ''} · {slotType} · {setLength}
          </Text>
          <StatusBadge status={enquiry.status} />
        </View>
      </SafeAreaView>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={tStyles.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 && (
          <View style={tStyles.noMsgs}>
            <Text style={tStyles.noMsgsText}>No messages yet. Say hello!</Text>
          </View>
        )}
        {messages.map(m => {
          const mine = m.sender === user?.uid;
          return (
            <View key={m.id} style={[tStyles.bubble, mine ? tStyles.bubbleMe : tStyles.bubbleThem]}>
              <Text style={[tStyles.bubbleText, mine && tStyles.bubbleTextMe]}>{m.text}</Text>
              <Text style={[tStyles.bubbleTime, mine && { color: Colors.orange + 'bb' }]}>
                {new Date(m.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Venue actions */}
      {isVenue && enquiry.status === 'pending' && (
        <View style={tStyles.actionRow}>
          <TouchableOpacity
            style={[tStyles.actionBtn, tStyles.acceptBtn]}
            onPress={handleAccept}
          >
            <Text style={tStyles.acceptText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[tStyles.actionBtn, tStyles.declineBtn]}
            onPress={handleDecline}
            disabled={declining}
          >
            <Text style={tStyles.declineText}>Decline</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Artist cancel button */}
      {!isVenue && enquiry.status === 'pending' && (
        <View style={tStyles.cancelRow}>
          <TouchableOpacity onPress={handleCancel}>
            <Text style={tStyles.cancelText}>Cancel enquiry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Compose */}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: Colors.bg }}>
        <View style={tStyles.compose}>
          <TextInput
            style={tStyles.input}
            placeholder="Message..."
            placeholderTextColor={Colors.greyLight}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[tStyles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator color={Colors.black} size="small" />
              : <Text style={tStyles.sendText}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const tStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  back:        { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.black, flex: 1, textAlign: 'center' },
  slotStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.bgFaint,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexWrap: 'wrap',
    gap: 8,
  },
  slotText: { fontSize: 12, color: Colors.grey, flex: 1, marginRight: 8 },
  msgList: { padding: 16, gap: 8, flexGrow: 1 },
  noMsgs: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  noMsgsText: { fontSize: 14, color: Colors.greyLight },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.orange,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgFaint,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleText:   { fontSize: 14, color: Colors.black },
  bubbleTextMe: { color: Colors.black },
  bubbleTime:   { fontSize: 10, color: Colors.grey, alignSelf: 'flex-end' },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  acceptBtn: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#166534' + '44' },
  declineBtn:{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#991b1b' + '44' },
  acceptText: { fontWeight: '700', color: '#166534', fontSize: 14 },
  declineText:{ fontWeight: '700', color: '#991b1b', fontSize: 14 },
  cancelRow: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderFaint,
  },
  cancelText: { fontSize: 13, color: Colors.danger },
  compose: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.black,
    backgroundColor: Colors.bgFaint,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontWeight: '700', color: Colors.black, fontSize: 14 },
});

type FilterKey = 'all' | 'pending' | 'accepted' | 'declined';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
];

// ── Main inbox screen ────────────────────────────────────────────────────────
export default function InboxScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const isVenue  = profile?.type === 'venue';
  const venueId  = profile?.venueId ?? null;

  const artistData = useArtistEnquiries(!isVenue ? (user?.uid ?? null) : null);
  const venueData  = useVenueEnquiries(isVenue ? venueId : null);

  const { enquiries, loading } = isVenue ? venueData : artistData;
  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [filter, setFilter]     = useState<FilterKey>('all');

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.listHeader}>
          <Text style={styles.title}>Inbox</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>Sign in to view your inbox</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.push('/login')}>
            <Text style={styles.btnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Thread open ────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <ThreadView
        enquiry={selected}
        isVenue={isVenue}
        onBack={() => setSelected(null)}
      />
    );
  }

  const sorted = [...enquiries].sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
  const filtered = filter === 'all' ? sorted : sorted.filter(e => e.status === filter);

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.listHeader}>
        <Text style={styles.title}>My Enquiries</Text>
        {/* Filter pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTERS.map(f => {
            const count = f.key === 'all' ? enquiries.length
              : enquiries.filter(e => e.status === f.key).length;
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterPill, active && styles.filterPillActive]}
                onPress={() => setFilter(f.key)}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {f.label}{count > 0 ? ` (${count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.orange} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>
            {enquiries.length === 0 ? 'No enquiries yet' : 'No matches'}
          </Text>
          <Text style={styles.emptySub}>
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
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <EnquiryCard
              item={item}
              isVenue={isVenue}
              onPress={() => setSelected(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.bg },
  listHeader: {
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.black,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.grey,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: Colors.orange,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  btnText: { fontSize: 15, fontWeight: '700', color: Colors.black },
  filterPill: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.bg,
  } as ViewStyle,
  filterPillActive: {
    backgroundColor: Colors.orange,
    borderColor: Colors.orange,
  } as ViewStyle,
  filterText:       { fontSize: 13, color: Colors.grey, fontWeight: '600' },
  filterTextActive: { color: Colors.black },
});
