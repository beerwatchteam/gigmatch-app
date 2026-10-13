import { useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ActivityIndicator, Image, ScrollView, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { getDocs, query, collection, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';

const isWeb = Platform.OS === 'web';

const DEMO_ACCOUNTS = {
  artist: { username: 'twayloartist', password: 'twayloartist' },
  venue:  { username: 'twaylovenue',  password: 'twaylovenue'  },
} as const;

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

export default function DemoScreen() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState<'artist' | 'venue' | null>(null);
  const [error, setError] = useState('');

  async function handleDemoLogin(role: 'artist' | 'venue') {
    setLoadingRole(role);
    setError('');
    try {
      const { username, password } = DEMO_ACCOUNTS[role];
      const email = await resolveUsernameToEmail(username);
      if (!email) { setError('Demo account unavailable. Please try again shortly.'); return; }
      if (isWeb) {
        await setPersistence(auth, browserSessionPersistence);
      }
      await signInWithEmailAndPassword(auth, email, password);
      router.replace('/(tabs)');
    } catch {
      setError('Could not load the demo. Please try again.');
    } finally {
      setLoadingRole(null);
    }
  }

  const content = (
    <ScrollView
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={s.logoWrap}>
        <Image
          source={require('../assets/logo.png')}
          style={s.logo}
          resizeMode="contain"
          accessibilityLabel="Twaylo"
        />
        <Text style={s.tagline}>The live music booking platform</Text>
      </View>

      {/* Intro */}
      <View style={s.introWrap}>
        <Text style={s.introHeading}>Try it out</Text>
        <Text style={s.introSub}>
          Jump straight in as a demo user. No sign-up needed.
        </Text>
      </View>

      {/* Cards */}
      <View style={s.cardsRow}>
        {/* Artist card */}
        <TouchableOpacity
          style={[s.card, s.cardArtist]}
          onPress={() => handleDemoLogin('artist')}
          disabled={loadingRole !== null}
          activeOpacity={0.85}
        >
          <Text style={s.cardChip}>ARTIST</Text>
          <Text style={s.cardTitle}>See it as an Artist</Text>
          <Text style={s.cardDesc}>
            Browse venues, check band nights, and send booking enquiries just like a real musician would.
          </Text>
          <View style={[s.cardBtn, s.cardBtnArtist]}>
            {loadingRole === 'artist'
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.cardBtnText}>Enter as Artist</Text>
            }
          </View>
        </TouchableOpacity>

        {/* Venue card */}
        <TouchableOpacity
          style={[s.card, s.cardVenue]}
          onPress={() => handleDemoLogin('venue')}
          disabled={loadingRole !== null}
          activeOpacity={0.85}
        >
          <Text style={[s.cardChip, s.cardChipVenue]}>VENUE</Text>
          <Text style={[s.cardTitle, { color: '#ffffff' }]}>See it as a Venue</Text>
          <Text style={[s.cardDesc, { color: 'rgba(255,255,255,0.72)' }]}>
            Manage a timetable, review incoming enquiries, and see what the venue side of the platform looks like.
          </Text>
          <View style={[s.cardBtn, s.cardBtnVenue]}>
            {loadingRole === 'venue'
              ? <ActivityIndicator color="#111" />
              : <Text style={[s.cardBtnText, { color: '#111111' }]}>Enter as Venue</Text>
            }
          </View>
        </TouchableOpacity>
      </View>

      {error ? <Text style={s.errorText}>{error}</Text> : null}

      {/* Divider */}
      <View style={s.dividerRow}>
        <View style={s.dividerLine} />
        <Text style={s.dividerLabel}>or</Text>
        <View style={s.dividerLine} />
      </View>

      {/* Sign up / Log in */}
      <View style={s.authRow}>
        <TouchableOpacity
          style={s.signUpBtn}
          onPress={() => router.push('/login?mode=signup')}
          activeOpacity={0.85}
        >
          <Text style={s.signUpBtnText}>Create an account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.logInBtn}
          onPress={() => router.push('/login')}
          activeOpacity={0.85}
        >
          <Text style={s.logInBtnText}>Log in</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.demoNote}>
        Demo accounts are read-only showcases. Your activity won't affect real data.
      </Text>
    </ScrollView>
  );

  if (isWeb) {
    return (
      <View style={s.webWrap}>
        <View style={s.webInner}>{content}</View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {content}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#ffffff' },
  webWrap: { flex: 1, backgroundColor: '#f5f5f3', alignItems: 'center', justifyContent: 'flex-start', paddingVertical: 40, paddingHorizontal: 16 },
  webInner:{ width: '100%', maxWidth: 780 },

  scroll: {
    paddingHorizontal: isWeb ? 0 : 24,
    paddingBottom: 60,
    paddingTop: isWeb ? 0 : 40,
  },

  // Logo
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logo:     { width: isWeb ? 160 : 150, height: isWeb ? 63 : 60, marginBottom: 8 },
  tagline:  { fontSize: 14, color: '#888888', letterSpacing: 0.2 },

  // Intro
  introWrap:    { alignItems: 'center', marginBottom: 28 },
  introHeading: { fontSize: isWeb ? 30 : 26, fontWeight: '700', color: '#111111', marginBottom: 8, textAlign: 'center' },
  introSub:     { fontSize: 15, color: '#666666', textAlign: 'center', lineHeight: 22 },

  // Cards
  cardsRow: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 16,
    marginBottom: 20,
  },
  card: {
    flex: isWeb ? 1 : undefined,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
  },
  cardArtist: {
    backgroundColor: '#ffffff',
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  cardVenue: {
    backgroundColor: '#1a1a1a',
    borderColor: '#2a2a2a',
  },

  cardChip: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.orange,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  cardChipVenue: {
    color: 'rgba(255,255,255,0.5)',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 10,
  },
  cardDesc: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 21,
    marginBottom: 20,
  },
  cardBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cardBtnArtist: {
    backgroundColor: Colors.orange,
  },
  cardBtnVenue: {
    backgroundColor: '#ffffff',
  },
  cardBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },

  errorText: {
    fontSize: 13,
    color: Colors.danger,
    textAlign: 'center',
    marginBottom: 12,
  },

  // Divider
  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e8e8e8' },
  dividerLabel:{ fontSize: 13, color: '#aaaaaa', marginHorizontal: 12 },

  // Auth row
  authRow: {
    flexDirection: isWeb ? 'row' : 'column',
    gap: 10,
    marginBottom: 20,
  },
  signUpBtn: {
    flex: isWeb ? 1 : undefined,
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signUpBtnText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },

  logInBtn: {
    flex: isWeb ? 1 : undefined,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  logInBtnText: { fontSize: 15, fontWeight: '600', color: '#111111' },

  demoNote: {
    fontSize: 12,
    color: '#aaaaaa',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: isWeb ? 40 : 0,
  },
});
