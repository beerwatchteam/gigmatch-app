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
import { useAuth } from '@/lib/auth-context';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
  Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

type Slot = {
  id: string;
  time: string;
  date?: string | null;
  status: 'open' | 'booked' | 'pending';
  bandName?: string;
  room?: string;
  slotType?: string;
  feeMin?: number | null;
  feeMax?: number | null;
  genres?: string[];
  duration?: number;
  notes?: string;
};

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
  slots?: Record<string, Slot[]>;
};

function mergeSlots(recurringOpen: Slot[], overrides: Slot[]): Slot[] {
  const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const merged: Slot[] = [];

  recurringOpen.forEach(open => {
    const replacement = overrides.find(b => {
      const timeMatch = norm(b.time) === norm(open.time);
      const roomMatch = (b.room && open.room) ? norm(b.room) === norm(open.room) : true;
      return timeMatch && roomMatch;
    });
    merged.push(replacement ?? open);
  });

  overrides.forEach(b => {
    if (!merged.find(s => s.id === b.id)) merged.push(b);
  });

  const toMins = (t: string) => {
    if (!t) return 0;
    const [time, period] = t.split(' ');
    const [h, m] = time.split(':').map(Number);
    let hrs = h;
    if (period === 'PM' && h !== 12) hrs += 12;
    if (period === 'AM' && h === 12) hrs = 0;
    return hrs * 60 + m;
  };

  return merged.sort((a, b) => toMins(a.time) - toMins(b.time));
}

function fmtFee(min?: number | null, max?: number | null) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (min != null) return `from $${min}`;
  if (max != null) return `up to $${max}`;
  return null;
}

