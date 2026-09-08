import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';
import AdminPanel from '@/components/AdminPanel';
import VenueScreen from '../venue/[id]';
import MusicianScreen from '../musician/[id]';

const SUPPORT_EMAIL = 'support@gigmatch.com.au';

// ── Venue pending / awaiting-code screen ────────────────────────────────────

function VenuePendingScreen() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();

  const [appVenueName, setAppVenueName]             = useState('');
  const [verificationContact, setVerificationContact] = useState('');
  const [contactType, setContactType]               = useState<'email' | 'phone' | 'manual'>('email');
  const [appLoading, setAppLoading]                 = useState(true);

  const [enteredCode, setEnteredCode]   = useState('');
  const [codeError, setCodeError]       = useState('');
  const [codeLoading, setCodeLoading]   = useState(false);
  const [codeSuccess, setCodeSuccess]   = useState(false);

  const claimStatus = profile?.claimStatus ?? 'pending';

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'venueApplications', user.uid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setAppVenueName(d.venueName ?? '');
        setVerificationContact(d.verificationContact ?? '');
        setContactType(d.verificationContactType ?? 'email');
      }
    }).catch(() => {}).finally(() => setAppLoading(false));
  }, [user?.uid]);

  async function handleVerifyCode() {
    if (!user || enteredCode.length !== 6) return;
    setCodeError('');
    setCodeLoading(true);
    try {
      const snap = await getDoc(doc(db, 'venueApplications', user.uid));
      if (!snap.exists()) throw new Error('Application not found.');
      const data = snap.data();

      const expiry = data.verificationCodeExpiry?.toDate?.();
      if (expiry && new Date() > expiry) {
        setCodeError(`This code has expired. Contact ${SUPPORT_EMAIL} to get a new one.`);
        return;
      }
      if (data.verificationCode !== enteredCode.trim()) {
        setCodeError('Incorrect code. Please check and try again.');
        return;
      }

      // Code is valid — approve the claim
      let venueId: string | null = data.selectedVenueId ?? null;

      if (!venueId) {
        // New venue — create a minimal venue document
        const venueRef = await addDoc(collection(db, 'venues'), {
          name: data.venueName,
          claimedBy: user.uid,
          claimedByEmail: user.email ?? '',
          claimedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        venueId = venueRef.id;
        await updateDoc(doc(db, 'venueApplications', user.uid), {
          status: 'approved',
          approvedAt: serverTimestamp(),
          linkedVenueId: venueId,
        });
      } else {
        await Promise.all([
          updateDoc(doc(db, 'venueApplications', user.uid), {
            status: 'approved',
            approvedAt: serverTimestamp(),
          }),
          updateDoc(doc(db, 'venues', venueId), {
            claimedBy: user.uid,
            claimedByEmail: user.email ?? '',
            claimedAt: serverTimestamp(),
          }),
        ]);
      }

      // Update the users doc — auth-context onSnapshot will pick this up automatically
      await updateDoc(doc(db, 'users', user.uid), {
        claimStatus: 'approved',
        venueId,
        type: 'venue',
      });

      setCodeSuccess(true);
    } catch (err: any) {
      setCodeError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setCodeLoading(false);
    }
  }

  if (appLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.orange} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.pendingContent} showsVerticalScrollIndicator={false}>

        {/* ── Pending ── */}
        {claimStatus === 'pending' && (
          <>
            <Text style={styles.pendingIcon}>⏳</Text>
            <Text style={[styles.pendingTitle, { color: colors.black }]}>Claim Under Review</Text>
            <Text style={[styles.pendingBody, { color: colors.grey }]}>
              Your claim for{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{appVenueName}</Text>
              {' '}is being reviewed by GigMatch.
            </Text>
            <Text style={[styles.pendingHint, { color: colors.greyLight }]}>
              Once approved, we'll send a verification code to{' '}
              {contactType === 'manual'
                ? 'you via our team'
                : <Text style={{ fontWeight: '600' }}>{verificationContact}</Text>}.
            </Text>
          </>
        )}

        {/* ── Awaiting code ── */}
        {claimStatus === 'awaiting_code' && !codeSuccess && (
          <>
            <Text style={styles.pendingIcon}>🔑</Text>
            <Text style={[styles.pendingTitle, { color: colors.black }]}>Enter Your Code</Text>
            <Text style={[styles.pendingBody, { color: colors.grey }]}>
              GigMatch has sent a verification code to{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{verificationContact}</Text>.
              Enter it below to claim{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{appVenueName}</Text>.
            </Text>
            <TextInput
              style={styles.codeInput}
              value={enteredCode}
              onChangeText={t => { setEnteredCode(t.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }}
              placeholder="6-digit code"
              placeholderTextColor={Colors.greyLight}
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
            />
            {!!codeError && <Text style={styles.codeError}>{codeError}</Text>}
            <TouchableOpacity
              style={[styles.verifyBtn, (codeLoading || enteredCode.length < 6) && styles.verifyBtnDim]}
              onPress={handleVerifyCode}
              disabled={codeLoading || enteredCode.length < 6}
              activeOpacity={0.85}
            >
              {codeLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.verifyBtnText}>Verify Code</Text>}
            </TouchableOpacity>
            <Text style={[styles.pendingHint, { color: colors.greyLight, marginTop: 8 }]}>
              Didn't receive a code?{' '}
              <Text
                style={{ color: Colors.orange, fontWeight: '600' }}
                onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              >
                Contact support
              </Text>
            </Text>
          </>
        )}

        {/* ── Code success — waiting for onSnapshot to refresh ── */}
        {codeSuccess && (
          <>
            <Text style={styles.pendingIcon}>✅</Text>
            <Text style={[styles.pendingTitle, { color: colors.black }]}>Verified!</Text>
            <Text style={[styles.pendingBody, { color: colors.grey }]}>
              Your venue is being set up. This screen will refresh automatically in a moment.
            </Text>
            <ActivityIndicator color={Colors.orange} style={{ marginTop: 24 }} />
          </>
        )}

        {/* ── Manual review ── */}
        {claimStatus === 'manual_review' && (
          <>
            <Text style={styles.pendingIcon}>📋</Text>
            <Text style={[styles.pendingTitle, { color: colors.black }]}>Manual Review in Progress</Text>
            <Text style={[styles.pendingBody, { color: colors.grey }]}>
              Your claim for{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{appVenueName}</Text>
              {' '}is being manually reviewed. Our team will contact you soon.
            </Text>
          </>
        )}

        {/* Support link — all states */}
        {!codeSuccess && (
          <TouchableOpacity
            style={styles.supportRow}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            activeOpacity={0.7}
          >
            <Text style={[styles.supportText, { color: colors.greyLight }]}>
              Questions?{' '}
              <Text style={{ color: Colors.orange, fontWeight: '600' }}>{SUPPORT_EMAIL}</Text>
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Admin screen ─────────────────────────────────────────────────────────────

function AdminScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={styles.adminContent}>
        <Text style={[styles.adminTitle, { color: colors.black }]}>Admin</Text>
        <Text style={[styles.adminSub, { color: colors.grey }]}>Manage venue claims and platform settings.</Text>
        <TouchableOpacity
          style={styles.adminBtn}
          onPress={() => { setPanelMounted(true); setPanelOpen(true); }}
          activeOpacity={0.85}
        >
          <Text style={styles.adminBtnText}>Open Venue Claims</Text>
        </TouchableOpacity>
        <View style={styles.adminDivider} />
        <TouchableOpacity
          style={[styles.adminLogoutBtn, { borderColor: colors.border }]}
          onPress={async () => { await signOut(auth); router.replace('/'); }}
          activeOpacity={0.75}
        >
          <Text style={[styles.adminLogoutBtnText, { color: colors.grey }]}>Log out</Text>
        </TouchableOpacity>
      </View>
      {panelMounted && (
        <AdminPanel visible={panelOpen} onClose={() => setPanelOpen(false)} />
      )}
    </SafeAreaView>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function ProfileTab() {
  const { user, profile, loading, isAdmin } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!user) return <Redirect href="/login" />;

  if (isAdmin) return <AdminScreen />;

  // Venue user with an approved + linked venue
  if (profile?.type === 'venue' && profile?.venueId) {
    return <VenueScreen _overrideId={profile.venueId} />;
  }

  // Venue user still waiting for approval / code entry
  if (profile?.type === 'venue' && !profile?.venueId) {
    return <VenuePendingScreen />;
  }

  return <MusicianScreen _overrideId={user.uid} />;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Pending screen
  pendingContent: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingVertical: 48,
  },
  pendingIcon:  { fontSize: 56, marginBottom: 20 },
  pendingTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  pendingBody:  { fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 8 },
  pendingHint:  { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 16 },

  codeInput: {
    width: '70%',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingVertical: 16, fontSize: 28, fontWeight: '700',
    color: Colors.black, backgroundColor: Colors.bgFaint,
    letterSpacing: 10, marginTop: 16, marginBottom: 8,
  },
  codeError: { fontSize: 13, color: Colors.danger, textAlign: 'center', marginBottom: 8 },
  verifyBtn: {
    width: '70%', backgroundColor: Colors.orange, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  verifyBtnDim:  { opacity: 0.45 },
  verifyBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  supportRow: { marginTop: 32 },
  supportText: { fontSize: 13, textAlign: 'center' },

  // Admin screen
  adminContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  adminTitle:  { fontSize: 28, fontWeight: '800', marginBottom: 8 },
  adminSub:    { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  adminBtn: {
    backgroundColor: Colors.orange, borderRadius: 12,
    paddingVertical: 15, paddingHorizontal: 36,
  },
  adminBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  adminDivider: { height: 1, backgroundColor: Colors.border, width: '100%', marginVertical: 28 },
  adminLogoutBtn: {
    borderWidth: 1, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 36,
  },
  adminLogoutBtnText: { fontSize: 15, fontWeight: '600' },
});
