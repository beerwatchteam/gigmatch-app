import { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth';
import { doc, setDoc, getDoc, addDoc, collection, getDocs, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';

const isWeb = Platform.OS === 'web';
const ARTIST_TYPES = ['Band', 'Solo Artist', 'Duo', 'DJ', 'Other'];

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveUsernameToEmail(username: string): Promise<string | null> {
  const lower = username.toLowerCase();
  const [bpSnap, uSnap] = await Promise.all([
    getDocs(query(collection(db, 'bandProfiles'), where('username', '==', lower))),
    getDocs(query(collection(db, 'users'),        where('username', '==', lower))),
  ]);
  if (!bpSnap.empty) return (bpSnap.docs[0].data().email as string) || null;
  if (!uSnap.empty && uSnap.docs[0].data().email) return uSnap.docs[0].data().email as string;
  return null;
}

async function isUsernameTaken(username: string): Promise<boolean> {
  const [bpSnap, uSnap] = await Promise.all([
    getDocs(query(collection(db, 'bandProfiles'), where('username', '==', username))),
    getDocs(query(collection(db, 'users'),        where('username', '==', username))),
  ]);
  return !bpSnap.empty || !uSnap.empty;
}

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [signupTab, setSignupTab] = useState<'artist' | 'venue'>('artist');

  // ── Login ──────────────────────────────────────────────────────────────
  const [siEmail, setSiEmail]         = useState('');
  const [siPassword, setSiPassword]   = useState('');
  const [siRemember, setSiRemember]   = useState(true);
  const [siLoading, setSiLoading]     = useState(false);
  const [siError, setSiError]         = useState('');

  // ── Artist signup ──────────────────────────────────────────────────────
  const [mStageName, setMStageName]     = useState('');
  const [mUsername, setMUsername]       = useState('');
  const [mEmail, setMEmail]             = useState('');
  const [mPassword, setMPassword]       = useState('');
  const [mConfirm, setMConfirm]         = useState('');
  const [mArtistType, setMArtistType]   = useState('');
  const [mOtherType, setMOtherType]     = useState('');
  const [mTerms, setMTerms]             = useState(false);
  const [mLoading, setMLoading]         = useState(false);
  const [mError, setMError]             = useState('');
  const [mFieldErrors, setMFieldErrors] = useState<Record<string, string>>({});
  const [mUsernameTouched, setMUsernameTouched] = useState(false);
  const [mVerifyPending, setMVerifyPending]     = useState(false);
  const [mVerifyEmail, setMVerifyEmail]         = useState('');
  const [mResendLoading, setMResendLoading]     = useState(false);
  const [mResendSent, setMResendSent]           = useState(false);
  const mUserRef = useRef<any>(null);

  // ── Venue signup ───────────────────────────────────────────────────────
  const [vVenueName, setVVenueName]             = useState('');
  const [vUsername, setVUsername]               = useState('');
  const [vEmail, setVEmail]                     = useState('');
  const [vPassword, setVPassword]               = useState('');
  const [vConfirm, setVConfirm]                 = useState('');
  const [vTerms, setVTerms]                     = useState(false);
  const [vLoading, setVLoading]                 = useState(false);
  const [vError, setVError]                     = useState('');
  const [vFieldErrors, setVFieldErrors]         = useState<Record<string, string>>({});
  const [vUsernameTouched, setVUsernameTouched] = useState(false);
  const [vSignUpState, setVSignUpState]         = useState<'form' | 'claim-submitted'>('form');
  const [vManualReview, setVManualReview]       = useState(false);
  const [vManualNotes, setVManualNotes]         = useState('');
  const [vAlreadyClaimed, setVAlreadyClaimed]   = useState(false);
  const [vCurrentOwnerId, setVCurrentOwnerId]   = useState('');
  const vUserRef = useRef<any>(null);

  // Venue name search
  const [allVenues, setAllVenues]             = useState<any[]>([]);
  const [venueDropdown, setVenueDropdown]     = useState<any[]>([]);
  const [showVenueDropdown, setShowVenueDropdown] = useState(false);
  const [vSelectedVenueId, setVSelectedVenueId]  = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (mode === 'signup' && signupTab === 'venue' && allVenues.length === 0) {
      getDocs(collection(db, 'venues'))
        .then(snap => setAllVenues(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
        .catch(() => {});
    }
  }, [mode, signupTab]);

  // ── Handlers ─────────────────────────────────────────────────────────
  async function handleSignIn() {
    setSiLoading(true); setSiError('');
    try {
      let email = siEmail.trim();
      if (!email.includes('@')) {
        const resolved = await resolveUsernameToEmail(email);
        if (!resolved) { setSiError('No account found with that username.'); setSiLoading(false); return; }
        email = resolved;
      }
      if (isWeb) {
        await setPersistence(auth, siRemember ? browserLocalPersistence : browserSessionPersistence);
      } else if (!siRemember) {
        await setPersistence(auth, inMemoryPersistence);
      }
      await signInWithEmailAndPassword(auth, email, siPassword);
      router.back();
    } catch { setSiError('Invalid email/username or password.'); }
    finally { setSiLoading(false); }
  }

  function validateArtist() {
    const e: Record<string, string> = {};
    if (!mStageName.trim())     e.stageName  = 'Stage name is required';
    if (!mUsername.trim())      e.username   = 'Username is required';
    if (/\s/.test(mUsername))   e.username   = 'Username cannot contain spaces';
    if (!mEmail.trim())         e.email      = 'Email is required';
    if (!mPassword)             e.password   = 'Password is required';
    if (mPassword.length < 6)   e.password   = 'At least 6 characters';
    if (mPassword !== mConfirm) e.confirm    = "Passwords don't match";
    if (!mArtistType)           e.artistType  = 'Select an artist type';
    if (mArtistType === 'Other' && !mOtherType.trim()) e.otherType = 'Please describe your act type';
    if (!mTerms)                e.terms      = 'You must accept the Terms & Conditions';
    setMFieldErrors(e); return Object.keys(e).length === 0;
  }

  async function handleArtistSignUp() {
    if (!validateArtist()) return;
    setMLoading(true); setMError('');
    try {
      if (await isUsernameTaken(mUsername.trim().toLowerCase())) {
        setMFieldErrors(p => ({ ...p, username: 'Username already taken.' }));
        setMLoading(false); return;
      }
      const { user } = await createUserWithEmailAndPassword(auth, mEmail.trim(), mPassword);
      await updateProfile(user, { displayName: mStageName.trim() });
      await setDoc(doc(db, 'users', user.uid), {
        type: 'artist', displayName: mStageName.trim(),
        username: mUsername.trim().toLowerCase(), email: mEmail.trim(),
        venueId: null, createdAt: new Date().toISOString(),
      });
      await setDoc(doc(db, 'bandProfiles', user.uid), {
        name: mStageName.trim(), username: mUsername.trim().toLowerCase(),
        artistType: mArtistType,
        ...(mArtistType === 'Other' ? { otherArtistType: mOtherType.trim() } : {}),
        genre: [], location: '', email: mEmail.trim(),
        phone: '', instagram: '', tiktok: '', spotify: '', appleMusic: '',
        customLinks: [], about: '', songs: [], gigHistory: [], upcomingGigs: [],
        techRider: { monitoring: '', backlineNeeded: '', stageSize: '', soundcheck: '', notes: '', stagePlot: '', inputList: '' },
        settings: { emailOnEnquiryResponse: true, emailOnNewConnection: false, listed: true },
        createdAt: new Date().toISOString(),
      });
      await sendEmailVerification(user);
      mUserRef.current = user; setMVerifyEmail(mEmail.trim()); setMVerifyPending(true);
    } catch (err: any) { setMError(err.message || 'Failed to create account.'); }
    finally { setMLoading(false); }
  }

  async function handleArtistResend() {
    if (!mUserRef.current) return;
    setMResendLoading(true);
    try { await sendEmailVerification(mUserRef.current); setMResendSent(true); setTimeout(() => setMResendSent(false), 3000); } catch {}
    finally { setMResendLoading(false); }
  }

  async function handleArtistStartOver() {
    await signOut(auth); setMVerifyPending(false);
    setMStageName(''); setMUsername(''); setMEmail(''); setMPassword(''); setMConfirm(''); setMArtistType(''); setMOtherType('');
    setMTerms(false); setMError(''); setMFieldErrors({}); setMUsernameTouched(false); mUserRef.current = null;
  }

  function handleVenueNameChange(val: string) {
    setVVenueName(val); setVSelectedVenueId(undefined);
    setVAlreadyClaimed(false); setVCurrentOwnerId('');
    if (!vUsernameTouched) setVUsername(slugify(val));
    if (val.trim().length < 1) { setVenueDropdown([]); setShowVenueDropdown(false); return; }
    const matches = allVenues.filter(v => v.name?.toLowerCase().includes(val.toLowerCase())).slice(0, 5);
    setVenueDropdown(matches); setShowVenueDropdown(matches.length > 0);
  }

  function validateVenue() {
    const e: Record<string, string> = {};
    if (!vVenueName.trim())             e.venueName = 'Venue name is required';
    if (vSelectedVenueId === undefined) e.venueName = 'Select from the list or register as new';
    if (!vUsername.trim())              e.username  = 'Username is required';
    if (/\s/.test(vUsername))           e.username  = 'No spaces allowed';
    if (!vEmail.trim())                 e.email     = 'Email is required';
    if (!vPassword)                     e.password  = 'Password is required';
    if (vPassword.length < 6)           e.password  = 'At least 6 characters';
    if (vPassword !== vConfirm)         e.confirm   = "Passwords don't match";
    if (!vTerms)                        e.terms     = 'You must accept the Terms & Conditions';
    setVFieldErrors(e); return Object.keys(e).length === 0;
  }

  async function handleVenueSelect(venue: { id: string; name: string; suburb?: string }) {
    setVVenueName(venue.name);
    setVSelectedVenueId(venue.id);
    if (!vUsernameTouched) setVUsername(slugify(venue.name));
    setShowVenueDropdown(false);
    setVAlreadyClaimed(false);
    setVCurrentOwnerId('');
    try {
      const snap = await getDoc(doc(db, 'venues', venue.id));
      const claimedBy = snap.data()?.claimedBy;
      if (claimedBy) {
        setVAlreadyClaimed(true);
        setVCurrentOwnerId(claimedBy);
      }
    } catch {}
  }

  async function handleVenueSignUp() {
    if (!validateVenue()) return;
    setVLoading(true); setVError('');
    try {
      if (await isUsernameTaken(vUsername.trim().toLowerCase())) {
        setVFieldErrors(p => ({ ...p, username: 'Username already taken.' }));
        setVLoading(false); return;
      }

      const contactType: 'email' | 'manual' = vManualReview ? 'manual' : 'email';

      const { user } = await createUserWithEmailAndPassword(auth, vEmail.trim(), vPassword);
      await updateProfile(user, { displayName: vVenueName.trim() });

      // Create users doc so profile tab can show pending state immediately
      await setDoc(doc(db, 'users', user.uid), {
        type: 'venue',
        displayName: vVenueName.trim(),
        username: vUsername.trim().toLowerCase(),
        email: vEmail.trim(),
        venueId: null,
        claimStatus: 'pending',
        createdAt: new Date().toISOString(),
      });

      // Create venue application
      await setDoc(doc(db, 'venueApplications', user.uid), {
        uid: user.uid,
        venueName: vVenueName.trim(),
        username: vUsername.trim().toLowerCase(),
        email: vEmail.trim(),
        selectedVenueId: vSelectedVenueId || null,
        isNewVenue: vSelectedVenueId === null,
        status: 'pending',
        submittedAt: serverTimestamp(),
        verificationContact: vManualReview ? '' : vEmail.trim(),
        verificationContactType: contactType,
        notes: vManualNotes.trim() || '',
        isDispute: vAlreadyClaimed,
      });

      // If claiming an already-claimed venue, start a dispute
      if (vAlreadyClaimed && vCurrentOwnerId && vSelectedVenueId) {
        const disputeExpiry = new Date();
        disputeExpiry.setDate(disputeExpiry.getDate() + 7);
        await addDoc(collection(db, 'venueDisputes'), {
          venueDocId: vSelectedVenueId,
          venueName: vVenueName.trim(),
          claimId: user.uid,
          currentOwnerId: vCurrentOwnerId,
          challengerUserId: user.uid,
          challengerEmail: vEmail.trim(),
          status: 'pending_owner',
          createdAt: serverTimestamp(),
          disputeWindowExpiry: Timestamp.fromDate(disputeExpiry),
        });
      }

      vUserRef.current = user;
      setVSignUpState('claim-submitted');
    } catch (err: any) { setVError(err.message || 'Failed to submit application.'); }
    finally { setVLoading(false); }
  }

  async function handleVenueStartOver() {
    await signOut(auth); setVSignUpState('form');
    setVVenueName(''); setVSelectedVenueId(undefined); setVUsername(''); setVEmail('');
    setVPassword(''); setVConfirm(''); setVTerms(false); setVError(''); setVFieldErrors({});
    setVUsernameTouched(false); vUserRef.current = null;
    setVManualReview(false); setVManualNotes('');
    setVAlreadyClaimed(false); setVCurrentOwnerId('');
  }

  // ── Form content (shared between modal card and native scroll) ──────
  const formContent = (
    <>
      {/* Logo */}
      <View style={s.logoRow}>
        <Text style={s.logoText}>GigMatch</Text>
        <Text style={s.logoSub}>Connect bands with venues</Text>
      </View>

      {/* Top tabs */}
      <View style={s.tabRow}>
        {(['login', 'signup'] as const).map(m => (
          <TouchableOpacity
            key={m}
            style={[s.tabBtn, mode === m && s.tabBtnActive]}
            onPress={() => { setMode(m); setSiError(''); setMError(''); setVError(''); setMFieldErrors({}); setVFieldErrors({}); }}
          >
            <Text style={[s.tabText, mode === m && s.tabTextActive]}>
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── LOG IN ── */}
      {mode === 'login' && (
        <>
          <TextInput style={s.input} placeholder="Email or username" placeholderTextColor="#999"
            value={siEmail} onChangeText={setSiEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <TextInput style={s.input} placeholder="Password" placeholderTextColor="#999"
            value={siPassword} onChangeText={setSiPassword} secureTextEntry />
          <TouchableOpacity style={s.rememberRow} onPress={() => setSiRemember(v => !v)} activeOpacity={0.7}>
            <View style={[s.checkbox, siRemember && s.checkboxOn]} />
            <Text style={s.rememberText}>Remember me</Text>
          </TouchableOpacity>
          {siError ? <Text style={s.errorText}>{siError}</Text> : null}
          <TouchableOpacity style={[s.submitBtn, siLoading && s.submitBtnDim]} onPress={handleSignIn} disabled={siLoading}>
            {siLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Log In</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.switchRow} onPress={() => { setMode('signup'); setSiError(''); }}>
            <Text style={s.switchText}>New here? <Text style={s.switchLink}>Sign up →</Text></Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── SIGN UP ── */}
      {mode === 'signup' && (
        <>
          {/* Sub-tabs — hidden on pending screens */}
          {!(signupTab === 'artist' && mVerifyPending) && !(signupTab === 'venue' && vSignUpState !== 'form') && (
            <View style={s.subTabRow}>
              {(['artist', 'venue'] as const).map(t => (
                <TouchableOpacity key={t}
                  style={[s.subTab, signupTab === t && s.subTabActive]}
                  onPress={() => { setSignupTab(t); setMFieldErrors({}); setVFieldErrors({}); setMError(''); setVError(''); }}
                >
                  <Text style={[s.subTabText, signupTab === t && s.subTabTextActive]}>
                    {t === 'artist' ? 'Artist' : 'Venue'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ARTIST FORM */}
          {signupTab === 'artist' && !mVerifyPending && (
            <>
              <TextInput style={s.input} placeholder="Stage Name (e.g. The Dahlias)" placeholderTextColor="#999"
                value={mStageName} onChangeText={v => { setMStageName(v); if (!mUsernameTouched) setMUsername(slugify(v)); }} autoCapitalize="words" />
              {mFieldErrors.stageName ? <Text style={s.fieldError}>{mFieldErrors.stageName}</Text> : null}

              <TextInput style={s.input} placeholder="Email address" placeholderTextColor="#999"
                value={mEmail} onChangeText={setMEmail} autoCapitalize="none" keyboardType="email-address" />
              {mFieldErrors.email ? <Text style={s.fieldError}>{mFieldErrors.email}</Text> : null}

              <TextInput style={s.input} placeholder="Password" placeholderTextColor="#999"
                value={mPassword} onChangeText={setMPassword} secureTextEntry />
              {mFieldErrors.password ? <Text style={s.fieldError}>{mFieldErrors.password}</Text> : null}

              <TextInput style={s.input} placeholder="Confirm password" placeholderTextColor="#999"
                value={mConfirm} onChangeText={setMConfirm} secureTextEntry />
              {mFieldErrors.confirm ? <Text style={s.fieldError}>{mFieldErrors.confirm}</Text> : null}

              <TextInput style={s.input} placeholder="Username (e.g. thedahlias)" placeholderTextColor="#999"
                value={mUsername} onChangeText={v => { const val = v.toLowerCase().replace(/\s/g, ''); setMUsername(val); setMUsernameTouched(val.length > 0); }} autoCapitalize="none" />
              <Text style={s.hint}>Used to identify you on GigMatch</Text>
              {mFieldErrors.username ? <Text style={s.fieldError}>{mFieldErrors.username}</Text> : null}

              <View style={s.pillRow}>
                {ARTIST_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[s.typePill, mArtistType === t && s.typePillActive]} onPress={() => setMArtistType(t)}>
                    <Text style={[s.typePillText, mArtistType === t && s.typePillTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {mFieldErrors.artistType ? <Text style={s.fieldError}>{mFieldErrors.artistType}</Text> : null}
              {mArtistType === 'Other' && (
                <>
                  <TextInput style={s.input} placeholder="Describe your act (e.g. Acapella Group)" placeholderTextColor="#999"
                    value={mOtherType} onChangeText={setMOtherType} autoCapitalize="words" />
                  {mFieldErrors.otherType ? <Text style={s.fieldError}>{mFieldErrors.otherType}</Text> : null}
                </>
              )}

              <TouchableOpacity style={s.termsRow} onPress={() => setMTerms(v => !v)}>
                <View style={[s.checkbox, mTerms && s.checkboxOn]} />
                <Text style={s.termsText}>I accept the <Text style={{ color: Colors.orange }}>Terms & Conditions</Text></Text>
              </TouchableOpacity>
              {mFieldErrors.terms ? <Text style={s.fieldError}>{mFieldErrors.terms}</Text> : null}

              {mError ? <Text style={s.errorText}>{mError}</Text> : null}
              <TouchableOpacity style={[s.submitBtn, mLoading && s.submitBtnDim]} onPress={handleArtistSignUp} disabled={mLoading}>
                {mLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Create Account</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.switchRow} onPress={() => setMode('login')}>
                <Text style={s.switchText}>Already have an account? <Text style={s.switchLink}>Log in →</Text></Text>
              </TouchableOpacity>
            </>
          )}

          {/* ARTIST VERIFY PENDING */}
          {signupTab === 'artist' && mVerifyPending && (
            <View style={s.verifyWrap}>
              <Text style={s.verifyIcon}>✉️</Text>
              <Text style={s.verifyTitle}>Verify your email to get started</Text>
              <Text style={s.verifySub}>
                We've sent a link to <Text style={{ fontWeight: '700', color: '#111' }}>{mVerifyEmail}</Text>. Click it to confirm your account — you'll be logged in automatically.
              </Text>
              <Text style={s.verifyHint}>Check your spam if you don't see it within a minute.</Text>
              {mResendSent
                ? <Text style={s.resendSent}>Sent!</Text>
                : <TouchableOpacity onPress={handleArtistResend} disabled={mResendLoading}><Text style={s.resendBtn}>{mResendLoading ? 'Sending…' : 'Resend email'}</Text></TouchableOpacity>
              }
              <TouchableOpacity onPress={handleArtistStartOver} style={{ marginTop: 8 }}>
                <Text style={s.startOver}>Wrong email? Start over</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* VENUE FORM */}
          {signupTab === 'venue' && vSignUpState === 'form' && (
            <>
              <View style={{ zIndex: 100 }}>
                <TextInput style={s.input} placeholder="Venue name (e.g. The Tote)" placeholderTextColor="#999"
                  value={vVenueName} onChangeText={handleVenueNameChange}
                  onBlur={() => setTimeout(() => setShowVenueDropdown(false), 150)} autoCapitalize="words" />
                {showVenueDropdown && (
                  <View style={s.venueDrop}>
                    {venueDropdown.map(v => (
                      <TouchableOpacity key={v.id} style={s.venueDropItem} onPress={() => handleVenueSelect(v)}>
                        <Text style={s.venueDropName}>{v.name}</Text>
                        {v.suburb ? <Text style={s.venueDropSub}>{v.suburb}</Text> : null}
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={s.venueDropItem} onPress={() => { setVSelectedVenueId(null); setVAlreadyClaimed(false); setVCurrentOwnerId(''); setShowVenueDropdown(false); }}>
                      <Text style={[s.venueDropName, { color: Colors.orange }]}>This venue isn't listed yet — register as new</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              {vSelectedVenueId !== undefined && (
                <View style={s.selBadge}>
                  <Text style={[s.selBadgeText, { color: vSelectedVenueId !== null ? '#f5a623' : Colors.orange }]}>
                    {vSelectedVenueId !== null ? 'Claiming existing listing' : 'Registering new venue'}
                  </Text>
                </View>
              )}
              {vFieldErrors.venueName ? <Text style={s.fieldError}>{vFieldErrors.venueName}</Text> : null}

              {/* Already-claimed warning */}
              {vAlreadyClaimed && (
                <View style={s.claimWarningBox}>
                  <Text style={s.claimWarningTitle}>This venue is already claimed</Text>
                  <Text style={s.claimWarningBody}>
                    Submitting will start a dispute. The current manager has 7 days to respond. GigMatch admin will oversee the process.
                  </Text>
                </View>
              )}

              <TextInput style={s.input} placeholder="Email address" placeholderTextColor="#999"
                value={vEmail} onChangeText={setVEmail} autoCapitalize="none" keyboardType="email-address" />
              {vFieldErrors.email ? <Text style={s.fieldError}>{vFieldErrors.email}</Text> : null}

              <TextInput style={s.input} placeholder="Password (min 6 characters)" placeholderTextColor="#999"
                value={vPassword} onChangeText={setVPassword} secureTextEntry />
              {vFieldErrors.password ? <Text style={s.fieldError}>{vFieldErrors.password}</Text> : null}

              <TextInput style={s.input} placeholder="Confirm password" placeholderTextColor="#999"
                value={vConfirm} onChangeText={setVConfirm} secureTextEntry />
              {vFieldErrors.confirm ? <Text style={s.fieldError}>{vFieldErrors.confirm}</Text> : null}

              <TextInput style={s.input} placeholder="Username" placeholderTextColor="#999"
                value={vUsername} onChangeText={v => { const val = v.toLowerCase().replace(/\s/g, ''); setVUsername(val); setVUsernameTouched(val.length > 0); }} autoCapitalize="none" />
              <Text style={s.hint}>Used to identify your venue on GigMatch</Text>
              {vFieldErrors.username ? <Text style={s.fieldError}>{vFieldErrors.username}</Text> : null}

              {/* Verification info + manual review option — shown once venue is selected */}
              {vSelectedVenueId !== undefined && (
                <>
                  {!vManualReview ? (
                    <>
                      <Text style={[s.hint, { color: '#444', marginBottom: 4 }]}>
                        Once we review your claim, we'll send a verification code to your email above. You'll enter it on your Profile tab to complete the process.
                      </Text>
                      <TouchableOpacity onPress={() => setVManualReview(true)} activeOpacity={0.7} style={{ marginBottom: 8 }}>
                        <Text style={[s.hint, { color: Colors.orange }]}>
                          I can't be verified by email — request manual review
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={s.manualReviewBox}>
                      <Text style={s.manualReviewTitle}>Manual Review</Text>
                      <Text style={s.manualReviewBody}>
                        Our team will review your claim and contact you directly. You may be asked to provide proof of association with this venue.
                      </Text>
                      <TextInput
                        style={[s.input, { height: 72, textAlignVertical: 'top', paddingTop: 10 }]}
                        placeholder="Tell us your connection to this venue (optional)"
                        placeholderTextColor="#999"
                        value={vManualNotes}
                        onChangeText={setVManualNotes}
                        multiline
                        numberOfLines={3}
                      />
                      <TouchableOpacity onPress={() => { setVManualReview(false); setVManualNotes(''); }} activeOpacity={0.7}>
                        <Text style={[s.hint, { color: Colors.orange }]}>
                          Cancel — verify by email instead
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}

              <TouchableOpacity style={s.termsRow} onPress={() => setVTerms(v => !v)}>
                <View style={[s.checkbox, vTerms && s.checkboxOn]} />
                <Text style={s.termsText}>I accept the <Text style={{ color: Colors.orange }}>Terms & Conditions</Text></Text>
              </TouchableOpacity>
              {vFieldErrors.terms ? <Text style={s.fieldError}>{vFieldErrors.terms}</Text> : null}

              {vError ? <Text style={s.errorText}>{vError}</Text> : null}
              <TouchableOpacity style={[s.submitBtn, vLoading && s.submitBtnDim]} onPress={handleVenueSignUp} disabled={vLoading}>
                {vLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit Application</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.switchRow} onPress={() => setMode('login')}>
                <Text style={s.switchText}>Already approved? <Text style={s.switchLink}>Log in →</Text></Text>
              </TouchableOpacity>
            </>
          )}

          {/* VENUE CLAIM SUBMITTED */}
          {signupTab === 'venue' && vSignUpState === 'claim-submitted' && (
            <View style={s.verifyWrap}>
              <Text style={s.verifyIcon}>⏳</Text>
              <Text style={s.verifyTitle}>Application submitted</Text>
              <Text style={s.verifySub}>
                Your claim for <Text style={{ fontWeight: '700', color: '#111' }}>{vVenueName}</Text> is under review.
              </Text>
              <Text style={s.verifyHint}>
                {vManualReview
                  ? "Our team will be in touch once your claim has been manually reviewed."
                  : `Once approved, we'll send a verification code to ${vEmail.trim()}. Enter it on your Profile tab to complete verification.`}
              </Text>
              <Text style={s.verifyHint}>This usually takes 1–2 business days.</Text>
              <TouchableOpacity style={[s.submitBtn, { marginTop: 20 }]} onPress={() => router.back()}>
                <Text style={s.submitBtnText}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleVenueStartOver} style={{ marginTop: 12 }}>
                <Text style={s.startOver}>Wrong email? Start over</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <Text style={s.support}>Need help? beerbozosupport@gmail.com</Text>
    </>
  );

  // ── Web: overlay + centered card ─────────────────────────────────────
  if (isWeb) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        style={s.overlay}
        onPress={() => router.back()}
      >
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation?.()}>
          <ScrollView
            style={s.cardScroll}
            contentContainerStyle={s.card}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {formContent}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  // ── Native: full-screen modal sheet ──────────────────────────────────
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.nativeContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
          {formContent}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // Web overlay
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  cardScroll: {
    maxHeight: isWeb ? ('85vh' as any) : undefined,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 44,
    width: isWeb ? 460 : undefined,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 20,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },

  // Native full screen
  safe: { flex: 1, backgroundColor: '#ffffff' },
  nativeContent: { padding: 24, paddingBottom: 60 },
  backBtn: { marginBottom: 28 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },

  // Shared
  logoRow: { alignItems: 'center', marginBottom: 8 },
  logoText: { fontSize: 32, fontWeight: '800', color: '#111111', letterSpacing: -1 },
  logoSub:  { fontSize: 14, color: '#666666', marginTop: 4, marginBottom: 28 },

  tabRow: {
    flexDirection: 'row', gap: 6, marginBottom: 24,
    backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4,
  },
  tabBtn:       { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: 'center' },
  tabBtnActive: { backgroundColor: Colors.orange },
  tabText:      { fontSize: 14, fontWeight: '600', color: '#666666' },
  tabTextActive:{ color: '#ffffff' },

  subTabRow: {
    flexDirection: 'row', gap: 8, marginBottom: 20,
    backgroundColor: '#f0f0f0', borderRadius: 10, padding: 4,
  },
  subTab:           { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
  subTabActive:     { backgroundColor: 'rgba(250,131,12,0.12)' },
  subTabText:       { fontSize: 13, fontWeight: '600', color: '#666666' },
  subTabTextActive: { color: Colors.orange },

  input: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 12, paddingHorizontal: 16, fontSize: 15, color: '#111111',
    backgroundColor: '#fafafa', marginBottom: 14,
  },
  hint:       { fontSize: 12, color: '#888888', marginTop: -10, marginBottom: 12 },
  fieldError: { fontSize: 12, color: '#e94560', marginTop: -10, marginBottom: 10 },
  errorText:  { fontSize: 13, color: '#e94560', textAlign: 'center', marginBottom: 12 },

  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typePill: {
    flex: 1, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0',
    paddingVertical: 8, alignItems: 'center',
  },
  typePillActive:     { backgroundColor: Colors.orange, borderColor: Colors.orange },
  typePillText:       { fontSize: 13, fontWeight: '600', color: '#666666' },
  typePillTextActive: { color: '#ffffff' },

  rememberRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  rememberText: { fontSize: 13, color: '#555555' },

  termsRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  checkbox:   { width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  termsText:  { fontSize: 13, color: '#555555', flex: 1 },

  submitBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  submitBtnDim:  { backgroundColor: '#cccccc' },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },

  switchRow: { alignItems: 'center', paddingVertical: 12 },
  switchText:{ fontSize: 13, color: '#666666' },
  switchLink:{ color: Colors.orange, fontWeight: '600' },

  venueDrop: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, backgroundColor: '#ffffff',
    marginTop: -10, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  venueDropItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  venueDropName: { fontSize: 14, fontWeight: '600', color: '#111111' },
  venueDropSub:  { fontSize: 12, color: '#888888' },
  selBadge:     { alignSelf: 'flex-start', borderRadius: 4, backgroundColor: 'rgba(250,131,12,0.1)', borderWidth: 1, borderColor: 'rgba(250,131,12,0.3)', paddingHorizontal: 8, paddingVertical: 3, marginBottom: 12 },
  selBadgeText: { fontSize: 12, fontWeight: '600' },

  verifyWrap:  { alignItems: 'center', paddingVertical: 16 },
  verifyIcon:  { fontSize: 52, marginBottom: 18 },
  verifyTitle: { fontSize: 20, fontWeight: '700', color: '#111111', textAlign: 'center', marginBottom: 12 },
  verifySub:   { fontSize: 14, color: '#444444', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  verifyHint:  { fontSize: 13, color: '#888888', textAlign: 'center', marginBottom: 24 },
  resendBtn:   { fontSize: 13, color: Colors.orange, fontWeight: '600', marginBottom: 8 },
  resendSent:  { fontSize: 13, color: '#2e7d32', fontWeight: '600', marginBottom: 8 },
  startOver:   { fontSize: 12, color: '#888888' },

  support: { textAlign: 'center', fontSize: 12, color: '#888888', marginTop: 20 },

  claimWarningBox: {
    backgroundColor: '#fff5f5', borderRadius: 8, borderWidth: 1, borderColor: '#fca5a5',
    padding: 12, marginBottom: 12,
  },
  claimWarningTitle: { fontSize: 13, fontWeight: '700', color: '#dc2626', marginBottom: 4 },
  claimWarningBody:  { fontSize: 12, color: '#7f1d1d', lineHeight: 18 },

  manualReviewBox: {
    backgroundColor: '#fffbeb', borderRadius: 8, borderWidth: 1, borderColor: '#fde68a',
    padding: 12, marginBottom: 10, gap: 8,
  },
  manualReviewTitle: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  manualReviewBody:  { fontSize: 12, color: '#78350f', lineHeight: 18 },
});
