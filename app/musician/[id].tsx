import { useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal,
  ActivityIndicator, Image, Linking, Platform, Share, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { MyGigsContent } from '@/app/(tabs)/gigs';
import { DashboardContent } from '@/app/dashboard';
import { db, auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const isWeb = Platform.OS === 'web';

function PositionedBanner({ uri, position, height }: { uri: string; position?: { x: number; y: number }; height: number }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };

  useEffect(() => {
    if (uri) Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {});
  }, [uri]);

  const coverScale = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, height / dims.nh) : 1.6;
  const displayW   = dims.nw ? dims.nw * coverScale : w * 1.6;
  const displayH   = dims.nh ? dims.nh * coverScale : height * 1.6;
  const maxTx      = Math.max(0, displayW - w);
  const maxTy      = Math.max(0, displayH - height);
  const tx         = -(pos.x / 100) * maxTx;
  const ty         = -(pos.y / 100) * maxTy;

  return (
    <View style={{ height, overflow: 'hidden' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Image
        source={{ uri }}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: displayW, height: displayH,
          transform: [{ translateX: tx }, { translateY: ty }],
        } as any}
        resizeMode="cover"
      />
    </View>
  );
}

const MAX_DESC = 320;

/** Derives a display-ready act size from the structured member list or memberCount field.
 *  `actSize` was a legacy stored field never written by settings; this replaces it. */
function getActSize(m: { memberCount?: string; members?: any[] }): string | null {
  if (m.memberCount?.trim()) return m.memberCount.trim();
  if (m.members && m.members.length > 0) return `${m.members.length}-piece`;
  return null;
}


type CustomLink = { label: string; url: string };
type Song       = { title?: string; url?: string; notes?: string };
type ArtistPage = { platform: string; url: string };
type GigEntry   = { venue?: string; suburb?: string; date?: string; endDate?: string; attendance?: number; notes?: string; socialPostUrl?: string; ticketUrl?: string; type?: string };

