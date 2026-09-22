/**
 * Financial dashboard for artists, venues, and agents.
 *
 * Route params:
 *  - mode: 'artist' | 'venue' | 'agent'   (default: derived from profile)
 *  - entityId: string (optional — agent drill-down to one client)
 *
 * Charting: hand-rolled SVG bars using react-native-svg (already installed).
 *   Chosen over victory-native (requires Skia) and recharts (web-only).
 *
 * PDF: expo-print + expo-sharing (newly installed).
 * CSV: plain string + expo-sharing on native, <a download> on web.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Platform, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';
import Svg, { Rect as SvgRect, Text as SvgText, G } from 'react-native-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Timestamp } from 'firebase/firestore';

import {
  PERIOD_PRESETS, getDashboardGigs, summarizeGigs, gigRowDisplay,
  getEnquiryStats, getRosterDashboard, formatAud,
  type Period, type DashboardSummary, type RosterDashboard,
  type RosterEntitySummary, type GigRowDisplay,
} from '@/lib/dashboard';
import { buildPdfHtml, buildCsv } from '@/lib/dashboard-export';
import type { Gig } from '@/lib/gig-types';
import { getRosterGigs, type RosterGig, type AgentRosterEntry } from '@/lib/agentRoster';
import { toZonedTime } from 'date-fns-tz';

const isWeb = Platform.OS === 'web';

// ── Period picker ─────────────────────────────────────────────────────────────

const PRESET_KEYS = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy'] as const;
const PRESET_LABELS: Record<string, string> = {
  this_month:   'This month',
  last_month:   'Last month',
  this_quarter: 'This quarter',
  this_fy:      'This FY',
  last_fy:      'Last FY',
  custom:       'Custom',
};

function DateInput({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: any;
}) {
  if (isWeb) {
    return (
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          flex: 1,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          background: 'transparent',
          color: colors.black,
        } as any}
      />
    );
  }
  // Native: plain text input (YYYY-MM-DD)
  const { TextInput } = require('react-native');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="YYYY-MM-DD"
      placeholderTextColor={colors.greyLight}
      style={[s.dateInput, { borderColor: colors.border, color: colors.black }]}
      keyboardType="numeric"
    />
  );
}

// ── SVG bar chart ─────────────────────────────────────────────────────────────

function BarChart({
  data,
  colors,
}: {
  data: { label: string; confirmedCents: number; pendingCents: number }[];
  colors: any;
}) {
  const { width } = useWindowDimensions();
  const chartWidth  = Math.min(width - 40, 600);
  const chartHeight = 120;
  const barCount    = data.length;
  if (barCount === 0) return null;

  const maxCents = Math.max(...data.map(d => d.confirmedCents + d.pendingCents), 1);
  const barW    = Math.max(4, Math.floor((chartWidth - 40) / barCount) - 4);
  const step    = Math.floor((chartWidth - 40) / barCount);

  return (
    <Svg width={chartWidth} height={chartHeight + 24}>
      {data.map((d, i) => {
        const x = 20 + i * step;
        const totalH = Math.round(((d.confirmedCents + d.pendingCents) / maxCents) * chartHeight);
        const confH  = Math.round((d.confirmedCents / maxCents) * chartHeight);
        const pendH  = totalH - confH;

        return (
          <G key={i}>
            {/* Pending (red) — bottom */}
            {pendH > 0 && (
              <SvgRect
                x={x}
                y={chartHeight - totalH}
                width={barW}
                height={pendH}
                fill="#ef4444"
                opacity={0.7}
                rx={2}
              />
            )}
            {/* Confirmed (orange) — on top */}
            {confH > 0 && (
              <SvgRect
                x={x}
                y={chartHeight - totalH + pendH}
                width={barW}
                height={confH}
                fill={Colors.orange}
                rx={2}
              />
            )}
            {/* Month label */}
            <SvgText
              x={x + barW / 2}
              y={chartHeight + 16}
              textAnchor="middle"
              fontSize={9}
              fill={colors.grey}
            >
              {d.label.slice(0, 3)}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ── Headline card ─────────────────────────────────────────────────────────────

