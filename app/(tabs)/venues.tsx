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

const CAPACITY_OPTIONS = [
  { value: 'any',     label: 'Any size' },
  { value: 'u50',     label: 'Under 50' },
  { value: '50-150',  label: '50–150' },
  { value: '150-300', label: '150–300' },
  { value: '300+',    label: '300+' },
];

type Venue = {
  id: string;
  name: string;
  suburb?: string;
  state?: string;
  streetAddress?: string;
  description?: string;
  genre?: string[];
  genres?: string[];
  photoUrl?: string;
  photos?: string[];
  capacity?: number;
  feeMin?: number;
  feeMax?: number;
  slots?: Record<string, { status: string }[]>;
};

const isWeb = Platform.OS === 'web';

export default function VenuesScreen() {
  const router = useRouter();
  const [venues, setVenues]         = useState<Venue[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]       = useState('');
  const [genres, setGenres]       = useState<string[]>([]);
  const [feeRanges, setFeeRanges] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd]     = useState('');
  const [capacity, setCapacity]   = useState('any');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'venues'));
      setVenues(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Venue[]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetFilters() {
    setSearch(''); setGenres([]); setFeeRanges([]);
    setDateStart(''); setDateEnd(''); setCapacity('any');
  }

  function toggleFee(key: string) {
    setFeeRanges(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }

  const filtered = venues.filter(v => {
    if (search && !v.name?.toLowerCase().includes(search.toLowerCase()) &&
        !v.suburb?.toLowerCase().includes(search.toLowerCase())) return false;

    if (genres.length > 0) {
      const vGenres = v.genre || v.genres || [];
      if (vGenres.length === 0 || !genres.some(g => vGenres.includes(g))) return false;
    }

    if (feeRanges.length > 0) {
      const vMin = v.feeMin ?? null;
      const vMax = v.feeMax ?? null;
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

    if (capacity !== 'any') {
      const cap = v.capacity ?? null;
      if (cap === null) return false;
      if (capacity === 'u50'     && cap >= 50)               return false;
      if (capacity === '50-150'  && (cap < 50  || cap > 150)) return false;
      if (capacity === '150-300' && (cap < 150 || cap > 300)) return false;
      if (capacity === '300+'    && cap < 300)               return false;
    }

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
          placeholder="Venue, suburb or postcode…"
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

      {/* AVAILABILITY */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>AVAILABILITY</Text>
        <Text style={styles.filterSubLabel}>From</Text>
        <TextInput
          style={[styles.filterInput, { marginBottom: 8 }]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#999999"
          value={dateStart}
          onChangeText={setDateStart}
        />
        <Text style={styles.filterSubLabel}>To</Text>
        <TextInput
          style={styles.filterInput}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#999999"
          value={dateEnd}
          onChangeText={setDateEnd}
        />
      </View>

      {/* CAPACITY */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>CAPACITY</Text>
        <View style={styles.genreGrid}>
          {CAPACITY_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.value}
              style={[styles.genrePill, capacity === o.value && styles.genrePillActive]}
              onPress={() => setCapacity(o.value)}
            >
              <Text style={[styles.genrePillText, capacity === o.value && styles.genrePillTextActive]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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

  function VenueCard({ item }: { item: Venue }) {
    const photo = item.photoUrl || (item.photos && item.photos[0]);
    const address = [item.streetAddress, item.suburb, item.state].filter(Boolean).join(', ');
    return (
      <View style={styles.card}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.cardPhoto} />
        ) : (
          <View style={styles.cardPhotoPlaceholder}>
            <Text style={styles.placeholderText}>venue photo</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.venueName}>{item.name}</Text>
          {address ? <Text style={styles.venueAddress}>{address}</Text> : null}
          {(item.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(item.genre || []).slice(0, 6).map((g: string) => (
                <View key={g} style={styles.pill}>
                  <Text style={styles.pillText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
          {item.description ? (
            <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View style={styles.cardFooter}>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push(`/venue/${item.id}`)}
              >
                <Text style={styles.actionBtnText}>Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
              >
                <Text style={styles.actionBtnText}>Timetable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const Content = (
    <View style={styles.content}>
      <Text style={styles.pageTitle}>Find your next gig</Text>
      <Text style={styles.countText}>
        {filtered.length} venue{filtered.length !== 1 ? 's' : ''} match your filters
      </Text>

      {!isWeb && (
        <TextInput
          style={styles.mobileSearch}
          placeholder="Venue, suburb or postcode…"
          placeholderTextColor="#999999"
          value={search}
          onChangeText={setSearch}
        />
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>No venues match your filters.</Text>
      ) : isWeb ? (
        <View style={styles.grid}>
          {filtered.map(item => (
            <View key={item.id} style={{ width: '49%' }}>
              <VenueCard item={item} />
            </View>
          ))}
        </View>
      ) : (
        filtered.map(item => <VenueCard key={item.id} item={item} />)
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
          {Content}
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
        {Content}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  // Web two-column layout
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
  filterSubLabel: {
    fontSize: 10, fontWeight: '700', color: '#111111',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
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

  // Content area
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
    width: '100%', height: 160, backgroundColor: '#e8e3d8',
    alignItems: 'center', justifyContent: 'center',
  },
  placeholderText: { fontSize: 12, color: '#111111', fontStyle: 'italic' },
  cardBody: { padding: 18, paddingHorizontal: 20, gap: 8 },
  venueName: { fontSize: 18, fontWeight: '700', color: '#111111' },
  venueAddress: { fontSize: 12, color: '#111111' },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    borderWidth: 1, borderColor: Colors.orange, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 2,
  },
  pillText: { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  desc: { fontSize: 13, color: '#111111', lineHeight: 19 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
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
