import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';

export default function EditProfileScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
      </View>
      <View style={styles.center}>
        <Text style={styles.placeholder}>Artist profile editor coming soon</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  back: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: Colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholder: { fontSize: 15, color: Colors.grey },
});
