import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Linking, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const isWeb = Platform.OS === 'web';
const MAX_DESC = 320;

const PLATFORMS = [
  { key: 'instagram',  label: 'Instagram'   },
  { key: 'tiktok',     label: 'TikTok'      },
  { key: 'spotify',    label: 'Spotify'     },
  { key: 'appleMusic', label: 'Apple Music' },
];

type CustomLink = { label: string; url: string };
type Song      = { title?: string; url?: string };
type GigEntry  = { venue?: string; suburb?: string; date?: string; attendance?: number; notes?: string };

type Musician = {
  id: string;
  name?: string;
  username?: string;
  artistType?: string | string[];
  location?: string;
  genre?: string[];
  about?: string;
  photoUrl?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  tiktok?: string;
  spotify?: string;
  appleMusic?: string;
  website?: string;
  customLinks?: CustomLink[];
  songs?: Song[];
  photos?: string[];
  videos?: string[];
  gigHistory?: GigEntry[];
  upcomingGigs?: GigEntry[];
  feeMin?: number;
  feeMax?: number;
};

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ m }: { m: Musician }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const about          = m.about || '';
  const shouldTruncate = about.length > MAX_DESC;

  const upcomingGigs = (m.upcomingGigs || []).filter(g => g.venue || g.date);
  const gigHistory   = (m.gigHistory   || []).filter(g => g.venue || g.date);

  const socialLinks = PLATFORMS.filter(p => (m as any)[p.key]);
  const customLinks = (m.customLinks || []).filter(l => l.label && l.url);
  const hasContact  = !!(m.email || m.phone);
  const hasSocials  = socialLinks.length > 0 || customLinks.length > 0;
  const hasSidebar  = hasContact || hasSocials || m.feeMin != null || m.feeMax != null;

  const sidebar = (
    <>
      {(hasContact || hasSocials) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          {hasContact && (
            <>
              <Text style={[styles.sideCardTitle, { color: colors.greyLight }]}>Contact</Text>
              {m.email && (
                <TouchableOpacity onPress={() => Linking.openURL(`mailto:${m.email}`)}>
                  <Text style={styles.sideLink}>{m.email}</Text>
                </TouchableOpacity>
              )}
              {m.phone && (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${m.phone}`)}>
                  <Text style={styles.sideLink}>{m.phone}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {hasSocials && (
            <>
              <Text style={[styles.sideCardTitle, { color: colors.greyLight }, hasContact && { marginTop: 16 }]}>Socials</Text>
              {socialLinks.map(p => (
                <TouchableOpacity key={p.key} onPress={() => Linking.openURL((m as any)[p.key])}>
                  <Text style={styles.sideLink}>{p.label} →</Text>
                </TouchableOpacity>
              ))}
              {customLinks.map((link, i) => (
                <TouchableOpacity key={i} onPress={() => Linking.openURL(link.url)}>
                  <Text style={styles.sideLink}>{link.label} →</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}

      {(m.feeMin != null || m.feeMax != null) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideCardTitle, { color: colors.greyLight }]}>Fee</Text>
          <Text style={[styles.feeText, { color: colors.black }]}>
            {m.feeMin != null && m.feeMax != null
              ? `$${m.feeMin.toLocaleString()} – $${m.feeMax.toLocaleString()}`
              : m.feeMin != null
                ? `From $${m.feeMin.toLocaleString()}`
                : `Up to $${m.feeMax!.toLocaleString()}`}
          </Text>
        </View>
      )}
    </>
  );

  const main = (
    <>
      {about ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>ABOUT</Text>
          <Text style={[styles.body, { color: colors.black }]}>
            {shouldTruncate && !expanded ? about.slice(0, MAX_DESC) + '…' : about}
          </Text>
          {shouldTruncate && (
            <TouchableOpacity onPress={() => setExpanded(e => !e)}>
              <Text style={styles.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {upcomingGigs.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>UPCOMING GIGS</Text>
          {upcomingGigs.map((gig, i) => (
            <View key={i} style={[styles.gigRow, { borderBottomColor: colors.borderFaint }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.gigVenue, { color: colors.black }]}>{gig.venue}</Text>
                <Text style={[styles.gigMeta, { color: colors.grey }]}>
                  {[gig.suburb, gig.date].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {gigHistory.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>GIG HISTORY</Text>
          {gigHistory.map((gig, i) => (
            <View key={i} style={[styles.gigRow, { borderBottomColor: colors.borderFaint }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.gigVenue, { color: colors.black }]}>{gig.venue}</Text>
                <Text style={[styles.gigMeta, { color: colors.grey }]}>
                  {[gig.suburb, gig.date].filter(Boolean).join(' · ')}
                </Text>
                {gig.notes ? <Text style={[styles.gigNotes, { color: colors.greyLight }]}>{gig.notes}</Text> : null}
              </View>
              {gig.attendance ? (
                <Text style={styles.gigAttendance}>{gig.attendance} ppl</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {!about && upcomingGigs.length === 0 && gigHistory.length === 0 && (
        <Text style={[styles.emptyState, { color: colors.greyLight }]}>No info listed yet.</Text>
      )}
    </>
  );

  if (isWeb) {
    return (
      <View style={styles.overviewLayout}>
        <View style={styles.overviewMain}>{main}</View>
        {hasSidebar && <View style={styles.overviewSidebar}>{sidebar}</View>}
      </View>
    );
  }

  return (
    <>
      {hasSidebar && <View style={styles.content}>{sidebar}</View>}
      <View style={styles.content}>{main}</View>
    </>
  );
}

// ── Music & Social Tab ────────────────────────────────────────────

function MusicTab({ m }: { m: Musician }) {
  const { colors } = useTheme();
  const songs = (m.songs || []).filter(s => s.title);
  const displayPhotos = [
    ...(m.photoUrl ? [m.photoUrl] : []),
    ...(m.photos || []).filter(url => url !== m.photoUrl),
  ];
  const hasMedia = displayPhotos.length > 0 || (m.videos || []).length > 0;

  return (
    <View style={styles.content}>
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>SONGS</Text>
        {songs.length > 0 ? (
          songs.map((song, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.songRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => song.url && Linking.openURL(song.url)}
              disabled={!song.url}
            >
              <Text style={[styles.songTitle, { color: colors.black }]}>{song.title}</Text>
              {song.url && <Text style={styles.songLink}>Listen →</Text>}
            </TouchableOpacity>
          ))
        ) : (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No songs listed yet.</Text>
        )}
      </View>

      {hasMedia && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>PHOTOS & VIDEOS</Text>
          {displayPhotos.length > 0 && (
            <>
              <Text style={[styles.mediaSub, { color: colors.grey }]}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
                {displayPhotos.map((url, i) => (
                  <Image key={i} source={{ uri: url }} style={styles.photoThumb} />
                ))}
              </ScrollView>
            </>
          )}
          {(m.videos || []).length > 0 && (
            <>
              <Text style={[styles.mediaSub, { color: colors.grey, marginTop: 16 }]}>Videos</Text>
              {(m.videos || []).map((url, i) => (
                <TouchableOpacity key={i} style={[styles.videoCard, { borderColor: colors.border }]} onPress={() => Linking.openURL(url)}>
                  <Text style={styles.videoCardText}>Watch video {i + 1} →</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────

export default function MusicianScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router  = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/musicians');
  const [musician, setMusician]   = useState<Musician | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'music'>(
    initialTab === 'music' ? 'music' : 'overview'
  );

  const isOwn = user?.uid === id;

  useEffect(() => {
    getDoc(doc(db, 'bandProfiles', id)).then(snap => {
      if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!musician) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.notFound, { color: colors.grey }]}>Musician not found.</Text>
      </SafeAreaView>
    );
  }

  const actType = Array.isArray(musician.artistType)
    ? musician.artistType.join(' / ')
    : musician.artistType;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <ScrollView>
        {/* Hero banner */}
        {musician.photoUrl ? (
          <Image source={{ uri: musician.photoUrl }} style={styles.banner} />
        ) : (
          <View style={styles.bannerPlaceholder} />
        )}

        {/* Back button overlay */}
        <SafeAreaView edges={['top']} style={styles.backOverlayWrap}>
          <TouchableOpacity style={styles.backOverlay} onPress={handleBack}>
            <Text style={styles.backOverlayText}>← Back</Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Profile header */}
        <View style={styles.profileHead}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.black }]}>{musician.name || 'Unnamed Act'}</Text>
            {actType ? (
              <View style={styles.typePill}>
                <Text style={styles.typeText}>{actType}</Text>
              </View>
            ) : null}
            {isOwn && (
              <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/edit-profile')}>
                <Text style={styles.editBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            )}
          </View>
          {musician.username ? <Text style={[styles.username, { color: colors.grey }]}>@{musician.username}</Text> : null}
          {musician.location ? <Text style={[styles.location, { color: colors.grey }]}>{musician.location}</Text> : null}
          {(musician.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(musician.genre || []).map(g => (
                <View key={g} style={styles.genrePill}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
          {([
            { id: 'overview', label: 'Overview'       },
            { id: 'music',    label: 'Music & Social' },
          ] as const).map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.tabText, { color: colors.grey }, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'overview'
          ? <OverviewTab m={musician} />
          : <MusicTab m={musician} />
        }

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: Colors.bg },
  banner:            { width: '100%', height: 280 },
  bannerPlaceholder: { width: '100%', height: 280, backgroundColor: Colors.bgFaint },

  backOverlayWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  backOverlay: {
    alignSelf: 'flex-start',
    margin: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
  },
  backOverlayText: { fontSize: 14, fontWeight: '600', color: Colors.black },
  backBtn:  { padding: 20 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound: { textAlign: 'center', color: Colors.grey, marginTop: 40, fontSize: 15 },

  profileHead: { padding: 20, paddingBottom: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' },
  name:    { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3 },
  typePill: {
    backgroundColor: '#f4f4f4',
    borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#e0e0e0',
  },
  typeText:    { fontSize: 12, color: '#555555', fontWeight: '600' },
  editBtn:     { marginLeft: 'auto', backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  editBtnText: { fontSize: 13, fontWeight: '700', color: Colors.black },
  username:    { fontSize: 13, color: Colors.grey, marginBottom: 2 },
  location:    { fontSize: 14, color: Colors.grey, marginBottom: 12 },
  genres:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  genrePill:   { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  genreText:   { fontSize: 12, color: Colors.orange, fontWeight: '500' },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginTop: 16,
  },
  tab:          { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:    { borderBottomColor: Colors.orange },
  tabText:      { fontSize: 15, fontWeight: '600', color: Colors.grey },
  tabTextActive:{ color: Colors.black },

  // Two-column layout (web only)
  overviewLayout: {
    flexDirection: isWeb ? 'row' : 'column',
    alignItems: 'flex-start',
    padding: isWeb ? 24 : 0,
    gap: isWeb ? 32 : 0,
  },
  overviewMain:    { flex: 1 },
  overviewSidebar: { width: isWeb ? 280 : undefined },

  content:      { padding: 20 },
  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.greyLight,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  body:    { fontSize: 15, color: Colors.black, lineHeight: 22 },
  readMore:{ fontSize: 14, color: Colors.orange, fontWeight: '600', marginTop: 8 },
  emptyState: { fontSize: 14, color: Colors.greyLight, fontStyle: 'italic' },

  gigRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  gigVenue:      { fontSize: 14, fontWeight: '600', color: Colors.black, marginBottom: 2 },
  gigMeta:       { fontSize: 13, color: Colors.grey },
  gigNotes:      { fontSize: 13, color: Colors.greyLight, marginTop: 2 },
  gigAttendance: { fontSize: 13, color: Colors.orange, fontWeight: '600' },

  // Sidebar cards
  sideCard: {
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 16, marginBottom: 16,
  },
  sideCardTitle: { fontSize: 11, fontWeight: '700', color: Colors.greyLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  sideLink:      { fontSize: 14, color: Colors.orange, fontWeight: '500', marginBottom: 8 },
  feeText:       { fontSize: 18, fontWeight: '700', color: Colors.black },

  // Music tab
  songRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  songTitle:{ fontSize: 14, fontWeight: '600', color: Colors.black },
  songLink: { fontSize: 13, color: Colors.orange, fontWeight: '600' },

  mediaSub:   { fontSize: 13, fontWeight: '600', color: Colors.grey, marginBottom: 10 },
  photoRow:   { marginBottom: 4 },
  photoThumb: { width: 140, height: 100, borderRadius: 8, marginRight: 10, backgroundColor: Colors.bgFaint },

  videoCard:     { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 14, marginBottom: 8 },
  videoCardText: { fontSize: 14, color: Colors.orange, fontWeight: '600' },
});
