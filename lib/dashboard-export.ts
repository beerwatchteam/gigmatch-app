/**
 * Pure string-generation helpers for dashboard PDF and CSV exports.
 * Extracted from app/dashboard.tsx so they can be unit-tested without
 * React Native dependencies.
 */

import { toZonedTime } from 'date-fns-tz';
import { gigRowDisplay, formatAud } from './dashboard';
import type { DashboardSummary, Period } from './dashboard';
import type { Gig } from './gig-types';

// ── CSV ───────────────────────────────────────────────────────────────────────

export function buildCsv(
  gigs: Gig[],
  role: 'artist' | 'venue',
  _period: Period,
): string {
  const header = [
    'Date', 'Counterparty', 'Source', 'Fee type', 'Planned', 'Actual', 'Status',
  ].join(',');

  const rows = gigs.map(gig => {
    const display = gigRowDisplay(gig);
    const tz = gig.timezone ?? 'Australia/Melbourne';
    const local = toZonedTime(gig.startAt.toDate(), tz);
    const dateStr = local.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const counterparty = role === 'artist'
      ? (gig.venueName ?? '')
      : (gig.artistName ?? gig.bandName ?? '');
    const sourceLabel = gig.source === 'enquiry' ? 'Twaylo booking'
      : gig.source === 'venue_created' ? 'Venue added' : 'Added by me';

    // Escape for CSV
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [
      esc(dateStr), esc(counterparty), esc(sourceLabel),
      esc(gig.fee?.type ?? ''), esc(display.planned), esc(display.actual), esc(display.status),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

// ── PDF HTML ──────────────────────────────────────────────────────────────────

export function buildPdfHtml(
  summary: DashboardSummary,
  gigs: Gig[],
  role: 'artist' | 'venue',
  periodLabel: string,
): string {
  const gigRows = gigs.map(gig => {
    const display = gigRowDisplay(gig);
    const tz = gig.timezone ?? 'Australia/Melbourne';
    const local = toZonedTime(gig.startAt.toDate(), tz);
    const dateStr = local.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const counterparty = role === 'artist'
      ? (gig.venueName ?? '')
      : (gig.artistName ?? gig.bandName ?? '');
    const statusColor =
      display.status === 'confirmed' || display.status === 'self_reported' ? '#16a34a' :
      display.status === 'pending'   ? '#ef4444' :
      display.status === 'disputed'  ? '#f59e0b' : '#888';
    return `
      <tr>
        <td>${dateStr}</td>
        <td>${counterparty}</td>
        <td>${display.planned}</td>
        <td style="color:${statusColor};font-weight:700">${display.actual}</td>
        <td style="color:${statusColor}">${display.status}${display.status === 'self_reported' ? ' *' : ''}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, sans-serif; font-size: 13px; color: #111; padding: 32px; }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 4px; }
  .period { color: #888; margin-bottom: 24px; font-size: 13px; }
  .headline { display: flex; gap: 40px; margin-bottom: 24px; }
  .stat-label { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #888; }
  .stat-value { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-top: 2px; }
  .confirmed { color: #111; }
  .pending   { color: #ef4444; }
  .disputed  { color: #f59e0b; font-size: 12px; margin-bottom: 20px; }
  .nofee     { color: #888; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; text-align: left; padding: 6px 8px; border-bottom: 2px solid #eee; color: #888; }
  td { padding: 8px; border-bottom: 1px solid #eee; font-size: 12px; }
  .footer { margin-top: 40px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
<h1>Gig Dashboard</h1>
<div class="period">${periodLabel}</div>
<div class="headline">
  <div>
    <div class="stat-label">Confirmed</div>
    <div class="stat-value confirmed">${formatAud(summary.confirmedCents)}</div>
    ${summary.selfReportedCents > 0 ? `<div style="color:#888;font-size:11px">incl. ${formatAud(summary.selfReportedCents)} self-reported</div>` : ''}
  </div>
  <div>
    <div class="stat-label" style="color:#ef4444">Pending</div>
    <div class="stat-value pending">${formatAud(summary.pendingCents)}</div>
  </div>
  <div>
    <div class="stat-label">Gigs</div>
    <div class="stat-value confirmed">${summary.gigsPlayed + summary.gigsUpcoming}</div>
    <div style="color:#888;font-size:11px">${summary.gigsPlayed} played, ${summary.gigsUpcoming} upcoming</div>
  </div>
</div>
${summary.disputedCount > 0 ? `<div class="disputed">Disputed: ${formatAud(summary.disputedCents)} (${summary.disputedCount} gig${summary.disputedCount > 1 ? 's' : ''}) — excluded from totals</div>` : ''}
${summary.noFeeCount > 0 ? `<div class="nofee">${summary.noFeeCount} gig${summary.noFeeCount > 1 ? 's' : ''} with no fee recorded</div>` : ''}
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>${role === 'artist' ? 'Venue' : 'Artist'}</th>
      <th>Planned</th>
      <th>Actual</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>${gigRows}</tbody>
</table>
<p style="font-size:11px;color:#aaa;margin-top:12px">* Self-reported: no counterparty confirmation.</p>
<div class="footer">Generated from Twaylo. Amounts reflect what users entered and confirmed, not payments processed by Twaylo.</div>
</body>
</html>`;
}