type Musician = {
  id: string;
  name?: string;
  username?: string;
  artistType?: string | string[];
  location?: string;
  genre?: string[];
  otherGenres?: string;
  otherArtistType?: string;
  photoPosition?: { x: number; y: number };
  about?: string;
  photoUrl?: string;
  coverPhotoUrl?: string;
  instagram?: string;
  tiktok?: string;
  spotify?: string;
  appleMusic?: string;
  youtube?: string;
  website?: string;
  customLinks?: CustomLink[];
  artistPages?: ArtistPage[];
  songs?: Song[];
  photos?: string[];
  videos?: string[];
  videoObjects?: { url: string; title?: string }[];
  gigHistory?: GigEntry[];
  upcomingGigs?: GigEntry[];
  feeMin?: number;
  feeMax?: number;
  payment?: {
    typicalFee?: string;
    minimumFee?: string;
    publicLiabilityHeld?: boolean;
    publicLiabilityCoverage?: string;
    /** New: boolean flag (abn itself is private). Falls back to legacy abn string for old data. */
    hasAbn?: boolean;
    /** Legacy field — present on old data before migration. Use hasAbn going forward. */
    abn?: string;
    gstRegistered?: boolean;
    canProvideInvoice?: boolean;
  };
  averageDraw?: number;
  gigsPlayed?: number;
  memberCount?: string;
  members?: { name: string; role: string }[];
  formed?: string;
  setType?: string;
  setLengths?: string[];
  ageRestriction?: string;
  travel?: string;
  backline?: string;
  availability?: string;
  techRider?: {
    stageWidth?: string;
    stageDepth?: string;
    monitoringType?: string;
    monitoring?: string;
    monitorMixes?: string;
    ownPA?: boolean;
    ownEngineer?: boolean;
    lighting?: string;
    power?: string;
    loadIn?: string;
    soundcheck?: string;
    stagePlotUrl?: string;
    inputListUrl?: string;
    inputListName?: string;
    notes?: string;
    backlineNeeded?: string;
    stageSize?: string;
  };
  techRiderDocs?: { url: string; name: string }[];
  techRiderBools?: Record<string, boolean>;
  backlineFromVenue?: string[];
  backlineBring?: string[];
  inputChannels?: { source?: string; micDi?: string }[];
  instruments?: string[];
  settings?: { listed?: boolean };
};

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ m, isMobileLayout, isOwn = false }: { m: Musician; isMobileLayout: boolean; isOwn?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'agentRoster'), where('artistUid', '==', m.id)))
      .then(async snap => {
        if (snap.empty) return;
        const data = snap.docs[0].data();
        if (data.agentName) { setAgentName(data.agentName); return; }
        const userSnap = await getDoc(doc(db, 'users', data.agentUid));
        setAgentName(userSnap.data()?.displayName ?? null);
      })
      .catch(() => {});
  }, [m.id]);

  const about          = m.about || '';
  const shouldTruncate = about.length > MAX_DESC;

  // Featured track (first song)
  const songs = (m.songs || []).filter(s => s.title);
  const featuredTrack = songs[0] ?? null;

  // Social/custom links (no email).
  // Prefer artistPages (new storage), fall back to top-level fields (legacy).
  const pageMap: Record<string, string> = {};
  (m.artistPages || []).forEach(p => { if (p.url) pageMap[p.platform] = p.url; });
  const allLinks: { label: string; url: string }[] = [
    { label: 'Instagram',   url: pageMap['Instagram']   || m.instagram  || '' },
    { label: 'TikTok',      url: pageMap['TikTok']      || m.tiktok     || '' },
    { label: 'Spotify',     url: pageMap['Spotify']     || m.spotify    || '' },
    { label: 'Apple Music', url: pageMap['Apple Music'] || m.appleMusic || '' },
    { label: 'YouTube',     url: pageMap['YouTube']     || m.youtube    || '' },
    { label: 'Website',     url: pageMap['Website']     || m.website    || '' },
  ].filter(l => l.url).concat(
    (m.customLinks || []).filter(l => l.label && l.url)
  );

  // Credentials
  const isInsured  = m.payment?.publicLiabilityHeld;
  const coverage   = m.payment?.publicLiabilityCoverage;
  // hasAbn uses the new boolean flag; falls back to the legacy abn string for old data
  const hasAbn     = !!(m.payment?.hasAbn ?? !!(m.payment?.abn));
  const isGst      = m.payment?.gstRegistered;
  const canInvoice = m.payment?.canProvideInvoice;
  const hasCredentials = isInsured || hasAbn || isGst;

  // Members / line-up
  const members    = m.members || [];
  const hasMembers = members.length > 0;

  // About meta line
  const metaParts = [
    m.formed       ? `Formed ${m.formed}` : null,
    m.setType      || null,
    m.ageRestriction || null,
  ].filter(Boolean);

  const aside = (
    <View style={!isMobileLayout ? ov.aside : ov.asideMobile}>
      {/* Top Track card */}
      {(featuredTrack || isOwn) && (
        <View style={[ov.trackCard, { backgroundColor: '#16161A' }]}>
          <View style={ov.trackCardHeader}>
            <Text style={ov.trackCardLabel}>FEATURED TRACK</Text>
            {songs.length > 1 && (
              <Text style={ov.trackCardAllLink}>All tracks →</Text>
            )}
          </View>
          {featuredTrack ? (
            <TouchableOpacity style={ov.trackCardRow} onPress={() => featuredTrack.url && Linking.openURL(featuredTrack.url!)} activeOpacity={0.75} disabled={!featuredTrack.url}>
              <View style={ov.trackCardPlayBtn}>
                <Text style={ov.trackCardPlayText}>▶</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ov.trackCardTitle} numberOfLines={1}>{featuredTrack.title}</Text>
                {(featuredTrack as any).notes ? <Text style={ov.trackCardNotes} numberOfLines={1}>{(featuredTrack as any).notes}</Text> : null}
              </View>
            </TouchableOpacity>
          ) : isOwn ? (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=Music' as any)}>
              <Text style={[ov.trackCardNotes, { textAlign: 'center', paddingVertical: 8 }]}>Add a track +</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Links */}
      {(allLinks.length > 0 || isOwn) && (
        <View style={[ov.asideCard, { borderColor: colors.border }]}>
          <Text style={[ov.asideCardTitle, { color: colors.black }]}>Links</Text>
          {allLinks.map((link, i) => (
            <TouchableOpacity key={i} style={[ov.linkRow, { borderBottomColor: colors.border }]} onPress={() => Linking.openURL(link.url)} activeOpacity={0.75}>
              <Text style={[ov.linkLabel, { color: colors.grey }]}>{link.label}</Text>
              <Text style={[ov.linkArrow, { color: colors.black }]}>→</Text>
            </TouchableOpacity>
          ))}
          {isOwn && allLinks.length === 0 && (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=Basic+Info' as any)}>
              <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }}>Add links +</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Credentials */}
      {(hasCredentials || isOwn) && (
        <View style={[ov.asideCard, { borderColor: colors.border }]}>
          <Text style={[ov.asideCardTitle, { color: colors.black }]}>Credentials</Text>
          {isInsured && (
            <View style={ov.credRow}>
              <Text style={[ov.credIcon, { color: '#2B3A67' }]}>✓</Text>
              <Text style={[ov.credText, { color: colors.black }]}>
                Public liability insured{coverage ? ` · $${coverage}` : ''} · certificate on request
              </Text>
            </View>
          )}
          {hasAbn && (
            <View style={ov.credRow}>
              <Text style={[ov.credIcon, { color: '#2B3A67' }]}>✓</Text>
              <Text style={[ov.credText, { color: colors.black }]}>
                Has an ABN{canInvoice ? ', can invoice' : ''}
                {isGst ? ' · GST registered' : ''}
              </Text>
            </View>
          )}
          {isOwn && !hasCredentials && (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=Invoicing' as any)}>
              <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }}>Add credentials +</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Small print */}
      <Text style={[ov.noteText, { color: colors.grey }]}>
        Contact details, hospitality rider and invoicing details are shared once a booking is confirmed.
      </Text>
    </View>
  );

  const main = (
    <View style={ov.main}>
      {agentName ? (
        <Text style={[styles.managedBy, { color: colors.grey }]}>Represented by {agentName}</Text>
      ) : null}

      {/* About */}
      {(about || isOwn) && (
        <View style={ov.section}>
          <Text style={[ov.sectionHeading, { color: colors.black }]}>About</Text>
          {about ? (
            <>
              <Text style={[ov.body, { color: colors.black }]}>
                {shouldTruncate && !expanded ? about.slice(0, MAX_DESC) + '…' : about}
              </Text>
              {shouldTruncate && (
                <TouchableOpacity onPress={() => setExpanded(e => !e)}>
                  <Text style={ov.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : null}
          {metaParts.length > 0 && (
            <Text style={[ov.metaLine, { color: colors.grey }]}>{metaParts.join(' · ')}</Text>
          )}
          {isOwn && !about && (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=About' as any)}>
              <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }}>Add bio +</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Line-up */}
      {(hasMembers || (m.instruments && m.instruments.length > 0) || isOwn) && (
        <View style={ov.section}>
          <Text style={[ov.sectionHeading, { color: colors.black }]}>
            Line-up{getActSize(m) ? ` · ${getActSize(m)}` : ''}
          </Text>
          {members.map((member, i) => (
            <View key={i} style={[ov.memberRow, { borderBottomColor: colors.border }]}>
              <Text style={[ov.memberName, { color: colors.black }]}>{member.name}</Text>
              <Text style={[ov.memberRole, { color: colors.grey }]}>{member.role}</Text>
            </View>
          ))}
          {m.instruments && m.instruments.length > 0 && (
            <View style={[ov.chipRow, { marginTop: members.length > 0 ? 10 : 0 }]}>
              {m.instruments.map(inst => (
                <View key={inst} style={[ov.chip, { borderColor: colors.border }]}>
                  <Text style={[ov.chipText, { color: colors.black }]}>{inst}</Text>
                </View>
              ))}
            </View>
          )}
          {isOwn && !hasMembers && (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=About' as any)}>
              <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600', marginTop: 4 }}>Add members +</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!isOwn && !about && !hasMembers && !(m.instruments && m.instruments.length > 0) && (
        <Text style={[styles.emptyState, { color: colors.greyLight }]}>No info listed yet.</Text>
      )}
    </View>
  );

  if (isMobileLayout) {
    return (
      <>
        <View style={ov.layout}>{main}</View>
        <View style={ov.layout}>{aside}</View>
      </>
    );
  }

  return (
    <View style={[ov.layout, { flexDirection: 'row', alignItems: 'flex-start', gap: 32 }]}>
      {main}
      {aside}
    </View>
  );
}

// ── Music & Media Tab ─────────────────────────────────────────────

function MusicMediaTab({ m, isOwn = false }: { m: Musician; isOwn?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const songs  = (m.songs || []).filter(s => s.title);
  const photos = m.photos || [];
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  function detectSource(url: string): string {
    if (!url) return 'Link';
    if (url.includes('spotify.com'))                      return 'Spotify';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
    if (url.includes('soundcloud.com'))                   return 'SoundCloud';
    if (url.includes('bandcamp.com'))                     return 'Bandcamp';
    return 'Link';
  }

  return (
    <View style={styles.tabContent}>

      {/* Tracks */}
      <View style={styles.section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={[mm.sectionHeading, { color: colors.black }]}>Tracks</Text>
          {isOwn && songs.length === 0 && (
            <TouchableOpacity onPress={() => router.push('/edit-profile?tab=Music' as any)}>
              <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '700' }}>Add +</Text>
            </TouchableOpacity>
          )}
        </View>
        {songs.length > 0 ? songs.map((song, i) => (
          <View key={i} style={[mm.trackRow, { borderBottomColor: colors.border }]}>
            <View style={[mm.trackNumWrap, { backgroundColor: colors.bgFaint }]}>
              {i === 0
                ? <Text style={[mm.featuredLabel, { color: Colors.orange }]}>★</Text>
                : <Text style={[mm.trackNum, { color: colors.grey }]}>{i + 1}</Text>
              }
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[mm.trackTitle, { color: colors.black }]} numberOfLines={1}>{song.title}</Text>
              {(song as any).notes ? (
                <Text style={[mm.trackNotes, { color: colors.grey }]} numberOfLines={1}>{(song as any).notes}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {(song as any).duration ? <Text style={[mm.trackDuration, { color: colors.grey }]}>{(song as any).duration}</Text> : null}
              {song.url && (
                <TouchableOpacity
                  style={[mm.openBtn, { borderColor: colors.border }]}
                  onPress={() => Linking.openURL(song.url!)}
                  activeOpacity={0.75}
                >
                  <Text style={[mm.openBtnText, { color: colors.black }]}>Open in {detectSource(song.url)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )) : !isOwn ? (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No tracks listed yet.</Text>
        ) : null}
      </View>

      {/* Photos */}
      {(photos.length > 0 || isOwn) && (
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={[mm.sectionHeading, { color: colors.black }]}>Photos</Text>
            {isOwn && (
              <TouchableOpacity onPress={() => router.push('/edit-profile?tab=Photos+%26+videos' as any)}>
                <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '700' }}>{photos.length === 0 ? 'Add +' : 'Manage'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {photos.length > 0 ? (
            <View style={mm.photoGrid}>
              {photos.map((url, i) => (
                <TouchableOpacity key={i} style={mm.photoTile} onPress={() => setLightboxIdx(i)} activeOpacity={0.85}>
                  <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyState, { color: colors.greyLight }]}>No photos yet.</Text>
          )}
        </View>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Modal transparent animationType="fade" onRequestClose={() => setLightboxIdx(null)}>
          <TouchableOpacity style={mm.lightboxBack} activeOpacity={1} onPress={() => setLightboxIdx(null)}>
            <Image source={{ uri: photos[lightboxIdx] }} style={mm.lightboxImg} resizeMode="contain" />
            <TouchableOpacity style={mm.lightboxClose} onPress={() => setLightboxIdx(null)}>
              <Text style={mm.lightboxCloseText}>✕</Text>
            </TouchableOpacity>
            {lightboxIdx > 0 && (
              <TouchableOpacity style={[mm.lightboxNav, mm.lightboxNavL]} onPress={() => setLightboxIdx(i => i! - 1)}>
                <Text style={mm.lightboxNavText}>‹</Text>
              </TouchableOpacity>
            )}
            {lightboxIdx < photos.length - 1 && (
              <TouchableOpacity style={[mm.lightboxNav, mm.lightboxNavR]} onPress={() => setLightboxIdx(i => i! + 1)}>
                <Text style={mm.lightboxNavText}>›</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

// ── Tech Rider Tab ────────────────────────────────────────────────

function TechRiderTab({ m, isOwn = false }: { m: Musician; isOwn?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const tr = m.techRider || {};
  const hasStage            = !!(tr.stageWidth || tr.stageDepth || tr.stageSize);
  const hasMonitoring       = !!(tr.monitoringType || tr.monitoring || tr.monitorMixes);
  const hasInputs           = !!(m.inputChannels && m.inputChannels.length > 0);
  const hasDocs             = !!(m.techRiderDocs && m.techRiderDocs.length > 0) || !!(tr.stagePlotUrl || tr.inputListUrl);
  const hasBacklineFromVenue= !!(m.backlineFromVenue && m.backlineFromVenue.length > 0);
  const hasBacklineBring    = !!(m.backlineBring && m.backlineBring.length > 0);
  const hasProduction       = !!(tr.ownPA || m.techRiderBools?.ownPA || tr.ownEngineer || tr.lighting || tr.power || tr.loadIn || tr.soundcheck);
  const hasAny              = hasStage || hasMonitoring || hasInputs || hasDocs || hasBacklineFromVenue || hasBacklineBring || hasProduction;

  if (!hasAny && !isOwn) {
    return (
      <View style={[styles.tabContent, { alignItems: 'center', paddingTop: 60 }]}>
        <Text style={[styles.emptyState, { color: colors.greyLight }]}>No tech rider listed yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>

      {/* Stage card */}
      <View style={[tr_.card, { borderColor: colors.border }]}>
        <Text style={[tr_.cardTitle, { color: colors.black }]}>Stage</Text>

        {hasDocs && (
          <View style={tr_.docsRow}>
            {tr.stagePlotUrl && (
              <TouchableOpacity style={[tr_.docBtn, { borderColor: colors.border }]} onPress={() => Linking.openURL(tr.stagePlotUrl!)}>
                <Text style={[tr_.docBtnText, { color: colors.black }]}>↓ Stage plot</Text>
              </TouchableOpacity>
            )}
            {tr.inputListUrl && (
              <TouchableOpacity style={[tr_.docBtn, { borderColor: colors.border }]} onPress={() => Linking.openURL(tr.inputListUrl!)}>
                <Text style={[tr_.docBtnText, { color: colors.black }]}>↓ {tr.inputListName || 'Input list'}</Text>
              </TouchableOpacity>
            )}
            {(m.techRiderDocs || []).map((d, i) => (
              <TouchableOpacity key={i} style={[tr_.docBtn, { borderColor: colors.border }]} onPress={() => Linking.openURL(d.url)}>
                <Text style={[tr_.docBtnText, { color: colors.black }]}>↓ {d.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {m.memberCount && (
          <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
            <Text style={[tr_.specLabel, { color: colors.grey }]}>Performers</Text>
            <Text style={[tr_.specValue, { color: colors.black }]}>{m.memberCount}</Text>
          </View>
        )}
        {hasStage && (
          <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
            <Text style={[tr_.specLabel, { color: colors.grey }]}>Minimum stage</Text>
            <Text style={[tr_.specValue, { color: colors.black }]}>
              {tr.stageWidth && tr.stageDepth ? `${tr.stageWidth}m x ${tr.stageDepth}m` : tr.stageSize}
            </Text>
          </View>
        )}
        {hasMonitoring && (
          <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
            <Text style={[tr_.specLabel, { color: colors.grey }]}>Monitoring</Text>
            <Text style={[tr_.specValue, { color: colors.black }]}>
              {[tr.monitoringType, tr.monitoring, tr.monitorMixes ? `${tr.monitorMixes} mixes` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        )}
        {(tr.ownPA || m.techRiderBools?.ownPA) && (
          <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
            <Text style={[tr_.specLabel, { color: colors.grey }]}>PA</Text>
            <Text style={[tr_.specValue, { color: colors.black }]}>Touring with own PA{tr.ownEngineer ? ' and engineer' : ''}</Text>
          </View>
        )}
      </View>

      {/* Input list */}
      {hasInputs && (
        <View style={[tr_.card, { borderColor: colors.border }]}>
          <Text style={[tr_.cardTitle, { color: colors.black }]}>Input list</Text>
          <View style={[tr_.inputTable, { borderColor: colors.border }]}>
            <View style={[tr_.inputRow, tr_.inputHeader, { borderBottomColor: colors.border }]}>
              <Text style={[tr_.inputCell, tr_.inputChNum, tr_.headerText, { color: colors.grey }]}>Ch</Text>
              <Text style={[tr_.inputCell, { flex: 1 }, tr_.headerText, { color: colors.grey }]}>Source</Text>
              <Text style={[tr_.inputCell, tr_.inputMicDi, tr_.headerText, { color: colors.grey }]}>Mic / DI</Text>
            </View>
            {m.inputChannels!.map((ch, i) => (
              <View key={i} style={[tr_.inputRow, { borderBottomColor: colors.border, borderBottomWidth: i < m.inputChannels!.length - 1 ? 1 : 0 }]}>
                <Text style={[tr_.inputCell, tr_.inputChNum, { color: colors.black }]}>{i + 1}</Text>
                <Text style={[tr_.inputCell, { flex: 1 }, { color: colors.black }]}>{ch.source || ''}</Text>
                <Text style={[tr_.inputCell, tr_.inputMicDi, { color: colors.black }]}>{ch.micDi || ''}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Backline */}
      {(hasBacklineFromVenue || hasBacklineBring) && (
        <View style={[tr_.card, { borderColor: colors.border }]}>
          <Text style={[tr_.cardTitle, { color: colors.black }]}>Backline</Text>
          {hasBacklineFromVenue && (
            <View style={tr_.backlineSection}>
              <Text style={[tr_.backlineLabel, { color: colors.black }]}>Needs from the venue</Text>
              <View style={tr_.chipRow}>
                {m.backlineFromVenue!.map(item => (
                  <View key={item} style={[tr_.chip, tr_.chipOutline, { borderColor: '#16161A' }]}>
                    <Text style={[tr_.chipText, { color: '#16161A' }]}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {hasBacklineBring && (
            <View style={[tr_.backlineSection, { marginTop: hasBacklineFromVenue ? 12 : 0 }]}>
              <Text style={[tr_.backlineLabel, { color: colors.black }]}>Brings their own</Text>
              <View style={tr_.chipRow}>
                {m.backlineBring!.map(item => (
                  <View key={item} style={[tr_.chip, { borderColor: colors.border }]}>
                    <Text style={[tr_.chipText, { color: colors.black }]}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Production and timings */}
      {hasProduction && (
        <View style={[tr_.card, { borderColor: colors.border }]}>
          <Text style={[tr_.cardTitle, { color: colors.black }]}>Production and timings</Text>
          {tr.loadIn && (
            <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
              <Text style={[tr_.specLabel, { color: colors.grey }]}>Load-in</Text>
              <Text style={[tr_.specValue, { color: colors.black }]}>{tr.loadIn}</Text>
            </View>
          )}
          {tr.soundcheck && (
            <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
              <Text style={[tr_.specLabel, { color: colors.grey }]}>Soundcheck</Text>
              <Text style={[tr_.specValue, { color: colors.black }]}>{tr.soundcheck}</Text>
            </View>
          )}
          {tr.lighting && (
            <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
              <Text style={[tr_.specLabel, { color: colors.grey }]}>Lighting</Text>
              <Text style={[tr_.specValue, { color: colors.black }]}>{tr.lighting}</Text>
            </View>
          )}
          {tr.power && (
            <View style={[tr_.specRow, { borderBottomColor: colors.border }]}>
              <Text style={[tr_.specLabel, { color: colors.grey }]}>Power</Text>
              <Text style={[tr_.specValue, { color: colors.black }]}>{tr.power}</Text>
            </View>
          )}
          {tr.notes && (
            <Text style={[tr_.notesText, { color: colors.grey }]}>{tr.notes}</Text>
          )}
        </View>
      )}

      {/* Locked note */}
      <View style={[tr_.lockedNote, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[tr_.lockedNoteText, { color: colors.grey }]}>
          Their hospitality rider (meals, dietary needs, drinks) is shared when you confirm a booking.
        </Text>
      </View>

      {isOwn && (
        <TouchableOpacity style={[tr_.editBtn, { borderColor: colors.border }]} onPress={() => router.push('/edit-profile?tab=Tech+Rider' as any)}>
          <Text style={[tr_.editBtnText, { color: colors.black }]}>Edit tech rider</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Timetable helpers ──────────────────────────────────────────────

const SHORT_MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MO  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function prettyAwayDate(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) return iso;
  return `${d} ${SHORT_MO[mo - 1]} ${y}`;
}

type EntryItem = { date: Date; dateISO: string; entry: GigEntry };
type MonthGroup = { year: number; month: number; items: EntryItem[] };

function groupByMonth(items: EntryItem[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  items.forEach(item => {
    const y = item.date.getFullYear(), mo = item.date.getMonth();
    let g = groups.find(g => g.year === y && g.month === mo);
    if (!g) { g = { year: y, month: mo, items: [] }; groups.push(g); }
    g.items.push(item);
  });
  return groups;
}

function MusicianCalendarMonth({ entries, month, year, today, windowStart, windowEnd, colors }: {
  entries: GigEntry[]; month: number; year: number; today: Date;
  windowStart: Date; windowEnd: Date; colors: any;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, GigEntry[]>();
  entries.forEach(e => {
    if (!e.date) return;
    const isAwayRange = (e.type || 'gig') === 'away' && e.endDate && e.endDate > e.date;
    if (isAwayRange) {
      const cur = new Date(e.date); cur.setHours(0,0,0,0);
      const end = new Date(e.endDate!); end.setHours(0,0,0,0);
      while (cur <= end) {
        const iso = isoDate(cur);
        const a = byDate.get(iso) || []; a.push(e); byDate.set(iso, a);
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      const a = byDate.get(e.date) || []; a.push(e); byDate.set(e.date, a);
    }
  });

  return (
    <View style={mt.calMonth}>
      <Text style={[mt.calMonthLabel, { color: colors.black }]}>{LONG_MO[month]} {year}</Text>
      <View style={mt.calDowRow}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <Text key={i} style={[mt.calDow, { color: colors.greyLight }]}>{d}</Text>
        ))}
      </View>
      <View style={mt.calGrid}>
        {cells.map((dayNum, ci) => {
          if (!dayNum) return <View key={`e${ci}`} style={mt.calCell} />;
          const date = new Date(year, month, dayNum);
          const iso = isoDate(date);
          const todayN = new Date(today); todayN.setHours(0,0,0,0);
          const dateN = new Date(date); dateN.setHours(0,0,0,0);
          const wsN = new Date(windowStart); wsN.setHours(0,0,0,0);
          const weN = new Date(windowEnd); weN.setHours(0,0,0,0);
          const outOfRange = dateN < wsN || dateN > weN;
          const isToday = dateN.getTime() === todayN.getTime();
          const dayEntries = byDate.get(iso) || [];
          const hasGig  = dayEntries.some(e => (e.type || 'gig') === 'gig');
          const hasAway = dayEntries.some(e => (e.type || 'gig') === 'away');
          const numColor = isToday ? '#ffffff' : outOfRange ? colors.greyLight : hasAway ? colors.greyLight : colors.black;
          return (
            <View key={`${year}-${month}-${dayNum}`} style={mt.calCell}>
              <View style={[mt.calDayCircle, isToday && !hasAway && mt.calDayCircleToday]}>
                <Text style={[mt.calDayNum, { color: numColor }, !outOfRange && hasAway && { textDecorationLine: 'line-through' as const }]}>{dayNum}</Text>
              </View>
              <View style={mt.calDots}>
                {!outOfRange && hasGig && <View style={[mt.calDot, { backgroundColor: '#22c55e' }]} />}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MusEntryRow({ entry, date, isOwn, musicianId, musicianName }: {
  entry: GigEntry; date: Date; isOwn: boolean; musicianId: string; musicianName: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const type = entry.type || 'gig';

  const leftBorderColor = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const badgeLabel      = type === 'gig' ? 'Booked' : type === 'away' ? 'Away' : 'Free';
  const badgeColor      = type === 'gig' ? '#16a34a' : type === 'away' ? '#888888' : Colors.orange;
  const badgeBorderCol  = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const dayAbbrev = date.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();

  return (
    <View style={[mt.entryRow, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: colors.bg }]}>
      <View style={mt.dateBox}>
        <Text style={[mt.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[mt.dateMonth, { color: colors.grey }]}>{SHORT_MO[date.getMonth()].toUpperCase()}</Text>
      </View>
      <Text style={[mt.dayAbbrev, { color: colors.grey }]}>{dayAbbrev}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[mt.entryMain, { color: colors.black }]} numberOfLines={1}>
          {type === 'gig' ? (entry.venue || 'Gig') : type === 'away' ? (entry.notes || 'Away') : (entry.notes || 'Available')}
        </Text>
        {type === 'gig' && entry.suburb
          ? <Text style={[mt.entrySub, { color: colors.grey }]}>{entry.suburb}</Text>
          : null}
        {type === 'away' && entry.endDate
          ? <Text style={[mt.entrySub, { color: colors.grey }]}>Until {new Date(entry.endDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</Text>
          : null}
      </View>
      <View style={[mt.statusBadge, { borderColor: badgeBorderCol }]}>
        <Text style={[mt.statusBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
      {type === 'gig' && (entry.socialPostUrl || entry.ticketUrl) ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {entry.socialPostUrl ? (
            <TouchableOpacity
              style={[mt.linkBtn, { borderColor: colors.border }]}
              onPress={() => { const u = entry.socialPostUrl!; if (u.startsWith('http')) Linking.openURL(u); }}
            >
              <Text style={[mt.linkBtnText, { color: colors.black }]}>Post →</Text>
            </TouchableOpacity>
          ) : null}
          {entry.ticketUrl ? (
            <TouchableOpacity
              style={mt.ticketBtn}
              onPress={() => { const u = entry.ticketUrl!; if (u.startsWith('http')) Linking.openURL(u); }}
            >
              <Text style={mt.ticketBtnText}>Tickets →</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {type === 'free' && !isOwn ? (
        <TouchableOpacity
          style={mt.messageBtn}
          onPress={() => router.push({ pathname: '/messages/[id]', params: { id: musicianId, name: musicianName } } as any)}
        >
          <Text style={mt.messageBtnText}>Message →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function NativeMusEntryCard({ entry, date, isOwn, musicianId, musicianName }: {
  entry: GigEntry; date: Date; isOwn: boolean; musicianId: string; musicianName: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const type = entry.type || 'gig';
  const borderColor = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const badgeLabel  = type === 'gig' ? 'Booked' : type === 'away' ? 'Away' : 'Free';
  const badgeColor  = type === 'gig' ? '#16a34a' : type === 'away' ? '#888888' : Colors.orange;

  return (
    <View style={[nmt.card, { borderColor, backgroundColor: colors.bg }]}>
      <View style={nmt.dateBox}>
        <Text style={[nmt.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[nmt.dateMonth, { color: colors.grey }]}>{SHORT_MO[date.getMonth()].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[nmt.main, { color: colors.black }]} numberOfLines={1}>
          {type === 'gig' ? (entry.venue || 'Gig') : type === 'away' ? 'Away' : 'Available'}
        </Text>
        {type === 'gig' && entry.suburb
          ? <Text style={[nmt.sub, { color: colors.grey }]}>{entry.suburb}</Text>
          : null}
        {type === 'away' && entry.endDate
          ? <Text style={[nmt.sub, { color: colors.grey }]}>Until {new Date(entry.endDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</Text>
          : null}
        {entry.notes ? <Text style={[nmt.notes, { color: colors.grey }]}>{entry.notes}</Text> : null}
        {type === 'gig' && (entry.socialPostUrl || entry.ticketUrl) ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {entry.socialPostUrl ? (
              <TouchableOpacity onPress={() => { const u = entry.socialPostUrl!; if (u.startsWith('http')) Linking.openURL(u); }}>
                <Text style={nmt.linkText}>Social post →</Text>
              </TouchableOpacity>
            ) : null}
            {entry.ticketUrl ? (
              <TouchableOpacity onPress={() => { const u = entry.ticketUrl!; if (u.startsWith('http')) Linking.openURL(u); }}>
                <Text style={[nmt.linkText, { fontWeight: '700' }]}>Tickets →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {type === 'free' && !isOwn ? (
          <TouchableOpacity
            style={nmt.msgBtn}
            onPress={() => router.push({ pathname: '/messages/[id]', params: { id: musicianId, name: musicianName } } as any)}
          >
            <Text style={nmt.msgBtnText}>Message →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[nmt.badge, { borderColor }]}>
        <Text style={[nmt.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
    </View>
  );
}

// ── Shows & Availability Tab ──────────────────────────────────────

function ShowsAvailabilityTab({ m, isOwn, isMobileLayout = false, musicianId = '', publicGigs = [], awayPeriods = [] }: { m: Musician; isOwn: boolean; isMobileLayout?: boolean; musicianId?: string; publicGigs?: any[]; awayPeriods?: any[] }) {
  const { colors } = useTheme();
  const now = new Date();
  const [showAllPast, setShowAllPast] = useState(false);
  const [pendingEnqs, setPendingEnqs] = useState<any[]>([]);

  // Fetch pending enquiries for the owner only — not shown to other visitors
  useEffect(() => {
    if (!isOwn || !musicianId) return;
    const PENDING = ['enquired', 'pending', 'discussing'];
    getDocs(query(collection(db, 'inquiries'), where('createdBy', '==', musicianId)))
      .then(snap => {
        const nowTs = new Date();
        setPendingEnqs(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((e: any) => {
              if (!PENDING.includes(e.status)) return false;
              const slotDate = e.requestedSlot?.date;
              if (slotDate) return new Date(slotDate + 'T23:59:59') >= nowTs;
              return true;
            })
        );
      })
      .catch(() => {});
  }, [isOwn, musicianId]);

  const confirmedGigs = publicGigs.filter(
    pg => !!pg.startAt && pg.venueName && (pg.status == null || pg.status === 'confirmed')
  );

  const upcomingShows = confirmedGigs
    .filter(g => g.startAt.toDate() >= now)
    .sort((a: any, b: any) => a.startAt.toDate().getTime() - b.startAt.toDate().getTime());

  const pastShows = confirmedGigs
    .filter(g => g.startAt.toDate() < now)
    .sort((a: any, b: any) => b.startAt.toDate().getTime() - a.startAt.toDate().getTime());

  const visiblePast = showAllPast ? pastShows : pastShows.slice(0, 5);

  const windowStart = new Date(now);
  windowStart.setDate(1);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 3);
  windowEnd.setHours(23, 59, 59, 999);

  const gigEntries: EntryItem[] = confirmedGigs
    .filter(pg => !!pg.startAt && pg.venueName)
    .map(pg => {
      const d = pg.startAt.toDate();
      return { date: d, dateISO: isoDate(d), entry: { venue: pg.venueName, date: isoDate(d), type: 'gig' } as GigEntry };
    });

  // Away periods come from bandProfiles/{uid}.awayPeriods, same field My Gigs reads
  const awayEntries: EntryItem[] = awayPeriods.map((p: any) => {
    const d = new Date(p.from + 'T00:00:00');
    return { date: d, dateISO: p.from, entry: { date: p.from, type: 'away', endDate: p.to } as GigEntry };
  });

  const allEntries = [...gigEntries, ...awayEntries].sort((a, b) => a.date.getTime() - b.date.getTime());

  const formatShowDate = (startAt: any) => {
    const d = startAt.toDate();
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatEnqDate = (e: any) => {
    const slotDate = e.requestedSlot?.date;
    const slotDay  = e.requestedSlot?.day;
    if (slotDate) return new Date(slotDate + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    return slotDay || 'Date TBC';
  };

  const calMonths: { year: number; month: number }[] = [];
  {
    const cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    const end = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
    while (cur <= end) {
      calMonths.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const calendarPanel = (
    <View style={[sa_.calPanel, { borderColor: colors.border }]}>
      <Text style={[sa_.calPanelTitle, { color: colors.grey }]}>AVAILABILITY AT A GLANCE</Text>
      <View style={sa_.calLegend}>
        <View style={sa_.calLegendItem}>
          <View style={[sa_.calLegendDot, { backgroundColor: '#16161A' }]} />
          <Text style={[sa_.calLegendText, { color: colors.grey }]}>Gig</Text>
        </View>
        <View style={sa_.calLegendItem}>
          <Text style={[sa_.calLegendText, { color: colors.greyLight, textDecorationLine: 'line-through', fontWeight: '700', marginRight: 2 }]}>15</Text>
          <Text style={[sa_.calLegendText, { color: colors.grey }]}>Unavailable</Text>
        </View>
      </View>
      {calMonths.map(({ year, month }) => (
        <MusicianCalendarMonth
          key={`${year}-${month}`}
          entries={allEntries.map(e => e.entry)}
          month={month} year={year} today={now}
          windowStart={windowStart} windowEnd={windowEnd}
          colors={colors}
        />
      ))}
      <Text style={[sa_.calFooter, { color: colors.grey }]}>
        Gigs here are confirmed Twaylo bookings. Unavailable days are set by the artist.
      </Text>
    </View>
  );

  const hasUpcoming = upcomingShows.length > 0 || pendingEnqs.length > 0;

  const showsList = (
    <View style={{ flex: 1 }}>
      {/* Upcoming */}
      <View style={sa_.section}>
        <Text style={[sa_.sectionHeading, { color: colors.black }]}>Upcoming shows</Text>
        {!hasUpcoming && (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No upcoming shows on Twaylo yet.</Text>
        )}
        {pendingEnqs.map((e: any) => (
          <View key={e.id} style={[sa_.showRow, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[sa_.showVenue, { color: colors.black }]}>{e.venueName || 'Venue'}</Text>
              <Text style={[sa_.showDate, { color: colors.grey }]}>{formatEnqDate(e)}</Text>
            </View>
            <View style={sa_.badgePending}>
              <Text style={sa_.badgePendingText}>Pending</Text>
            </View>
          </View>
        ))}
        {upcomingShows.map((g: any, i: number) => (
          <View key={i} style={[sa_.showRow, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[sa_.showVenue, { color: colors.black }]}>{g.venueName}</Text>
              {g.locationText ? <Text style={[sa_.showMeta, { color: colors.grey }]}>{g.locationText}</Text> : null}
              <Text style={[sa_.showDate, { color: colors.grey }]}>{formatShowDate(g.startAt)}</Text>
            </View>
            <View style={sa_.badgeBooked}>
              <Text style={sa_.badgeBookedText}>Booked</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Past shows */}
      <View style={sa_.section}>
        <Text style={[sa_.sectionHeading, { color: colors.black }]}>
          Past shows{pastShows.length > 0 ? ` (${pastShows.length})` : ''}
        </Text>
        {pastShows.length === 0 ? (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No past shows on Twaylo yet.</Text>
        ) : (
          <>
            {visiblePast.map((g: any, i: number) => (
              <View key={i} style={[sa_.showRow, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[sa_.showVenue, { color: colors.black }]}>{g.venueName}</Text>
                  {g.locationText ? <Text style={[sa_.showMeta, { color: colors.grey }]}>{g.locationText}</Text> : null}
                  <Text style={[sa_.showDate, { color: colors.grey }]}>{formatShowDate(g.startAt)}</Text>
                </View>
                {g.source === 'enquiry' && (
                  <View style={sa_.badgeTwaylo}>
                    <Text style={sa_.badgeTwayloText}>Twaylo</Text>
                  </View>
                )}
              </View>
            ))}
            {pastShows.length > 5 && (
              <TouchableOpacity onPress={() => setShowAllPast(v => !v)} style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }}>
                  {showAllPast ? 'Show less' : `Show all ${pastShows.length}`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );

  if (!isMobileLayout) {
    return (
      <View style={styles.tabContent}>
        <View style={sa_.body}>
          {calendarPanel}
          {showsList}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      {showsList}
      {calendarPanel}
    </View>
  );
}

// ── Pending Agent Claims (shown on own profile) ───────────────────

type ClaimForMusician = {
  id: string;
  agentUid: string;
  agentName: string;
  agentUsername?: string;
  verificationCode: string;
  status: string;
};

type GigHistoryEntry = { venue: string; suburb?: string; date?: string; attendance?: string; notes?: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MyGigsTab({ musician, ownGigs, uid }: { musician: Musician; ownGigs: any[]; uid: string }) {
  const { colors } = useTheme();
  const now = new Date();

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const prettyDate = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const confirmed = ownGigs.filter(g => g.startAt?.toDate && (g.status == null || g.status === 'confirmed'));

  const upcoming = confirmed
    .filter(g => g.startAt.toDate() >= now)
    .sort((a: any, b: any) => a.startAt.toDate().getTime() - b.startAt.toDate().getTime())
    .map((g: any) => ({ venue: g.venueName || '', suburb: g.locationText || undefined, date: isoDate(g.startAt.toDate()) }));

  const pastBookings = confirmed
    .filter((g: any) => g.startAt.toDate() < now)
    .sort((a: any, b: any) => b.startAt.toDate().getTime() - a.startAt.toDate().getTime())
    .map((g: any) => ({ venue: g.venueName || '', suburb: g.locationText || undefined, date: isoDate(g.startAt.toDate()), attendance: g.attendance ?? undefined, source: g.source }));

  const [pendingEnqs, setPendingEnqs] = useState<any[]>([]);
  useEffect(() => {
    if (!uid) return;
    const PENDING = ['enquired', 'pending', 'discussing'];
    getDocs(query(collection(db, 'inquiries'), where('createdBy', '==', uid)))
      .then(snap => {
        const nowTs = new Date();
        setPendingEnqs(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((e: any) => {
              if (!PENDING.includes(e.status)) return false;
              const slotDate = e.requestedSlot?.date;
              if (slotDate) return new Date(slotDate + 'T23:59:59') >= nowTs;
              return true;
            })
        );
      })
      .catch(() => {});
  }, [uid]);

  const [gigHistory, setGigHistoryState] = useState<GigHistoryEntry[]>((musician as any).gigHistory || []);
  const awayPeriods: { from: string; to?: string; notes?: string }[] = (musician as any).awayPeriods || [];

  function saveGigHistory(next: GigHistoryEntry[]) {
    setGigHistoryState(next);
    updateDoc(doc(db, 'bandProfiles', uid), { gigHistory: next }).catch(() => {});
  }

  function addEntry() {
    saveGigHistory([...gigHistory, { venue: '', suburb: '', date: '', attendance: '', notes: '' }]);
  }
  function removeEntry(i: number) {
    saveGigHistory(gigHistory.filter((_, idx) => idx !== i));
  }
  function updateEntry(i: number, field: keyof GigHistoryEntry, val: string) {
    setGigHistoryState(prev => prev.map((g, idx) => idx === i ? { ...g, [field]: val } : g));
  }
  function saveEntry(i: number) {
    updateDoc(doc(db, 'bandProfiles', uid), { gigHistory }).catch(() => {});
  }

  const inputStyle = {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, borderColor: colors.border, color: colors.black, backgroundColor: colors.bg,
  } as const;

  return (
    <View style={{ gap: 16 }}>

      {/* Upcoming */}
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: (upcoming.length + pendingEnqs.length) > 0 ? 1 : 0, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>Upcoming</Text>
          <Text style={{ fontSize: 11, color: colors.grey, marginTop: 2 }}>
            {(upcoming.length + pendingEnqs.length) > 0 ? `${upcoming.length + pendingEnqs.length} total` : 'No upcoming gigs booked yet'}
          </Text>
        </View>
        {upcoming.length === 0 && pendingEnqs.length === 0 ? (
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontSize: 13, color: colors.grey, lineHeight: 20 }}>
              Confirmed bookings from your enquiries will appear here.
            </Text>
          </View>
        ) : (
          <>
            {pendingEnqs.map((e, i) => {
              const slotDate = e.requestedSlot?.date;
              const slotDay  = e.requestedSlot?.day;
              const dateText = slotDate
                ? new Date(slotDate + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                : slotDay || 'Date TBC';
              return (
                <View key={e.id} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>{e.venueName || 'Venue'}</Text>
                    <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{dateText}</Text>
                  </View>
                  <View style={{ backgroundColor: Colors.orange + '22', borderWidth: 1, borderColor: Colors.orange + '66', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.orange }}>Pending</Text>
                  </View>
                </View>
              );
            })}
            {upcoming.map((g, i) => (
              <View key={i} style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: i < upcoming.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>{g.venue}{g.suburb ? `, ${g.suburb}` : ''}</Text>
                  <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{prettyDate(g.date)}</Text>
                </View>
                <View style={{ backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#16a34a' }}>Booked</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Past bookings */}
      {pastBookings.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>Past bookings</Text>
            <Text style={{ fontSize: 11, color: colors.grey, marginTop: 2 }}>
              {pastBookings.length} confirmed gig{pastBookings.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {pastBookings.map((g, i) => (
            <View key={i} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < pastBookings.length - 1 ? 1 : 0, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>{g.venue}{g.suburb ? `, ${g.suburb}` : ''}</Text>
                <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>
                  {prettyDate(g.date)}{g.attendance != null ? ` · ~${g.attendance} draw` : ''}
                </Text>
              </View>
              {g.source === 'enquiry' && (
                <View style={{ backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#111' }}>Twaylo</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Manual gig history */}
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: gigHistory.length > 0 ? 1 : 0, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>Gig history</Text>
          <Text style={{ fontSize: 11, color: colors.grey, marginTop: 2 }}>
            {gigHistory.length > 0 ? `${gigHistory.length} gig${gigHistory.length !== 1 ? 's' : ''} logged` : 'Log gigs you played before joining Twaylo'}
          </Text>
        </View>
        <View style={{ padding: 16, gap: 12 }}>
          {gigHistory.length === 0 && (
            <Text style={{ fontSize: 13, color: colors.grey, lineHeight: 20 }}>
              Add venues you have played before joining Twaylo. The more you log, the more credible your profile looks to new venues.
            </Text>
          )}
          {gigHistory.map((gig, i) => (
            <View key={i} style={{ backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.black }}>Gig {i + 1}</Text>
                <TouchableOpacity onPress={() => removeEntry(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 14, color: Colors.danger, fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={inputStyle}
                placeholder="Venue name"
                placeholderTextColor={Colors.greyLight}
                value={gig.venue}
                onChangeText={v => updateEntry(i, 'venue', v)}
                onBlur={() => saveEntry(i)}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[inputStyle, { flex: 1 }]}
                  placeholder="Suburb"
                  placeholderTextColor={Colors.greyLight}
                  value={gig.suburb || ''}
                  onChangeText={v => updateEntry(i, 'suburb', v)}
                  onBlur={() => saveEntry(i)}
                />
                <TextInput
                  style={[inputStyle, { flex: 1 }]}
                  placeholder="Date (e.g. Mar 2024)"
                  placeholderTextColor={Colors.greyLight}
                  value={gig.date || ''}
                  onChangeText={v => updateEntry(i, 'date', v)}
                  onBlur={() => saveEntry(i)}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[inputStyle, { flex: 1 }]}
                  placeholder="Attendance (optional)"
                  placeholderTextColor={Colors.greyLight}
                  value={gig.attendance || ''}
                  onChangeText={v => updateEntry(i, 'attendance', v)}
                  onBlur={() => saveEntry(i)}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[inputStyle, { flex: 2 }]}
                  placeholder="Notes (optional)"
                  placeholderTextColor={Colors.greyLight}
                  value={gig.notes || ''}
                  onChangeText={v => updateEntry(i, 'notes', v)}
                  onBlur={() => saveEntry(i)}
                />
              </View>
            </View>
          ))}
          <TouchableOpacity
            onPress={addEntry}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, color: colors.black, fontWeight: '600' }}>+ Add gig</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Away periods */}
      {awayPeriods.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>Away</Text>
            <Text style={{ fontSize: 11, color: colors.grey, marginTop: 2 }}>Periods when you are unavailable</Text>
          </View>
          {awayPeriods.map((p, i) => {
            const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
            const label = p.to && p.to !== p.from ? `${fmt(p.from)} to ${fmt(p.to)}` : fmt(p.from);
            return (
              <View key={i} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < awayPeriods.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }}>{label}</Text>
                {p.notes ? <Text style={{ fontSize: 12, color: colors.grey, marginTop: 2 }}>{p.notes}</Text> : null}
              </View>
            );
          })}
        </View>
      )}

    </View>
  );
}

function PendingAgentClaims({ musicianId }: { musicianId: string }) {
  const { colors } = useTheme();
  const [claims, setClaims]           = useState<ClaimForMusician[]>([]);
  const [loading, setLoading]         = useState(true);
  const [processing, setProcessing]   = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed]     = useState<Set<string>>(new Set());

  useEffect(() => {
    getDocs(
      query(collection(db, 'agentClaims'),
        where('artistUid', '==', musicianId),
        where('status', '==', 'pending'))
    ).then(snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClaimForMusician)));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [musicianId]);

  async function handleDecline(claim: ClaimForMusician) {
    setProcessing(p => ({ ...p, [claim.id]: true }));
    try {
      await updateDoc(doc(db, 'agentClaims', claim.id), {
        status: 'declined',
        respondedAt: new Date().toISOString(),
      });
      setClaims(prev => prev.filter(c => c.id !== claim.id));
    } catch {} finally {
      setProcessing(p => ({ ...p, [claim.id]: false }));
    }
  }

  const visible = claims.filter(c => !dismissed.has(c.id));
  if (loading || visible.length === 0) return null;

  return (
    <View style={[pac.wrap, { borderColor: colors.border }]}>
      <Text style={[pac.heading, { color: colors.black }]}>Representation Requests</Text>
      {visible.map(claim => (
        <View key={claim.id} style={[pac.card, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <View style={pac.cardTop}>
            <View style={pac.agentInfo}>
              <Text style={[pac.agentName, { color: colors.black }]}>{claim.agentName}</Text>
              {claim.agentUsername
                ? <Text style={[pac.agentHandle, { color: colors.grey }]}>@{claim.agentUsername}</Text>
                : null}
            </View>
            <View style={[pac.badge, { borderColor: '#f5a623' }]}>
              <Text style={[pac.badgeText, { color: '#f5a623' }]}>Pending</Text>
            </View>
          </View>
          <Text style={[pac.bodyText, { color: colors.grey }]}>
            This agent wants to represent you on Twaylo. Share the code below with them to approve, or decline if you don't recognise this request.
          </Text>
          <View style={[pac.codeDisplay, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[pac.codeDisplayLabel, { color: colors.grey }]}>YOUR VERIFICATION CODE</Text>
            <Text style={[pac.codeDisplayValue, { color: colors.black }]}>{claim.verificationCode}</Text>
          </View>
          <View style={pac.actions}>
            <TouchableOpacity
              style={[pac.declineBtn, { borderColor: colors.border }, processing[claim.id] && pac.btnDim]}
              onPress={() => handleDecline(claim)}
              disabled={!!processing[claim.id]}
              activeOpacity={0.75}
            >
              {processing[claim.id]
                ? <ActivityIndicator color={colors.grey} size="small" />
                : <Text style={[pac.declineBtnText, { color: colors.grey }]}>Decline</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const pac = StyleSheet.create({
  wrap: {
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: isWeb ? 40 : 20, paddingVertical: 20,
    marginBottom: 4,
  },
  heading:    { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, color: Colors.orange, marginBottom: 12, textTransform: 'uppercase' },
  card:       { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10, gap: 10 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  agentInfo:  {},
  agentName:  { fontSize: 15, fontWeight: '700' },
  agentHandle:{ fontSize: 12, marginTop: 2 },
  badge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:  { fontSize: 12, fontWeight: '700' },
  bodyText:   { fontSize: 13, lineHeight: 20 },
  codeInput:  {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 20, fontWeight: '700', letterSpacing: 6, textAlign: 'center',
    width: 160,
  },
  codeDisplay:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', gap: 4 },
  codeDisplayLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  codeDisplayValue: { fontSize: 28, fontWeight: '800', letterSpacing: 8 },
  codeError:  { fontSize: 12, color: Colors.danger },
  actions:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  btnDim:     { opacity: 0.45 },
  approveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  declineBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center' },
  declineBtnText: { fontSize: 14, fontWeight: '600' },
});

// ── MusicianHead — web SEO meta tags ─────────────────────────────────────────

function MusicianHead({ musician, slug }: { musician: Musician; slug: string }) {
  const actType = Array.isArray(musician.artistType)
    ? musician.artistType.join(' / ')
    : musician.artistType ?? 'Artist';
  const genres    = (musician.genre || []).slice(0, 3).join(', ');
  const rawDesc   = musician.about
    ? musician.about
    : `${musician.name}${musician.location ? ` from ${musician.location}` : ''}${genres ? ` · ${genres}` : ''}. Book live music on Twaylo.`;
  const desc      = rawDesc.length > 155 ? rawDesc.slice(0, 152) + '...' : rawDesc;
  const canonical = `https://twaylo.com.au/musician/${slug}`;
  const title     = `${musician.name} | ${actType} | Twaylo`;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />
      {musician.photoUrl ? <meta property="og:image" content={musician.photoUrl} /> : null}
    </Head>
  );
}

// ── Main Screen ───────────────────────────────────────────────────

export default function MusicianScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: initialTab, preview, scrollTo } = useLocalSearchParams<{ id: string; tab?: string; preview?: string; scrollTo?: string }>();
  const scrollRef    = useRef<ScrollView>(null);
  const hasScrolled  = useRef(false);
  const rawId = _overrideId ?? String(paramId);

  // Resolve username slugs (e.g. "the-dahlias") to the Firebase doc ID.
  // Firebase UIDs are exactly 28 base62 chars; anything else is treated as a username slug.
  const [resolvedId, setResolvedId] = useState('');
  useEffect(() => {
    if (!rawId) return;
    if (/^[A-Za-z0-9]{28}$/.test(rawId)) { setResolvedId(rawId); return; }
    getDocs(query(collection(db, 'bandProfiles'), where('username', '==', rawId)))
      .then(snap => setResolvedId(!snap.empty ? snap.docs[0].id : rawId))
      .catch(() => setResolvedId(rawId));
  }, [rawId]);
  const id = resolvedId;
  const isProfileTab   = !!_overrideId;
  const isPublicPreview = !!preview;
  const router       = useRouter();
  const { user }     = useAuth();
  const { colors }   = useTheme();
  const year         = new Date().getFullYear();
  const now          = new Date();

  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/musicians');

  const [musician, setMusician]   = useState<Musician | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'music' | 'techrider' | 'timetable' | 'gigs' | 'dashboard'>(
    initialTab === 'music' ? 'music' : initialTab === 'techrider' ? 'techrider' : initialTab === 'timetable' ? 'timetable' : initialTab === 'gigs' ? 'gigs' : initialTab === 'dashboard' ? 'dashboard' : 'overview'
  );
  const [publicGigs, setPublicGigs]         = useState<any[]>([]);
  const [ownGigs, setOwnGigs]               = useState<any[]>([]);

  const isOwn = !isPublicPreview && user?.uid === id;
  const { width } = useWindowDimensions();
  const [shareCopied, setShareCopied] = useState(false);

  function shareProfile() {
    if (!musician) return;
    const profileUrl = `https://twaylo.com.au/musician/${musician.username || id}`;
    const actT   = Array.isArray(musician.artistType) ? musician.artistType.join(' / ') : musician.artistType;
    const loc    = musician.location?.split(',')[0]?.trim();
    const genres = (musician.genre || []).filter((g: string) => g !== 'Other').slice(0, 3).join(', ');
    const lines: string[] = [];
    const headline = [musician.name, actT].filter(Boolean).join(' — ');
    if (headline) lines.push(headline);
    if (loc)      lines.push(loc);
    if (genres)   lines.push(genres);
    lines.push('');
    lines.push('Full profile including tracks, tech rider and booking info:');
    lines.push(profileUrl);
    const message = lines.join('\n');

    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && (nav as any).share) {
        (nav as any).share({ title: musician.name || 'Twaylo profile', url: profileUrl, text: message }).catch(() => {});
      } else if (nav?.clipboard) {
        nav.clipboard.writeText(message).then(() => {
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 2500);
        }).catch(() => {});
      }
    } else {
      Share.share({ message, url: profileUrl }).catch(() => {});
    }
  }
  const isMobileLayout = !isWeb || width < 768;

  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, 'bandProfiles', id)).then(snap => {
      if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    getDocs(query(
      collection(db, 'publicGigs'),
      where('artistUid', '==', id),
      orderBy('startAt', 'asc'),
    )).then(snap => {
      setPublicGigs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, [id]);

  // Owner's own gigs, any source or visibility (private Twaylo bookings
  // included). Used instead of publicGigs for Overview and Timetable when
  // isOwn (never in public preview, since isOwn is forced false there), so a
  // real third party, and a preview of one, only ever see publicGigs, the
  // properly isPublic-gated projection.
  useEffect(() => {
    if (!isOwn) return;
    getDocs(query(collection(db, 'gigs'), where('participantIds', 'array-contains', id)))
      .then(snap => setOwnGigs(snap.docs.map(d => d.data())))
      .catch(() => {});
  }, [isOwn, id]);


  // Scroll past the hero banner when navigated from inbox links
  useEffect(() => {
    if (scrollTo !== 'content' || !musician || hasScrolled.current) return;
    hasScrolled.current = true;
    const bannerH = isWeb ? 360 : 280;
    // Double rAF ensures the layout has fully painted before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isWeb) {
          const node = (scrollRef.current as any)?.getScrollableNode?.();
          if (node) node.scrollTop = bannerH;
        } else {
          scrollRef.current?.scrollTo({ y: bannerH, animated: false });
        }
      });
    });
  }, [scrollTo, musician]);

  const gigsForTabs = isOwn ? ownGigs : publicGigs;

  const safeEdges = isProfileTab ? (['bottom'] as const) : undefined;

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!musician) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
        {!isProfileTab && (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.notFound, { color: colors.grey }]}>Musician not found.</Text>
      </SafeAreaView>
    );
  }

  const actType = Array.isArray(musician.artistType)
    ? musician.artistType.join(' / ')
    : musician.artistType === 'Other' && musician.otherArtistType
      ? musician.otherArtistType
      : musician.artistType;

  const baseGenres   = (musician.genre || []).filter(g => g !== 'Other');
  const customGenres = musician.otherGenres
    ? musician.otherGenres.split(',').map(g => g.trim()).filter(Boolean)
    : [];
  const allGenres = [...baseGenres, ...customGenres];

  // Breadcrumb: e.g. BAND · 4PC · MELBOURNE
  const breadcrumbParts = [actType, getActSize(musician), musician.location].filter(Boolean) as string[];

  // Compute stats live from actual past gig data rather than relying on
  // server-computed aggregates stored on the profile document.
  const confirmedPastGigs   = gigsForTabs.filter(
    g => g.startAt && (g.status == null || g.status === 'confirmed') && g.startAt.toDate() < now
  );
  const gigsWithAttendance  = confirmedPastGigs.filter(g => g.attendance != null && g.attendance > 0);
  const liveAverageDraw     = gigsWithAttendance.length > 0
    ? Math.round(gigsWithAttendance.reduce((sum: number, g: any) => sum + g.attendance, 0) / gigsWithAttendance.length)
    : null;
  const gigsThisYear        = confirmedPastGigs.filter(g => g.startAt.toDate().getFullYear() === year).length;

  const typicalFeeText = musician.payment?.typicalFee?.trim() || null;
  const feeStr = typicalFeeText
    ? typicalFeeText
    : (musician.feeMin != null || musician.feeMax != null)
      ? (musician.feeMin != null && musician.feeMax != null
          ? `$${musician.feeMin.toLocaleString()} – $${musician.feeMax.toLocaleString()}`
          : musician.feeMin != null
            ? `From $${musician.feeMin.toLocaleString()}`
            : `Up to $${musician.feeMax!.toLocaleString()}`)
      : null;

  // Top header stats: the primary credibility trio (plus lineup/act size/backline).
  const statsItems = [
    musician.memberCount              ? { value: musician.memberCount,                        label: 'LINEUP'           } : null,
    gigsThisYear > 0                  ? { value: String(gigsThisYear),                        label: `GIGS ${year}`     } : null,
    liveAverageDraw != null           ? { value: `~${liveAverageDraw}`,                        label: 'AVG DRAW'         } : null,
    feeStr                            ? { value: feeStr,                                      label: 'FEE'              } : null,
    getActSize(musician)              ? { value: getActSize(musician)!,                        label: 'ACT SIZE'         } : null,
    musician.backline                 ? { value: musician.backline,                           label: 'BACKLINE'         } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  // Moved into the Overview tab itself (not the header, per Darcy), same tile style.
  const overviewStatsItems = [
    musician.setType                      ? { value: musician.setType,        label: 'SET TYPE'         } : null,
    musician.ageRestriction               ? { value: musician.ageRestriction, label: 'SUITABILITY'      } : null,
    musician.payment?.publicLiabilityHeld ? { value: 'Insured',               label: 'PUBLIC LIABILITY' } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  // ── Web desktop dashboard (own profile only) ──────────────────────
  if (isProfileTab && !isMobileLayout) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
        {isWeb && <MusicianHead musician={musician} slug={musician.username || id} />}
        <View style={dash.container}>

          {/* Left sidebar */}
          <View style={[dash.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
            {musician.photoUrl ? (
              <Image source={{ uri: musician.photoUrl }} style={dash.photo} resizeMode="cover" />
            ) : (
              <View style={[dash.photoPlaceholder, { backgroundColor: colors.border }]} />
            )}
            <Text style={[dash.sidebarName, { color: colors.black }]} numberOfLines={2}>
              {musician.name || 'Unnamed Act'}
            </Text>
            {musician.username ? (
              <Text style={[dash.sidebarHandle, { color: colors.grey }]}>@{musician.username}</Text>
            ) : null}
            {breadcrumbParts.length > 0 ? (
              <Text style={dash.sidebarMeta} numberOfLines={2}>
                {breadcrumbParts.join(' · ')}
              </Text>
            ) : null}

            <View style={{ height: 12 }} />

            {([
              { id: 'overview',   label: 'Overview'       },
              { id: 'music',      label: 'Music & Media'       },
              { id: 'techrider',  label: 'Tech Rider'           },
              { id: 'timetable',  label: 'Shows & availability' },
            ] as const).map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={[dash.navItem, activeTab === tab.id && dash.navItemActive]}
                onPress={() => setActiveTab(tab.id)}
                activeOpacity={0.75}
              >
                <Text style={[dash.navText, { color: activeTab === tab.id ? Colors.orange : colors.black }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}

            {isOwn && (
              <>
                <View style={[dash.divider, { backgroundColor: colors.border }]} />
                {([
                  { id: 'gigs',      label: 'My Gigs'   },
                  { id: 'dashboard', label: 'Dashboard'  },
                ] as const).map(tab => (
                  <TouchableOpacity
                    key={tab.id}
                    style={[dash.navItem, activeTab === tab.id && dash.navItemActive]}
                    onPress={() => setActiveTab(tab.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[dash.navText, { color: activeTab === tab.id ? Colors.orange : colors.black }]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <View style={[dash.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={dash.editBtn}
              onPress={shareProfile}
              activeOpacity={0.85}
            >
              <Text style={dash.editBtnText}>{shareCopied ? 'Copied!' : 'Share Profile'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dash.editBtn, { marginTop: 6 }]}
              onPress={() => router.push('/edit-profile')}
              activeOpacity={0.85}
            >
              <Text style={dash.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dash.logoutBtn, { borderColor: colors.border }]}
              onPress={async () => { await signOut(auth); router.replace('/'); }}
              activeOpacity={0.75}
            >
              <Text style={[dash.logoutText, { color: colors.grey }]}>Log out</Text>
            </TouchableOpacity>
          </View>

          {/* Main content */}
          <ScrollView style={dash.main} contentContainerStyle={dash.mainContent}>
            {isOwn && <PendingAgentClaims musicianId={id} />}
            {activeTab === 'overview'   && <OverviewTab m={musician} isMobileLayout={false} isOwn={isOwn} />}
            {activeTab === 'music'      && <MusicMediaTab m={musician} isOwn={isOwn} />}
            {activeTab === 'techrider'  && <TechRiderTab m={musician} isOwn={isOwn} />}
            {activeTab === 'timetable'  && <ShowsAvailabilityTab m={musician} isOwn={isOwn} isMobileLayout={false} musicianId={id} publicGigs={gigsForTabs} awayPeriods={(musician as any).awayPeriods ?? []} />}
            {activeTab === 'gigs'       && isOwn && <MyGigsContent embedded />}
            {activeTab === 'dashboard'  && isOwn && <DashboardContent />}
            <View style={{ height: 40 }} />
          </ScrollView>

        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges ?? ['bottom']}>
      {isWeb && <MusicianHead musician={musician} slug={musician.username || id} />}
      {isPublicPreview && (
        <View style={[styles.previewBanner, { backgroundColor: colors.black }]}>
          <Text style={styles.previewBannerText}>Previewing as the public would see this profile</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/profile' as any)} activeOpacity={0.75}>
            <Text style={styles.previewBannerExit}>Exit preview</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Desktop web: top nav bar with back button */}
      {!isProfileTab && isWeb && !isMobileLayout && (
        <View style={[styles.webNavBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 16, color: colors.grey }}>‹</Text>
            <Text style={{ fontSize: 14, color: colors.grey }}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView ref={scrollRef}>

        {/* Cover photo */}
        <View>
          {(musician.coverPhotoUrl || musician.photoUrl) ? (
            <PositionedBanner
              uri={musician.coverPhotoUrl || musician.photoUrl!}
              position={musician.photoPosition}
              height={isWeb ? 300 : 220}
            />
          ) : (
            <View style={[styles.bannerPlaceholder, { backgroundColor: colors.bgFaint }]} />
          )}

          {/* Profile avatar overlapping the cover */}
          {musician.photoUrl && (
            <View style={[styles.avatarWrap, { borderColor: colors.bg, backgroundColor: colors.bgFaint }]}>
              <Image source={{ uri: musician.photoUrl }} style={styles.avatarImg} resizeMode="cover" />
            </View>
          )}
        </View>

        {/* Profile header */}
        <View style={[styles.profileHead, { borderBottomColor: colors.border, paddingTop: musician.photoUrl ? 68 : 22 }]}>

          {/* Name + insured badge */}
          <View style={[styles.nameRow, isMobileLayout && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: isMobileLayout ? undefined : 1 }}>
              <Text style={[styles.name, { color: colors.black }]} numberOfLines={2}>
                {musician.name || 'Unnamed Act'}
              </Text>
              {musician.payment?.publicLiabilityHeld && (
                <View style={styles.insuredBadge}>
                  <Text style={styles.insuredBadgeText}>✓ Insured</Text>
                </View>
              )}
            </View>
            {/* Action buttons */}
            {isOwn ? (
              <View style={[styles.ownerBtns, isMobileLayout && { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={shareProfile}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.black }]}>
                    {shareCopied ? 'Copied!' : 'Share profile'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={() => router.push('/edit-profile')}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.black }]}>Edit profile</Text>
                </TouchableOpacity>
              </View>
            ) : user ? (
              <View style={[styles.ownerBtns, isMobileLayout && { marginTop: 10 }]}>
                {musician.songs && musician.songs.filter(s => s.title && s.url).length > 0 && (
                  <TouchableOpacity
                    style={[styles.outlineBtn, { borderColor: colors.border }]}
                    onPress={() => { const s = musician.songs!.find(s => s.title && s.url); if (s?.url) Linking.openURL(s.url); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.outlineBtnText, { color: colors.black }]}>▶ Listen</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push({ pathname: '/messages', params: { recipientId: musician.id, recipientName: musician.name || 'Artist' } } as any)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>Message artist</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* Subline */}
          {(() => {
            const subParts = [
              actType || null,
              musician.location ? musician.location.split(',')[0]?.trim() : null,
              getActSize(musician),
              musician.username ? `@${musician.username}` : null,
            ].filter(Boolean);
            return subParts.length > 0 ? (
              <Text style={[styles.subline, { color: colors.grey }]}>{subParts.join(' · ')}</Text>
            ) : null;
          })()}

          {/* Genre chips — neutral */}
          {allGenres.length > 0 && (
            <View style={styles.genres}>
              {allGenres.map(g => (
                <View key={g} style={[styles.genrePill, { borderColor: colors.border }]}>
                  <Text style={[styles.genreText, { color: colors.black }]}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Pending agent claim requests (own profile only) */}
        {isOwn && <PendingAgentClaims musicianId={id} />}

        {/* Key facts strip */}
        {(() => {
          const kfItems: { title: string; value: string; sub?: string }[] = [];
          const gstText = musician.payment?.gstRegistered ? 'incl. GST' : 'excl. GST';
          if (feeStr) kfItems.push({ title: 'Fee', value: feeStr, sub: `Per gig, ${gstText}` });
          if (musician.averageDraw != null) kfItems.push({ title: 'Average draw', value: String(musician.averageDraw), sub: 'People per show' });
          if (musician.setLengths && musician.setLengths.length > 0) {
            const setLabel = musician.setType ? `Minutes · ${musician.setType}` : 'Minutes';
            kfItems.push({ title: 'Sets', value: musician.setLengths.join(' · '), sub: setLabel });
          }
          if (musician.travel) {
            const suburb = musician.location ? musician.location.split(',')[0]?.trim() : null;
            kfItems.push({ title: 'Travel', value: musician.travel, sub: suburb ? `From ${suburb}` : undefined });
          }
          const confirmedAll = gigsForTabs.filter(g => g.startAt && g.venueName && (g.status == null || g.status === 'confirmed'));
          const confirmedCount = confirmedAll.length;
          const upcomingCount = confirmedAll.filter(g => g.startAt.toDate() >= now).length;
          const showsValue = confirmedCount > 0 ? String(confirmedCount) : 'New to Twaylo';
          const showsSub   = confirmedCount > 0 ? `${upcomingCount} coming up` : undefined;
          kfItems.push({ title: 'Shows on Twaylo', value: showsValue, sub: showsSub });
          if (kfItems.length === 0) return null;
          return (
            <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
              {kfItems.map((kf, i) => (
                <View
                  key={kf.title}
                  style={[styles.statCell, { borderRightColor: colors.border }, i === kfItems.length - 1 && { borderRightWidth: 0 }]}
                >
                  <Text style={[styles.statTitle, { color: colors.grey }]}>{kf.title}</Text>
                  <Text style={[styles.statValue, { color: colors.black }]}>{kf.value}</Text>
                  {kf.sub ? <Text style={[styles.statSub, { color: colors.grey }]}>{kf.sub}</Text> : null}
                </View>
              ))}
            </View>
          );
        })()}

        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
          {([
            { id: 'overview',   label: 'Overview'       },
            { id: 'music',      label: 'Music & Media'       },
            { id: 'techrider',  label: 'Tech Rider'           },
            { id: 'timetable',  label: 'Shows & availability' },
            ...(isOwn ? [{ id: 'dashboard', label: 'Dashboard' }] : []),
          ] as const).map((tab: { id: string; label: string }) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id as any)}
            >
              <Text style={[
                styles.tabText,
                { color: activeTab === tab.id ? colors.black : colors.grey },
                activeTab === tab.id && styles.tabTextActive,
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'overview'   && <OverviewTab m={musician} isMobileLayout={isMobileLayout} isOwn={isOwn} />}
        {activeTab === 'music'      && <MusicMediaTab m={musician} isOwn={isOwn} />}
        {activeTab === 'techrider'  && <TechRiderTab m={musician} isOwn={isOwn} />}
        {activeTab === 'timetable'  && <ShowsAvailabilityTab m={musician} isOwn={isOwn} isMobileLayout={true} musicianId={id} publicGigs={gigsForTabs} awayPeriods={(musician as any).awayPeriods ?? []} />}
        {activeTab === 'gigs'       && isOwn && <MyGigsContent embedded />}
        {activeTab === 'dashboard'  && isOwn && <DashboardContent />}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Floating back button — mobile only (desktop uses the nav bar above) */}
      {!isProfileTab && (!isWeb || isMobileLayout) && (
        <SafeAreaView edges={['top']} style={styles.backOverlayWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.backOverlay} onPress={handleBack}>
            <Text style={styles.backOverlayText}>← Back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </SafeAreaView>
  );
}

// ── Overview tab styles ────────────────────────────────────────────
const ov = StyleSheet.create({
  layout:           { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, paddingBottom: 40 },
  main:             { flex: 1 },
  aside:            { width: 300, flexShrink: 0 },
  asideMobile:      { width: '100%' as any },
  section:          { marginBottom: 28 },
  sectionHeading:   { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, marginBottom: 12 },
  body:             { fontSize: 15, lineHeight: 22 },
  readMore:         { fontSize: 14, color: Colors.orange, fontWeight: '600', marginTop: 8 },
  metaLine:         { fontSize: 13, marginTop: 8, lineHeight: 18 },
  memberRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  memberName:       { fontSize: 14, fontWeight: '600' },
  memberRole:       { fontSize: 14 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:             { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 4 },
  chipText:         { fontSize: 12, fontWeight: '500' },
  trackCard:        { borderRadius: 12, padding: 14, marginBottom: 12 },
  trackCardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  trackCardLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' as const },
  trackCardAllLink: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  trackCardRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackCardPlayBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#B84A06', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  trackCardPlayText:{ fontSize: 11, color: '#ffffff', marginLeft: 2 },
  trackCardTitle:   { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  trackCardNotes:   { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  asideCard:        { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  asideCardTitle:   { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  linkRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  linkLabel:        { fontSize: 13 },
  linkArrow:        { fontSize: 13 },
  credRow:          { flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'flex-start' },
  credIcon:         { fontSize: 14, fontWeight: '700', marginTop: 1, flexShrink: 0 },
  credText:         { fontSize: 13, lineHeight: 18, flex: 1 },
  noteText:         { fontSize: 12, lineHeight: 17, marginTop: 4 },
});

// ── Music & Media tab styles ───────────────────────────────────────
const mm = StyleSheet.create({
  sectionHeading: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  trackRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, gap: 12 },
  trackNumWrap:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  trackNum:       { fontSize: 12, fontWeight: '600' },
  featuredLabel:  { fontSize: 12, fontWeight: '700' },
  trackTitle:     { fontSize: 14, fontWeight: '600' },
  trackNotes:     { fontSize: 12, marginTop: 2, lineHeight: 17 },
  trackDuration:  { fontSize: 13 },
  openBtn:        { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  openBtnText:    { fontSize: 12, fontWeight: '600' },
  photoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoTile:      { width: isWeb ? '23%' as any : '47%' as any, aspectRatio: 4 / 3, borderRadius: 8, overflow: 'hidden' },
  lightboxBack:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg:    { width: '100%', height: '80%' },
  lightboxClose:  { position: 'absolute', top: 48, right: 20, padding: 10 },
  lightboxCloseText: { fontSize: 22, color: '#ffffff', fontWeight: '300' },
  lightboxNav:    { position: 'absolute', top: '40%' as any, padding: 16 },
  lightboxNavL:   { left: 0 },
  lightboxNavR:   { right: 0 },
  lightboxNavText:{ fontSize: 32, color: '#ffffff', fontWeight: '300' },
});

// ── Tech rider tab styles ──────────────────────────────────────────
const tr_ = StyleSheet.create({
  card:           { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle:      { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  docsRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  docBtn:         { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  docBtnText:     { fontSize: 13, fontWeight: '600' },
  specRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  specLabel:      { fontSize: 13 },
  specValue:      { fontSize: 13, fontWeight: '600', textAlign: 'right' as const, flex: 1, marginLeft: 16 },
  inputTable:     { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  inputRow:       { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10 },
  inputHeader:    { borderBottomWidth: 1 },
  headerText:     { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  inputCell:      { fontSize: 13 },
  inputChNum:     { width: 30 },
  inputMicDi:     { width: 80, textAlign: 'right' as const },
  backlineSection:{ },
  backlineLabel:  { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  chipRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:           { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 4 },
  chipOutline:    { borderWidth: 1.5 },
  chipText:       { fontSize: 12, fontWeight: '500' },
  notesText:      { fontSize: 13, lineHeight: 19, marginTop: 10 },
  lockedNote:     { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 16 },
  lockedNoteText: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' as const },
  editBtn:        { borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginBottom: 24 },
  editBtnText:    { fontSize: 14, fontWeight: '600' },
});

// ── Shows & availability tab styles ───────────────────────────────
const sa_ = StyleSheet.create({
  body:             { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  calPanel:         { width: 210, borderWidth: 1, borderRadius: 12, padding: 16, flexShrink: 0 },
  calPanelTitle:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' as const },
  section:          { marginBottom: 32 },
  sectionHeading:   { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, marginBottom: 12 },
  showRow:          { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  showVenue:        { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  showMeta:         { fontSize: 13, marginBottom: 2 },
  showDate:         { fontSize: 13 },
  slotBadge:        { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0, marginTop: 2 },
  slotBadgeText:    { fontSize: 12, fontWeight: '600' },
  // Status badges matching My Gigs
  badgePending:     { backgroundColor: Colors.orange + '22', borderWidth: 1, borderColor: Colors.orange + '66', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0, marginTop: 2 },
  badgePendingText: { fontSize: 11, fontWeight: '700', color: Colors.orange },
  badgeBooked:      { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0, marginTop: 2 },
  badgeBookedText:  { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  badgeTwaylo:      { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0, marginTop: 2 },
  badgeTwayloText:  { fontSize: 11, fontWeight: '700', color: '#111' },
  calLegend:        { gap: 6, marginBottom: 14 },
  calLegendItem:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calLegendDot:     { width: 8, height: 8, borderRadius: 4 },
  calLegendText:    { fontSize: 12 },
  calFooter:        { fontSize: 12, lineHeight: 17, marginTop: 10, fontStyle: 'italic' as const },
});

// ── Styles ────────────────────────────────────────────────────────

const BANNER_H = isWeb ? 360 : 280;

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  bannerPlaceholder: { width: '100%', height: BANNER_H },

  // Profile avatar overlapping cover
  avatarWrap: {
    position: 'absolute',
    bottom: -56, left: isWeb ? 40 : 20,
    width: 112, height: 112,
    borderRadius: 56, borderWidth: 3,
    overflow: 'hidden',
    zIndex: 2,
  },
  avatarImg: { width: '100%', height: '100%' },

  // Insured badge
  insuredBadge:     { backgroundColor: '#EEF0F7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  insuredBadgeText: { fontSize: 11, fontWeight: '700', color: '#2B3A67' },

  // Subline
  subline: { fontSize: 13, marginBottom: 10, marginTop: 2 },

  // Primary action button
  primaryBtn:     { backgroundColor: '#B84A06', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  backOverlayWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  backOverlay: {
    alignSelf: 'flex-start', margin: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  backOverlayText: { fontSize: 14, fontWeight: '600', color: Colors.black },
  webNavBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  previewBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 16 },
  previewBannerText: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  previewBannerExit: { fontSize: 12, fontWeight: '700', color: Colors.orange },
  backBtn:         { padding: 20 },
  backText:        { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound:        { textAlign: 'center', marginTop: 40, fontSize: 15 },

  // Profile header
  profileHead: {
    paddingHorizontal: isWeb ? 40 : 20,
    paddingTop: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
  },
  breadcrumb: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange, letterSpacing: 1.4,
    marginBottom: 10,
  },
  nameRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12, marginBottom: 6,
  },
  name: {
    fontSize: isWeb ? 38 : 28, fontWeight: '800',
    letterSpacing: -0.5, flex: 1,
  },
  ownerBtns:      { flexDirection: 'row', gap: 8, flexShrink: 0, marginTop: 4 },
  outlineBtn:     { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  outlineBtnText: { fontSize: 13, fontWeight: '600' },
  orangeBtn:      { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  orangeBtnText:  { fontSize: 13, fontWeight: '700', color: '#111111' },
  username:       { fontSize: 13, marginBottom: 10 },
  genres:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  genrePill:      { borderWidth: 1, borderColor: '#E7E6E3', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  genreText:      { fontSize: 12, color: '#16161A', fontWeight: '500' },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'flex-start', justifyContent: 'flex-start',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRightWidth: 1,
  },
  statTitle: { fontSize: 12, marginBottom: 6 },
  statValue: { fontSize: isWeb ? 22 : 17, fontWeight: '800', letterSpacing: -0.5 },
  statSub:   { fontSize: 11, lineHeight: 15, marginTop: 4 },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 3 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: isWeb ? 40 : 0,
  },
  tab:           { paddingVertical: 14, paddingHorizontal: isWeb ? 20 : 18, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:     { borderBottomColor: '#16161A' },
  tabText:       { fontSize: 14, fontWeight: '600' },
  tabTextActive: { fontWeight: '700' },

  // Two-column layout (web)
  overviewLayout:  {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, gap: 28,
  },
  overviewMain:    { flex: 1, paddingBottom: 28 },
  overviewSidebar: { width: 310, gap: 0 },
  mobileSidebar:   { gap: 0 },
  mobileContent:   { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 24, paddingBottom: 4 },
  tabContent:      { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 16,
  },
  managedBy: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 16 },
  body:      { fontSize: 15, lineHeight: 22 },
  readMore:  { fontSize: 14, color: Colors.orange, fontWeight: '600', marginTop: 8 },
  emptyState:{ fontSize: 14, fontStyle: 'italic' },

  // Sidebar cards
  sideCard: {
    borderWidth: 1, borderRadius: 12,
    padding: 16, marginBottom: 12,
  },
  sideSectionLabel: {
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 10,
  },
  sideFee:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  sideLink: { fontSize: 14, color: Colors.orange, fontWeight: '500', marginBottom: 6 },
  sideBody: { fontSize: 14, lineHeight: 20 },

  // Gigs summary (Overview): plain lines grouped by Upcoming/Past/Away
  gigGroup:      { marginBottom: 12 },
  gigGroupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 6 },
  gigLine:       { fontSize: 14, lineHeight: 20, marginBottom: 3 },

  // Music tab — tracks
  trackRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, gap: 12,
  },
  trackNum: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  trackNumText:  { fontSize: 12, fontWeight: '600' },
  trackTitle:    { flex: 1, fontSize: 14, fontWeight: '600' },
  trackMeta:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackDuration: { fontSize: 13 },
  playBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnText: { fontSize: 10, color: '#111111', marginLeft: 2 },

  // Links grid
  linksGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  linkCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    width: isWeb ? ('calc(50% - 5px)' as any) : '47%',
  },
  linkCardLabel: { fontSize: 14, fontWeight: '600' },
  linkCardArrow: { fontSize: 16 },

  // Embeds
  embedWrap: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },

  // Instagram profile card
  igCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 12, borderWidth: 1 },
  igCardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  igAvatar:     { width: 48, height: 48, borderRadius: 14, backgroundColor: '#C13584', alignItems: 'center', justifyContent: 'center' },
  igAvatarText: { color: '#ffffff', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  igHandle:     { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  igSub:        { fontSize: 13 },
  igArrow:      { fontSize: 20, fontWeight: '300' },
});

// ── Musician timetable styles (web) ──────────────────────────────
const mt = StyleSheet.create({
  tabBody:       { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, paddingBottom: 40 },
  filterRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  filterTabs:    { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  filterTab:     { paddingHorizontal: 18, paddingVertical: 9 },
  filterTabActive: { backgroundColor: Colors.orange },
  filterTabText: { fontSize: 13, fontWeight: '600' },
  countRow:      { gap: 8 },
  countLabel:    { fontSize: 13, fontWeight: '500' },
  monthNavRow:   { flexDirection: 'row', gap: 10 },
  monthNavBtn:   { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#e0e0e0' },
  monthNavText:  { fontSize: 13, fontWeight: '600' },
  body:          { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  // Calendar panel
  calPanel:      { width: 210, borderWidth: 1, borderRadius: 12, padding: 16 },
  calPanelTitle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  calLegend:     { gap: 6, marginBottom: 20 },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calLegendText: { fontSize: 11 },
  calDot:        { width: 8, height: 8, borderRadius: 4 },
  calMonth:      { marginBottom: 18 },
  calMonthLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  calDowRow:     { flexDirection: 'row', marginBottom: 2 },
  calDow:        { flex: 1, textAlign: 'center' as const, fontSize: 9, fontWeight: '700' },
  calGrid:       { flexDirection: 'row', flexWrap: 'wrap' },
  calCell:       { width: '14.28%' as any, alignItems: 'center', paddingVertical: 2 },
  calDayCircle:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calDayCircleToday: { backgroundColor: Colors.orange },
  calDayNum:     { fontSize: 10, fontWeight: '600' },
  calDots:       { flexDirection: 'row', gap: 1, minHeight: 6, marginTop: 1, justifyContent: 'center' },
  // List area
  listArea:      { flex: 1 },
  emptyText:     { fontSize: 15, paddingVertical: 40, textAlign: 'center' as const },
  monthGroup:    { marginBottom: 24 },
  monthHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  monthLabel:    { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  monthFreeCount:{ fontSize: 11, color: Colors.orange, fontWeight: '600' },
  // Entry row
  entryRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, marginBottom: 8, paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  dateBox:       { width: 36, alignItems: 'center', flexShrink: 0 },
  dateNum:       { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  dateMonth:     { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  dayAbbrev:     { width: 28, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.5, flexShrink: 0 },
  entryMain:     { fontSize: 15, fontWeight: '700' },
  entrySub:      { fontSize: 13, marginTop: 2 },
  statusBadge:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0 },
  statusBadgeText: { fontSize: 12, fontWeight: '600' },
  linkBtn:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  linkBtnText:   { fontSize: 12, fontWeight: '600' },
  ticketBtn:     { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, flexShrink: 0 },
  ticketBtnText: { fontSize: 12, fontWeight: '700', color: '#111111' },
  messageBtn:    { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, flexShrink: 0 },
  messageBtnText:{ fontSize: 13, fontWeight: '700', color: '#111111' },
});

// ── Musician timetable styles (native) ───────────────────────────
const nmt = StyleSheet.create({
  filterRow:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  filterControl: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  filterBtn:     { paddingHorizontal: 16, paddingVertical: 10 },
  filterBtnActive: { backgroundColor: Colors.orange },
  filterText:    { fontSize: 13, fontWeight: '700' },
  countNav:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8 },
  countRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 4 },
  countLabel:    { fontSize: 13, fontWeight: '500' },
  dateRange:     { fontSize: 12, fontWeight: '400' },
  navBtns:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  navBtn:        { paddingVertical: 6, alignSelf: 'flex-start' as const },
  navBtnText:    { fontSize: 13, fontWeight: '600' },
  legend:        { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 4 },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:     { width: 9, height: 9, borderRadius: 5 },
  legendText:    { fontSize: 12 },
  emptyText:     { textAlign: 'center' as const, fontSize: 14, fontStyle: 'italic', paddingVertical: 32, paddingHorizontal: 20 },
  monthGroup:    { marginBottom: 20 },
  monthLabel:    { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 16, paddingBottom: 10, paddingTop: 14, textTransform: 'uppercase' as const },
  // Native entry card
  card:          { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 14, gap: 12 },
  dateBox:       { width: 36, alignItems: 'center', flexShrink: 0, paddingTop: 2 },
  dateNum:       { fontSize: 18, fontWeight: '800', lineHeight: 20 },
  dateMonth:     { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  main:          { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  sub:           { fontSize: 13, marginBottom: 2 },
  notes:         { fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  linkText:      { fontSize: 13, color: Colors.orange, fontWeight: '600', marginRight: 4 },
  msgBtn:        { marginTop: 10, backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' as const },
  msgBtnText:    { fontSize: 13, fontWeight: '700', color: '#111111' },
  badge:         { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0, alignSelf: 'flex-start', marginTop: 2 },
  badgeText:     { fontSize: 11, fontWeight: '600' },
});

// ── Dashboard styles (web desktop, own profile) ────────────────────
const dash = StyleSheet.create({
  container:        { flex: 1, flexDirection: 'row' },
  sidebar:          { width: 224, borderRightWidth: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  photo:            { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  photoPlaceholder: { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  sidebarName:      { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, marginBottom: 3 },
  sidebarHandle:    { fontSize: 12, marginBottom: 6 },
  sidebarMeta:      { fontSize: 11, fontWeight: '700', color: Colors.orange, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16 },
  viewPublicBtn:    { borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  viewPublicText:   { fontSize: 13, fontWeight: '600' },
  divider:          { height: 1, marginVertical: 18 },
  navItem:          { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 7, marginBottom: 2 },
  navItemActive:    { backgroundColor: Colors.orange + '18' },
  navText:          { fontSize: 14, fontWeight: '600' },
  editBtn:          { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  editBtnText:      { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  logoutBtn:        { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  logoutText:       { fontSize: 13, fontWeight: '600' },
  main:             { flex: 1 },
  mainContent:      { paddingHorizontal: 40, paddingVertical: 32 },
});
