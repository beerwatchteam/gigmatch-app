import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
  ScrollView, Platform, Animated, Modal, Dimensions, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { searchSuburbs, haversineKm, type AreaResult } from '@/lib/suburbSearch';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useArtistEnquiries, normalizeEnquiryStatus } from '@/lib/useEnquiries';
import { SlidersHorizontal } from 'phosphor-react-native';
import { TOP_TAB_H } from './_layout';

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

const RADIUS_OPTIONS = [1, 2, 5, 10];

function daysOfWeekInRange(dateStart: string, dateEnd: string) {
  const days = new Set<string>();
  const start  = new Date(dateStart);
  const end    = dateEnd ? new Date(dateEnd) : new Date(dateStart);
  const cursor = new Date(start);
  while (cursor <= end && days.size < 7) {
    days.add(cursor.toLocaleDateString('en-US', { weekday: 'long' }));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function countOpenSlotsForRange(venue: any, dateStart: string, dateEnd: string) {
  if (!venue.slots || Object.keys(venue.slots).length === 0) return 0;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let start: Date, end: Date;
  if (dateStart) {
    start = new Date(dateStart);
    end   = dateEnd ? new Date(dateEnd) : new Date(dateStart);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  const weekdayCounts: Record<string, number> = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = DAY_NAMES[cursor.getDay()];
    weekdayCounts[day] = (weekdayCounts[day] || 0) + 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  let total = 0;
  for (const [day, occurrences] of Object.entries(weekdayCounts)) {
    const openCount = ((venue.slots[day] || []) as { status: string }[]).filter(s => s.status === 'open').length;
    total += openCount * occurrences;
  }
  return total;
}

type Venue = {
  id: string; name: string;
  suburb?: string; state?: string; streetAddress?: string;
  description?: string; genre?: string[]; genres?: string[];
  photoUrl?: string; photos?: string[];
  photoPosition?: { x: number; y: number };
  capacity?: number; feeMin?: number; feeMax?: number;
  rooms?: { name: string; capacity: string }[];
  slots?: Record<string, any[]>;
  payment?: { doorSplit?: string; models?: string[] };
  replyStats?: { totalMs: number; count: number };
  settings?: { listed?: boolean };
};

type SlotDetail = {
  dateLabel: string;
  time: string;
  slotType?: string;
  duration?: number;
  day: string;
  dateStr: string | null;
  name?: string;
  room?: string;
  notes?: string;
  feeMin?: number;
  feeMax?: number;
  paymentModels?: string[];
  paymentModel?: string;
  paymentMethod?: string;
  minNotice?: string;
  sortMs: number;
};

function getNextOpenSlotsDetailed(venue: Venue): SlotDetail[] {
  const slots = venue.slots;
  if (!slots) return [];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming: SlotDetail[] = [];
  for (const [day, daySlots] of Object.entries(slots)) {
    const open = (daySlots as any[]).filter(s => s.status === 'open');
    for (const slot of open) {
      let d: Date;
      let dateStr: string | null = null;
      if (slot.date) {
        const [y, m, dd] = slot.date.split('-').map(Number);
        d = new Date(y, m - 1, dd);
        if (d < today) continue;
        dateStr = slot.date;
      } else {
        const dow = DAY_NAMES.indexOf(day);
        if (dow === -1) continue;
        let fromDate = new Date(today);
        if (slot.startDate) {
          const [sy, sm, sd] = slot.startDate.split('-').map(Number);
          const start = new Date(sy, sm - 1, sd);
          if (start > today) fromDate = start;
        }
        d = new Date(fromDate); d.setHours(0,0,0,0);
        const diff = (dow - d.getDay() + 7) % 7;
        if (diff === 0 && fromDate.getTime() <= today.getTime()) { d.setDate(d.getDate() + 7); }
        else { d.setDate(d.getDate() + diff); }
        if (!slot.continuous && slot.endDate) {
          const [ey, em, ed] = slot.endDate.split('-').map(Number);
          const endD = new Date(ey, em - 1, ed); endD.setHours(23,59,59);
          if (d > endD) continue;
        }
      }
      const dl = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
      upcoming.push({ dateLabel: dl, time: slot.time || '', slotType: slot.slotType, duration: slot.duration, day, dateStr, name: slot.name || undefined, room: slot.room || undefined, notes: slot.notes || undefined, feeMin: slot.feeMin, feeMax: slot.feeMax, paymentModels: slot.paymentModels, paymentModel: slot.paymentModel, paymentMethod: slot.paymentMethod, minNotice: slot.minNotice, sortMs: d.getTime() });
    }
  }
  upcoming.sort((a, b) => a.sortMs - b.sortMs);
  return upcoming;
}

function slotPaymentSummary(slot: { feeMin?: number; feeMax?: number; paymentModels?: string[]; paymentModel?: string; paymentMethod?: string }): string {
  const models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
  const parts: string[] = [];
  if (models.includes('Flat fee') && slot.feeMin != null) {
    const range = slot.feeMax != null && slot.feeMax !== slot.feeMin ? `$${slot.feeMin}–$${slot.feeMax}` : `$${slot.feeMin}`;
    parts.push(`${range} flat fee`);
    const others = models.filter(m => m !== 'Flat fee');
    if (others.length) parts.push(...others);
  } else if (models.length) {
    parts.push(...models);
  } else if (slot.feeMin != null) {
    parts.push(slot.feeMax != null && slot.feeMax !== slot.feeMin ? `$${slot.feeMin}–$${slot.feeMax}` : `$${slot.feeMin}`);
  }
  if (slot.paymentMethod) parts.push(slot.paymentMethod);
  return parts.join(' · ');
}

function getOpenDatesNextThreeWeeks(venue: Venue): Set<string> {
  const openDates = new Set<string>();
  const slots = venue.slots;
  if (!slots) return openDates;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = new Date();
  today.setHours(0,0,0,0);
  for (let i = 0; i < 21; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const iso = toLocalStr(d);
    const dayName = DAY_NAMES[d.getDay()];
    const daySlots: any[] = slots[dayName] || [];
    const hasOpen = daySlots.some(slot => {
      if (slot.status !== 'open') return false;
      if (slot.date) return slot.date === iso;
      if (slot.startDate && iso < slot.startDate) return false;
      if (!slot.continuous && slot.endDate && iso > slot.endDate) return false;
      return true;
    });
    if (hasOpen) openDates.add(iso);
  }
  return openDates;
}

type CalSlot = {
  dateISO: string;
  time: string;
  venue: Venue;
  slotType?: string;
  duration?: number;
  day: string;
  name?: string;
  room?: string;
  notes?: string;
  feeMin?: number;
  feeMax?: number;
  paymentModels?: string[];
  paymentModel?: string;
  paymentMethod?: string;
  minNotice?: string;
  sortKey: number;
};

function parseTimeToMins(time: string): number {
  const m = time.match(/(\d+):(\d+)\s*(am|pm)/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function getCalendarSlots(venues: Venue[], maxDays: number): CalSlot[] {
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = new Date();
  today.setHours(0,0,0,0);
  const result: CalSlot[] = [];
  for (const venue of venues) {
    if (!venue.slots) continue;
    for (let i = 0; i < maxDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const iso = toLocalStr(d);
      const dayName = DAY_NAMES[d.getDay()];
      const daySlots: any[] = venue.slots[dayName] || [];
      for (const slot of daySlots) {
        if (slot.status !== 'open') continue;
        if (slot.date && slot.date !== iso) continue;
        if (!slot.date) {
          if (slot.startDate && iso < slot.startDate) continue;
          if (!slot.continuous && slot.endDate && iso > slot.endDate) continue;
        }
        result.push({
          dateISO: iso,
          time: slot.time || '',
          venue,
          slotType: slot.slotType,
          duration: slot.duration,
          day: dayName,
          room: slot.room,
          name: slot.name,
          notes: slot.notes,
          feeMin: slot.feeMin,
          feeMax: slot.feeMax,
          paymentModels: slot.paymentModels,
          paymentModel: slot.paymentModel,
          paymentMethod: slot.paymentMethod,
          minNotice: slot.minNotice,
          sortKey: d.getTime() + parseTimeToMins(slot.time || '') * 60000,
        });
      }
    }
  }
  result.sort((a, b) => a.sortKey - b.sortKey);
  return result;
}

function getNextOpenSlots(venue: Venue, count: number): string[] {
  const slots = venue.slots;
  if (!slots) return [];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming: { ms: number; label: string }[] = [];
  for (const [day, daySlots] of Object.entries(slots)) {
    const open = (daySlots as any[]).filter(s => s.status === 'open');
    for (const slot of open) {
      let d: Date;
      if (slot.date) {
        const [y, m, dd] = slot.date.split('-').map(Number);
        d = new Date(y, m - 1, dd);
        if (d < today) continue;
      } else {
        const dow = DAY_NAMES.indexOf(day);
        if (dow === -1) continue;
        d = new Date(today);
        const diff = (dow - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
      }
      const dl = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
      upcoming.push({ ms: d.getTime(), label: `${dl} · ${slot.time || ''}` });
    }
  }
  upcoming.sort((a, b) => a.ms - b.ms);
  return upcoming.slice(0, count).map(u => u.label);
}

const CARD_H = 160;
function CardPhoto({ uri, position }: { uri: string; position?: { x: number; y: number } }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };
  useEffect(() => { Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {}); }, [uri]);
  const scale = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, CARD_H / dims.nh) : 1;
  const dispW = dims.nw ? dims.nw * scale : (w || 300);
  const dispH = dims.nh ? dims.nh * scale : CARD_H;
  const maxTx = Math.max(0, dispW - w);
  const maxTy = Math.max(0, dispH - CARD_H);
  return (
    <View style={{ width: '100%', height: CARD_H, overflow: 'hidden' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Image
        source={{ uri }}
        style={{ position: 'absolute', top: 0, left: 0, width: dispW, height: dispH,
          transform: [{ translateX: -(pos.x / 100) * maxTx }, { translateY: -(pos.y / 100) * maxTy }] } as any}
        resizeMode="cover"
      />
    </View>
  );
}

const isWeb  = Platform.OS === 'web';
const PANEL_W = Dimensions.get('window').width * 0.87;

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DOW    = ['M','T','W','T','F','S','S'];

function toLocalStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatReplyTime(ms: number): string {
  const hrs = ms / (1000 * 60 * 60);
  if (hrs < 1)  return '< 1 hr';
  if (hrs < 24) return `~${Math.round(hrs)} hr${Math.round(hrs) === 1 ? '' : 's'}`;
  const days = hrs / 24;
  return `~${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
}
function parseLocal(s: string) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function CalIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View style={{ position:'absolute', top: 3, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderColor: color, borderRadius: 2 }} />
      <View style={{ position:'absolute', top: 3, left: 0, right: 0, height: 6, borderBottomWidth: 1.5, borderColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
      <View style={{ position:'absolute', top: 0, left: 4, width: 2, height: 6, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position:'absolute', top: 0, right: 4, width: 2, height: 6, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

function CalendarPicker({ value, onChange, minDate, colors: c }: {
  value: string; onChange: (v: string) => void; minDate?: string; colors: any;
}) {
  const today    = new Date();
  const todayStr = toLocalStr(today);
  const [open, setOpen]           = useState(false);
  const [viewYear, setViewYear]   = useState(() => (value ? parseLocal(value) : today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value ? parseLocal(value) : today).getMonth());

  function handleOpen() {
    const d = value ? parseLocal(value) : today;
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
    setOpen(o => !o);
  }
  function prevMonth() {
    setViewMonth(m => { if (m === 0) { setViewYear(y => y-1); return 11; } return m-1; });
  }
  function nextMonth() {
    setViewMonth(m => { if (m === 11) { setViewYear(y => y+1); return 0; } return m+1; });
  }
  function pick(dateStr: string) { onChange(dateStr); setOpen(false); }

  // Build 42-cell grid (Mon-first)
  const cells: { date: Date; in: boolean }[] = [];
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  for (let i = startOffset-1; i >= 0; i--) cells.push({ date: new Date(viewYear, viewMonth, -i), in: false });
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(viewYear, viewMonth, d), in: true });
  for (let n = 1; cells.length < 42; n++) cells.push({ date: new Date(viewYear, viewMonth+1, n), in: false });

  const display = value ? value.split('-').reverse().join('/') : '';

  return (
    <View>
      <TouchableOpacity
        style={[cal.input, { backgroundColor: c.bgFaint, borderColor: open ? Colors.orange : c.border }]}
        onPress={handleOpen} activeOpacity={0.8}
      >
        <Text style={[cal.inputText, { color: value ? c.black : '#999999' }]}>{display || 'dd/mm/yyyy'}</Text>
        <CalIcon color={open ? Colors.orange : c.grey} />
      </TouchableOpacity>

      {open && (
        <View style={[cal.dropdown, { backgroundColor: c.bg, borderColor: c.border }]}>
          <View style={cal.calHeader}>
            <Text style={[cal.monthYear, { color: c.black }]}>{CAL_MONTHS[viewMonth]} {viewYear} ▾</Text>
            <View style={{ flexDirection:'row', gap: 16 }}>
              <TouchableOpacity onPress={prevMonth}><Text style={[cal.navArrow, { color: c.black }]}>↑</Text></TouchableOpacity>
              <TouchableOpacity onPress={nextMonth}><Text style={[cal.navArrow, { color: c.black }]}>↓</Text></TouchableOpacity>
            </View>
          </View>

          <View style={cal.dowRow}>
            {CAL_DOW.map((d,i) => (
              <View key={i} style={cal.dowCell}>
                <Text style={[cal.dowText, { color: c.grey }]}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={cal.grid}>
            {cells.map((cell, i) => {
              const s = toLocalStr(cell.date);
              const selected = s === value;
              const isToday  = s === todayStr;
              const disabled = !!(minDate && s < minDate);
              return (
                <TouchableOpacity
                  key={i} style={[cal.cell, selected && cal.cellSelected]}
                  onPress={() => !disabled && pick(s)} disabled={disabled} activeOpacity={0.7}
                >
                  <Text style={[
                    cal.cellText,
                    { color: cell.in ? c.black : c.greyLight },
                    selected && { color: '#fff', fontWeight: '700' },
                    isToday && !selected && { color: Colors.orange, fontWeight: '700' },
                    disabled && { opacity: 0.3 },
                  ]}>
                    {cell.date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[cal.footer, { borderTopColor: c.borderFaint }]}>
            <TouchableOpacity onPress={() => { onChange(''); setOpen(false); }}>
              <Text style={cal.footerBtn}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pick(todayStr)}>
              <Text style={cal.footerBtn}>Today</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const cal = StyleSheet.create({
  input:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderWidth:1, borderRadius:10, paddingHorizontal:12, paddingVertical:10, gap:8 },
  inputText:   { fontSize:14, flex:1 },
  dropdown:    { borderWidth:1, borderRadius:12, marginTop:6, padding:12, zIndex:100 },
  calHeader:   { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  monthYear:   { fontSize:15, fontWeight:'700' },
  navArrow:    { fontSize:16, fontWeight:'600', paddingHorizontal:4 },
  dowRow:      { flexDirection:'row', marginBottom:4 },
  dowCell:     { flex:1, alignItems:'center', paddingVertical:4 },
  dowText:     { fontSize:12, fontWeight:'600' },
  grid:        { flexDirection:'row', flexWrap:'wrap' },
  cell:        { width:`${100/7}%` as any, aspectRatio:1, alignItems:'center', justifyContent:'center', borderRadius:4 },
  cellSelected:{ backgroundColor: Colors.orange },
  cellText:    { fontSize:13 },
  footer:      { flexDirection:'row', justifyContent:'space-between', marginTop:10, paddingTop:10, borderTopWidth:1 },
  footerBtn:   { fontSize:14, fontWeight:'600', color: Colors.orange },
});

// Persists the chosen view for the session (survives tab navigation re-mounts)
let _sessionWebView: 'venue' | 'calendar' = 'venue';

type SlotViewInfo = {
  venueName: string;
  venueId: string;
  day: string;
  date: string | null;
  time: string;
  slotName?: string;
  room?: string;
  slotType?: string;
  duration?: number;
  paymentModels?: string[];
  feeMin?: number | null;
  feeMax?: number | null;
  paymentMethod?: string;
  minNotice?: string;
  slotNote?: string;
  enquiryId: string;
  status: 'enquired' | 'confirmed';
};

function SlotViewModal({ info, colors, onClose, onViewInbox }: {
  info: SlotViewInfo | null;
  colors: any;
  onClose: () => void;
  onViewInbox: (id: string) => void;
}) {
  if (!info) return null;

  const d = info.date ? parseLocal(info.date) : null;
  const dateLabel = d
    ? d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', '')
    : info.day;
  const slotParts = [dateLabel, info.time, info.room, info.slotType, info.duration ? `${info.duration} min` : null].filter(Boolean) as string[];

  const models = info.paymentModels || [];
  const hasInfo = models.length > 0 || info.paymentMethod || info.minNotice || info.slotNote;
  const statusColor = info.status === 'confirmed' ? '#22c55e' : '#f5a623';
  const statusLabel = info.status === 'confirmed' ? 'Booked' : 'Enquiry Sent';
  let rowIndex = 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: Colors.grey, marginBottom: 4 }}>GIG SLOT</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: colors.black, letterSpacing: -0.3 }}>{info.venueName}</Text>
              {info.slotName ? <Text style={{ fontSize: 14, fontWeight: '600', color: colors.grey, marginTop: 2 }}>{info.slotName}</Text> : null}
              <Text style={{ fontSize: 13, color: Colors.grey, marginTop: 3 }}>{slotParts.join(' · ')}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2, marginLeft: 12 }}>
              <Text style={{ fontSize: 13, color: colors.black }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <View style={{ alignSelf: 'flex-start', borderWidth: 1.5, borderColor: statusColor, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor }}>{statusLabel}</Text>
            </View>
          </View>

          {hasInfo && (
            <View style={{ marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.bgFaint, overflow: 'hidden' }}>
              {models.map((model, idx) => {
                let val = model;
                if (model === 'Flat fee' && info.feeMin != null) {
                  const range = info.feeMax != null && info.feeMax !== info.feeMin ? `$${info.feeMin}–$${info.feeMax}` : `$${info.feeMin}`;
                  val = `Flat fee · ${range}`;
                }
                const r = rowIndex++;
                return (
                  <View key={model} style={{ flexDirection: 'row', padding: 12, borderTopWidth: r > 0 ? 1 : 0, borderTopColor: colors.border }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.grey, width: 90 }}>{idx === 0 ? 'Payment' : ''}</Text>
                    <Text style={{ fontSize: 13, color: colors.black, flex: 1 }}>{val}</Text>
                  </View>
                );
              })}
              {info.paymentMethod ? (() => { const r = rowIndex++; return (
                <View style={{ flexDirection: 'row', padding: 12, borderTopWidth: r > 0 ? 1 : 0, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.grey, width: 90 }}>Via</Text>
                  <Text style={{ fontSize: 13, color: colors.black, flex: 1 }}>{info.paymentMethod}</Text>
                </View>
              ); })() : null}
              {info.minNotice ? (() => { const r = rowIndex++; return (
                <View style={{ flexDirection: 'row', padding: 12, borderTopWidth: r > 0 ? 1 : 0, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.grey, width: 90 }}>Min. notice</Text>
                  <Text style={{ fontSize: 13, color: colors.black, flex: 1 }}>{info.minNotice}</Text>
                </View>
              ); })() : null}
              {info.slotNote ? (() => { const r = rowIndex++; return (
                <View style={{ flexDirection: 'row', padding: 12, borderTopWidth: r > 0 ? 1 : 0, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.grey, width: 90 }}>Venue notes</Text>
                  <Text style={{ fontSize: 13, color: colors.black, flex: 1, fontStyle: 'italic' }}>{info.slotNote}</Text>
                </View>
              ); })() : null}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 20 }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              onPress={() => onViewInbox(info.enquiryId)}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111111' }}>View in Inbox</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.black }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function VenuesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, profile } = useAuth();
  const isArtist = profile?.type === 'artist';
  const { enquiries: myEnquiries } = useArtistEnquiries(isArtist ? (user?.uid ?? null) : null);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [slotViewModal, setSlotViewModal] = useState<SlotViewInfo | null>(null);
  const [venues, setVenues]         = useState<Venue[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]                   = useState('');
  const [genres, setGenres]                   = useState<string[]>([]);
  const [feeRanges, setFeeRanges]             = useState<string[]>([]);
  const [dateStart, setDateStart]             = useState('');
  const [dateEnd, setDateEnd]                 = useState('');
  const [capacity, setCapacity]               = useState('any');
  const [showDropdown, setShowDropdown]       = useState(false);
  const [areaSuggestions, setAreaSuggestions] = useState<AreaResult[]>([]);
  const [locationCoords, setLocationCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius]                   = useState<number | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [webDropdown, setWebDropdown]         = useState<'date' | 'capacity' | 'genre' | null>(null);
  const [webView, setWebView]                 = useState<'venue' | 'calendar'>(_sessionWebView);
  function changeWebView(v: 'venue' | 'calendar') { _sessionWebView = v; setWebView(v); }
  const [calFilter, setCalFilter]             = useState<'all' | 'weekends'>('all');
  const [calendarDays, setCalendarDays]       = useState(21);
  const slideAnim   = useRef(new Animated.Value(-PANEL_W)).current;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'venues'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Venue[];
      setVenues(all.filter(v => v.settings?.listed !== false));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = locationCoords ? '' : search.trim();
    if (q.length < 2) { setAreaSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      try {
        const areas = searchSuburbs(q, 6);
        setAreaSuggestions(areas);
        if (areas.length > 0) setShowDropdown(true);
      } catch { setAreaSuggestions([]); }
    }, 200);
  }, [search, locationCoords]);

  const q = search.trim().toLowerCase();
  const venueMatches = !locationCoords && q.length >= 2
    ? venues.filter(v => v.name?.toLowerCase().includes(q) || v.suburb?.toLowerCase().includes(q)).slice(0, 4)
    : [];
  const hasDropdown = venueMatches.length > 0 || areaSuggestions.length > 0;

  function resetFilters() {
    setSearch(''); setGenres([]); setFeeRanges([]);
    setDateStart(''); setDateEnd(''); setCapacity('any');
    setShowDropdown(false); setAreaSuggestions([]);
    setLocationCoords(null); setRadius(null);
  }

  function openFilterPanel() {
    slideAnim.setValue(-PANEL_W);
    setShowFilterPanel(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }
  function closeFilterPanel() {
    Animated.timing(slideAnim, { toValue: -PANEL_W, duration: 200, useNativeDriver: true }).start(() => setShowFilterPanel(false));
  }

  function handleSearchChange(val: string) {
    setSearch(val); setLocationCoords(null); setRadius(null);
    setShowDropdown(val.trim().length >= 2);
  }

  function selectVenueMatch(v: Venue) {
    setSearch(v.name); setLocationCoords(null); setRadius(null);
    setAreaSuggestions([]); setShowDropdown(false);
  }

  function selectAreaSuggestion(s: AreaResult) {
    setSearch(s.label); setLocationCoords({ lat: s.lat, lng: s.lng });
    setRadius(prev => prev ?? 1); setAreaSuggestions([]); setShowDropdown(false);
  }

  function clearSearch() {
    setSearch(''); setLocationCoords(null); setRadius(null);
    setAreaSuggestions([]); setShowDropdown(false);
  }

  function formatDateDisplay(iso: string) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function toggleFee(key: string) {
    setFeeRanges(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  const filtered = venues.filter(v => {
    // Location radius
    if (locationCoords && radius) {
      const vLat = (v as any).coordinates?.lat ?? null;
      const vLng = (v as any).coordinates?.lng ?? null;
      if (vLat == null || vLng == null) return false;
      if (haversineKm(locationCoords.lat, locationCoords.lng, vLat, vLng) > radius) return false;
    } else if (search.trim() && !locationCoords) {
      const q2 = search.trim().toLowerCase();
      const match =
        v.name?.toLowerCase().includes(q2) ||
        v.suburb?.toLowerCase().includes(q2) ||
        (v as any).postcode?.includes(q2) ||
        (v as any).username?.toLowerCase().includes(q2);
      if (!match) return false;
    }
    // Genre
    if (genres.length > 0) {
      const vg: string[] = (v as any).genres || v.genre || [];
      if (!genres.some(g => vg.includes(g))) return false;
    }
    // Fee ranges
    if (feeRanges.length > 0) {
      const vLo = v.feeMin ?? null; const vHi = v.feeMax ?? null;
      if (vLo === null && vHi === null) return false;
      const lo = vLo ?? 0; const hi = vHi ?? Infinity;
      const ok = feeRanges.some(key => {
        if (key === '0-300')    return hi >= 0    && lo <= 300;
        if (key === '300-500')  return hi >= 300  && lo <= 500;
        if (key === '500-1000') return hi >= 500  && lo <= 1000;
        if (key === '1000+')    return hi >= 1000;
        return false;
      });
      if (!ok) return false;
    }
    // Capacity
    if (capacity !== 'any') {
      const cap = v.capacity ?? null;
      if (cap === null) return false;
      const opt = CAPACITY_OPTIONS.find(o => o.value === capacity);
      if (opt) {
        if (opt.value === 'u50'     && cap >= 50)               return false;
        if (opt.value === '50-150'  && (cap < 50  || cap > 150)) return false;
        if (opt.value === '150-300' && (cap < 150 || cap > 300)) return false;
        if (opt.value === '300+'    && cap < 300)               return false;
      }
    }
    // Date availability
    if (dateStart) {
      const slots = v.slots;
      if (!slots || Object.keys(slots).length === 0) return false;
      const targetDays = daysOfWeekInRange(dateStart, dateEnd || dateStart);
      const hasOpen = [...targetDays].some(day => {
        const daySlots: { status: string }[] = slots[day] || [];
        return daySlots.some(s => s.status === 'open');
      });
      if (!hasOpen) return false;
    }
    return true;
  }).sort((a, b) => (a.id === 'test-venue' ? -1 : b.id === 'test-venue' ? 1 : 0));

  // ── Active filter state ───────────────────────────────────────────
  const feeActive  = feeRanges.length > 0;
  const dateActive = !!dateStart;
  const capActive  = capacity !== 'any';
  const fmtDate    = (s: string) => s.split('-').reverse().join('/');

  const activeFilterCount =
    (feeActive ? 1 : 0) + (dateActive ? 1 : 0) + (capActive ? 1 : 0) + (genres.length > 0 ? 1 : 0);

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [
    ...feeRanges.map(k => ({
      key: `fee-${k}`,
      label: FEE_RANGES.find(r => r.key === k)?.label ?? k,
      onRemove: () => setFeeRanges(prev => prev.filter(x => x !== k)),
    })),
    ...(dateStart ? [{ key: 'date', label: dateEnd ? `${fmtDate(dateStart)}–${fmtDate(dateEnd)}` : fmtDate(dateStart), onRemove: () => { setDateStart(''); setDateEnd(''); } }] : []),
    ...(capacity !== 'any' ? [{ key: 'cap', label: CAPACITY_OPTIONS.find(o => o.value === capacity)?.label ?? capacity, onRemove: () => setCapacity('any') }] : []),
    ...genres.map(g => ({ key: `genre-${g}`, label: g, onRemove: () => setGenres(prev => prev.filter(x => x !== g)) })),
  ];

  // ── Web ledger row ────────────────────────────────────────────────


  // ── Native filter bar (top of content) ───────────────────────────
  const NativeFilterBar = (
    <View style={st.nativeFilterWrap}>
      {/* Search + Filters button */}
      <View style={st.nativeTopRow}>
        <View style={st.nativeSearchBox}>
          <TextInput
            style={st.nativeSearchInput}
            placeholder="Venue, suburb or postcode…" placeholderTextColor="#999"
            value={search} onChangeText={handleSearchChange}
            onFocus={() => hasDropdown && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {search ? <TouchableOpacity style={st.nativeClearX} onPress={clearSearch}><Text style={st.clearXText}>✕</Text></TouchableOpacity> : null}
        </View>
        <TouchableOpacity
          style={[st.filterIconBtn, activeFilterCount > 0 && st.filterIconBtnOn]}
          onPress={openFilterPanel}
          activeOpacity={0.8}
        >
          <SlidersHorizontal size={20} color={activeFilterCount > 0 ? Colors.orange : '#333333'} weight="regular" />
          {activeFilterCount > 0 && (
            <View style={st.filterIconBadge}>
              <Text style={st.filterIconBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search dropdown */}
      {showDropdown && hasDropdown && (
        <View style={[st.dropdown, { top: 54, left: 16, right: 16, zIndex: 9999 }]}>
          {venueMatches.length > 0 && (<>
            <Text style={st.dropSection}>VENUES</Text>
            {venueMatches.map(v => (
              <TouchableOpacity key={v.id} style={st.dropItem} onPress={() => selectVenueMatch(v)}>
                <Text style={st.dropItemText}>🏛 {v.name}</Text>
                {v.suburb ? <Text style={st.dropItemMeta}>{v.suburb}</Text> : null}
              </TouchableOpacity>
            ))}
          </>)}
          {areaSuggestions.length > 0 && (<>
            <Text style={st.dropSection}>AREAS</Text>
            {areaSuggestions.map((s, i) => (
              <TouchableOpacity key={i} style={st.dropItem} onPress={() => selectAreaSuggestion(s)}>
                <Text style={st.dropItemText}>📍 {s.label}</Text>
              </TouchableOpacity>
            ))}
          </>)}
        </View>
      )}

      {/* Radius pills (location selected) */}
      {locationCoords && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
          {RADIUS_OPTIONS.map(km => (
            <TouchableOpacity key={km} style={[st.radiusPill, radius === km && st.radiusPillOn]} onPress={() => setRadius(km)}>
              <Text style={[st.radiusPillText, radius === km && st.radiusPillTextOn]}>{km}km</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
          {activeChips.map(chip => (
            <TouchableOpacity key={chip.key} style={st.activeChip} onPress={chip.onRemove}>
              <Text style={st.activeChipText}>{chip.label}  ✕</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={st.resetPill} onPress={resetFilters}>
            <Text style={st.resetPillText}>Reset All</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );

  // ── Filter panel (slide in from left) ────────────────────────────
  const FilterPanel = (
    <Modal visible={showFilterPanel} transparent animationType="none" onRequestClose={closeFilterPanel}>
      <View style={st.fpOverlay}>
        <Animated.View style={[st.fpPanel, { transform: [{ translateX: slideAnim }] }]}>
          {/* Header */}
          <View style={st.fpHeader}>
            <TouchableOpacity onPress={closeFilterPanel} style={st.fpCloseBtn} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={st.fpCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={st.fpTitle}>Filters</Text>
            <TouchableOpacity onPress={() => resetFilters()} activeOpacity={0.7}>
              <Text style={st.fpReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* FEE RANGE */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>FEE RANGE</Text>
              {FEE_RANGES.map(r => (
                <TouchableOpacity key={r.key} style={st.fpOptionRow} onPress={() => toggleFee(r.key)}>
                  <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
                  <Text style={st.fpOptionText}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* AVAILABILITY */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>AVAILABILITY</Text>
              <Text style={st.fpSubLabel}>FROM</Text>
              <View style={{ marginBottom: 10 }}>
                <CalendarPicker
                  value={dateStart}
                  onChange={v => { setDateStart(v); if (dateEnd && v && v > dateEnd) setDateEnd(v); }}
                  colors={colors}
                />
              </View>
              <Text style={st.fpSubLabel}>TO</Text>
              <CalendarPicker value={dateEnd} onChange={setDateEnd} minDate={dateStart || undefined} colors={colors} />
            </View>

            {/* CAPACITY */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>CAPACITY</Text>
              <View style={st.genreGrid}>
                {CAPACITY_OPTIONS.map(o => (
                  <TouchableOpacity key={o.value} style={[st.genrePill, capacity === o.value && st.genrePillOn]} onPress={() => setCapacity(o.value)}>
                    <Text style={[st.genrePillText, capacity === o.value && st.genrePillTextOn]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* GENRE */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>GENRE</Text>
              <View style={st.genreGrid}>
                <TouchableOpacity style={[st.genrePill, genres.length === 0 && st.genrePillOn]} onPress={() => setGenres([])}>
                  <Text style={[st.genrePillText, genres.length === 0 && st.genrePillTextOn]}>All</Text>
                </TouchableOpacity>
                {GENRES.map(g => (
                  <TouchableOpacity key={g} style={[st.genrePill, genres.includes(g) && st.genrePillOn]} onPress={() => toggleGenre(g)}>
                    <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Apply button */}
          <View style={st.fpFooter}>
            <TouchableOpacity style={st.fpApplyBtn} onPress={closeFilterPanel} activeOpacity={0.85}>
              <Text style={st.fpApplyBtnText}>
                Show {filtered.length} venue{filtered.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Backdrop — tap to close */}
        <TouchableOpacity style={st.fpBackdrop} activeOpacity={1} onPress={closeFilterPanel} />
      </View>
    </Modal>
  );

  // ── Venue card (native) ───────────────────────────────────────────
  function VenueCard({ item }: { item: Venue }) {
    const [hovered, setHovered] = useState(false);
    const photo = item.photoUrl || (item.photos?.[0]);
    const d0  = toLocalStr(new Date());
    const d42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
    const allSlots   = getNextOpenSlotsDetailed(item);
    const shown      = allSlots.slice(0, 2);
    const totalSlots = countOpenSlotsForRange(item, d0, d42);
    const extraCount = Math.max(0, totalSlots - 2);
    const venueGenres = (item.genre || item.genres || []);

    const lastSlot = allSlots[allSlots.length - 1];
    const throughMonth = lastSlot?.dateStr
      ? new Date(lastSlot.dateStr + 'T00:00:00').toLocaleString('default', { month: 'long' })
      : null;

    const paymentVal = item.payment?.models?.length ? item.payment.models.join(' · ') : '—';

    const roomCaps = item.rooms?.map(r => parseInt(r.capacity) || 0).filter(n => n > 0) ?? [];
    const maxCapacity = roomCaps.length > 0 ? Math.max(...roomCaps) : (item.capacity ?? null);
    const avgReplyMs = (item.replyStats?.count ?? 0) > 0
      ? item.replyStats!.totalMs / item.replyStats!.count
      : null;
    const replyVal = avgReplyMs != null ? formatReplyTime(avgReplyMs) : '—';

    return (
      <TouchableOpacity
        activeOpacity={0.97}
        style={[
          st.card,
          { backgroundColor: colors.bg, borderColor: hovered ? Colors.orange : colors.border },
          hovered && st.cardHovered,
        ]}
        onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
        {...(isWeb ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        } : {})}
      >
        {/* ── Photo ── */}
        {photo ? (
          <Image source={{ uri: photo }} style={st.cardPhoto} resizeMode="cover" />
        ) : (
          <View style={[st.cardPhoto, st.cardPhotoEmpty, { backgroundColor: colors.bgFaint }]}>
            <Text style={[st.cardPhotoLabel, { color: colors.greyLight }]}>photo</Text>
          </View>
        )}

        {/* ── Body ── */}
        <View style={st.cardBody}>
          {/* Name + capacity */}
          <View style={st.cardNameRow}>
            <Text style={[st.venueName, { color: colors.black, flex: 1 }]} numberOfLines={2}>{item.name}</Text>
            {maxCapacity ? (
              <Text style={[st.cardCap, { color: colors.grey }]}>max. {maxCapacity.toLocaleString()} cap</Text>
            ) : null}
          </View>

          {/* Suburb */}
          {item.suburb ? (
            <Text style={[st.venueAddr, { color: colors.grey }]}>{item.suburb}</Text>
          ) : null}

          {/* Genres */}
          {venueGenres.length > 0 && (
            <Text style={[st.venueGenreText, { color: colors.grey }]} numberOfLines={2}>
              {venueGenres.join(' · ')}
            </Text>
          )}

          {/* ── Slot rows ── */}
          <View style={[st.cardSlots, { borderTopColor: colors.border }]}>
            <Text style={[st.slotsLabel, { color: colors.grey }]}>NEXT OPEN SLOTS</Text>
            {shown.length === 0 ? (
              <Text style={[st.slotsNone, { color: colors.greyLight }]}>No open slots in the next 6 weeks</Text>
            ) : (
              <>
                {shown.map((slot, i) => {
                  const _models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
                  const enquireParams = {
                    venueId:   item.id,
                    venueName: item.name,
                    day:       slot.day,
                    ...(slot.dateStr ? { date: slot.dateStr } : {}),
                    time:      slot.time,
                    ...(slot.room ? { room: slot.room } : {}),
                    slotType:  slot.slotType ?? 'Either',
                    duration:  slot.duration ? String(slot.duration) : '',
                    capacity:  maxCapacity ? String(maxCapacity) : '',
                    ...(slot.name ? { slotName: slot.name } : {}),
                    ...(slot.notes ? { slotNote: slot.notes } : {}),
                    ...(_models.length ? { paymentModels: _models.join(',') } : {}),
                    ...(slot.feeMin != null ? { feeMin: String(slot.feeMin) } : {}),
                    ...(slot.feeMax != null ? { feeMax: String(slot.feeMax) } : {}),
                    ...(slot.paymentMethod ? { paymentMethod: slot.paymentMethod } : {}),
                    ...(slot.minNotice ? { minNotice: slot.minNotice } : {}),
                  };

                  // Check if artist already has an enquiry for this slot
                  let slotEnquiry: typeof myEnquiries[0] | undefined;
                  if (isArtist && slot.dateStr) {
                    for (const e of myEnquiries) {
                      if (e.venueId !== item.id || e.requestedSlot?.date !== slot.dateStr) continue;
                      const s = normalizeEnquiryStatus(e.status);
                      if (s === 'confirmed' || s === 'enquired') { slotEnquiry = e; break; }
                    }
                  }

                  return (
                    <View
                      key={i}
                      style={st.slotRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[st.slotDate, { color: colors.black }]}>{slot.dateLabel} · {slot.time}</Text>
                        {slot.slotType ? (
                          <Text style={[st.slotType, { color: colors.grey, fontSize: 11, fontWeight: '500' }]}>{slot.slotType}</Text>
                        ) : null}
                      </View>
                      {isArtist ? (
                        slotEnquiry ? (
                          <TouchableOpacity
                            onPress={(e: any) => { if (isWeb) e?.stopPropagation?.(); const s = normalizeEnquiryStatus(slotEnquiry!.status); setSlotViewModal({ venueName: item.name, venueId: item.id, day: slot.day, date: slot.dateStr, time: slot.time, slotName: slot.name, room: slot.room, slotType: slot.slotType, duration: slot.duration, paymentModels: _models, feeMin: slot.feeMin, feeMax: slot.feeMax, paymentMethod: slot.paymentMethod, minNotice: slot.minNotice, slotNote: slot.notes, enquiryId: slotEnquiry!.id, status: s === 'confirmed' ? 'confirmed' : 'enquired' }); }}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={[st.slotEnquireLink, { color: normalizeEnquiryStatus(slotEnquiry.status) === 'confirmed' ? '#22c55e' : Colors.grey }]}>View</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => router.push({ pathname: '/enquire', params: enquireParams })}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            {...(isWeb ? { onClick: (e: any) => e.stopPropagation() } : {})}
                          >
                            <Text style={st.slotEnquireLink}>Enquire</Text>
                          </TouchableOpacity>
                        )
                      ) : null}
                    </View>
                  );
                })}
                {extraCount > 0 && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
                    activeOpacity={0.7}
                  >
                    <Text style={st.moreText}>
                      +{extraCount} more{throughMonth ? ` through ${throughMonth}` : ' slots'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* ── Stats ── */}
          <View style={st.statsRow}>
            <View style={st.statCol}>
              <Text style={[st.statVal, { color: colors.black }]} numberOfLines={2}>{paymentVal}</Text>
              <Text style={st.statLabel}>PAYMENT</Text>
            </View>
            <View style={st.statCol}>
              <Text style={[st.statVal, { color: colors.black }]}>{replyVal}</Text>
              <Text style={st.statLabel}>REPLY TIME</Text>
            </View>
          </View>

          {/* ── Buttons ── */}
          <View style={[st.cardBtns, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[st.cardBtnOutlined, { borderColor: colors.black }]}
              onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
              activeOpacity={0.8}
              {...(isWeb ? { onClick: (e: any) => e.stopPropagation() } : {})}
            >
              <Text style={[st.cardBtnOutlinedText, { color: colors.black }]}>Timetable</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Web venue row (desktop) ───────────────────────────────────────
  const DOW_LABELS = ['M','T','W','T','F','S','S'];
  const DAY_NAMES_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function getSlotsForDate(venue: Venue, iso: string): any[] {
    const slots = venue.slots;
    if (!slots) return [];
    const d = parseLocal(iso);
    const dayName = DAY_NAMES_FULL[d.getDay()];
    const daySlots: any[] = slots[dayName] || [];
    return daySlots.filter(slot => {
      if (slot.status !== 'open') return false;
      if (slot.date) return slot.date === iso;
      if (slot.startDate && iso < slot.startDate) return false;
      if (!slot.continuous && slot.endDate && iso > slot.endDate) return false;
      return true;
    });
  }

  function WebVenueRow({ item }: { item: Venue }) {
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const photo = item.photoUrl || item.photos?.[0];
    // Enquiry status by date for this venue — populated when enquiry data is available in this context
    const myVenueEnquiryDates: Record<string, 'confirmed' | 'enquired' | 'declined'> = {};
    const venueGenres = (item.genre || item.genres || []).slice(0, 6);

    // Build 21-day calendar starting from today
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayStr = toLocalStr(today);
    const openDates = getOpenDatesNextThreeWeeks(item);
    const allDays: Date[] = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      allDays.push(d);
    }

    const openCount = openDates.size;
    const nextSlot = getNextOpenSlotsDetailed(item)[0];
    const selectedSlots = selectedDate ? getSlotsForDate(item, selectedDate) : [];

    return (
      <View style={st.webRow}>
        {/* Col 1: VENUE — thumbnail + name + suburb + genres */}
        <TouchableOpacity
          style={st.webColVenue}
          onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
          activeOpacity={0.85}
        >
          {photo
            ? <Image source={{ uri: photo }} style={st.webRowThumb} resizeMode="cover" />
            : <View style={[st.webRowThumb, st.webRowThumbEmpty]}><Text style={st.webRowThumbLabel}>photo</Text></View>
          }
          <View style={st.webColVenueInfo}>
            <Text style={st.webRowName} numberOfLines={1}>{item.name}</Text>
            {item.suburb && <Text style={st.webRowMeta} numberOfLines={1}>{item.suburb}</Text>}
            {venueGenres.length > 0 && (
              <Text style={st.venueGenreText} numberOfLines={1}>
                {venueGenres.join(' · ')}
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Col 2: CAPACITY (MAX) */}
        <View style={st.webColCapacity}>
          <Text style={st.webColValue}>{item.capacity?.toLocaleString() ?? '—'}</Text>
        </View>

        {/* Col 3: NEXT 3 WEEKS — calendar strip */}
        <View style={st.webColCalendar}>
          {/* Day-of-week header */}
          <View style={st.calStripRow}>
            {allDays.map((day, i) => {
              const dowIdx = (day.getDay() + 6) % 7;
              return (
                <View key={i} style={st.calStripHeaderCell}>
                  <Text style={st.calStripDayLetter}>{DOW_LABELS[dowIdx]}</Text>
                </View>
              );
            })}
          </View>
          {/* Date circles */}
          <View style={[st.calStripRow, { marginTop: 3 }]}>
            {allDays.map((day, i) => {
              const iso = toLocalStr(day);
              const hasSlot = openDates.has(iso);
              const isSelected = iso === selectedDate;
              const isToday = iso === todayStr;
              const isPast = day < today;

              // My enquiry state for this date at this venue
              let myStatus: 'confirmed' | 'enquired' | 'declined' | null = null;
              if (isArtist) {
                for (const e of myEnquiries) {
                  if (e.venueId !== item.id || e.requestedSlot?.date !== iso) continue;
                  const s = normalizeEnquiryStatus(e.status);
                  if (s === 'confirmed') { myStatus = 'confirmed'; break; }
                  if (s === 'declined' && myStatus == null) { myStatus = 'declined'; continue; }
                  if (s !== 'declined' && s !== 'cancelled') myStatus = 'enquired';
                }
              }

              const isInteractive = hasSlot || myStatus === 'enquired' || myStatus === 'confirmed';
              const dotStyle = myStatus === 'confirmed' ? st.calStripDotConfirmed
                : myStatus === 'enquired' ? st.calStripDotEnquired
                : myStatus === 'declined' ? st.calStripDotDeclined
                : hasSlot ? st.calStripDotOpen
                : null;
              const textStyle = myStatus === 'confirmed' ? st.calStripDateLight
                : hasSlot || myStatus === 'enquired' ? st.calStripDateOpen
                : isPast ? st.calStripDatePast
                : null;

              const cell = isInteractive ? (
                <TouchableOpacity
                  key={i}
                  style={[
                    st.calStripCell,
                    dotStyle,
                    isSelected && !myStatus && st.calStripDotSelected,
                    isSelected && !myStatus && ({ outline: '2px solid #111111', outlineOffset: 2 } as any),
                  ]}
                  onPress={() => setSelectedDate(isSelected ? null : iso)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.calStripDate, textStyle]}>{day.getDate()}</Text>
                </TouchableOpacity>
              ) : (
                <View key={i} style={[
                  st.calStripCell,
                  isToday && st.calStripDotToday,
                  isPast && st.calStripDotPast,
                ]}>
                  <Text style={[st.calStripDate, isPast && st.calStripDatePast]}>{day.getDate()}</Text>
                </View>
              );
              return cell;
            })}
          </View>

          {/* Detail / summary row */}
          {selectedDate && selectedSlots.length > 0 ? (
            <View style={[st.calSlotDetail, { borderLeftWidth: 2, borderLeftColor: Colors.orange, paddingLeft: 7 }]}>
              {(() => {
                const d = parseLocal(selectedDate);
                const dayLabel = d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' }).replace(',','');
                const dateMyStatus = myVenueEnquiryDates[selectedDate!] as 'confirmed' | 'enquired' | 'declined' | undefined;
                return selectedSlots.map((slot: any, idx: number) => {
                  const parts: string[] = [];
                  if (slot.time) parts.push(slot.time);
                  if (slot.slotType) parts.push(slot.slotType);
                  if (slot.duration) parts.push(`${slot.duration} min`);
                  const slotFeeStr = slot.feeMin != null && slot.feeMax != null
                    ? `$${slot.feeMin}–$${slot.feeMax}`
                    : slot.feeMin != null ? `from $${slot.feeMin}` : null;
                  const venueFeeStr = !slotFeeStr && item.feeMin != null && item.feeMax != null
                    ? `$${item.feeMin}–$${item.feeMax}`
                    : !slotFeeStr && item.feeMin != null ? `from $${item.feeMin}` : null;
                  const feeStr = slotFeeStr || venueFeeStr;
                  if (feeStr) parts.push(feeStr);
                  const dayName = DAY_NAMES_FULL[parseLocal(selectedDate!).getDay()];
                  const prefix = idx === 0 ? `${dayLabel} · ` : '+ ';

                  if (dateMyStatus === 'confirmed') {
                    return <Text key={idx} style={[st.calSlotDetailText, { color: '#22c55e', textDecorationLine: 'none' }]} numberOfLines={1}>{prefix}{parts.join(' · ')} · Booked</Text>;
                  }
                  if (dateMyStatus === 'enquired') {
                    return <Text key={idx} style={[st.calSlotDetailText, { color: '#888888', textDecorationLine: 'none' }]} numberOfLines={1}>{prefix}{parts.join(' · ')} · Enquiry sent</Text>;
                  }
                  if (dateMyStatus === 'declined') {
                    return <Text key={idx} style={[st.calSlotDetailText, { color: '#aaaaaa', textDecorationLine: 'none', fontStyle: 'italic' }]} numberOfLines={1}>{prefix}{parts.join(' · ')} · Declined</Text>;
                  }
                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.7}
                      onPress={() => {
                        const _models = (slot as any).paymentModels?.length ? (slot as any).paymentModels : ((slot as any).paymentModel ? [(slot as any).paymentModel] : []);
                        router.push({
                          pathname: '/enquire',
                          params: {
                            venueId:   item.id,
                            venueName: item.name,
                            day:       dayName,
                            date:      selectedDate!,
                            time:      slot.time ?? '',
                            slotType:  slot.slotType ?? 'Either',
                            ...(slot.room ? { room: slot.room } : {}),
                            duration:  slot.duration ? String(slot.duration) : '',
                            capacity:  item.capacity ? String(item.capacity) : '',
                            ...(slot.notes ? { slotNote: slot.notes } : {}),
                            ...(_models.length ? { paymentModels: _models.join(',') } : {}),
                            ...((slot as any).feeMin != null ? { feeMin: String((slot as any).feeMin) } : {}),
                            ...((slot as any).feeMax != null ? { feeMax: String((slot as any).feeMax) } : {}),
                            ...((slot as any).paymentMethod ? { paymentMethod: (slot as any).paymentMethod } : {}),
                            ...(slot.minNotice ? { minNotice: slot.minNotice } : {}),
                          },
                        });
                      }}
                    >
                      <Text style={st.calSlotDetailText} numberOfLines={1}>{prefix}{parts.join(' · ')}</Text>
                    </TouchableOpacity>
                  );
                });
              })()}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 }}>
              {openCount > 0 && (
                <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: Colors.orange, marginRight: 1 }} />
              )}
              <Text style={st.calStripSummary} numberOfLines={1}>
                {openCount === 0
                  ? 'No open slots'
                  : <><Text style={{ color: Colors.orange, fontWeight: '700' }}>{openCount}</Text>{` open slot${openCount !== 1 ? 's' : ''}${nextSlot ? ` · Next: ${nextSlot.dateLabel}` : ''}`}</>
                }
              </Text>
            </View>
          )}
        </View>

        {/* Col 4: ACTION */}
        <View style={st.webColAction}>
          <View style={{ alignSelf: 'flex-end' }}>
            {isArtist ? (
              <TouchableOpacity
                style={[st.webTimetableBtn, { borderColor: colors.black, alignSelf: 'stretch' }]}
                onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
                activeOpacity={0.8}
              >
                <Text style={[st.webTimetableBtnText, { color: colors.black }]}>Enquire</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[st.webTimetableBtn, { borderColor: colors.black, alignSelf: 'stretch', marginTop: isArtist ? 8 : 0 }]}
              onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
              activeOpacity={0.8}
            >
              <Text style={[st.webTimetableBtnText, { color: colors.black }]}>Timetable</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Calendar slot row ─────────────────────────────────────────────
  function CalendarSlotRow({ slot }: { slot: CalSlot }) {
    const photo = slot.venue.photoUrl || slot.venue.photos?.[0];
    const venueGenres = (slot.venue.genre || slot.venue.genres || []) as string[];
    const meta = slot.venue.suburb || null;
    const slotInfo = [slot.slotType, slot.duration ? `${slot.duration} min` : null].filter(Boolean).join(' · ');
    const feeStr = slot.venue.feeMin != null && slot.venue.feeMax != null
      ? `$${slot.venue.feeMin}–$${slot.venue.feeMax}`
      : slot.venue.feeMin != null ? `from $${slot.venue.feeMin}` : null;
    return (
      <View style={st.calViewSlotRow}>
        <Text style={st.calViewSlotTime}>{slot.time}</Text>
        {photo
          ? <Image source={{ uri: photo }} style={st.calViewSlotThumb} resizeMode="cover" />
          : <View style={[st.calViewSlotThumb, st.calViewSlotThumbEmpty]}><Text style={st.calViewSlotThumbLabel}>photo</Text></View>
        }
        <TouchableOpacity
          style={{ flex: 2.5 }}
          onPress={() => router.push({ pathname: '/venue/[id]', params: { id: slot.venue.id, tab: 'overview' } })}
          activeOpacity={0.8}
        >
          <Text style={st.calViewVenueName}>{slot.venue.name}</Text>
          {meta ? <Text style={st.calViewVenueMeta}>{meta}</Text> : null}
          {venueGenres.length > 0 && (
            <Text style={st.calViewGenreText} numberOfLines={1}>
              {venueGenres.slice(0, 5).join(' · ')}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={st.calViewRoom}>{slot.room || '—'}</Text>
        {slot.venue.capacity != null && (
          <View style={st.calViewCapacity}>
            <Text style={st.calViewCapacityNum}>{slot.venue.capacity.toLocaleString()}</Text>
            <Text style={st.calViewCapacityLabel}>cap</Text>
          </View>
        )}
        {slotInfo ? <Text style={st.calViewSlotInfo}>{slotInfo}</Text> : null}
        {feeStr ? <Text style={st.calViewSlotFee}>{feeStr}</Text> : null}
        <View style={st.calViewActions}>
          {isArtist ? (() => {
            let calMyStatus: 'confirmed' | 'enquired' | 'declined' | null = null;
            for (const e of myEnquiries) {
              if (e.venueId !== slot.venue.id || e.requestedSlot?.date !== slot.dateISO) continue;
              const s = normalizeEnquiryStatus(e.status);
              if (s === 'confirmed') { calMyStatus = 'confirmed'; break; }
              if (s === 'declined' && !calMyStatus) { calMyStatus = 'declined'; continue; }
              if (s !== 'declined' && s !== 'cancelled') calMyStatus = 'enquired';
            }
            if (calMyStatus === 'confirmed' || calMyStatus === 'enquired') {
              const calEnquiry = myEnquiries.find(e => {
                if (e.venueId !== slot.venue.id || e.requestedSlot?.date !== slot.dateISO) return false;
                const s = normalizeEnquiryStatus(e.status);
                return s === calMyStatus;
              });
              return (
                <TouchableOpacity
                  style={[st.webTimetableBtn, { borderColor: calMyStatus === 'confirmed' ? '#22c55e' : colors.border, alignSelf: 'stretch' }]}
                  onPress={() => { if (!calEnquiry) return; const _m = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []); setSlotViewModal({ venueName: slot.venue.name, venueId: slot.venue.id, day: slot.day, date: slot.dateISO, time: slot.time, slotName: slot.name, room: slot.room, slotType: slot.slotType, duration: slot.duration, paymentModels: _m, feeMin: slot.feeMin, feeMax: slot.feeMax, paymentMethod: slot.paymentMethod, minNotice: slot.minNotice, slotNote: slot.notes, enquiryId: calEnquiry.id, status: calMyStatus }); }}
                  activeOpacity={0.85}
                >
                  <Text style={[st.webTimetableBtnText, { color: calMyStatus === 'confirmed' ? '#22c55e' : colors.black, fontSize: 12 }]}>View</Text>
                </TouchableOpacity>
              );
            }
            if (calMyStatus === 'declined')  return <Text style={[st.webTimetableBtnText, { color: '#aaaaaa', fontSize: 12, fontStyle: 'italic' }]}>Declined</Text>;
            return (
              <TouchableOpacity
                style={[st.webTimetableBtn, { borderColor: colors.black, alignSelf: 'stretch' }]}
                onPress={() => {
                  const _models = slot.paymentModels?.length ? slot.paymentModels : (slot.paymentModel ? [slot.paymentModel] : []);
                  router.push({
                    pathname: '/enquire',
                    params: {
                      venueId:   slot.venue.id,
                      venueName: slot.venue.name,
                      day:       slot.day,
                      date:      slot.dateISO,
                      time:      slot.time,
                      slotType:  slot.slotType ?? 'Either',
                      ...(slot.room ? { room: slot.room } : {}),
                      duration:  slot.duration ? String(slot.duration) : '',
                      capacity:  slot.venue.capacity ? String(slot.venue.capacity) : '',
                      ...(slot.name ? { slotName: slot.name } : {}),
                      ...(slot.notes ? { slotNote: slot.notes } : {}),
                      ...(_models.length ? { paymentModels: _models.join(',') } : {}),
                      ...(slot.feeMin != null ? { feeMin: String(slot.feeMin) } : {}),
                      ...(slot.feeMax != null ? { feeMax: String(slot.feeMax) } : {}),
                      ...(slot.paymentMethod ? { paymentMethod: slot.paymentMethod } : {}),
                      ...(slot.minNotice ? { minNotice: slot.minNotice } : {}),
                    },
                  });
                }}
                activeOpacity={0.85}
              >
                <Text style={[st.webTimetableBtnText, { color: colors.black }]}>Enquire</Text>
              </TouchableOpacity>
            );
          })() : null}
          <TouchableOpacity
            style={[st.webTimetableBtn, { borderColor: colors.black, alignSelf: 'stretch', marginTop: isArtist ? 6 : 0 }]}
            onPress={() => router.push({ pathname: '/venue/[id]', params: { id: slot.venue.id, tab: 'timetable' } })}
            activeOpacity={0.8}
          >
            <Text style={[st.webTimetableBtnText, { color: colors.black }]}>Timetable</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Web layout ────────────────────────────────────────────────────
  if (isWeb) {
    const d0 = toLocalStr(new Date());
    const d42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
    const totalOpenSlots = venues.reduce((sum, v) => sum + countOpenSlotsForRange(v, d0, d42), 0);
    const heroLocation = locationCoords && search ? search : null;
    const capacityLabel = capacity === 'any' ? 'any' : (CAPACITY_OPTIONS.find(o => o.value === capacity)?.label ?? capacity);
    const dateLabel = dateStart
      ? (dateEnd ? `${formatDateDisplay(dateStart)}–${formatDateDisplay(dateEnd)}` : formatDateDisplay(dateStart))
      : 'any date';

    // ── Mobile web (< 768 px) ──────────────────────────────────────
    if (windowWidth < 768) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {/* Hero — outside ScrollView so it's always fully visible */}
          <View style={[st.mobileWebHero, { backgroundColor: '#f2ede6', paddingTop: insets.top + TOP_TAB_H + 20 }]}>
            <Text style={st.mobileWebHeroTitle}>Find your next gig</Text>
            <Text style={st.webHeroSub}>
              {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalOpenSlots} open slots in the next 6 weeks
            </Text>
          </View>

          {/* Filter bar — outside ScrollView so dropdown renders above cards */}
          <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border, zIndex: 100, overflow: 'visible' as any }]}>
            {NativeFilterBar}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
          >
            <View style={[st.nativeContent, { paddingTop: 14 }]}>
              {loading
                ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
                : filtered.length === 0
                  ? <Text style={[st.empty, { paddingTop: 10 }]}>No venues match your filters.</Text>
                  : filtered.map(item => <VenueCard key={item.id} item={item} />)
              }
              <View style={{ height: 48 }} />
            </View>
          </ScrollView>
          {FilterPanel}
        </View>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: '#f2ede6' }}>

        {/* ── Hero (outside ScrollView so search dropdown z-index works) ── */}
        <View style={st.webHero}>
          <View style={st.webHeroInner}>
            <View style={{ flex: 1 }}>
              <Text style={st.webHeroTitle}>Find your next gig</Text>
              <Text style={st.webHeroSub}>
                {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalOpenSlots} open slots in the next 6 weeks
              </Text>
            </View>

            {/* Search */}
            <View style={{ width: 340, zIndex: 200 } as any}>
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <View style={st.webSearchRow}>
                  <View style={{ flex: 1, position: 'relative' as any }}>
                    <TextInput
                      style={[st.webSearchInput, search ? { paddingRight: 36 } : null]}
                      placeholder="Venue, suburb or postcode"
                      placeholderTextColor="#999"
                      value={search}
                      onChangeText={handleSearchChange}
                      onFocus={() => hasDropdown && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    />
                    {search ? (
                      <TouchableOpacity
                        style={{ position: 'absolute' as any, right: 10, top: 0, bottom: 0, justifyContent: 'center' }}
                        onPress={clearSearch}
                      >
                        <Text style={{ fontSize: 14, color: '#999', fontWeight: '600' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <TouchableOpacity style={st.webSearchBtn} onPress={() => setShowDropdown(false)}>
                    <Text style={st.webSearchBtnText}>Search</Text>
                  </TouchableOpacity>
                </View>
                {showDropdown && hasDropdown && (
                  <View style={[st.dropdown, { top: 48, left: 0, right: 0, zIndex: 9999 }]}>
                    {venueMatches.length > 0 && (<>
                      <Text style={st.dropSection}>VENUES</Text>
                      {venueMatches.map(v => (
                        <TouchableOpacity key={v.id} style={st.dropItem} onPress={() => selectVenueMatch(v)}>
                          <Text style={st.dropItemText}>🏛 {v.name}</Text>
                          {v.suburb ? <Text style={st.dropItemMeta}>{v.suburb}</Text> : null}
                        </TouchableOpacity>
                      ))}
                    </>)}
                    {areaSuggestions.length > 0 && (<>
                      <Text style={st.dropSection}>AREAS</Text>
                      {areaSuggestions.map((s, i) => (
                        <TouchableOpacity key={i} style={st.dropItem} onPress={() => selectAreaSuggestion(s)}>
                          <Text style={st.dropItemText}>📍 {s.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </>)}
                  </View>
                )}
              </View>
              {locationCoords && (
                <View style={[st.radiusPills, { marginTop: 10 }]}>
                  {RADIUS_OPTIONS.map(km => (
                    <TouchableOpacity key={km} style={[st.radiusPill, radius === km && st.radiusPillOn]} onPress={() => setRadius(km)}>
                      <Text style={[st.radiusPillText, radius === km && st.radiusPillTextOn]}>{km}km</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Filter chip bar (outside ScrollView — zIndex competes directly with backdrop) ── */}
        {/* Backdrop: zIndex 10, filter bar: zIndex 20 → filter bar always wins */}
        {webDropdown !== null && (
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 } as any}
            activeOpacity={1}
            onPress={() => setWebDropdown(null)}
          />
        )}
        <View style={[st.webFilterBar, { zIndex: 20, position: 'relative' as any }]}>
          <View style={st.webFilterInner}>
              {/* Available dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, dateActive && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'date' ? null : 'date')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, dateActive && st.webFilterPillTextActive]}>
                    Available {dateLabel} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'date' && (
                  <View style={[st.webFilterDropdown, { width: 260 }]}>
                    <Text style={st.webFilterDropLabel}>FROM</Text>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e: any) => { setDateStart(e.target.value); if (dateEnd && e.target.value > dateEnd) setDateEnd(''); }}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 13, marginBottom: 10, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' } as any}
                    />
                    <Text style={st.webFilterDropLabel}>TO</Text>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      value={dateEnd}
                      min={dateStart || undefined}
                      onChange={(e: any) => setDateEnd(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 13, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' } as any}
                    />
                    {dateStart && (
                      <TouchableOpacity style={{ marginTop: 12 }} onPress={() => { setDateStart(''); setDateEnd(''); setWebDropdown(null); }}>
                        <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear dates</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Capacity dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, capActive && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'capacity' ? null : 'capacity')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, capActive && st.webFilterPillTextActive]}>
                    Capacity {capacityLabel} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'capacity' && (
                  <View style={st.webFilterDropdown}>
                    {CAPACITY_OPTIONS.map(o => (
                      <TouchableOpacity
                        key={o.value}
                        style={[st.webDropdownOption, capacity === o.value && st.webDropdownOptionActive]}
                        onPress={() => { setCapacity(o.value); setWebDropdown(null); }}
                      >
                        <Text style={[st.webDropdownOptionText, capacity === o.value && st.webDropdownOptionTextActive]}>
                          {o.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Genre dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, genres.length > 0 && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'genre' ? null : 'genre')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, genres.length > 0 && st.webFilterPillTextActive]}>
                    {genres.length === 0 ? 'Genre' : genres.length === 1 ? genres[0] : `Genre: ${genres.length}`} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'genre' && (
                  <View style={[st.webFilterDropdown, { width: 260 }]}>
                    <View style={st.genreGrid}>
                      {GENRES.map(g => (
                        <TouchableOpacity
                          key={g}
                          style={[st.genrePill, genres.includes(g) && st.genrePillOn]}
                          onPress={() => toggleGenre(g)}
                        >
                          <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {genres.length > 0 && (
                      <TouchableOpacity style={{ marginTop: 12 }} onPress={() => setGenres([])}>
                        <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear genres</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={resetFilters}>
                  <Text style={st.webClearText}>Clear all</Text>
                </TouchableOpacity>
              )}

              {/* View toggle: Venue / Calendar — pinned right */}
              <View style={{ flex: 1, alignItems: 'flex-end' as any }}>
                <View style={st.webViewToggle}>
                  <TouchableOpacity
                    style={[st.webViewToggleBtn, webView === 'venue' && st.webViewToggleBtnActive]}
                    onPress={() => changeWebView('venue')}
                    activeOpacity={0.8}
                  >
                    <Text style={[st.webViewToggleBtnText, webView === 'venue' && st.webViewToggleBtnTextActive]}>Venue</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.webViewToggleBtn, webView === 'calendar' && st.webViewToggleBtnActive]}
                    onPress={() => changeWebView('calendar')}
                    activeOpacity={0.8}
                  >
                    <Text style={[st.webViewToggleBtnText, webView === 'calendar' && st.webViewToggleBtnTextActive]}>Calendar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

        {webView === 'venue' ? (<>
          {/* ── Column headers ─────────────────────────────────────── */}
          <View style={st.webTableHeader}>
            <Text style={[st.webTh, { flex: 3.5 }]}>VENUE</Text>
            <Text style={[st.webTh, { flex: 0.8 }]}>CAPACITY (MAX)</Text>
            <View style={{ flex: 3.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
              <Text style={st.webTh}>NEXT 3 WEEKS</Text>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: Colors.orange }} />
                  <Text style={st.legendLabel}>Open slot</Text>
                </View>
                {isArtist && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#22c55e' }} />
                    <Text style={st.legendLabel}>Enquired by me</Text>
                  </View>
                )}
                {isArtist && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#22c55e' }} />
                    <Text style={st.legendLabel}>Booked by me</Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={[st.webTh, { flex: 1.2, textAlign: 'right' as any }]}>ACTION</Text>
          </View>

          {/* ── Venue rows (scrollable) ─────────────────────────────── */}
          <ScrollView
            style={{ flex: 1, backgroundColor: '#ffffff' }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
          >
            {loading
              ? <ActivityIndicator style={{ marginTop: 60, marginBottom: 60 }} color={Colors.orange} />
              : filtered.length === 0
                ? <Text style={[st.empty, { paddingHorizontal: 32, paddingTop: 40 }]}>No venues match your filters.</Text>
                : filtered.map(item => <WebVenueRow key={item.id} item={item} />)
            }
            <View style={{ height: 80 }} />
          </ScrollView>
        </>) : (<>
          {/* ── Calendar view ───────────────────────────────────────── */}
          {(() => {
            const WEEKEND_DAYS = new Set(['Friday','Saturday','Sunday']);
            const calSlots = getCalendarSlots(filtered, calendarDays)
              .filter(s => calFilter === 'all' || WEEKEND_DAYS.has(s.day));

            // Group by date
            const calGrouped: { dateISO: string; dateLabel: string; slots: CalSlot[] }[] = [];
            for (const slot of calSlots) {
              const last = calGrouped[calGrouped.length - 1];
              if (!last || last.dateISO !== slot.dateISO) {
                const d = parseLocal(slot.dateISO);
                const dateLabel = d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',','');
                calGrouped.push({ dateISO: slot.dateISO, dateLabel, slots: [] });
              }
              calGrouped[calGrouped.length - 1].slots.push(slot);
            }

            return (
              <ScrollView
                style={{ flex: 1, backgroundColor: '#ffffff' }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
              >
                {/* Quick filter pills */}
                <View style={st.calViewPillBar}>
                  {([{key:'all',label:'All slots'},{key:'weekends',label:'Weekends'}] as const).map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[st.calViewPill, calFilter === f.key && st.calViewPillActive]}
                      onPress={() => setCalFilter(f.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.calViewPillText, calFilter === f.key && st.calViewPillTextActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Date groups */}
                {loading
                  ? <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
                  : calGrouped.length === 0
                    ? <Text style={[st.empty, { paddingHorizontal: 32, paddingTop: 40 }]}>No open slots match your filters.</Text>
                    : calGrouped.map(group => (
                        <View key={group.dateISO}>
                          <View style={st.calViewDateHeader}>
                            <Text style={st.calViewDateLabel}>{group.dateLabel}</Text>
                            <Text style={st.calViewDateCount}>{group.slots.length} slot{group.slots.length !== 1 ? 's' : ''}</Text>
                          </View>
                          {group.slots.map((slot, i) => (
                            <CalendarSlotRow key={`${slot.venue.id}-${slot.time}-${i}`} slot={slot} />
                          ))}
                        </View>
                      ))
                }

                {/* Load more */}
                {!loading && calGrouped.length > 0 && (
                  <TouchableOpacity style={st.calViewLoadMore} onPress={() => setCalendarDays(d => d + 14)}>
                    <Text style={st.calViewLoadMoreText}>Load more dates</Text>
                  </TouchableOpacity>
                )}
                <View style={{ height: 80 }} />
              </ScrollView>
            );
          })()}
        </>)}
      <SlotViewModal
        info={slotViewModal}
        colors={colors}
        onClose={() => setSlotViewModal(null)}
        onViewInbox={(id) => { setSlotViewModal(null); router.push({ pathname: '/(tabs)/inbox', params: { openEnquiryId: id } } as any); }}
      />
      </View>
    );
  }

  // ── Native layout ─────────────────────────────────────────────────
  const nD0  = toLocalStr(new Date());
  const nD42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
  const totalNativeSlots = filtered.reduce((sum, v) => sum + countOpenSlotsForRange(v, nD0, nD42), 0);

  return (
    <View style={[st.safe, { backgroundColor: colors.bg }]}>
      {/* Hero */}
      <View style={st.nativeHero}>
        <Text style={st.nativeTitle}>Find your next gig</Text>
        <Text style={st.nativeSub}>
          {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalNativeSlots} open slot{totalNativeSlots !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Filter bar — outside ScrollView so dropdown always renders on top */}
      <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border, zIndex: 100, overflow: 'visible' as any }]}>{NativeFilterBar}</View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[st.nativeContent, { paddingTop: 14 }]}>
          {loading
            ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
            : filtered.length === 0
              ? <Text style={st.empty}>No venues match your filters.</Text>
              : filtered.map(item => <VenueCard key={item.id} item={item} />)
          }
          <View style={{ height: 48 }} />
        </View>
      </ScrollView>
      {FilterPanel}
      <SlotViewModal
        info={slotViewModal}
        colors={colors}
        onClose={() => setSlotViewModal(null)}
        onViewInbox={(id) => { setSlotViewModal(null); router.push({ pathname: '/(tabs)/inbox', params: { openEnquiryId: id } } as any); }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  // Web two-column
  page:          { flex: 1, flexDirection: 'row', backgroundColor: '#ffffff' },
  sidebarScroll: { width: 280, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: '#eeeeee' },
  contentScroll: { flex: 1 },

  sidebar:    { padding: 24, paddingTop: 28, paddingBottom: 48 },
  sidebarHead:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  sidebarTitle:{ fontSize: 18, fontWeight: '700', color: '#111111' },
  resetAll:   { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  filterSection:{ marginBottom: 24 },
  filterLabel:{ fontSize: 10, fontWeight: '700', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  filterSubLabel:{ fontSize: 10, fontWeight: '700', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  filterInput:{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 9, paddingHorizontal: 12, fontSize: 13, color: '#111111', backgroundColor: '#fafafa' },
  filterInputOn:{ borderColor: Colors.orange, backgroundColor: '#ffffff' },

  searchWrap: { position: 'relative' as any, zIndex: 200, overflow: 'visible' as any },
  searchRow:  { flexDirection: 'row', alignItems: 'center' },
  searchInput:{ flex: 1 },
  clearX:     { position: 'absolute' as any, right: 10, padding: 2 },
  clearXText: { fontSize: 13, color: '#111111' },

  dropdown: {
    position: 'absolute' as any, top: 42, left: 0, right: 0,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e0e0',
    borderRadius: 8, zIndex: 9999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 10,
  },
  dropSection:  { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: '#999999' },
  dropItem:     { paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropItemText: { fontSize: 13, color: '#222222' },
  dropItemMeta: { fontSize: 11, color: '#888888' },

  radiusPills:    { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  radiusPill:     { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  radiusPillOn:   { backgroundColor: Colors.orange, borderColor: Colors.orange },
  radiusPillText: { fontSize: 12, color: '#111111' },
  radiusPillTextOn:{ color: '#ffffff', fontWeight: '600' },

  checkRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  checkbox:   { width: 15, height: 15, borderRadius: 3, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkLabel: { fontSize: 13, color: '#111111' },

  genreGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:      { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  genrePillOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  genrePillText:  { fontSize: 12, color: '#111111' },
  genrePillTextOn:{ color: '#ffffff', fontWeight: '600' },

  // Content
  content:   { padding: 36, paddingTop: 32, paddingBottom: 48 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginBottom: 4 },
  countText: { fontSize: 13, color: '#666666', marginBottom: 16 },
  empty:     { color: '#111111', fontSize: 14, marginTop: 40 },

  // Native filter bar
  nativeFilterBg:   { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#eeeeee', zIndex: 100, overflow: 'visible' as any },
  nativeFilterWrap: { paddingTop: 12, paddingBottom: 8, zIndex: 100, overflow: 'visible' as any },
  nativeTopRow:     { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  nativeSearchBox:  { flex: 1, position: 'relative' as any },
  nativeSearchInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 10, paddingHorizontal: 14, paddingRight: 36,
    fontSize: 14, color: '#111111', backgroundColor: '#fafafa',
  },
  nativeClearX: { position: 'absolute' as any, right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  nativePillScroll: { flexGrow: 0 },
  nativePillRow:    { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingBottom: 6 },

  filtersBtn:      { borderRadius: 10, borderWidth: 1.5, borderColor: '#dddddd', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fafafa' },
  filtersBtnOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filtersBtnText:  { fontSize: 14, fontWeight: '600', color: '#555555' },
  filtersBtnTextOn:{ color: '#ffffff' },

  activeChip:     { borderRadius: 20, borderWidth: 1, borderColor: Colors.orange, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.orange + '18' },
  activeChipText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  resetPill:      { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7 },
  resetPillText:  { fontSize: 13, fontWeight: '600', color: Colors.orange },

  // Filter panel (slide-in from left)
  fpOverlay:    { flex: 1, flexDirection: 'row' },
  fpPanel: {
    width: PANEL_W, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 6, height: 0 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16,
  },
  fpBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  fpHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  fpCloseBtn:   { width: 32, alignItems: 'flex-start' },
  fpCloseText:  { fontSize: 18, color: '#555555', fontWeight: '400' },
  fpTitle:      { fontSize: 17, fontWeight: '700', color: '#111111' },
  fpReset:      { fontSize: 13, fontWeight: '600', color: Colors.orange, width: 42, textAlign: 'right' },
  fpFooter:     { padding: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: '#eeeeee' },
  fpApplyBtn:   { backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  fpApplyBtnText:{ fontSize: 16, fontWeight: '700', color: '#111111' },
  fpSection:    { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 4 },
  fpSectionTitle:{ fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  fpSubLabel:   { fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 12 },
  fpOptionRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  fpOptionText: { fontSize: 14, color: '#111111' },

  nativeContent:  { paddingHorizontal: 16 },
  countRow:       { paddingTop: 14, paddingBottom: 8 },

  nativeHero:     { backgroundColor: '#f2ede6', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
  nativeTitle:    { fontSize: 30, fontWeight: '800', color: '#111111', letterSpacing: -0.5, lineHeight: 36 },
  nativeSub:      { fontSize: 13, color: '#666666', marginTop: 4 },

  // Filter icon button
  filterIconBtn:      { borderRadius: 10, borderWidth: 1.5, borderColor: '#dddddd', padding: 10, backgroundColor: '#fafafa', position: 'relative' as any },
  filterIconBtnOn:    { borderColor: Colors.orange },
  filterIconBadge:    { position: 'absolute' as any, top: -7, right: -7, backgroundColor: Colors.orange, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  filterIconBadgeText:{ color: '#ffffff', fontSize: 10, fontWeight: '800', lineHeight: 18 },

  // Cards
  card:           { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 14, overflow: 'hidden', marginBottom: 14 },
  cardHovered:    { transform: [{ scale: 1.012 }], shadowColor: Colors.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 8 },

  // Card photo (full-width top)
  cardPhoto:      { width: '100%' as any, height: 85 },
  cardPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardPhotoLabel: { fontSize: 11, fontStyle: 'italic' },

  // Card body
  cardBody:       { padding: 12, gap: 3 },
  cardNameRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  cardCap:        { fontSize: 11, fontWeight: '500', marginTop: 2 },
  venueName:      { fontSize: 16, fontWeight: '700', color: '#111111', lineHeight: 21 },
  venueAddr:      { fontSize: 12, color: '#666666', marginTop: 1 },
  venueGenreText: { fontSize: 11, fontWeight: '400', marginTop: 2 },
  genreRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  pill:           { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  pillText:       { fontSize: 11, color: Colors.orange, fontWeight: '500' },

  // Card slots section
  cardSlots:      { marginTop: 8, paddingTop: 8, borderTopWidth: 1, gap: 0 },
  slotsLabel:     { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 4 },
  slotRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  slotDate:         { fontSize: 13, fontWeight: '700' },
  slotType:         { fontSize: 11, fontWeight: '500', marginTop: 1 },
  slotEnquireLink:  { fontSize: 13, fontWeight: '700', color: Colors.orange },
  moreText:         { fontSize: 12, color: Colors.orange, marginTop: 4 },
  slotsNone:      { fontSize: 12, color: '#aaaaaa', fontStyle: 'italic' },

  // Stats row
  statsRow:       { flexDirection: 'row', marginTop: 6, paddingTop: 4 },
  statCol:        { flex: 1, alignItems: 'center', gap: 2 },
  statDivider:    { width: 1, marginVertical: 2 },
  statVal:        { fontSize: 12, fontWeight: '700' },
  statLabel:      { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' as const, color: '#aaaaaa' },

  // Card buttons
  cardBtns:            { flexDirection: 'row', gap: 10, marginTop: 8, paddingTop: 4 },
  cardBtnOutlined:     { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  cardBtnOutlinedText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
  cardBtnFilled:       { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  cardBtnFilledText:   { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  // ── Mobile web hero ───────────────────────────────────────────────
  mobileWebHero:      { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 },
  mobileWebHeroTitle: { fontSize: 30, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginTop: 6, lineHeight: 36 },

  // ── Web hero ─────────────────────────────────────────────────────
  webHero:        { backgroundColor: '#f2ede6', paddingHorizontal: 32, paddingTop: 48, paddingBottom: 40, zIndex: 50, overflow: 'visible' as any },
  webHeroInner:   { flexDirection: 'row', alignItems: 'flex-end', gap: 40 },
  webHeroLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: Colors.orange, textTransform: 'uppercase' as any },
  webHeroTitle:   { fontSize: 48, fontWeight: '800', color: '#111111', letterSpacing: -1.5 as any, marginTop: 6, lineHeight: 52 },
  webHeroSub:     { fontSize: 14, color: '#666666', marginTop: 8 },
  webSearchRow:   { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  webSearchInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#d8d3cd', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#111111',
    backgroundColor: '#ffffff',
  },
  webSearchBtn:     { backgroundColor: '#111111', borderRadius: 8, paddingHorizontal: 22, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  webSearchBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Web filter bar ────────────────────────────────────────────────
  webFilterBar:   { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e0dbd4', borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  webFilterInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 12, gap: 8, flexWrap: 'wrap' as any },
  webFilterPill:  { borderWidth: 1, borderColor: '#d0ccc7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#ffffff' },
  webFilterPillActive:     { borderColor: Colors.orange, backgroundColor: Colors.orange + '12' },
  webFilterPillText:       { fontSize: 13, color: '#333333', fontWeight: '500' },
  webFilterPillTextActive: { color: Colors.orange, fontWeight: '600' },
  webFilterDropdown: {
    position: 'absolute' as any, top: '110%' as any, left: 0, marginTop: 4,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e0e0',
    borderRadius: 10, padding: 14, zIndex: 300, minWidth: 180,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 12,
  },
  webFilterDropLabel:       { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.8, textTransform: 'uppercase' as any, marginBottom: 6 },
  webDropdownOption:        { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 6 },
  webDropdownOptionActive:  { backgroundColor: Colors.orange + '18' },
  webDropdownOptionText:    { fontSize: 13, color: '#333333' },
  webDropdownOptionTextActive: { color: Colors.orange, fontWeight: '600' },
  webActiveChip:     { borderWidth: 1, borderColor: Colors.orange, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.orange + '12' },
  webActiveChipText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  webClearText:      { fontSize: 13, color: '#888888', textDecorationLine: 'underline' as any, paddingHorizontal: 4 },
  webFilterMoreBtn:     { borderWidth: 1, borderColor: '#d0ccc7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fafafa' },
  webFilterMoreBtnText: { fontSize: 13, color: '#555555', fontWeight: '500' },

  // ── Web table header ─────────────────────────────────────────────
  webTableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
    gap: 16,
  },
  webTh: { fontSize: 10, fontWeight: '700', color: '#aaaaaa', textTransform: 'uppercase' as any, letterSpacing: 0.9 },

  // ── Web venue rows ────────────────────────────────────────────────
  webRow:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 16 },
  webColVenue:         { flex: 3.5, flexDirection: 'row', alignItems: 'center', gap: 16 },
  webColVenueInfo:     { flex: 1, gap: 5 },
  webColCapacity:      { flex: 0.8 },
  webColCalendar:      { flex: 3.5 },
  webColAction:        { flex: 1.2, alignItems: 'flex-end' as any },
  webColValue:         { fontSize: 14, color: '#333333', fontWeight: '500' },
  webRowThumb:         { width: 88, height: 88, borderRadius: 10 },
  webRowThumbEmpty:    { backgroundColor: '#e8e3d8', alignItems: 'center', justifyContent: 'center' },
  webRowThumbLabel:    { fontSize: 10, color: '#aaaaaa', fontStyle: 'italic' },
  webRowName:          { fontSize: 15, fontWeight: '700', color: '#111111' },
  webRowMeta:          { fontSize: 12, color: '#888888' },
  webRowGenres:        { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  webEnquireBtn:       { backgroundColor: '#111111', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  webEnquireBtnText:   { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  webTimetableBtn:     { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center' as const, alignSelf: 'flex-end' as const },
  webTimetableBtnText: { fontSize: 13, fontWeight: '600' },
  webViewTimetableLink:{ fontSize: 12, color: Colors.orange, fontWeight: '600' },
  webViewToggle:           { flexDirection: 'row', backgroundColor: '#f0ede8', borderRadius: 8, padding: 3, gap: 2 },
  webViewToggleBtn:        { borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 },
  webViewToggleBtnActive:  { backgroundColor: '#ffffff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  webViewToggleBtnText:    { fontSize: 13, fontWeight: '500', color: '#888888' },
  webViewToggleBtnTextActive: { color: '#111111', fontWeight: '700' },
  // ── Calendar strip ────────────────────────────────────────────────
  calStripRow:         { flexDirection: 'row', gap: 2 },
  calStripCell:        { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: '#f0f0f0' },
  calStripDayLetter:   { fontSize: 8, fontWeight: '600', color: '#111111' },
  calStripHeaderCell:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  calStripDotOpen:      { backgroundColor: Colors.orange },
  calStripDotSelected:  { backgroundColor: '#c96500' },
  calStripDotToday:     { backgroundColor: '#dedede' },
  calStripDotPast:      { backgroundColor: 'transparent' },
  calStripDotEnquired:  { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#22c55e' },
  calStripDotConfirmed: { backgroundColor: '#22c55e' },
  calStripDotDeclined:  { backgroundColor: 'transparent' },
  calStripDate:         { fontSize: 9, color: '#111111' },
  calStripDatePast:     { color: '#bbbbbb' },
  calStripDateOpen:     { color: '#111111' },
  calStripDateLight:    { color: '#ffffff' },
  calStripSummary:     { fontSize: 11, color: '#888888' },
  legendLabel:         { fontSize: 10, fontWeight: '600', color: '#888888' },
  calSlotDetail:       { marginTop: 6, gap: 2 },
  calSlotDetailText:   { fontSize: 11, color: '#111111', fontWeight: '600', textDecorationLine: 'underline' as any },

  // ── Calendar view (date-grouped slot list) ────────────────────────
  calViewPillBar:        { flexDirection: 'row', gap: 8, paddingHorizontal: 32, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  calViewPill:           { borderRadius: 8, borderWidth: 1, borderColor: '#d0ccc7', paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#ffffff' },
  calViewPillActive:     { backgroundColor: '#111111', borderColor: '#111111' },
  calViewPillText:       { fontSize: 13, fontWeight: '500', color: '#333333' },
  calViewPillTextActive: { color: '#ffffff', fontWeight: '700' },

  calViewDateHeader:  { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 32, paddingVertical: 12, backgroundColor: '#f5f5f5', borderTopWidth: 1, borderTopColor: '#eeeeee' },
  calViewDateLabel:   { fontSize: 15, fontWeight: '700', color: '#111111' },
  calViewDateCount:   { fontSize: 13, color: '#aaaaaa' },

  calViewSlotRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f5f5f5', gap: 12 },
  calViewSlotTime:      { width: 80, fontSize: 17, fontWeight: '700', color: '#111111', flexShrink: 0 },
  calViewSlotThumb:     { width: 52, height: 52, borderRadius: 8, flexShrink: 0 },
  calViewSlotThumbEmpty:{ backgroundColor: '#e8e3d8', alignItems: 'center', justifyContent: 'center' },
  calViewSlotThumbLabel:{ fontSize: 9, color: '#aaaaaa', fontStyle: 'italic' },
  calViewVenueName:     { fontSize: 15, fontWeight: '700', color: '#111111' },
  calViewVenueMeta:     { fontSize: 12, color: '#888888', marginTop: 2 },
  calViewGenreText:     { fontSize: 12, color: '#111111', marginTop: 4, fontWeight: '500' },
  calViewSlotInfo:      { flex: 1, fontSize: 13, color: '#555555', textAlign: 'center' as any },
  calViewSlotFee:       { flex: 1, fontSize: 13, color: '#555555', textAlign: 'center' as any },
  calViewRoom:          { flex: 1, fontSize: 13, color: '#555555', textAlign: 'center' as any },
  calViewCapacity:      { flex: 1, alignItems: 'center' as any },
  calViewCapacityNum:   { fontSize: 15, fontWeight: '700', color: '#111111', textAlign: 'center' as any },
  calViewCapacityLabel: { fontSize: 11, color: '#aaaaaa', marginTop: 1, textAlign: 'center' as any },
  calViewActions:       { alignItems: 'center' as any, flexShrink: 0 },
  calViewEnquireBtn:    { backgroundColor: '#111111', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  calViewEnquireBtnText:{ fontSize: 13, fontWeight: '700', color: '#ffffff' },
  calViewTimetableLink: { fontSize: 12, color: Colors.orange, fontWeight: '600' },

  calViewLoadMore:      { alignItems: 'center', paddingVertical: 28 },
  calViewLoadMoreText:  { fontSize: 14, fontWeight: '600', color: Colors.orange, textDecorationLine: 'underline' as any },
});
