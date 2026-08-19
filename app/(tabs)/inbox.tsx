import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

export default function InboxScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
      </View>
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📭</Text>
        <Text style={styles.emptyTitle}>No enquiries yet</Text>
        <Text style={styles.emptySub}>
          {profile?.type === 'venue'
            ? 'Enquiries from musicians will appear here'
            : 'Your enquiries to venues will appear here'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.black,
    letterSpacing: -0.3,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
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
});
