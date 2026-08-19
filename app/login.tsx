import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode]       = useState<'login' | 'signup'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await setDoc(doc(db, 'users', cred.user.uid), {
          email: email.trim(),
          type: 'artist',
          displayName: email.split('@')[0],
          createdAt: new Date().toISOString(),
        });
      }
      router.replace('/');
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </Text>
          <Text style={styles.sub}>GigMatch</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@email.com"
              placeholderTextColor={Colors.greyLight}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={Colors.greyLight}
            />

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.black} />
                : <Text style={styles.submitText}>
                    {mode === 'login' ? 'Log in' : 'Create account'}
                  </Text>
              }
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.switchBtn}
            onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            <Text style={styles.switchText}>
              {mode === 'login'
                ? "Don't have an account? Sign up"
                : 'Already have an account? Log in'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 24, paddingBottom: 60 },
  backBtn: { marginBottom: 32 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.black,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  sub: { fontSize: 15, color: Colors.orange, fontWeight: '700', marginBottom: 32 },
  error: {
    backgroundColor: 'rgba(233,69,96,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.25)',
    borderRadius: 10,
    padding: 12,
    color: Colors.danger,
    fontSize: 13,
    marginBottom: 16,
  },
  form: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.greyLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.bgFaint,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: Colors.black,
  },
  submitBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitText: { fontSize: 16, fontWeight: '700', color: Colors.black },
  switchBtn: { marginTop: 24, alignItems: 'center' },
  switchText: { fontSize: 14, color: Colors.orange, fontWeight: '600' },
});
