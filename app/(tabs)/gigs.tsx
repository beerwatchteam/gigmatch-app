import { useState, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, useWindowDimensions, Modal, TextInput,
} from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection, onSnapshot, query, where, orderBy, doc, getDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';
import { Redirect } from 'expo-router';
import { toZonedTime } from 'date-fns-tz';
import { type Gig } from '@/lib/gig-types';
import { cancelVenueGig, deleteArtistGig } from '@/lib/useGigs';
import { PaymentCard, PaymentDueChip } from '@/components/PaymentCard';
import { isPaymentActive, paymentExpectation } from '@/lib/payments';
import ArtistGigForm from '@/components/ArtistGigForm';
import VenueGigForm from '@/components/VenueGigForm';

const isWeb = Platform.OS === 'web';

// ── Types ─────────────────────────────────────────────────────────────────────

type GigWithId   = Gig & { id: string };
type AwayPeriod  = { id: string; from: string; to?: string; notes?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGigDate(gig: GigWithId): string {
  try {
    const tz   = gig.timezone ?? 'Australia/Melbourne';
    const date = toZonedTime(gig.startAt.toDate(), tz);
    const dd   = String(date.getDate()).padStart(2, '0');
    const mon  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getMonth()];
    const yr   = date.getFullYear();
    const hh   = String(date.getHours()).padStart(2, '0');
    const mm   = String(date.getMinutes()).padStart(2, '0');
    return `${dd} ${mon} ${yr}  ${hh}:${mm}`;
  } catch {
    return '';
  }
}

function isCompleted(gig: GigWithId): boolean {
  if (gig.status !== 'confirmed') return false;
  const endAt = gig.endAt?.toDate() ?? new Date(gig.startAt.toDate().getTime() + 60 * 60_000);
  return endAt < new Date();
}

function gigTitle(gig: GigWithId): string {
  return gig.title ?? (gig.artistName || gig.bandName) ?? '';
}

function sourceLabel(gig: GigWithId): string {
  if (gig.source === 'enquiry')      return 'Twaylo booking';
  if (gig.source === 'venue_created') return 'Venue added';
  return 'Added by me';
}

// ── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source, colors }: { source: Gig['source']; colors: any }) {
  const [label, bg, fg] =
    source === 'enquiry'       ? ['Twaylo',     Colors.orange,   '#111'] :
    source === 'venue_created' ? ['Venue added', colors.bgFaint, colors.grey] :
                                 ['My booking',  colors.bgFaint, colors.grey];
  return (
    <View style={[badge.pill, { backgroundColor: bg }]}>
      <Text style={[badge.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  pill:  { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});

// ── Gig row ───────────────────────────────────────────────────────────────────

function GigRow({
  gig, expanded, onPress, onEdit, onCancel, onDelete, isArtist, uid, colors,
}: {
  gig:       GigWithId;
  expanded:  boolean;
  onPress:   () => void;
  onEdit:    () => void;
  onCancel:  () => void;
  onDelete?: () => void;
  isArtist:  boolean;
  uid:       string;
  colors:    any;
}) {
  const cancelled  = gig.status === 'cancelled';
  const completed  = !cancelled && isCompleted(gig);

  const statusColor = cancelled ? Colors.danger
    : completed ? colors.grey
    : '#16a34a';
  const statusText  = cancelled ? 'Cancelled' : completed ? 'Completed' : 'Confirmed';

  return (
    <TouchableOpacity
      style={[row.card, { backgroundColor: colors.bg, borderColor: colors.border }, cancelled && row.cardCancelled]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Main row */}
      <View style={row.main}>
        <View style={row.left}>
          <Text style={[row.title, { color: cancelled ? colors.grey : colors.black }]} numberOfLines={1}>
            {gigTitle(gig) || (isArtist ? gig.venueName : gig.artistName || gig.bandName) || 'Untitled gig'}
          </Text>
          <Text style={[row.sub, { color: colors.grey }]} numberOfLines={1}>
            {isArtist ? gig.venueName : (gig.artistName || gig.bandName)}
            {gig.room ? ` · ${gig.room}` : ''}
          </Text>
          <Text style={[row.date, { color: colors.grey }]}>{formatGigDate(gig)}</Text>
        </View>
        <View style={row.right}>
          <SourceBadge source={gig.source} colors={colors} />
          <Text style={[row.status, { color: statusColor }]}>{statusText}</Text>
        </View>
      </View>

      {/* Payment due chip on the collapsed row */}
      {!expanded && !cancelled && gig.status === 'confirmed' && (() => {
        const ps = (gig as any).payment?.status;
        if (!ps || ps === 'not_applicable' || ps === 'confirmed' || ps === 'self_reported') return null;
        const active = isPaymentActive(gig as any, new Date());
        if (!active) return null;
        const exp = paymentExpectation(gig.fee);
        if (exp.mode === 'none') return null;
        return <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}><PaymentDueChip colors={colors} /></View>;
      })()}

      {/* Expanded detail */}
      {expanded && (
        <View style={[row.detail, { borderTopColor: colors.border }]}>
          {gig.description ? (
            <Text style={[row.detailText, { color: colors.grey }]}>{gig.description}</Text>
          ) : null}
          {gig.locationText ? (
            <Text style={[row.detailText, { color: colors.grey }]}>{gig.locationText}</Text>
          ) : null}
          {gig.fee?.type && gig.fee.type !== 'other' ? (
            <Text style={[row.detailText, { color: colors.grey }]}>
              Fee: {gig.fee.type.replace(/_/g, ' ')}
              {gig.fee.amountCents ? ` · $${(gig.fee.amountCents / 100).toFixed(0)}` : ''}
            </Text>
          ) : null}

          {/* Payment card */}
          {gig.status === 'confirmed' && (gig as any).payment && (
            <PaymentCard
              gig={gig as any}
              uid={uid}
              isVenue={!isArtist}
              otherPartyName={isArtist ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist')}
            />
          )}

          {!cancelled && (
            <View style={row.actions}>
              <TouchableOpacity style={[row.btn, { borderColor: colors.border }]} onPress={onEdit}>
                <Text style={[row.btnText, { color: colors.black }]}>Edit</Text>
              </TouchableOpacity>
              {gig.source === 'artist_added' && isArtist ? (
                <TouchableOpacity style={[row.btn, row.btnDanger]} onPress={onDelete}>
                  <Text style={[row.btnText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[row.btn, row.btnDanger]} onPress={onCancel}>
                  <Text style={[row.btnText, { color: Colors.danger }]}>Cancel gig</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const row = StyleSheet.create({
  card:         { borderWidth: 1, borderRadius: 14, marginBottom: 10, overflow: 'hidden' },
  cardCancelled:{ opacity: 0.55 },
  main:         { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10 },
  left:         { flex: 1, gap: 3 },
  right:        { alignItems: 'flex-end', gap: 5 },
  title:        { fontSize: 15, fontWeight: '700' },
  sub:          { fontSize: 13 },
  date:         { fontSize: 12 },
  status:       { fontSize: 12, fontWeight: '700' },
  detail:       { borderTopWidth: 1, padding: 14, gap: 8 },
  detailText:   { fontSize: 13 },
  actions:      { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn:          { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  btnDanger:    { borderColor: Colors.danger + '60' },
  btnText:      { fontSize: 13, fontWeight: '600' },
});

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count, colors }: { title: string; count: number; colors: any }) {
  return (
    <View style={sh.row}>
      <Text style={[sh.title, { color: colors.black }]}>{title}</Text>
      <Text style={[sh.count, { color: colors.grey }]}>{count}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 10, marginTop: 18 },
  title: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' as const },
  count: { fontSize: 13 },
});

// ── Away period helpers ───────────────────────────────────────────────────────

function AwayDateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (Platform.OS === 'web') {
    return (
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, border: '1px solid #ccc', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit', background: 'transparent', color: 'inherit' } as any}
      />
    );
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? 'YYYY-MM-DD'}
      placeholderTextColor="#aaa"
      style={away.dateInput}
    />
  );
}

function AwayPeriodRow({ period, onEdit, onDelete, colors }: { period: AwayPeriod; onEdit: () => void; onDelete: () => void; colors: any }) {
  const label = period.to && period.to !== period.from
    ? `${fmtDate(period.from)} to ${fmtDate(period.to)}`
    : fmtDate(period.from);
  return (
    <View style={[away.row, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <View style={away.rowLeft}>
        <Text style={[away.rowLabel, { color: colors.black }]}>{label}</Text>
        {period.notes ? <Text style={[away.rowNotes, { color: colors.grey }]}>{period.notes}</Text> : null}
      </View>
      <View style={away.rowActions}>
        <TouchableOpacity onPress={onEdit} style={[away.rowBtn, { borderColor: colors.border }]}>
          <Text style={[away.rowBtnText, { color: colors.black }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={[away.rowBtn, { borderColor: Colors.danger + '60' }]}>
          <Text style={[away.rowBtnText, { color: Colors.danger }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m, 10) - 1];
  return `${parseInt(d, 10)} ${mon} ${y}`;
}

const away = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 10 },
  rowLeft:    { flex: 1, gap: 3 },
  rowLabel:   { fontSize: 14, fontWeight: '600' },
  rowNotes:   { fontSize: 12 },
  rowActions: { flexDirection: 'row', gap: 6 },
  rowBtn:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rowBtnText: { fontSize: 12, fontWeight: '600' },
  dateInput:  { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  sheet:      { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, gap: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  label:      { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 4 },
  row2:       { flexDirection: 'row', gap: 10 },
  notesInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, minHeight: 60 },
  btns:       { flexDirection: 'row', gap: 10, marginTop: 8 },
  saveBtn:    { flex: 1, backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveBtnText:{ fontSize: 14, fontWeight: '700', color: '#111' },
  cancelBtn:  { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1 },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
});

// ── Shared content (also used embedded in the musician profile dashboard) ─────

export function MyGigsContent({ embedded = false }: { embedded?: boolean }) {
  const { user, profile } = useAuth();
  const { colors }        = useTheme();
  const { width }         = useWindowDimensions();

  const [gigs, setGigs]               = useState<GigWithId[]>([]);
  const [loading, setLoading]         = useState(true);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [actionError, setActionError] = useState('');

  // Form modals
  const [showArtistForm, setShowArtistForm] = useState(false);
  const [showVenueForm, setShowVenueForm]   = useState(false);
  const [editGig, setEditGig]               = useState<GigWithId | null>(null);

  // Away periods
  const [awayPeriods, setAwayPeriods]     = useState<AwayPeriod[]>([]);
  const [showAwayForm, setShowAwayForm]   = useState(false);
  const [editAway, setEditAway]           = useState<AwayPeriod | null>(null);
  const [awayFrom, setAwayFrom]           = useState('');
  const [awayTo, setAwayTo]               = useState('');
  const [awayNotes, setAwayNotes]         = useState('');
  const [awaySaving, setAwaySaving]       = useState(false);

  // Venue info for VenueGigForm
  const [venueDoc, setVenueDoc] = useState<any>(null);

  const isArtist = profile?.type !== 'venue';
  const uid      = user?.uid ?? '';
  const venueId  = profile?.venueId ?? null;

  // Load venue doc for venue gig form
  useEffect(() => {
    if (!isArtist && venueId) {
      getDoc(doc(db, 'venues', venueId)).then(s => {
        if (s.exists()) setVenueDoc({ id: s.id, ...s.data() });
      }).catch(() => {});
    }
  }, [isArtist, venueId]);

  // Load away periods from artist profile
  useEffect(() => {
    if (!isArtist || !uid) return;
    getDoc(doc(db, 'bandProfiles', uid)).then(s => {
      if (s.exists()) setAwayPeriods((s.data().awayPeriods ?? []) as AwayPeriod[]);
    }).catch(() => {});
  }, [isArtist, uid]);

  const openAwayForm = (period: AwayPeriod | null) => {
    setEditAway(period);
    setAwayFrom(period?.from ?? '');
    setAwayTo(period?.to ?? '');
    setAwayNotes(period?.notes ?? '');
    setShowAwayForm(true);
  };

  const saveAwayPeriod = async () => {
    if (!awayFrom) return;
    setAwaySaving(true);
    try {
      const updated = editAway
        ? awayPeriods.map(p => p.id === editAway.id ? { ...p, from: awayFrom, to: awayTo || undefined, notes: awayNotes || undefined } : p)
        : [...awayPeriods, { id: Date.now().toString(36), from: awayFrom, to: awayTo || undefined, notes: awayNotes || undefined }];
      await updateDoc(doc(db, 'bandProfiles', uid), { awayPeriods: updated });
      setAwayPeriods(updated);
      setShowAwayForm(false);
    } catch {
      // silent — offline or permission error
    } finally {
      setAwaySaving(false);
    }
  };

  const deleteAwayPeriod = async (id: string) => {
    const updated = awayPeriods.filter(p => p.id !== id);
    try {
      await updateDoc(doc(db, 'bandProfiles', uid), { awayPeriods: updated });
      setAwayPeriods(updated);
    } catch {
      // silent
    }
  };

  // Live query from gigs collection
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'gigs'),
      where('participantIds', 'array-contains', uid),
      orderBy('startAt', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setGigs(snap.docs.map(d => ({ id: d.id, ...d.data() } as GigWithId)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [uid]);

  const now = new Date();

  const upcoming = gigs.filter(g =>
    g.status !== 'cancelled' &&
    (g.endAt?.toDate() ?? new Date(g.startAt.toDate().getTime() + 3600_000)) >= now
  );

  const past = [...gigs.filter(g =>
    (g.status !== 'cancelled' || showCancelled) &&
    (g.endAt?.toDate() ?? new Date(g.startAt.toDate().getTime() + 3600_000)) < now
  )].reverse();

  const cancelledCount = gigs.filter(g => g.status === 'cancelled').length;

  const handleCancelGig = useCallback(async (gig: GigWithId) => {
    setActionError('');
    try {
      if (gig.source !== 'artist_added' && gig.venueId) {
        await cancelVenueGig({ gigId: gig.id, venueId: gig.venueId });
      }
    } catch (e: any) {
      if (e?.code === 'unavailable') {
        setActionError("You're offline. Try again when connected.");
      } else {
        setActionError(e?.message ?? 'Failed to cancel gig.');
      }
    }
  }, []);

  const handleDeleteGig = useCallback(async (gig: GigWithId) => {
    setActionError('');
    try {
      await deleteArtistGig({ gigId: gig.id, artistUid: uid });
    } catch (e: any) {
      if (e?.code === 'unavailable') {
        setActionError("You're offline. Try again when connected.");
      } else {
        setActionError(e?.message ?? 'Failed to delete gig.');
      }
    }
  }, [uid]);

  const openEdit = (gig: GigWithId) => {
    setEditGig(gig);
    if (isArtist) setShowArtistForm(true);
    else          setShowVenueForm(true);
  };

  const handleFormSaved = () => {
    setShowArtistForm(false);
    setShowVenueForm(false);
    setEditGig(null);
  };

  const contentMaxWidth = isWeb && !embedded && width > 700 ? 640 : undefined;

  if (!user) return null;

  return (
    <View style={[embedded ? s.embedded : s.scroll, contentMaxWidth ? { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth } : {}]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={[s.heading, { color: colors.black }]}>My Gigs</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {isArtist && (
              <TouchableOpacity
                style={[s.addBtn, { backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => openAwayForm(null)}
              >
                <Text style={[s.addBtnText, { color: colors.black }]}>Away</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.addBtn}
              onPress={() => { setEditGig(null); if (isArtist) setShowArtistForm(true); else setShowVenueForm(true); }}
            >
              <Text style={s.addBtnText}>+ Add gig</Text>
            </TouchableOpacity>
          </View>
        </View>

        {actionError ? (
          <View style={[s.banner, { backgroundColor: Colors.danger + '18' }]}>
            <Text style={[s.bannerText, { color: Colors.danger }]}>{actionError}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={Colors.orange} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Upcoming */}
            <SectionHeader title="Upcoming" count={upcoming.length} colors={colors} />
            {upcoming.length === 0 ? (
              <Text style={[s.empty, { color: colors.grey }]}>No upcoming gigs. Add one above.</Text>
            ) : (
              upcoming.map(g => (
                <GigRow
                  key={g.id} gig={g}
                  expanded={expandedId === g.id}
                  onPress={() => setExpandedId(expandedId === g.id ? null : g.id)}
                  onEdit={() => openEdit(g)}
                  onCancel={() => handleCancelGig(g)}
                  onDelete={() => handleDeleteGig(g)}
                  isArtist={isArtist} uid={uid} colors={colors}
                />
              ))
            )}

            {/* Past */}
            <SectionHeader title="Past" count={past.length} colors={colors} />
            {past.length === 0 ? (
              <Text style={[s.empty, { color: colors.grey }]}>
                No past gigs yet.{isArtist ? ' Use "+ Add gig" above and pick any past date.' : ''}
              </Text>
            ) : (
              past.map(g => (
                <GigRow
                  key={g.id} gig={g}
                  expanded={expandedId === g.id}
                  onPress={() => setExpandedId(expandedId === g.id ? null : g.id)}
                  onEdit={() => openEdit(g)}
                  onCancel={() => handleCancelGig(g)}
                  onDelete={() => handleDeleteGig(g)}
                  isArtist={isArtist} uid={uid} colors={colors}
                />
              ))
            )}

            {/* Show cancelled toggle */}
            {cancelledCount > 0 && (
              <TouchableOpacity
                style={s.cancelledToggle}
                onPress={() => setShowCancelled(v => !v)}
              >
                <Text style={[s.cancelledToggleText, { color: colors.grey }]}>
                  {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
                </Text>
              </TouchableOpacity>
            )}

            {/* Away Periods */}
            {isArtist && (
              <>
                <View style={[sh.row, { marginTop: 24 }]}>
                  <Text style={[sh.title, { color: colors.black }]}>Away Periods</Text>
                  <TouchableOpacity onPress={() => openAwayForm(null)}>
                    <Text style={{ color: Colors.orange, fontSize: 13, fontWeight: '700' }}>+ Add</Text>
                  </TouchableOpacity>
                </View>
                {awayPeriods.length === 0 ? (
                  <Text style={[s.empty, { color: colors.grey }]}>No away periods set. Mark dates when you're unavailable.</Text>
                ) : (
                  awayPeriods
                    .slice()
                    .sort((a, b) => a.from.localeCompare(b.from))
                    .map(p => (
                      <AwayPeriodRow
                        key={p.id}
                        period={p}
                        onEdit={() => openAwayForm(p)}
                        onDelete={() => deleteAwayPeriod(p.id)}
                        colors={colors}
                      />
                    ))
                )}
              </>
            )}
          </>
        )}

      {/* Artist gig form modal */}
      {showArtistForm && (
        <ArtistGigForm
          gigId={editGig?.id}
          existingGig={editGig ?? undefined}
          artistUid={uid}
          artistName={profile?.displayName ?? profile?.name ?? ''}
          allGigDates={gigs.filter(g => g.source === 'artist_added').map(g => g.startAt.toDate().toISOString().slice(0, 10))}
          onClose={() => { setShowArtistForm(false); setEditGig(null); }}
          onSaved={handleFormSaved}
        />
      )}

      {/* Venue gig form modal */}
      {showVenueForm && venueId && (
        <VenueGigForm
          gigId={editGig?.id}
          existingGig={editGig ?? undefined}
          venueId={venueId}
          venueUid={uid}
          venue={venueDoc}
          onClose={() => { setShowVenueForm(false); setEditGig(null); }}
          onSaved={handleFormSaved}
        />
      )}

      {/* Away period form modal */}
      <Modal
        visible={showAwayForm}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAwayForm(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowAwayForm(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[away.sheet, { backgroundColor: colors.bg }]}>
              <Text style={[away.sheetTitle, { color: colors.black }]}>
                {editAway ? 'Edit Away Period' : 'Log Away Period'}
              </Text>

              <View>
                <Text style={[away.label, { color: colors.grey }]}>From</Text>
                <View style={away.row2}>
                  <AwayDateInput value={awayFrom} onChange={setAwayFrom} placeholder="From date" />
                </View>
              </View>

              <View>
                <Text style={[away.label, { color: colors.grey }]}>To (optional)</Text>
                <View style={away.row2}>
                  <AwayDateInput value={awayTo} onChange={setAwayTo} placeholder="End date" />
                </View>
              </View>

              <View>
                <Text style={[away.label, { color: colors.grey }]}>Notes (optional)</Text>
                <TextInput
                  value={awayNotes}
                  onChangeText={setAwayNotes}
                  placeholder="e.g. East coast tour, family holiday"
                  placeholderTextColor={colors.grey}
                  style={[away.notesInput, { color: colors.black, borderColor: colors.border }]}
                  multiline
                />
              </View>

              <View style={away.btns}>
                <TouchableOpacity
                  style={[away.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => setShowAwayForm(false)}
                >
                  <Text style={[away.cancelBtnText, { color: colors.black }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[away.saveBtn, !awayFrom && { opacity: 0.4 }]}
                  onPress={saveAwayPeriod}
                  disabled={!awayFrom || awaySaving}
                >
                  <Text style={away.saveBtnText}>{awaySaving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Standalone tab screen ─────────────────────────────────────────────────────

export default function MyGigsScreen() {
  const { user }   = useAuth();
  const { colors } = useTheme();
  if (!user) return <Redirect href="/login" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <MyGigsContent />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll:          { padding: 16, paddingBottom: 40 },
  embedded:        { paddingBottom: 40 },
  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  heading:         { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  addBtn:          { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:      { fontSize: 13, fontWeight: '700', color: '#111' },
  banner:          { borderRadius: 10, padding: 12, marginBottom: 12 },
  bannerText:      { fontSize: 13, fontWeight: '600' },
  empty:           { fontSize: 14, marginBottom: 8 },
  cancelledToggle: { alignSelf: 'center', paddingVertical: 12, marginTop: 8 },
  cancelledToggleText: { fontSize: 13, fontWeight: '600' },
});
