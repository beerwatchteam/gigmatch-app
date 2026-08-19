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

type Musician = {
  id: string;
  name?: string;
  artistType?: string;
  location?: string;
  genre?: string[];
  about?: string;
  photoUrl?: string;
  email?: string;
  instagram?: string;
  spotify?: string;
  songs?: any[];
  gigHistory?: any[];
  upcomingGigs?: any[];
};

export default function MusicianScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [musician, setMusician] = useState<Musician | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'musicians', id));
        if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
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

  if (!musician) {
    return (
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.notFound}>Musician not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView>
        {musician.photoUrl ? (
          <Image source={{ uri: musician.photoUrl }} style={styles.banner} />
        ) : (
          <View style={styles.bannerPlaceholder}>
            <Text style={styles.bannerPlaceholderText}>No photo</Text>
          </View>
        )}

        <TouchableOpacity style={styles.backOverlay} onPress={() => router.back()}>
          <Text style={styles.backOverlayText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{musician.name || 'Unnamed Act'}</Text>
            {musician.artistType && (
              <View style={styles.typePill}>
                <Text style={styles.typeText}>{musician.artistType}</Text>
              </View>
            )}
          </View>

          {musician.location && (
            <Text style={styles.location}>{musician.location}</Text>
          )}

          {(musician.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(musician.genre || []).map((g: string) => (
                <View key={g} style={styles.genrePill}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}

          {musician.about ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.body}>{musician.about}</Text>
            </View>
          ) : null}

          {(musician.songs || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Music</Text>
              {(musician.songs || []).map((song: any, i: number) => (
                <View key={i} style={styles.songRow}>
                  <Text style={styles.songTitle}>{song.title}</Text>
                  {song.url && (
                    <Text style={styles.songLink}>Listen →</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {(musician.upcomingGigs || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming Gigs</Text>
              {(musician.upcomingGigs || []).map((gig: any, i: number) => (
                <View key={i} style={styles.gigRow}>
                  <Text style={styles.gigVenue}>{gig.venue}</Text>
                  <Text style={styles.gigMeta}>{[gig.suburb, gig.date].filter(Boolean).join(' · ')}</Text>
                </View>
              ))}
            </View>
          )}

          {(musician.gigHistory || []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Gig History</Text>
              {(musician.gigHistory || []).map((gig: any, i: number) => (
                <View key={i} style={styles.gigRow}>
                  <Text style={styles.gigVenue}>{gig.venue}</Text>
                  <Text style={styles.gigMeta}>{[gig.suburb, gig.date].filter(Boolean).join(' · ')}</Text>
                </View>
              ))}
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  name: { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3 },
  typePill: {
    backgroundColor: Colors.bgFaint, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  typeText: { fontSize: 12, color: Colors.grey },
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
  songRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  songTitle: { fontSize: 14, fontWeight: '600', color: Colors.black },
  songLink: { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  gigRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  gigVenue: { fontSize: 14, fontWeight: '600', color: Colors.black, marginBottom: 2 },
  gigMeta: { fontSize: 13, color: Colors.grey },
});
