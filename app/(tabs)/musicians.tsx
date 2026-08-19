import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
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
  settings?: { listed?: boolean };
};

export default function MusiciansScreen() {
  const router = useRouter();
  const [musicians, setMusicians] = useState<Musician[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(collection(db, 'musicians'));
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Musician[];
        setMusicians(data.filter(m => m.settings?.listed !== false));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = musicians.filter(m =>
    !search ||
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.location?.toLowerCase().includes(search.toLowerCase()) ||
    (m.genre || []).some((g: string) => g.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Find Musicians</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by name, location or genre…"
          placeholderTextColor={Colors.greyLight}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/musician/${item.id}`)}
            >
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{item.name || 'Unnamed Act'}</Text>
                  {item.artistType && (
                    <View style={styles.typePill}>
                      <Text style={styles.typeText}>{item.artistType}</Text>
                    </View>
                  )}
                </View>
                {item.location && (
                  <Text style={styles.location}>{item.location}</Text>
                )}
                {item.about ? (
                  <Text style={styles.about} numberOfLines={2}>{item.about}</Text>
                ) : null}
                {(item.genre || []).length > 0 && (
                  <View style={styles.genres}>
                    {(item.genre || []).slice(0, 3).map((g: string) => (
                      <View key={g} style={styles.genrePill}>
                        <Text style={styles.genreText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No musicians found.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    padding: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.black,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  search: {
    backgroundColor: Colors.bgFaint,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.black,
  },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  name: { fontSize: 16, fontWeight: '700', color: Colors.black },
  typePill: {
    backgroundColor: Colors.bgFaint,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeText: { fontSize: 11, color: Colors.grey },
  location: { fontSize: 13, color: Colors.grey, marginBottom: 4 },
  about: { fontSize: 13, color: Colors.grey, lineHeight: 18, marginBottom: 8 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill: {
    borderWidth: 1,
    borderColor: Colors.orange,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  genreText: { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  chevron: { fontSize: 22, color: Colors.greyLight, marginLeft: 8 },
  empty: { textAlign: 'center', color: Colors.grey, marginTop: 40, fontSize: 15 },
});
