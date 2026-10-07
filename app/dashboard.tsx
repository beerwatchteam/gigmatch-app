/**
 * Money dashboard.
 * Artists: "Earnings" — received, owed, booked ahead.
 * Venues:  "Gig spend" — paid, to pay, committed.
 *
 * Layout: Header | Period pills | 4 KPI cards | Chart + Side panel | Gig table
 * Detail panel: right drawer on web, full-screen Modal on native.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, ScrollView, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, StyleSheet, Platform, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import Svg, {
  Defs, Pattern, Rect as SvgRect, Line as SvgLine,
  Text as SvgText, G,
} from 'react-native-svg';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase/firestore';
import app from '@/lib/firebase';
import { toZonedTime } from 'date-fns-tz';

import { PERIOD_PRESETS, getDashboardGigs, type Period } from '@/lib/dashboard';
import { paymentStatus, type PaymentDisplayStatus } from '@/lib/payment-status';
import { buildPdfHtml, buildCsv } from '@/lib/dashboard-export';
import { summarizeGigs } from '@/lib/dashboard';
import type { Gig, FeeType } from '@/lib/gig-types';
import { dollarsToCents } from '@/lib/gig-types';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const isWeb = Platform.OS === 'web';
const functions = getFunctions(app, 'australia-southeast1');

// ── Design tokens ─────────────────────────────────────────────────────────────

const D = {
  paid:    '#16161A',
  owed:    '#D9692A',
  text:    '#16161A',
  muted:   '#6B6A66',
  border:  '#E7E6E3',
  borderFaint: '#EFEEEB',
  bg:      '#FFFFFF',
  bgPage:  '#FAFAF9',
  chip: {
    paid:     { bg: '#E8F3EC', fg: '#22603A', bd: '#E8F3EC' },
    due:      { bg: '#F1F0ED', fg: '#3A3936', bd: '#F1F0ED' },
    overdue:  { bg: '#FBEDE3', fg: '#9A3B06', bd: '#FBEDE3' },
    upcoming: { bg: '#FFFFFF', fg: '#4A4945', bd: '#E2E1DD' },
  },
  primary: '#B84A06',
};

// ── Role labels ───────────────────────────────────────────────────────────────

const LABELS = {
  artist: {
    title: 'Earnings',
    sub:   'What you have been paid, what you are owed, and what is booked.',
    who:   'Venue',
    paid:  'Received',
    owed:  'Owed to you',
    ahead: 'Booked ahead',
    avg:   'Average per gig',
    actualCol: 'Received',
    markPaid:  'Mark as received',
    message:   'Message venue',
    amountLabel: 'Amount received',
    invoiceAction: 'Attach invoice',
    enterAmount: 'Enter amount',
    upcomingNote: 'You can record payment once the gig has been played.',
    variableNote: 'This was a split, so enter what you actually took home.',
    filterOwed: 'Owed',
    filterPaid: 'Received',
  },
  venue: {
    title: 'Gig spend',
    sub:   'What you have paid acts, what you owe, and what is committed.',
    who:   'Act',
    paid:  'Paid',
    owed:  'To pay',
    ahead: 'Committed',
    avg:   'Average per act',
    actualCol: 'Paid',
    markPaid:  'Mark as paid',
    message:   'Message act',
    amountLabel: 'Amount paid',
    invoiceAction: 'View invoice',
    enterAmount: 'Record payment',
    upcomingNote: 'You can record payment once the gig has been played.',
    variableNote: 'This was a split, so enter what you actually paid the act.',
    filterOwed: 'To pay',
    filterPaid: 'Paid',
  },
};

// ── Period config ─────────────────────────────────────────────────────────────

const PERIOD_KEYS = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy'] as const;
const PERIOD_LABEL: Record<string, string> = {
  this_month: 'This month', last_month: 'Last month',
  this_quarter: 'This quarter', this_fy: 'This financial year',
  last_fy: 'Last financial year',
};

function rangeLabel(period: Period): string {
  const fmt = (ts: Timestamp) =>
    ts.toDate().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  // end is exclusive (first day of next period) so subtract 1 day
  const endDate = new Date(period.end.toDate().getTime() - 86_400_000);
  return `${fmt(period.start)} \u2013 ${endDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** FY start year from a period start date. Australian FY = Jul–Jun. */
function fyStartYear(periodStart: Date): number {
  const y = periodStart.getFullYear();
  return periodStart.getMonth() >= 6 ? y : y - 1;
}

