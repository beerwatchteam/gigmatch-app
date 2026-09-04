/**
 * Direct message thread screen.
 * id = other user's UID.
 * Used from native inbox Messages tab + musician card Message button.
 */
import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  mkDMId, useDMConv, useDMMessages,
  startDM, sendDMMessage, acceptDMRequest, deleteDMConv,
} from '@/lib/useDirectMessages';

const isWeb = Platform.OS === 'web';

export default function MessagesScreen() {
  const router  = useRouter();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const { id: otherUid, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();

  const myUid  = user?.uid ?? '';
  const myName = (profile as any)?.name || user?.email || 'Me';
  const myPhoto = (profile as any)?.photoUrl ?? null;

  const convId = myUid && otherUid ? mkDMId(myUid, otherUid) : null;
  const conv    = useDMConv(convId);
  const messages = useDMMessages(convId);

  const otherName  = conv?.participantNames?.[otherUid]  ?? nameParam ?? 'User';
  const otherPhoto = conv?.participantPhotos?.[otherUid] ?? null;

  const isAccepted   = conv ? conv.acceptedBy.includes(myUid) : false;
  const isInitiator  = conv?.initiatedBy === myUid;
  const otherAccepted = conv ? conv.acceptedBy.includes(otherUid) : false;
  const isNew        = !conv;

  // Initiator can send first message only once (conv doesn't exist yet).
  // After that, must wait for acceptance. Recipient can send once accepted.
  const canSend = isNew || (isAccepted && (isInitiator ? otherAccepted : true));

  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
  }, [messages.length]);

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
        <View style={s.headerSide} />
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
          {messages.map(msg => {
            const isMine = msg.senderId === myUid;
            return (
              <View key={msg.id} style={[s.msgRow, isMine ? s.rowMine : s.rowTheirs]}>
                <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
                  <Text style={[s.bubbleText, isMine && s.bubbleTextMine]}>{msg.text}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* Accept banner — shown to recipient before they accept */}
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

        {/* Waiting banner — shown to initiator while recipient hasn't accepted */}
        {conv && isInitiator && !otherAccepted && (
          <View style={[s.banner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <Text style={[s.bannerText, { color: colors.grey }]}>
              Waiting for {otherName} to accept your message request.
            </Text>
          </View>
        )}

        {/* Text input — only when both parties can send */}
        {canSend && (
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
            <View style={[s.inputArea, { backgroundColor: colors.bgFaint, borderTopColor: colors.border }]}>
              <TextInput
                style={[s.input, { backgroundColor: colors.bg, color: colors.black, borderColor: colors.border }]}
                placeholder="Type a message…"
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

        {/* Delete — bottom right */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[s.deleteRow, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TouchableOpacity onPress={handleDelete}>
              <Text style={s.deleteText}>Delete conversation</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 8 },
  headerSide: { minWidth: 60 },
  back:       { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  headerName: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  msgList:    { padding: isWeb ? 24 : 16, gap: 12, flexGrow: 1 },
  emptyWrap:  { alignItems: 'center', paddingTop: 60 },
  emptyText:  { fontSize: 14, color: '#aaaaaa', textAlign: 'center', lineHeight: 20 },
  msgRow:     { flexDirection: 'row' },
  rowMine:    { justifyContent: 'flex-end' },
  rowTheirs:  { justifyContent: 'flex-start' },
  bubble:     { maxWidth: '72%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: Colors.orange, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f2f2f2', borderBottomLeftRadius: 4 },
  bubbleText:   { fontSize: 14, color: '#111111', lineHeight: 21 },
  bubbleTextMine: { color: '#111111' },
  banner:     { padding: 16, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1, alignItems: 'center', gap: 12 },
  bannerText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  acceptBtn:  { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  acceptBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  inputArea:  { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 14, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1 },
  input:      { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 120 },
  sendBtn:    { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#e0e0e0' },
  sendText:   { fontWeight: '700', color: '#111111', fontSize: 14 },
  sendTextDisabled: { color: '#aaaaaa' },
  deleteRow:  { paddingHorizontal: isWeb ? 24 : 16, paddingVertical: 10, alignItems: 'flex-end', borderTopWidth: 1 },
  deleteText: { fontSize: 13, color: '#ef4444', fontWeight: '600' },
});
