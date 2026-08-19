import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  const isVenue  = profile?.type === 'venue';

  // Still resolving auth — show minimal spinner
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  // Venue users go straight to their venue profile (synchronous redirect, no flash)
  if (isVenue && profile?.venueId) {
    return (
      <Redirect
        href={{ pathname: '/venue/[id]', params: { id: profile.venueId, tab: 'timetable' } }}
      />
    );
  }

  // Not signed in
  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={styles.emptyTitle}>Not signed in</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.push('/login')}>
            <Text style={styles.btnText}>Log in / Sign up</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Artist view
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{profile?.displayName || user.email}</Text>
          <Text style={styles.sub}>Artist</Text>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/edit-profile')}>
            <Text style={styles.rowLabel}>Edit My Profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/musician/${user.uid}`)}>
            <Text style={styles.rowLabel}>View Public Profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/(tabs)/inbox')}>
            <Text style={styles.rowLabel}>Enquiries</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={() => signOut(auth)}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.bg },
  content:   { padding: 24 },
  header:    { marginBottom: 24, marginTop: 8 },
  title:     { fontSize: 24, fontWeight: '800', color: Colors.black, letterSpacing: -0.3, marginBottom: 4 },
  sub:       { fontSize: 14, color: Colors.grey, textTransform: 'capitalize' },
  section:   { borderTopWidth: 1, borderTopColor: Colors.border, marginBottom: 32 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  rowLabel:  { fontSize: 15, color: Colors.black, fontWeight: '500' },
  chevron:   { fontSize: 22, color: Colors.greyLight },
  logoutBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, alignItems: 'center' },
  logoutText:{ fontSize: 15, color: Colors.grey, fontWeight: '600' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle:{ fontSize: 18, fontWeight: '700', color: Colors.black, marginBottom: 24 },
  btn:       { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:   { fontSize: 15, fontWeight: '700', color: Colors.black },
});
