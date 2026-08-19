import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

type Musician = {
  id: string;
  name?: string;
  username?: string;
  artistType?: string;
  location?: string;
  genre?: string[];
  about?: string;
  photoUrl?: string;
  email?: string;
  instagram?: string;
  spotify?: string;
  appleMusic?: string;
  website?: string;
  songs?: any[];
  gigHistory?: any[];
  upcomingGigs?: any[];
  techRider?: Record<string, any>;
  feeMin?: number;
  feeMax?: number;
};

export default function MusicianScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router  = useRouter();
  const { user } = useAuth();
  const [musician, setMusician] = useState<Musician | null>(null);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'social'>(
    initialTab === 'social' ? 'social' : 'overview'
  );

  const isOwn = user?.uid === id;

  useEffect(() => {
    getDoc(doc(db, 'bandProfiles', id)).then(snap => {
      if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
    }).catch(console.error).finally(() => setLoading(false));
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

  const hasSocials = musician.email || musician.instagram || musician.spotify || musician.appleMusic || musician.website;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView>
        {/* Banner */}
        {musician.photoUrl ? (
          <Image source={{ uri: musician.photoUrl }} style={styles.banner} />
        ) : (
          <View style={styles.bannerPlaceholder} />
        )}

        {/* Back button overlay */}
        <SafeAreaView edges={['top']} style={styles.backOverlayWrap}>
          <TouchableOpacity style={styles.backOverlay} onPress={() => router.back()}>
            <Text style={styles.backOverlayText}>← Back</Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Profile header */}
        <View style={styles.profileHead}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{musician.name || 'Unnamed Act'}</Text>
            {musician.artistType && (
              <View style={styles.typePill}>
                <Text style={styles.typeText}>{musician.artistType}</Text>
              </View>
            )}
            {isOwn && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => router.push('/edit-profile')}
              >
                <Text style={styles.editBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            )}
          </View>

          {musician.username ? (
            <Text style={styles.username}>@{musician.username}</Text>
          ) : null}
          {musician.location ? (
            <Text style={styles.location}>{musician.location}</Text>
          ) : null}

          {(musician.genre || []).length > 0 && (
            <View style={styles.genres}>
              {(musician.genre || []).map((g: string) => (
                <View key={g} style={styles.genrePill}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Tab bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
            onPress={() => setActiveTab('overview')}
          >
            <Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>
              Overview
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'social' && styles.tabActive]}
            onPress={() => setActiveTab('social')}
          >
            <Text style={[styles.tabText, activeTab === 'social' && styles.tabTextActive]}>
              Music & Social
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab content */}
        <View style={styles.content}>
          {activeTab === 'overview' ? (
            <>
              {/* About */}
              {musician.about ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>ABOUT</Text>
                  <Text style={styles.body}>{musician.about}</Text>
                </View>
              ) : null}

              {/* Gig History */}
              {(musician.gigHistory || []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>GIG HISTORY</Text>
                  {(musician.gigHistory || []).map((gig: any, i: number) => (
                    <View key={i} style={styles.gigRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gigVenue}>{gig.venue}</Text>
                        <Text style={styles.gigMeta}>
                          {[gig.suburb, gig.date].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {gig.attendance ? (
                        <Text style={styles.gigAttendance}>{gig.attendance} ppl</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {/* Upcoming Gigs */}
              {(musician.upcomingGigs || []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>UPCOMING GIGS</Text>
                  {(musician.upcomingGigs || []).map((gig: any, i: number) => (
                    <View key={i} style={styles.gigRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gigVenue}>{gig.venue}</Text>
                        <Text style={styles.gigMeta}>
                          {[gig.suburb, gig.date].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              {/* Music */}
              {(musician.songs || []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>MUSIC</Text>
                  {(musician.songs || []).map((song: any, i: number) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.songRow}
                      onPress={() => song.url && Linking.openURL(song.url)}
                      disabled={!song.url}
                    >
                      <Text style={styles.songTitle}>{song.title}</Text>
                      {song.url && <Text style={styles.songLink}>Listen →</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Socials */}
              {hasSocials && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>CONTACT</Text>
                  {musician.email ? (
                    <TouchableOpacity onPress={() => Linking.openURL(`mailto:${musician.email}`)}>
                      <Text style={styles.socialLink}>{musician.email}</Text>
                    </TouchableOpacity>
                  ) : null}

                  <Text style={[styles.sectionLabel, { marginTop: 16 }]}>SOCIALS</Text>
                  {musician.instagram ? (
                    <TouchableOpacity onPress={() => Linking.openURL(musician.instagram!)}>
                      <Text style={styles.socialLink}>Instagram →</Text>
                    </TouchableOpacity>
                  ) : null}
                  {musician.spotify ? (
                    <TouchableOpacity onPress={() => Linking.openURL(musician.spotify!)}>
                      <Text style={styles.socialLink}>Spotify →</Text>
                    </TouchableOpacity>
                  ) : null}
                  {musician.appleMusic ? (
                    <TouchableOpacity onPress={() => Linking.openURL(musician.appleMusic!)}>
                      <Text style={styles.socialLink}>Apple Music →</Text>
                    </TouchableOpacity>
                  ) : null}
                  {musician.website ? (
                    <TouchableOpacity onPress={() => Linking.openURL(musician.website!)}>
                      <Text style={styles.socialLink}>Website →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  banner: { width: '100%', height: 280 },
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
  backBtn: { padding: 20 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound: { textAlign: 'center', color: Colors.grey, marginTop: 40, fontSize: 15 },

  profileHead: { padding: 20, paddingBottom: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' },
  name: { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3 },
  typePill: {
    backgroundColor: Colors.orange,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  typeText: { fontSize: 12, color: Colors.black, fontWeight: '700' },
  editBtn: {
    marginLeft: 'auto',
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  editBtnText: { fontSize: 13, fontWeight: '700', color: Colors.black },
  username: { fontSize: 13, color: Colors.grey, marginBottom: 2 },
  location: { fontSize: 14, color: Colors.grey, marginBottom: 12 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  genrePill: {
    borderWidth: 1, borderColor: Colors.orange,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  genreText: { fontSize: 12, color: Colors.orange, fontWeight: '500' },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginTop: 16,
  },
  tab: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.orange },
  tabText: { fontSize: 15, fontWeight: '600', color: Colors.grey },
  tabTextActive: { color: Colors.black },

  content: { padding: 20 },
  section: { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.greyLight,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  body: { fontSize: 15, color: Colors.black, lineHeight: 22 },

  gigRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  gigVenue: { fontSize: 14, fontWeight: '600', color: Colors.black, marginBottom: 2 },
  gigMeta: { fontSize: 13, color: Colors.grey },
  gigAttendance: { fontSize: 13, color: Colors.orange, fontWeight: '600' },

  songRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  songTitle: { fontSize: 14, fontWeight: '600', color: Colors.black },
  songLink: { fontSize: 13, color: Colors.orange, fontWeight: '600' },

  socialLink: { fontSize: 15, color: Colors.orange, fontWeight: '600', marginBottom: 10 },
});