function HeadlineCard({
  summary,
  colors,
}: {
  summary: DashboardSummary;
  colors: any;
}) {
  return (
    <View style={[card.box, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
      <View style={card.row}>
        <View style={card.col}>
          <Text style={[card.label, { color: colors.grey }]}>CONFIRMED</Text>
          <Text style={[card.amount, { color: colors.black }]}>
            {formatAud(summary.confirmedCents)}
          </Text>
          {summary.selfReportedCents > 0 && (
            <Text style={[card.sub, { color: colors.greyLight }]}>
              incl. {formatAud(summary.selfReportedCents)} self-reported
            </Text>
          )}
        </View>
        <View style={[card.divider, { backgroundColor: colors.border }]} />
        <View style={card.col}>
          <Text style={[card.label, { color: '#ef4444' }]}>PENDING</Text>
          <Text style={[card.amount, { color: '#ef4444' }]}>
            {formatAud(summary.pendingCents)}
          </Text>
        </View>
      </View>

      {summary.disputedCount > 0 && (
        <View style={[card.disputedRow, { borderTopColor: colors.border }]}>
          <Text style={[card.disputedText, { color: '#f59e0b' }]}>
            {formatAud(summary.disputedCents)} disputed ({summary.disputedCount} gig{summary.disputedCount > 1 ? 's' : ''}) — excluded from totals
          </Text>
        </View>
      )}

      {summary.noFeeCount > 0 && (
        <View style={[card.disputedRow, { borderTopColor: colors.border }]}>
          <Text style={[card.disputedText, { color: colors.greyLight }]}>
            {summary.noFeeCount} gig{summary.noFeeCount > 1 ? 's' : ''} with no fee recorded
          </Text>
        </View>
      )}

      <View style={[card.statsRow, { borderTopColor: colors.border }]}>
        <Text style={[card.statItem, { color: colors.grey }]}>
          {summary.gigsPlayed} played
        </Text>
        <Text style={[card.statItem, { color: colors.grey }]}>
          {summary.gigsUpcoming} upcoming
        </Text>
        <Text style={[card.statItem, { color: colors.grey }]}>
          {summary.gigsPlayed + summary.gigsUpcoming} total
        </Text>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  box:          { borderWidth: 1, borderRadius: 14, marginBottom: 20, overflow: 'hidden' },
  row:          { flexDirection: 'row', padding: 16, gap: 0 },
  col:          { flex: 1, gap: 4 },
  divider:      { width: 1, marginHorizontal: 16 },
  label:        { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' as const },
  amount:       { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  sub:          { fontSize: 11 },
  disputedRow:  { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  disputedText: { fontSize: 12, fontWeight: '600' },
  statsRow:     { flexDirection: 'row', borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 16 },
  statItem:     { fontSize: 12 },
});

// ── Gig table row ─────────────────────────────────────────────────────────────

function GigTableRow({
  gig,
  role,
  colors,
}: {
  gig: Gig;
  role: 'artist' | 'venue';
  colors: any;
}) {
  const display    = gigRowDisplay(gig);
  const tz         = gig.timezone ?? 'Australia/Melbourne';
  const localStart = toZonedTime(gig.startAt.toDate(), tz);
  const dateStr    = localStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const counterparty = role === 'artist'
    ? (gig.venueName ?? 'Unknown venue')
    : (gig.artistName ?? gig.bandName ?? 'Unknown artist');

  const statusColor =
    display.status === 'confirmed'     ? '#16a34a' :
    display.status === 'self_reported' ? '#16a34a' :
    display.status === 'pending'       ? '#ef4444' :
    display.status === 'disputed'      ? '#f59e0b' :
    colors.greyLight;

  return (
    <View style={[tr.row, { borderBottomColor: colors.border }]}>
      <View style={tr.dateCol}>
        <Text style={[tr.date, { color: colors.grey }]}>{dateStr}</Text>
      </View>
      <View style={tr.nameCol}>
        <Text style={[tr.name, { color: colors.black }]} numberOfLines={1}>{counterparty}</Text>
        {display.status === 'self_reported' && (
          <Text style={[tr.badge, { color: colors.greyLight }]}>self-reported</Text>
        )}
      </View>
      <View style={tr.feeCol}>
        <Text style={[tr.planned, { color: colors.grey }]}>{display.planned}</Text>
      </View>
      <View style={tr.actualCol}>
        <Text style={[tr.actual, { color: statusColor }]}>{display.actual}</Text>
      </View>
    </View>
  );
}

const tr = StyleSheet.create({
  row:       { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, gap: 8, alignItems: 'center' },
  dateCol:   { width: 80 },
  nameCol:   { flex: 1 },
  feeCol:    { width: 110 },
  actualCol: { width: 70, alignItems: 'flex-end' },
  date:      { fontSize: 11 },
  name:      { fontSize: 13, fontWeight: '600' },
  badge:     { fontSize: 10 },
  planned:   { fontSize: 12 },
  actual:    { fontSize: 13, fontWeight: '700' },
});

// ── Agent roster avatar strip ─────────────────────────────────────────────────

function getInitials(name: string) {
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

function RosterStrip({
  entities,
  selectedId,
  onSelect,
  colors,
}: {
  entities: RosterEntitySummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  colors: any;
}) {
  return (
    <View style={[rs.wrap, { borderBottomColor: colors.border }]}>
      <Text style={[rs.label, { color: colors.greyLight }]}>ROSTER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rs.row}>
        <TouchableOpacity style={rs.chip} onPress={() => onSelect(null)} activeOpacity={0.75}>
          <View style={[rs.avatar, selectedId === null && rs.avatarSel, { backgroundColor: '#e8e8e8' }]}>
            <Text style={[rs.initials, { color: selectedId === null ? Colors.orange : '#888' }]}>All</Text>
          </View>
          <Text style={[rs.name, selectedId === null && { fontWeight: '700', color: colors.black }]}>All</Text>
        </TouchableOpacity>
        {entities.map(({ entity }) => (
          <TouchableOpacity
            key={entity.id}
            style={rs.chip}
            onPress={() => onSelect(entity.id)}
            activeOpacity={0.75}
          >
            <View style={[rs.avatar, selectedId === entity.id && rs.avatarSel, { backgroundColor: '#e8e8e8' }]}>
              <Text style={[rs.initials, { color: selectedId === entity.id ? Colors.orange : '#888' }]}>
                {getInitials(entity.name)}
              </Text>
            </View>
            <Text
              style={[rs.name, selectedId === entity.id && { fontWeight: '700', color: colors.black }]}
              numberOfLines={1}
            >
              {entity.name.length > 10 ? entity.name.slice(0, 9) + '\u2026' : entity.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const rs = StyleSheet.create({
  wrap:    { borderBottomWidth: 1, paddingTop: 10, paddingBottom: 4 },
  label:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 16, marginBottom: 8 },
  row:     { paddingHorizontal: 12, gap: 4, paddingBottom: 8 },
  chip:    { alignItems: 'center', width: 56, gap: 4 },
  avatar:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarSel: { borderWidth: 2, borderColor: Colors.orange },
  initials:  { fontSize: 12, fontWeight: '700' },
  name:    { fontSize: 10, color: '#888', textAlign: 'center' },
});

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ label, colors }: { label: string; colors: any }) {
  return (
    <Text style={[s.sectionHeading, { color: colors.greyLight }]}>{label.toUpperCase()}</Text>
  );
}

// ── Embeddable content (no header / SafeAreaView) ─────────────────────────────

export function DashboardContent() {
  const { user, profile }     = useAuth();
  const { colors }            = useTheme();
  const params                = useLocalSearchParams<{ mode?: string; entityId?: string }>();

  const isAgent  = profile?.type === 'agent';
  const isVenue  = profile?.type === 'venue';
  const role     = isVenue ? 'venue' : 'artist';

  // ── Period ────────────────────────────────────────────────────────────────
  const [presetKey, setPresetKey] = useState<string>('this_fy');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [customErr,  setCustomErr]  = useState('');

  const period = useMemo<Period | null>(() => {
    if (presetKey === 'custom') {
      if (!customFrom || !customTo) return null;
      const sf = new Date(customFrom + 'T00:00:00');
      const se = new Date(customTo   + 'T00:00:00');
      if (isNaN(sf.getTime()) || isNaN(se.getTime()) || sf >= se) {
        return null;
      }
      return {
        start: Timestamp.fromDate(sf),
        end:   Timestamp.fromDate(se),
        label: `${customFrom} to ${customTo}`,
      };
    }
    const fn = PERIOD_PRESETS[presetKey];
    return fn ? fn() : null;
  }, [presetKey, customFrom, customTo]);

  // ── Agent drill-down ──────────────────────────────────────────────────────
  const [rosterDash, setRosterDash]   = useState<RosterDashboard | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // ── Non-agent data ────────────────────────────────────────────────────────
  const [gigs, setGigs]       = useState<Gig[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  // ── Shared state ──────────────────────────────────────────────────────────
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [exporting,  setExporting]  = useState(false);
  const [exportErr,  setExportErr]  = useState('');

  // Filters (operate on already-fetched gigs, no extra queries)
  const [filterSource,  setFilterSource]  = useState<string>('all');
  const [filterFeeType, setFilterFeeType] = useState<string>('all');

  const load = useCallback(async () => {
    if (!period || !user) return;
    setLoading(true);
    setError('');
    try {
      if (isAgent) {
        const dash = await getRosterDashboard(user.uid, period);
        setRosterDash(dash);
      } else {
        const fetched = await getDashboardGigs(user.uid, period);
        setGigs(fetched);
        setSummary(summarizeGigs(fetched, role));
      }
    } catch (e: any) {
      setError('Could not load dashboard data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [period, user?.uid, isAgent, role]);

  useEffect(() => { load(); }, [load]);

  // Derived state for agent drill-down
  const activeEntity: RosterEntitySummary | null = useMemo(() => {
    if (!rosterDash || !selectedEntityId) return null;
    return rosterDash.entities.find(e => e.entity.id === selectedEntityId) ?? null;
  }, [rosterDash, selectedEntityId]);

  const activeSummary: DashboardSummary | null = isAgent
    ? (activeEntity ? activeEntity.summary : rosterDash?.total ?? null)
    : summary;

  const activeGigs: Gig[] = isAgent
    ? (activeEntity ? activeEntity.gigs : (rosterDash?.entities.flatMap(e => e.gigs) ?? []))
    : gigs;

  const activeRole: 'artist' | 'venue' = isAgent && activeEntity
    ? (activeEntity.entity.type === 'venue' ? 'venue' : 'artist')
    : role;

  // Client-side filters
  const filteredGigs = useMemo(() => {
    return activeGigs
      .filter(g => filterSource  === 'all' || g.source  === filterSource)
      .filter(g => filterFeeType === 'all' || g.fee?.type === filterFeeType);
  }, [activeGigs, filterSource, filterFeeType]);

  const filteredSummary = useMemo(() => {
    if (!filteredGigs.length) return activeSummary;
    // Recompute when filters are applied
    if (filterSource !== 'all' || filterFeeType !== 'all') {
      return summarizeGigs(filteredGigs, activeRole);
    }
    return activeSummary;
  }, [filteredGigs, activeSummary, filterSource, filterFeeType, activeRole]);

  // ── Exports ───────────────────────────────────────────────────────────────

  async function handleExportPdf() {
    if (!filteredSummary || !period) return;
    setExporting(true);
    setExportErr('');
    try {
      const html = buildPdfHtml(filteredSummary, filteredGigs, activeRole, period.label);
      if (isWeb) {
        // Web: open print dialog
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
          win.print();
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch {
      setExportErr('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    if (!period) return;
    setExporting(true);
    setExportErr('');
    try {
      const csv = buildCsv(filteredGigs, activeRole, period);
      if (isWeb) {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `twaylo-dashboard-${period.label.replace(/\s/g, '-')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const FileSystem = require('expo-file-system');
        const path = FileSystem.cacheDirectory + 'twaylo-dashboard.csv';
        await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(path, { mimeType: 'text/csv' });
      }
    } catch {
      setExportErr('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // ── Filter pills helper ───────────────────────────────────────────────────

  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = { all: activeGigs.length };
    for (const g of activeGigs) m[g.source] = (m[g.source] ?? 0) + 1;
    return m;
  }, [activeGigs]);

  const feeTypeCounts = useMemo(() => {
    const m: Record<string, number> = { all: activeGigs.length };
    for (const g of activeGigs) {
      const ft = g.fee?.type ?? 'other';
      m[ft] = (m[ft] ?? 0) + 1;
    }
    return m;
  }, [activeGigs]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1 }}>
      {/* Agent roster strip */}
      {isAgent && rosterDash && rosterDash.entities.length > 0 && (
        <RosterStrip
          entities={rosterDash.entities}
          selectedId={selectedEntityId}
          onSelect={setSelectedEntityId}
          colors={colors}
        />
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Period presets */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.presetRow}
        >
          {PRESET_KEYS.map(key => (
            <TouchableOpacity
              key={key}
              style={[s.presetPill, presetKey === key && s.presetPillActive, { borderColor: colors.border }]}
              onPress={() => setPresetKey(key)}
              activeOpacity={0.75}
            >
              <Text style={[s.presetText, { color: presetKey === key ? '#fff' : colors.grey }]}>
                {PRESET_LABELS[key]}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.presetPill, presetKey === 'custom' && s.presetPillActive, { borderColor: colors.border }]}
            onPress={() => setPresetKey('custom')}
            activeOpacity={0.75}
          >
            <Text style={[s.presetText, { color: presetKey === 'custom' ? '#fff' : colors.grey }]}>Custom</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Custom date range */}
        {presetKey === 'custom' && (
          <View style={[s.customRange, { borderColor: colors.border }]}>
            <DateInput value={customFrom} onChange={v => { setCustomFrom(v); setCustomErr(''); }} colors={colors} />
            <Text style={[s.rangeSep, { color: colors.grey }]}>to</Text>
            <DateInput value={customTo}   onChange={v => { setCustomTo(v);   setCustomErr(''); }} colors={colors} />
            {customErr ? <Text style={s.customErr}>{customErr}</Text> : null}
          </View>
        )}

        {loading && (
          <View style={s.centre}>
            <ActivityIndicator color={Colors.orange} />
          </View>
        )}

        {error ? (
          <Text style={[s.error, { color: '#ef4444' }]}>{error}</Text>
        ) : null}

        {!loading && !error && period && filteredSummary && (
          <>
            {/* Headline card */}
            <HeadlineCard summary={filteredSummary} colors={colors} />

            {/* Monthly bar chart */}
            {filteredSummary.byMonth.length > 0 && (
              <View style={s.chartSection}>
                <SectionHeading label="Monthly breakdown" colors={colors} />
                <View style={s.chartLegend}>
                  <View style={[s.legendDot, { backgroundColor: Colors.orange }]} />
                  <Text style={[s.legendLabel, { color: colors.grey }]}>Confirmed</Text>
                  <View style={[s.legendDot, { backgroundColor: '#ef4444' }]} />
                  <Text style={[s.legendLabel, { color: colors.grey }]}>Pending</Text>
                </View>
                <BarChart
                  data={filteredSummary.byMonth.map(m => ({
                    label: m.month,
                    confirmedCents: m.confirmedCents,
                    pendingCents: m.pendingCents,
                  }))}
                  colors={colors}
                />
              </View>
            )}

            {/* Source filter */}
            {Object.keys(sourceCounts).length > 2 && (
              <View style={s.filterSection}>
                <SectionHeading label="Source" colors={colors} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
                  {(['all', 'enquiry', 'venue_created', 'artist_added'] as const).map(src => {
                    const n = sourceCounts[src];
                    if (n === undefined && src !== 'all') return null;
                    const label = src === 'all' ? 'All'
                      : src === 'enquiry' ? 'Twaylo booking'
                      : src === 'venue_created' ? 'Venue added' : 'Added by me';
                    const active = filterSource === src;
                    return (
                      <TouchableOpacity
                        key={src}
                        style={[s.filterPill, active && s.filterPillActive, { borderColor: colors.border }]}
                        onPress={() => setFilterSource(src)}
                        activeOpacity={0.75}
                      >
                        <Text style={[s.filterText, { color: active ? '#fff' : colors.grey }]}>
                          {label} {n != null ? `(${n})` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Fee type filter */}
            {Object.keys(feeTypeCounts).length > 2 && (
              <View style={s.filterSection}>
                <SectionHeading label="Fee type" colors={colors} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
                  {Object.entries(feeTypeCounts).map(([ft, n]) => {
                    const active = filterFeeType === ft;
                    const label  = ft === 'all' ? 'All' : ft.replace(/_/g, ' ');
                    return (
                      <TouchableOpacity
                        key={ft}
                        style={[s.filterPill, active && s.filterPillActive, { borderColor: colors.border }]}
                        onPress={() => setFilterFeeType(ft)}
                        activeOpacity={0.75}
                      >
                        <Text style={[s.filterText, { color: active ? '#fff' : colors.grey }]}>
                          {label} ({n})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Gig table */}
            {filteredGigs.length > 0 && (
              <View style={s.tableSection}>
                <SectionHeading label={`Gigs (${filteredGigs.length})`} colors={colors} />
                {/* Table header */}
                <View style={[tr.row, { borderBottomColor: colors.border }]}>
                  <View style={tr.dateCol}>
                    <Text style={[tr.date, { color: colors.greyLight, fontWeight: '700' }]}>Date</Text>
                  </View>
                  <View style={tr.nameCol}>
                    <Text style={[tr.date, { color: colors.greyLight, fontWeight: '700' }]}>
                      {activeRole === 'artist' ? 'Venue' : 'Artist'}
                    </Text>
                  </View>
                  <View style={tr.feeCol}>
                    <Text style={[tr.date, { color: colors.greyLight, fontWeight: '700' }]}>Planned</Text>
                  </View>
                  <View style={tr.actualCol}>
                    <Text style={[tr.date, { color: colors.greyLight, fontWeight: '700' }]}>Actual</Text>
                  </View>
                </View>
                {filteredGigs.map((gig, i) => (
                  <GigTableRow key={(gig as any).id ?? i} gig={gig} role={activeRole} colors={colors} />
                ))}
              </View>
            )}

            {filteredGigs.length === 0 && !loading && (
              <Text style={[s.empty, { color: colors.greyLight }]}>
                No gigs in this period.
              </Text>
            )}

            {/* Export buttons */}
            <View style={s.exportRow}>
              <TouchableOpacity
                style={[s.exportBtn, { borderColor: colors.border }, exporting && { opacity: 0.5 }]}
                onPress={handleExportPdf}
                disabled={exporting}
                activeOpacity={0.8}
              >
                <Text style={[s.exportBtnText, { color: colors.black }]}>
                  {exporting ? 'Exporting\u2026' : 'Export PDF'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.exportBtn, { borderColor: colors.border }, exporting && { opacity: 0.5 }]}
                onPress={handleExportCsv}
                disabled={exporting}
                activeOpacity={0.8}
              >
                <Text style={[s.exportBtnText, { color: colors.black }]}>
                  {exporting ? 'Exporting\u2026' : 'Export CSV'}
                </Text>
              </TouchableOpacity>
            </View>
            {exportErr ? <Text style={s.error}>{exportErr}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Standalone screen wrapper ─────────────────────────────────────────────────

export default function DashboardScreen() {
  const router        = useRouter();
  const { colors }    = useTheme();
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={[s.backText, { color: colors.black }]}>{'\u2190'} Back</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.black }]}>Dashboard</Text>
        <View style={s.headerSpacer} />
      </View>
      <DashboardContent />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:           { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn:        { paddingRight: 12 },
  backText:       { fontSize: 15 },
  title:          { flex: 1, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  headerSpacer:   { width: 48 },
  scroll:         { padding: 16, paddingBottom: 60 },
  presetRow:      { flexDirection: 'row', gap: 8, marginBottom: 16 },
  presetPill:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  presetPillActive: { backgroundColor: '#111', borderColor: '#111' },
  presetText:     { fontSize: 13, fontWeight: '600' },
  customRange:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, borderWidth: 1, borderRadius: 10, padding: 10 },
  rangeSep:       { fontSize: 13 },
  dateInput:      { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  customErr:      { fontSize: 12, color: '#ef4444', marginTop: 4 },
  centre:         { alignItems: 'center', paddingVertical: 40 },
  error:          { fontSize: 13, color: '#ef4444', marginBottom: 12 },
  sectionHeading: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  chartSection:   { marginBottom: 24 },
  chartLegend:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  legendDot:      { width: 10, height: 10, borderRadius: 5 },
  legendLabel:    { fontSize: 11, marginRight: 10 },
  filterSection:  { marginBottom: 16 },
  filterRow:      { flexDirection: 'row', gap: 8 },
  filterPill:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  filterPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:     { fontSize: 12, fontWeight: '600' },
  tableSection:   { marginBottom: 24 },
  empty:          { textAlign: 'center', paddingVertical: 32, fontSize: 14 },
  exportRow:      { flexDirection: 'row', gap: 10, marginTop: 8 },
  exportBtn:      { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  exportBtnText:  { fontSize: 14, fontWeight: '600' },
});
