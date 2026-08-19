import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

export default function HomeScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>GigMatch</Text>
          <Text style={styles.tagline}>Connect venues with musicians</Text>
        </View>

        {/* Main CTAs */}
        <View style={styles.cards}>
          <TouchableOpacity style={styles.card} onPress={() => router.push('/venues')}>
            <Text style={styles.cardIcon}>🎪</Text>
            <Text style={styles.cardTitle}>Find Venues</Text>
            <Text style={styles.cardSub}>Browse venues looking for acts</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.card, styles.cardSecondary]} onPress={() => router.push('/musicians')}>
            <Text style={styles.cardIcon}>🎸</Text>
            <Text style={styles.cardTitle}>Find Musicians</Text>
            <Text style={styles.cardSub}>Discover local acts available to book</Text>
          </TouchableOpacity>
        </View>

        {/* Quick actions based on profile type */}
        {profile?.type === 'artist' && (
          <View style={styles.quickActions}>
            <Text style={styles.sectionTitle}>My Account</Text>
            <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/profile')}>
              <Text style={styles.actionLabel}>My Profile</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/inbox')}>
              <Text style={styles.actionLabel}>Enquiries</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {profile?.type === 'venue' && (
          <View style={styles.quickActions}>
            <Text style={styles.sectionTitle}>My Venue</Text>
            <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/profile')}>
              <Text style={styles.actionLabel}>Dashboard</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/edit-venue')}>
              <Text style={styles.actionLabel}>Edit Venue Profile</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/inbox')}>
              <Text style={styles.actionLabel}>Enquiries</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {!profile && (
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/login')}>
            <Text style={styles.loginBtnText}>Log in / Sign up</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
    marginTop: 8,
  },
  logo: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.orange,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: Colors.grey,
    marginTop: 4,
  },
  cards: {
    gap: 14,
    marginBottom: 32,
  },
  card: {
    backgroundColor: Colors.orange,
    borderRadius: 16,
    padding: 24,
  },
  cardSecondary: {
    backgroundColor: Colors.bgFaint,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.black,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 14,
    color: Colors.grey,
  },
  quickActions: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.greyLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderFaint,
  },
  actionLabel: {
    fontSize: 15,
    color: Colors.black,
    fontWeight: '500',
  },
  actionChevron: {
    fontSize: 20,
    color: Colors.greyLight,
  },
  loginBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.black,
  },
});