/** Full-year Period for a given FY start year. */
function fyPeriodFor(fyStart: number): Period {
  const label = `FY${String(fyStart + 1).slice(2)}`;
  return {
    start: Timestamp.fromDate(new Date(fyStart,     6, 1, 0, 0, 0)),
    end:   Timestamp.fromDate(new Date(fyStart + 1, 6, 1, 0, 0, 0)),
    label,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAud(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return `$${(d / 1000).toFixed(d % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(d)}`;
}

function fmtAud(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-AU')}`;
}

const MON = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];

function gigLocalDate(gig: Gig): Date {
  return toZonedTime(gig.startAt.toDate(), gig.timezone ?? 'Australia/Melbourne');
}

function dateShort(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function dateLong(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const SPLIT_TYPES: FeeType[] = ['door_split', 'ticket_split', 'bar_split'];

function isSplitType(t: FeeType) { return SPLIT_TYPES.includes(t); }

function modelLabel(feeType: FeeType): string {
  switch (feeType) {
    case 'flat':              return 'Flat fee';
    case 'door_split':        return 'Door split';
    case 'ticket_split':      return 'Ticket split';
    case 'bar_split':         return 'Bar split';
    case 'guarantee_vs_door': return 'Guarantee + split';
    case 'unpaid':            return 'Unpaid';
    case 'other':             return 'Other';
    default:                  return 'Other';
  }
}

function agreedCents(gig: Gig): number | null {
  // For flat / guarantee: the fixed amount; for pure splits: null
  const ft = gig.fee.type;
  if (ft === 'flat' || ft === 'other') return gig.fee.amountCents;
  if (ft === 'guarantee_vs_door') return gig.fee.amountCents;
  return null;
}

function agreedLabel(gig: Gig): string {
  const ft = gig.fee.type;
  if (ft === 'unpaid') return '';
  const a = agreedCents(gig);
  if (a == null) return 'Split';
  if (ft === 'guarantee_vs_door') return `${fmtAud(a)} +`;
  return fmtAud(a);
}

function dealSub(gig: Gig): string {
  if (gig.terms?.splitTerms) return gig.terms.splitTerms;
  return gig.terms?.timing ?? gig.fee.notes ?? '';
}

function chipConfig(st: PaymentDisplayStatus, daysOverdue: number | null, dueDate: string | null, L: typeof LABELS['artist']) {
  switch (st) {
    case 'paid':
    case 'self_reported':
      return { ...D.chip.paid, label: L.paid };
    case 'upcoming':
      return { ...D.chip.upcoming, label: 'Upcoming' };
    case 'overdue':
      return { ...D.chip.overdue, label: `Overdue ${daysOverdue ?? 0} ${(daysOverdue ?? 0) === 1 ? 'day' : 'days'}` };
    case 'needsAmount':
      return { ...D.chip.overdue, label: L.enterAmount };
    case 'awaiting':
      return { ...D.chip.due, label: 'Awaiting payment' };
    default: { // due
      if (!dueDate) return { ...D.chip.due, label: 'Due' };
      const today = new Date().toISOString().slice(0, 10);
      if (dueDate === today) return { ...D.chip.due, label: 'Due today' };
      const d = new Date(dueDate + 'T12:00:00Z');
      return { ...D.chip.due, label: `Due ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` };
    }
  }
}

function invoiceLabel(gig: Gig): string {
  const inv = gig.payment?.invoice;
  if (!inv || inv.status === 'notNeeded') return 'Not needed';
  if (inv.status === 'notSent') return 'Not sent yet';
  if (inv.status === 'sent') return `Sent${inv.sentAt ? ' ' + inv.sentAt.toDate().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}`;
  if (inv.status === 'received') return 'Received';
  return '';
}

function invoiceDone(gig: Gig): boolean {
  const s = gig.payment?.invoice?.status;
  return s === 'notNeeded' || s === 'sent' || s === 'received';
}

// ── KPI computation ───────────────────────────────────────────────────────────

type GigWithStatus = {
  gig: Gig;
  st: ReturnType<typeof paymentStatus>;
  localDate: Date;
};

function enrichGigs(gigs: Gig[], today: Date): GigWithStatus[] {
  return gigs.map(gig => ({
    gig,
    st: paymentStatus(gig, today),
    localDate: gigLocalDate(gig),
  }));
}

type KpiData = {
  paidCents:    number;
  paidCount:    number;
  owedCents:    number;
  overdueCount: number;
  needsCount:   number;
  aheadCents:   number;
  aheadCount:   number;
  hasVariableAhead: boolean;
};

function computeKpis(enriched: GigWithStatus[]): KpiData {
  let paidCents = 0, paidCount = 0, owedCents = 0;
  let overdueCount = 0, needsCount = 0;
  let aheadCents = 0, aheadCount = 0, hasVariableAhead = false;

  for (const { gig, st } of enriched) {
    if (st.status === 'not_applicable') continue;
    if (st.status === 'paid' || st.status === 'self_reported') {
      paidCents += gig.payment.confirmedAmountCents ?? 0;
      paidCount++;
    } else if (st.status === 'overdue') {
      owedCents += agreedCents(gig) ?? 0;
      overdueCount++;
    } else if (st.status === 'due' || st.status === 'awaiting') {
      owedCents += agreedCents(gig) ?? 0;
    } else if (st.status === 'needsAmount') {
      needsCount++;
      // Don't know the amount; excluded from owedCents
    } else if (st.status === 'upcoming') {
      const a = agreedCents(gig);
      aheadCents += a ?? 0;
      aheadCount++;
      if (a == null || isSplitType(gig.fee.type)) hasVariableAhead = true;
    }
  }

  return { paidCents, paidCount, owedCents, overdueCount, needsCount, aheadCents, aheadCount, hasVariableAhead };
}

// ── Chart data ────────────────────────────────────────────────────────────────

type MonthBar = {
  label: string;    // 'Jul', 'Aug', etc.
  paidCents:    number;
  owedCents:    number;
  aheadCents:   number;
  inPeriod:     boolean;  // opacity 1 vs 0.35
  isNow:        boolean;  // bold label
};

function computeChartData(fyGigs: GigWithStatus[], fyStart: number, period: Period): MonthBar[] {
  const pStart = period.start.toDate().getTime();
  const pEnd   = period.end.toDate().getTime();

  const bars: MonthBar[] = [];
  for (let i = 0; i < 12; i++) {
    const absMonth = 6 + i; // 6=Jul in 0-indexed, wraps via Math
    const year  = fyStart + Math.floor(absMonth / 12);
    const month = absMonth % 12; // 0-indexed month
    const key   = `${year}-${String(month + 1).padStart(2, '0')}`;

    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd   = new Date(year, month + 1, 1).getTime();
    const inPeriod   = monthEnd > pStart && monthStart < pEnd;
    const now        = new Date();
    const isNow      = now.getFullYear() === year && now.getMonth() === month;

    let paidCents = 0, owedCents = 0, aheadCents = 0;
    for (const { gig, st, localDate } of fyGigs) {
      const gMonth = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}`;
      if (gMonth !== key) continue;
      if (st.status === 'paid' || st.status === 'self_reported') {
        paidCents += gig.payment.confirmedAmountCents ?? 0;
      } else if (st.status === 'overdue' || st.status === 'due' || st.status === 'awaiting') {
        owedCents += agreedCents(gig) ?? 0;
      } else if (st.status === 'upcoming') {
        aheadCents += agreedCents(gig) ?? 0;
      }
    }

    bars.push({ label: MON[i], paidCents, owedCents, aheadCents, inPeriod, isNow });
  }
  return bars;
}

// ── Needs attention ───────────────────────────────────────────────────────────

type AttentionItem = {
  gigId: string;
  dot:   string;
  title: string;
  sub:   string;
  action: string;
};

function computeAttention(enriched: GigWithStatus[], role: 'artist' | 'venue'): AttentionItem[] {
  const L = LABELS[role];
  const items: AttentionItem[] = [];

  // Overdue first
  for (const { gig, st } of enriched) {
    if (st.status !== 'overdue') continue;
    const dueDate = st.dueDate ? new Date(st.dueDate + 'T12:00:00Z') : null;
    items.push({
      gigId:  gig.id,
      dot:    D.chip.overdue.fg,
      title:  `${role === 'artist' ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist')} \u00b7 ${fmtAud(agreedCents(gig) ?? 0)}`,
      sub:    `${role === 'venue' ? 'You owe this act, overdue since ' : 'Overdue since '}${dueDate ? dateShort(dueDate) : ''}`,
      action: role === 'artist' ? 'Follow up' : 'Pay now',
    });
  }

  // Needs amount (splits with no confirmed amount)
  for (const { gig, st } of enriched) {
    if (st.status !== 'needsAmount') continue;
    items.push({
      gigId:  gig.id,
      dot:    D.chip.overdue.fg,
      title:  `${role === 'artist' ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist')} \u00b7 ${dateShort(gigLocalDate(gig))}`,
      sub:    `${modelLabel(gig.fee.type)}: ${role === 'artist' ? 'how much did you take home?' : 'record what you paid'}`,
      action: L.enterAmount,
    });
  }

  // Due soon (due, not overdue)
  for (const { gig, st } of enriched) {
    if (st.status !== 'due') continue;
    const dueDate = st.dueDate ? new Date(st.dueDate + 'T12:00:00Z') : null;
    items.push({
      gigId:  gig.id,
      dot:    D.muted,
      title:  `${role === 'artist' ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist')} \u00b7 ${fmtAud(agreedCents(gig) ?? 0)}`,
      sub:    `Due ${dueDate ? dateShort(dueDate) : ''}`,
      action: role === 'artist' ? 'View' : 'Mark paid',
    });
  }

  return items;
}

// ── Spend by night (venue) ────────────────────────────────────────────────────

type NightEntry = {
  name:  string;
  total: number;   // cents
  count: number;
};

function computeByNight(enriched: GigWithStatus[]): NightEntry[] {
  const map = new Map<string, NightEntry>();
  for (const { gig, st } of enriched) {
    if (st.status === 'upcoming' || st.status === 'not_applicable') continue;
    const slot = gig.room ?? (gig.terms ? 'Band room' : 'Gig');
    if (!map.has(slot)) map.set(slot, { name: slot, total: 0, count: 0 });
    const e = map.get(slot)!;
    if (st.status === 'paid' || st.status === 'self_reported') {
      e.total += gig.payment.confirmedAmountCents ?? 0;
    } else {
      e.total += agreedCents(gig) ?? 0;
    }
    e.count++;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// ── FY chart ──────────────────────────────────────────────────────────────────

function FyChart({ bars, fyStart, L }: { bars: MonthBar[]; fyStart: number; L: typeof LABELS['artist'] }) {
  const { width } = useWindowDimensions();
  const chartAreaW = Math.min(width - 80, 560);
  const H = 180;
  const AXIS_W = 44;
  const totalW = chartAreaW + AXIS_W;

  const max = Math.max(1, ...bars.map(b => b.paidCents + b.owedCents + b.aheadCents));
  const step = max > 200_000 ? 100_000 : max > 100_000 ? 50_000 : max > 40_000 ? 20_000 : max > 20_000 ? 10_000 : max > 8_000 ? 4_000 : 2_000;
  const top  = Math.ceil(max / step) * step;

  const barW = Math.max(6, Math.floor((chartAreaW - bars.length * 4) / bars.length));

  const gridLines = [0, 0.5, 1].map(f => ({
    y: Math.round(f * H),
    label: shortAud(top * f),
  }));

  return (
    <Svg width={totalW} height={H + 36}>
      <Defs>
        <Pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <SvgRect width="3" height="6" fill="#C9C8C3" />
          <SvgRect x="3" width="3" height="6" fill="#F1F0ED" />
        </Pattern>
      </Defs>

      {/* Y-axis gridlines */}
      {gridLines.map((g, i) => (
        <G key={i}>
          <SvgLine
            x1={AXIS_W} y1={H - g.y} x2={totalW} y2={H - g.y}
            stroke="#F1F0ED" strokeWidth={1}
          />
          <SvgText x={AXIS_W - 4} y={H - g.y + 4} textAnchor="end" fontSize={10} fill={D.muted}>
            {g.label}
          </SvgText>
        </G>
      ))}

      {/* Bars */}
      {bars.map((bar, i) => {
        const x     = AXIS_W + i * (barW + 4) + 2;
        const pH    = Math.round((bar.paidCents / top) * H);
        const oH    = Math.round((bar.owedCents / top) * H);
        const uH    = Math.round((bar.aheadCents / top) * H);
        const total = bar.paidCents + bar.owedCents + bar.aheadCents;
        const totalH = pH + oH + uH;
        const op    = bar.inPeriod ? 1 : 0.35;

        // Rounded top corners only on topmost segment
        const topSeg = uH > 0 ? 'u' : oH > 0 ? 'o' : 'p';

        return (
          <G key={i} opacity={op}>
            {/* Total label */}
            {total > 0 && (
              <SvgText
                x={x + barW / 2} y={H - totalH - 4}
                textAnchor="middle" fontSize={10} fill={D.text}
              >
                {shortAud(total)}
              </SvgText>
            )}
            {/* Upcoming / committed (hatched) */}
            {uH > 0 && (
              <SvgRect
                x={x} y={H - pH - oH - uH} width={barW} height={uH}
                fill="url(#hatch)" rx={topSeg === 'u' ? 3 : 0}
              />
            )}
            {/* Owed (orange) */}
            {oH > 0 && (
              <SvgRect
                x={x} y={H - pH - oH} width={barW} height={oH}
                fill={D.owed} rx={topSeg === 'o' ? 3 : 0}
              />
            )}
            {/* Paid (dark) */}
            {pH > 0 && (
              <SvgRect
                x={x} y={H - pH} width={barW} height={pH}
                fill={D.paid} rx={topSeg === 'p' ? 3 : 0}
              />
            )}
            {/* Month label */}
            <SvgText
              x={x + barW / 2} y={H + 16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={bar.isNow ? '700' : '400'}
              fill={bar.isNow ? D.text : D.muted}
            >
              {bar.label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ config }: { config: { bg: string; fg: string; bd: string; label: string } }) {
  return (
    <View style={[chip.wrap, { backgroundColor: config.bg, borderColor: config.bd }]}>
      <Text style={[chip.text, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}
const chip = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '500' },
});

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  gig,
  role,
  onClose,
  onRecorded,
}: {
  gig: Gig;
  role: 'artist' | 'venue';
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const L = LABELS[role];
  const today = new Date();
  const st = paymentStatus(gig, today);
  const localDate = gigLocalDate(gig);
  const chipCfg = chipConfig(st.status, st.daysOverdue, st.dueDate, L);

  const counterparty = role === 'artist'
    ? (gig.venueName ?? 'Venue')
    : (gig.artistName ?? gig.bandName ?? 'Artist');
  const location = role === 'artist'
    ? (gig.terms ? (gig.room ?? '') : '')
    : `${gig.room ?? ''} · Band room`.replace(/^ · /, '');

  const [amtInput,    setAmtInput]    = useState(() => {
    const a = agreedCents(gig);
    return a != null && !isSplitType(gig.fee.type) ? String(a / 100) : '';
  });
  const [dateInput,   setDateInput]   = useState(today.toISOString().slice(0, 10));
  const [methodInput, setMethodInput] = useState(gig.terms?.methods?.[0] ?? '');
  const [saving,      setSaving]      = useState(false);
  const [saveErr,     setSaveErr]     = useState('');

  const canRecord = ['due', 'overdue', 'needsAmount', 'awaiting'].includes(st.status);
  const isPaid    = st.status === 'paid' || st.status === 'self_reported';
  const isUpcoming = st.status === 'upcoming';

  const isSplit = isSplitType(gig.fee.type);

  // Timeline steps
  const invDone = invoiceDone(gig);
  const finalStepDone = isPaid;
  const finalStepNow  = canRecord;
  const finalSub = isPaid
    ? `${role === 'artist' ? 'Received ' : 'Paid '}${gig.payment.confirmedAt ? dateLong(gig.payment.confirmedAt.toDate()) : ''}`
    : st.status === 'overdue'
    ? `Was due ${st.dueDate ? dateLong(new Date(st.dueDate + 'T12:00:00Z')) : ''}`
    : st.status === 'upcoming'
    ? `Due ${st.dueDate ? dateLong(new Date(st.dueDate + 'T12:00:00Z')) : 'on the night'}`
    : st.status === 'needsAmount'
    ? 'Amount not recorded'
    : st.dueDate ? `Due ${dateLong(new Date(st.dueDate + 'T12:00:00Z'))}` : 'Awaiting payment';

  const steps = [
    { label: 'Booked', sub: gig.room ?? 'Headline', done: true, now: false },
    { label: 'Played', sub: dateLong(localDate), done: st.status !== 'upcoming', now: st.status === 'upcoming' },
    { label: 'Invoice', sub: invoiceLabel(gig), done: invDone, now: false },
    { label: role === 'artist' ? 'Received' : 'Paid', sub: finalSub, done: finalStepDone, now: finalStepNow },
  ];

  // Deal section
  const dueLabel = (() => {
    if (!gig.terms) return '—';
    if (gig.terms.timing === 'On the night') return 'On the night';
    if (gig.terms.timing === 'Before the gig') return 'Before the gig';
    if (st.dueDate) return dateLong(new Date(st.dueDate + 'T12:00:00Z'));
    return gig.terms.timing;
  })();

  async function handleRecord() {
    const cents = dollarsToCents(amtInput);
    if (!cents || cents <= 0) { setSaveErr('Enter a valid amount.'); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const fn = httpsCallable(functions, 'confirmPayment');
      await fn({ gigId: gig.id, amountCents: cents });
      onRecorded();
      onClose();
    } catch (e: any) {
      setSaveErr(e.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const inner = (
    <View style={dp.inner}>
      {/* Header */}
      <View style={[dp.hdr, { borderBottomColor: D.borderFaint }]}>
        <View style={{ flex: 1 }}>
          <Text style={dp.who}>{counterparty}</Text>
          <Text style={[dp.dateLine, { color: D.muted }]}>{dateLong(localDate)}{location ? ` \u00b7 ${location}` : ''}</Text>
          <View style={{ marginTop: 10 }}>
            <StatusChip config={chipCfg} />
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={dp.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 20, color: D.text }}>\u00d7</Text>
        </TouchableOpacity>
      </View>

      {/* Timeline */}
      <View style={[dp.section, { borderBottomColor: D.borderFaint }]}>
        {steps.map((s, i) => (
          <View key={i} style={dp.stepRow}>
            <View style={dp.stepLeft}>
              <View style={[
                dp.dot,
                s.done ? { backgroundColor: D.text, borderColor: D.text } : { backgroundColor: D.bg, borderColor: s.now ? D.text : '#D6D5D0' },
              ]} />
              {i < steps.length - 1 && <View style={dp.stepLine} />}
            </View>
            <View style={{ paddingBottom: 14 }}>
              <Text style={[dp.stepLabel, { color: s.done || s.now ? D.text : D.muted }]}>{s.label}</Text>
              <Text style={[dp.stepSub, { color: D.muted }]}>{s.sub}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* The deal */}
      <View style={[dp.section, { borderBottomColor: D.borderFaint }]}>
        <View style={dp.dealHdr}>
          <Text style={dp.sectionTitle}>The deal</Text>
          <Text style={[dp.locked, { color: D.muted }]}>Locked when confirmed</Text>
        </View>
        <View style={dp.dealGrid}>
          {[
            ['Payment model', modelLabel(gig.fee.type)],
            ['Agreed', gig.terms?.splitTerms ?? (agreedCents(gig) != null ? fmtAud(agreedCents(gig)!) : '—')],
            ['Paid', gig.terms?.timing ?? '—'],
            ['Due', dueLabel],
            ['Method', gig.terms?.methods?.join(', ') ?? '—'],
            ['Slot', gig.room ?? '—'],
          ].map(([label, val]) => (
            <View key={label} style={dp.dealCell}>
              <Text style={[dp.dealLabel, { color: D.muted }]}>{label}</Text>
              <Text style={dp.dealVal}>{val}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Payment */}
      <View style={dp.section}>
        <Text style={dp.sectionTitle}>Payment</Text>

        {isPaid && (
          <View style={[dp.paidBox, { backgroundColor: D.chip.paid.bg }]}>
            <Text style={[dp.paidAmt, { color: D.chip.paid.fg }]}>
              {fmtAud(gig.payment.confirmedAmountCents ?? 0)}
            </Text>
            <Text style={[dp.paidLine, { color: D.chip.paid.fg }]}>
              {role === 'artist' ? 'Received' : 'Paid'}
              {gig.payment.confirmedAt ? ` ${dateLong(gig.payment.confirmedAt.toDate())}` : ''}
            </Text>
          </View>
        )}

        {isUpcoming && (
          <View style={[dp.upcomingBox]}>
            <Text style={[{ color: D.muted, fontSize: 13 }]}>{L.upcomingNote}</Text>
          </View>
        )}

        {canRecord && (
          <>
            <View style={dp.formRow}>
              <View style={{ flex: 1 }}>
                <Text style={dp.formLabel}>{L.amountLabel}</Text>
                <View style={[dp.amountWrap, { borderColor: '#D6D5D0' }]}>
                  <Text style={{ color: D.muted, paddingHorizontal: 10 }}>$</Text>
                  <TextInput
                    value={amtInput}
                    onChangeText={setAmtInput}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    style={dp.amountInput}
                    placeholderTextColor={D.muted}
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={dp.formLabel}>Date</Text>
                {isWeb ? (
                  <input
                    type="date"
                    value={dateInput}
                    onChange={e => setDateInput(e.target.value)}
                    style={{ height: 40, padding: '0 10px', border: '1px solid #D6D5D0', borderRadius: 8, fontSize: 14, color: D.text } as any}
                  />
                ) : (
                  <TextInput
                    value={dateInput}
                    onChangeText={setDateInput}
                    placeholder="YYYY-MM-DD"
                    keyboardType="numeric"
                    style={[dp.amountWrap, { borderColor: '#D6D5D0', paddingHorizontal: 10 }]}
                    placeholderTextColor={D.muted}
                  />
                )}
              </View>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text style={dp.formLabel}>Method</Text>
              {isWeb ? (
                <select
                  value={methodInput}
                  onChange={e => setMethodInput(e.target.value)}
                  style={{ height: 40, padding: '0 10px', border: '1px solid #D6D5D0', borderRadius: 8, fontSize: 14, color: D.text, backgroundColor: D.bg, width: '100%' } as any}
                >
                  {(gig.terms?.methods?.length ? gig.terms.methods : ['Bank transfer', 'Cash', 'PayPal', 'Stripe']).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              ) : (
                <TextInput
                  value={methodInput}
                  onChangeText={setMethodInput}
                  placeholder="e.g. Bank transfer"
                  style={[dp.amountWrap, { borderColor: '#D6D5D0', paddingHorizontal: 10 }]}
                  placeholderTextColor={D.muted}
                />
              )}
            </View>

            {isSplit && (
              <Text style={{ fontSize: 12, color: D.muted, marginBottom: 12 }}>{L.variableNote}</Text>
            )}

            {saveErr ? <Text style={{ color: D.chip.overdue.fg, fontSize: 13, marginBottom: 8 }}>{saveErr}</Text> : null}

            <View style={dp.actionRow}>
              <TouchableOpacity
                style={[dp.primaryBtn, saving && { opacity: 0.6 }]}
                onPress={handleRecord}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={dp.primaryBtnText}>{L.markPaid}</Text>
                }
              </TouchableOpacity>
              {gig.enquiryId && (
                <TouchableOpacity
                  style={dp.secondaryBtn}
                  onPress={() => { onClose(); router.push({ pathname: '/(tabs)/inbox' } as any); }}
                  activeOpacity={0.8}
                >
                  <Text style={dp.secondaryBtnText}>{L.message}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Invoice row */}
        <View style={[dp.invoiceRow, { borderTopColor: D.borderFaint }]}>
          <View>
            <Text style={[dp.dealLabel, { color: D.muted }]}>Invoice</Text>
            <Text style={dp.dealVal}>{invoiceLabel(gig)}</Text>
          </View>
          <TouchableOpacity style={dp.invoiceBtn} activeOpacity={0.8}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: D.text }}>{L.invoiceAction}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (isWeb) {
    return (
      <>
        {/* Backdrop */}
        <TouchableOpacity
          style={dp.backdrop as any}
          onPress={onClose}
          activeOpacity={1}
        />
        <View style={dp.drawer as any}>
          <ScrollView showsVerticalScrollIndicator={false}>{inner}</ScrollView>
        </View>
      </>
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: D.bg }} edges={['top', 'bottom']}>
        <ScrollView showsVerticalScrollIndicator={false}>{inner}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const dp = StyleSheet.create({
  backdrop:       { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,22,26,0.32)', zIndex: 20 } as any,
  drawer:         { position: 'fixed' as any, top: 0, right: 0, bottom: 0, width: 440, backgroundColor: D.bg, zIndex: 21, shadowColor: '#000', shadowOffset: { width: -4, height: 0 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 } as any,
  inner:          { flex: 1 },
  hdr:            { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 20, borderBottomWidth: 1 },
  who:            { fontSize: 18, fontWeight: '600', color: D.text },
  dateLine:       { fontSize: 13, marginTop: 2 },
  closeBtn:       { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  section:        { padding: 20, borderBottomWidth: 1 },
  sectionTitle:   { fontSize: 14, fontWeight: '600', color: D.text, marginBottom: 12 },
  dealHdr:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  locked:         { fontSize: 12 },
  dealGrid:       { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 16 },
  dealCell:       { width: '47%', gap: 2 } as any,
  dealLabel:      { fontSize: 12 },
  dealVal:        { fontSize: 14, color: D.text },
  stepRow:        { flexDirection: 'row', gap: 12 },
  stepLeft:       { alignItems: 'center', width: 14 },
  dot:            { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 2 },
  stepLine:       { flex: 1, width: 2, backgroundColor: D.borderFaint, minHeight: 16 },
  stepLabel:      { fontSize: 14, fontWeight: '500' },
  stepSub:        { fontSize: 12, marginTop: 1 },
  paidBox:        { borderRadius: 10, padding: 14, marginBottom: 12 },
  paidAmt:        { fontSize: 20, fontWeight: '700' },
  paidLine:       { fontSize: 13, marginTop: 2 },
  upcomingBox:    { borderRadius: 10, padding: 14, backgroundColor: '#F7F6F4', marginBottom: 12 },
  formRow:        { flexDirection: 'row', gap: 12, marginBottom: 12 },
  formLabel:      { fontSize: 13, color: D.muted, marginBottom: 6 },
  amountWrap:     { flexDirection: 'row', alignItems: 'center', height: 40, borderWidth: 1, borderRadius: 8, backgroundColor: D.bg },
  amountInput:    { flex: 1, fontSize: 15, color: D.text, paddingRight: 10 },
  actionRow:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  primaryBtn:     { height: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: D.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondaryBtn:   { height: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: D.border, backgroundColor: D.bg, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '500', color: D.text },
  invoiceRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 4, borderTopWidth: 1 },
  invoiceBtn:     { height: 32, paddingHorizontal: 12, borderWidth: 1, borderColor: D.border, borderRadius: 8, backgroundColor: D.bg, alignItems: 'center', justifyContent: 'center' },
});

// ── Main dashboard content ────────────────────────────────────────────────────

export function DashboardContent() {
  const { user, profile } = useAuth();
  const { colors }        = useTheme();
  const { width }         = useWindowDimensions();
  const isWide            = width >= 900 && isWeb;

  const isVenue  = profile?.type === 'venue';
  const role     = isVenue ? 'venue' : 'artist';
  const L        = LABELS[role];

  const today = useMemo(() => new Date(), []);

  // Period
  const [presetKey, setPresetKey] = useState('this_fy');
  const period = useMemo<Period>(() => (PERIOD_PRESETS[presetKey]?.() ?? PERIOD_PRESETS.this_fy()), [presetKey]);

  // FY period for chart (might differ from selected period)
  const fyPeriod = useMemo(() => {
    const fy = fyStartYear(period.start.toDate());
    return fyPeriodFor(fy);
  }, [period]);

  const fyLabel = fyPeriod.label; // e.g. "FY27"

  // Data loading
  const [fyGigs,      setFyGigs]      = useState<Gig[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const gigs = await getDashboardGigs(user.uid, fyPeriod);
      setFyGigs(gigs);
    } catch {
      setError('Could not load data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, fyPeriod.start.seconds, fyPeriod.end.seconds]);

  useEffect(() => { load(); }, [load]);

  // Enriched gigs (add paymentStatus to each)
  const fyEnriched = useMemo(() => enrichGigs(fyGigs, today), [fyGigs, today]);

  // Period-filtered enriched gigs (for KPIs + table)
  const pStart = period.start.toDate().getTime();
  const pEnd   = period.end.toDate().getTime();
  const periodEnriched = useMemo(
    () => fyEnriched.filter(({ gig }) => {
      const t = gig.startAt.toDate().getTime();
      return t >= pStart && t < pEnd;
    }),
    [fyEnriched, pStart, pEnd],
  );

  const kpis        = useMemo(() => computeKpis(periodEnriched), [periodEnriched]);
  const chartBars   = useMemo(() => computeChartData(fyEnriched, fyStartYear(period.start.toDate()), period), [fyEnriched, period]);
  const attention   = useMemo(() => computeAttention(fyEnriched, role), [fyEnriched, role]);
  const byNight     = useMemo(() => computeByNight(periodEnriched), [periodEnriched]);
  const maxNight    = useMemo(() => Math.max(1, ...byNight.map(n => n.total)), [byNight]);

  // FY confirmed cents for Tax time
  const fyPaidCents = useMemo(
    () => fyEnriched.filter(e => e.st.status === 'paid' || e.st.status === 'self_reported')
      .reduce((s, e) => s + (e.gig.payment.confirmedAmountCents ?? 0), 0),
    [fyEnriched],
  );
  const fyPaidCount = useMemo(
    () => fyEnriched.filter(e => e.st.status === 'paid' || e.st.status === 'self_reported').length,
    [fyEnriched],
  );

  // Table filter
  const [tableFilter, setTableFilter] = useState<'all' | 'paid' | 'owed' | 'upcoming'>('all');
  const tableRows = useMemo(() => {
    return periodEnriched
      .filter(({ st }) => {
        if (tableFilter === 'all') return st.status !== 'not_applicable';
        if (tableFilter === 'paid') return st.status === 'paid' || st.status === 'self_reported';
        if (tableFilter === 'owed') return ['overdue','due','needsAmount','awaiting'].includes(st.status);
        if (tableFilter === 'upcoming') return st.status === 'upcoming';
        return true;
      })
      .sort((a, b) => b.gig.startAt.toDate().getTime() - a.gig.startAt.toDate().getTime());
  }, [periodEnriched, tableFilter]);

  const totalAgreed = useMemo(
    () => tableRows.reduce((s, { gig, st }) => {
      if (['paid','self_reported','overdue','due','awaiting'].includes(st.status)) {
        return s + (agreedCents(gig) ?? 0);
      }
      return s;
    }, 0),
    [tableRows],
  );
  const totalActual = useMemo(
    () => tableRows.filter(({ st }) => st.status === 'paid' || st.status === 'self_reported')
      .reduce((s, { gig }) => s + (gig.payment.confirmedAmountCents ?? 0), 0),
    [tableRows],
  );

  // Detail panel
  const [selectedGigId, setSelectedGigId] = useState<string | null>(null);
  const selectedGig = useMemo(
    () => fyGigs.find(g => g.id === selectedGigId) ?? null,
    [fyGigs, selectedGigId],
  );

  // Export
  const [exportOpen,  setExportOpen]  = useState(false);
  const [exporting,   setExporting]   = useState(false);

  async function handleExportCsv() {
    setExportOpen(false);
    setExporting(true);
    try {
      const csv = buildCsv(periodEnriched.map(e => e.gig), role, period);
      if (isWeb) {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `gigmatch-${period.label}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const FileSystem = require('expo-file-system');
        const path = FileSystem.cacheDirectory + 'gigmatch.csv';
        await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
        await Sharing.shareAsync(path, { mimeType: 'text/csv' });
      }
    } catch {}
    setExporting(false);
  }

  async function handleExportPdf() {
    setExportOpen(false);
    setExporting(true);
    try {
      const summary = summarizeGigs(periodEnriched.map(e => e.gig), role);
      const html = buildPdfHtml(summary, periodEnriched.map(e => e.gig), role, period.label);
      if (isWeb) {
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.print(); }
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch {}
    setExporting(false);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const owedSub = [
    kpis.overdueCount ? `${kpis.overdueCount} overdue` : null,
    kpis.needsCount   ? `${kpis.needsCount} ${kpis.needsCount === 1 ? 'split' : 'splits'} to record` : null,
  ].filter(Boolean).join(' \u00b7 ') || 'Nothing overdue';

  const owedIsUrgent = kpis.overdueCount > 0;

  const kpiCards = [
    { label: L.paid,  value: fmtAud(kpis.paidCents),  sub: `${kpis.paidCount} ${kpis.paidCount === 1 ? 'gig' : 'gigs'} paid`, fg: D.text, subFg: D.muted },
    { label: L.owed,  value: fmtAud(kpis.owedCents),  sub: owedSub,  fg: owedIsUrgent ? D.chip.overdue.fg : D.text, subFg: owedIsUrgent ? D.chip.overdue.fg : D.muted },
    { label: L.ahead, value: fmtAud(kpis.aheadCents), sub: `${kpis.aheadCount} upcoming ${kpis.aheadCount === 1 ? 'gig' : 'gigs'}${kpis.hasVariableAhead ? ' \u00b7 splits at minimum' : ''}`, fg: D.text, subFg: D.muted },
    { label: L.avg,   value: kpis.paidCount ? fmtAud(Math.round(kpis.paidCents / kpis.paidCount)) : '\u2014', sub: 'Across paid gigs', fg: D.text, subFg: D.muted },
  ];

  const chartEmpty = chartBars.every(b => b.paidCents + b.owedCents + b.aheadCents === 0);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bgFaint }}
        contentContainerStyle={db.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Period pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={db.periodRow}>
          {PERIOD_KEYS.map(key => (
            <TouchableOpacity
              key={key}
              style={[db.pill, presetKey === key && db.pillActive, { borderColor: presetKey === key ? D.text : D.border }]}
              onPress={() => setPresetKey(key)}
              activeOpacity={0.75}
            >
              <Text style={[db.pillText, { color: presetKey === key ? '#fff' : D.muted }]}>
                {PERIOD_LABEL[key]}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={[db.rangeLabel, { color: D.muted }]}>{rangeLabel(period)}</Text>
        </ScrollView>

        {loading && (
          <View style={db.centre}><ActivityIndicator color={D.owed} /></View>
        )}
        {error ? <Text style={[db.errorText, { color: '#ef4444' }]}>{error}</Text> : null}

        {!loading && !error && (
          <>
            {/* KPI cards */}
            <View style={[db.kpiRow, isWide && db.kpiRowWide]}>
              {kpiCards.map(k => (
                <View key={k.label} style={[db.kpiCard, { backgroundColor: D.bg, borderColor: D.border }]}>
                  <Text style={[db.kpiLabel, { color: D.muted }]}>{k.label}</Text>
                  <Text style={[db.kpiValue, { color: k.fg }]}>{k.value}</Text>
                  <Text style={[db.kpiSub, { color: k.subFg }]}>{k.sub}</Text>
                </View>
              ))}
            </View>

            {/* Chart + side panel */}
            <View style={[db.body, isWide && db.bodyWide]}>
              {/* Chart */}
              <View style={[db.chartCard, { backgroundColor: D.bg, borderColor: D.border }, isWide && { flex: 2 }]}>
                <View style={db.chartHeader}>
                  <Text style={db.chartTitle}>{fyLabel} by month</Text>
                  <View style={db.legend}>
                    <View style={[db.legendDot, { backgroundColor: D.paid }]} />
                    <Text style={[db.legendLabel, { color: D.muted }]}>{L.paid}</Text>
                    <View style={[db.legendDot, { backgroundColor: D.owed }]} />
                    <Text style={[db.legendLabel, { color: D.muted }]}>{L.owed}</Text>
                    <View style={[db.legendDot, db.hatchDot]} />
                    <Text style={[db.legendLabel, { color: D.muted }]}>{L.ahead}</Text>
                  </View>
                </View>
                {chartEmpty ? (
                  <View style={db.chartEmpty}>
                    <Text style={{ color: D.muted }}>No gigs in this financial year.</Text>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <FyChart bars={chartBars} fyStart={fyStartYear(period.start.toDate())} L={L} />
                  </ScrollView>
                )}
              </View>

              {/* Side panel */}
              <View style={[db.sideCol, isWide && { flex: 1, minWidth: 280 }]}>
                {/* Needs attention */}
                <View style={[db.sideCard, { backgroundColor: D.bg, borderColor: D.border }]}>
                  <View style={db.sideCardHdr}>
                    <Text style={db.sideCardTitle}>Needs attention</Text>
                    {attention.length > 0 && (
                      <Text style={{ fontSize: 13, color: D.muted }}>{attention.length}</Text>
                    )}
                  </View>
                  {attention.length === 0 ? (
                    <Text style={[db.allClear, { color: D.muted }]}>All caught up.</Text>
                  ) : attention.map((item, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[db.attRow, { borderTopColor: D.borderFaint }]}
                      onPress={() => setSelectedGigId(item.gigId)}
                      activeOpacity={0.75}
                    >
                      <View style={[db.attDot, { backgroundColor: item.dot }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={db.attTitle}>{item.title}</Text>
                        <Text style={[db.attSub, { color: D.muted }]}>{item.sub}</Text>
                      </View>
                      <TouchableOpacity
                        style={db.attBtn}
                        onPress={() => setSelectedGigId(item.gigId)}
                        activeOpacity={0.75}
                      >
                        <Text style={db.attBtnText}>{item.action}</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Tax time (artist) */}
                {!isVenue && (
                  <View style={[db.sideCard, { backgroundColor: D.bg, borderColor: D.border }]}>
                    <Text style={db.sideCardTitle}>Tax time</Text>
                    <Text style={[db.taxSub, { color: D.muted }]}>{fyLabel} so far, from payments you've recorded.</Text>
                    {[
                      ['Gig income', fmtAud(fyPaidCents), true],
                      ['GST included', fmtAud(Math.round(fyPaidCents / 11)), false],
                      ['Paid gigs', String(fyPaidCount), false],
                    ].map(([label, val, bold]) => (
                      <View key={String(label)} style={[db.taxRow, { borderTopColor: D.borderFaint }]}>
                        <Text style={{ color: D.text }}>{label}</Text>
                        <Text style={[{ color: D.text }, bold ? { fontWeight: '600' } : {}]}>{val}</Text>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={[db.exportAcctBtn, { borderColor: D.border }]}
                      onPress={handleExportCsv}
                      activeOpacity={0.8}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '500', color: D.text }}>Export for your accountant</Text>
                    </TouchableOpacity>
                    <Text style={[db.taxDisclaimer, { color: D.muted }]}>An estimate, not tax advice. Check with your accountant.</Text>
                  </View>
                )}

                {/* Spend by night (venue) */}
                {isVenue && byNight.length > 0 && (
                  <View style={[db.sideCard, { backgroundColor: D.bg, borderColor: D.border }]}>
                    <Text style={db.sideCardTitle}>Spend by night</Text>
                    <Text style={[db.taxSub, { color: D.muted }]}>Paid and owed, this period.</Text>
                    {byNight.map(n => (
                      <View key={n.name} style={[db.nightRow, { borderTopColor: D.borderFaint }]}>
                        <View style={db.nightTop}>
                          <Text style={{ fontWeight: '500', color: D.text, flex: 1 }} numberOfLines={1}>{n.name}</Text>
                          <Text style={{ color: D.text }}>{fmtAud(n.total)}</Text>
                        </View>
                        <View style={[db.nightBarBg, { backgroundColor: '#F1F0ED' }]}>
                          <View style={[db.nightBarFg, { backgroundColor: D.text, width: `${Math.round((n.total / maxNight) * 100)}%` as any }]} />
                        </View>
                        <Text style={[db.nightSub, { color: D.muted }]}>
                          {n.count} {n.count === 1 ? 'act' : 'acts'} \u00b7 avg {fmtAud(Math.round(n.total / n.count))}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Gig table */}
            <View style={[db.tableCard, { backgroundColor: D.bg, borderColor: D.border }]}>
              <View style={db.tableHdr}>
                <Text style={db.tableTitle}>Gigs</Text>
                {/* Filter tabs */}
                <View style={[db.filterTabs, { backgroundColor: '#EFEEEB' }]}>
                  {(['all', 'paid', 'owed', 'upcoming'] as const).map(f => {
                    const label = f === 'all' ? 'All' : f === 'paid' ? L.filterPaid : f === 'owed' ? L.filterOwed : 'Upcoming';
                    const active = tableFilter === f;
                    return (
                      <TouchableOpacity
                        key={f}
                        style={[db.filterTab, active && db.filterTabActive]}
                        onPress={() => setTableFilter(f)}
                        activeOpacity={0.75}
                      >
                        <Text style={[db.filterTabText, { color: active ? D.text : '#4A4945' }]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Table header row */}
              <View style={[db.colHdr, { borderTopColor: D.borderFaint, borderBottomColor: D.borderFaint, backgroundColor: D.bgPage }]}>
                <Text style={[db.colHdrText, { width: 72 }]}>Date</Text>
                <Text style={[db.colHdrText, { flex: 1.4 }]}>{L.who}</Text>
                <Text style={[db.colHdrText, { flex: 1.3 }]}>Deal</Text>
                <Text style={[db.colHdrText, { width: 90, textAlign: 'right' }]}>Agreed</Text>
                <Text style={[db.colHdrText, { width: 90, textAlign: 'right' }]}>{L.actualCol}</Text>
                <Text style={[db.colHdrText, { width: 130 }]}>Status</Text>
              </View>

              {tableRows.length === 0 && (
                <Text style={[db.emptyTable, { color: D.muted }]}>No gigs match this period and filter.</Text>
              )}

              {tableRows.map(({ gig, st, localDate }) => {
                const cpChip = chipConfig(st.status, st.daysOverdue, st.dueDate, L);
                const agreed = agreedLabel(gig);
                const actual = (st.status === 'paid' || st.status === 'self_reported')
                  ? fmtAud(gig.payment.confirmedAmountCents ?? 0)
                  : '\u2014';
                const who   = role === 'artist' ? (gig.venueName ?? 'Venue') : (gig.artistName ?? gig.bandName ?? 'Artist');
                const where = role === 'artist' ? '' : (gig.room ?? '');

                return (
                  <TouchableOpacity
                    key={gig.id}
                    style={[db.tableRow, { borderBottomColor: D.borderFaint }]}
                    onPress={() => setSelectedGigId(gig.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[db.tableDate, { color: D.muted }]}>{dateShort(localDate)}</Text>
                    <View style={{ flex: 1.4 }}>
                      <Text style={db.tableWho} numberOfLines={1}>{who}</Text>
                      {where ? <Text style={[db.tableWhere, { color: D.muted }]} numberOfLines={1}>{where}</Text> : null}
                    </View>
                    <View style={{ flex: 1.3 }}>
                      <Text style={db.tableDeal} numberOfLines={1}>{modelLabel(gig.fee.type)}</Text>
                      <Text style={[db.tableDealSub, { color: D.muted }]} numberOfLines={1}>{dealSub(gig)}</Text>
                    </View>
                    <Text style={[db.tableNum, { width: 90 }]}>{agreed}</Text>
                    <Text style={[db.tableNum, { width: 90, fontWeight: '500' }]}>{actual}</Text>
                    <View style={{ width: 130 }}>
                      <StatusChip config={cpChip} />
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Totals row */}
              {tableRows.length > 0 && (
                <View style={[db.totalsRow, { backgroundColor: D.bgPage, borderTopColor: D.borderFaint }]}>
                  <Text style={{ width: 72 }} />
                  <Text style={[db.totalsText, { flex: 1.4 }]}>{tableRows.length} {tableRows.length === 1 ? 'gig' : 'gigs'}</Text>
                  <Text style={{ flex: 1.3 }} />
                  <Text style={[db.totalsNum, { width: 90 }]}>{totalAgreed > 0 ? fmtAud(totalAgreed) : ''}</Text>
                  <Text style={[db.totalsNum, { width: 90 }]}>{totalActual > 0 ? fmtAud(totalActual) : ''}</Text>
                  <Text style={{ width: 130 }} />
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Detail panel */}
      {selectedGig && (
        <DetailPanel
          gig={selectedGig}
          role={role}
          onClose={() => setSelectedGigId(null)}
          onRecorded={load}
        />
      )}
    </View>
  );
}

// ── Screen wrapper ─────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router     = useRouter();
  const { colors } = useTheme();
  const { profile } = useAuth();
  const isVenue    = profile?.type === 'venue';
  const L          = LABELS[isVenue ? 'venue' : 'artist'];

  const [exportOpen,  setExportOpen]  = useState(false);

  return (
    <SafeAreaView style={[db.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Header */}
      <View style={[db.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={db.backBtn} activeOpacity={0.7}>
          <Text style={[db.backText, { color: colors.black }]}>{'\u2190'}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[db.headerTitle, { color: colors.black }]}>{L.title}</Text>
          <Text style={[db.headerSub, { color: D.muted }]} numberOfLines={1}>{L.sub}</Text>
        </View>
        {/* Export button */}
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            style={[db.exportBtn, { borderColor: colors.border }]}
            onPress={() => setExportOpen(o => !o)}
            activeOpacity={0.75}
          >
            <Text style={[db.exportBtnText, { color: colors.black }]}>Export</Text>
          </TouchableOpacity>
          {exportOpen && (
            <View style={[db.exportMenu, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <TouchableOpacity style={db.exportItem} onPress={() => { setExportOpen(false); }} activeOpacity={0.75}>
                <Text style={[db.exportItemTitle, { color: colors.black }]}>PDF summary</Text>
                <Text style={[db.exportItemSub, { color: D.muted }]}>For your records or accountant</Text>
              </TouchableOpacity>
              <TouchableOpacity style={db.exportItem} onPress={() => { setExportOpen(false); }} activeOpacity={0.75}>
                <Text style={[db.exportItemTitle, { color: colors.black }]}>CSV</Text>
                <Text style={[db.exportItemSub, { color: D.muted }]}>Every gig in this period</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      <DashboardContent />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const db = StyleSheet.create({
  safe:           { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  backBtn:        { paddingRight: 4 },
  backText:       { fontSize: 20 },
  headerTitle:    { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  headerSub:      { fontSize: 12, marginTop: 1 },
  exportBtn:      { height: 34, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  exportBtnText:  { fontSize: 13, fontWeight: '500' },
  exportMenu:     { position: 'absolute', right: 0, top: 40, width: 220, borderWidth: 1, borderRadius: 10, zIndex: 30, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6 },
  exportItem:     { padding: 10 },
  exportItemTitle: { fontWeight: '500', fontSize: 14 },
  exportItemSub:  { fontSize: 12, marginTop: 1 },

  scroll:         { padding: 16, paddingBottom: 60, gap: 16 },
  periodRow:      { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 4 },
  pill:           { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillActive:     { backgroundColor: D.text },
  pillText:       { fontSize: 13, fontWeight: '500' },
  rangeLabel:     { fontSize: 13, marginLeft: 6, flexShrink: 1 },

  centre:         { alignItems: 'center', paddingVertical: 40 },
  errorText:      { fontSize: 13, paddingVertical: 8 },

  kpiRow:         { flexDirection: 'column', gap: 10 },
  kpiRowWide:     { flexDirection: 'row' },
  kpiCard:        { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 18, minWidth: 160 },
  kpiLabel:       { fontSize: 13, marginBottom: 4 },
  kpiValue:       { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  kpiSub:         { fontSize: 13, marginTop: 2 },

  body:           { flexDirection: 'column', gap: 16 },
  bodyWide:       { flexDirection: 'row', alignItems: 'flex-start' },

  chartCard:      { borderWidth: 1, borderRadius: 12, padding: 20 },
  chartHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chartTitle:     { fontSize: 16, fontWeight: '600', color: D.text },
  legend:         { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  legendDot:      { width: 10, height: 10, borderRadius: 2 },
  hatchDot:       { backgroundColor: '#C9C8C3', borderWidth: 1, borderColor: '#D6D5D0' },
  legendLabel:    { fontSize: 12, marginRight: 6 },
  chartEmpty:     { height: 180, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border, borderRadius: 10, borderStyle: 'dashed' },

  sideCol:        { gap: 16 },
  sideCard:       { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  sideCardHdr:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sideCardTitle:  { fontSize: 16, fontWeight: '600', color: D.text },
  allClear:       { paddingHorizontal: 20, paddingBottom: 20, fontSize: 14 },
  attRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1 },
  attDot:         { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  attTitle:       { fontSize: 14, fontWeight: '500', color: D.text },
  attSub:         { fontSize: 13, marginTop: 1 },
  attBtn:         { height: 32, paddingHorizontal: 12, borderWidth: 1, borderColor: D.text, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  attBtnText:     { fontSize: 13, fontWeight: '500', color: D.text },

  taxSub:         { fontSize: 13, paddingHorizontal: 20, marginBottom: 2 },
  taxRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, borderTopWidth: 1 },
  exportAcctBtn:  { marginHorizontal: 20, marginTop: 10, height: 40, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  taxDisclaimer:  { fontSize: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 },

  nightRow:       { paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1 },
  nightTop:       { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  nightBarBg:     { height: 6, borderRadius: 3, marginTop: 6 },
  nightBarFg:     { height: 6, borderRadius: 3 },
  nightSub:       { fontSize: 12, marginTop: 4 },

  tableCard:      { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  tableHdr:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, flexWrap: 'wrap', gap: 10 },
  tableTitle:     { fontSize: 16, fontWeight: '600', color: D.text },
  filterTabs:     { flexDirection: 'row', padding: 3, borderRadius: 10, gap: 2 },
  filterTab:      { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  filterTabActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
  filterTabText:  { fontSize: 13, fontWeight: '500' },

  colHdr:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1 },
  colHdrText:     { fontSize: 12, color: D.muted },
  emptyTable:     { padding: 28, textAlign: 'center', fontSize: 14 },

  tableRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, gap: 8 },
  tableDate:      { width: 72, fontSize: 13 },
  tableWho:       { fontSize: 14, fontWeight: '500', color: D.text },
  tableWhere:     { fontSize: 12, marginTop: 1 },
  tableDeal:      { fontSize: 14, color: D.text },
  tableDealSub:   { fontSize: 12, marginTop: 1 },
  tableNum:       { textAlign: 'right', fontSize: 14, color: D.text },

  totalsRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, gap: 8 },
  totalsText:     { fontSize: 14, fontWeight: '600', color: D.text },
  totalsNum:      { textAlign: 'right', fontSize: 14, fontWeight: '600', color: D.text },
});
