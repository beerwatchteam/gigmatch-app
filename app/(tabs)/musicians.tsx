import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
  ScrollView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';

const GENRES = [
  'Rock', 'Jazz', 'Blues', 'Pop', 'Indie', 'Electronic / DJ',
  'Hip-Hop', 'Country', 'Acoustic / Folk', 'Cover Bands',
  'Original', 'Classical', 'Metal', 'Other',
];

const FEE_RANGES = [
  { key: '0-300',    label: '$0–$300' },
  { key: '300-500',  label: '$300–$500' },
  { key: '500-1000', label: '$500–$1,000' },
  { key: '1000+',    label: '$1,000+' },
];

const ACT_TYPES = ['Band', 'Solo', 'Duo', 'DJ', 'Other'];

type Musician = {
  id: string;
  name?: string;
  artistType?: string;
  location?: string;
  genre?: string[];
  about?: string;
  photoUrl?: string;
  feeMin?: number;
  feeMax?: number;
  settings?: { listed?: boolean };
};

const isWeb = Platform.OS === 'web';

export default function MusiciansScreen() {
  const router = useRouter();
  const [musicians, setMusicians]   = useState<Musician[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]       = useState('');
  const [genres, setGenres]       = useState<string[]>([]);
  const [actTypes, setActTypes]   = useState<string[]>([]);
  const [feeRanges, setFeeRanges] = useState<string[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'bandProfiles'));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Musician[];
      setMusicians(data.filter(m => m.settings?.listed !== false));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetFilters() {
    setSearch(''); setGenres([]); setActTypes([]); setFeeRanges([]);
  }

  function toggleActType(t: string) {
    setActTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function toggleFee(key: string) {
    setFeeRanges(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }

  const filtered = musicians.filter(m => {
    if (search && !m.name?.toLowerCase().includes(search.toLowerCase()) &&
        !m.location?.toLowerCase().includes(search.toLowerCase())) return false;

    if (genres.length > 0) {
      const mGenres = m.genre || [];
      if (mGenres.length === 0 || !genres.some(g => mGenres.includes(g))) return false;
    }

    if (feeRanges.length > 0) {
      const vMin = m.feeMin ?? null;
      const vMax = m.feeMax ?? null;
      if (vMin === null && vMax === null) return false;
      const vLo = vMin ?? 0;
      const vHi = vMax ?? Infinity;
      const matchesFee = feeRanges.some(key => {
        if (key === '0-300')    return vHi >= 0    && vLo <= 300;
        if (key === '300-500')  return vHi >= 300  && vLo <= 500;
        if (key === '500-1000') return vHi >= 500  && vLo <= 1000;
        if (key === '1000+')    return vHi >= 1000;
        return false;
      });
      if (!matchesFee) return false;
    }

    if (actTypes.length > 0 && !actTypes.includes(m.artistType || '')) return false;
    return true;
  });

  const Sidebar = (
    <View style={styles.sidebar}>
      <View style={styles.sidebarHead}>
        <Text style={styles.sidebarTitle}>Filters</Text>
        <TouchableOpacity onPress={resetFilters}>
          <Text style={styles.resetAll}>Reset all</Text>
        </TouchableOpacity>
      </View>

      {/* SEARCH */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>SEARCH</Text>
        <TextInput
          style={styles.filterInput}
          placeholder="Name or location…"
          placeholderTextColor="#999999"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* FEE RANGE */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>FEE RANGE</Text>
        {FEE_RANGES.map(r => (
          <TouchableOpacity key={r.key} style={styles.checkRow} onPress={() => toggleFee(r.key)}>
            <View style={[styles.checkbox, feeRanges.includes(r.key) && styles.checkboxOn]} />
            <Text style={styles.checkLabel}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ACT TYPE */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>ACT TYPE</Text>
        {ACT_TYPES.map(t => (
          <TouchableOpacity key={t} style={styles.checkRow} onPress={() => toggleActType(t)}>
            <View style={[styles.checkbox, actTypes.includes(t) && styles.checkboxOn]} />
            <Text style={styles.checkLabel}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* GENRE */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>GENRE</Text>
        <View style={styles.genreGrid}>
          <TouchableOpacity
            style={[styles.genrePill, genres.length === 0 && styles.genrePillActive]}
            onPress={() => setGenres([])}
          >
            <Text style={[styles.genrePillText, genres.length === 0 && styles.genrePillTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {GENRES.map(g => (
            <TouchableOpacity
              key={g}
              style={[styles.genrePill, genres.includes(g) && styles.genrePillActive]}
              onPress={() => toggleGenre(g)}
            >
              <Text style={[styles.genrePillText, genres.includes(g) && styles.genrePillTextActive]}>
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  function MusicianCard({ item }: { item: Musician }) {
    return (
      <View style={styles.card}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.cardPhoto} />
        ) : (
          <View style={styles.cardPhotoPlaceholder}>
            <Text style={{ fontSize: 12, color: '#111111', fontStyle: 'italic' }}>artist photo</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.name || 'Unnamed Act'}</Text>
            {item.artistType && (
              <View style={styles.typeBadge}>
                <Text style={styles.typeText}>{item.artistType}</Text>
              </View>
            )}
          </View>
          {(item.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(item.genre || []).map((g: string) => (
                <View key={g} style={styles.pill}>
                  <Text style={styles.pillText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
          {item.location ? <Text style={styles.location}>{item.location}</Text> : null}
          {item.about ? <Text style={styles.about} numberOfLines={2}>{item.about}</Text> : null}
          <View style={styles.cardFooter}>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push(`/musician/${item.id}`)}
              >
                <Text style={styles.actionBtnText}>Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push({ pathname: '/musician/[id]', params: { id: item.id, tab: 'social' } })}
              >
                <Text style={styles.actionBtnText}>Music & Social</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const Cards = (
    <View style={styles.content}>
      <Text style={styles.pageTitle}>Find your next act</Text>
      <Text style={styles.countText}>
        {filtered.length} musician{filtered.length !== 1 ? 's' : ''} match your filters
      </Text>
      {!isWeb && (
        <TextInput
          style={styles.mobileSearch}
          placeholder="Name or location…"
          placeholderTextColor="#999999"
          value={search}
          onChangeText={setSearch}
        />
      )}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>No musicians match your filters.</Text>
      ) : isWeb ? (
        <View style={styles.grid}>
          {filtered.map(item => (
            <View key={item.id} style={{ width: '49%' }}>
              <MusicianCard item={item} />
            </View>
          ))}
        </View>
      ) : (
        filtered.map(item => <MusicianCard key={item.id} item={item} />)
      )}
    </View>
  );

  if (isWeb) {
    return (
      <View style={styles.page}>
        <ScrollView style={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
          {Sidebar}
        </ScrollView>
        <ScrollView
          style={styles.contentScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        >
          {Cards}
          <View style={{ height: 60 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      >
        {Cards}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  page: { flex: 1, flexDirection: 'row', backgroundColor: '#ffffff' },
  sidebarScroll: {
    width: 280, flexGrow: 0, flexShrink: 0,
    borderRightWidth: 1, borderRightColor: '#eeeeee',
  },
  contentScroll: { flex: 1 },

  sidebar: { padding: 24, paddingTop: 28, paddingBottom: 48 },
  sidebarHead: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 24,
  },
  sidebarTitle: { fontSize: 18, fontWeight: '700', color: '#111111' },
  resetAll: { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  filterSection: { marginBottom: 24 },
  filterLabel: {
    fontSize: 10, fontWeight: '700', color: '#111111',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },
  filterInput: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
    padding: 9, paddingHorizontal: 12, fontSize: 13, color: '#111111',
    backgroundColor: '#fafafa',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  checkbox: {
    width: 15, height: 15, borderRadius: 3,
    borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa',
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkLabel: { fontSize: 13, color: '#111111' },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill: {
    borderRadius: 20, borderWidth: 1, borderColor: '#dddddd',
    paddingHorizontal: 12, paddingVertical: 4,
  },
  genrePillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  genrePillText: { fontSize: 12, color: '#111111' },
  genrePillTextActive: { color: '#ffffff', fontWeight: '600' },

  content: { padding: 36, paddingTop: 32, paddingBottom: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginBottom: 4 },
  countText: { fontSize: 13, color: '#111111', marginBottom: 28 },
  mobileSearch: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 11, paddingHorizontal: 14, fontSize: 15, color: '#111111',
    marginBottom: 16, backgroundColor: '#fafafa',
  },
  empty: { color: '#111111', fontSize: 14, marginTop: 40 },

  card: {
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e8e8e8',
    borderRadius: 12, overflow: 'hidden', marginBottom: isWeb ? 0 : 16,
  },
  cardPhoto: { width: '100%', height: 160 },
  cardPhotoPlaceholder: {
    width: '100%', height: 160, backgroundColor: '#e3e0d8',
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { padding: 18, paddingHorizontal: 20, gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name: { fontSize: 18, fontWeight: '700', color: '#111111' },
  typeBadge: {
    borderRadius: 4, backgroundColor: '#f4f4f4',
    paddingHorizontal: 8, paddingVertical: 2,
  },
  typeText: { fontSize: 11, fontWeight: '600', color: '#111111' },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    borderWidth: 1, borderColor: Colors.orange, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 2,
  },
  pillText: { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  location: { fontSize: 12, color: '#111111' },
  about: { fontSize: 13, color: '#111111', lineHeight: 19 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingTop: 12, marginTop: 4,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    backgroundColor: Colors.orange, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});
