import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const { colors, isDark, toggleDark } = useTheme();

  const isVenue = profile?.type === 'venue';

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (isVenue && profile?.venueId) {
    return (
      <Redirect href={{ pathname: '/venue/[id]', params: { id: profile.venueId, tab: 'timetable' } }} />
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={[styles.emptyTitle, { color: colors.black }]}>Not signed in</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.push('/login')}>
            <Text style={styles.btnText}>Log in / Sign up</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.black }]}>{profile?.displayName || user.email}</Text>
          <Text style={[styles.sub, { color: colors.grey }]}>Artist</Text>
        </View>

        <View style={[styles.section, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={[styles.row, { borderBottomColor: colors.borderFaint }]} onPress={() => router.push('/edit-profile')}>
            <Text style={[styles.rowLabel, { color: colors.black }]}>Edit My Profile</Text>
            <Text style={[styles.chevron, { color: colors.greyLight }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, { borderBottomColor: colors.borderFaint }]} onPress={() => router.push(`/musician/${user.uid}`)}>
            <Text style={[styles.rowLabel, { color: colors.black }]}>View Public Profile</Text>
            <Text style={[styles.chevron, { color: colors.greyLight }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, { borderBottomColor: colors.borderFaint }]} onPress={() => router.push('/(tabs)/inbox')}>
            <Text style={[styles.rowLabel, { color: colors.black }]}>Enquiries</Text>
            <Text style={[styles.chevron, { color: colors.greyLight }]}>›</Text>
          </TouchableOpacity>

          {/* Dark mode toggle row */}
          <TouchableOpacity style={[styles.row, { borderBottomColor: colors.borderFaint }]} onPress={toggleDark}>
            <Text style={[styles.rowLabel, { color: colors.black }]}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
            <Text style={styles.toggleEmoji}>{isDark ? '🌙' : '☀️'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.logoutBtn, { borderColor: colors.border }]} onPress={() => signOut(auth)}>
          <Text style={[styles.logoutText, { color: colors.grey }]}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  content:     { padding: 24 },
  header:      { marginBottom: 24, marginTop: 8 },
  title:       { fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 },
  sub:         { fontSize: 14, textTransform: 'capitalize' },
  section:     { borderTopWidth: 1, marginBottom: 32 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1,
  },
  rowLabel:    { fontSize: 15, fontWeight: '500' },
  chevron:     { fontSize: 22 },
  toggleEmoji: { fontSize: 18 },
  logoutBtn:   { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
  logoutText:  { fontSize: 15, fontWeight: '600' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:   { fontSize: 48, marginBottom: 16 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', marginBottom: 24 },
  btn:         { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:     { fontSize: 15, fontWeight: '700', color: Colors.black },
});
