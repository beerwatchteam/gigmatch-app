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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,

  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
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
              {' '}is being reviewed by KordUp.
            </Text>
            <Text style={[styles.pendingHint, { color: colors.greyLight }]}>
              Once approved, we'll send a verification code to{' '}
              {contactType === 'manual'
                ? 'you via our team.'
                : <Text style={{ fontWeight: '600' }}>{verificationContact}.</Text>}
            </Text>
          </>
        )}

        {/* ── Awaiting code ── */}
        {claimStatus === 'awaiting_code' && !codeSuccess && (
          <>
            <Text style={styles.pendingIcon}>🔑</Text>
            <Text style={[styles.pendingTitle, { color: colors.black }]}>Enter Your Code</Text>
            <Text style={[styles.pendingBody, { color: colors.grey }]}>
              KordUp has sent a verification code to{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{verificationContact}.</Text>
              Enter it below to claim{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{appVenueName}.</Text>
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

// ── Agent screen ─────────────────────────────────────────────────────────────

type AgentClaim = {
  id: string;
  agentUid: string;
  agentName: string;
  agentUsername: string;
  artistUid: string;
  artistName: string;
  artistEmail: string;
  verificationCode: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: any;
};

type AgentVenueClaim = {
  id: string;
  agentUid: string;
  agentName: string;
  agentUsername: string;
  venueId: string;
  venueName: string;
  venueEmail: string;
  verificationCode: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: any;
};

type BandResult  = { id: string; name: string; username?: string; email?: string };
type VenueResult = { id: string; name: string; email?: string };

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function AgentScreen() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  // ── Musician roster state ─────────────────────────────────────────
  const [claims, setClaims]               = useState<AgentClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [verifyInputs, setVerifyInputs]   = useState<Record<string, string>>({});
  const [verifyErrors, setVerifyErrors]   = useState<Record<string, string>>({});
  const [verifying, setVerifying]         = useState<Record<string, boolean>>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Search flow (musicians)
  const [showSearch, setShowSearch]         = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState<BandResult[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<BandResult | null>(null);
  const [claimLoading, setClaimLoading]     = useState(false);
  const [claimError, setClaimError]         = useState('');
  const [claimSent, setClaimSent]           = useState<AgentClaim | null>(null);

  // ── Venue roster state ────────────────────────────────────────────
  const [venueClaims, setVenueClaims]               = useState<AgentVenueClaim[]>([]);
  const [venueClaimsLoading, setVenueClaimsLoading] = useState(true);
  const [vVerifyInputs, setVVerifyInputs]           = useState<Record<string, string>>({});
  const [vVerifyErrors, setVVerifyErrors]           = useState<Record<string, string>>({});
  const [vVerifying, setVVerifying]                 = useState<Record<string, boolean>>({});
  const [vConfirmRemoveId, setVConfirmRemoveId]     = useState<string | null>(null);

  // Search flow (venues)
  const [vShowSearch, setVShowSearch]           = useState(false);
  const [vSearchQuery, setVSearchQuery]         = useState('');
  const [vSearchResults, setVSearchResults]     = useState<VenueResult[]>([]);
  const [vSearchLoading, setVSearchLoading]     = useState(false);
  const [vSelectedVenue, setVSelectedVenue]     = useState<VenueResult | null>(null);
  const [vClaimLoading, setVClaimLoading]       = useState(false);
  const [vClaimError, setVClaimError]           = useState('');
  const [vClaimSent, setVClaimSent]             = useState<AgentVenueClaim | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      query(collection(db, 'agentClaims'), where('agentUid', '==', user.uid)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as AgentClaim));
        all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setClaims(all);
        setClaimsLoading(false);
      },
      () => setClaimsLoading(false),
    );
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      query(collection(db, 'agentVenueClaims'), where('agentUid', '==', user.uid)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as AgentVenueClaim));
        all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setVenueClaims(all);
        setVenueClaimsLoading(false);
      },
      () => setVenueClaimsLoading(false),
    );
    return unsub;
  }, [user?.uid]);

  async function handleSearch(val: string) {
    setSearchQuery(val);
    setSelectedArtist(null);
    if (val.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const [nameSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db, 'bandProfiles'), where('name', '>=', val), where('name', '<=', val + '\uf8ff'))),
        getDocs(query(collection(db, 'bandProfiles'), where('username', '>=', val.toLowerCase()), where('username', '<=', val.toLowerCase() + '\uf8ff'))),
      ]);
      const seen = new Set<string>();
      const results: BandResult[] = [];
      [...nameSnap.docs, ...userSnap.docs].forEach(d => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const data = d.data();
        results.push({ id: d.id, name: data.name, username: data.username, email: data.email });
      });
      setSearchResults(results.slice(0, 6));
    } catch {}
    finally { setSearchLoading(false); }
  }

  async function handleClaim() {
    if (!user || !selectedArtist) return;
    setClaimLoading(true); setClaimError('');
    try {
      // Check no active claim already exists
      const existingSnap = await getDocs(
        query(collection(db, 'agentClaims'),
          where('agentUid', '==', user.uid),
          where('artistUid', '==', selectedArtist.id),
          where('status', '==', 'pending'))
      );
      if (!existingSnap.empty) {
        setClaimError('You already have a pending claim for this musician.');
        setClaimLoading(false); return;
      }

      const code = generateCode();
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const ref = await addDoc(collection(db, 'agentClaims'), {
        agentUid: user.uid,
        agentName: profile?.displayName ?? '',
        agentUsername: profile?.username ?? '',
        artistUid: selectedArtist.id,
        artistName: selectedArtist.name,
        artistEmail: selectedArtist.email ?? '',
        verificationCode: code,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAt,
      });
      const newClaim: AgentClaim = {
        id: ref.id,
        agentUid: user.uid,
        agentName: profile?.displayName ?? '',
        agentUsername: profile?.username ?? '',
        artistUid: selectedArtist.id,
        artistName: selectedArtist.name,
        artistEmail: selectedArtist.email ?? '',
        verificationCode: code,
        status: 'pending',
        createdAt: null,
      };
      setClaims(prev => [newClaim, ...prev]);
      setClaimSent(newClaim);
      setShowSearch(false);
      setSearchQuery(''); setSearchResults([]); setSelectedArtist(null);
    } catch (err: any) { setClaimError(err.message || 'Failed to submit claim.'); }
    finally { setClaimLoading(false); }
  }

  async function handleVenueSearch(val: string) {
    setVSearchQuery(val);
    setVSelectedVenue(null);
    if (val.trim().length < 2) { setVSearchResults([]); return; }
    setVSearchLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'venues'), where('name', '>=', val), where('name', '<=', val + '\uf8ff'))
      );
      const results: VenueResult[] = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, name: data.name, email: data.email ?? data.bookingContact?.email ?? '' };
      });
      setVSearchResults(results.slice(0, 6));
    } catch {}
    finally { setVSearchLoading(false); }
  }

  async function handleVenueClaim() {
    if (!user || !vSelectedVenue) return;
    setVClaimLoading(true); setVClaimError('');
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'agentVenueClaims'),
          where('agentUid', '==', user.uid),
          where('venueId', '==', vSelectedVenue.id),
          where('status', '==', 'pending'))
      );
      if (!existingSnap.empty) {
        setVClaimError('You already have a pending claim for this venue.');
        setVClaimLoading(false); return;
      }
      const code = generateCode();
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const ref = await addDoc(collection(db, 'agentVenueClaims'), {
        agentUid: user.uid,
        agentName: profile?.displayName ?? '',
        agentUsername: profile?.username ?? '',
        venueId: vSelectedVenue.id,
        venueName: vSelectedVenue.name,
        venueEmail: vSelectedVenue.email ?? '',
        verificationCode: code,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAt,
      });
      const newClaim: AgentVenueClaim = {
        id: ref.id,
        agentUid: user.uid,
        agentName: profile?.displayName ?? '',
        agentUsername: profile?.username ?? '',
        venueId: vSelectedVenue.id,
        venueName: vSelectedVenue.name,
        venueEmail: vSelectedVenue.email ?? '',
        verificationCode: code,
        status: 'pending',
        createdAt: null,
      };
      setVenueClaims(prev => [newClaim, ...prev]);
      setVClaimSent(newClaim);
      setVShowSearch(false);
      setVSearchQuery(''); setVSearchResults([]); setVSelectedVenue(null);
    } catch (err: any) { setVClaimError(err.message || 'Failed to submit claim.'); }
    finally { setVClaimLoading(false); }
  }

  async function handleVerifyVenueClaim(claim: AgentVenueClaim) {
    const entered = (vVerifyInputs[claim.id] ?? '').trim();
    if (entered.length !== 6) {
      setVVerifyErrors(p => ({ ...p, [claim.id]: 'Enter the 6-digit code.' }));
      return;
    }
    if (entered !== claim.verificationCode) {
      setVVerifyErrors(p => ({ ...p, [claim.id]: 'Incorrect code. Ask the venue to check theirs.' }));
      return;
    }
    setVVerifying(p => ({ ...p, [claim.id]: true }));
    try {
      await Promise.all([
        updateDoc(doc(db, 'agentVenueClaims', claim.id), {
          status: 'approved',
          respondedAt: new Date().toISOString(),
        }),
        setDoc(doc(db, 'agentVenueRoster', `${user!.uid}_${claim.venueId}`), {
          agentUid: user!.uid,
          agentName: profile?.displayName ?? '',
          venueId: claim.venueId,
          venueName: claim.venueName,
          approvedAt: new Date().toISOString(),
        }),
      ]);
      setVenueClaims(prev => prev.map(c => c.id === claim.id ? { ...c, status: 'approved' } : c));
      if (vClaimSent?.id === claim.id) setVClaimSent(null);
    } catch {
      setVVerifyErrors(p => ({ ...p, [claim.id]: 'Something went wrong. Please try again.' }));
    } finally {
      setVVerifying(p => ({ ...p, [claim.id]: false }));
    }
  }

  async function handleVerifyClaim(claim: AgentClaim) {
    const entered = (verifyInputs[claim.id] ?? '').trim();
    if (entered.length !== 6) {
      setVerifyErrors(p => ({ ...p, [claim.id]: 'Enter the 6-digit code.' }));
      return;
    }
    if (entered !== claim.verificationCode) {
      setVerifyErrors(p => ({ ...p, [claim.id]: 'Incorrect code. Ask the musician to check theirs.' }));
      return;
    }
    setVerifying(p => ({ ...p, [claim.id]: true }));
    try {
      await Promise.all([
        updateDoc(doc(db, 'agentClaims', claim.id), {
          status: 'approved',
          respondedAt: new Date().toISOString(),
        }),
        setDoc(doc(db, 'agentRoster', `${user!.uid}_${claim.artistUid}`), {
          agentUid: user!.uid,
          agentName: profile?.displayName ?? '',
          artistUid: claim.artistUid,
          artistName: claim.artistName,
          approvedAt: new Date().toISOString(),
        }),
      ]);
      setClaims(prev => prev.map(c => c.id === claim.id ? { ...c, status: 'approved' } : c));
      if (claimSent?.id === claim.id) setClaimSent(null);
    } catch {
      setVerifyErrors(p => ({ ...p, [claim.id]: 'Something went wrong. Please try again.' }));
    } finally {
      setVerifying(p => ({ ...p, [claim.id]: false }));
    }
  }

  const pending  = claims.filter(c => c.status === 'pending');
  const approved = claims.filter(c => c.status === 'approved');

  const vPending  = venueClaims.filter(c => c.status === 'pending');
  const vApproved = venueClaims.filter(c => c.status === 'approved');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={agentStyles.content} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={agentStyles.header}>
          <View>
            <Text style={[agentStyles.headerName, { color: colors.black }]}>{profile?.displayName ?? 'Agent'}</Text>
            {profile?.username ? <Text style={[agentStyles.headerHandle, { color: colors.grey }]}>@{profile.username}</Text> : null}
          </View>
          <TouchableOpacity
            style={[agentStyles.logoutBtn, { borderColor: colors.border }]}
            onPress={async () => { await signOut(auth); router.replace('/'); }}
            activeOpacity={0.75}
          >
            <Text style={[agentStyles.logoutBtnText, { color: colors.grey }]}>Log out</Text>
          </TouchableOpacity>
        </View>

        {/* Claim sent confirmation */}
        {claimSent && (
          <View style={[agentStyles.confirmBox, { borderColor: colors.border }]}>
            <Text style={[agentStyles.confirmTitle, { color: colors.black }]}>Claim submitted</Text>
            <Text style={[agentStyles.confirmBody, { color: colors.grey }]}>
              Ask{' '}
              <Text style={{ fontWeight: '700', color: colors.black }}>{claimSent.artistName}</Text>
              {' '}to open their KordUp profile. They will see a verification code. Enter it in the Pending Claims section below to confirm representation.
            </Text>
            <Text style={[agentStyles.confirmHint, { color: colors.greyLight }]}>
              The claim expires in 7 days if not approved.
            </Text>
            <TouchableOpacity onPress={() => setClaimSent(null)} activeOpacity={0.7}>
              <Text style={{ color: Colors.orange, fontWeight: '600', fontSize: 13 }}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Roster section */}
        <View style={agentStyles.section}>
          <View style={agentStyles.sectionHeader}>
            <Text style={[agentStyles.sectionTitle, { color: colors.black }]}>Your Roster</Text>
            <TouchableOpacity
              style={agentStyles.addBtn}
              onPress={() => { setShowSearch(true); setClaimSent(null); setClaimError(''); }}
              activeOpacity={0.8}
            >
              <Text style={agentStyles.addBtnText}>+ Claim Musician</Text>
            </TouchableOpacity>
          </View>

          {claimsLoading ? (
            <ActivityIndicator color={Colors.orange} style={{ marginTop: 16 }} />
          ) : approved.length === 0 ? (
            <Text style={[agentStyles.empty, { color: colors.greyLight }]}>
              No musicians in your roster yet. Claim a musician to get started.
            </Text>
          ) : (
            approved.map(c => (
              <View key={c.id} style={[agentStyles.claimCard, { borderColor: colors.border, backgroundColor: colors.bgFaint, gap: 12 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={[agentStyles.claimName, { color: colors.black }]}>{c.artistName}</Text>
                    {c.artistEmail ? <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>{c.artistEmail}</Text> : null}
                  </View>
                  {confirmRemoveId === c.id ? (
                    <View style={agentStyles.confirmRemoveRow}>
                      <TouchableOpacity onPress={() => setConfirmRemoveId(null)} activeOpacity={0.7}>
                        <Text style={[agentStyles.removeBtn, { color: colors.grey }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          setConfirmRemoveId(null);
                          await Promise.all([
                            deleteDoc(doc(db, 'agentClaims', c.id)),
                            deleteDoc(doc(db, 'agentRoster', `${user!.uid}_${c.artistUid}`)),
                          ]).catch(() => {});
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[agentStyles.removeBtn, { color: '#e53e3e' }]}>Confirm</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setConfirmRemoveId(c.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[agentStyles.removeBtn, { color: colors.greyLight }]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={agentStyles.rosterBtns}>
                  <TouchableOpacity
                    style={[agentStyles.rosterBtn, { borderColor: colors.border }]}
                    onPress={() => router.push(`/musician/${c.artistUid}` as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[agentStyles.rosterBtnText, { color: colors.black }]}>View profile</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[agentStyles.rosterBtn, { borderColor: colors.border }]}
                    onPress={() => router.push(`/edit-profile?uid=${c.artistUid}` as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[agentStyles.rosterBtnText, { color: colors.black }]}>Edit profile</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Pending claims section */}
        {pending.length > 0 && (
          <View style={agentStyles.section}>
            <Text style={[agentStyles.sectionTitle, { color: colors.black }]}>Pending Claims</Text>
            {pending.map(c => (
              <View key={c.id} style={[agentStyles.claimCard, { borderColor: colors.border, backgroundColor: colors.bgFaint, gap: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={[agentStyles.claimName, { color: colors.black }]}>{c.artistName}</Text>
                    <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>Ask {c.artistName} for their verification code</Text>
                  </View>
                  <View style={[agentStyles.statusBadge, { borderColor: '#f5a623' }]}>
                    <Text style={[agentStyles.statusText, { color: '#f5a623' }]}>Pending</Text>
                  </View>
                </View>
                <TextInput
                  style={[agentStyles.verifyInput, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bg }]}
                  value={verifyInputs[c.id] ?? ''}
                  onChangeText={v => {
                    setVerifyInputs(p => ({ ...p, [c.id]: v.replace(/\D/g, '').slice(0, 6) }));
                    setVerifyErrors(p => ({ ...p, [c.id]: '' }));
                  }}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.greyLight}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {verifyErrors[c.id] ? <Text style={agentStyles.verifyError}>{verifyErrors[c.id]}</Text> : null}
                <TouchableOpacity
                  style={[agentStyles.verifyBtn, verifying[c.id] && { opacity: 0.45 }]}
                  onPress={() => handleVerifyClaim(c)}
                  disabled={!!verifying[c.id]}
                  activeOpacity={0.85}
                >
                  {verifying[c.id]
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={agentStyles.verifyBtnText}>Verify and Confirm</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Search / claim flow */}
        {showSearch && (
          <View style={[agentStyles.searchBox, { borderColor: colors.border, backgroundColor: colors.bg }]}>
            <Text style={[agentStyles.searchTitle, { color: colors.black }]}>Find a Musician to Claim</Text>
            <Text style={[agentStyles.searchHint, { color: colors.grey }]}>
              Search by name or username. The musician must already have a KordUp account.
            </Text>
            <TextInput
              style={[agentStyles.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
              placeholder="Name or username..."
              placeholderTextColor={colors.greyLight}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator color={Colors.orange} style={{ marginBottom: 8 }} />}
            {searchResults.length > 0 && !selectedArtist && (
              <View style={[agentStyles.resultList, { borderColor: colors.border }]}>
                {searchResults.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[agentStyles.resultItem, { borderColor: colors.border }]}
                    onPress={() => { setSelectedArtist(r); setSearchResults([]); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[agentStyles.resultName, { color: colors.black }]}>{r.name}</Text>
                    {r.username ? <Text style={[agentStyles.resultHandle, { color: colors.grey }]}>@{r.username}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {selectedArtist && (
              <View style={[agentStyles.selectedCard, { borderColor: Colors.orange }]}>
                <View>
                  <Text style={[agentStyles.claimName, { color: colors.black }]}>{selectedArtist.name}</Text>
                  {selectedArtist.email
                    ? <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>Verification sent to: {selectedArtist.email}</Text>
                    : <Text style={[agentStyles.claimEmail, { color: Colors.danger }]}>No email on file for this musician.</Text>}
                </View>
                <TouchableOpacity onPress={() => setSelectedArtist(null)} activeOpacity={0.7}>
                  <Text style={{ color: colors.greyLight, fontSize: 13 }}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}
            {claimError ? <Text style={agentStyles.claimError}>{claimError}</Text> : null}
            <View style={agentStyles.searchActions}>
              <TouchableOpacity
                style={[agentStyles.claimBtn, (!selectedArtist || !selectedArtist.email || claimLoading) && agentStyles.claimBtnDim]}
                onPress={handleClaim}
                disabled={!selectedArtist || !selectedArtist.email || claimLoading}
                activeOpacity={0.85}
              >
                {claimLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={agentStyles.claimBtnText}>Send Claim Request</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[agentStyles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); setSelectedArtist(null); setClaimError(''); }}
                activeOpacity={0.75}
              >
                <Text style={[agentStyles.cancelBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── VENUE ROSTER ── */}
        <View style={[agentStyles.section, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 24 }]}>
          <View style={agentStyles.sectionHeader}>
            <Text style={[agentStyles.sectionTitle, { color: colors.black }]}>Venue Roster</Text>
            <TouchableOpacity
              style={agentStyles.addBtn}
              onPress={() => { setVShowSearch(true); setVClaimSent(null); setVClaimError(''); }}
              activeOpacity={0.8}
            >
              <Text style={agentStyles.addBtnText}>+ Claim Venue</Text>
            </TouchableOpacity>
          </View>

          {/* Claim sent confirmation */}
          {vClaimSent && (
            <View style={[agentStyles.confirmBox, { borderColor: colors.border }]}>
              <Text style={[agentStyles.confirmTitle, { color: colors.black }]}>Claim submitted</Text>
              <Text style={[agentStyles.confirmBody, { color: colors.grey }]}>
                Ask{' '}
                <Text style={{ fontWeight: '700', color: colors.black }}>{vClaimSent.venueName}</Text>
                {' '}to open their KordUp profile. They will see a verification code. Enter it in the Pending Claims section below to confirm representation.
              </Text>
              <Text style={[agentStyles.confirmHint, { color: colors.greyLight }]}>
                The claim expires in 7 days if not approved.
              </Text>
              <TouchableOpacity onPress={() => setVClaimSent(null)} activeOpacity={0.7}>
                <Text style={{ color: Colors.orange, fontWeight: '600', fontSize: 13 }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {venueClaimsLoading ? (
            <ActivityIndicator color={Colors.orange} style={{ marginTop: 16 }} />
          ) : vApproved.length === 0 ? (
            <Text style={[agentStyles.empty, { color: colors.greyLight }]}>
              No venues in your roster yet. Claim a venue to get started.
            </Text>
          ) : (
            vApproved.map(c => (
              <View key={c.id} style={[agentStyles.claimCard, { borderColor: colors.border, backgroundColor: colors.bgFaint, gap: 12 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={[agentStyles.claimName, { color: colors.black }]}>{c.venueName}</Text>
                    {c.venueEmail ? <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>{c.venueEmail}</Text> : null}
                  </View>
                  {vConfirmRemoveId === c.id ? (
                    <View style={agentStyles.confirmRemoveRow}>
                      <TouchableOpacity onPress={() => setVConfirmRemoveId(null)} activeOpacity={0.7}>
                        <Text style={[agentStyles.removeBtn, { color: colors.grey }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          setVConfirmRemoveId(null);
                          await Promise.all([
                            deleteDoc(doc(db, 'agentVenueClaims', c.id)),
                            deleteDoc(doc(db, 'agentVenueRoster', `${user!.uid}_${c.venueId}`)),
                          ]).catch(() => {});
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[agentStyles.removeBtn, { color: '#e53e3e' }]}>Confirm</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setVConfirmRemoveId(c.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[agentStyles.removeBtn, { color: colors.greyLight }]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={agentStyles.rosterBtns}>
                  <TouchableOpacity
                    style={[agentStyles.rosterBtn, { borderColor: colors.border }]}
                    onPress={() => router.push(`/venue/${c.venueId}` as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[agentStyles.rosterBtnText, { color: colors.black }]}>View profile</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[agentStyles.rosterBtn, { borderColor: colors.border }]}
                    onPress={() => router.push(`/edit-venue?agentVenueId=${c.venueId}` as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[agentStyles.rosterBtnText, { color: colors.black }]}>Edit profile</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Pending venue claims section */}
        {vPending.length > 0 && (
          <View style={agentStyles.section}>
            <Text style={[agentStyles.sectionTitle, { color: colors.black }]}>Pending Venue Claims</Text>
            {vPending.map(c => (
              <View key={c.id} style={[agentStyles.claimCard, { borderColor: colors.border, backgroundColor: colors.bgFaint, gap: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={[agentStyles.claimName, { color: colors.black }]}>{c.venueName}</Text>
                    <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>Ask {c.venueName} for their verification code</Text>
                  </View>
                  <View style={[agentStyles.statusBadge, { borderColor: '#f5a623' }]}>
                    <Text style={[agentStyles.statusText, { color: '#f5a623' }]}>Pending</Text>
                  </View>
                </View>
                <TextInput
                  style={[agentStyles.verifyInput, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bg }]}
                  value={vVerifyInputs[c.id] ?? ''}
                  onChangeText={v => {
                    setVVerifyInputs(p => ({ ...p, [c.id]: v.replace(/\D/g, '').slice(0, 6) }));
                    setVVerifyErrors(p => ({ ...p, [c.id]: '' }));
                  }}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.greyLight}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {vVerifyErrors[c.id] ? <Text style={agentStyles.verifyError}>{vVerifyErrors[c.id]}</Text> : null}
                <TouchableOpacity
                  style={[agentStyles.verifyBtn, vVerifying[c.id] && { opacity: 0.45 }]}
                  onPress={() => handleVerifyVenueClaim(c)}
                  disabled={!!vVerifying[c.id]}
                  activeOpacity={0.85}
                >
                  {vVerifying[c.id]
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={agentStyles.verifyBtnText}>Verify and Confirm</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Venue search / claim flow */}
        {vShowSearch && (
          <View style={[agentStyles.searchBox, { borderColor: colors.border, backgroundColor: colors.bg }]}>
            <Text style={[agentStyles.searchTitle, { color: colors.black }]}>Find a Venue to Claim</Text>
            <Text style={[agentStyles.searchHint, { color: colors.grey }]}>
              Search by venue name. The venue must already have a KordUp listing.
            </Text>
            <TextInput
              style={[agentStyles.input, { borderColor: colors.border, color: colors.black, backgroundColor: colors.bgFaint }]}
              placeholder="Venue name..."
              placeholderTextColor={colors.greyLight}
              value={vSearchQuery}
              onChangeText={handleVenueSearch}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {vSearchLoading && <ActivityIndicator color={Colors.orange} style={{ marginBottom: 8 }} />}
            {vSearchResults.length > 0 && !vSelectedVenue && (
              <View style={[agentStyles.resultList, { borderColor: colors.border }]}>
                {vSearchResults.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[agentStyles.resultItem, { borderColor: colors.border }]}
                    onPress={() => { setVSelectedVenue(r); setVSearchResults([]); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[agentStyles.resultName, { color: colors.black }]}>{r.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {vSelectedVenue && (
              <View style={[agentStyles.selectedCard, { borderColor: Colors.orange }]}>
                <View>
                  <Text style={[agentStyles.claimName, { color: colors.black }]}>{vSelectedVenue.name}</Text>
                  {vSelectedVenue.email
                    ? <Text style={[agentStyles.claimEmail, { color: colors.grey }]}>Venue contact: {vSelectedVenue.email}</Text>
                    : <Text style={[agentStyles.claimEmail, { color: Colors.danger }]}>No email on file for this venue.</Text>}
                </View>
                <TouchableOpacity onPress={() => setVSelectedVenue(null)} activeOpacity={0.7}>
                  <Text style={{ color: colors.greyLight, fontSize: 13 }}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}
            {vClaimError ? <Text style={agentStyles.claimError}>{vClaimError}</Text> : null}
            <View style={agentStyles.searchActions}>
              <TouchableOpacity
                style={[agentStyles.claimBtn, (!vSelectedVenue || vClaimLoading) && agentStyles.claimBtnDim]}
                onPress={handleVenueClaim}
                disabled={!vSelectedVenue || vClaimLoading}
                activeOpacity={0.85}
              >
                {vClaimLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={agentStyles.claimBtnText}>Send Claim Request</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[agentStyles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { setVShowSearch(false); setVSearchQuery(''); setVSearchResults([]); setVSelectedVenue(null); setVClaimError(''); }}
                activeOpacity={0.75}
              >
                <Text style={[agentStyles.cancelBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[agentStyles.supportRow]}
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          activeOpacity={0.7}
        >
          <Text style={[styles.pendingHint, { color: colors.greyLight }]}>
            Questions? <Text style={{ color: Colors.orange, fontWeight: '600' }}>{SUPPORT_EMAIL}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const agentStyles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 28,
  },
  headerName:   { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerHandle: { fontSize: 13, marginTop: 2 },
  logoutBtn:    { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  logoutBtnText:{ fontSize: 13, fontWeight: '600' },

  section:       { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle:  { fontSize: 17, fontWeight: '700' },
  empty:         { fontSize: 14, lineHeight: 22 },

  addBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  claimCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10,
  },
  claimName:  { fontSize: 15, fontWeight: '700' },
  claimEmail: { fontSize: 12, marginTop: 2 },

  statusBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderColor: '#22c55e' },
  statusText:  { fontSize: 12, fontWeight: '700' },
  removeBtn:        { fontSize: 12, fontWeight: '600' },
  confirmRemoveRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  rosterBtns:    { flexDirection: 'row', gap: 8 },
  rosterBtn:     { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
  rosterBtnText: { fontSize: 13, fontWeight: '600' },
  verifyInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 20, fontWeight: '700', letterSpacing: 6, textAlign: 'center' },
  verifyError: { fontSize: 12, color: '#e53e3e' },
  verifyBtn:   { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  verifyBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  confirmBox: {
    borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24, gap: 8,
    backgroundColor: '#f0fdf4',
  },
  confirmTitle: { fontSize: 15, fontWeight: '700' },
  confirmBody:  { fontSize: 13, lineHeight: 20 },
  confirmHint:  { fontSize: 12 },

  searchBox: {
    borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24, gap: 10,
  },
  searchTitle: { fontSize: 15, fontWeight: '700' },
  searchHint:  { fontSize: 13, lineHeight: 20 },
  input: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15,
  },
  resultList:  { borderWidth: 1, borderRadius: 8, overflow: 'hidden', marginTop: -4 },
  resultItem:  { padding: 12, borderBottomWidth: 1 },
  resultName:  { fontSize: 14, fontWeight: '700' },
  resultHandle:{ fontSize: 12, marginTop: 2 },
  selectedCard:{
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderRadius: 8, padding: 12,
  },
  claimError: { fontSize: 13, color: Colors.danger },
  searchActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  claimBtn:    { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  claimBtnDim: { opacity: 0.45 },
  claimBtnText:{ fontSize: 14, fontWeight: '700', color: '#fff' },
  cancelBtn:   { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText:{ fontSize: 14, fontWeight: '600' },
  supportRow:  { alignItems: 'center', marginTop: 8 },
});

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

  if (profile?.type === 'agent') {
    return <AgentScreen />;
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
