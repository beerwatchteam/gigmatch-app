/**
 * Direct message thread screen.
 * id = other user's UID.
 * Used from native inbox Messages tab + musician card Message button.
 */
import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image,
  KeyboardAvoidingView, Platform, Animated, Modal, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  mkDMId, useDMConv, useDMMessages,
  startDM, sendDMMessage, acceptDMRequest, deleteDMConv,
} from '@/lib/useDirectMessages';
import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const isWeb = Platform.OS === 'web';

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return (name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
}

function Avatar({ photoUrl, name, size }: { photoUrl?: string | null; name: string; size: number }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e8e8e8' }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#999999' }}>{getInitials(name)}</Text>
    </View>
  );
}

function fmtMsgTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function getDateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router  = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const { id: otherUid, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const myUid  = user?.uid ?? '';
  const [myName,  setMyName]  = useState<string>(profile?.displayName || user?.email || 'Me');
  const [myPhoto, setMyPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !profile) return;
    if (profile.type === 'artist') {
      getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
        if (snap.exists()) {
          const bp = snap.data();
          if (bp.name) setMyName(bp.name);
          setMyPhoto(bp.photoUrl ?? null);
        }
      }).catch(() => {});
    } else if (profile.type === 'venue') {
      (async () => {
        let snap: any = null;
        if (profile.venueId) {
          snap = await getDoc(doc(db, 'venues', profile.venueId));
        }
        if (!snap || !snap.exists()) {
          const q = query(collection(db, 'venues'), where('claimedBy', '==', user!.uid), limit(1));
          const result = await getDocs(q);
          if (!result.empty) snap = result.docs[0];
        }
        if (snap && snap.exists()) {
          const vd = snap.data();
          if (vd.name || vd.venueName) setMyName(vd.name || vd.venueName);
          setMyPhoto(vd.photoUrl ?? null);
        }
      })().catch(() => {});
    }
  }, [user?.uid, profile?.type, profile?.venueId]);

  const convId  = myUid && otherUid ? mkDMId(myUid, otherUid) : null;
  const conv    = useDMConv(convId);
  const messages = useDMMessages(convId);

  // Fetch the other user's real display name + photo from their profile
  const [otherDisplayName,  setOtherDisplayName]  = useState<string | null>(null);
  const [otherDisplayPhoto, setOtherDisplayPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!otherUid) return;
    let cancelled = false;
    getDoc(doc(db, 'users', otherUid)).then(async uSnap => {
      if (cancelled || !uSnap.exists()) return;
      const ud = uSnap.data();
      let name: string | null = ud.displayName || null;
      let photo: string | null = null;
      if (ud.type === 'artist') {
        const bp = await getDoc(doc(db, 'bandProfiles', otherUid));
        if (!cancelled && bp.exists()) {
          name  = bp.data().name || name;
          photo = bp.data().photoUrl ?? null;
        }
      } else if (ud.type === 'venue') {
        let vn: any = null;
        if (ud.venueId) {
          vn = await getDoc(doc(db, 'venues', ud.venueId));
        }
        if (!vn || !vn.exists()) {
          const q = query(collection(db, 'venues'), where('claimedBy', '==', otherUid), limit(1));
          const result = await getDocs(q);
          if (!result.empty) vn = result.docs[0];
        }
        if (!cancelled && vn && vn.exists()) {
          name  = vn.data().name || vn.data().venueName || name;
          photo = vn.data().photoUrl ?? null;
        }
      }
      if (!cancelled) { setOtherDisplayName(name); setOtherDisplayPhoto(photo); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [otherUid]);

  const otherName  = otherDisplayName ?? conv?.participantNames?.[otherUid] ?? nameParam ?? 'User';
  const otherPhoto = otherDisplayPhoto ?? conv?.participantPhotos?.[otherUid] ?? null;

  const isAccepted    = conv ? conv.acceptedBy.includes(myUid) : false;
  const isInitiator   = conv?.initiatedBy === myUid;
  const otherAccepted = conv ? conv.acceptedBy.includes(otherUid) : false;
  const isNew         = !conv;
  const canSend       = isNew || (isAccepted && (isInitiator ? otherAccepted : true));

  const [text, setText]           = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Details panel
  const [detailsOpen, setDetailsOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const DRAWER_W  = isWeb ? 340 : windowWidth;

  function openDetails() {
    setDetailsOpen(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }
  function closeDetails(onClosed?: () => void) {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start(() => {
      setDetailsOpen(false);
      onClosed?.();
    });
  }

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
  }, [messages.length]);

  // Build sender groups (same sender within 1 hour = one group)
  type MsgGroup = { senderId: string; msgs: typeof messages; startMs: number; endMs: number };
  const msgGroups: MsgGroup[] = [];
  for (const msg of messages) {
    const last = msgGroups[msgGroups.length - 1];
    const ms = new Date(msg.createdAt).getTime();
    if (last && last.senderId === msg.senderId && ms - last.endMs < 3600000) {
      last.msgs.push(msg);
      last.endMs = ms;
    } else {
      msgGroups.push({ senderId: msg.senderId, msgs: [msg], startMs: ms, endMs: ms });
    }
  }

  function handleSend() {
    const msg = text.trim();
    if (!msg || !myUid || !otherUid) return;
    setText('');
    if (isNew) {
      startDM(myUid, myName, myPhoto, otherUid, otherName, otherPhoto, msg).catch(console.error);
    } else {
      sendDMMessage(convId!, myUid, msg).catch(console.error);
    }
  }

  async function handleAccept() {
    if (!convId) return;
    await acceptDMRequest(convId, myUid);
  }

  async function handleDelete() {
    if (convId) await deleteDMConv(convId, myUid);
    router.back();
  }

  if (!user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
        <Text style={{ padding: 20, color: colors.grey }}>Sign in to send messages.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerSide}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={[s.headerName, { color: colors.black }]} numberOfLines={1}>{otherName}</Text>
        <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
          <TouchableOpacity onPress={openDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <View style={s.detailsBtnInner}>
              <View style={s.detailsCircle}>
                <Text style={s.detailsCircleText}>i</Text>
              </View>
              <Text style={[s.detailsLink, { color: colors.black }]}>Details</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={s.msgList}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 && (
            <View style={s.emptyWrap}>
              <Text style={s.emptyText}>
                {isNew ? 'Send a message to start the conversation.' : 'No messages yet.'}
              </Text>
            </View>
          )}

          {msgGroups.map((group, gi) => {
            const prevGroup = msgGroups[gi - 1];
            const showDateSep = !prevGroup ||
              new Date(group.msgs[0].createdAt).toDateString() !==
              new Date(prevGroup.msgs[0].createdAt).toDateString();

            return [
              showDateSep && (
                <View key={`sep-${gi}`} style={s.dateSepRow}>
                  <Text style={s.dateSepText}>{getDateLabel(group.msgs[0].createdAt)}</Text>
                </View>
              ),
              ...group.msgs.map((msg, i) => {
                const isMine  = msg.senderId === myUid;
                const isLast  = i === group.msgs.length - 1;
                const showTime = isLast;
                return (
                  <View
                    key={msg.id}
                    style={[s.msgRow, isMine ? s.rowMine : s.rowTheirs, i > 0 && { marginTop: 2 }]}
                  >
                    {!isMine && (
                      isLast
                        ? <Avatar photoUrl={otherPhoto} name={otherName} size={28} />
                        : <View style={{ width: 28 }} />
                    )}
                    <View style={[s.msgCol, isMine && s.msgColMine]}>
                      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
                        <Text style={[s.bubbleText, isMine && s.bubbleTextMine]}>{msg.text}</Text>
                      </View>
                      {showTime && (
                        <Text style={[s.msgTime, isMine && s.msgTimeRight]}>{fmtMsgTime(msg.createdAt)}</Text>
                      )}
                    </View>
                  </View>
                );
              }),
            ];
          })}
        </ScrollView>

        {/* Accept banner */}
        {conv && !isAccepted && !isInitiator && (
          <View style={[s.banner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <Text style={[s.bannerText, { color: colors.grey }]}>
              {otherName} sent you a message request.
            </Text>
            <TouchableOpacity style={s.acceptBtn} onPress={handleAccept}>
              <Text style={s.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Waiting banner */}
        {conv && isInitiator && !otherAccepted && (
          <View style={[s.banner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <Text style={[s.bannerText, { color: colors.grey }]}>
              Waiting for {otherName} to accept your message request.
            </Text>
          </View>
        )}

        {/* Text input */}
        {canSend && (
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
            <View style={[s.inputArea, { backgroundColor: colors.bgFaint, borderTopColor: colors.border }]}>
              <TextInput
                style={[s.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
                placeholder="Type a message..."
                placeholderTextColor={colors.greyLight}
                value={text}
                onChangeText={setText}
                multiline
              />
              <TouchableOpacity
                style={[s.sendBtn, !text.trim() && s.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!text.trim()}
              >
                <Text style={[s.sendText, !text.trim() && s.sendTextDisabled]}>Send</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>

      {/* Details panel */}
      <Modal visible={detailsOpen} transparent animationType="none" onRequestClose={() => closeDetails()}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <TouchableOpacity style={s.drawerBackdrop} activeOpacity={1} onPress={() => closeDetails()} />
          <Animated.View style={[
            s.drawerPanel,
            { width: DRAWER_W, backgroundColor: colors.bg },
            { transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [DRAWER_W, 0] }) }] },
          ]}>
            <View style={[s.drawerHeader, { borderBottomColor: colors.border, paddingTop: (isWeb ? 0 : insets.top) + 16 }]}>
              <TouchableOpacity onPress={() => closeDetails()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 60 }}>
                <Text style={[s.drawerBack, { color: Colors.orange }]}>← Back</Text>
              </TouchableOpacity>
              <Text style={[s.drawerTitle, { color: colors.black }]}>Details</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView contentContainerStyle={[s.drawerContent, { alignItems: 'center', paddingTop: 32 }]} showsVerticalScrollIndicator={false}>
              <Avatar photoUrl={otherPhoto} name={otherName} size={72} />
              <Text style={[s.drawerPersonName, { color: colors.black }]}>{otherName}</Text>
              <TouchableOpacity
                style={s.deleteBtn}
                onPress={() => closeDetails(() => setConfirmOpen(true))}
                activeOpacity={0.7}
              >
                <Text style={s.deleteBtnText}>Delete this conversation</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Confirm delete */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
          <View style={[s.confirm, { backgroundColor: colors.bg }]}>
            <Text style={[s.confirmTitle, { color: colors.black }]}>Delete conversation?</Text>
            <Text style={[s.confirmBody, { color: colors.grey }]}>This will remove it from your inbox. This cannot be undone.</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={[s.confirmBtn, { borderColor: colors.border }]} onPress={() => setConfirmOpen(false)}>
                <Text style={[s.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtnDanger} onPress={() => { setConfirmOpen(false); handleDelete(); }}>
                <Text style={s.confirmBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:              { flex: 1 },
  header:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 8 },
  headerSide:        { minWidth: 60 },
  back:              { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  headerName:        { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  detailsBtnInner:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailsCircle:     { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  detailsCircleText: { fontSize: 11, fontWeight: '800', color: '#111111', lineHeight: 13 },
  detailsLink:       { fontSize: 13, fontWeight: '600' },
  msgList:           { padding: isWeb ? 24 : 16, gap: 3, flexGrow: 1 },
  emptyWrap:         { alignItems: 'center', paddingTop: 60 },
  emptyText:         { fontSize: 14, color: '#aaaaaa', textAlign: 'center', lineHeight: 20 },
  dateSepRow:        { alignItems: 'center', marginVertical: 12 },
  dateSepText:       { fontSize: 11, fontWeight: '600', color: '#aaaaaa', letterSpacing: 0.3 },
  msgRow:            { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:           { justifyContent: 'flex-end' },
  rowTheirs:         { justifyContent: 'flex-start' },
  msgCol:            { maxWidth: '72%' },
  msgColMine:        { alignItems: 'flex-end' },
  bubble:            { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine:        { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs:      { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4 },
  bubbleText:        { fontSize: 14, color: '#111111', lineHeight: 21 },
  bubbleTextMine:    { color: '#111111' },
  msgTime:           { fontSize: 11, color: '#aaaaaa', marginTop: 3 },
  msgTimeRight:      { textAlign: 'right' },
  banner:            { padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1, alignItems: 'center', gap: 12 },
  bannerText:        { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  acceptBtn:         { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  acceptBtnText:     { fontSize: 14, fontWeight: '700', color: '#111111' },
  inputArea:         { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 14, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1 },
  input:             { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 120 },
  sendBtn:           { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:   { backgroundColor: '#e0e0e0' },
  sendText:          { fontWeight: '700', color: '#111111', fontSize: 14 },
  sendTextDisabled:  { color: '#aaaaaa' },
  drawerBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawerPanel:       { position: 'absolute' as any, top: 0, right: 0, bottom: 0, borderLeftWidth: 1, borderLeftColor: '#e8e8e8', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: -4, height: 0 }, elevation: 12 },
  drawerHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  drawerBack:        { fontSize: 14, fontWeight: '700' },
  drawerTitle:       { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, flex: 1, textAlign: 'center' },
  drawerContent:     { padding: 20, paddingBottom: 40 },
  drawerPersonName:  { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 14, textAlign: 'center' },
  deleteBtn:         { marginTop: 40, width: '100%' as any, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', backgroundColor: 'rgba(220,38,38,0.04)' },
  deleteBtnText:     { fontSize: 14, fontWeight: '700', color: '#dc2626' },
  overlay:           { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' },
  confirm:           { marginHorizontal: 32, borderRadius: 16, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  confirmTitle:      { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  confirmBody:       { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  confirmBtn:        { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmBtnText:    { fontSize: 15, fontWeight: '600' },
  confirmBtnDanger:  { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center' },
  confirmBtnDangerText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
});