function statusColor(status: string) {
  if (status === 'booked')  return '#22c55e';
  if (status === 'pending') return Colors.orange;
  return Colors.greyLight;
}

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, user } = useAuth();
  const isArtist = profile?.type === 'artist';

  const [venue, setVenue]     = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'timetable'>('overview');
  const [activeDay, setActiveDay] = useState<string>('');

  useEffect(() => {
    getDoc(doc(db, 'venues', id)).then(snap => {
      if (snap.exists()) {
        const v = { id: snap.id, ...snap.data() } as Venue;
        setVenue(v);
        // Default to first day that has slots
        const firstDay = DAYS.find(d => (v.slots?.[d] || []).some((s: Slot) => s.status === 'open'));
        setActiveDay(firstDay || DAYS[4]); // fallback Friday
      }
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <SafeAreaView style={s.safe}><ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} /></SafeAreaView>
  );

  if (!venue) return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity style={{ padding: 20 }} onPress={() => router.back()}>
        <Text style={s.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={s.notFound}>Venue not found.</Text>
    </SafeAreaView>
  );

  // ── Build timetable for the active day ──
  const daySlots = venue.slots?.[activeDay] || [];
  const openRecurring = daySlots.filter(s => s.status === 'open' && !s.date);
  const overrides     = daySlots.filter(s => s.status !== 'open' || s.date);
  const merged        = mergeSlots(openRecurring, overrides);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView stickyHeaderIndices={[1]}>

        {/* Banner */}
        <View>
          {venue.photoUrl
            ? <Image source={{ uri: venue.photoUrl }} style={s.banner} />
            : <View style={s.bannerPlaceholder}><Text style={s.bannerPlaceholderText}>No photo</Text></View>
          }
          <TouchableOpacity style={s.backOverlay} onPress={() => router.back()}>
            <Text style={s.backOverlayText}>← Back</Text>
          </TouchableOpacity>
        </View>

        {/* Sticky tab switcher */}
        <View style={s.tabSwitcher}>
          {(['overview', 'timetable'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.tabSwitchBtn, activeTab === tab && s.tabSwitchBtnActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[s.tabSwitchText, activeTab === tab && s.tabSwitchTextActive]}>
                {tab === 'overview' ? 'Overview' : 'Timetable'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <View style={s.content}>
            <Text style={s.name}>{venue.name}</Text>
            {(venue.suburb || venue.state) && (
              <Text style={s.location}>{[venue.suburb, venue.state].filter(Boolean).join(', ')}</Text>
            )}

            {(venue.genre || []).length > 0 && (
              <View style={s.genres}>
                {(venue.genre || []).map((g: string) => (
                  <View key={g} style={s.genrePill}><Text style={s.genreText}>{g}</Text></View>
                ))}
              </View>
            )}

            {venue.description ? (
              <View style={s.section}>
                <Text style={s.sectionTitle}>About</Text>
                <Text style={s.body}>{venue.description}</Text>
              </View>
            ) : null}

            {(venue.rooms || []).length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Rooms</Text>
                {(venue.rooms || []).map((room: any, i: number) => (
                  <View key={i} style={s.rowItem}>
                    <Text style={s.rowPrimary}>{room.name}</Text>
                    {room.capacity && <Text style={s.rowSub}>Cap. {room.capacity}</Text>}
                  </View>
                ))}
              </View>
            )}

            {(venue.phone || venue.email || venue.website) && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Contact</Text>
                {venue.phone   && <Text style={s.contactItem}>{venue.phone}</Text>}
                {venue.email   && <Text style={s.contactItem}>{venue.email}</Text>}
                {venue.website && <Text style={s.contactItem}>{venue.website}</Text>}
              </View>
            )}

            <TouchableOpacity style={s.timetableBtn} onPress={() => setActiveTab('timetable')}>
              <Text style={s.timetableBtnText}>View Timetable & Available Slots →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── TIMETABLE ── */}
        {activeTab === 'timetable' && (
          <View>
            {/* Day selector */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayBar} contentContainerStyle={s.dayBarContent}>
              {DAYS.map(day => {
                const hasSlots = (venue.slots?.[day] || []).length > 0;
                return (
                  <TouchableOpacity
                    key={day}
                    style={[s.dayBtn, activeDay === day && s.dayBtnActive, !hasSlots && s.dayBtnEmpty]}
                    onPress={() => setActiveDay(day)}
                    disabled={!hasSlots}
                  >
                    <Text style={[s.dayBtnText, activeDay === day && s.dayBtnTextActive, !hasSlots && s.dayBtnTextEmpty]}>
                      {DAY_SHORT[day]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Slots */}
            <View style={s.slotList}>
              {merged.length === 0 ? (
                <View style={s.noSlots}>
                  <Text style={s.noSlotsText}>No gig slots for {activeDay}</Text>
                </View>
              ) : (
                merged.map((slot, i) => (
                  <SlotCard
                    key={slot.id || i}
                    slot={slot}
                    day={activeDay}
                    isArtist={isArtist}
                    isLoggedIn={!!user}
                    onEnquire={() => {
                      if (!user) { router.push('/login'); return; }
                      router.push({
                        pathname: '/enquire',
                        params: {
                          venueId:   venue.id,
                          venueName: venue.name,
                          day:       activeDay,
                          time:      slot.time,
                          room:      slot.room || '',
                          slotType:  slot.slotType || 'Any',
                        },
                      });
                    }}
                  />
                ))
              )}
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function SlotCard({ slot, day, isArtist, isLoggedIn, onEnquire }: {
  slot: Slot; day: string; isArtist: boolean; isLoggedIn: boolean; onEnquire: () => void;
}) {
  const isOpen    = slot.status === 'open';
  const isBooked  = slot.status === 'booked';
  const isPending = slot.status === 'pending';
  const fee = fmtFee(slot.feeMin, slot.feeMax);

  return (
    <View style={[ss.card, isBooked && ss.cardBooked, isPending && ss.cardPending]}>
      <View style={ss.cardLeft}>
        <View style={ss.timeRow}>
          <Text style={ss.time}>{slot.time}</Text>
          {slot.room && <Text style={ss.room}>{slot.room}</Text>}
        </View>

        {isBooked && <Text style={ss.bandName}>{slot.bandName}</Text>}
        {isPending && <Text style={ss.pendingLabel}>Pending approval</Text>}

        {isOpen && (
          <View style={ss.openMeta}>
            {slot.slotType && slot.slotType !== 'Any' && (
              <View style={ss.slotTypePill}>
                <Text style={ss.slotTypeText}>{slot.slotType}</Text>
              </View>
            )}
            {slot.duration ? <Text style={ss.metaText}>{slot.duration} min</Text> : null}
            {fee ? <Text style={ss.metaText}>{fee}</Text> : null}
          </View>
        )}

        {(slot.genres || []).length > 0 && (
          <View style={ss.genreRow}>
            {(slot.genres || []).map((g: string) => (
              <View key={g} style={ss.genrePill}><Text style={ss.genreText}>{g}</Text></View>
            ))}
          </View>
        )}

        {slot.notes ? <Text style={ss.notes}>{slot.notes}</Text> : null}
      </View>

      {isOpen && isArtist && (
        <TouchableOpacity style={ss.enquireBtn} onPress={onEnquire}>
          <Text style={ss.enquireBtnText}>Enquire</Text>
        </TouchableOpacity>
      )}

      {isOpen && !isLoggedIn && (
        <TouchableOpacity style={ss.enquireBtnGhost} onPress={onEnquire}>
          <Text style={ss.enquireBtnGhostText}>Log in to enquire</Text>
        </TouchableOpacity>
      )}

      <View style={[ss.statusDot, { backgroundColor: statusColor(slot.status) }]} />
    </View>
  );
}

const s = StyleSheet.create({
  safe:                 { flex: 1, backgroundColor: Colors.bg },
  banner:               { width: '100%', height: 240, resizeMode: 'cover' },
  bannerPlaceholder:    { width: '100%', height: 240, backgroundColor: Colors.bgFaint, alignItems: 'center', justifyContent: 'center' },
  bannerPlaceholderText:{ color: Colors.greyLight, fontSize: 14 },
  backOverlay:          { position: 'absolute', top: 16, left: 16, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  backOverlayText:      { fontSize: 14, fontWeight: '600', color: Colors.black },
  backText:             { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound:             { textAlign: 'center', color: Colors.grey, marginTop: 40, fontSize: 15 },
  tabSwitcher:          { flexDirection: 'row', backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabSwitchBtn:         { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabSwitchBtnActive:   { borderBottomColor: Colors.orange },
  tabSwitchText:        { fontSize: 14, fontWeight: '600', color: Colors.grey },
  tabSwitchTextActive:  { color: Colors.orange },
  content:              { padding: 20 },
  name:                 { fontSize: 26, fontWeight: '800', color: Colors.black, letterSpacing: -0.3, marginBottom: 4 },
  location:             { fontSize: 14, color: Colors.grey, marginBottom: 12 },
  genres:               { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  genrePill:            { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  genreText:            { fontSize: 12, color: Colors.orange, fontWeight: '500' },
  section:              { marginBottom: 24 },
  sectionTitle:         { fontSize: 11, fontWeight: '700', color: Colors.greyLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  body:                 { fontSize: 15, color: Colors.black, lineHeight: 22 },
  rowItem:              { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  rowPrimary:           { fontSize: 14, fontWeight: '600', color: Colors.black },
  rowSub:               { fontSize: 14, color: Colors.grey },
  contactItem:          { fontSize: 14, color: Colors.orange, marginBottom: 4 },
  timetableBtn:         { backgroundColor: Colors.orange, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 12 },
  timetableBtnText:     { fontSize: 15, fontWeight: '700', color: Colors.black },
  dayBar:               { borderBottomWidth: 1, borderBottomColor: Colors.border, flexGrow: 0 },
  dayBarContent:        { paddingHorizontal: 12, paddingVertical: 4, gap: 4 },
  dayBtn:               { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  dayBtnActive:         { backgroundColor: Colors.orange, borderColor: Colors.orange },
  dayBtnEmpty:          { opacity: 0.3 },
  dayBtnText:           { fontSize: 13, fontWeight: '600', color: Colors.grey },
  dayBtnTextActive:     { color: Colors.black },
  dayBtnTextEmpty:      { color: Colors.greyLight },
  slotList:             { padding: 16, gap: 12 },
  noSlots:              { padding: 40, alignItems: 'center' },
  noSlotsText:          { fontSize: 15, color: Colors.grey },
});

const ss = StyleSheet.create({
  card:             { backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardBooked:       { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  cardPending:      { borderColor: Colors.orange, backgroundColor: '#fff8f0' },
  cardLeft:         { flex: 1, gap: 6 },
  timeRow:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time:             { fontSize: 17, fontWeight: '800', color: Colors.black },
  room:             { fontSize: 13, color: Colors.grey, fontWeight: '500' },
  bandName:         { fontSize: 15, fontWeight: '700', color: '#16a34a' },
  pendingLabel:     { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  openMeta:         { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  slotTypePill:     { backgroundColor: 'rgba(250,131,12,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  slotTypeText:     { fontSize: 11, color: Colors.orange, fontWeight: '700' },
  metaText:         { fontSize: 13, color: Colors.grey },
  genreRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:        { borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  genreText:        { fontSize: 11, color: Colors.grey },
  notes:            { fontSize: 13, color: Colors.grey, fontStyle: 'italic' },
  enquireBtn:       { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  enquireBtnText:   { fontSize: 13, fontWeight: '700', color: Colors.black },
  enquireBtnGhost:  { borderWidth: 1, borderColor: Colors.orange, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  enquireBtnGhostText: { fontSize: 12, color: Colors.orange, fontWeight: '600' },
  statusDot:        { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4 },
});
