import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';

type Venue = {
  id: string;
  name: string;
  suburb?: string;
  state?: string;
  streetAddress?: string;
  description?: string;
  genre?: string[];
  photoUrl?: string;
  phone?: string;
  email?: string;
  website?: string;
  gigNights?: any[];
  rooms?: any[];
};

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [venue, setVenue]   = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'venues', id));
        if (snap.exists()) setVenue({ id: snap.id, ...snap.data() } as Venue);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!venue) {
    return (
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.notFound}>Venue not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView>
        {/* Banner */}
        {venue.photoUrl ? (
          <Image source={{ uri: venue.photoUrl }} style={styles.banner} />
        ) : (
          <View style={styles.bannerPlaceholder}>
            <Text style={styles.bannerPlaceholderText}>No photo</Text>
          </View>
        )}

        {/* Back button overlay */}
        <TouchableOpacity style={styles.backOverlay} onPress={() => router.back()}>
          <Text style={styles.backOverlayText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.name}>{venue.name}</Text>
          {(venue.suburb || venue.state) && (
            <Text style={styles.location}>
              {[venue.suburb, venue.state].filter(Boolean).join(', ')}
            </Text>
          )}

          {(venue.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(venue.genre || []).map((g: string) => (
                <View key={g} style={styles.genrePill}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}

          {venue.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.body}>{venue.description}</Text>
            </View>
          ) : null}

          {(venue.gigNights || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Gig Nights</Text>
              {(venue.gigNights || []).map((night: any, i: number) => (
                <View key={i} style={styles.nightRow}>
                  <Text style={styles.nightDay}>{night.day}</Text>
                  <Text style={styles.nightTime}>{night.startTime}</Text>
                </View>
              ))}
            </View>
          )}

          {(venue.rooms || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rooms</Text>
              {(venue.rooms || []).map((room: any, i: number) => (
                <View key={i} style={styles.roomRow}>
                  <Text style={styles.roomName}>{room.name}</Text>
                  {room.capacity && (
                    <Text style={styles.roomCap}>Cap. {room.capacity}</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Contact */}
          {(venue.phone || venue.email || venue.website) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Contact</Text>
              {venue.phone && <Text style={styles.contact}>{venue.phone}</Text>}
              {venue.email && <Text style={styles.contact}>{venue.email}</Text>}
              {venue.website && <Text style={styles.contact}>{venue.website}</Text>}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  banner: { width: '100%', height: 240 },
  bannerPlaceholder: {
    width: '100%', height: 240,
    backgroundColor: Colors.bgFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  bannerPlaceholderText: { color: Colors.greyLight, fontSize: 14 },
  backOverlay: {
    position: 'absolute',
    top: 16, left: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
  },
  backOverlayText: { fontSize: 14, fontWeight: '600', color: Colors.black },
  backBtn: { padding: 20 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound: { textAlign: 'center', color: Colors.grey, marginTop: 40, fontSize: 15 },
  content: { padding: 20 },
  name: {
    fontSize: 26, fontWeight: '800', color: Colors.black,
    letterSpacing: -0.3, marginBottom: 4,
  },
  location: { fontSize: 14, color: Colors.grey, marginBottom: 12 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  genrePill: {
    borderWidth: 1, borderColor: Colors.orange,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  genreText: { fontSize: 12, color: Colors.orange, fontWeight: '500' },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: Colors.greyLight,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  body: { fontSize: 15, color: Colors.black, lineHeight: 22 },
  nightRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  nightDay: { fontSize: 14, fontWeight: '600', color: Colors.black },
  nightTime: { fontSize: 14, color: Colors.grey },
  roomRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  roomName: { fontSize: 14, fontWeight: '600', color: Colors.black },
  roomCap: { fontSize: 14, color: Colors.grey },
  contact: { fontSize: 14, color: Colors.orange, marginBottom: 4 },
});
