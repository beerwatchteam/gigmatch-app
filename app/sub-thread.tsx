/**
 * 1:1 sub-thread screen.
 * Always scoped to a gig — shows "Re: {venue name} · {date}" context line.
 *
 * Params (via useLocalSearchParams):
 *   enquiryId   — the parent gig/enquiry
 *   otherUid    — the other participant's user ID
 *   otherName   — display name of the other participant
 *   venueName   — venue name for context line
 *   gigDate     — formatted gig date for context line (optional)
 */
import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  useSubThread,
  useSubThreadMessages,
  getOrCreateSubThread,
  sendSubThreadMessage,
} from '@/lib/useSubThreads';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const isWeb = Platform.OS === 'web';

function fmtTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function getInitials(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

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

export default function SubThreadScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const {
    enquiryId,
    otherUid,
    otherName: otherNameParam,
    venueName,
    gigDate,
  } = useLocalSearchParams<{
    enquiryId: string;
    otherUid: string;
    otherName?: string;
    venueName?: string;
    gigDate?: string;
  }>();

  const myUid = user?.uid ?? '';

  const [myPhoto,    setMyPhoto]    = useState<string | null>(null);
  const [otherPhoto, setOtherPhoto] = useState<string | null>(null);
  const [subThreadId, setSubThreadId] = useState<string | null>(null);
  const [text,       setText]       = useState('');
  const [sending,    setSending]    = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Resolve own photo
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

  // Resolve other participant's photo
  useEffect(() => {
    if (!otherUid) return;
    getDoc(doc(db, 'users', otherUid)).then(async userSnap => {
      if (!userSnap.exists()) return;
      const userData = userSnap.data();
      if (userData.type === 'artist') {
        const bp = await getDoc(doc(db, 'bandProfiles', otherUid));
        if (bp.exists()) setOtherPhoto(bp.data().photoUrl ?? null);
      } else if (userData.type === 'venue' && userData.venueId) {
        const v = await getDoc(doc(db, 'venues', userData.venueId));
        if (v.exists()) setOtherPhoto(v.data().photoUrl ?? null);
      }
    }).catch(() => {});
  }, [otherUid]);

  // Ensure sub-thread exists
  useEffect(() => {
    if (!enquiryId || !myUid || !otherUid) return;
    getOrCreateSubThread(enquiryId, myUid, otherUid).then(setSubThreadId).catch(console.error);
  }, [enquiryId, myUid, otherUid]);

  const messages = useSubThreadMessages(enquiryId ?? null, subThreadId);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  const otherName = otherNameParam ?? 'User';
  const contextLine = [venueName, gigDate].filter(Boolean).join(' · ');

  async function handleSend() {
    const msg = text.trim();
    if (!msg || !myUid || !enquiryId || !subThreadId) return;
    setSending(true);
    setText('');
    try {
      await sendSubThreadMessage(enquiryId, subThreadId, myUid, msg);
    } catch (e) {
      console.error(e);
    }
    setSending(false);
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
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <View style={s.headerAvatar}>
          <Avatar photoUrl={otherPhoto} name={otherName} size={34} />
        </View>
        <View style={s.headerInfo}>
          <Text style={[s.headerName, { color: colors.black }]} numberOfLines={1}>{otherName}</Text>
          {contextLine ? (
            <Text style={[s.headerContext, { color: colors.grey }]} numberOfLines={1}>
              Re: {contextLine}
            </Text>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={s.msgList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 && (
            <View style={s.emptyWrap}>
              <Text style={s.emptyText}>Private conversation with {otherName}.</Text>
              <Text style={s.emptySubtext}>Only the two of you can see these messages.</Text>
            </View>
          )}

          {(() => {
            type Group = { senderId: string; msgs: typeof messages; endMs: number };
            const groups: Group[] = [];
            for (const msg of messages) {
              const ms  = new Date(msg.createdAt).getTime();
              const last = groups[groups.length - 1];
              if (last && last.senderId === msg.senderId) {
                last.msgs.push(msg);
                last.endMs = ms;
              } else {
                groups.push({ senderId: msg.senderId, msgs: [msg], endMs: ms });
              }
            }

            return groups.map(group =>
              group.msgs.map((msg, i) => {
                const isMine = msg.senderId === myUid;
                const isLast = i === group.msgs.length - 1;
                return (
                  <View
                    key={msg.id}
                    style={[s.msgRow, isMine ? s.rowMine : s.rowTheirs, i > 0 && { marginTop: 2 }]}
                  >
                    {!isMine && (
                      isLast
                        ? <Avatar photoUrl={otherPhoto} name={otherName} size={26} />
                        : <View style={{ width: 26 }} />
                    )}
                    <View style={[s.msgCol, isMine && s.msgColMine]}>
                      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
                        <Text style={[s.bubbleText, isMine && s.bubbleTextMine]}>{msg.text}</Text>
                      </View>
                      {isLast && (
                        <Text style={[s.time, isMine && s.timeRight]}>{fmtTime(msg.createdAt)}</Text>
                      )}
                    </View>
                  </View>
                );
              })
            );
          })()}
        </ScrollView>

        {/* Composer */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={s.inputRow}>
            <TextInput
              style={[s.input, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
              placeholder={`Message ${otherName}…`}
              placeholderTextColor="#aaaaaa"
              value={text}
              onChangeText={setText}
              multiline
              onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
            />
            <TouchableOpacity
              style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnOff]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={[s.sendIcon, !text.trim() && s.sendIconOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 10 },
  backBtn:      { marginRight: 2 },
  back:         { fontSize: 20, color: Colors.orange, fontWeight: '400' },
  headerAvatar: { flexShrink: 0 },
  headerInfo:   { flex: 1, minWidth: 0 },
  headerName:   { fontSize: 15, fontWeight: '700' },
  headerContext:{ fontSize: 12, marginTop: 1 },
  msgList:      { paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 16, gap: 3, flexGrow: 1 },
  emptyWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48, gap: 6 },
  emptyText:    { fontSize: 14, color: '#888888', textAlign: 'center' },
  emptySubtext: { fontSize: 12, color: '#bbbbbb', textAlign: 'center' },
  msgRow:       { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:      { justifyContent: 'flex-end' },
  rowTheirs:    {},
  msgCol:       { maxWidth: '72%' },
  msgColMine:   { alignItems: 'flex-end' },
  bubble:       { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:   { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f0ede8', borderBottomLeftRadius: 4 },
  bubbleText:   { fontSize: 15, color: '#111111', lineHeight: 22 },
  bubbleTextMine:{ color: '#ffffff' },
  time:         { fontSize: 10, color: '#bbbbbb', marginTop: 3, marginLeft: 2 },
  timeRight:    { textAlign: 'right', marginLeft: 0, marginRight: 2 },
  inputRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  input:        { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120 },
  sendBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:   { backgroundColor: '#e0e0e0' },
  sendIcon:     { fontSize: 18, fontWeight: '700', color: '#ffffff', lineHeight: 20, marginTop: -1 },
  sendIconOff:  { color: '#bbbbbb' },
});
