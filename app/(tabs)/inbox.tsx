import { useState, useEffect, useRef } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Image, Linking, useWindowDimensions, Modal, Animated, Alert, Switch,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { LegalIdentity, BLANK_LEGAL, isLegalIdentityComplete } from '@/lib/legalIdentity';
import { isPaymentReady } from '@/lib/payment-readiness';
import { type EnquiryFee, type DueTiming } from '@/lib/enquiry-fee';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Text } from '@/components/Text';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOP_TAB_H, BOTTOM_TAB_H, WEB_TAB_H } from './_layout';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  useArtistEnquiries, useVenueEnquiries, useMessages, useSupportEnquiries, useAgentEnquiries,
  type RosterEntry,
  useParticipants,
  updateEnquiryStatus, sendMessage, sendProfileSection, cancelEnquiry, archiveEnquiry,
  bookSlotOnTimetable, markEnquiryRead,
  inviteParticipants, leaveGig, removeParticipantFromGig,
  ensureVenueParticipant,
  normalizeEnquiryStatus,
  fetchVenuePastCollaborators, fetchHeadlinerPastCollaborators,
  postSystemMessage,
  type Enquiry, type Participant,
} from '@/lib/useEnquiries';
import { crossConfirm } from '@/lib/confirm';
import { cancelAcceptance } from '@/lib/useGigs';
import { type FeeType, tzLabel, type Gig, dollarsToCents } from '@/lib/gig-types';
import { PaymentCard } from '@/components/PaymentCard';
import {
  useDMConversations, useDMMessages,
  sendDMMessage, acceptDMRequest, deleteDMConv,
  type DMConv,
} from '@/lib/useDirectMessages';
import { doc, getDoc, onSnapshot, updateDoc, getDocs, collection, query, where, limit, arrayRemove, addDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { Toast } from '@/components/Toast';
import { calendarDatesFromEnquiry } from '@/components/AddToCalendarButton';

/** Fetches and caches a venue's photoUrl for display in artist-side tiles/threads. */
function useVenuePhoto(venueId: string | null | undefined): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!venueId) return;
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) setPhoto(snap.data().photoUrl ?? null);
    }).catch(() => {});
  }, [venueId]);
  return photo;
}

/** Resolves a user's real display name and photo from their profile collections. */
function useUserDisplayInfo(uid: string | null): { name: string | null; photoUrl: string | null } {
  const [info, setInfo] = useState<{ name: string | null; photoUrl: string | null }>({ name: null, photoUrl: null });
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let name: string | null = null;
      let photoUrl: string | null = null;

      // Read users doc first to get type + venueId (rule now allows isSignedIn reads)
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (cancelled) return;

      const userData = userSnap.exists() ? userSnap.data() : null;
      const type = userData?.type as string | undefined;
      const venueId = userData?.venueId as string | undefined;

      if (type === 'artist') {
        // Artist: read public bandProfiles doc
        const bpSnap = await getDoc(doc(db, 'bandProfiles', uid));
        if (!cancelled && bpSnap.exists()) {
          name = bpSnap.data().name || null;
          photoUrl = bpSnap.data().photoUrl ?? null;
        }
      } else {
        // Venue (or unknown type): try venueId first, then claimedBy query
        let vSnap: any = null;
        if (venueId) vSnap = await getDoc(doc(db, 'venues', venueId));
        if (!vSnap?.exists()) {
          const snap = await getDocs(query(collection(db, 'venues'), where('claimedBy', '==', uid), limit(1)));
          if (!snap.empty) vSnap = snap.docs[0];
        }
        if (!cancelled && vSnap?.exists()) {
          const vd = vSnap.data();
          name = vd.name || vd.venueName || null;
          photoUrl = vd.photoUrl ?? null;
        }
      }

      if (!cancelled) setInfo({ name, photoUrl });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [uid]);
  return info;
}

const isWeb = Platform.OS === 'web';

// Persists tab choice within the session; defaults to 'enquiries' on fresh load
let _sessionInboxTab: 'enquiries' | 'messages' = 'enquiries';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMsgTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

/** Returns the venue's IANA timezone from the enquiry, using venueTimezone (set at creation)
 *  or timezone (set at confirmation) as a fallback. */
function getVenueTz(enquiry: Enquiry): string | undefined {
  return enquiry.venueTimezone ?? (enquiry as any).timezone;
}

function fmtSlotDate(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function fmtSlotDateFull(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildContractHtml({
  enquiry, venueData, artistProfile, venueLegal, artistLegal,
  setLength, loadIn, soundCheck, supportActs, isDraft, techRiderConfirmed,
  venueSignature, artistSignature,
}: {
  enquiry: Enquiry;
  venueData: Record<string, any>;
  artistProfile: Record<string, any>;
  venueLegal: LegalIdentity;
  artistLegal: LegalIdentity;
  setLength: string;
  loadIn: string;
  soundCheck: string;
  supportActs: string;
  /** When true, stamps every page DRAFT and highlights missing fields. */
  isDraft: boolean;
  /** Whether the venue has confirmed the tech rider review stage. */
  techRiderConfirmed: boolean;
  venueSignature?:  { signatoryName: string; signedAt: number } | null;
  artistSignature?: { signatoryName: string; signedAt: number } | null;
}): string {
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const gigDate = enquiry.requestedSlot.date
    ? new Date(enquiry.requestedSlot.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : enquiry.requestedSlot.day || '';

  const gigId = (enquiry as any).gigId || enquiry.id;

  // ── Parties ───────────────────────────────────────────────────────────────
  const venueLegalName  = venueLegal.legalName  || enquiry.venueName;
  const artistLegalName = artistLegal.legalName || enquiry.bandName;
  const venueAbn  = venueData.payment?.abn || '';
  const venueAcn  = venueLegal.acn || '';
  const artistAbn = artistProfile.payment?.abn || '';
  const artistAcn = artistLegal.acn || '';
  const artistAbnStatus    = artistProfile.payment?.abnStatus as string || '';
  const artistGstRegistered = !!artistProfile.payment?.gstRegistered;
  const canProvideInvoice   = !!artistProfile.payment?.canProvideInvoice;
  const artistEntityType    = artistLegal.entityType || '';

  const venueAddr  = venueLegal.addressLine
    ? [venueLegal.addressLine,  venueLegal.suburb,  venueLegal.state,  venueLegal.postcode ].filter(Boolean).join(', ')
    : [venueData.streetAddress, venueData.suburb,   venueData.state,   venueData.postcode  ].filter(Boolean).join(', ');
  const artistAddr = [artistLegal.addressLine, artistLegal.suburb, artistLegal.state, artistLegal.postcode].filter(Boolean).join(', ');
  const venueTradingName = venueData.name || enquiry.venueName;

  // ── Performance details ───────────────────────────────────────────────────
  const venueStreetAddress = venueData.streetAddress || '';
  const room        = (enquiry.requestedSlot as any).room as string || '';
  const setLenMins  = (setLength || enquiry.requestedSlot.setLength || '').replace(/\D/g, '');

  // ── Tech rider ────────────────────────────────────────────────────────────
  const rider         = (artistProfile.techRider || {}) as Record<string, string>;
  const riderMonitor  = [rider.monitoringType, rider.monitoring].filter(Boolean).join(' — ');
  const riderNotes    = rider.notes || '';
  const techRiderDocs = (artistProfile.techRiderDocs || []) as { name: string }[];
  const techRiderName = techRiderDocs[0]?.name || 'not attached';
  const backlineProvided: string[] = venueData.payment?.backlineProvided || [];

  // ── Hospitality ───────────────────────────────────────────────────────────
  const mealsProvided      = !!venueData.payment?.mealsProvided;
  const mealsNotes         = venueData.payment?.mealsNotes as string || '';
  const guestListAllowance = venueData.payment?.guestListAllowance as string || '';
  const hospParts: string[] = [];
  if (backlineProvided.length) hospParts.push('sound and backline support as listed in clause 3');
  if (guestListAllowance) hospParts.push(`guest list (${guestListAllowance})`);
  const hospitalitySummary = hospParts.length ? hospParts.join(', ') : 'standard artist provisions';

  // ── Payment ───────────────────────────────────────────────────────────────
  const fee = (enquiry as any).fee as { type?: string; amountCents?: number; doorPercent?: number; ticketPrice?: number; notes?: string } | null | undefined;
  const ef  = (enquiry as any).enquiryFee as Partial<EnquiryFee> | null | undefined;
  const feeType     = (enquiry as any).feeType as string || fee?.type || 'other';


  const fmtMoney = (cents: number) => {
    const d = cents / 100;
    return `$${Number.isInteger(d) ? d.toLocaleString('en-AU') : d.toFixed(2)}`;
  };
  // Prefer live enquiryFee negotiation fields over the confirmed-fee snapshot
  const feeAmount   = ef?.amountCents      != null ? fmtMoney(ef.amountCents)          : fee?.amountCents  != null ? fmtMoney(fee.amountCents)  : '';
  const doorPercent = ef?.doorPercent      != null ? `${ef.doorPercent}`                : fee?.doorPercent  != null ? `${fee.doorPercent}`        : '';
  const ticketPrice = ef?.ticketPriceCents != null ? fmtMoney(ef.ticketPriceCents)      : fee?.ticketPrice  != null ? fmtMoney(fee.ticketPrice)   : '';
  const gstApplies  = ef?.gstApplies ?? artistGstRegistered;
  const deductions  = ef?.deductionsText || '';
  const threshold   = ef?.thresholdCents  != null ? fmtMoney(ef.thresholdCents)         : '';
  const rptDays     = ef?.reportDays      != null ? ef.reportDays                        : 7;
  const unpaidNotes = ef?.unpaidNotes  || '';
  const efChannel   = ef?.channel      || '';

  const payMethodLabel: Record<string, string> = {
    flat: 'flat fee', door_split: 'door split',
    guarantee_vs_door: 'guarantee plus door split', ticket_split: 'ticket sales split',
    unpaid: 'no payment (unpaid)', other: 'arrangement as described in clause 5.6',
  };
  const paymentMethodLabel = payMethodLabel[feeType] || 'arrangement as described in clause 5.6';

  // 5.2 amount clause
  let clause5_2 = '';
  const np = '[not provided]';
  if (feeType === 'flat') {
    const gstNote = gstApplies ? ' plus GST' : '. No GST is charged';
    clause5_2 = `The Venue will pay the Artist ${feeAmount || np}${gstNote}.`;
  } else if (feeType === 'door_split') {
    const dedStr = deductions ? `, calculated after ${deductions}` : ', calculated after venue costs';
    clause5_2 = `The Artist will receive ${doorPercent || np}% of door takings${dedStr}. The Venue will give the Artist the door count and takings at the end of the night.`;
  } else if (feeType === 'guarantee_vs_door') {
    const thrStr = threshold ? ` above ${threshold}` : '';
    const dedStr = deductions ? `, calculated after ${deductions}` : '';
    clause5_2 = `The Venue will pay a guarantee of ${feeAmount || np}, plus ${doorPercent || np}% of door takings${thrStr}${dedStr}. The Venue will give the Artist the door count and takings at the end of the night.`;
  } else if (feeType === 'ticket_split') {
    const tpStr = ticketPrice ? ` (ticket price ${ticketPrice})` : '';
    clause5_2 = `The Artist will receive ${doorPercent || np}% of net ticket sales${tpStr}. The Venue will send a sales report within ${rptDays} days after the performance.`;
  } else if (feeType === 'unpaid') {
    clause5_2 = `Both parties acknowledge this is an unpaid performance.${unpaidNotes ? ' ' + unpaidNotes : ''}`;
  } else {
    clause5_2 = 'Payment is as described in clause 5.6.';
  }

  // 5.3 timing — prefer structured enquiryFee timing over the venue's default
  let clause5_3 = '';
  const efDueTiming = ef?.dueTiming;
  const efDueDays   = ef?.dueDays;
  if (efDueTiming === 'on_night') {
    clause5_3 = 'Payment is due on the night of the performance.';
  } else if (efDueTiming === 'within_days' && efDueDays != null) {
    clause5_3 = `Payment is due within ${efDueDays} day${efDueDays === 1 ? '' : 's'} after the performance.`;
  } else {
    const timingMap: Record<string, string> = {
      'Same night':     'Payment is due on the night of the performance.',
      'Within 7 days':  'Payment is due within 7 days after the performance.',
      'Within 14 days': 'Payment is due within 14 days after the performance.',
      'Within 30 days': 'Payment is due within 30 days after the performance.',
    };
    const venueTimingRaw   = venueData.payment?.timing    as string || '';
    const venueTimingOther = venueData.payment?.timingOther as string || '';
    clause5_3 = timingMap[venueTimingRaw]
      || (venueTimingRaw === 'Other' && venueTimingOther ? `Payment timing: ${venueTimingOther}.` : '');
  }

  // 5.4 ABN/tax
  let clause5_4 = '';
  if (artistAbnStatus === 'has_abn' && artistAbn) {
    clause5_4 = `The Artist's ABN is ${artistAbn}.`;
    clause5_4 += artistGstRegistered
      ? ' The Artist is registered for GST and will issue a tax invoice.'
      : ' The Artist is not registered for GST.';
    if (canProvideInvoice) clause5_4 += ' The Artist will provide an invoice before payment is due.';
  } else if (artistAbnStatus === 'no_abn_hobby') {
    clause5_4 = 'The Artist declares they are not carrying on an enterprise in respect of this performance and are not required to quote an ABN.';
  } else if (artistAbnStatus === 'applying') {
    clause5_4 = 'The Artist will give the Venue their ABN before payment is due. If none is given, the Venue may withhold tax from the payment as the law requires.';
  }

  // 5.5 deposit
  const depositRequired = !!venueData.payment?.depositRequired;
  const depositAmount   = venueData.payment?.depositAmount as string || '[not provided]';
  const depositDue      = venueData.payment?.depositDue    as string || '[not provided]';

  // ── Insurance ─────────────────────────────────────────────────────────────
  const artistPLHeld     = !!artistProfile.payment?.publicLiabilityHeld;
  const artistPLCoverage = artistProfile.payment?.publicLiabilityCoverage as string || '';

  // ── General ───────────────────────────────────────────────────────────────
  const venueState    = venueData.state || venueLegal.state || 'Australia';
  const importantNotes = (enquiry as any).importantNotes as string || '';
  const notesDoc       = (enquiry as any).notesDoc as { name: string } | null;
  const attachmentList = notesDoc ? notesDoc.name : 'None';

  // ── Helper: omit table row when value is empty ────────────────────────────
  const r = (label: string, value: string) =>
    value.trim() ? `<tr><td>${label}</td><td>${value}</td></tr>` : '';

  // ── Signature lines ───────────────────────────────────────────────────────
  const venueSigLine  = venueLegal.signatoryName
    ? `${venueLegal.signatoryName},&nbsp;${venueLegal.signatoryRole}`
    : '<span class="tbc">[not provided]</span>';
  const artistSigLine = artistLegal.signatoryName
    ? `${artistLegal.signatoryName},&nbsp;${artistLegal.signatoryRole}`
    : '<span class="tbc">[not provided]</span>';

  const fmtSigDate = (ts: number) =>
    new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const venueSignedCell  = venueSignature
    ? `<em>Electronically signed by ${venueSignature.signatoryName} on ${fmtSigDate(venueSignature.signedAt)}</em>`
    : '<div class="sig-space"></div><span class="sig-label">Date signed:</span>';
  const artistSignedCell = artistSignature
    ? `<em>Electronically signed by ${artistSignature.signatoryName} on ${fmtSigDate(artistSignature.signedAt)}</em>`
    : '<div class="sig-space"></div><span class="sig-label">Date signed:</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Performance Agreement — ${enquiry.bandName} @ ${venueTradingName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12px; line-height: 1.78; color: #111; padding: 60px; max-width: 720px; margin: auto; }
  h1 { font-size: 21px; font-weight: 700; letter-spacing: -0.4px; margin-bottom: 4px; }
  .ref { font-size: 10.5px; color: #777; margin-bottom: 38px; letter-spacing: 0.2px; }
  h2 { font-size: 12.5px; font-weight: 700; margin: 30px 0 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; letter-spacing: -0.1px; }
  p { margin: 0 0 10px; }
  table.det { width: 100%; border-collapse: collapse; margin: 10px 0 16px; }
  table.det td { padding: 7px 11px; border: 1px solid #d8d8d8; vertical-align: top; font-size: 12px; }
  table.det td:first-child { background: #f6f6f6; font-weight: 600; width: 34%; }
  table.sig { width: 100%; border-collapse: collapse; margin: 10px 0; }
  table.sig th { background: #f6f6f6; font-weight: 700; font-size: 11px; text-align: left; padding: 9px 13px; border: 1px solid #d8d8d8; }
  table.sig td { padding: 10px 13px; border: 1px solid #d8d8d8; vertical-align: top; font-size: 12px; }
  .sig-space { min-height: 52px; border-bottom: 1px solid #333; margin: 38px 0 6px; }
  .sig-label { font-size: 10.5px; color: #666; }
  .notice { background: #fffbeb; border: 1px solid #fde68a; padding: 11px 14px; font-size: 11px; color: #92400e; margin: 22px 0; border-radius: 4px; }
  .tbc { color: #b45309; font-style: italic; font-size: 11px; }
  .footer { text-align: center; font-size: 10px; color: #bbb; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 52px; padding-top: 14px; border-top: 1px solid #e0e0e0; }
  .tbc { color: #b45309; font-style: italic; font-size: 11px; }
  .np  { color: #b45309; font-style: italic; }
${isDraft ? `  .draft-stamp { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 96px; font-weight: 900; color: rgba(200,0,0,0.07); white-space: nowrap; pointer-events: none; z-index: 9999; letter-spacing: 12px; font-family: Arial, sans-serif; }` : ''}
</style>
</head>
<body>
${isDraft ? '<div class="draft-stamp">DRAFT</div>' : ''}

<h1>PERFORMANCE AGREEMENT</h1>
<div class="ref">Reference: ${gigId}&nbsp;&nbsp;·&nbsp;&nbsp;Version: 1.0&nbsp;&nbsp;·&nbsp;&nbsp;Generated: ${today}</div>

<h2>1. Parties</h2>
<p>This agreement is between:</p>
<p>(a) <strong>The Venue:</strong> ${venueLegalName}${venueAbn ? ` (ABN ${venueAbn})` : ''}${venueAcn ? ` (ACN ${venueAcn})` : ''}${venueAddr ? `, of ${venueAddr}` : ''}${venueTradingName !== venueLegalName ? ` (trading as ${venueTradingName})` : ''}; and</p>
<p>(b) <strong>The Artist:</strong> ${artistLegalName}${artistAbnStatus === 'has_abn' && artistAbn ? ` (ABN ${artistAbn})` : ''}${artistAcn ? ` (ACN ${artistAcn})` : ''}${artistAddr ? `, of ${artistAddr}` : ''} (performing as ${enquiry.bandName}).</p>
${artistEntityType === 'Partnership' ? '<p>The Artist\'s signatory signs on behalf of every member of the group and confirms they are authorised to do so.</p>' : ''}

<h2>2. Performance details</h2>
<p>Rows with no value are left out. The Artist will arrive and perform at these times. Any change must be agreed by both parties in writing through the Twaylo inbox.</p>
<table class="det"><tbody>
  ${r('Venue address', venueStreetAddress)}
  ${r('Date', gigDate)}
  ${r('Slot', (enquiry.requestedSlot.slotType || ''))}
  ${r('Room', room)}
  ${r('Load-in', loadIn)}
  ${r('Sound check', soundCheck)}
  ${r('Set start', enquiry.requestedSlot.time || '')}
  ${r('Set length', setLenMins ? setLenMins + ' minutes' : '')}
  ${r('Support acts', supportActs)}
</tbody></table>

<h2>3. Technical requirements</h2>
<p>The Artist's technical requirements are in the attached tech rider (${techRiderName}) and summarised here:</p>
<ul style="margin:8px 0 10px 18px">
  ${riderMonitor ? `<li>Monitoring: ${riderMonitor}</li>` : ''}
  ${soundCheck   ? `<li>Sound check: ${soundCheck}</li>`   : ''}
  ${riderNotes   ? `<li>Notes: ${riderNotes}</li>`         : ''}
  ${!riderMonitor && !soundCheck && !riderNotes ? '<li>See attached tech rider for full requirements.</li>' : ''}
</ul>
${techRiderConfirmed ? `<p>The Venue confirms it has reviewed the tech rider and will provide the equipment and support it describes, except as noted in clause 9.${backlineProvided.length ? ` The Venue will also provide this backline: ${backlineProvided.join(', ')}.` : ''}</p>` : ''}

<h2>4. Hospitality</h2>
<p>The Venue will provide: ${hospitalitySummary}.${mealsProvided ? ` Meals: ${mealsNotes || 'as agreed'}.` : ''}${guestListAllowance ? ` Guest list allowance: ${guestListAllowance}.` : ''}</p>

<h2>5. Payment</h2>
<p>5.1 <strong>Method.</strong> The Artist will be paid by ${paymentMethodLabel}${efChannel ? ` via ${efChannel}` : ''}. Twaylo does not process payments; the Venue pays the Artist directly.</p>
<p>5.2 <strong>Amount.</strong> ${clause5_2}</p>
${clause5_3 ? `<p>5.3 <strong>When.</strong> ${clause5_3}</p>` : ''}
${clause5_4 ? `<p>5.4 <strong>ABN and tax.</strong> ${clause5_4}</p>` : ''}
${depositRequired ? `<p>5.5 <strong>Deposit.</strong> The Venue will pay a deposit of ${depositAmount} by ${depositDue}.</p>` : ''}

<h2>6. Cancellation</h2>
<p>6.1 Either party may cancel by written notice through the Twaylo inbox.</p>
<p>6.2 If the Venue cancels with less than 14 days' notice, it will pay the Artist 50% of the agreed fee.</p>
<p>6.3 If the Artist cancels with less than 14 days' notice, the Artist will forfeit any deposit paid.</p>
<p>6.4 Neither party is liable for a cancellation caused by events outside their reasonable control, such as severe weather, government restrictions or serious illness.</p>

<h2>7. Insurance and licences</h2>
<p>7.1 ${artistPLHeld ? `The Artist holds public liability insurance${artistPLCoverage ? ` (${artistPLCoverage})` : ''}.` : 'The Artist does not hold public liability insurance.'}</p>
<p>7.2 The Venue holds the licences and public liability insurance its premises require, including any music licensing needed for public performance at the venue.</p>

<h2>8. General</h2>
<p>8.1 Each party is an independent contractor. Nothing here creates an employment, partnership or agency relationship.</p>
<p>8.2 The Artist is responsible for their own equipment and for the conduct of their members and crew at the venue.</p>
<p>8.3 Twaylo provides the platform only. It is not a party to this agreement, does not process payments and is not responsible for either party's performance.</p>
<p>8.4 This agreement is the whole agreement about this performance. Changes must be in writing and agreed by both parties through the Twaylo inbox, and each change creates a new version that both parties must sign again.</p>
<p>8.5 This agreement is governed by the laws of ${venueState}, Australia.</p>
<p>8.6 The parties agree this agreement may be signed electronically and in counterparts.</p>

<h2>9. Additional notes and attachments</h2>
${importantNotes ? `<p>${importantNotes}</p>` : '<p>None.</p>'}
<p>Attachments: ${attachmentList}</p>

<h2>10. Signatures</h2>
<p>By signing, each party agrees to the terms above.</p>
<div class="notice">This is a draft contract generated by Twaylo. Reference: ${gigId}, version 1.0. Both parties should review all details before signing. Have an Australian lawyer review the text before using for real bookings. Twaylo is not a party to this agreement.</div>
<table class="sig">
  <thead><tr><th></th><th>Venue</th><th>Artist</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>Signed for</strong></td>
      <td>${venueLegalName}</td>
      <td>${artistLegalName}</td>
    </tr>
    <tr>
      <td><strong>Signatory</strong></td>
      <td>${venueSigLine}</td>
      <td>${artistSigLine}</td>
    </tr>
    <tr>
      <td><strong>Signature</strong></td>
      <td>${venueSignedCell}</td>
      <td>${artistSignedCell}</td>
    </tr>
  </tbody>
</table>

<div class="footer">Twaylo &nbsp;·&nbsp; ${isDraft ? 'Draft — Not signed' : 'For review and signature'} &nbsp;·&nbsp; Not legally binding until signed by both parties</div>

</body>
</html>`;
}

function getDateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}


function formatTileDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return (name || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ── Status config (viewer-aware) ───────────────────────────────────────────

type StatusCfg = { label: string; color: string; bg: string };

function getStatusCfg(status: string, isVenue: boolean): StatusCfg {
  const s = normalizeEnquiryStatus(status as Enquiry['status']);
  switch (s) {
    case 'enquired':
      return isVenue
        ? { label: 'AWAITING RESPONSE', color: '#f5a623', bg: 'rgba(245,166,35,0.12)' }
        : { label: 'AWAITING REPLY',    color: '#888888', bg: 'rgba(0,0,0,0.06)'      };
    case 'discussing':
      return { label: 'DISCUSSING', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
    case 'confirmed':
      return { label: 'CONFIRMED',  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'  };
    case 'declined':
      return { label: 'DECLINED',   color: '#dc2626', bg: 'rgba(220,38,38,0.1)'  };
    case 'cancelled':
      return { label: 'CANCELLED',  color: '#888888', bg: 'rgba(0,0,0,0.06)'     };
    default:
      return { label: s.toUpperCase(), color: '#888888', bg: 'rgba(0,0,0,0.06)' };
  }
}

const PAYMENT_CHANNELS = ['Cash', 'Bank transfer', 'PayPal', 'Stripe', 'Other'];

const FEE_TYPE_PILLS: { value: FeeType; label: string }[] = [
  { value: 'flat',              label: 'Flat fee'         },
  { value: 'door_split',        label: 'Door split'       },
  { value: 'guarantee_vs_door', label: 'Guarantee + door' },
  { value: 'ticket_split',      label: 'Ticket split'     },
  { value: 'unpaid',            label: 'Unpaid'           },
  { value: 'other',             label: 'Other'            },
];

/**
 * Human-readable labels for each enquiryFee field key — used in system messages
 * when a confirmed stage is reset due to a field edit.
 */
const FEE_FIELD_LABELS: Record<string, string> = {
  amountCents:      'Amount',
  doorPercent:      'Artist percentage',
  ticketPriceCents: 'Ticket price',
  thresholdCents:   'Guarantee threshold',
  deductionsText:   'Deductions',
  reportDays:       'Sales report days',
  unpaidNotes:      'Unpaid notes',
  channel:          'Payment channel',
  dueTiming:        'Payment timing',
  dueDays:          'Days after gig',
  gstApplies:       'GST applies',
};

/**
 * Which stage(s) each enquiryFee field belongs to. When a stage is confirmed and
 * a field it owns changes, the stage is reset so both parties must re-confirm.
 *
 * All fields belong to the single paymentTermsSet stage.
 */
const FEE_FIELD_STAGE: Record<string, StageKey[]> = {
  amountCents:      ['paymentTermsSet'],
  doorPercent:      ['paymentTermsSet'],
  ticketPriceCents: ['paymentTermsSet'],
  unpaidNotes:      ['paymentTermsSet'],
  channel:          ['paymentTermsSet'],
  dueTiming:        ['paymentTermsSet'],
  dueDays:          ['paymentTermsSet'],
  thresholdCents:   ['paymentTermsSet'],
  deductionsText:   ['paymentTermsSet'],
  reportDays:       ['paymentTermsSet'],
  gstApplies:       ['paymentTermsSet'],
};

/** Format a raw fee field value for display in a system thread message. */
function formatFeeFieldValue(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (key === 'amountCents' || key === 'thresholdCents' || key === 'ticketPriceCents') {
    const d = (value as number) / 100;
    return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
  }
  if (key === 'doorPercent') return `${value}%`;
  if (key === 'gstApplies')  return value ? 'yes' : 'no';
  if (key === 'dueTiming')   return value === 'on_night' ? 'on the night' : 'within days';
  return String(value);
}

/** Maps payment model strings (legacy and current) to a FeeType value. */
function parseFeeType(s: string | null | undefined): FeeType | null {
  if (!s) return null;
  const v = s.toLowerCase().replace(/[\s_\-+]/g, '');
  if (v === 'flat' || v === 'flatfee' || v === 'setfee' || v === 'set') return 'flat';
  if (v === 'doorsplit' || v === 'door')                                  return 'door_split';
  if (v.startsWith('guarantee') || v === 'guaranteesplit')                return 'guarantee_vs_door';
  if (v === 'ticketsplit' || v === 'ticketsalessplit' || v.startsWith('ticket')) return 'ticket_split';
  if (v === 'bartab' || v === 'bar' || v === 'barsplit')                  return 'door_split';
  if (v.includes('unpaid') || v.includes('exposure') || v === 'free' || v === 'volunteer') return 'unpaid';
  if (v === 'negotiable' || v === 'other')                                return 'other';
  return null;
}

function StatusBadge({ status, isVenue }: { status: string; isVenue: boolean }) {
  const cfg = getStatusCfg(status, isVenue);
  return (
    <View style={sb.wrap}>
      <Text style={[sb.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start', borderWidth: 1, borderColor: '#d0ccc7', backgroundColor: '#ffffff',
  },
  text: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
});

// ── Booking stages ──────────────────────────────────────────────────────────

type StageKey =
  | 'enquirySent' | 'discussing' | 'gigDetails' | 'techRiderReviewed'
  | 'supportActsConfirmed' | 'setTimesLocked' | 'paymentTermsSet'
  | 'hospitalityConfirmed' | 'confirmedPending'
  | 'confirmedBooked' | 'performed' | 'paymentSettled';

type StageControl = 'auto' | 'venue' | 'artist' | 'both';
type StageStatus  = 'complete' | 'waiting_venue' | 'waiting_artist' | 'pending' | 'skipped';
type StageData    = { venueConfirmed?: boolean; artistConfirmed?: boolean; skipped?: boolean };
type StageDef     = { key: StageKey; label: string; control: StageControl };

const BOOKING_STAGES: StageDef[] = [
  { key: 'enquirySent',          label: 'Enquiry Sent',           control: 'auto'   },
  { key: 'discussing',           label: 'Discussing',             control: 'auto'   },
  { key: 'gigDetails',           label: 'General Gig Details',    control: 'both'   },
  { key: 'techRiderReviewed',    label: 'Tech Rider Reviewed',    control: 'venue'  },
  { key: 'supportActsConfirmed', label: 'Support Acts Confirmed', control: 'both'   },
  { key: 'setTimesLocked',       label: 'Set Times Locked',       control: 'both'   },
  { key: 'paymentTermsSet',      label: 'Payment Terms',          control: 'both'   },
  { key: 'hospitalityConfirmed', label: 'Hospitality Confirmed',  control: 'venue'  },
  { key: 'confirmedPending',     label: 'Confirmed: Pending',     control: 'auto'   },
  { key: 'confirmedBooked',      label: 'Confirmed: Booked',      control: 'auto'   },
  { key: 'performed',            label: 'Performed',              control: 'both'   },
  { key: 'paymentSettled',       label: 'Payment Settled',        control: 'both'   },
];


function computeStageStatus(
  key: StageKey,
  control: StageControl,
  data: StageData | undefined,
  enquiry: Enquiry,
): StageStatus {
  if (data?.skipped) return 'skipped';
  // gigDetails: both parties default to confirmed unless they have explicitly set false.
  // Sending the enquiry implies agreement on date/time, so no action is needed unless
  // someone actively undoes it.
  if (key === 'gigDetails') {
    const vc = data?.venueConfirmed  !== false;
    const ac = data?.artistConfirmed !== false;
    if (vc && ac)   return 'complete';
    if (vc && !ac)  return 'waiting_artist';
    if (!vc && ac)  return 'waiting_venue';
    return 'pending';
  }
  if (control === 'auto') {
    const norm = normalizeEnquiryStatus(enquiry.status);
    if (key === 'enquirySent')      return 'complete';
    if (key === 'discussing')       return (norm === 'discussing' || norm === 'confirmed') ? 'complete' : 'pending';
    if (key === 'confirmedPending') return norm === 'confirmed' ? 'complete' : 'pending';
    if (key === 'confirmedBooked')  return (!!(enquiry as any).gigId && norm === 'confirmed') ? 'complete' : 'pending';
    return 'pending';
  }
  if (control === 'venue')  return data?.venueConfirmed  ? 'complete' : 'pending';
  if (control === 'artist') return data?.artistConfirmed ? 'complete' : 'pending';
  const vc = !!data?.venueConfirmed, ac = !!data?.artistConfirmed;
  if (vc && ac) return 'complete';
  if (vc)       return 'waiting_artist';
  if (ac)       return 'waiting_venue';
  return 'pending';
}

function countDoneStages(enquiry: Enquiry): number {
  const map = (enquiry as any).stages as Record<string, StageData> | undefined;
  return BOOKING_STAGES.filter(s => {
    const d = map?.[s.key];
    return !d?.skipped && computeStageStatus(s.key, s.control, d, enquiry) === 'complete';
  }).length;
}

function buildGoogleCalendarUrl(enquiry: Enquiry): string {
  const { date, time, setLength } = enquiry.requestedSlot;
  const title    = encodeURIComponent(`${enquiry.bandName} @ ${enquiry.venueName}`);
  const location = encodeURIComponent(enquiry.venueName);
  const details  = encodeURIComponent('GigMatch booking');

  let startStr = '';
  let endStr   = '';

  if (date) {
    const dateBase = date.split('T')[0];
    const match    = time ? time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i) : null;
    if (match) {
      let h  = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ap = match[3].toUpperCase();
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h  = 0;
      const start = new Date(`${dateBase}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
      const lenMatch = setLength?.match(/(\d+)/);
      const mins     = lenMatch ? parseInt(lenMatch[1], 10) : 60;
      const end      = new Date(start.getTime() + mins * 60000);
      const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      startStr = fmt(start);
      endStr   = fmt(end);
    } else {
      // No parseable time — use all-day format
      startStr = dateBase.replace(/-/g, '');
      endStr   = startStr;
    }
  }

  const dates = startStr && endStr ? `&dates=${startStr}/${endStr}` : '';
  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}${dates}&details=${details}&location=${location}`;
}

function buildEnquiryICS(enquiry: Enquiry): string | null {
  const cal = calendarDatesFromEnquiry(enquiry);
  if (!cal) return null;
  const { start, end } = cal;
  const fmtUtc  = (d: Date) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const esc     = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const uid     = (enquiry as any).gigId ? `${(enquiry as any).gigId}@gigmatch.com.au` : `${Date.now()}@gigmatch.com.au`;
  const summary = `${enquiry.bandName} @ ${enquiry.venueName}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GigMatch//GigMatch Gigs//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmtUtc(start)}`,
    `DTEND:${fmtUtc(end)}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(enquiry.venueName)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadEnquiryICS(enquiry: Enquiry) {
  if (Platform.OS !== 'web') return;
  const content = buildEnquiryICS(enquiry);
  if (!content) return;
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'gigmatch-gig.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Date separator ─────────────────────────────────────────────────────────

function DateSep({ label }: { label: string }) {
  return (
    <View style={ds.wrap}>
      <Text style={ds.text}>{label}</Text>
    </View>
  );
}
const ds = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: 8 },
  text: { fontSize: 11, color: '#aaaaaa', fontWeight: '600' },
});

// ── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ photoUrl, name, size }: { photoUrl?: string | null; name: string; size: number }) {
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e8e8e8' }}
      />
    );
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#999999' }}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

// ── AvatarStack — overlapping avatars for group gig tiles ──────────────────

function AvatarStack({
  participants,
  venuePhoto,
  size = 36,
}: {
  participants: Participant[];
  venuePhoto: string | null;
  size?: number;
}) {
  // Show venue first, then up to 2 more, then +N badge
  const active = participants.filter(p => p.role !== 'venue' && (p.state === 'confirmed' || p.state === 'invited'));
  const shown  = active.slice(0, 2);
  const extra  = active.length - shown.length;
  const overlap = Math.round(size * 0.4);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', width: size + (shown.length) * (size - overlap) + (extra > 0 ? size * 0.6 : 0) }}>
      {/* Venue avatar */}
      <View style={{ zIndex: 10, borderRadius: size / 2, borderWidth: 2, borderColor: '#ffffff' }}>
        <Avatar photoUrl={venuePhoto} name="Venue" size={size} />
      </View>
      {shown.map((p, i) => (
        <View
          key={p.id}
          style={{ marginLeft: -overlap, zIndex: 9 - i, borderRadius: size / 2, borderWidth: 2, borderColor: '#ffffff' }}
        >
          <Avatar photoUrl={p.photoUrl} name={p.displayName} size={size} />
        </View>
      ))}
      {extra > 0 && (
        <View style={{
          marginLeft: -overlap, zIndex: 1,
          width: size * 0.75, height: size * 0.75, borderRadius: size * 0.375,
          backgroundColor: '#e0e0e0', alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: '#ffffff',
        }}>
          <Text style={{ fontSize: size * 0.28, fontWeight: '700', color: '#666666' }}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// ── Agent roster strip ─────────────────────────────────────────────────────

function AgentRosterStrip({
  roster,
  enquiries,
  selectedId,
  onSelect,
  onAdd,
  colors,
}: {
  roster: RosterEntry[];
  enquiries: Enquiry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  colors: any;
}) {
  function countFor(entry: RosterEntry) {
    return enquiries.filter(e =>
      entry.type === 'artist' ? e.createdBy === entry.id : e.venueId === entry.id
    ).filter(e => e.status !== 'declined' && e.status !== 'cancelled').length;
  }
  const allCount = enquiries.filter(e => e.status !== 'declined' && e.status !== 'cancelled').length;

  return (
    <View style={[rs.wrap, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
      <Text style={[rs.label, { color: colors.greyLight }]}>YOUR ROSTER</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rs.row}>
        {/* All */}
        <TouchableOpacity style={rs.circle} onPress={() => onSelect(null)} activeOpacity={0.75}>
          <View style={[rs.avatar, selectedId === null && rs.avatarSelected, { backgroundColor: '#e8e8e8' }]}>
            <Text style={[rs.avatarText, { color: selectedId === null ? Colors.orange : '#999999' }]}>All</Text>
            {allCount > 0 && (
              <View style={rs.badge}><Text style={rs.badgeText}>{allCount}</Text></View>
            )}
          </View>
          <Text style={[rs.name, selectedId === null && { fontWeight: '700', color: colors.black }]} numberOfLines={1}>All</Text>
        </TouchableOpacity>

        {/* Roster entries */}
        {roster.map(entry => {
          const count = countFor(entry);
          const isSelected = selectedId === entry.id;
          return (
            <TouchableOpacity key={entry.id} style={rs.circle} onPress={() => onSelect(entry.id)} activeOpacity={0.75}>
              <View style={[rs.avatar, isSelected && rs.avatarSelected, { backgroundColor: '#e8e8e8' }]}>
                <Text style={[rs.avatarText, { color: isSelected ? Colors.orange : '#999999' }]}>{getInitials(entry.name)}</Text>
                {count > 0 && (
                  <View style={rs.badge}><Text style={rs.badgeText}>{count}</Text></View>
                )}
              </View>
              <Text style={[rs.name, isSelected && { fontWeight: '700', color: colors.black }]} numberOfLines={1}>
                {entry.name.length > 10 ? entry.name.slice(0, 9) + '…' : entry.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Add button */}
        <TouchableOpacity style={rs.circle} onPress={onAdd} activeOpacity={0.75}>
          <View style={[rs.avatar, rs.avatarAdd]}>
            <Text style={[rs.avatarText, { color: '#bbbbbb', fontSize: 22, fontWeight: '300' }]}>+</Text>
          </View>
          <Text style={rs.name}> </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const rs = StyleSheet.create({
  wrap:  { paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, paddingHorizontal: 16 },
  row:   { paddingHorizontal: 12, gap: 6 },
  circle:{ width: 72, alignItems: 'center', gap: 6 },
  avatar:{
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  avatarSelected: { borderWidth: 2.5, borderColor: Colors.orange },
  avatarAdd:      { borderWidth: 2, borderColor: '#cccccc', borderStyle: 'dashed' as any, backgroundColor: 'transparent' },
  avatarText: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 11, color: '#888888', textAlign: 'center' },
  badge:{
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#ffffff',
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#ffffff' },
});

// ── Agent viewing banner ────────────────────────────────────────────────────

function AgentViewingBanner({
  entry,
  onSwitch,
  colors,
}: {
  entry: RosterEntry | null;
  onSwitch: () => void;
  colors: any;
}) {
  return (
    <View style={[avb.wrap, { backgroundColor: '#fff7ed', borderBottomColor: '#f5e0c8' }]}>
      {entry ? (
        <>
          <View style={avb.left}>
            <Text style={avb.eyebrow}>{entry.type === 'venue' ? 'MANAGING' : 'REPLYING AS'}</Text>
            <View style={avb.nameRow}>
              <View style={avb.miniAvatar}>
                <Text style={avb.miniAvatarText}>{getInitials(entry.name)}</Text>
              </View>
              <Text style={[avb.name, { color: colors.black }]}>{entry.name}</Text>
            </View>
          </View>
          <TouchableOpacity style={avb.switchBtn} onPress={onSwitch} activeOpacity={0.75}>
            <Text style={avb.switchBtnText}>Switch</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={avb.left}>
          <Text style={avb.eyebrow}>VIEWING</Text>
          <Text style={[avb.name, { color: colors.black }]}>All managed clients</Text>
        </View>
      )}
    </View>
  );
}

const avb = StyleSheet.create({
  wrap:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  left:       { gap: 2 },
  eyebrow:    { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.orange, textTransform: 'uppercase' },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e8e8e8', alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { fontSize: 10, fontWeight: '700', color: '#888888' },
  name:       { fontSize: 15, fontWeight: '700' },
  switchBtn:  { borderWidth: 1.5, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  switchBtnText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
});

// ── Deal sheet bar (horizontal) ────────────────────────────────────────────

function DealSheetGrid({ enquiry, onDetails }: { enquiry: Enquiry; onDetails: () => void }) {
  const { setLength, time, date, day } = enquiry.requestedSlot;
  const dateStr   = date ? fmtSlotDateFull(date) : (day || '—');
  const setStr    = [time, setLength].filter(Boolean).join(' · ') || '—';
  const venueTzLbl = tzLabel(getVenueTz(enquiry));

  return (
    <View style={dg.bar}>
      <View style={[dg.col, dg.colDivider]}>
        <Text style={dg.label}>DATE</Text>
        <Text style={dg.value} numberOfLines={1}>{dateStr}</Text>
      </View>
      <View style={[dg.col, dg.colDivider]}>
        <Text style={dg.label}>SET</Text>
        <Text style={dg.value} numberOfLines={1}>{setStr}</Text>
        {venueTzLbl ? <Text style={dg.tzNote}>{venueTzLbl}</Text> : null}
      </View>
      <TouchableOpacity style={dg.detailsBtn} onPress={onDetails} activeOpacity={0.7}>
        <Text style={dg.detailsText}>More Details →</Text>
      </TouchableOpacity>
    </View>
  );
}

const dg = StyleSheet.create({
  bar:         { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eeeeee', marginTop: 12 },
  col:         { flex: 1, paddingVertical: 10, paddingHorizontal: 8 },
  colDivider:  { borderRightWidth: 1, borderRightColor: '#eeeeee' },
  label:       { fontSize: 9, fontWeight: '700', color: '#aaaaaa', letterSpacing: 0.7, marginBottom: 4, textTransform: 'uppercase' as const },
  value:       { fontSize: 13, fontWeight: '700', color: '#111111' },
  tzNote:      { fontSize: 10, fontWeight: '500', color: '#aaaaaa', marginTop: 2 },
  detailsBtn:  { paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  detailsText: { fontSize: 13, fontWeight: '700', color: Colors.orange },
});

// ── GigPaymentCardWrapper — listens to the gig doc and renders PaymentCard ───

function GigPaymentCardWrapper({
  gigId, uid, isVenue, otherPartyName, onOpenThread, colors,
}: {
  gigId: string;
  uid: string;
  isVenue: boolean;
  otherPartyName: string;
  onOpenThread?: () => void;
  colors: any;
}) {
  const [gig, setGig] = useState<(Gig & { id: string }) | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'gigs', gigId), snap => {
      if (snap.exists()) setGig({ id: snap.id, ...snap.data() } as Gig & { id: string });
    });
    return unsub;
  }, [gigId]);

  if (!gig) return null;
  return (
    <PaymentCard
      gig={gig}
      uid={uid}
      isVenue={isVenue}
      otherPartyName={otherPartyName}
      onOpenThread={onOpenThread}
    />
  );
}

// ── Enquiry header (compact) ───────────────────────────────────────────────

function EnquiryHeader({ enquiry, isVenue, onBack, onDelete, onScrollToProfile, onScrollToMusic, onScrollToTech, participants, currentUserUid, onOpenSubThread, onInvite, onRemove }: {
  enquiry: Enquiry; isVenue: boolean; onBack?: () => void; onDelete?: () => void;
  onScrollToProfile?: () => void; onScrollToMusic?: () => void; onScrollToTech?: () => void;
  participants?: Participant[];
  currentUserUid?: string;
  onOpenSubThread?: OnOpenSubThread;
  onInvite?: () => void;
  onRemove?: (p: Participant) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const { day, date, time, slotType, setLength } = enquiry.requestedSlot;
  const dateStr    = date ? fmtSlotDate(date) : '';
  const dateStrFull = date ? fmtSlotDateFull(date) : (day || '—');
  const slotStr    = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const timeStr    = time || '—';
  const venueTzLbl = tzLabel(getVenueTz(enquiry));
  const billing    = slotType || '—';
  const savedFee   = (enquiry as any).fee as { type?: string; amountCents?: number; doorPercent?: number; ticketPrice?: number; notes?: string } | null | undefined;

  const [menuOpen,    setMenuOpen]    = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notes,            setNotes]            = useState<string>((enquiry as any).importantNotes ?? '');
  const [notesDoc,         setNotesDoc]         = useState<{ url: string; name: string } | null>((enquiry as any).notesDoc ?? null);
  const [notesDocUploading,setNotesDocUploading]= useState(false);
  const [contractLoading,  setContractLoading]  = useState(false);
  const [showSignModal,    setShowSignModal]    = useState(false);
  const [signAgreed,       setSignAgreed]       = useState(false);
  const [signName,         setSignName]         = useState('');
  const [signingLoading,   setSigningLoading]   = useState(false);
  const [loadInTime,       setLoadInTime]       = useState<string>(enquiry.loadInTime ?? '');
  const [soundCheckTime,   setSoundCheckTime]   = useState<string>(enquiry.soundCheckTime ?? '');
  const [editSetLength,    setEditSetLength]     = useState<string>(enquiry.requestedSlot.setLength ?? '');
  const [postGigNotes,     setPostGigNotes]     = useState<string>((enquiry as any).postGigNotes ?? '');
  const [postGigAttendance,setPostGigAttendance]= useState<string>((enquiry as any).postGigAttendance != null ? String((enquiry as any).postGigAttendance) : '');

  // ── Structured fee negotiation fields (stored on enquiry as enquiryFee) ──
  const _ef0 = (enquiry as any).enquiryFee as Partial<EnquiryFee> | null | undefined;
  const [feeAmountStr,    setFeeAmountStr]    = useState<string>(_ef0?.amountCents    != null ? String(_ef0.amountCents    / 100) : '');
  const [feeDoorPct,      setFeeDoorPct]      = useState<string>(_ef0?.doorPercent    != null ? String(_ef0.doorPercent)          : '');
  const [feeTicketStr,    setFeeTicketStr]    = useState<string>(_ef0?.ticketPriceCents != null ? String(_ef0.ticketPriceCents / 100) : '');
  const [feeThresholdStr, setFeeThresholdStr] = useState<string>(_ef0?.thresholdCents != null ? String(_ef0.thresholdCents / 100) : '');
  const [feeDeductions,   setFeeDeductions]   = useState<string>(_ef0?.deductionsText ?? '');
  const [feeReportDays,   setFeeReportDays]   = useState<string>(_ef0?.reportDays     != null ? String(_ef0.reportDays)           : '');
  const [feeDueTiming,    setFeeDueTiming]    = useState<DueTiming | null>(_ef0?.dueTiming ?? null);
  const [feeDueDays,      setFeeDueDays]      = useState<string>(_ef0?.dueDays        != null ? String(_ef0.dueDays)              : '');
  const [feeGstApplies,   setFeeGstApplies]   = useState<boolean>(_ef0?.gstApplies    ?? false);
  const [feeChannel,      setFeeChannel]      = useState<string>(_ef0?.channel        ?? '');
  const [feeUnpaidNotes,  setFeeUnpaidNotes]  = useState<string>(_ef0?.unpaidNotes    ?? '');
  const [artistPayInfo,   setArtistPayInfo]   = useState<{
    abnStatus: string; gstRegistered: boolean; canProvideInvoice: boolean; abn: string;
  } | null>(null);
  const [venueRequiresAbn, setVenueRequiresAbn] = useState<boolean>(false);

  // Refs for debounced auto-save
  const setLengthRef       = useRef(enquiry.requestedSlot.setLength ?? '');
  const loadInRef          = useRef(enquiry.loadInTime ?? '');
  const soundCheckRef      = useRef(enquiry.soundCheckTime ?? '');
  const postGigNotesRef    = useRef((enquiry as any).postGigNotes ?? '');
  const postGigAttRef      = useRef((enquiry as any).postGigAttendance != null ? String((enquiry as any).postGigAttendance) : '');
  // One debounce ref per field so a pending edit in one field does not block
  // external sync for the other two.
  const setLengthDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadInDebounce     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundCheckDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesDebounce      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postGigDebounce    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-field debounce map for enquiryFee fields
  const feeDebounceMap     = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const feeValueMap        = useRef<Map<string, any>>(new Map());
  // Captures pre-edit state (old value + which stages were confirmed) on the first
  // keystroke of each debounce window, so the atomic update can reset them.
  const feeEditStateMap    = useRef<Map<string, { oldValue: any; stagesToReset: StageKey[] }>>(new Map());

  // Sync editable schedule fields when Firestore updates them externally
  // (e.g. the venue edits a recurring gig's slot details from another session).
  // Each effect guards only against its own in-flight save.
  useEffect(() => {
    if (setLengthDebounce.current) return;
    const v = enquiry.requestedSlot.setLength ?? '';
    setEditSetLength(v);
    setLengthRef.current = v;
  }, [enquiry.requestedSlot.setLength]);

  useEffect(() => {
    if (loadInDebounce.current) return;
    const v = enquiry.loadInTime ?? '';
    setLoadInTime(v);
    loadInRef.current = v;
  }, [enquiry.loadInTime]);

  useEffect(() => {
    if (soundCheckDebounce.current) return;
    const v = enquiry.soundCheckTime ?? '';
    setSoundCheckTime(v);
    soundCheckRef.current = v;
  }, [enquiry.soundCheckTime]);

  // Sync enquiryFee fields from Firestore when not being edited locally
  useEffect(() => {
    const snap = (enquiry as any).enquiryFee as Partial<EnquiryFee> | null | undefined;
    if (!snap) return;
    const dm = feeDebounceMap.current;
    if (!dm.has('amountCents')     && snap.amountCents      != null) setFeeAmountStr(String(snap.amountCents    / 100));
    if (!dm.has('doorPercent')     && snap.doorPercent      != null) setFeeDoorPct(  String(snap.doorPercent));
    if (!dm.has('ticketPriceCents')&& snap.ticketPriceCents != null) setFeeTicketStr(String(snap.ticketPriceCents / 100));
    if (!dm.has('thresholdCents')  && snap.thresholdCents   != null) setFeeThresholdStr(String(snap.thresholdCents / 100));
    if (!dm.has('deductionsText'))  setFeeDeductions( snap.deductionsText ?? '');
    if (!dm.has('reportDays')      && snap.reportDays       != null) setFeeReportDays(String(snap.reportDays));
    if (!dm.has('dueTiming'))       setFeeDueTiming(  snap.dueTiming   ?? null);
    if (!dm.has('dueDays')         && snap.dueDays          != null) setFeeDueDays(String(snap.dueDays));
    if (!dm.has('gstApplies'))      setFeeGstApplies( snap.gstApplies  ?? false);
    if (!dm.has('channel'))         setFeeChannel(    snap.channel     ?? '');
    if (!dm.has('unpaidNotes'))     setFeeUnpaidNotes(snap.unpaidNotes ?? '');
  }, [(enquiry as any).enquiryFee]);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const { width: windowWidth } = useWindowDimensions();

  const [paymentFetched,       setPaymentFetched]       = useState(false);
  const [legalFetched,         setLegalFetched]         = useState(false);
  const [myLegalIdentity,      setMyLegalIdentity]      = useState<LegalIdentity | null>(null);
  const [selectedFeeType,      setSelectedFeeType]      = useState<FeeType | null>(
    parseFeeType((enquiry as any).feeType ?? (enquiry as any).paymentModel)
  );
  const [slotSuggestedFeeTypes, setSlotSuggestedFeeTypes] = useState<FeeType[]>([]);

  async function fetchPaymentData() {
    if (paymentFetched) return;
    try {
      const artistUid = (enquiry as any).createdBy as string;
      const [venueSnap, artistSnap] = await Promise.all([
        getDoc(doc(db, 'venues', enquiry.venueId)),
        getDoc(doc(db, 'bandProfiles', artistUid)),
      ]);

      if (venueSnap.exists()) {
        const venueData = venueSnap.data();
        setVenueRequiresAbn(!!venueData.payment?.requiresArtistAbn);
        const { day, time } = enquiry.requestedSlot;
        const slots: any[] = venueData.slots?.[day] || [];
        const match = slots.find((s: any) => s.time === time && !s.date);
        // Pre-populate load in / sound check from the slot if the enquiry has no saved value
        if (!enquiry.loadInTime && match?.loadIn) setLoadInTime(match.loadIn);
        if (!enquiry.soundCheckTime && match?.soundcheck) setSoundCheckTime(match.soundcheck);
        // Build suggested fee types from the slot's paymentModels array (or singular paymentModel)
        const rawModels: string[] = match?.paymentModels ?? (match?.paymentModel ? [match.paymentModel] : []);
        const suggested = rawModels.map(parseFeeType).filter((v): v is FeeType => v !== null);
        setSlotSuggestedFeeTypes(suggested);
        // Pre-select if nothing already saved on the enquiry
        if (!selectedFeeType && suggested.length > 0) {
          setSelectedFeeType(suggested[0]);
        }
      }

      if (artistSnap.exists()) {
        const aPay = artistSnap.data().payment || {};
        setArtistPayInfo({
          abnStatus:        aPay.abnStatus || (aPay.abn ? 'has_abn' : ''),
          gstRegistered:    !!aPay.gstRegistered,
          canProvideInvoice:!!aPay.canProvideInvoice,
          abn:              aPay.abn || '',
        });
        // Prefill GST from artist profile if not yet set on this enquiry
        const efSnap = (enquiry as any).enquiryFee as Partial<EnquiryFee> | null | undefined;
        if (efSnap?.gstApplies === undefined && aPay.gstRegistered !== undefined) {
          const v = !!aPay.gstRegistered;
          setFeeGstApplies(v);
          updateDoc(doc(db, 'inquiries', enquiry.id), { 'enquiryFee.gstApplies': v }).catch(() => {});
        }
      }
    } catch {}
    setPaymentFetched(true);
  }

  async function fetchLegalReadiness() {
    if (legalFetched || !currentUserUid) return;
    try {
      const legalPath = isVenue
        ? doc(db, 'venues', enquiry.venueId, 'private', 'legal')
        : doc(db, 'bandProfiles', currentUserUid, 'private', 'legal');
      const snap = await getDoc(legalPath);
      setMyLegalIdentity(snap.exists() ? { ...BLANK_LEGAL, ...snap.data() } as LegalIdentity : { ...BLANK_LEGAL });
    } catch {}
    setLegalFetched(true);
  }

  function openDetails() {
    setDetailsOpen(true);
    fetchPaymentData();
    fetchLegalReadiness();
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }

  function closeDetails(onClosed?: () => void) {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start(() => {
      setDetailsOpen(false);
      onClosed?.();
    });
  }

  function autoSaveSetLength() {
    if (setLengthDebounce.current) clearTimeout(setLengthDebounce.current);
    setLengthDebounce.current = setTimeout(async () => {
      setLengthDebounce.current = null;
      const setLen = setLengthRef.current.trim();
      if (!setLen) return;
      const oldLen = enquiry.requestedSlot.setLength ?? '';
      const resetGigDetails = stageIsConfirmedByMe('gigDetails');
      const update: Record<string, any> = { 'requestedSlot.setLength': setLen };
      if (resetGigDetails) Object.assign(update, buildStageReset('gigDetails'));
      await updateDoc(doc(db, 'inquiries', enquiry.id), update).catch(() => {});
      const gigId = (enquiry as any).gigId as string | undefined;
      if (gigId) {
        const mins = parseInt(setLen.replace(/\D/g, ''), 10);
        if (!isNaN(mins)) {
          await updateDoc(doc(db, 'gigs', gigId), { setLengthMinutes: mins }).catch(() => {});
        }
      }
      if (resetGigDetails && oldLen !== setLen) {
        const party = isVenue ? 'Venue' : 'Artist';
        postSystemMessage(enquiry.id, `Set length updated (${oldLen || 'not set'} to ${setLen}). ${party} confirmation for Gig Details cleared.`).catch(() => {});
      }
    }, 800);
  }

  function autoSaveLoadIn() {
    if (loadInDebounce.current) clearTimeout(loadInDebounce.current);
    loadInDebounce.current = setTimeout(async () => {
      loadInDebounce.current = null;
      const newVal = loadInRef.current.trim();
      const oldVal = enquiry.loadInTime ?? '';
      const resetSetTimes = stageIsConfirmedByMe('setTimesLocked');
      const update: Record<string, any> = { loadInTime: newVal };
      if (resetSetTimes) Object.assign(update, buildStageReset('setTimesLocked'));
      await updateDoc(doc(db, 'inquiries', enquiry.id), update).catch(() => {});
      if (resetSetTimes && oldVal !== newVal) {
        const party = isVenue ? 'Venue' : 'Artist';
        postSystemMessage(enquiry.id, `Load-in updated (${oldVal || 'not set'} to ${newVal || 'not set'}). ${party} confirmation for Set Times cleared.`).catch(() => {});
      }
    }, 800);
  }

  function autoSaveSoundCheck() {
    if (soundCheckDebounce.current) clearTimeout(soundCheckDebounce.current);
    soundCheckDebounce.current = setTimeout(async () => {
      soundCheckDebounce.current = null;
      const newVal = soundCheckRef.current.trim();
      const oldVal = enquiry.soundCheckTime ?? '';
      const resetSetTimes = stageIsConfirmedByMe('setTimesLocked');
      const update: Record<string, any> = { soundCheckTime: newVal };
      if (resetSetTimes) Object.assign(update, buildStageReset('setTimesLocked'));
      await updateDoc(doc(db, 'inquiries', enquiry.id), update).catch(() => {});
      if (resetSetTimes && oldVal !== newVal) {
        const party = isVenue ? 'Venue' : 'Artist';
        postSystemMessage(enquiry.id, `Sound check updated (${oldVal || 'not set'} to ${newVal || 'not set'}). ${party} confirmation for Set Times cleared.`).catch(() => {});
      }
    }, 800);
  }

  function autoSaveNotes(val: string) {
    if (notesDebounce.current) clearTimeout(notesDebounce.current);
    notesDebounce.current = setTimeout(() => {
      updateDoc(doc(db, 'inquiries', enquiry.id), { importantNotes: val.trim() }).catch(() => {});
    }, 800);
  }

  /** Returns true if the current user has confirmed the given stage (or it was skipped). */
  function stageIsConfirmedByMe(key: StageKey): boolean {
    const map = (enquiry as any).stages as Record<string, StageData> | undefined;
    const d = map?.[key];
    if (!d) return false;
    if (d.skipped) return true;
    return isVenue ? !!d.venueConfirmed : !!d.artistConfirmed;
  }

  /** Returns the Firestore dot-path update fields to clear the current user's side of a stage.
   *  The other party's confirmation is left intact — they will need to re-review. */
  function buildStageReset(key: StageKey): Record<string, any> {
    const myKey = isVenue ? 'venueConfirmed' : 'artistConfirmed';
    return {
      [`stages.${key}.${myKey}`]: false,
      [`stages.${key}.skipped`]:  false,
    };
  }

  /** Debounce-save a single enquiryFee field. Atomically resets any confirmed stage
   *  that owns the field, and posts a system thread message when that happens. */
  function autoSaveFeeField(key: string, value: any) {
    // On the first keystroke of a new debounce window, capture pre-edit state.
    if (!feeDebounceMap.current.has(key)) {
      const ef = (enquiry as any).enquiryFee as Partial<EnquiryFee> | null | undefined;
      const oldValue = ef?.[key as keyof EnquiryFee] ?? null;
      const owned = (FEE_FIELD_STAGE[key] ?? []) as StageKey[];
      const stagesToReset = owned.filter(sk => stageIsConfirmedByMe(sk));
      feeEditStateMap.current.set(key, { oldValue, stagesToReset });
    }

    feeValueMap.current.set(key, value);
    const existing = feeDebounceMap.current.get(key);
    if (existing) clearTimeout(existing);

    const t = setTimeout(async () => {
      feeDebounceMap.current.delete(key);
      const newValue   = feeValueMap.current.get(key) ?? null;
      const editState  = feeEditStateMap.current.get(key);
      feeEditStateMap.current.delete(key);

      const update: Record<string, any> = { [`enquiryFee.${key}`]: newValue };
      const stagesToReset = editState?.stagesToReset ?? [];
      for (const sk of stagesToReset) Object.assign(update, buildStageReset(sk));

      await updateDoc(doc(db, 'inquiries', enquiry.id), update).catch(() => {});

      if (stagesToReset.length > 0 && editState?.oldValue !== newValue) {
        const label    = FEE_FIELD_LABELS[key] ?? key;
        const oldStr   = formatFeeFieldValue(key, editState?.oldValue ?? null);
        const newStr   = formatFeeFieldValue(key, newValue);
        const party    = isVenue ? 'Venue' : 'Artist';
        const stages   = stagesToReset.map(() => 'Payment Terms').join(' and ');
        postSystemMessage(enquiry.id, `${label} changed (${oldStr} to ${newStr}). ${party} confirmation for ${stages} cleared.`).catch(() => {});
      }
    }, 800);

    feeDebounceMap.current.set(key, t);
  }

  /** Switch fee type chip: atomically saves the type, clears inapplicable fields,
   *  resets any confirmed payment stages, and posts a system thread message. */
  async function handleFeeTypeChange(ft: FeeType) {
    const oldFt = selectedFeeType;
    setSelectedFeeType(ft);

    // Build one atomic update object so everything lands in a single write.
    const update: Record<string, any> = { feeType: ft };

    // Clear amount/guarantee when switching away from types that use them
    if (ft !== 'flat' && ft !== 'guarantee_vs_door') {
      setFeeAmountStr('');
      update['enquiryFee.amountCents'] = null;
    }
    // Clear percentage when switching to a type that doesn't use it
    if (ft !== 'door_split' && ft !== 'guarantee_vs_door' && ft !== 'ticket_split') {
      setFeeDoorPct('');
      update['enquiryFee.doorPercent'] = null;
    }
    // Clear ticket-specific fields
    if (ft !== 'ticket_split') {
      setFeeTicketStr('');
      setFeeReportDays('');
      update['enquiryFee.ticketPriceCents'] = null;
      update['enquiryFee.reportDays']       = null;
    }
    // Clear guarantee threshold
    if (ft !== 'guarantee_vs_door') {
      setFeeThresholdStr('');
      update['enquiryFee.thresholdCents'] = null;
    }
    // Clear deductions
    if (ft !== 'door_split' && ft !== 'guarantee_vs_door') {
      setFeeDeductions('');
      update['enquiryFee.deductionsText'] = '';
    }
    // Clear unpaid notes when switching away from unpaid
    if (ft !== 'unpaid') {
      setFeeUnpaidNotes('');
      update['enquiryFee.unpaidNotes'] = '';
    }
    // Clear timing fields for unpaid (not applicable)
    if (ft === 'unpaid') {
      setFeeDueTiming(null);
      setFeeDueDays('');
      setFeeGstApplies(false);
      update['enquiryFee.dueTiming']   = null;
      update['enquiryFee.dueDays']     = null;
      update['enquiryFee.gstApplies']  = false;
    }

    // Cancel any pending per-field debounces for fields we're clearing atomically,
    // so they don't overwrite the reset values when they fire later.
    for (const fieldKey of Object.keys(update)
      .filter(k => k.startsWith('enquiryFee.'))
      .map(k => k.replace('enquiryFee.', ''))) {
      const timer = feeDebounceMap.current.get(fieldKey);
      if (timer) {
        clearTimeout(timer);
        feeDebounceMap.current.delete(fieldKey);
        feeEditStateMap.current.delete(fieldKey);
        feeValueMap.current.delete(fieldKey);
      }
    }

    // Clear my confirmation for Payment Terms if I had confirmed it
    const termsConfirmed = stageIsConfirmedByMe('paymentTermsSet');
    if (termsConfirmed) Object.assign(update, buildStageReset('paymentTermsSet'));

    await updateDoc(doc(db, 'inquiries', enquiry.id), update).catch(() => {});

    // Post a system message only when the type actually changed
    if (oldFt !== ft) {
      const FEE_LABELS: Record<string, string> = {
        flat: 'Flat fee', door_split: 'Door split', guarantee_vs_door: 'Guarantee + door',
        ticket_split: 'Ticket split', unpaid: 'Unpaid', other: 'Other',
      };
      const party     = isVenue ? 'Venue' : 'Artist';
      const fromLabel = oldFt ? (FEE_LABELS[oldFt] ?? oldFt) : 'none';
      const toLabel   = FEE_LABELS[ft] ?? ft;
      const suffix = termsConfirmed ? `. ${party} confirmation for Payment Terms cleared.` : '.';
      postSystemMessage(enquiry.id, `Payment method changed from ${fromLabel} to ${toLabel}${suffix}`).catch(() => {});
    }
  }

  /**
   * Returns a short message when Payment Terms cannot be marked complete,
   * or null when all required fields are present.
   */
  function paymentTermsGateReason(): string | null {
    if (!selectedFeeType) return 'Choose a payment method first.';
    if (selectedFeeType === 'unpaid' || selectedFeeType === 'other') return null;
    if (selectedFeeType === 'door_split' || selectedFeeType === 'guarantee_vs_door' || selectedFeeType === 'ticket_split') {
      if (!feeDoorPct.trim()) return 'Enter the artist percentage.';
    }
    if (feeDueTiming === null) return 'Set when payment is due.';
    if (feeDueTiming === 'within_days' && !feeDueDays.trim()) return 'Enter the number of days.';
    return null;
  }


  function autoSavePostGig() {
    if (postGigDebounce.current) clearTimeout(postGigDebounce.current);
    postGigDebounce.current = setTimeout(async () => {
      const notes = postGigNotesRef.current;
      const att   = postGigAttRef.current;
      const updates: Record<string, any> = { postGigNotes: notes.trim() };
      const attNum = parseInt(att, 10);
      if (!isNaN(attNum)) updates.postGigAttendance = attNum;
      await updateDoc(doc(db, 'inquiries', enquiry.id), updates).catch(() => {});
    }, 800);
  }

  async function generateContract() {
    if (!currentUserUid) return;

    // On web, open a new tab BEFORE any async work — browsers block window.open()
    // called after an await, treating it as an unsolicited popup.
    let newWin: Window | null = null;
    if (Platform.OS === 'web') {
      newWin = (window as any).open('', '_blank') as Window | null;
      if (newWin) {
        newWin.document.write(
          '<html><body style="font-family:sans-serif;padding:48px;color:#444">' +
          '<p style="font-size:16px;margin:0">Generating contract\u2026</p>' +
          '</body></html>'
        );
      }
    }

    setContractLoading(true);
    try {
      const artistUid = (enquiry as any).createdBy as string;

      // Fetch public docs and current user's private legal in parallel
      const legalPath = isVenue
        ? doc(db, 'venues', enquiry.venueId, 'private', 'legal')
        : doc(db, 'bandProfiles', currentUserUid, 'private', 'legal');
      const [venueSnap, artistSnap, lSnap] = await Promise.all([
        getDoc(doc(db, 'venues', enquiry.venueId)),
        getDoc(doc(db, 'bandProfiles', artistUid)),
        getDoc(legalPath),
      ]);
      const venueData     = venueSnap.exists()   ? venueSnap.data()   : {};
      const artistProfile = artistSnap.exists()  ? artistSnap.data()  : {};
      const myLegal: LegalIdentity = lSnap.exists()
        ? { ...BLANK_LEGAL, ...lSnap.data() } as LegalIdentity
        : { ...BLANK_LEGAL };

      // Snapshot the current user's legal details onto the enquiry so the
      // other party can eventually read them (both-party contract requires this)
      const mySnapshotKey    = isVenue ? 'venueLegalSnapshot'  : 'artistLegalSnapshot';
      const otherSnapshotKey = isVenue ? 'artistLegalSnapshot' : 'venueLegalSnapshot';
      updateDoc(doc(db, 'inquiries', enquiry.id), {
        [mySnapshotKey]: { ...myLegal, snapshotAt: Date.now() },
      }).catch(() => {});

      // Read other party's snapshot if they have already generated their copy
      const otherLegalRaw = (enquiry as any)[otherSnapshotKey];
      const otherLegal: LegalIdentity = otherLegalRaw
        ? { ...BLANK_LEGAL, ...otherLegalRaw }
        : { ...BLANK_LEGAL };

      const venueLegal  = isVenue ? myLegal    : otherLegal;
      const artistLegal = isVenue ? otherLegal : myLegal;

      const supportActNames = (participants || [])
        .filter(p => p.role === 'support' && p.state === 'confirmed')
        .map(p => p.displayName)
        .filter(Boolean)
        .join(', ');

      const stageMap = (enquiry as any).stages as Record<string, { venueConfirmed?: boolean; artistConfirmed?: boolean; skipped?: boolean }> | undefined;
      const techRiderStage = stageMap?.['techRiderReviewed'];
      const techRiderConfirmed = !!(techRiderStage?.skipped || techRiderStage?.venueConfirmed);

      const myLegalOk    = myLegal ? isLegalIdentityComplete(myLegal) : false;
      const otherLegalOk = isLegalIdentityComplete(otherLegal);
      const contractIsDraft = !myLegalOk || !otherLegalOk
        || computeStageStatus('gigDetails',     'both',   stageMap?.['gigDetails'],     enquiry) !== 'complete'
        || computeStageStatus('setTimesLocked', 'both',   stageMap?.['setTimesLocked'], enquiry) !== 'complete'
        || computeStageStatus('paymentTermsSet','both',   stageMap?.['paymentTermsSet'],enquiry) !== 'complete'
        || !techRiderConfirmed;

      const enqVenueSig  = (enquiry as any).venueSignature  as { signatoryName: string; signedAt: number } | null | undefined;
      const enqArtistSig = (enquiry as any).artistSignature as { signatoryName: string; signedAt: number } | null | undefined;

      const html = buildContractHtml({
        enquiry,
        venueData,
        artistProfile,
        venueLegal,
        artistLegal,
        setLength:         editSetLength,
        loadIn:            loadInTime,
        soundCheck:        soundCheckTime,
        supportActs:       supportActNames,
        isDraft:           contractIsDraft,
        techRiderConfirmed,
        venueSignature:    enqVenueSig,
        artistSignature:   enqArtistSig,
      });

      if (Platform.OS === 'web') {
        if (newWin) {
          newWin.document.open();
          newWin.document.write(html);
          newWin.document.close();
          newWin.focus();
        } else {
          // Popup was blocked — fall back to downloading as an HTML file
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = contractIsDraft ? 'contract-draft.html' : 'gigmatch-contract.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: '.pdf',
          dialogTitle: 'Save Contract PDF',
        });
      }
    } catch (e: any) {
      if (newWin) newWin.close();
      Alert.alert('Could not generate contract', e.message);
    } finally {
      setContractLoading(false);
    }
  }

  async function signContract() {
    if (!currentUserUid || !signName.trim() || !signAgreed) return;
    setSigningLoading(true);
    try {
      const field = isVenue ? 'venueSignature' : 'artistSignature';
      const sig = {
        signatoryName: signName.trim(),
        signedAt: Date.now(),
        uid: currentUserUid,
      };
      await updateDoc(doc(db, 'inquiries', enquiry.id), { [field]: sig });
      const party = isVenue ? 'Venue' : 'Artist';
      postSystemMessage(enquiry.id, `${party} has signed the contract.`).catch(() => {});
      setShowSignModal(false);
      setSignAgreed(false);
    } catch (e: any) {
      Alert.alert('Could not sign contract', e.message);
    } finally {
      setSigningLoading(false);
    }
  }

  async function pickNotesDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setNotesDocUploading(true);
    try {
      const asset = result.assets[0];
      const res  = await fetch(asset.uri);
      const blob = await res.blob();
      const ext  = asset.name.split('.').pop() || 'pdf';
      const ref  = sRef(storage, `enquiry-docs/${enquiry.id}/${Date.now()}.${ext}`);
      await uploadBytes(ref, blob);
      const url  = await getDownloadURL(ref);
      const newDoc = { url, name: asset.name };
      await updateDoc(doc(db, 'inquiries', enquiry.id), { notesDoc: newDoc });
      setNotesDoc(newDoc);
    } catch (e) {
      Alert.alert('Upload failed', String(e));
    } finally {
      setNotesDocUploading(false);
    }
  }

  const quickLinks = [
    { label: 'Profile',    onPress: onScrollToProfile },
    { label: 'Music',      onPress: onScrollToMusic   },
    { label: 'Tech Specs', onPress: onScrollToTech    },
  ].filter(l => l.onPress);

  const DRAWER_WIDTH = isWeb ? 340 : windowWidth;

  return (
    <>
      <View style={[eh.card, { backgroundColor: colors.bgFaint, borderBottomColor: colors.border }]}>
        <View style={eh.titleRow}>
          {onBack && (
            <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={eh.back}>←</Text>
            </TouchableOpacity>
          )}
          <View style={eh.titleInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
              <Text style={[eh.name, { color: colors.black }]} numberOfLines={1}>{who}</Text>
              <StatusBadge status={enquiry.status} isVenue={isVenue} />
            </View>
            {slotStr ? (
              <Text style={[eh.slot, { color: colors.grey }]} numberOfLines={1}>{slotStr}</Text>
            ) : null}
            {slotStr && venueTzLbl ? (
              <Text style={[eh.slot, { color: colors.greyLight, fontSize: 10 }]}>{venueTzLbl}</Text>
            ) : null}
            <View style={eh.quickLinks}>
              {quickLinks.map((l, i) => (
                <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {i > 0 && <Text style={eh.quickLinkSep}>·</Text>}
                  <TouchableOpacity onPress={l.onPress} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <Text style={eh.quickLinkText}>{l.label}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
          <TouchableOpacity onPress={openDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={eh.detailsBtn}>
            <View style={eh.detailsBtnInner}>
              <View style={eh.detailsCircle}>
                <Text style={eh.detailsCircleText}>i</Text>
              </View>
              <Text style={eh.detailsLink}>Details</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Details drawer */}
      <Modal visible={detailsOpen} transparent animationType="none" onRequestClose={() => closeDetails()}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <TouchableOpacity style={eh.drawerBackdrop} activeOpacity={1} onPress={() => closeDetails()} />
          <Animated.View style={[
            eh.drawerPanel,
            { width: DRAWER_WIDTH, backgroundColor: colors.bg, borderLeftColor: colors.border },
            { transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [DRAWER_WIDTH, 0] }) }] },
          ]}>
            {/* Drawer header */}
            <View style={[eh.drawerHeader, { borderBottomColor: colors.border, paddingTop: (isWeb ? 0 : insets.top) + 16 }]}>
              <TouchableOpacity onPress={() => closeDetails()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 60 }}>
                <Text style={[eh.drawerBack, { color: Colors.orange }]}>← Back</Text>
              </TouchableOpacity>
              <Text style={[eh.drawerTitle, { color: colors.black }]}>Details</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView contentContainerStyle={eh.drawerContent} showsVerticalScrollIndicator={false}>

              {/* Gig Info */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Gig Info</Text>
              <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Date</Text>
                  <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{dateStrFull}</Text>
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Set Time</Text>
                  <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{timeStr}</Text>
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Slot</Text>
                  <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{billing}</Text>
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Set Length</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={editSetLength}
                    onChangeText={t => { setEditSetLength(t); setLengthRef.current = t; autoSaveSetLength(); }}
                    placeholder="e.g. 45 min"
                    placeholderTextColor="#aaaaaa"
                  />
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Load In</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={loadInTime}
                    onChangeText={t => { setLoadInTime(t); loadInRef.current = t; autoSaveLoadIn(); }}
                    placeholder="e.g. 4:00 PM"
                    placeholderTextColor="#aaaaaa"
                  />
                </View>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Sound Check</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={soundCheckTime}
                    onChangeText={t => { setSoundCheckTime(t); soundCheckRef.current = t; autoSaveSoundCheck(); }}
                    placeholder="e.g. 5:00 PM"
                    placeholderTextColor="#aaaaaa"
                  />
                </View>
                <StageConfirmRow stage={BOOKING_STAGES[2]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
                <StageConfirmRow stage={BOOKING_STAGES[5]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
              </View>

              {/* Participants — always shown for venues; also shown when participants exist */}
              {(isVenue || (participants && participants.length > 0)) && onInvite && (() => {
                const visible   = (participants ?? []).filter(p => p.state !== 'left');
                const myPart    = (participants ?? []).find(p => p.userId === currentUserUid);
                const canInvite = isVenue || myPart?.role === 'headliner';
                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Participants</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      {visible.length === 0 && (
                        <View style={eh.drawerInfoRow}>
                          <Text style={{ fontSize: 14, color: colors.grey }}>No participants yet.</Text>
                        </View>
                      )}
                      {visible.map((p, i) => {
                        const isMe = p.userId === currentUserUid;
                        const pending = p.state === 'invited';
                        return (
                          <TouchableOpacity
                            key={p.id}
                            style={[eh.drawerInfoRow, i < visible.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                            onPress={() => { if (!isMe && onOpenSubThread) { closeDetails(() => onOpenSubThread(p.userId, p.displayName, p.photoUrl)); } }}
                            activeOpacity={isMe ? 1 : 0.7}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                              <Avatar photoUrl={p.photoUrl} name={p.displayName} size={28} />
                              <View>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.black }} numberOfLines={1}>{p.displayName}</Text>
                                <Text style={{ fontSize: 11, color: colors.grey }}>
                                  {p.role === 'venue' ? 'Venue' : p.role === 'headliner' ? 'Headliner' : 'Support Act'}
                                </Text>
                              </View>
                            </View>
                            {pending && (
                              <Text style={{ fontSize: 11, fontWeight: '600', color: '#888888' }}>Invited</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      {canInvite && (
                        <TouchableOpacity
                          style={[eh.drawerInfoRow, { borderTopWidth: visible.length > 0 ? 1 : 0, borderTopColor: colors.border }]}
                          onPress={() => closeDetails(onInvite)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.orange }}>+ Invite Support Act</Text>
                        </TouchableOpacity>
                      )}
                      <StageConfirmRow stage={BOOKING_STAGES[4]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
                    </View>
                  </>
                );
              })()}

              {/* Tech Rider */}
              {(() => {
                const tr    = (enquiry as any).techRider && typeof (enquiry as any).techRider === 'object' ? (enquiry as any).techRider as Record<string, any> : null;
                const bfv: string[] = Array.isArray((enquiry as any).backlineFromVenue) ? (enquiry as any).backlineFromVenue : [];
                const bb: string[]  = Array.isArray((enquiry as any).backlineBring)     ? (enquiry as any).backlineBring     : [];
                const trb           = (enquiry as any).techRiderBools && typeof (enquiry as any).techRiderBools === 'object' ? (enquiry as any).techRiderBools as Record<string, boolean> : {};
                const chs: any[]    = Array.isArray((enquiry as any).inputChannels)     ? (enquiry as any).inputChannels     : [];
                const trDocs: any[] = Array.isArray((enquiry as any).techRiderDocs)     ? (enquiry as any).techRiderDocs     : [];
                const hasTR = !!(tr || bfv.length || bb.length || trb.ownPA || chs.length);
                const techSpecLink = quickLinks.find(l => l.label === 'Tech Specs');
                const rows: { label: string; value: string }[] = [];
                if (tr?.stageWidth || tr?.stageDepth)
                  rows.push({ label: 'Min stage', value: tr.stageWidth && tr.stageDepth ? `${tr.stageWidth}m × ${tr.stageDepth}m` : tr.stageWidth || tr.stageDepth });
                if (tr?.monitoringType || tr?.monitoring)
                  rows.push({ label: 'Monitoring', value: [tr.monitoringType, tr.monitoring].filter(Boolean).join(' · ') });
                if (bfv.length)     rows.push({ label: 'Needs from venue', value: bfv.join(', ') });
                if (bb.length)      rows.push({ label: 'Brings own',       value: bb.join(', ') });
                if (trb.ownPA)      rows.push({ label: 'PA',               value: 'Touring with own PA and engineer' });
                if (tr?.soundcheck) rows.push({ label: 'Soundcheck',       value: tr.soundcheck });
                if (tr?.loadIn)     rows.push({ label: 'Load-in',          value: tr.loadIn });
                if (tr?.lighting)   rows.push({ label: 'Lighting',         value: tr.lighting });
                if (tr?.power)      rows.push({ label: 'Power',            value: tr.power });
                if (chs.length)     rows.push({ label: 'Input channels',   value: `${chs.length} ch` });
                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Tech Rider</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      {rows.map((r, i) => (
                        <View key={r.label} style={[eh.drawerInfoRow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>{r.label}</Text>
                          <Text style={[eh.drawerInfoVal, { color: colors.black }]} numberOfLines={2}>{r.value}</Text>
                        </View>
                      ))}
                      {!hasTR && (
                        <View style={eh.drawerInfoRow}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Tech Rider</Text>
                          {techSpecLink
                            ? <TouchableOpacity onPress={() => closeDetails(techSpecLink.onPress ?? undefined)} activeOpacity={0.7}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>View →</Text>
                              </TouchableOpacity>
                            : <Text style={[eh.drawerInfoVal, { color: colors.greyLight }]}>Not shared</Text>
                          }
                        </View>
                      )}
                      {hasTR && techSpecLink ? (
                        <View style={[eh.drawerInfoRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Full rider</Text>
                          <TouchableOpacity onPress={() => closeDetails(techSpecLink.onPress ?? undefined)} activeOpacity={0.7}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>View →</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                      {tr?.notes ? (
                        <View style={[eh.drawerInfoRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Notes</Text>
                          <Text style={[eh.drawerInfoVal, { color: colors.black, flexShrink: 1 }]} numberOfLines={3}>{tr.notes}</Text>
                        </View>
                      ) : null}
                      {(tr?.stagePlotUrl || tr?.inputListUrl || trDocs.length > 0) ? (
                        <View style={[eh.drawerInfoRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 6, borderTopWidth: 1, borderTopColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Downloads</Text>
                          {tr?.stagePlotUrl ? (
                            <TouchableOpacity onPress={() => Linking.openURL(tr!.stagePlotUrl)}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>↓ Stage Plot</Text>
                            </TouchableOpacity>
                          ) : null}
                          {tr?.inputListUrl ? (
                            <TouchableOpacity onPress={() => Linking.openURL(tr!.inputListUrl)}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>↓ {tr.inputListName || 'Input List'}</Text>
                            </TouchableOpacity>
                          ) : null}
                          {trDocs.map((d: any, idx: number) => (
                            <TouchableOpacity key={idx} onPress={() => Linking.openURL(d.url)}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>↓ {d.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                      <StageConfirmRow stage={BOOKING_STAGES[3]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
                    </View>
                  </>
                );
              })()}

              {/* Hospitality */}
              {(() => {
                const h = (enquiry as any).hospitality && typeof (enquiry as any).hospitality === 'object' ? (enquiry as any).hospitality as Record<string, any> : null;
                const hasH = !!(h && (h.mealsRequired || h.dietaryReqs || h.drinks || h.greenRoom || h.merchTable || h.parkingLoading || h.accommodation || h.mealCount));
                const profileLink = onScrollToProfile;
                const rows: { label: string; value: string }[] = [];
                if (h?.mealsRequired) rows.push({ label: 'Meals',         value: 'Required' });
                if (h?.mealCount)     rows.push({ label: 'Meal count',    value: String(h.mealCount) });
                if (h?.dietaryReqs)   rows.push({ label: 'Dietary',       value: h.dietaryReqs });
                if (h?.drinks)        rows.push({ label: 'Drinks',        value: h.drinks });
                if (h?.greenRoom)     rows.push({ label: 'Green room',    value: 'Required' });
                if (h?.merchTable)    rows.push({ label: 'Merch table',   value: 'Required' });
                if (h?.parkingLoading) rows.push({ label: 'Parking',     value: h.parkingLoading });
                if (h?.accommodation) rows.push({ label: 'Accommodation', value: h.accommodation });
                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Hospitality</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      {rows.map((r, i) => (
                        <View key={r.label} style={[eh.drawerInfoRow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>{r.label}</Text>
                          <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{r.value}</Text>
                        </View>
                      ))}
                      {!hasH && (
                        <View style={eh.drawerInfoRow}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Requirements</Text>
                          {profileLink
                            ? <TouchableOpacity onPress={() => { closeDetails(); profileLink(); }} activeOpacity={0.7}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>View profile →</Text>
                              </TouchableOpacity>
                            : <Text style={[eh.drawerInfoVal, { color: colors.greyLight }]}>Not shared</Text>
                          }
                        </View>
                      )}
                      {hasH && profileLink ? (
                        <View style={[eh.drawerInfoRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Full details</Text>
                          <TouchableOpacity onPress={() => { closeDetails(); profileLink(); }} activeOpacity={0.7}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.orange }}>View profile →</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                      <StageConfirmRow stage={BOOKING_STAGES[7]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
                    </View>
                  </>
                );
              })()}

              {/* Payment method */}
              {(() => {
                const termsReason = paymentTermsGateReason();
                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Payment Method</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      <View style={{ padding: 12, gap: 10 }}>
                        {/* Fee type chips */}
                        <View style={eh.feeTypeGrid}>
                          {FEE_TYPE_PILLS.map(ft => {
                            const isSuggested = slotSuggestedFeeTypes.includes(ft.value);
                            const isSelected  = selectedFeeType === ft.value;
                            return (
                              <TouchableOpacity
                                key={ft.value}
                                onPress={() => handleFeeTypeChange(ft.value)}
                                style={[
                                  eh.feeTypeChip,
                                  { borderColor: isSelected ? Colors.orange : isSuggested ? Colors.orange + '55' : colors.border },
                                  isSelected && { backgroundColor: Colors.orange + '15' },
                                ]}
                                activeOpacity={0.7}
                              >
                                <Text style={[eh.feeTypeChipText, { color: isSelected ? Colors.orange : colors.black }]}>
                                  {ft.label}
                                </Text>
                                {isSuggested && !isSelected && <View style={eh.feeTypeDot} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        {slotSuggestedFeeTypes.length > 0 && (
                          <Text style={[eh.feeTypeHint, { color: colors.grey }]}>
                            Dotted border: venue's preferred method for this slot.
                          </Text>
                        )}

                        {/* Structured fields — shown once a method is chosen */}
                        {selectedFeeType && selectedFeeType !== 'other' && (
                          <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>

                            {/* Amount / guarantee */}
                            {(selectedFeeType === 'flat' || selectedFeeType === 'guarantee_vs_door') && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>
                                  {selectedFeeType === 'guarantee_vs_door' ? 'GUARANTEE AMOUNT' : 'FEE AMOUNT'}
                                </Text>
                                <View style={[eh.payInputRow, { borderColor: colors.border }]}>
                                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.black, paddingLeft: 12 }}>$</Text>
                                  <TextInput
                                    style={[eh.payInput, { color: colors.black, flex: 1 }]}
                                    value={feeAmountStr}
                                    onChangeText={t => {
                                      const c = t.replace(/[^0-9.]/g, '');
                                      setFeeAmountStr(c);
                                      autoSaveFeeField('amountCents', dollarsToCents(c));
                                    }}
                                    keyboardType="decimal-pad"
                                    placeholder="0"
                                    placeholderTextColor="#aaaaaa"
                                  />
                                  {selectedFeeType === 'flat' && feeGstApplies && feeAmountStr !== '' && !isNaN(parseFloat(feeAmountStr)) && (
                                    <Text style={[eh.payGstHint, { color: colors.grey }]}>
                                      {`incl. GST: $${(parseFloat(feeAmountStr) * 1.1).toFixed(2)}`}
                                    </Text>
                                  )}
                                </View>
                              </View>
                            )}

                            {/* Artist percentage */}
                            {(selectedFeeType === 'door_split' || selectedFeeType === 'guarantee_vs_door' || selectedFeeType === 'ticket_split') && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>
                                  {selectedFeeType === 'ticket_split' ? 'ARTIST TICKET SPLIT %' : 'ARTIST DOOR SPLIT %'}
                                </Text>
                                <View style={[eh.payInputRow, { borderColor: colors.border }]}>
                                  <TextInput
                                    style={[eh.payInput, { color: colors.black, flex: 1, paddingLeft: 12 }]}
                                    value={feeDoorPct}
                                    onChangeText={t => {
                                      const c = t.replace(/[^0-9.]/g, '');
                                      setFeeDoorPct(c);
                                      const n = parseFloat(c);
                                      autoSaveFeeField('doorPercent', Number.isFinite(n) && n >= 0 && n <= 100 ? n : null);
                                    }}
                                    keyboardType="decimal-pad"
                                    placeholder="e.g. 70"
                                    placeholderTextColor="#aaaaaa"
                                  />
                                  <Text style={{ fontSize: 14, color: colors.grey, paddingRight: 12 }}>%</Text>
                                </View>
                              </View>
                            )}

                            {/* Threshold (guarantee+door only) */}
                            {selectedFeeType === 'guarantee_vs_door' && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>DOOR % KICKS IN ABOVE</Text>
                                <View style={[eh.payInputRow, { borderColor: colors.border }]}>
                                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.black, paddingLeft: 12 }}>$</Text>
                                  <TextInput
                                    style={[eh.payInput, { color: colors.black, flex: 1 }]}
                                    value={feeThresholdStr}
                                    onChangeText={t => {
                                      const c = t.replace(/[^0-9.]/g, '');
                                      setFeeThresholdStr(c);
                                      autoSaveFeeField('thresholdCents', dollarsToCents(c));
                                    }}
                                    keyboardType="decimal-pad"
                                    placeholder="e.g. 500"
                                    placeholderTextColor="#aaaaaa"
                                  />
                                </View>
                              </View>
                            )}

                            {/* Deductions (door types) */}
                            {(selectedFeeType === 'door_split' || selectedFeeType === 'guarantee_vs_door') && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>CALCULATED AFTER</Text>
                                <TextInput
                                  style={[eh.payTextInput, { color: colors.black, borderColor: colors.border }]}
                                  value={feeDeductions}
                                  onChangeText={t => { setFeeDeductions(t); autoSaveFeeField('deductionsText', t); }}
                                  placeholder="e.g. security and door staff costs"
                                  placeholderTextColor="#aaaaaa"
                                />
                              </View>
                            )}

                            {/* Ticket price */}
                            {selectedFeeType === 'ticket_split' && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>TICKET PRICE</Text>
                                <View style={[eh.payInputRow, { borderColor: colors.border }]}>
                                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.black, paddingLeft: 12 }}>$</Text>
                                  <TextInput
                                    style={[eh.payInput, { color: colors.black, flex: 1 }]}
                                    value={feeTicketStr}
                                    onChangeText={t => {
                                      const c = t.replace(/[^0-9.]/g, '');
                                      setFeeTicketStr(c);
                                      autoSaveFeeField('ticketPriceCents', dollarsToCents(c));
                                    }}
                                    keyboardType="decimal-pad"
                                    placeholder="e.g. 25"
                                    placeholderTextColor="#aaaaaa"
                                  />
                                </View>
                              </View>
                            )}

                            {/* Sales report days (ticket split) */}
                            {selectedFeeType === 'ticket_split' && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>SALES REPORT DUE (DAYS AFTER GIG)</Text>
                                <TextInput
                                  style={[eh.payTextInput, { color: colors.black, borderColor: colors.border }]}
                                  value={feeReportDays}
                                  onChangeText={t => {
                                    const c = t.replace(/[^0-9]/g, '');
                                    setFeeReportDays(c);
                                    const n = parseInt(c, 10);
                                    autoSaveFeeField('reportDays', Number.isFinite(n) && n >= 0 && n <= 365 ? n : null);
                                  }}
                                  keyboardType="number-pad"
                                  placeholder="7"
                                  placeholderTextColor="#aaaaaa"
                                />
                              </View>
                            )}

                            {/* Unpaid notes */}
                            {selectedFeeType === 'unpaid' && (
                              <View style={{ gap: 4 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>WHAT THE ARTIST GETS</Text>
                                <TextInput
                                  style={[eh.payTextInput, { color: colors.black, borderColor: colors.border, minHeight: 60 }]}
                                  value={feeUnpaidNotes}
                                  onChangeText={t => { setFeeUnpaidNotes(t); autoSaveFeeField('unpaidNotes', t); }}
                                  placeholder="Exposure, experience, free drinks, recording..."
                                  placeholderTextColor="#aaaaaa"
                                  multiline
                                  textAlignVertical="top"
                                />
                              </View>
                            )}

                            {/* GST toggle (not for unpaid) */}
                            {selectedFeeType !== 'unpaid' && (
                              <View style={[eh.payToggleRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={[eh.payFieldLabel, { color: colors.grey }]}>GST APPLIES</Text>
                                  {artistPayInfo && (
                                    <Text style={{ fontSize: 11, color: colors.greyLight, marginTop: 1 }}>
                                      {`Artist ${artistPayInfo.gstRegistered ? 'is' : 'is not'} registered for GST`}
                                    </Text>
                                  )}
                                </View>
                                <Switch
                                  value={feeGstApplies}
                                  onValueChange={v => { setFeeGstApplies(v); autoSaveFeeField('gstApplies', v); }}
                                  trackColor={{ false: colors.border, true: Colors.orange }}
                                  thumbColor="#ffffff"
                                />
                              </View>
                            )}

                            {/* Due timing (not for unpaid) */}
                            {selectedFeeType !== 'unpaid' && (
                              <View style={{ gap: 6 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>PAYMENT DUE</Text>
                                <View style={eh.payChipRow}>
                                  {(['on_night', 'within_days'] as DueTiming[]).map(opt => {
                                    const label   = opt === 'on_night' ? 'On the night' : 'Within X days';
                                    const isActive = feeDueTiming === opt;
                                    return (
                                      <TouchableOpacity
                                        key={opt}
                                        onPress={() => { setFeeDueTiming(opt); autoSaveFeeField('dueTiming', opt); }}
                                        style={[eh.payChip, { borderColor: isActive ? Colors.orange : colors.border }, isActive && { backgroundColor: Colors.orange + '15' }]}
                                        activeOpacity={0.75}
                                      >
                                        <Text style={[eh.payChipText, { color: isActive ? Colors.orange : colors.black }]}>{label}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                                {feeDueTiming === 'within_days' && (
                                  <View style={[eh.payInputRow, { borderColor: colors.border }]}>
                                    <TextInput
                                      style={[eh.payInput, { color: colors.black, flex: 1, paddingLeft: 12 }]}
                                      value={feeDueDays}
                                      onChangeText={t => {
                                        const c = t.replace(/[^0-9]/g, '');
                                        setFeeDueDays(c);
                                        const n = parseInt(c, 10);
                                        autoSaveFeeField('dueDays', Number.isFinite(n) && n >= 0 && n <= 365 ? n : null);
                                      }}
                                      keyboardType="number-pad"
                                      placeholder="e.g. 7"
                                      placeholderTextColor="#aaaaaa"
                                    />
                                    <Text style={{ fontSize: 13, color: colors.grey, paddingRight: 12 }}>days after the gig</Text>
                                  </View>
                                )}
                              </View>
                            )}

                            {/* Payment channel (not for unpaid) */}
                            {selectedFeeType !== 'unpaid' && (
                              <View style={{ gap: 6 }}>
                                <Text style={[eh.payFieldLabel, { color: colors.grey }]}>PAYMENT CHANNEL</Text>
                                <View style={eh.payChipRow}>
                                  {PAYMENT_CHANNELS.map(ch => {
                                    const isActive = feeChannel === ch;
                                    return (
                                      <TouchableOpacity
                                        key={ch}
                                        onPress={() => {
                                          const val = isActive ? '' : ch;
                                          setFeeChannel(val);
                                          autoSaveFeeField('channel', val);
                                        }}
                                        style={[eh.payChip, { borderColor: isActive ? Colors.orange : colors.border }, isActive && { backgroundColor: Colors.orange + '15' }]}
                                        activeOpacity={0.75}
                                      >
                                        <Text style={[eh.payChipText, { color: isActive ? Colors.orange : colors.black }]}>{ch}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Artist ABN / invoice info (read-only) */}
                        {artistPayInfo && (
                          <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                            {(() => {
                              const abnLabel: Record<string, string> = {
                                has_abn: 'Has ABN', no_abn_hobby: 'No ABN (hobby)', applying: 'Applying for ABN',
                              };
                              const statusStr = abnLabel[artistPayInfo.abnStatus] || artistPayInfo.abnStatus || 'Not set';
                              return (
                                <>
                                  <View style={eh.payInfoRow}>
                                    <Text style={[eh.payInfoKey, { color: colors.grey }]}>Artist ABN status</Text>
                                    <Text style={[eh.payInfoVal, { color: colors.black }]}>
                                      {statusStr}{artistPayInfo.abnStatus === 'has_abn' && artistPayInfo.abn ? ` (${artistPayInfo.abn})` : ''}
                                    </Text>
                                  </View>
                                  <View style={eh.payInfoRow}>
                                    <Text style={[eh.payInfoKey, { color: colors.grey }]}>GST registered</Text>
                                    <Text style={[eh.payInfoVal, { color: colors.black }]}>{artistPayInfo.gstRegistered ? 'Yes' : 'No'}</Text>
                                  </View>
                                  <View style={eh.payInfoRow}>
                                    <Text style={[eh.payInfoKey, { color: colors.grey }]}>Can provide invoice</Text>
                                    <Text style={[eh.payInfoVal, { color: colors.black }]}>{artistPayInfo.canProvideInvoice ? 'Yes' : 'No'}</Text>
                                  </View>
                                  {venueRequiresAbn && (artistPayInfo.abnStatus === 'no_abn_hobby' || artistPayInfo.abnStatus === 'applying') && (
                                    <View style={[eh.payWarning, { borderColor: '#f59e0b', backgroundColor: '#fef9c3' }]}>
                                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#92400e' }}>
                                        {`This venue requires an artist ABN. Artist status: ${statusStr}. Confirm with the venue before proceeding.`}
                                      </Text>
                                    </View>
                                  )}
                                </>
                              );
                            })()}
                          </View>
                        )}
                      </View>
                      <StageConfirmRow
                        stage={BOOKING_STAGES[6]}
                        enquiry={enquiry}
                        isVenue={isVenue}
                        colors={colors}
                        disabled={!!termsReason}
                        disabledReason={termsReason ?? undefined}
                        skipConfirmMessage="Skipping Payment Terms means both parties will need to re-confirm if payment details are filled in later."
                      />
                    </View>
                  </>
                );
              })()}

              {/* Confirmed fee summary — shown when gig is confirmed and fee was saved */}
              {savedFee && (normalizeEnquiryStatus(enquiry.status) === 'confirmed') && (
                (() => {
                  const feeLabel: Record<string, string> = {
                    flat: 'Flat fee', door_split: 'Door split',
                    guarantee_vs_door: 'Guarantee + door', ticket_split: 'Ticket split',
                    unpaid: 'Unpaid', other: 'Other',
                  };
                  const rows: { label: string; val: string }[] = [];
                  if (savedFee.type) rows.push({ label: 'Fee type', val: feeLabel[savedFee.type] ?? savedFee.type });
                  if (savedFee.amountCents != null) {
                    const d = savedFee.amountCents / 100;
                    rows.push({ label: savedFee.type === 'guarantee_vs_door' ? 'Guarantee' : 'Amount', val: `$${Number.isInteger(d) ? d : d.toFixed(2)}` });
                  }
                  if (savedFee.doorPercent != null) rows.push({ label: 'Door split', val: `${savedFee.doorPercent}%` });
                  if (savedFee.ticketPrice != null) {
                    const tp = savedFee.ticketPrice / 100;
                    rows.push({ label: 'Ticket price', val: `$${Number.isInteger(tp) ? tp : tp.toFixed(2)}` });
                  }
                  if (savedFee.notes) rows.push({ label: 'Fee notes', val: savedFee.notes });
                  if (rows.length === 0) return null;
                  return (
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border, marginTop: 10 }]}>
                      {rows.map((r, i) => (
                        <View key={r.label} style={[eh.drawerInfoRow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                          <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>{r.label}</Text>
                          <Text style={[eh.drawerInfoVal, { color: colors.black }]}>{r.val}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()
              )}

              {/* Payment card — shown for confirmed Twaylo bookings that have a gigId */}
              {normalizeEnquiryStatus(enquiry.status) === 'confirmed' &&
               currentUserUid &&
               (() => {
                 const gigId = (enquiry as any).gigId as string | undefined;
                 if (!gigId) return null;
                 // We don't have the full gig doc here (only enquiry), so the
                 // PaymentCard is fed via a live gig listener. Render a minimal
                 // wrapper that listens to the gig doc.
                 return (
                   <GigPaymentCardWrapper
                     gigId={gigId}
                     uid={currentUserUid}
                     isVenue={isVenue}
                     otherPartyName={isVenue ? enquiry.bandName : enquiry.venueName}
                     onOpenThread={() => closeDetails(() => {})}
                     colors={colors}
                   />
                 );
               })()
              }

              {/* Important Notes */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Important Notes</Text>
              <TextInput
                style={[eh.drawerNotesInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
                value={notes}
                onChangeText={t => { setNotes(t); autoSaveNotes(t); }}
                placeholder="Add key details, agreements, requirements, anything worth pinning..."
                placeholderTextColor="#aaaaaa"
                multiline
                textAlignVertical="top"
              />

              {/* Notes document */}
              {notesDoc ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgFaint, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginTop: 10 }}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => Linking.openURL(notesDoc.url)}>
                    <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '600' }} numberOfLines={1}>↓ {notesDoc.name}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      await updateDoc(doc(db, 'inquiries', enquiry.id), { notesDoc: null });
                      setNotesDoc(null);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontSize: 14, color: '#e94560', fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={{ marginTop: 10, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.bgFaint }}
                  onPress={pickNotesDocument}
                  disabled={notesDocUploading}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.orange }}>
                    {notesDocUploading ? 'Uploading…' : '+ Attach Document'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Post-Gig */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Post-Gig</Text>
              <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                <View style={[eh.drawerInfoRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[eh.drawerInfoKey, { color: colors.grey }]}>Attendance</Text>
                  <TextInput
                    style={[eh.drawerInlineInput, { color: colors.black }]}
                    value={postGigAttendance}
                    onChangeText={t => { const v = t.replace(/[^0-9]/g, ''); setPostGigAttendance(v); postGigAttRef.current = v; autoSavePostGig(); }}
                    placeholder="e.g. 120"
                    placeholderTextColor="#aaaaaa"
                    keyboardType="number-pad"
                  />
                </View>
                <StageConfirmRow stage={BOOKING_STAGES[10]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
                <StageConfirmRow stage={BOOKING_STAGES[11]} enquiry={enquiry} isVenue={isVenue} colors={colors} />
              </View>
              <TextInput
                style={[eh.drawerNotesInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border, minHeight: 80, marginTop: 8 }]}
                value={postGigNotes}
                onChangeText={t => { setPostGigNotes(t); postGigNotesRef.current = t; autoSavePostGig(); }}
                placeholder="How did it go? Attendance, crowd response, any notes for next time..."
                placeholderTextColor="#aaaaaa"
                multiline
                textAlignVertical="top"
              />

              {/* Contract */}
              {(() => {
                const stageMap = (enquiry as any).stages as Record<string, StageData> | undefined;

                // Stage readiness
                const stagesDone = {
                  gigDetails:      computeStageStatus('gigDetails',     'both',  stageMap?.['gigDetails'],     enquiry) === 'complete',
                  setTimesLocked:  computeStageStatus('setTimesLocked', 'both',  stageMap?.['setTimesLocked'], enquiry) === 'complete',
                  paymentTermsSet: computeStageStatus('paymentTermsSet','both',  stageMap?.['paymentTermsSet'],enquiry) === 'complete',
                  techRiderReviewed: (() => {
                    const d = stageMap?.['techRiderReviewed'];
                    return !!(d?.skipped || d?.venueConfirmed);
                  })(),
                };

                // Legal readiness
                const myLegalOk   = myLegalIdentity ? isLegalIdentityComplete(myLegalIdentity) : legalFetched ? false : null;
                const otherSnapKey  = isVenue ? 'artistLegalSnapshot' : 'venueLegalSnapshot';
                const otherLegalRaw = (enquiry as any)[otherSnapKey] as Partial<LegalIdentity> | null | undefined;
                const otherLegalOk  = otherLegalRaw ? isLegalIdentityComplete({ ...BLANK_LEGAL, ...otherLegalRaw }) : false;
                const legalDone     = myLegalOk === true && otherLegalOk;

                const allReady = stagesDone.gigDetails && stagesDone.setTimesLocked &&
                  stagesDone.paymentTermsSet && stagesDone.techRiderReviewed && legalDone;

                // Per-stage "who's blocking" hints
                function stageHint(key: 'gigDetails' | 'setTimesLocked' | 'paymentTermsSet'): string | null {
                  const d = stageMap?.[key];
                  if (!d || (!d.venueConfirmed && !d.artistConfirmed)) return 'Waiting on both parties';
                  if (!d.venueConfirmed) return isVenue ? 'Needs your confirmation' : 'Waiting on venue';
                  if (!d.artistConfirmed) return !isVenue ? 'Needs your confirmation' : 'Waiting on artist';
                  return null;
                }
                function techHint(): string | null {
                  const d = stageMap?.['techRiderReviewed'];
                  if (!d?.venueConfirmed && !d?.skipped) return isVenue ? 'Needs your confirmation' : 'Waiting on venue';
                  return null;
                }
                function legalHint(): string | null {
                  if (myLegalOk === null) return 'Loading...';
                  if (!myLegalOk) return isVenue ? 'Add legal details in Venue Settings' : 'Add legal details in your profile';
                  if (!otherLegalOk) return isVenue ? 'Waiting on artist to provide their details' : 'Waiting on venue to provide their details';
                  return null;
                }

                const CHECKLIST: { label: string; done: boolean; hint: string | null; section?: string }[] = [
                  { label: 'General Gig Details',  done: stagesDone.gigDetails,       hint: stagesDone.gigDetails       ? null : stageHint('gigDetails'),      section: 'Gig Details' },
                  { label: 'Set Times Locked',     done: stagesDone.setTimesLocked,   hint: stagesDone.setTimesLocked   ? null : stageHint('setTimesLocked'),   section: 'Set Times' },
                  { label: 'Payment Terms',        done: stagesDone.paymentTermsSet,  hint: stagesDone.paymentTermsSet  ? null : stageHint('paymentTermsSet'),  section: 'Payment Method' },
                  { label: 'Tech Rider Reviewed',  done: stagesDone.techRiderReviewed,hint: stagesDone.techRiderReviewed? null : techHint(),                    section: 'Tech Rider' },
                  { label: 'Legal details (both parties)', done: legalDone, hint: legalDone ? null : legalHint() },
                ];

                const mySignKey    = isVenue ? 'venueSignature'  : 'artistSignature';
                const otherSignKey = isVenue ? 'artistSignature' : 'venueSignature';
                const mySig    = (enquiry as any)[mySignKey]    as { signatoryName: string; signedAt: number } | null | undefined;
                const otherSig = (enquiry as any)[otherSignKey] as { signatoryName: string; signedAt: number } | null | undefined;
                const bothSigned = !!(mySig && otherSig);
                const myLabel    = isVenue ? 'Venue'  : 'Artist';
                const otherLabel = isVenue ? 'Artist' : 'Venue';

                return (
                  <>
                    <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Contract</Text>
                    <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                      {CHECKLIST.map((item, i) => {
                        const isLast = i === CHECKLIST.length - 1;
                        return (
                          <View
                            key={item.label}
                            style={[
                              { paddingHorizontal: 14, paddingVertical: 11 },
                              !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                            ]}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Text style={{ fontSize: 15, color: item.done ? '#22c55e' : colors.greyLight, width: 18 }}>
                                {item.done ? '✓' : '○'}
                              </Text>
                              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: item.done ? colors.black : colors.grey }}>
                                {item.label}
                              </Text>
                            </View>
                            {!item.done && !!item.hint && (
                              <Text style={{ fontSize: 11, color: colors.greyLight, marginTop: 3, paddingLeft: 28 }}>
                                {item.hint}{item.section ? ` — see ${item.section} above` : ''}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>

                    {/* Signature status */}
                    {(mySig || otherSig || bothSigned) && (
                      <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border, marginTop: 8 }]}>
                        {[
                          { label: myLabel,    sig: mySig    },
                          { label: otherLabel, sig: otherSig },
                        ].map((row, i) => (
                          <View
                            key={row.label}
                            style={[
                              { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
                              i === 0 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                            ]}
                          >
                            <Text style={{ fontSize: 14, color: row.sig ? '#22c55e' : colors.greyLight, width: 18 }}>
                              {row.sig ? '✓' : '○'}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: row.sig ? colors.black : colors.grey }}>
                                {row.label}
                              </Text>
                              {row.sig ? (
                                <Text style={{ fontSize: 11, color: colors.greyLight, marginTop: 1 }}>
                                  Signed by {row.sig.signatoryName} · {new Date(row.sig.signedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </Text>
                              ) : (
                                <Text style={{ fontSize: 11, color: colors.greyLight, marginTop: 1 }}>Pending signature</Text>
                              )}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Action buttons */}
                    {allReady && !mySig ? (
                      <TouchableOpacity
                        style={{
                          marginTop: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1,
                          borderColor: colors.black, alignItems: 'center', backgroundColor: colors.bgFaint,
                        }}
                        onPress={() => {
                          setSignName(myLegalIdentity?.signatoryName ?? '');
                          setSignAgreed(false);
                          setShowSignModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.black }}>
                          Review and sign
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.grey, marginTop: 2 }}>
                          {otherSig ? 'Other party has already signed' : 'Both parties must sign to execute'}
                        </Text>
                      </TouchableOpacity>
                    ) : allReady && mySig && !otherSig ? (
                      <View
                        style={{
                          marginTop: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1,
                          borderColor: colors.border, alignItems: 'center', backgroundColor: colors.bgFaint,
                          opacity: 0.6,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.grey }}>
                          Waiting for {otherLabel.toLowerCase()} to sign
                        </Text>
                      </View>
                    ) : bothSigned ? (
                      <View
                        style={{
                          marginTop: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1,
                          borderColor: '#22c55e' + '55', alignItems: 'center', backgroundColor: '#22c55e' + '0a',
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#22c55e' }}>
                          Contract fully executed
                        </Text>
                        <Text style={{ fontSize: 11, color: '#22c55e' + 'aa', marginTop: 2 }}>
                          Both parties have signed
                        </Text>
                      </View>
                    ) : null}

                    {/* Download button — always shown */}
                    <TouchableOpacity
                      style={{
                        marginTop: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1,
                        borderColor: Colors.orange, alignItems: 'center',
                        backgroundColor: Colors.orange + '12',
                        opacity: contractLoading ? 0.6 : 1,
                      }}
                      onPress={generateContract}
                      disabled={contractLoading}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.orange }}>
                        {contractLoading ? 'Generating…' : allReady ? 'Download contract' : 'Download draft'}
                      </Text>
                      {!allReady && (
                        <Text style={{ fontSize: 11, color: Colors.orange + 'aa', marginTop: 2 }}>
                          Stamped DRAFT until all items are ticked
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                );
              })()}

              {/* Extra */}
              <Text style={[eh.drawerSectionLabel, { color: colors.black }]}>Extra</Text>
              <View style={[eh.drawerInfoCard, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[eh.drawerInfoRow, { paddingVertical: 14 }]}
                  onPress={() => Linking.openURL(buildGoogleCalendarUrl(enquiry))}
                  activeOpacity={0.7}
                >
                  <Text style={[eh.drawerInfoKey, { color: colors.black, fontWeight: '600' }]}>Add to Google Calendar</Text>
                  <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '700' }}>→</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[eh.drawerInfoRow, { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border }]}
                  onPress={() => downloadEnquiryICS(enquiry)}
                  activeOpacity={0.7}
                >
                  <Text style={[eh.drawerInfoKey, { color: colors.black, fontWeight: '600' }]}>Download .ics</Text>
                  <Text style={{ fontSize: 13, color: Colors.orange, fontWeight: '700' }}>↓</Text>
                </TouchableOpacity>
              </View>

              {/* Archive conversation */}
              {onDelete && (() => {
                const norm = normalizeEnquiryStatus(enquiry.status);
                const isPending = norm === 'enquired' || norm === 'discussing';
                const archiveTitle  = isPending
                  ? (isVenue ? 'Decline enquiry?' : 'Withdraw enquiry?')
                  : 'Archive conversation?';
                const archiveBody   = isPending
                  ? (isVenue
                      ? 'This will decline the enquiry and remove it from your inbox.'
                      : 'This will withdraw your enquiry and remove it from your inbox.')
                  : 'This removes the conversation from your inbox. The booking is not affected.';
                const archiveBtnLbl = isPending ? (isVenue ? 'Decline' : 'Withdraw') : 'Archive';
                return (
                  <TouchableOpacity
                    style={{ marginTop: 24, marginBottom: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', backgroundColor: 'rgba(220,38,38,0.04)' }}
                    onPress={() => closeDetails(() => setConfirmOpen(true))}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>{archiveBtnLbl} conversation</Text>
                  </TouchableOpacity>
                );
              })()}

            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Sign contract modal */}
      <Modal visible={showSignModal} transparent animationType="fade" onRequestClose={() => setShowSignModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={[md.overlay, { justifyContent: 'center' }]} activeOpacity={1} onPress={() => setShowSignModal(false)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[md.confirm, { backgroundColor: colors.bg, padding: 24, maxWidth: 420, marginHorizontal: 20 }]}>
                <Text style={[md.confirmTitle, { color: colors.black, marginBottom: 4 }]}>Sign Contract</Text>
                <Text style={{ fontSize: 12, color: colors.grey, marginBottom: 18, lineHeight: 18 }}>
                  {enquiry.bandName} at {enquiry.venueName}
                  {enquiry.requestedSlot.date ? ` · ${fmtSlotDateFull(enquiry.requestedSlot.date)}` : ''}
                </Text>

                <View style={{ backgroundColor: colors.bgFaint, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 18 }}>
                  <Text style={{ fontSize: 12, color: colors.black, fontWeight: '700', marginBottom: 8 }}>By signing you confirm:</Text>
                  {[
                    'You have read and understood all terms in the contract.',
                    'All gig details, set times, and payment terms are agreed.',
                    'You are authorised to sign on behalf of the named legal entity.',
                    'Your electronic signature is legally binding.',
                  ].map((line, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: i < 3 ? 6 : 0 }}>
                      <Text style={{ fontSize: 12, color: colors.grey }}>·</Text>
                      <Text style={{ fontSize: 12, color: colors.grey, flex: 1, lineHeight: 17 }}>{line}</Text>
                    </View>
                  ))}
                </View>

                <Text style={{ fontSize: 12, color: colors.grey, marginBottom: 6, fontWeight: '600' }}>Full legal name</Text>
                <TextInput
                  style={[
                    eh.drawerNotesInput,
                    { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border, minHeight: 0, height: 42, paddingVertical: 10, marginBottom: 18 },
                  ]}
                  value={signName}
                  onChangeText={setSignName}
                  placeholder="Name as it appears in your legal details"
                  placeholderTextColor="#aaaaaa"
                  autoCapitalize="words"
                />

                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22 }}
                  onPress={() => setSignAgreed(v => !v)}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 4, borderWidth: 2,
                    borderColor: signAgreed ? Colors.orange : colors.border,
                    backgroundColor: signAgreed ? Colors.orange : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {signAgreed && <Text style={{ fontSize: 13, color: '#fff', lineHeight: 16 }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.black, flex: 1, lineHeight: 17 }}>
                    I have read and agree to the terms of this contract.
                  </Text>
                </TouchableOpacity>

                <View style={md.confirmBtns}>
                  <TouchableOpacity
                    style={[md.confirmBtn, { borderColor: colors.border }]}
                    onPress={() => setShowSignModal(false)}
                  >
                    <Text style={[md.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      md.confirmBtn,
                      {
                        borderColor: signAgreed && signName.trim() ? colors.black : colors.border,
                        backgroundColor: signAgreed && signName.trim() ? colors.black : 'transparent',
                        opacity: signingLoading ? 0.6 : 1,
                      },
                    ]}
                    onPress={signContract}
                    disabled={!signAgreed || !signName.trim() || signingLoading}
                    activeOpacity={0.7}
                  >
                    <Text style={[md.confirmBtnText, { color: signAgreed && signName.trim() ? colors.bg : colors.greyLight, fontWeight: '700' }]}>
                      {signingLoading ? 'Signing…' : 'Sign'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {(() => {
        const norm = normalizeEnquiryStatus(enquiry.status);
        const isPending = norm === 'enquired' || norm === 'discussing';
        const archiveTitle  = isPending
          ? (isVenue ? 'Decline enquiry?' : 'Withdraw enquiry?')
          : 'Archive conversation?';
        const archiveBody   = isPending
          ? (isVenue
              ? 'This will decline the enquiry and remove it from your inbox.'
              : 'This will withdraw your enquiry and remove it from your inbox.')
          : 'This removes the conversation from your inbox. The booking is not affected.';
        const archiveBtnLbl = isPending ? (isVenue ? 'Decline' : 'Withdraw') : 'Archive';
        return (
          <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
            <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
              <View style={[md.confirm, { backgroundColor: colors.bg }]}>
                <Text style={[md.confirmTitle, { color: colors.black }]}>{archiveTitle}</Text>
                <Text style={[md.confirmBody, { color: colors.grey }]}>{archiveBody}</Text>
                <View style={md.confirmBtns}>
                  <TouchableOpacity style={[md.confirmBtn, { borderColor: colors.border }]} onPress={() => setConfirmOpen(false)}>
                    <Text style={[md.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmOpen(false); onDelete?.(); }}>
                    <Text style={md.confirmBtnDangerText}>{archiveBtnLbl}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

    </>
  );
}

const eh = StyleSheet.create({
  card:              { paddingTop: isWeb ? 16 : 14, paddingHorizontal: isWeb ? 24 : 16, paddingBottom: 14, borderBottomWidth: 1, flexShrink: 0 },
  titleRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  rightCol:          { alignItems: 'flex-end', flexShrink: 0, marginRight: 4 },
  detailsBtn:        { flexShrink: 0, paddingLeft: 4 },
  detailsBtnInner:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailsCircle:     { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  detailsCircleText: { fontSize: 11, fontWeight: '800', color: '#111111', lineHeight: 13 },
  detailsLink:       { fontSize: 13, fontWeight: '600', color: '#111111' },
  back:              { fontSize: 18, color: Colors.orange, fontWeight: '600', marginRight: 2 },
  titleInfo:         { flex: 1, minWidth: 0 },
  name:              { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  slot:              { fontSize: 15, marginTop: 2 },
  quickLinks:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  quickLinkText:     { fontSize: 12, fontWeight: '600', color: Colors.orange },
  quickLinkSep:      { fontSize: 12, color: '#cccccc', marginRight: 6 },
  dots:              { fontSize: 22, color: '#aaaaaa', letterSpacing: 1, marginLeft: 4 },
  // Details drawer
  drawerBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawerPanel:       { position: 'absolute' as any, top: 0, right: 0, bottom: 0, borderLeftWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: -4, height: 0 }, elevation: 12 },
  drawerHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  drawerTitle:       { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, flex: 1, textAlign: 'center' },
  drawerBack:        { fontSize: 14, fontWeight: '700' },
  drawerClose:       { fontSize: 18, color: '#aaaaaa', fontWeight: '600' },
  drawerContent:     { padding: 20, gap: 6, paddingBottom: 40 },
  drawerSectionLabel:{ fontSize: 15, fontWeight: '800', color: '#111111', letterSpacing: -0.2, marginTop: 20, marginBottom: 8 },
  drawerInfoCard:    { borderRadius: 12, borderWidth: 1, overflow: 'hidden' as const },
  drawerInfoRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  drawerInfoKey:     { fontSize: 13, fontWeight: '600' },
  drawerInfoVal:     { fontSize: 13, fontWeight: '700' },
  drawerInlineInput: { fontSize: 13, fontWeight: '700', textAlign: 'right', flex: 1, paddingLeft: 8 },
  drawerNotesInput:  { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 14, minHeight: 120, lineHeight: 21, marginTop: 0 },
  drawerNotesBtns:   { flexDirection: 'row', gap: 10, marginTop: 10 },
  drawerCancelBtn:   { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  drawerCancelBtnText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  drawerSaveBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.orange, alignItems: 'center' },
  drawerSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  // Fee type pills
  feeTypeGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  feeTypeChip:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  feeTypeChipText: { fontSize: 13, fontWeight: '600' },
  feeTypeDot:      { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.orange },
  feeTypeHint:     { fontSize: 11, marginTop: 4 },
  // Payment field styles
  payFieldLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  payInputRow:     { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  payInput:        { fontSize: 15, paddingVertical: 9, paddingRight: 8 },
  payGstHint:      { fontSize: 12, paddingRight: 10 },
  payTextInput:    { fontSize: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  payToggleRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payChipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  payChip:         { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  payChipText:     { fontSize: 13, fontWeight: '600' },
  payInfoRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  payInfoKey:      { fontSize: 12, fontWeight: '600', flex: 1 },
  payInfoVal:      { fontSize: 12, flex: 1, textAlign: 'right' as const },
  payWarning:      { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4 },
});

// ── Stage components ────────────────────────────────────────────────────────

function StageIndicator({ status }: { status: StageStatus }) {
  const isWaiting = status === 'waiting_venue' || status === 'waiting_artist';
  return (
    <View style={[
      sdi.circle,
      status === 'complete' && { backgroundColor: '#22c55e', borderColor: '#22c55e' },
      isWaiting             && { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
    ]}>
      {(status === 'complete' || isWaiting) && (
        <Text style={[sdi.check, isWaiting && { color: '#f59e0b' }]}>✓</Text>
      )}
    </View>
  );
}

const sdi = StyleSheet.create({
  circle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#d0d0d0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  check:  { fontSize: 11, fontWeight: '800', color: '#ffffff', lineHeight: 14 },
});

function StageDropdownList({ item, isVenue }: { item: Enquiry; isVenue: boolean }) {
  const { colors } = useTheme();
  const map = (item as any).stages as Record<string, StageData> | undefined;
  return (
    <View style={[sdl.container, { backgroundColor: colors.bgFaint, borderTopColor: colors.border, borderBottomColor: colors.border }]}>
      {BOOKING_STAGES.map((stage, i) => {
        const data   = map?.[stage.key];
        const status = computeStageStatus(stage.key, stage.control, data, item);
        const isLast = i === BOOKING_STAGES.length - 1;
        const isWait = status === 'waiting_venue' || status === 'waiting_artist';
        let waitLabel = '';
        if (status === 'waiting_venue')  waitLabel = isVenue  ? 'Waiting on You' : 'Waiting on Venue';
        if (status === 'waiting_artist') waitLabel = !isVenue ? 'Waiting on You' : 'Waiting on Artist';
        const isWaitingOnMe = (status === 'waiting_venue' && isVenue) || (status === 'waiting_artist' && !isVenue);
        return (
          <View key={stage.key} style={[sdl.row, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <StageIndicator status={status} />
            <Text style={[
              sdl.label,
              { color: status === 'complete' ? colors.black : colors.grey },
              status === 'skipped' && sdl.labelStrike,
            ]}>
              {stage.label}
            </Text>
            {isWait && (
              <Text style={[sdl.waitText, isWaitingOnMe && sdl.waitTextYou]}>
                {waitLabel}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const sdl = StyleSheet.create({
  container:   { paddingHorizontal: isWeb ? 24 : 16, paddingVertical: 4, borderTopWidth: 1, borderBottomWidth: 1 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  label:       { flex: 1, fontSize: 13, fontWeight: '600' },
  labelStrike: { textDecorationLine: 'line-through' as const, opacity: 0.5 },
  waitText:    { fontSize: 11, color: '#888888', flexShrink: 0 },
  waitTextYou: { color: Colors.orange, fontWeight: '700' },
});

function StageConfirmRow({ stage, enquiry, isVenue, colors, disabled, disabledReason, hideSkip, skipConfirmMessage }: {
  stage: StageDef;
  enquiry: Enquiry;
  isVenue: boolean;
  colors: any;
  /** Greyed-out "Mark complete" button — fields not yet filled. */
  disabled?: boolean;
  /** Short line shown below the button explaining what's missing. */
  disabledReason?: string;
  /** Hide the Skip link (e.g. for stages that auto-skip). */
  hideSkip?: boolean;
  /** When set, tapping Skip shows a confirmation dialog with this message. */
  skipConfirmMessage?: string;
}) {
  const map  = (enquiry as any).stages as Record<string, StageData> | undefined;
  const data: StageData = map?.[stage.key] ?? {};

  // Optimistic local state so UI updates immediately on confirm/skip.
  // gigDetails: confirmed unless explicitly set to false (mirrors computeStageStatus logic).
  const isGigDetails = stage.key === 'gigDetails';
  const [venueConfirmed,  setVenueConfirmed]  = useState(isGigDetails ? data.venueConfirmed  !== false : !!data.venueConfirmed);
  const [artistConfirmed, setArtistConfirmed] = useState(isGigDetails ? data.artistConfirmed !== false : !!data.artistConfirmed);
  const [skipped,         setSkipped]         = useState(!!data.skipped);
  const [saving,          setSaving]          = useState(false);

  // Keep local optimistic state in sync with Firestore when external writes arrive
  // (e.g. Part 2 field-change resets, or the other party confirming/undoing).
  useEffect(() => {
    if (saving) return;
    setVenueConfirmed(isGigDetails ? data.venueConfirmed !== false : !!data.venueConfirmed);
    setArtistConfirmed(isGigDetails ? data.artistConfirmed !== false : !!data.artistConfirmed);
    setSkipped(!!data.skipped);
  }, [data.venueConfirmed, data.artistConfirmed, data.skipped]);

  const myConfirmed    = isVenue ? venueConfirmed  : artistConfirmed;
  const theirConfirmed = isVenue ? artistConfirmed : venueConfirmed;
  const theirLabel     = isVenue ? 'Artist'        : 'Venue';

  const canAct  = stage.control === 'both'
    || (stage.control === 'venue'  && isVenue)
    || (stage.control === 'artist' && !isVenue);
  const theyAct = stage.control === 'both'
    || (stage.control === 'venue'  && !isVenue)
    || (stage.control === 'artist' && isVenue);

  const myPath   = 'stages.' + stage.key + '.' + (isVenue ? 'venueConfirmed' : 'artistConfirmed');
  const skipPath = 'stages.' + stage.key + '.skipped';
  const vcPath   = 'stages.' + stage.key + '.venueConfirmed';
  const acPath   = 'stages.' + stage.key + '.artistConfirmed';

  async function doConfirm() {
    if (isVenue) setVenueConfirmed(true); else setArtistConfirmed(true);
    setSkipped(false);
    setSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), { [myPath]: true, [skipPath]: false }).catch(() => {});
    setSaving(false);
  }
  async function doUnconfirm() {
    if (isVenue) setVenueConfirmed(false); else setArtistConfirmed(false);
    setSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), { [myPath]: false }).catch(() => {});
    setSaving(false);
  }
  async function performSkip() {
    setSkipped(true);
    setVenueConfirmed(false);
    setArtistConfirmed(false);
    setSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), { [skipPath]: true, [vcPath]: false, [acPath]: false }).catch(() => {});
    setSaving(false);
  }
  function doSkip() {
    if (skipConfirmMessage) {
      crossConfirm('Skip this stage?', skipConfirmMessage, performSkip);
    } else {
      performSkip();
    }
  }
  async function doUnskip() {
    setSkipped(false);
    setSaving(true);
    await updateDoc(doc(db, 'inquiries', enquiry.id), { [skipPath]: false }).catch(() => {});
    setSaving(false);
  }

  // Which confirmed state to show for read-only viewers
  const responsibleConfirmed = stage.control === 'venue' ? venueConfirmed : artistConfirmed;

  return (
    <View style={[sc.wrap, { borderTopColor: colors.border }]}>
      {/* Stage name label */}
      <Text style={[sc.stageLabel, { color: colors.black }]}>{stage.label}</Text>

      {skipped ? (
        <View style={sc.row}>
          <Text style={[sc.statusText, { color: colors.greyLight }]}>Stage skipped</Text>
          {canAct && (
            <TouchableOpacity onPress={doUnskip} disabled={saving} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={[sc.link, { color: Colors.orange }]}>Undo</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <>
          {stage.control === 'both' && theyAct && (
            <View style={sc.partyRow}>
              <View style={[sc.dot, theirConfirmed && sc.dotGreen]} />
              <Text style={[sc.partyText, { color: theirConfirmed ? '#16a34a' : colors.greyLight }]}>
                {theirLabel}: {theirConfirmed ? 'Confirmed' : 'Not yet confirmed'}
              </Text>
            </View>
          )}
          {canAct ? (
            <View style={sc.row}>
              {myConfirmed ? (
                <>
                  <View style={sc.confirmedBadge}>
                    <Text style={sc.confirmedBadgeText}>Confirmed</Text>
                  </View>
                  <TouchableOpacity onPress={doUnconfirm} disabled={saving} style={sc.rowRight}>
                    <Text style={[sc.link, { color: colors.greyLight }]}>Undo</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View>
                  <View style={sc.row}>
                    <TouchableOpacity
                      style={[sc.confirmBtn, (saving || disabled) && sc.confirmBtnDisabled]}
                      onPress={disabled ? undefined : doConfirm}
                      disabled={saving || !!disabled}
                      activeOpacity={0.75}
                    >
                      {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={sc.confirmBtnText}>Mark complete</Text>}
                    </TouchableOpacity>
                    {!hideSkip && (
                      <TouchableOpacity onPress={doSkip} disabled={saving} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={[sc.link, { color: colors.greyLight }]}>Skip</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!!disabled && !!disabledReason && (
                    <Text style={[sc.disabledReason, { color: colors.greyLight }]}>{disabledReason}</Text>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View style={sc.row}>
              <View style={[sc.dot, responsibleConfirmed && sc.dotGreen]} />
              <Text style={[sc.statusText, { color: responsibleConfirmed ? '#16a34a' : colors.greyLight }]}>
                {responsibleConfirmed ? 'Confirmed' : 'Pending confirmation'}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const sc = StyleSheet.create({
  wrap:               { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1 },
  stageLabel:         { fontSize: 12, fontWeight: '700', letterSpacing: 0.1, marginBottom: 8 },
  row:                { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowRight:           { marginLeft: 'auto' as any },
  partyRow:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  dot:                { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d0d0d0' },
  dotGreen:           { backgroundColor: '#22c55e' },
  partyText:          { fontSize: 12, fontWeight: '600' },
  statusText:         { fontSize: 12, fontWeight: '600' },
  confirmedBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  confirmedBadgeText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },
  confirmBtn:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmBtnText:     { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  link:               { fontSize: 12, fontWeight: '600' },
  disabledReason:     { fontSize: 11, marginTop: 5, fontStyle: 'italic' },
});

// ── Participant strip ───────────────────────────────────────────────────────

type OnOpenSubThread = (otherUid: string, otherName: string, otherPhoto: string | null) => void;

function ParticipantStrip({
  participants,
  currentUserUid,
  enquiryId,
  venueName,
  gigDate,
  onOpenSubThread,
  onInvite,
  onRemove,
}: {
  participants: Participant[];
  currentUserUid: string;
  enquiryId: string;
  venueName: string;
  gigDate: string;
  onOpenSubThread: OnOpenSubThread;
  onInvite: () => void;
  onRemove: (p: Participant) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const myParticipant = participants.find(p => p.userId === currentUserUid);
  const canInvite = myParticipant?.role === 'venue' || myParticipant?.role === 'headliner';
  const canRemove = myParticipant?.role === 'venue';

  // Active = invited or confirmed (shown in strip). Declined shown de-emphasised. Left = hidden.
  const active   = participants.filter(p => p.state === 'invited' || p.state === 'confirmed');
  const declined = participants.filter(p => p.state === 'declined');

  const [contextMenu, setContextMenu] = useState<{ participant: Participant; x: number; y: number } | null>(null);

  function stateTag(p: Participant) {
    if (p.role === 'venue') return null;
    if (p.state === 'confirmed') return { label: 'Confirmed', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', border: '#bbf7d0' };
    if (p.state === 'invited')   return { label: 'Invited',   color: '#888888', bg: 'rgba(0,0,0,0.05)',    border: '#d0ccc7' };
    return null;
  }

  return (
    <>
      <View style={[ps.strip, { borderBottomColor: colors.border, backgroundColor: colors.bgFaint }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ps.row}
        >
          {active.map(p => {
            const tag  = stateTag(p);
            const isMe = p.userId === currentUserUid;
            return (
              <TouchableOpacity
                key={p.id}
                style={ps.avatarCol}
                onPress={() => {
                  if (!isMe) onOpenSubThread(p.userId, p.displayName, p.photoUrl);
                }}
                onLongPress={e => {
                  if (canRemove && !isMe && p.role !== 'venue' && p.role !== 'headliner') {
                    const { pageX, pageY } = e.nativeEvent;
                    setContextMenu({ participant: p, x: pageX, y: pageY });
                  }
                }}
                activeOpacity={isMe ? 1 : 0.7}
              >
                <View style={ps.avatarWrap}>
                  <Avatar photoUrl={p.photoUrl} name={p.displayName} size={30} />
                </View>
                <Text style={[ps.avatarName, { color: colors.black }]} numberOfLines={1}>{p.displayName}</Text>
                {tag && (
                  <View style={[ps.stateTag, { backgroundColor: tag.bg, borderColor: tag.border }]}>
                    <Text style={[ps.stateTagText, { color: tag.color }]}>{tag.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {declined.map(p => (
            <View key={p.id} style={[ps.avatarCol, ps.avatarColDeclined]}>
              <View style={[ps.avatarWrap, { opacity: 0.4 }]}>
                <Avatar photoUrl={p.photoUrl} name={p.displayName} size={40} />
              </View>
              <Text style={[ps.avatarName, { color: colors.grey }]} numberOfLines={1}>{p.displayName}</Text>
              <View style={[ps.stateTag, { backgroundColor: 'rgba(220,38,38,0.08)', borderColor: '#fca5a5' }]}>
                <Text style={[ps.stateTagText, { color: '#dc2626' }]}>Declined</Text>
              </View>
            </View>
          ))}

          {canInvite && (
            <TouchableOpacity style={ps.inviteBtn} onPress={onInvite} activeOpacity={0.7}>
              <View style={[ps.inviteCircle, { borderColor: colors.border }]}>
                <Text style={[ps.invitePlus, { color: Colors.orange }]}>+</Text>
              </View>
              <Text style={[ps.avatarName, { color: Colors.orange }]}>Invite</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Action sheet for venue removing a participant */}
      {contextMenu && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
          <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setContextMenu(null)}>
            <View style={[md.sheet, { backgroundColor: colors.bg }]}>
              <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#888888', fontWeight: '600' }}>
                  {contextMenu.participant.displayName}
                </Text>
              </View>
              <TouchableOpacity
                style={md.sheetItem}
                onPress={() => { setContextMenu(null); onRemove(contextMenu.participant); }}
              >
                <Text style={md.sheetDanger}>Remove from gig</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[md.sheetItem, md.sheetCancelItem]} onPress={() => setContextMenu(null)}>
                <Text style={[md.sheetText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}

const ps = StyleSheet.create({
  strip:           { borderBottomWidth: 1 },
  row:             { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 2, alignItems: 'flex-start' },
  avatarCol:       { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  avatarColDeclined: { opacity: 0.7 },
  avatarWrap:      { borderRadius: 16 },
  avatarName:      { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  stateTag:        { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1 },
  stateTagText:    { fontSize: 8, fontWeight: '700', letterSpacing: 0.2 },
  inviteBtn:       { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  inviteCircle:    { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  invitePlus:      { fontSize: 18, fontWeight: '300', lineHeight: 22, marginTop: -1 },
});

// ── Invite sheet ────────────────────────────────────────────────────────────

type MusicianRow = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  genre?: string;
  location?: string;
};

function InviteSheet({
  visible,
  onClose,
  enquiryId,
  participants,
  inviterUid,
  inviterName,
  inviterRole,
  venueId,
  venueName,
  onInvited,
}: {
  visible: boolean;
  onClose: () => void;
  enquiryId: string;
  participants: Participant[];
  inviterUid: string;
  inviterName: string;
  inviterRole: 'venue' | 'headliner';
  venueId: string;
  venueName: string;
  onInvited: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch]           = useState('');
  const [allMusicians, setAll]        = useState<MusicianRow[]>([]);
  const [pastCollabs, setPastCollabs] = useState<MusicianRow[]>([]);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [loading, setLoading]         = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const alreadyIn = new Set(participants.map(p => p.userId));

  useEffect(() => {
    if (!visible) { setSearch(''); setSelected(new Set()); return; }
    setLoading(true);

    async function load() {
      try {
        // Load past collaborators
        if (inviterRole === 'venue') {
          const collabs = await fetchVenuePastCollaborators(venueId);
          setPastCollabs(collabs.filter(c => !alreadyIn.has(c.userId)));
        } else {
          const collabs = await fetchHeadlinerPastCollaborators(inviterUid);
          setPastCollabs(collabs.filter(c => !alreadyIn.has(c.userId)));
        }

        // Load all band profiles
        const snap = await getDocs(query(collection(db, 'bandProfiles'), limit(200)));
        const rows: MusicianRow[] = snap.docs
          .map(d => ({
            userId:      d.id,
            displayName: d.data().name || d.data().bandName || 'Unknown',
            photoUrl:    d.data().photoUrl ?? null,
            genre:       (d.data().genre || []).slice(0, 2).join(', '),
            location:    d.data().location ?? '',
          }))
          .filter(r => !alreadyIn.has(r.userId));
        setAll(rows);
      } catch (e) {
        console.error('InviteSheet load:', e);
      }
      setLoading(false);
    }
    load();
  }, [visible, enquiryId]);

  const pastCollabIds = new Set(pastCollabs.map(c => c.userId));
  const filteredAll   = allMusicians.filter(m =>
    !pastCollabIds.has(m.userId) &&
    (!search || m.displayName.toLowerCase().includes(search.toLowerCase()) || (m.location ?? '').toLowerCase().includes(search.toLowerCase()))
  );
  const filteredPast  = pastCollabs.filter(m =>
    !search || m.displayName.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(userId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  async function handleInvite() {
    if (selected.size === 0) return;
    setSubmitting(true);
    const invitees = [...selected].map(uid => {
      const m = allMusicians.find(r => r.userId === uid) || pastCollabs.find(r => r.userId === uid);
      return { userId: uid, displayName: m?.displayName ?? 'Unknown', photoUrl: m?.photoUrl ?? null };
    });
    try {
      await inviteParticipants(enquiryId, invitees, inviterUid, inviterName);
      onInvited();
      onClose();
    } catch (e) {
      console.error('inviteParticipants:', e);
    }
    setSubmitting(false);
  }

  function MusicianItem({ m }: { m: MusicianRow }) {
    const checked = selected.has(m.userId);
    return (
      <TouchableOpacity
        style={[inv.row, checked && { backgroundColor: 'rgba(245,166,35,0.07)' }]}
        onPress={() => toggle(m.userId)}
        activeOpacity={0.7}
      >
        <Avatar photoUrl={m.photoUrl} name={m.displayName} size={38} />
        <View style={inv.rowInfo}>
          <Text style={[inv.rowName, { color: colors.black }]}>{m.displayName}</Text>
          {(m.genre || m.location) ? (
            <Text style={[inv.rowSub, { color: colors.grey }]} numberOfLines={1}>
              {[m.genre, m.location].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={[inv.checkbox, checked && inv.checkboxChecked]}>
          {checked && <Text style={inv.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isWeb ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={inv.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[inv.sheet, { backgroundColor: colors.bg }]}>
          {/* Handle / header */}
          <View style={[inv.header, { borderBottomColor: colors.border }]}>
            <Text style={[inv.title, { color: colors.black }]}>Invite musicians</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[inv.close, { color: colors.grey }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={[inv.searchWrap, { borderBottomColor: colors.border }]}>
            <TextInput
              style={[inv.searchInput, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
              placeholder="Search musicians"
              placeholderTextColor="#aaaaaa"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {loading ? (
            <View style={inv.loadingWrap}><ActivityIndicator color={Colors.orange} /></View>
          ) : (
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {filteredPast.length > 0 && (
                <>
                  <Text style={[inv.sectionLabel, { color: colors.grey }]}>Past collaborators</Text>
                  {filteredPast.map(m => <MusicianItem key={m.userId} m={m} />)}
                </>
              )}
              {filteredAll.length > 0 && (
                <>
                  <Text style={[inv.sectionLabel, { color: colors.grey }]}>All musicians</Text>
                  {filteredAll.map(m => <MusicianItem key={m.userId} m={m} />)}
                </>
              )}
              {filteredPast.length === 0 && filteredAll.length === 0 && (
                <Text style={[inv.empty, { color: colors.grey }]}>No musicians found</Text>
              )}
            </ScrollView>
          )}

          {/* Invite button — appears once someone is selected */}
          {selected.size > 0 && (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bg }}>
              <View style={[inv.footer, { borderTopColor: colors.border }]}>
                <TouchableOpacity
                  style={[inv.inviteBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleInvite}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#111111" size="small" />
                    : <Text style={inv.inviteBtnText}>Invite {selected.size}</Text>
                  }
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const inv = StyleSheet.create({
  backdrop:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:        { borderTopLeftRadius: isWeb ? 0 : 20, borderTopRightRadius: isWeb ? 0 : 20, maxHeight: '85%', minHeight: 300, ...(isWeb && { borderRadius: 16, maxWidth: 480, width: '100%', alignSelf: 'center', marginBottom: 'auto', marginTop: 'auto', maxHeight: '80%' } as any) },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingHorizontal: 20, borderBottomWidth: 1 },
  title:        { fontSize: 16, fontWeight: '800' },
  close:        { fontSize: 18 },
  searchWrap:   { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  searchInput:  { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  loadingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, textTransform: 'uppercase' as const },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowInfo:      { flex: 1, minWidth: 0 },
  rowName:      { fontSize: 14, fontWeight: '700' },
  rowSub:       { fontSize: 12, marginTop: 1 },
  checkbox:     { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#d0ccc7', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxChecked: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkMark:    { fontSize: 13, fontWeight: '700', color: '#111111' },
  empty:        { textAlign: 'center', padding: 40, fontSize: 14 },
  footer:       { borderTopWidth: 1, padding: 14, paddingHorizontal: 16 },
  inviteBtn:    { backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  inviteBtnText:{ fontSize: 15, fontWeight: '800', color: '#111111' },
});

// ── Thread tile ────────────────────────────────────────────────────────────

const STATUS_MOVE_OPTIONS: { status: Enquiry['status']; label: string }[] = [
  { status: 'enquired',   label: 'Enquired'   },
  { status: 'discussing', label: 'Discuss'    },
  { status: 'confirmed',  label: 'Confirm'    },
  { status: 'declined',   label: 'Decline'    },
];

function ThreadTile({ item, isVenue, isSelected, myUid, onPress, onDelete, rosterLabel }: {
  item: Enquiry; isVenue: boolean; isSelected: boolean; myUid: string; onPress: () => void; onDelete?: () => void; rosterLabel?: string | null;
}) {
  const router = useRouter();
  const who = isVenue ? item.bandName : item.venueName;
  const venuePhoto  = useVenuePhoto(!isVenue ? item.venueId : null);
  const avatarPhoto = isVenue ? (item.photoUrl ?? null) : venuePhoto;

  // Group gig detection: enquiry has more than 2 participantUids (venue + headliner + support)
  const isGroup = Array.isArray(item.participantUids) && item.participantUids.length > 2;
  const participants = useParticipants(isGroup ? item.id : null);

  // Build group title (Instagram-style): exclude self, show named members + overflow count
  const groupTitle = (() => {
    if (!isGroup || participants.length === 0) return null;
    const active = participants.filter(p => p.state !== 'declined' && p.state !== 'left');
    const myP = active.find(p => p.userId === myUid);
    const myRole = myP?.role ?? (isVenue ? 'venue' : 'headliner');

    let named: string[] = [];
    let overflow = 0;

    if (myRole === 'support') {
      // Support act: always show Venue, then Headliner, then +N others
      const venue     = active.find(p => p.role === 'venue');
      const headliner = active.find(p => p.role === 'headliner');
      const others    = active.filter(p => p.role === 'support' && p.userId !== myUid);
      if (venue)     named.push(venue.displayName);
      if (headliner) named.push(headliner.displayName);
      overflow = others.length;
    } else if (myRole === 'venue') {
      // Venue: show headliner first, then +N for support acts
      const headliner = active.find(p => p.role === 'headliner');
      const supports  = active.filter(p => p.role === 'support');
      if (headliner) named.push(headliner.displayName);
      overflow = supports.length;
    } else {
      // Headliner: show venue, then +N for support acts
      const venue    = active.find(p => p.role === 'venue');
      const supports = active.filter(p => p.role === 'support');
      if (venue) named.push(venue.displayName);
      overflow = supports.length;
    }

    const base = named.join(', ');
    return overflow > 0 ? `${base} +${overflow}` : base;
  })();

  const isUnread = !!(
    item.lastMessageAt &&
    (!item.lastReadAt?.[myUid] || item.lastMessageAt > item.lastReadAt[myUid])
  );
  const { day, date, time, slotType } = item.requestedSlot;
  const dateStr = date ? fmtSlotDate(date) : '';
  const slotStr      = [day, dateStr, time, slotType].filter(Boolean).join(' · ');
  const tileTzLbl    = tzLabel(getVenueTz(item));
  const cfg = getStatusCfg(item.status, isVenue);
  const fee = (item as any).fee ? `$${(item as any).fee}` : null;

  const badgeRef   = useRef<View>(null);
  const swipeRef   = useRef<Swipeable>(null);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [menuPos,       setMenuPos]       = useState<{ x: number; y: number } | null>(null);
  const [confirmDel,    setConfirmDel]    = useState(false);
  const [progressOpen,  setProgressOpen]  = useState(false);
  const doneCount = countDoneStages(item);

  function openMenu(e: any) {
    e.stopPropagation?.();
    (badgeRef.current as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
      setMenuPos({ x, y: y + h + 4 });
      setMenuOpen(true);
    });
  }

  async function pickStatus(status: Enquiry['status']) {
    setMenuOpen(false);
    if (status === 'confirmed') {
      // Always go through the confirm-gig modal — never set confirmed directly
      router.push({ pathname: '/confirm-gig', params: { enquiryId: item.id } });
      return;
    }
    await updateEnquiryStatus(item.id, status);
  }

  const normStatus = normalizeEnquiryStatus(item.status);
  const options = STATUS_MOVE_OPTIONS.filter(o => {
    if (normalizeEnquiryStatus(o.status) === normStatus) return false;
    // From enquired: only Discuss or Decline — Confirm requires discussion first
    if (normStatus === 'enquired')   return o.status === 'discussing' || o.status === 'declined';
    if (normStatus === 'discussing') return o.status === 'confirmed'  || o.status === 'declined';
    if (normStatus === 'confirmed')  return o.status === 'discussing' || o.status === 'declined';
    return true;
  });

  function renderRightActions() {
    if (!onDelete) return null;
    return (
      <TouchableOpacity
        style={tt.swipeDelete}
        onPress={() => { swipeRef.current?.close(); setConfirmDel(true); }}
        activeOpacity={0.85}
      >
        <Text style={tt.swipeDeleteText}>Archive</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false} friction={2}>
      <TouchableOpacity
        style={[tt.tile, isSelected && tt.tileActive]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        {isGroup && participants.length > 0 ? (
          <AvatarStack participants={participants} venuePhoto={isVenue ? null : venuePhoto} size={40} />
        ) : (
          <Avatar photoUrl={avatarPhoto} name={who} size={44} />
        )}
        <View style={tt.body}>
          <View style={tt.topRow}>
            <Text style={[tt.name, isSelected && { color: Colors.orange }, isUnread && { fontWeight: '800' }]} numberOfLines={1}>{groupTitle ?? who}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {isUnread && <View style={tt.unreadDot} />}
              <Text style={tt.time}>{formatTileDate(item.submittedAt)}</Text>
            </View>
          </View>
          <Text style={tt.slot} numberOfLines={1}>
            {slotStr || 'No slot specified'}
            {slotStr && tileTzLbl ? <Text style={tt.tzNote}>{`  ${tileTzLbl}`}</Text> : null}
          </Text>
          <View style={tt.bottomRow}>
            {isVenue ? (
              <TouchableOpacity
                ref={badgeRef}
                onPress={openMenu}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <View style={[tt.badge, { borderColor: '#d0ccc7' }]}>
                  <Text style={[tt.badgeText, { color: cfg.color }]}>{cfg.label} ▾</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={[tt.badge, { borderColor: '#d0ccc7' }]}>
                <Text style={[tt.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            )}
            {fee ? <Text style={tt.fee}>{fee}</Text> : null}
            {rosterLabel ? (
              <View style={tt.rosterLabel}>
                <View style={tt.rosterDot} />
                <Text style={tt.rosterLabelText}>{rosterLabel}</Text>
              </View>
            ) : null}
          </View>

          {/* Progress bar row */}
          <TouchableOpacity
            style={tt.progressRow}
            onPress={e => { (e as any).stopPropagation?.(); setProgressOpen(p => !p); }}
            activeOpacity={0.7}
          >
            <View style={tt.progressTrack}>
              <View style={[tt.progressFill, { width: `${Math.round((doneCount / BOOKING_STAGES.length) * 100)}%` as any }]} />
            </View>
            <Text style={tt.progressCount}>{doneCount} / {BOOKING_STAGES.length} stages</Text>
            <Text style={tt.progressChevron}>{progressOpen ? '▾' : '▸'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
      </Swipeable>
      {progressOpen && <StageDropdownList item={item} isVenue={isVenue} />}

      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          {menuPos && (
            <View style={[tt.menuCard, { top: menuPos.y, left: menuPos.x }]}>
              {options.map((opt, i) => {
                const optCfg = getStatusCfg(opt.status, isVenue);
                return (
                  <TouchableOpacity
                    key={opt.status}
                    style={[tt.menuItem, i < options.length - 1 && tt.menuItemBorder]}
                    onPress={() => pickStatus(opt.status)}
                    activeOpacity={0.75}
                  >
                    <View style={[tt.menuDot, { backgroundColor: optCfg.color }]} />
                    <Text style={[tt.menuLabel, { color: optCfg.color }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      </Modal>

      {(() => {
        const norm        = normalizeEnquiryStatus(item.status);
        const isPending   = norm === 'enquired' || norm === 'discussing';
        const tileTitle   = isPending ? (isVenue ? 'Decline enquiry?' : 'Withdraw enquiry?') : 'Archive conversation?';
        const tileBody    = isPending
          ? (isVenue ? 'This will decline the enquiry and remove it from your inbox.' : 'This will withdraw your enquiry and remove it from your inbox.')
          : 'This removes the conversation from your inbox. The booking is not affected.';
        const tileBtnLbl  = isPending ? (isVenue ? 'Decline' : 'Withdraw') : 'Archive';
        return (
          <Modal visible={confirmDel} transparent animationType="fade" onRequestClose={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
            <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
              <View style={[md.confirm, { backgroundColor: '#ffffff' }]}>
                <Text style={md.confirmTitle}>{tileTitle}</Text>
                <Text style={md.confirmBody}>{tileBody}</Text>
                <View style={md.confirmBtns}>
                  <TouchableOpacity style={[md.confirmBtn, { borderColor: '#e8e8e8' }]} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
                    <Text style={[md.confirmBtnText, { color: '#888888' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmDel(false); onDelete?.(); }}>
                    <Text style={md.confirmBtnDangerText}>{tileBtnLbl}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}
    </>
  );
}

const tt = StyleSheet.create({
  tile:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee', backgroundColor: '#fafafa' },
  tileActive:     { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  body:           { flex: 1, minWidth: 0, gap: 3 },
  topRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bottomRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  name:           { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:           { fontSize: 11, color: '#bbbbbb', flexShrink: 0 },
  slot:           { fontSize: 12, color: '#777777' },
  tzNote:         { fontSize: 10, color: '#bbbbbb' },
  badge:          { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, backgroundColor: '#ffffff' },
  badgeText:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  fee:            { fontSize: 12, fontWeight: '600', color: '#444444' },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
  menuCard:       { position: 'absolute', backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e8e8e8', minWidth: 150, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuDot:        { width: 8, height: 8, borderRadius: 4 },
  menuLabel:      { fontSize: 13, fontWeight: '700' },
  swipeDelete:    { backgroundColor: '#dc2626', justifyContent: 'center', alignItems: 'center', width: 80 },
  swipeDeleteText:{ fontSize: 14, fontWeight: '700', color: '#ffffff' },
  rosterLabel:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as any },
  rosterDot:      { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.orange },
  rosterLabelText:{ fontSize: 12, fontWeight: '700', color: Colors.orange },
  progressRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#eeeeee', backgroundColor: '#fafafa' },
  progressTrack:  { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#e8e8e8', overflow: 'hidden' as const },
  progressFill:   { height: 3, borderRadius: 2, backgroundColor: Colors.orange },
  progressCount:  { fontSize: 11, fontWeight: '600', color: '#aaaaaa', flexShrink: 0 },
  progressChevron:{ fontSize: 11, color: '#aaaaaa', flexShrink: 0, width: 10 },
});

// ── Profile section sharing ────────────────────────────────────────────────

const SHARE_SECTIONS = [
  { key: 'basicInfo',   label: 'Basic Info'   },
  { key: 'about',       label: 'About'        },
  { key: 'music',       label: 'Music'        },
  { key: 'rates',       label: 'Rates'        },
  { key: 'techRider',   label: 'Tech Rider'   },
  { key: 'hospitality', label: 'Hospitality'  },
  { key: 'invoicing',   label: 'Invoicing'    },
] as const;

/** Extracts the relevant data for a given section key. Returns null if nothing is saved. */
function extractSectionData(p: Record<string, any>, key: string): Record<string, any> | null {
  switch (key) {
    case 'basicInfo': {
      const has = p.name || p.artistType || p.location || p.genre?.length || p.feeMin != null || p.email || p.phone
        || p.instagram || p.tiktok || p.youtube || p.spotify || p.appleMusic || p.customLinks?.length;
      return has ? { name: p.name, artistType: p.artistType, location: p.location, genre: p.genre,
                     feeMin: p.feeMin, feeMax: p.feeMax, email: p.email, phone: p.phone,
                     instagram: p.instagram, tiktok: p.tiktok, youtube: p.youtube,
                     spotify: p.spotify, appleMusic: p.appleMusic, customLinks: p.customLinks } : null;
    }
    case 'about':
      return p.about ? { about: p.about } : null;
    case 'music':
      return (p.songs?.length || p.spotify || p.appleMusic)
        ? { songs: p.songs, spotify: p.spotify, appleMusic: p.appleMusic } : null;
    case 'rates': {
      const gigs: any[] = Array.isArray(p.gigHistory) ? p.gigHistory : [];
      const withAtt = gigs.filter((g: any) => g.attendance != null && Number(g.attendance) > 0);
      const computedDraw = withAtt.length > 0
        ? Math.round(withAtt.reduce((s: number, g: any) => s + Number(g.attendance), 0) / withAtt.length)
        : (p.averageDraw ?? null);
      const has = p.feeMin != null || computedDraw != null || p.travel;
      return has ? { feeMin: p.feeMin, feeMax: p.feeMax, averageDraw: computedDraw, travel: p.travel } : null;
    }
    case 'techRider': {
      const tr = p.techRider && typeof p.techRider === 'object' ? p.techRider : null;
      const has = tr || p.backlineFromVenue?.length || p.backlineBring?.length || p.techRiderBools?.ownPA || p.inputChannels?.length || p.techRiderDocs?.length;
      return has ? { techRider: p.techRider, backlineFromVenue: p.backlineFromVenue, backlineBring: p.backlineBring,
                     techRiderBools: p.techRiderBools, inputChannels: p.inputChannels, techRiderDocs: p.techRiderDocs } : null;
    }
    case 'hospitality':
      return p.hospitality && Object.keys(p.hospitality).length ? p.hospitality : null;
    case 'invoicing': {
      const pay = p.payment;
      if (!pay) return null;
      const hasInv = pay.invoicingName || pay.abn || pay.canProvideInvoice || pay.gstRegistered
        || pay.methods?.length || pay.timing || pay.paymentNotes;
      return hasInv ? pay : null;
    }
    default:
      return null;
  }
}

function ProfileSectionBubble({ message, isMine }: { message: any; isMine: boolean }) {
  const { sectionKey, sectionLabel, data = {} } = message;
  const bg     = isMine ? '#111111' : '#f0ede8';
  const fg     = isMine ? '#ffffff' : '#111111';
  const dim    = isMine ? 'rgba(255,255,255,0.55)' : '#888888';
  const divC   = isMine ? 'rgba(255,255,255,0.15)' : '#dedede';

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <View style={bs.row}>
        <Text style={[bs.rowKey, { color: dim }]}>{label}</Text>
        <Text style={[bs.rowVal, { color: fg }]}>{value}</Text>
      </View>
    );
  }
  function Download({ name, url }: { name: string; url: string }) {
    return (
      <TouchableOpacity onPress={() => Linking.openURL(url)} style={bs.downloadRow}>
        <Text style={[bs.downloadText, { color: fg }]}>↓ {name}</Text>
      </TouchableOpacity>
    );
  }

  let content: React.ReactNode;

  switch (sectionKey) {
    case 'basicInfo': {
      const genres: string[] = data.genre ?? [];
      const customLinks: any[] = data.customLinks ?? [];
      content = <>
        {data.name        && <Row label="Stage name"    value={data.name} />}
        {data.artistType  && <Row label="Act type"      value={data.artistType} />}
        {data.location    && <Row label="Location"      value={data.location} />}
        {genres.length > 0 && <Row label="Genres"       value={genres.join(', ')} />}
        {data.feeMin != null && data.feeMax != null && <Row label="Fee range" value={`$${data.feeMin}–$${data.feeMax}`} />}
        {data.averageDraw != null && <Row label="Average draw" value={`~${data.averageDraw} people`} />}
        {data.email       && <Row label="Email"         value={data.email} />}
        {data.phone       && <Row label="Phone"         value={data.phone} />}
        {data.instagram   && <Row label="Instagram"    value={data.instagram} />}
        {data.tiktok      && <Row label="TikTok"       value={data.tiktok} />}
        {data.youtube     && <Row label="YouTube"      value={data.youtube} />}
        {data.spotify     && <Row label="Spotify"      value={data.spotify} />}
        {data.appleMusic  && <Row label="Apple Music"  value={data.appleMusic} />}
        {customLinks.filter((l: any) => l.label && l.url).map((l: any, i: number) => (
          <Row key={i} label={l.label} value={l.url} />
        ))}
      </>;
      break;
    }
    case 'about':
      content = <Text style={[bs.bodyText, { color: fg }]}>{data.about || 'No bio saved.'}</Text>;
      break;
    case 'music': {
      const songs: any[] = data.songs ?? [];
      content = <>
        {songs.map((s: any, i: number) => (
          <Row key={i} label={s.title || `Track ${i + 1}`} value={[s.url, s.notes].filter(Boolean).join(' · ') || '—'} />
        ))}
        {data.spotify    && <Row label="Spotify"     value={data.spotify} />}
        {data.appleMusic && <Row label="Apple Music" value={data.appleMusic} />}
        {!songs.length && !data.spotify && !data.appleMusic && (
          <Text style={[bs.emptyText, { color: dim }]}>No music saved.</Text>
        )}
      </>;
      break;
    }
    case 'rates':
      content = <>
        {data.feeMin != null && data.feeMax != null && <Row label="Fee range"    value={`$${data.feeMin}–$${data.feeMax}`} />}
        {data.averageDraw != null                    && <Row label="Average draw" value={`~${data.averageDraw} people`} />}
        {data.travel                                 && <Row label="Travel"       value={data.travel} />}
        {data.feeMin == null && data.averageDraw == null && !data.travel && (
          <Text style={[bs.emptyText, { color: dim }]}>No rate info saved.</Text>
        )}
      </>;
      break;
    case 'techRider': {
      const tr   = data.techRider && typeof data.techRider === 'object' ? data.techRider as Record<string, any> : null;
      const bfv: string[] = Array.isArray(data.backlineFromVenue) ? data.backlineFromVenue : [];
      const bb: string[]  = Array.isArray(data.backlineBring)     ? data.backlineBring     : [];
      const trb           = data.techRiderBools || {};
      const chs: any[]    = Array.isArray(data.inputChannels)     ? data.inputChannels     : [];
      const trDocs: any[] = Array.isArray(data.techRiderDocs)     ? data.techRiderDocs     : [];
      content = <>
        {(tr?.stageWidth || tr?.stageDepth) && (
          <Row label="Min stage" value={
            tr.stageWidth && tr.stageDepth ? `${tr.stageWidth}m × ${tr.stageDepth}m`
              : tr.stageWidth || tr.stageDepth
          } />
        )}
        {(tr?.monitoringType || tr?.monitoring) && (
          <Row label="Monitoring" value={[tr.monitoringType, tr.monitoring].filter(Boolean).join(' · ')} />
        )}
        {bfv.length > 0  && <Row label="Needs from venue"      value={bfv.join(', ')} />}
        {bb.length > 0   && <Row label="Brings own"            value={bb.join(', ')} />}
        {trb.ownPA       && <Row label="Touring with own PA"   value="Yes" />}
        {tr?.soundcheck  && <Row label="Soundcheck"            value={tr.soundcheck} />}
        {tr?.loadIn      && <Row label="Load-in"               value={tr.loadIn} />}
        {tr?.lighting    && <Row label="Lighting"              value={tr.lighting} />}
        {tr?.power       && <Row label="Power"                 value={tr.power} />}
        {chs.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={[bs.rowKey, { color: dim }]}>Input list ({chs.length} ch)</Text>
            {chs.map((ch: any, i: number) => (
              <Text key={i} style={[bs.channelRow, { color: fg }]}>
                {String(i + 1).padStart(2, '0')} · {ch.source || '—'}{ch.micDi ? ` / ${ch.micDi}` : ''}
              </Text>
            ))}
          </View>
        )}
        {tr?.notes && <Text style={[bs.notesText, { color: dim }]}>{tr.notes}</Text>}
        {tr?.stagePlotUrl  && <Download name="Stage Plot"                       url={tr.stagePlotUrl} />}
        {tr?.inputListUrl  && <Download name={tr.inputListName || 'Input List'} url={tr.inputListUrl} />}
        {trDocs.map((d: any, i: number) => <Download key={i} name={d.name} url={d.url} />)}
      </>;
      break;
    }
    case 'hospitality': {
      const h = data;
      const hasData = h.mealsRequired || h.dietaryReqs || h.drinks || h.greenRoom || h.merchTable || h.parkingLoading || h.accommodation;
      content = !hasData
        ? <Text style={[bs.emptyText, { color: dim }]}>No hospitality info saved yet.</Text>
        : <>
          {h.mealsRequired  && <Row label="Meals required"  value="Yes" />}
          {h.mealCount      && <Row label="Meal count"      value={h.mealCount} />}
          {h.dietaryReqs    && <Row label="Dietary reqs"    value={h.dietaryReqs} />}
          {h.drinks         && <Row label="Drinks"          value={h.drinks} />}
          {h.greenRoom      && <Row label="Green room"      value="Yes" />}
          {h.merchTable     && <Row label="Merch table"     value="Yes" />}
          {h.parkingLoading && <Row label="Parking"         value={h.parkingLoading} />}
          {h.accommodation  && <Row label="Accommodation"   value="Yes" />}
        </>;
      break;
    }
    case 'invoicing': {
      const inv = data;
      const timingVal = inv.timing === 'Other' && inv.timingOther ? inv.timingOther : inv.timing;
      content = <>
        {inv.invoicingName     && <Row label="Invoicing name"      value={inv.invoicingName} />}
        {inv.abn               && <Row label="ABN"                 value={inv.abn} />}
        {inv.gstRegistered != null && <Row label="Registered for GST" value={inv.gstRegistered ? 'Yes' : 'No'} />}
        {inv.canProvideInvoice != null && <Row label="Can provide invoice" value={inv.canProvideInvoice ? 'Yes' : 'No'} />}
        {Array.isArray(inv.methods) && inv.methods.length > 0 && <Row label="Accepted methods" value={inv.methods.join(', ')} />}
        {timingVal             && <Row label="Payment timing"      value={timingVal} />}
        {inv.paymentNotes      && <Row label="Notes"               value={inv.paymentNotes} />}
      </>;
      break;
    }
    default:
      content = <Text style={[bs.emptyText, { color: dim }]}>No data.</Text>;
  }

  return (
    <View style={[bs.bubble, { backgroundColor: bg }]}>
      <View style={[bs.header, { borderBottomColor: divC }]}>
        <Text style={[bs.headerLabel, { color: dim }]}>{(sectionLabel as string).toUpperCase()}</Text>
      </View>
      <View style={bs.body}>{content}</View>
    </View>
  );
}

const bs = StyleSheet.create({
  bubble:      { borderRadius: 14, overflow: 'hidden' as const, maxWidth: isWeb ? 480 : '90%' },
  header:      { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  headerLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  body:        { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  row:         { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  rowKey:      { fontSize: 12, fontWeight: '600', width: 120, flexShrink: 0, lineHeight: 18 },
  rowVal:      { fontSize: 12, flex: 1, lineHeight: 18 },
  bodyText:    { fontSize: 13, lineHeight: 19 },
  emptyText:   { fontSize: 12, fontStyle: 'italic' },
  channelRow:  { fontSize: 11, lineHeight: 17, marginLeft: 4 },
  notesText:   { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  downloadRow: { marginTop: 4 },
  downloadText:{ fontSize: 12, textDecorationLine: 'underline' as const },
});

// ── Enquiry details bubble (expandable from header, venue view) ────────────

function EnquiryBubble({ enquiry, isVenue, profileRef, musicRef, techRef }: {
  enquiry: Enquiry; isVenue: boolean;
  profileRef?: React.RefObject<View>; musicRef?: React.RefObject<View>; techRef?: React.RefObject<View>;
}) {
  const { day, date, time, room, slotType, setLength } = enquiry.requestedSlot;
  const dateStr  = date ? fmtSlotDate(date) : '';
  const slotStr  = [day, dateStr, time, room, slotType, setLength].filter(Boolean).join(' · ');
  const sentLabel = isVenue ? enquiry.bandName : 'You';
  const sentDate  = formatTileDate(enquiry.submittedAt);

  // Venue views: artist sent this (grey theirs bubble)
  // Artist views: they sent this (dark mine bubble)
  const isMine = !isVenue;

  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(isVenue ? ['about', 'music', 'gigHistory'] : [])
  );
  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // For non-confirmed enquiries, subscribe to the musician's live profile so the
  // venue always sees current info. Confirmed enquiries stay as the original snapshot.
  const isConfirmed = normalizeEnquiryStatus(enquiry.status) === 'confirmed';
  const [liveProfile, setLiveProfile] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (isConfirmed || !enquiry.createdBy) return;
    return onSnapshot(doc(db, 'bandProfiles', enquiry.createdBy), snap => {
      if (snap.exists()) setLiveProfile(snap.data());
    });
  }, [enquiry.createdBy, isConfirmed]);

  // sharedSections gates which profile sections were originally included.
  // If absent (legacy enquiry), treat all sections as shared.
  const ss = (enquiry as any).sharedSections as Record<string, boolean> | undefined;
  const hasSection = (key: string) => (ss ? !!ss[key] : true);

  const src: typeof enquiry = (!isConfirmed && liveProfile) ? {
    ...enquiry,
    genre:      liveProfile.genre      ?? enquiry.genre,
    location:   liveProfile.location   ?? enquiry.location,
    artistType: liveProfile.artistType ?? enquiry.artistType,
    feeMin:     liveProfile.feeMin     ?? enquiry.feeMin,
    feeMax:     liveProfile.feeMax     ?? enquiry.feeMax,
    ...(hasSection('about')     && { about: liveProfile.about }),
    ...(hasSection('music')     && { songs: liveProfile.songs, spotify: liveProfile.spotify, appleMusic: liveProfile.appleMusic }),
    ...(hasSection('socials')   && { instagram: liveProfile.instagram, tiktok: liveProfile.tiktok, youtube: liveProfile.youtube, customLinks: liveProfile.customLinks }),
    ...(hasSection('techRider') && {
      techRider:         liveProfile.techRider,
      backlineFromVenue: liveProfile.backlineFromVenue,
      backlineBring:     liveProfile.backlineBring,
      techRiderBools:    liveProfile.techRiderBools,
      inputChannels:     liveProfile.inputChannels,
      techRiderDocs:     liveProfile.techRiderDocs,
    }),
    ...(hasSection('gigs')    && { gigHistory: liveProfile.gigHistory }),
    ...(hasSection('contact') && { email: liveProfile.email, phone: liveProfile.phone }),
  } : enquiry;

  const genres: string[]            = src.genre ?? [];
  const songs: any[]                = Array.isArray(src.songs)              ? src.songs              : [];
  const gigHistory: any[]           = Array.isArray(src.gigHistory)          ? src.gigHistory          : [];
  const upcoming: any[]             = Array.isArray(src.upcomingGigs)        ? src.upcomingGigs        : [];
  const techRider                   = src.techRider && typeof src.techRider === 'object' ? src.techRider as Record<string, any> : null;
  const backlineFromVenue: string[] = Array.isArray((src as any).backlineFromVenue) ? (src as any).backlineFromVenue : [];
  const backlineBring: string[]     = Array.isArray((src as any).backlineBring)     ? (src as any).backlineBring     : [];
  const techRiderBools              = (src as any).techRiderBools && typeof (src as any).techRiderBools === 'object' ? (src as any).techRiderBools as Record<string, boolean> : {};
  const inputChannels: any[]        = Array.isArray((src as any).inputChannels)     ? (src as any).inputChannels     : [];
  const techRiderDocs: any[]        = Array.isArray((src as any).techRiderDocs)     ? (src as any).techRiderDocs     : [];
  const customLinks: any[]          = Array.isArray(src.customLinks)                ? src.customLinks                : [];

  const hasTechRider = !!(
    (techRider && Object.entries(techRider).some(([k, v]) => v && !['stagePlotUrl','inputListUrl','inputListName'].includes(k))) ||
    backlineFromVenue.length > 0 || backlineBring.length > 0 || techRiderBools.ownPA || inputChannels.length > 0
  );
  const hasDownloads = !!(techRider?.stagePlotUrl || techRider?.inputListUrl || techRiderDocs.length > 0);

  const textColor = isMine ? '#ffffff' : '#111111';
  const dimColor  = isMine ? 'rgba(255,255,255,0.55)' : '#888888';
  const divColor  = isMine ? 'rgba(255,255,255,0.18)' : '#e8e8e8';

  function Section({ label, sectionKey, children, sectionRef }: { label: string; sectionKey: string; children: React.ReactNode; sectionRef?: React.RefObject<View> }) {
    const isOpen = openSections.has(sectionKey);
    return (
      <View ref={sectionRef as any} style={[eq.section, { borderTopColor: divColor }]}>
        <TouchableOpacity onPress={() => toggleSection(sectionKey)} style={eq.sectionHeader} activeOpacity={0.7}>
          <Text style={[eq.sectionLabel, { color: dimColor }]}>{label}</Text>
          <Text style={[eq.sectionChevron, { color: dimColor }]}>{isOpen ? '▾' : '▸'}</Text>
        </TouchableOpacity>
        {isOpen ? <View style={{ paddingTop: 4 }}>{children}</View> : null}
      </View>
    );
  }

  return (
    <View>
      <Text style={tp.enquirySentLabel}>{sentLabel} · {sentDate}</Text>
      <View style={[tp.msgRow, isMine ? tp.rowMine : tp.rowTheirs]}>
      <View style={[tp.msgCol, isMine && tp.msgColMine]}>
        <View style={[eq.bubble, isMine ? tp.bubbleMine : tp.bubbleTheirs]}>

          {/* Artist type + genres */}
          {(src.artistType || genres.length > 0) ? (
            <View style={[eq.pillsRow]}>
              {src.artistType ? (
                <View style={[eq.typePill, { borderColor: isMine ? 'rgba(255,255,255,0.35)' : Colors.orange + '55', backgroundColor: isMine ? 'rgba(255,255,255,0.12)' : Colors.orange + '18' }]}>
                  <Text style={[eq.typeText, { color: isMine ? '#ffffff' : Colors.orange }]}>{src.artistType}</Text>
                </View>
              ) : null}
              {genres.map(g => (
                <View key={g} style={[eq.genrePill, { borderColor: divColor }]}>
                  <Text style={[eq.genreText, { color: isMine ? 'rgba(255,255,255,0.75)' : '#555555' }]}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Location, draw, fee range */}
          {(src.location || enquiry.averageDraw != null || (src.feeMin != null && src.feeMax != null)) ? (
            <Text style={[eq.meta, { color: dimColor }]}>
              {[
                src.location,
                enquiry.averageDraw != null ? `~${enquiry.averageDraw} draw` : null,
                (src.feeMin != null && src.feeMax != null) ? `$${src.feeMin}-$${src.feeMax}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          {/* About */}
          {src.about ? (
            <Section label="ABOUT" sectionKey="about" sectionRef={profileRef}>
              <Text style={[eq.body, { color: textColor }]}>{src.about}</Text>
            </Section>
          ) : null}

          {/* Music */}
          {songs.length > 0 ? (
            <Section label="MUSIC" sectionKey="music" sectionRef={musicRef}>
              {songs.map((s: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {s.title}{s.url ? ` — ${s.url}` : ''}{s.notes ? ` (${s.notes})` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Gig history */}
          {gigHistory.length > 0 ? (
            <Section label="GIG HISTORY" sectionKey="gigHistory">
              {gigHistory.map((g: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {g.venue}{g.suburb ? `, ${g.suburb}` : ''}{g.date ? ` · ${g.date}` : ''}{g.attendance != null ? ` · ~${g.attendance} draw` : ''}{g.notes ? ` (${g.notes})` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Upcoming gigs */}
          {upcoming.length > 0 ? (
            <Section label="UPCOMING GIGS" sectionKey="upcomingGigs">
              {upcoming.map((g: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>
                  {g.venue}{g.suburb ? `, ${g.suburb}` : ''}{g.date ? ` · ${g.date}` : ''}{g.notes ? ` — ${g.notes}` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {/* Socials */}
          {(src.instagram || src.tiktok || (src as any).youtube || customLinks.length > 0) ? (
            <Section label="SOCIALS" sectionKey="socials">
              {src.instagram          ? <Text style={[eq.body, { color: textColor }]}>Instagram: {src.instagram}</Text>    : null}
              {src.tiktok             ? <Text style={[eq.body, { color: textColor }]}>TikTok: {src.tiktok}</Text>          : null}
              {(src as any).youtube   ? <Text style={[eq.body, { color: textColor }]}>YouTube: {(src as any).youtube}</Text> : null}
              {customLinks.filter((l: any) => l.label && l.url).map((l: any, i: number) => (
                <Text key={i} style={[eq.body, { color: textColor }]}>{l.label}: {l.url}</Text>
              ))}
            </Section>
          ) : null}

          {/* Tech rider */}
          {hasTechRider ? (
            <Section label="TECH RIDER" sectionKey="techRider" sectionRef={techRef}>
              {(techRider?.stageWidth || techRider?.stageDepth) ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Min stage: </Text>
                  {techRider?.stageWidth && techRider?.stageDepth
                    ? `${techRider.stageWidth}m × ${techRider.stageDepth}m`
                    : techRider?.stageWidth || techRider?.stageDepth}
                </Text>
              ) : null}
              {(techRider?.monitoringType || techRider?.monitoring) ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Monitoring: </Text>
                  {[techRider?.monitoringType, techRider?.monitoring].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {backlineFromVenue.length > 0 ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Needs from venue: </Text>{backlineFromVenue.join(', ')}
                </Text>
              ) : null}
              {backlineBring.length > 0 ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Brings own: </Text>{backlineBring.join(', ')}
                </Text>
              ) : null}
              {techRiderBools.ownPA ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>PA: </Text>Touring with own PA and engineer
                </Text>
              ) : null}
              {techRider?.soundcheck ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Soundcheck: </Text>{techRider.soundcheck}
                </Text>
              ) : null}
              {techRider?.loadIn ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Load-in: </Text>{techRider.loadIn}
                </Text>
              ) : null}
              {techRider?.lighting ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Lighting: </Text>{techRider.lighting}
                </Text>
              ) : null}
              {techRider?.power ? (
                <Text style={[eq.body, { color: textColor }]}>
                  <Text style={eq.riderKey}>Power: </Text>{techRider.power}
                </Text>
              ) : null}
              {inputChannels.length > 0 ? (
                <View style={{ marginTop: 6, gap: 2 }}>
                  <Text style={[eq.riderKey, { color: dimColor }]}>Input list ({inputChannels.length} ch)</Text>
                  {inputChannels.map((ch: any, i: number) => (
                    <Text key={i} style={[eq.body, { color: textColor }]}>
                      {String(i + 1).padStart(2, '0')} · {ch.source || '—'}{ch.micDi ? ` / ${ch.micDi}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
              {techRider?.notes ? (
                <Text style={[eq.body, { color: dimColor, marginTop: 4 }]}>{techRider.notes}</Text>
              ) : null}
            </Section>
          ) : null}

          {/* Downloads */}
          {hasDownloads ? (
            <Section label="DOWNLOADS" sectionKey="downloads">
              {techRider?.stagePlotUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(techRider!.stagePlotUrl)}>
                  <Text style={[eq.link, { color: textColor }]}>↓ Stage Plot</Text>
                </TouchableOpacity>
              ) : null}
              {techRider?.inputListUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(techRider!.inputListUrl)}>
                  <Text style={[eq.link, { color: textColor }]}>↓ {techRider.inputListName || 'Input List'}</Text>
                </TouchableOpacity>
              ) : null}
              {techRiderDocs.map((doc: any, i: number) => (
                <TouchableOpacity key={i} onPress={() => Linking.openURL(doc.url)}>
                  <Text style={[eq.link, { color: textColor }]}>↓ {doc.name}</Text>
                </TouchableOpacity>
              ))}
            </Section>
          ) : null}

          {/* Additional info */}
          {enquiry.additionalInfo ? (
            <Section label="NOTE TO VENUE" sectionKey="additionalInfo">
              <Text style={[eq.body, { color: textColor }]}>{enquiry.additionalInfo}</Text>
            </Section>
          ) : null}
        </View>
      </View>
      </View>
    </View>
  );
}

const eq = StyleSheet.create({
  bubble:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, maxWidth: isWeb ? 480 : '90%' },
  slotRow:      { marginBottom: 8 },
  slotText:     { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  pillsRow:     { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 },
  typePill:     { borderRadius: 4, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:     { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  genrePill:    { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  genreText:    { fontSize: 11 },
  meta:         { fontSize: 12, marginBottom: 4 },
  section:        { borderTopWidth: 1, paddingTop: 8, marginTop: 8, gap: 3 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel:   { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginBottom: 2, textTransform: 'uppercase' as const },
  sectionChevron: { fontSize: 10, fontWeight: '700', marginBottom: 2 },
  body:           { fontSize: 13, lineHeight: 19 },
  riderKey:       { fontSize: 13, fontWeight: '700', lineHeight: 19 },
  link:           { fontSize: 13, lineHeight: 22, textDecorationLine: 'underline' as const },
});

// ── Thread panel ───────────────────────────────────────────────────────────

function ThreadPanel({ enquiry, isVenue, venueId, onBack }: {
  enquiry: Enquiry; isVenue: boolean; venueId: string | null; onBack?: () => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const messages     = useMessages(enquiry.id);
  const participants = useParticipants(enquiry.id);
  const scrollRef    = useRef<ScrollView>(null);
  const profileRef   = useRef<View>(null);
  const musicRef     = useRef<View>(null);
  const techRef      = useRef<View>(null);

  function scrollToRef(ref: React.RefObject<View>) {
    ref.current?.measureLayout(
      scrollRef.current as any,
      (_x: number, y: number) => scrollRef.current?.scrollTo({ y, animated: true }),
      () => {},
    );
  }

  const [chatText,      setChatText]      = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [expandedForm,  setExpandedForm]  = useState<null | 'decline'>(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [inviteOpen,    setInviteOpen]    = useState(false);
  const [toastVisible,  setToastVisible]  = useState(false);
  const [toastMsg,      setToastMsg]      = useState('');
  const [undoData,      setUndoData]      = useState<{ participantId: string; uid: string } | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [artistProfile, setArtistProfile] = useState<Record<string, any> | null>(null);

  // Load the musician's own profile so they can share sections mid-conversation
  useEffect(() => {
    if (isVenue || !user?.uid) return;
    return onSnapshot(doc(db, 'bandProfiles', user.uid), snap => {
      if (snap.exists()) setArtistProfile(snap.data());
    });
  }, [isVenue, user?.uid]);

  async function handleSendSection(sectionKey: string, sectionLabel: string) {
    if (!user || !artistProfile) return;
    setShareMenuOpen(false);
    const data = extractSectionData(artistProfile, sectionKey);
    if (!data) return;
    setSubmitting(true);
    try {
      await sendProfileSection(enquiry.id, user.uid, sectionKey, sectionLabel, data);
    } catch (e) {
      console.error('sendProfileSection:', e);
    }
    setSubmitting(false);
  }

  const who = isVenue ? enquiry.bandName : enquiry.venueName;
  const venueThreadPhoto = useVenuePhoto(!isVenue ? enquiry.venueId : null);
  const otherPhotoResolved = isVenue ? (enquiry.photoUrl ?? null) : venueThreadPhoto;
  const declineReasonSaved = (enquiry as any).declineReason || (enquiry as any).reason;
  const isClosed = enquiry.status === 'declined' || enquiry.status === 'cancelled';

  // Determine my participant record (for group gig role checks)
  const myParticipant = participants.find(p => p.userId === user?.uid);
  const isGroupGig    = participants.length > 0;
  const isSupportAct  = myParticipant?.role === 'support';
  const myDisplayName = myParticipant?.displayName ?? (user as any)?.displayName ?? '';

  // Venue profile for invite sheet + confirm headliner
  const [venueDisplayName, setVenueDisplayName] = useState('');
  const [venuePhotoUrl,    setVenuePhotoUrl]    = useState<string | null>(null);
  const [venueOwnerUid,    setVenueOwnerUid]    = useState<string | null>(null);
  useEffect(() => {
    if (!enquiry.venueId) return;
    // Fetch venue doc for name/photo
    getDoc(doc(db, 'venues', enquiry.venueId)).then(snap => {
      if (snap.exists()) {
        setVenueDisplayName(snap.data().name ?? enquiry.venueName ?? '');
        setVenuePhotoUrl(snap.data().photoUrl ?? null);
      }
    }).catch(() => {});
    // Fetch venue owner UID from users collection
    getDocs(query(collection(db, 'users'), where('venueId', '==', enquiry.venueId), limit(1))).then(snap => {
      if (!snap.empty) setVenueOwnerUid(snap.docs[0].id);
    }).catch(() => {});
  }, [enquiry.venueId]);

  // Auto-add venue as a participant when the thread is opened.
  // When the viewer IS the venue, use their uid directly (no lookup needed).
  // When the viewer is an artist, use the looked-up venueOwnerUid.
  useEffect(() => {
    const uid  = isVenue ? user?.uid : venueOwnerUid;
    const name = venueDisplayName || enquiry.venueName;
    if (!uid || !enquiry.id || !name || participants.length === 0) return;
    ensureVenueParticipant(enquiry.id, uid, name, venuePhotoUrl).catch(() => {});
  }, [isVenue, user?.uid, venueOwnerUid, enquiry.id, venueDisplayName, venuePhotoUrl, participants.length]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  // Mark thread as read whenever it's open and new messages arrive
  useEffect(() => {
    if (user?.uid) markEnquiryRead(enquiry.id, user.uid).catch(() => {});
  }, [enquiry.id, user?.uid, messages.length]);

  function toggleForm(form: 'decline') {
    setExpandedForm(prev => prev === form ? null : form);
  }

  async function handleSendChat() {
    const msg = chatText.trim();
    if (!msg || !user) return;
    setSubmitting(true);
    await sendMessage(enquiry.id, user.uid, msg);
    setChatText('');
    setSubmitting(false);
  }

  async function handleDecline() {
    setSubmitting(true);
    if (declineReason.trim() && user) {
      await sendMessage(enquiry.id, user.uid, declineReason.trim());
    }
    await updateEnquiryStatus(enquiry.id, 'declined', declineReason.trim() || undefined);
    setExpandedForm(null);
    setDeclineReason('');
    setSubmitting(false);
  }

  async function handleDelete() {
    if (!user) return;
    // Support acts in a group gig: delete-as-leave with undo toast
    if (isGroupGig && isSupportAct && myParticipant) {
      await leaveGig(enquiry.id, myParticipant.id, user.uid, myDisplayName);
      setToastMsg(`Left ${enquiry.venueName}`);
      setUndoData({ participantId: myParticipant.id, uid: user.uid });
      setToastVisible(true);
      onBack?.();
    } else {
      // If the enquiry is still pending, also update the status so the other party sees it as closed
      const norm = normalizeEnquiryStatus(enquiry.status);
      if (norm === 'enquired' || norm === 'discussing') {
        await updateEnquiryStatus(enquiry.id, isVenue ? 'declined' : 'cancelled');
      }
      await archiveEnquiry(enquiry.id, isVenue ? (venueId ?? user.uid) : user.uid);
      onBack?.();
    }
  }

  async function handleUndoLeave() {
    if (!undoData || !user) return;
    const { participantId, uid } = undoData;
    await Promise.all([
      updateDoc(doc(db, 'inquiries', enquiry.id, 'participants', participantId), {
        state: 'confirmed',
        leftAt: null,
      }),
      updateDoc(doc(db, 'inquiries', enquiry.id), {
        deletedBy: arrayRemove(uid),
      }),
    ]);
    setUndoData(null);
  }

  function handleOpenSubThread(otherUid: string, otherName: string, otherPhoto: string | null) {
    const { day, date, time } = enquiry.requestedSlot;
    const dateStr = date ? fmtSlotDate(date) : (day || '');
    router.push({
      pathname: '/sub-thread',
      params: {
        enquiryId: enquiry.id,
        otherUid,
        otherName,
        venueName:  enquiry.venueName,
        gigDate:    [dateStr, time].filter(Boolean).join(' · '),
      },
    } as any);
  }

  async function handleRemoveParticipant(p: Participant) {
    if (!user) return;
    await removeParticipantFromGig(
      enquiry.id,
      p.id,
      p.userId,
      p.displayName,
      venueDisplayName || enquiry.venueName,
    ).catch(console.error);
  }

  // Bootstrap headliner + venue participant records if they don't exist yet,
  // then open the invite sheet. This allows venues to start a group line-up
  // on any enquiry, including ones created before the multi-party feature.
  async function handleOpenInvite() {
    const now = new Date().toISOString();
    const existingUids = new Set(participants.map(p => p.userId));
    // Ensure headliner exists
    if (!existingUids.has(enquiry.createdBy)) {
      await addDoc(collection(db, 'inquiries', enquiry.id, 'participants'), {
        userId:      enquiry.createdBy,
        role:        'headliner',
        state:       'invited',
        invitedBy:   null,
        displayName: enquiry.bandName,
        photoUrl:    enquiry.photoUrl ?? null,
        joinedAt:    now,
        respondedAt: null,
        leftAt:      null,
      }).catch(() => {});
    }
    // Ensure venue exists — use current user uid when they are the venue
    const venueUid = isVenue ? user?.uid : venueOwnerUid;
    if (venueUid) {
      await ensureVenueParticipant(enquiry.id, venueUid, venueDisplayName || enquiry.venueName, venuePhotoUrl).catch(() => {});
    }
    setInviteOpen(true);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg, overflow: 'hidden' as any }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header: always pinned — name, gig info, deal sheet */}
      <EnquiryHeader
        enquiry={enquiry}
        isVenue={isVenue}
        onBack={onBack}
        onDelete={handleDelete}
        onScrollToProfile={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy } })}
        onScrollToMusic={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy, tab: 'music' } })}
        onScrollToTech={() => router.push({ pathname: '/musician/[id]', params: { id: enquiry.createdBy } })}
        participants={participants}
        currentUserUid={user?.uid}
        onOpenSubThread={handleOpenSubThread}
        onInvite={handleOpenInvite}
        onRemove={handleRemoveParticipant}
      />

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={tp.msgList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {/* Enquiry details always shown as first item */}
        <EnquiryBubble enquiry={enquiry} isVenue={isVenue} profileRef={profileRef} musicRef={musicRef} techRef={techRef} />
        {(() => {
          // Build sender groups for avatar + timestamp logic
          // System messages are rendered separately — not grouped with chat messages
          type MsgGroup = { sender: string; msgs: typeof messages; startMs: number; endMs: number };
          const groups: MsgGroup[] = [];
          for (const m of messages) {
            if (m.type === 'system') {
              // System messages break the group and render inline
              groups.push({ sender: '__system__', msgs: [m], startMs: new Date(m.timestamp).getTime(), endMs: new Date(m.timestamp).getTime() });
              continue;
            }
            const last = groups[groups.length - 1];
            const ms = new Date(m.timestamp).getTime();
            if (last && last.sender === m.sender && last.sender !== '__system__') {
              last.msgs.push(m);
              last.endMs = ms;
            } else {
              groups.push({ sender: m.sender, msgs: [m], startMs: ms, endMs: ms });
            }
          }

          // Resolve sender photo for group gigs
          function senderPhoto(senderUid: string): string | null {
            const p = participants.find(pt => pt.userId === senderUid);
            return p?.photoUrl ?? (senderUid === user?.uid ? null : otherPhotoResolved);
          }
          function senderName(senderUid: string): string {
            const p = participants.find(pt => pt.userId === senderUid);
            return p?.displayName ?? who;
          }

          return groups.map(group => {
            // System message — centered event label
            if (group.sender === '__system__') {
              const m = group.msgs[0];
              return (
                <View key={m.id} style={tp.systemMsgRow}>
                  <Text style={tp.systemMsgText}>{m.text}</Text>
                </View>
              );
            }

            const spansHour = group.endMs - group.startMs > 3600000;
            return group.msgs.map((m, i) => {
              const mine = m.sender === user?.uid;
              const isLast = i === group.msgs.length - 1;
              const showTimestamp = spansHour || isLast;
              const prevM = i > 0 ? group.msgs[i - 1] : null;
              const prevMsgTimestamp = (() => {
                if (prevM) return prevM.timestamp;
                const gIdx = groups.indexOf(group);
                if (gIdx === 0) return null;
                const prevGroup = groups[gIdx - 1];
                return prevGroup.msgs[prevGroup.msgs.length - 1].timestamp;
              })();
              const showSep = prevMsgTimestamp
                ? new Date(m.timestamp).getTime() - new Date(prevMsgTimestamp).getTime() > 60 * 60 * 1000
                : false;
              const photo = mine ? null : (isGroupGig ? senderPhoto(m.sender) : otherPhotoResolved);
              const name  = mine ? '' : (isGroupGig ? senderName(m.sender) : who);
              return (
                <View key={m.id}>
                  {showSep && <DateSep label={getDateLabel(m.timestamp)} />}
                  {/* Sender name in group gigs for non-mine messages */}
                  {!mine && isGroupGig && i === 0 && (
                    <Text style={[tp.senderName, { color: colors.grey }]}>{name}</Text>
                  )}
                  <View style={[tp.msgRow, mine ? tp.rowMine : tp.rowTheirs, i > 0 && { marginTop: 2 }]}>
                    {!mine && (
                      isLast
                        ? <Avatar photoUrl={photo} name={name} size={28} />
                        : <View style={{ width: 28 }} />
                    )}
                    <View style={[tp.msgCol, mine && tp.msgColMine]}>
                      {(m as any).type === 'profileSection' ? (
                        <ProfileSectionBubble message={m} isMine={mine} />
                      ) : (
                        <View style={[tp.bubble, mine ? tp.bubbleMine : tp.bubbleTheirs]}>
                          <Text style={[tp.bubbleText, mine && tp.bubbleTextMine]}>{m.text}</Text>
                        </View>
                      )}
                      {showTimestamp && (
                        <Text style={[tp.msgTime, mine && tp.msgTimeRight]}>{fmtMsgTime(m.timestamp)}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            });
          });
        })()}

        {/* Decline reason */}
        {isClosed && declineReasonSaved ? (
          <View style={tp.reasonBanner}>
            <Text style={tp.reasonLabel}>REASON</Text>
            <Text style={tp.reasonText}>{declineReasonSaved}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Invite sheet */}
      <InviteSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        enquiryId={enquiry.id}
        participants={participants}
        inviterUid={user?.uid ?? ''}
        inviterName={myDisplayName}
        inviterRole={isVenue ? 'venue' : 'headliner'}
        venueId={enquiry.venueId}
        venueName={enquiry.venueName}
        onInvited={() => setInviteOpen(false)}
      />

      {/* Undo toast (leave gig) */}
      <Toast
        visible={toastVisible}
        message={toastMsg}
        onUndo={undoData ? handleUndoLeave : undefined}
        onDismiss={() => { setToastVisible(false); setUndoData(null); }}
      />

      {/* ── Share profile section menu ──────────────────────────────── */}
      <Modal
        visible={shareMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareMenuOpen(false)}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => setShareMenuOpen(false)}
        />
        <View style={sm.sheet} pointerEvents="box-none">
          <View style={sm.menu}>
            <Text style={sm.menuTitle}>SHARE SECTION</Text>
            {SHARE_SECTIONS.map(sec => {
              const hasData = !!artistProfile && !!extractSectionData(artistProfile, sec.key);
              return (
                <TouchableOpacity
                  key={sec.key}
                  style={[sm.item, !hasData && sm.itemDisabled]}
                  onPress={() => hasData ? handleSendSection(sec.key, sec.label) : undefined}
                  activeOpacity={hasData ? 0.65 : 1}
                >
                  <Text style={[sm.itemLabel, !hasData && sm.itemLabelDim]}>{sec.label}</Text>
                  {!hasData && <Text style={sm.itemHint}>Nothing saved yet</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* ── Bottom action area ─────────────────────────────────────── */}
      <View>

      {isClosed ? (
        <View style={[tp.closedBanner, { borderTopColor: colors.border }]}>
          <Text style={tp.closedText}>
            {enquiry.status === 'cancelled' ? 'Enquiry cancelled.' : 'Enquiry declined.'}
          </Text>
        </View>

      ) : isVenue && (enquiry.status === 'pending' || enquiry.status === 'enquired') ? (
        // ── Venue pending: reply + action buttons
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fafafa' }}>
          <View style={[vp.wrap, { borderTopColor: colors.border }]}>

            {/* Decline expanded form */}
            {expandedForm === 'decline' && (
              <View style={vp.form}>
                <Text style={vp.formLabel}>DECLINE — REASON OPTIONAL</Text>
                <TextInput
                  style={vp.formTextarea}
                  placeholder="e.g. Thursdays are rock only — let us know if you have other dates"
                  placeholderTextColor="#aaaaaa"
                  value={declineReason}
                  onChangeText={setDeclineReason}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  autoFocus
                />
                <View style={vp.formRow}>
                  <TouchableOpacity
                    style={vp.cancelBtn}
                    onPress={() => { setExpandedForm(null); setDeclineReason(''); }}
                  >
                    <Text style={vp.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={vp.declineSubmit} onPress={handleDecline} disabled={submitting}>
                    {submitting
                      ? <ActivityIndicator color="#ffffff" size="small" />
                      : <Text style={vp.declineSubmitText}>Send Decline</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Pending action buttons — Decline and Discuss only at this stage */}
            <View style={vp.pendingActionsRow}>
              <TouchableOpacity
                style={[vp.pendingBtn, vp.pendingBtnDecline, expandedForm === 'decline' && vp.pendingBtnDeclineActive]}
                onPress={() => toggleForm('decline')}
              >
                {submitting && expandedForm === 'decline'
                  ? <ActivityIndicator color="#dc2626" size="small" />
                  : <Text style={[vp.pendingBtnText, vp.pendingBtnTextDecline]}>Decline</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[vp.pendingBtn, vp.pendingBtnDiscuss]}
                onPress={async () => {
                  if (!user) return;
                  setSubmitting(true);
                  await updateEnquiryStatus(enquiry.id, 'discussing');
                  await ensureVenueParticipant(enquiry.id, user.uid, venueDisplayName || enquiry.venueName, venuePhotoUrl).catch(() => {});
                  setSubmitting(false);
                }}
                disabled={submitting}
              >
                {submitting && expandedForm === null
                  ? <ActivityIndicator color="#111111" size="small" />
                  : <Text style={[vp.pendingBtnText, vp.pendingBtnTextDiscuss]}>Discuss</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

      ) : !isVenue && (enquiry.status === 'pending' || enquiry.status === 'enquired') ? (
        // ── Artist pending: awaiting response
        <SafeAreaView
          edges={['bottom']}
          style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgFaint }}
        >
          <View style={tp.awaitingRow}>
            <Text style={tp.awaitingText}>Awaiting response from {enquiry.venueName}</Text>
            <TouchableOpacity onPress={async () => { await cancelEnquiry(enquiry.id); onBack?.(); }}>
              <Text style={tp.cancelText}>Cancel enquiry</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : isVenue && (enquiry.status === 'accepted' || enquiry.status === 'confirmed') ? (
        // ── Venue confirmed: action strip above chat input
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[vp.confirmedStrip, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <View style={[tp.timetablePill, enquiry.listAsBooked ? tp.timetablePillBooked : tp.timetablePillPending]}>
              <Text style={[tp.timetablePillText, enquiry.listAsBooked ? { color: '#ffffff' } : { color: '#555555' }]}>
                {enquiry.listAsBooked ? 'Booked' : 'Pending'}
              </Text>
            </View>
            {!enquiry.listAsBooked ? (
              <TouchableOpacity
                style={vp.outlineBtn}
                onPress={() => router.push({ pathname: '/confirm-gig', params: { enquiryId: enquiry.id, mode: 'upgrade' } })}
                disabled={submitting}
              >
                <Text style={[vp.outlineBtnText, { color: '#16a34a' }]}>List as Booked</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={vp.outlineBtn}
                onPress={async () => { setSubmitting(true); await bookSlotOnTimetable(enquiry, false); setSubmitting(false); }}
                disabled={submitting}
              >
                <Text style={[vp.outlineBtnText, { color: '#f5a623' }]}>List as Pending</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={vp.outlineBtn}
              onPress={async () => { setSubmitting(true); await cancelAcceptance(enquiry, user?.uid ?? ''); setSubmitting(false); }}
              disabled={submitting}
            >
              <Text style={vp.outlineBtnText}>Cancel Acceptance</Text>
            </TouchableOpacity>
          </View>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TextInput
              style={[ci.input, { color: colors.black }]}
              placeholder={`Message ${who}…`}
              placeholderTextColor={colors.greyLight}
              value={chatText}
              onChangeText={setChatText}
              multiline
            />
            <TouchableOpacity
              style={[ci.send, (!chatText.trim() || submitting) && ci.sendOff]}
              onPress={handleSendChat}
              disabled={!chatText.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#111111" size="small" />
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : isVenue && enquiry.status === 'discussing' ? (
        // ── Venue discussing: chat input + confirm booking strip
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[vp.confirmStrip, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <Text style={[vp.confirmStripLabel, { color: colors.grey }]}>Ready to lock this in?</Text>
            <TouchableOpacity
              style={vp.confirmStripBtn}
              onPress={() => router.push({ pathname: '/confirm-gig', params: { enquiryId: enquiry.id } })}
            >
              <Text style={vp.confirmStripBtnText}>Confirm booking</Text>
            </TouchableOpacity>
          </View>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TextInput
              style={[ci.input, { color: colors.black }]}
              placeholder={`Message ${who}…`}
              placeholderTextColor={colors.greyLight}
              value={chatText}
              onChangeText={setChatText}
              multiline
            />
            <TouchableOpacity
              style={[ci.send, !chatText.trim() && ci.sendOff]}
              onPress={handleSendChat}
              disabled={!chatText.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#111111" size="small" />
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : !isVenue && (enquiry.status === 'confirmed' || enquiry.status === 'accepted') ? (
        // ── Artist confirmed: booking status pill + add-to-calendar strip
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[vp.confirmedStrip, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <View style={[tp.timetablePill, enquiry.listAsBooked ? tp.timetablePillBooked : tp.timetablePillPending]}>
              <Text style={[tp.timetablePillText, enquiry.listAsBooked ? { color: '#ffffff' } : { color: '#555555' }]}>
                {enquiry.listAsBooked ? 'Booked' : 'Pending'}
              </Text>
            </View>
            <Text style={[vp.confirmStripLabel, { color: colors.grey, flex: 1 }]}>
              {enquiry.listAsBooked
                ? `${enquiry.venueName} has listed this gig as booked`
                : `${enquiry.venueName} has confirmed — awaiting final listing`}
            </Text>
          </View>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <TouchableOpacity style={ci.shareBtn} onPress={() => setShareMenuOpen(v => !v)} activeOpacity={0.7}>
              <Text style={ci.shareBtnText}>+</Text>
            </TouchableOpacity>
            <TextInput
              style={[ci.input, { color: colors.black }]}
              placeholder="Message…"
              placeholderTextColor={colors.greyLight}
              value={chatText}
              onChangeText={setChatText}
              multiline
            />
            <TouchableOpacity
              style={[ci.send, !chatText.trim() && ci.sendOff]}
              onPress={handleSendChat}
              disabled={!chatText.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#111111" size="small" />
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>

      ) : (
        // ── Default: chat input (artist discussing, or non-pending states)
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgFaint }}>
          <View style={[ci.wrap, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
            {!isVenue && (
              <TouchableOpacity style={ci.shareBtn} onPress={() => setShareMenuOpen(v => !v)} activeOpacity={0.7}>
                <Text style={ci.shareBtnText}>+</Text>
              </TouchableOpacity>
            )}
            <TextInput
              style={[ci.input, { color: colors.black }]}
              placeholder="Message…"
              placeholderTextColor={colors.greyLight}
              value={chatText}
              onChangeText={setChatText}
              multiline
            />
            <TouchableOpacity
              style={[ci.send, !chatText.trim() && ci.sendOff]}
              onPress={handleSendChat}
              disabled={!chatText.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#111111" size="small" />
                : <Text style={[ci.sendText, !chatText.trim() && ci.sendTextOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      </View>
    </KeyboardAvoidingView>
  );
}

// Venue pending action bar styles
const vp = StyleSheet.create({
  wrap:               { borderTopWidth: 1, backgroundColor: '#fafafa', paddingVertical: 10, paddingHorizontal: isWeb ? 24 : 16, gap: 8 },
  form:               { backgroundColor: '#f4f4f4', borderRadius: 10, padding: 12, gap: 8 },
  formLabel:          { fontSize: 10, fontWeight: '700', color: '#999999', letterSpacing: 0.6 },
  formTextarea:       { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 10, fontSize: 14, color: '#111111', backgroundColor: '#ffffff', minHeight: 56, textAlignVertical: 'top' as const },
  formRow:            { flexDirection: 'row', gap: 8 },
  cancelBtn:          { paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8 },
  cancelBtnText:      { fontSize: 13, color: '#888888', fontWeight: '600' },
  declineSubmit:      { flex: 1, backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  declineSubmitText:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  confirmSubmit:      { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  confirmSubmitOff:   { backgroundColor: '#e8e8e8' },
  confirmSubmitText:  { fontSize: 13, fontWeight: '700', color: '#111111' },
  radioRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  radioCircle:        { width: 17, height: 17, borderRadius: 9, borderWidth: 2, borderColor: '#cccccc', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  radioCircleActive:  { borderColor: Colors.orange },
  radioDot:           { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.orange },
  radioLabel:         { fontSize: 13, color: '#333333', lineHeight: 18, flex: 1 },
  combinedRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyInput:         { flex: 1, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: '#111111', maxHeight: 80, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, backgroundColor: '#ffffff' },
  sendBtn:            { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:         { backgroundColor: '#e8e8e8' },
  sendBtnText:        { fontSize: 17, fontWeight: '700', color: '#ffffff', lineHeight: 19, marginTop: -1 },
  sendBtnTextOff:     { color: '#bbbbbb' },
  outlineBtn:         { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: '#e0e0e0', alignItems: 'center' },
  outlineBtnActive:   { borderColor: Colors.orange, backgroundColor: Colors.orange + '10' },
  outlineBtnText:     { fontSize: 13, fontWeight: '600', color: '#666666' },
  declineBtnActive:   { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.06)' },
  confirmBtn:         { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, backgroundColor: Colors.orange, alignItems: 'center' },
  confirmBtnText:     { fontSize: 13, fontWeight: '700', color: '#111111' },
  // Confirmed strip (shown when gig is confirmed)
  confirmedStrip:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: isWeb ? 24 : 16, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, backgroundColor: 'rgba(22,163,74,0.05)', flexWrap: 'wrap' as const },
  // Confirm booking strip (shown in discussing state)
  confirmStrip:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: isWeb ? 24 : 16, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, backgroundColor: Colors.orange + '0a' },
  confirmStripLabel:  { fontSize: 13, fontWeight: '500' },
  confirmStripBtn:    { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  confirmStripBtnText:{ fontSize: 13, fontWeight: '700', color: '#111111' },
  // Pending state: two action buttons
  pendingActionsRow:       { flexDirection: 'row', gap: 10 },
  pendingBtn:              { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pendingBtnDecline:       { borderColor: '#e0e0e0', backgroundColor: '#ffffff' },
  pendingBtnDeclineActive: { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.06)' },
  pendingBtnDiscuss:       { borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  pendingBtnConfirm:       { borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  pendingBtnConfirmActive: { borderColor: Colors.orange, backgroundColor: 'rgba(245,166,35,0.08)' },
  pendingBtnText:          { fontSize: 14, fontWeight: '700' },
  pendingBtnTextDecline:   { color: '#dc2626' },
  pendingBtnTextDiscuss:   { color: '#444444' },
  pendingBtnTextConfirm:   { color: '#444444' },
});

// Chat input styles
const ci = StyleSheet.create({
  wrap:         { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 10, borderTopWidth: 1 },
  input:        { flex: 1, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120, backgroundColor: '#ffffff' },
  send:         { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendOff:      { backgroundColor: '#e0e0e0' },
  sendText:     { fontSize: 18, fontWeight: '700', color: '#ffffff', lineHeight: 20, marginTop: -1 },
  sendTextOff:  { color: '#bbbbbb' },
  shareBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: '#f0ede8', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  shareBtnText: { fontSize: 20, fontWeight: '400', color: '#555555', lineHeight: 22, marginTop: -1 },
});

// Share section menu styles
const sm = StyleSheet.create({
  sheet:        { flex: 1, justifyContent: 'flex-end', paddingBottom: 24 },
  menu:         {
    marginHorizontal: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 12,
  },
  menuTitle:    { fontSize: 10, fontWeight: '800', color: '#aaaaaa', letterSpacing: 0.8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  item:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#f2f2f2' },
  itemDisabled: { opacity: 0.45 },
  itemLabel:    { fontSize: 15, fontWeight: '600', color: '#111111' },
  itemLabelDim: { color: '#888888' },
  itemHint:     { fontSize: 11, color: '#aaaaaa' },
});

// Thread panel shared styles
const tp = StyleSheet.create({
  msgList:           { paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 16, gap: 4, flexGrow: 1 },
  enquirySentLabel:  { textAlign: 'center', fontSize: 11, fontWeight: '500', color: '#aaaaaa', letterSpacing: 0.3, marginBottom: 8 },
  noMsgs:       { alignItems: 'center', paddingTop: 12 },
  noMsgsText:   { fontSize: 14, color: '#aaaaaa', textAlign: 'center', lineHeight: 20 },
  msgRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:       { justifyContent: 'flex-end' },
  rowTheirs:     {},
  msgCol:        { maxWidth: '72%' },
  msgColMine:    { alignItems: 'flex-end' },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:    { backgroundColor: '#111111', borderBottomRightRadius: 4 },
  bubbleTheirs:  { backgroundColor: '#f0ede8', borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, color: '#111111', lineHeight: 22 },
  bubbleTextMine:{ color: '#ffffff' },
  msgTime:        { fontSize: 10, color: '#bbbbbb', marginTop: 3, marginLeft: 2 },
  msgTimeRight:   { textAlign: 'right', marginLeft: 0, marginRight: 2 },
  systemMsgRow:   { alignItems: 'center', marginVertical: 10 },
  systemMsgText:  { fontSize: 12, color: '#aaaaaa', fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 16 },
  senderName:     { fontSize: 11, color: '#888888', fontWeight: '600', marginBottom: 2, marginLeft: 36 },
  reasonBanner: { backgroundColor: '#fef3cd', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#fcd34d', marginTop: 8 },
  reasonLabel:  { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.5, marginBottom: 3 },
  reasonText:   { fontSize: 13, color: '#333333' },
  closedBanner: { padding: 16, alignItems: 'center', borderTopWidth: 1, backgroundColor: '#fafafa' },
  closedText:   { fontSize: 14, color: '#aaaaaa', fontStyle: 'italic' },
  awaitingRow:  { padding: 14, paddingHorizontal: isWeb ? 24 : 16, alignItems: 'center', gap: 8 },
  awaitingText: { fontSize: 13, color: '#888888', textAlign: 'center' },
  cancelText:   { fontSize: 13, color: '#ef4444', fontWeight: '600' },
  timetableBar: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, paddingVertical: 10, paddingHorizontal: isWeb ? 24 : 16, borderTopWidth: 1 },
  timetableLabel:  { fontSize: 13, color: '#888888' },
  timetablePill:   { borderRadius: 4, paddingHorizontal: 12, paddingVertical: 4 },
  timetablePillBooked:  { backgroundColor: '#16a34a' },
  timetablePillPending: { backgroundColor: 'rgba(0,0,0,0.07)' },
  timetablePillText:    { fontSize: 12, fontWeight: '700' },
  timetableBtn:    { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 6 },
  timetableBtnText:{ fontSize: 12, fontWeight: '600' },
});

// ── DM tile ────────────────────────────────────────────────────────────────

function DMTile({ conv, myUid, isSelected, onPress, onDelete }: {
  conv: DMConv; myUid: string; isSelected: boolean; onPress: () => void; onDelete?: () => void;
}) {
  const otherUid   = conv.participants.find(p => p !== myUid) ?? '';
  const resolved   = useUserDisplayInfo(otherUid || null);
  const otherName  = resolved.name ?? conv.participantNames[otherUid] ?? 'Unknown';
  const otherPhoto = resolved.photoUrl ?? conv.participantPhotos?.[otherUid] ?? null;
  const isRequest  = conv.initiatedBy !== myUid && !conv.acceptedBy.includes(myUid);
  const swipeRef   = useRef<Swipeable>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  function renderRightActions() {
    if (!onDelete) return null;
    return (
      <TouchableOpacity
        style={tt.swipeDelete}
        onPress={() => { swipeRef.current?.close(); setConfirmDel(true); }}
        activeOpacity={0.85}
      >
        <Text style={tt.swipeDeleteText}>Archive</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false} friction={2}>
        <TouchableOpacity
          style={[dmt.tile, isSelected && dmt.tileActive]}
          onPress={onPress}
          activeOpacity={0.75}
        >
          <Avatar photoUrl={otherPhoto} name={otherName} size={44} />
          <View style={dmt.body}>
            <View style={dmt.topRow}>
              <Text style={[dmt.name, isSelected && { color: Colors.orange }]} numberOfLines={1}>{otherName}</Text>
              <Text style={dmt.time}>{formatTileDate(conv.lastMessageAt)}</Text>
            </View>
            <View style={dmt.previewRow}>
              <Text style={dmt.preview} numberOfLines={1}>{conv.lastMessage || 'No messages yet'}</Text>
              {isRequest && (
                <View style={dm.reqBadge}>
                  <Text style={dm.reqBadgeText}>Request</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>

      <Modal visible={confirmDel} transparent animationType="fade" onRequestClose={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
          <View style={[md.confirm, { backgroundColor: '#ffffff' }]}>
            <Text style={md.confirmTitle}>Archive conversation?</Text>
            <Text style={md.confirmBody}>This removes the conversation from your inbox.</Text>
            <View style={md.confirmBtns}>
              <TouchableOpacity style={[md.confirmBtn, { borderColor: '#e8e8e8' }]} onPress={() => { swipeRef.current?.close(); setConfirmDel(false); }}>
                <Text style={[md.confirmBtnText, { color: '#888888' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmDel(false); onDelete?.(); }}>
                <Text style={md.confirmBtnDangerText}>Archive</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Shared menu / confirm dialog styles ────────────────────────────────────
const md = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:            { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, overflow: 'hidden' },
  sheetItem:        { paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' },
  sheetCancelItem:  { borderTopWidth: 8, borderTopColor: '#f0f0f0' },
  sheetDanger:      { fontSize: 16, fontWeight: '600', color: '#ef4444' },
  sheetText:        { fontSize: 16, fontWeight: '500' },
  confirm:          { marginHorizontal: 32, marginTop: 'auto' as any, marginBottom: 'auto' as any, borderRadius: 16, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  confirmTitle:     { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  confirmBody:      { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  confirmBtns:      { flexDirection: 'row', gap: 10, marginTop: 4 },
  confirmBtn:       { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmBtnText:   { fontSize: 15, fontWeight: '600' },
  confirmBtnDanger: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center' },
  confirmBtnDangerText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
});

const dmt = StyleSheet.create({
  tile:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  tileActive: { backgroundColor: '#fff7ed', borderLeftWidth: 3, borderLeftColor: Colors.orange, paddingLeft: 13 },
  body:       { flex: 1, minWidth: 0, gap: 4 },
  topRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name:       { fontSize: 14, fontWeight: '700', color: '#111111', flex: 1 },
  time:       { fontSize: 11, color: '#bbbbbb', flexShrink: 0 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview:    { fontSize: 13, color: '#888888', flex: 1 },
});

// ── DM thread panel ────────────────────────────────────────────────────────

function DMThreadPanel({ conv, myUid, onBack, colors }: {
  conv: DMConv; myUid: string; onBack?: () => void; colors: any;
}) {
  const messages    = useDMMessages(conv.id);
  const otherUid    = conv.participants.find(p => p !== myUid) ?? '';
  const resolved    = useUserDisplayInfo(otherUid || null);
  const otherName   = resolved.name ?? conv.participantNames[otherUid] ?? 'User';
  const otherPhoto  = resolved.photoUrl ?? conv.participantPhotos?.[otherUid] ?? null;
  const isAccepted  = conv.acceptedBy.includes(myUid);
  const isInitiator = conv.initiatedBy === myUid;
  const otherAccepted = conv.acceptedBy.includes(otherUid);
  const canSend     = isAccepted && (isInitiator ? otherAccepted : true);

  const [text, setText]               = useState('');
  const [sending, setSending]         = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const scrollRef   = useRef<ScrollView>(null);
  const slideAnim   = useRef(new Animated.Value(0)).current;
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  function openDetails() {
    setDetailsOpen(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }
  function closeDetails(onClosed?: () => void) {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start(() => {
      setDetailsOpen(false);
      onClosed?.();
    });
  }

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [messages.length]);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    await sendDMMessage(conv.id, myUid, text.trim());
    setText('');
    setSending(false);
  }

  async function handleDelete() {
    await deleteDMConv(conv.id, myUid);
    onBack?.();
  }

  // Build sender groups for avatar + timestamp logic
  type DMGroup = { senderId: string; msgs: typeof messages; startMs: number; endMs: number };
  const dmGroups: DMGroup[] = [];
  for (const msg of messages) {
    const last = dmGroups[dmGroups.length - 1];
    const ms = new Date(msg.createdAt).getTime();
    if (last && last.senderId === msg.senderId) { last.msgs.push(msg); last.endMs = ms; }
    else dmGroups.push({ senderId: msg.senderId, msgs: [msg], startMs: ms, endMs: ms });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={[dmp.header, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={dmp.back}>←</Text>
          </TouchableOpacity>
        )}
        <Avatar photoUrl={otherPhoto} name={otherName} size={36} />
        <View style={dmp.headerInfo}>
          <Text style={[dmp.name, { color: colors.black }]} numberOfLines={1}>{otherName}</Text>
        </View>
        <TouchableOpacity onPress={openDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={eh.detailsBtn}>
          <View style={eh.detailsBtnInner}>
            <View style={eh.detailsCircle}>
              <Text style={eh.detailsCircleText}>i</Text>
            </View>
            <Text style={eh.detailsLink}>Details</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={dmp.msgList}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={dmp.emptyWrap}>
            <Text style={dmp.emptyText}>Say hello to {otherName} 👋</Text>
          </View>
        )}
        {dmGroups.map((group, gi) => {
          const spansHour = group.endMs - group.startMs > 3600000;
          const prevGroup = dmGroups[gi - 1];
          const showDateSep = !prevGroup || new Date(group.msgs[0].createdAt).toDateString() !== new Date(prevGroup.msgs[0].createdAt).toDateString();
          return [
            showDateSep && (
              <View key={`sep-${gi}`} style={dmp.dateSepRow}>
                <Text style={dmp.dateSepText}>{getDateLabel(group.msgs[0].createdAt)}</Text>
              </View>
            ),
            ...group.msgs.map((msg, i) => {
              const isMine = msg.senderId === myUid;
              const isLast = i === group.msgs.length - 1;
              const showTimestamp = spansHour || isLast;
              return (
                <View
                  key={msg.id}
                  style={[dmp.msgRow, isMine ? dmp.rowMine : dmp.rowTheirs, i > 0 && { marginTop: 2 }]}
                >
                  {!isMine && (
                    isLast
                      ? <Avatar photoUrl={otherPhoto} name={otherName} size={28} />
                      : <View style={{ width: 28 }} />
                  )}
                  <View style={[dmp.msgCol, isMine && dmp.msgColMine]}>
                    <View style={[dmp.bubble, isMine ? dmp.bubbleMine : dmp.bubbleTheirs]}>
                      <Text style={[dmp.bubbleText, isMine && dmp.bubbleTextMine]}>{msg.text}</Text>
                    </View>
                    {showTimestamp && (
                      <Text style={[dmp.time, isMine && dmp.timeRight]}>{fmtMsgTime(msg.createdAt)}</Text>
                    )}
                  </View>
                </View>
              );
            }),
          ];
        })}
      </ScrollView>

      {/* Message request banners */}
      {!isAccepted && !isInitiator && (
        <View style={[dmp.requestBanner, { borderTopColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <Text style={[dmp.requestText, { color: colors.grey }]}>
            <Text style={{ fontWeight: '700', color: colors.black }}>{otherName}</Text> wants to connect with you.
          </Text>
          <View style={dmp.requestBtns}>
            <TouchableOpacity style={dmp.declineBtn} onPress={handleDelete}>
              <Text style={dmp.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dmp.acceptBtn} onPress={() => acceptDMRequest(conv.id, myUid)}>
              <Text style={dmp.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {isInitiator && !otherAccepted && (
        <View style={[dmp.waitingBanner, { borderTopColor: colors.border }]}>
          <Text style={dmp.waitingText}>Waiting for {otherName} to accept</Text>
        </View>
      )}

      {/* Input */}
      {canSend && (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={dmp.inputRow}>
            <TextInput
              style={[dmp.input, { color: colors.black, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
              placeholder={`Message ${otherName}…`}
              placeholderTextColor="#aaaaaa"
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity
              style={[dmp.sendBtn, !text.trim() && dmp.sendBtnOff]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={[dmp.sendIcon, !text.trim() && dmp.sendIconOff]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* Details panel */}
      <Modal visible={detailsOpen} transparent animationType="none" onRequestClose={() => closeDetails()}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <TouchableOpacity style={eh.drawerBackdrop} activeOpacity={1} onPress={() => closeDetails()} />
          <Animated.View style={[
            eh.drawerPanel,
            { width: isWeb ? 340 : windowWidth, backgroundColor: colors.bg, borderLeftColor: colors.border },
            { transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [isWeb ? 340 : windowWidth, 0] }) }] },
          ]}>
            <View style={[eh.drawerHeader, { borderBottomColor: colors.border, paddingTop: (isWeb ? 0 : insets.top) + 16 }]}>
              <TouchableOpacity onPress={() => closeDetails()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 60 }}>
                <Text style={[eh.drawerBack, { color: Colors.orange }]}>← Back</Text>
              </TouchableOpacity>
              <Text style={[eh.drawerTitle, { color: colors.black }]}>Details</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView contentContainerStyle={[eh.drawerContent, { alignItems: 'center', paddingTop: 32 }]} showsVerticalScrollIndicator={false}>

              {/* Profile */}
              <Avatar photoUrl={otherPhoto} name={otherName} size={72} />
              <Text style={[eh.drawerSectionLabel, { textAlign: 'center', marginTop: 16, fontSize: 20, fontWeight: '800' }]}>{otherName}</Text>

              {/* Delete */}
              <TouchableOpacity
                style={{ marginTop: 40, width: '100%', paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', backgroundColor: 'rgba(220,38,38,0.04)' }}
                onPress={() => closeDetails(() => setConfirmOpen(true))}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>Delete this conversation</Text>
              </TouchableOpacity>

            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
          <View style={[md.confirm, { backgroundColor: colors.bg }]}>
            <Text style={[md.confirmTitle, { color: colors.black }]}>Delete conversation?</Text>
            <Text style={[md.confirmBody, { color: colors.grey }]}>
              This will remove the conversation from your inbox. This can't be undone.
            </Text>
            <View style={md.confirmBtns}>
              <TouchableOpacity style={[md.confirmBtn, { borderColor: colors.border }]} onPress={() => setConfirmOpen(false)}>
                <Text style={[md.confirmBtnText, { color: colors.grey }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={md.confirmBtnDanger} onPress={() => { setConfirmOpen(false); handleDelete(); }}>
                <Text style={md.confirmBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const dmp = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: isWeb ? 24 : 16, borderBottomWidth: 1, gap: 10 },
  back:          { fontSize: 20, color: Colors.orange, fontWeight: '400', marginRight: 2 },
  headerInfo:    { flex: 1, minWidth: 0 },
  name:          { fontSize: 15, fontWeight: '700' },
  deleteIcon:    { fontSize: 22, color: '#aaaaaa', letterSpacing: 1 },
  msgList:       { paddingHorizontal: isWeb ? 20 : 14, paddingVertical: 16, gap: 3, flexGrow: 1 },
  emptyWrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  dateSepRow:    { alignItems: 'center', marginVertical: 12 },
  dateSepText:   { fontSize: 11, fontWeight: '600', color: '#aaaaaa', letterSpacing: 0.3 },
  emptyText:     { fontSize: 15, color: '#aaaaaa' },
  msgRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine:       { justifyContent: 'flex-end' },
  rowTheirs:     {},
  msgCol:        { maxWidth: '72%' },
  msgColMine:    { alignItems: 'flex-end' },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:    { backgroundColor: '#111111', borderBottomRightRadius: 4 },
  bubbleTheirs:  { backgroundColor: '#f0ede8', borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 15, color: '#111111', lineHeight: 22 },
  bubbleTextMine:{ color: '#ffffff' },
  time:          { fontSize: 10, color: '#bbbbbb', marginTop: 3, marginLeft: 2 },
  timeRight:     { textAlign: 'right', marginLeft: 0, marginRight: 2 },
  requestBanner: { borderTopWidth: 1, padding: 20, paddingHorizontal: isWeb ? 24 : 16, gap: 14, alignItems: 'center' },
  requestText:   { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  requestBtns:   { flexDirection: 'row', gap: 10 },
  declineBtn:    { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  declineBtnText:{ fontSize: 14, fontWeight: '600', color: '#888888' },
  acceptBtn:     { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.orange, alignItems: 'center' },
  acceptBtnText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  waitingBanner: { borderTopWidth: 1, padding: 12, alignItems: 'center', backgroundColor: '#fafafa' },
  waitingText:   { fontSize: 13, color: '#aaaaaa', fontStyle: 'italic' },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  input:         { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120 },
  sendBtn:       { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.orange, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:    { backgroundColor: '#e0e0e0' },
  sendIcon:      { fontSize: 18, fontWeight: '700', color: '#ffffff', lineHeight: 20, marginTop: -1 },
  sendIconOff:   { color: '#bbbbbb' },
});

const dm = StyleSheet.create({
  reqBadge:     { backgroundColor: Colors.orange + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  reqBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.orange },
});

// ── Filter config ──────────────────────────────────────────────────────────

type FilterKey = 'enquired' | 'discussing' | 'confirmed';

function getFilterConfig(isVenue: boolean) {
  return [
    { key: 'enquired'   as FilterKey, label: isVenue ? 'Awaiting Response' : 'Enquired', statuses: ['enquired', 'pending'] },
    { key: 'discussing' as FilterKey, label: 'Discussing', statuses: ['discussing'] },
    { key: 'confirmed'  as FilterKey, label: 'Confirmed',  statuses: ['confirmed', 'accepted'] },
  ];
}

function matchesFilter(enquiry: Enquiry, filter: FilterKey): boolean {
  const cfg = getFilterConfig(true).find(f => f.key === filter);
  if (!cfg) return true;
  const norm = normalizeEnquiryStatus(enquiry.status);
  return cfg.statuses.includes(enquiry.status) || cfg.statuses.includes(norm);
}

// ── Main inbox screen ──────────────────────────────────────────────────────

export default function InboxScreen() {
  const router = useRouter();
  const { openEnquiryId } = useLocalSearchParams<{ openEnquiryId?: string }>();
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isWideWeb = isWeb && screenWidth >= 768;
  // Explicit pixel height for mobile web thread panel (avoids outer page scroll)
  const mobileWebHeight = isWeb && !isWideWeb
    ? screenHeight - (insets.top + TOP_TAB_H) - (BOTTOM_TAB_H + insets.bottom)
    : undefined;
  const isVenue = profile?.type === 'venue';
  const isAgent = profile?.type === 'agent';
  const venueId = profile?.venueId ?? null;

  const artistData   = useArtistEnquiries(!isVenue && !isAgent ? (user?.uid ?? null) : null);
  const supportData  = useSupportEnquiries(!isVenue && !isAgent ? (user?.uid ?? null) : null);
  const venueData    = useVenueEnquiries(isVenue ? venueId : null);
  const agentData    = useAgentEnquiries(isAgent ? (user?.uid ?? null) : null);

  // Merge artist headliner enquiries + support-act invites (deduplicate by id)
  const mergedEnquiries = isVenue
    ? venueData.enquiries
    : isAgent
      ? agentData.enquiries
      : [...artistData.enquiries, ...supportData.enquiries.filter(s => !artistData.enquiries.find(a => a.id === s.id))];
  const { enquiries, loading } = isVenue
    ? venueData
    : isAgent
      ? agentData
      : { enquiries: mergedEnquiries, loading: artistData.loading && supportData.loading };

  const [selected,  setSelected]  = useState<Enquiry | null>(null);
  const [filter,    setFilter]    = useState<FilterKey>('enquired');
  const [inboxTab,  setInboxTabRaw]  = useState<'enquiries' | 'messages'>(_sessionInboxTab);
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);

  function setInboxTab(tab: 'enquiries' | 'messages') { _sessionInboxTab = tab; setInboxTabRaw(tab); }
  const [dmFilter,  setDmFilter]  = useState<'accepted' | 'requests'>('accepted');
  const [selectedDMId, setSelectedDMId] = useState<string | null>(null);

  const myUid   = user?.uid ?? '';
  const myName  = profile?.displayName || user?.email || '';
  const [myPhoto, setMyPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !profile) return;
    if (profile.type === 'artist') {
      getDoc(doc(db, 'bandProfiles', user.uid)).then(snap => {
        if (snap.exists()) setMyPhoto(snap.data().photoUrl ?? null);
      }).catch(() => {});
    } else if (profile.type === 'venue' && profile.venueId) {
      getDoc(doc(db, 'venues', profile.venueId)).then(snap => {
        if (snap.exists()) setMyPhoto(snap.data().photoUrl ?? null);
      }).catch(() => {});
    }
  }, [user?.uid, profile?.type, profile?.venueId]);

  // Agent roster selection
  const agentRoster = agentData.roster ?? [];
  const selectedRosterEntry = agentRoster.find(r => r.id === selectedRosterId) ?? null;
  const effectiveIsVenue = isAgent
    ? (selectedRosterEntry?.type === 'venue')
    : isVenue;
  const effectiveVenueId = (isAgent && selectedRosterEntry?.type === 'venue')
    ? selectedRosterEntry.id
    : venueId;

  const dmConvs     = useDMConversations(user?.uid ?? null);
  const acceptedDMs = dmConvs.filter(c => c.acceptedBy.includes(myUid));
  const requestDMs  = dmConvs.filter(c => !c.acceptedBy.includes(myUid) && c.initiatedBy !== myUid);
  const filteredDMs = dmFilter === 'accepted' ? acceptedDMs : requestDMs;
  const selectedDM  = dmConvs.find(c => c.id === selectedDMId) ?? null;

  // Filter enquiries by selected roster entry (agent only)
  const rosterFilteredEnquiries = isAgent && selectedRosterId
    ? enquiries.filter(e => selectedRosterEntry?.type === 'venue' ? e.venueId === selectedRosterId : e.createdBy === selectedRosterId)
    : enquiries;

  const FILTERS = getFilterConfig(effectiveIsVenue);
  const sorted   = [...rosterFilteredEnquiries].filter(e => !(effectiveIsVenue && e.status === 'declined')).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const filtered = sorted.filter(e => matchesFilter(e, filter));
  const enquiryNotifCount = !effectiveIsVenue
    ? rosterFilteredEnquiries.filter(e => e.status !== 'declined' && e.status !== 'cancelled').length
    : 0;

  // Auto-open a specific enquiry when navigated here with openEnquiryId
  useEffect(() => {
    if (!openEnquiryId || enquiries.length === 0) return;
    const match = enquiries.find(e => e.id === openEnquiryId);
    if (match) { setSelected(match); setInboxTab('enquiries'); }
  }, [openEnquiryId, enquiries]);

  // Lock browser page scroll on web — inner ScrollViews handle their own scroll
  useEffect(() => {
    if (!isWeb) return;
    (document as any).documentElement.style.overflow = 'hidden';
    (document as any).body.style.overflow = 'hidden';
    return () => {
      (document as any).documentElement.style.overflow = '';
      (document as any).body.style.overflow = '';
    };
  }, []);

  // ── Not signed in ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
        <View style={s.center}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={[s.emptyTitle, { color: colors.black }]}>Sign in to view your inbox</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.push('/login')}>
            <Text style={s.btnText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── WEB: two-column layout (wide screens only) ───────────────────────────
  if (isWideWeb) {
    return (
      <View style={{
        position: 'fixed' as any,
        top: WEB_TAB_H,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        overflow: 'hidden' as any,
        zIndex: 1,
        backgroundColor: colors.bg,
      } as any}>

        {/* Sidebar */}
        <View style={[wb.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
          {/* Agent roster strip */}
          {isAgent && (
            <>
              <AgentRosterStrip
                roster={agentRoster}
                enquiries={enquiries}
                selectedId={selectedRosterId}
                onSelect={setSelectedRosterId}
                onAdd={() => router.push('/profile')}
                colors={colors}
              />
              <AgentViewingBanner
                entry={selectedRosterEntry}
                onSwitch={() => setSelectedRosterId(null)}
                colors={colors}
              />
            </>
          )}

          {/* Header */}
          <View style={[wb.sidebarHead, { borderBottomColor: colors.border }]}>
            <View style={wb.sidebarTitleRow}>
              <View style={wb.segControl}>
                  <TouchableOpacity
                    style={[wb.segBtn, inboxTab === 'enquiries' && wb.segBtnActive]}
                    onPress={() => setInboxTab('enquiries')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[wb.segText, inboxTab === 'enquiries' && wb.segTextActive]}>
                        {effectiveIsVenue ? 'Enquiries' : 'My Enquiries'}
                      </Text>
                      {enquiryNotifCount > 0 && (
                        <View style={[wb.segBadge, inboxTab === 'enquiries' && wb.segBadgeActive]}>
                          <Text style={[wb.segBadgeText, inboxTab === 'enquiries' && wb.segBadgeTextActive]}>{enquiryNotifCount}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[wb.segBtn, inboxTab === 'messages' && wb.segBtnActive]}
                    onPress={() => setInboxTab('messages')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={[wb.segText, inboxTab === 'messages' && wb.segTextActive]}>Messages</Text>
                      {dmConvs.length > 0 && (
                        <View style={[wb.segBadge, inboxTab === 'messages' && wb.segBadgeActive]}>
                          <Text style={[wb.segBadgeText, inboxTab === 'messages' && wb.segBadgeTextActive]}>{dmConvs.length}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                </View>
            </View>

            {/* Enquiry filter pills */}
            {inboxTab === 'enquiries' && (
              <View style={wb.filterRow}>
                {FILTERS.map(f => {
                  const count  = sorted.filter(e => matchesFilter(e, f.key)).length;
                  const active = filter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[wb.filterBtn, active && wb.filterBtnActive]}
                      onPress={() => setFilter(f.key)}
                    >
                      <Text style={[wb.filterText, active && wb.filterTextActive]}>{f.label}</Text>
                      {count > 0 && (
                        <View style={[wb.filterCount, active && wb.filterCountActive]}>
                          <Text style={[wb.filterCountText, active && wb.filterCountTextActive]}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* DM sub-filter */}
            {inboxTab === 'messages' && (
              <View style={wb.filterRow}>
                {(['accepted', 'requests'] as const).map(f => {
                  const count  = f === 'accepted' ? acceptedDMs.length : requestDMs.length;
                  const active = dmFilter === f;
                  return (
                    <TouchableOpacity
                      key={f}
                      style={[wb.filterBtn, active && wb.filterBtnActive]}
                      onPress={() => setDmFilter(f)}
                    >
                      <Text style={[wb.filterText, active && wb.filterTextActive]}>
                        {f === 'accepted' ? 'Accepted' : 'Requests'}
                      </Text>
                      {count > 0 && (
                        <View style={[wb.filterCount, active && wb.filterCountActive]}>
                          <Text style={[wb.filterCountText, active && wb.filterCountTextActive]}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Tile list */}
          {inboxTab === 'enquiries' ? (
            loading ? (
              <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
            ) : filtered.length === 0 ? (
              <Text style={wb.emptyText}>
                {enquiries.length === 0 ? 'No enquiries yet' : 'None in this filter'}
              </Text>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                {filtered.map(item => {
                  const rosterLabel = (isAgent && !selectedRosterId)
                    ? (agentRoster.find(r => r.type === 'venue' ? r.id === item.venueId : r.id === item.createdBy)?.name ?? null)
                    : null;
                  return (
                    <ThreadTile
                      key={item.id}
                      item={item}
                      isVenue={effectiveIsVenue}
                      myUid={myUid}
                      isSelected={selected?.id === item.id}
                      onPress={() => setSelected(item)}
                      onDelete={() => archiveEnquiry(item.id, effectiveIsVenue ? (effectiveVenueId ?? myUid) : myUid)}
                      rosterLabel={rosterLabel}
                    />
                  );
                })}
              </ScrollView>
            )
          ) : (
            filteredDMs.length === 0 ? (
              <Text style={wb.emptyText}>
                {dmFilter === 'requests' ? 'No message requests' : 'No accepted messages yet'}
              </Text>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                {filteredDMs.map(c => (
                  <DMTile
                    key={c.id}
                    conv={c}
                    myUid={myUid}
                    isSelected={selectedDMId === c.id}
                    onPress={() => setSelectedDMId(c.id)}
                    onDelete={() => deleteDMConv(c.id, myUid)}
                  />
                ))}
              </ScrollView>
            )
          )}
        </View>

        {/* Right panel */}
        <View style={[wb.panel, { backgroundColor: colors.bg }]}>
          {inboxTab === 'enquiries' ? (
            !selected ? (
              <View style={wb.panelEmpty}>
                <Text style={wb.panelEmptyText}>Select a conversation</Text>
              </View>
            ) : (
              <ThreadPanel
                enquiry={selected}
                isVenue={effectiveIsVenue}
                venueId={effectiveVenueId}
                onBack={undefined}
              />
            )
          ) : (
            !selectedDM ? (
              <View style={wb.panelEmpty}>
                <Text style={wb.panelEmptyText}>Select a conversation</Text>
              </View>
            ) : (
              <DMThreadPanel
                conv={selectedDM}
                myUid={myUid}
                colors={colors}
                onBack={undefined}
              />
            )
          )}
        </View>
      </View>
    );
  }

  // ── NATIVE/MOBILE: thread open — full screen ──────────────────────────────
  if (selected) {
    const topOffset    = insets.top + TOP_TAB_H;
    const bottomOffset = BOTTOM_TAB_H + insets.bottom;
    return (
      <View style={isWeb ? {
        position: 'fixed' as any,
        top: topOffset,
        left: 0,
        right: 0,
        bottom: bottomOffset,
        backgroundColor: colors.bg,
        overflow: 'hidden' as any,
        zIndex: 500,
      } : {
        flex: 1,
        backgroundColor: colors.bg,
      }}>
        <ThreadPanel enquiry={selected} isVenue={effectiveIsVenue} venueId={effectiveVenueId} onBack={() => setSelected(null)} />
      </View>
    );
  }

  // ── NATIVE: list ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Agent roster strip */}
      {isAgent && (
        <>
          <AgentRosterStrip
            roster={agentRoster}
            enquiries={enquiries}
            selectedId={selectedRosterId}
            onSelect={setSelectedRosterId}
            onAdd={() => router.push('/profile')}
            colors={colors}
          />
          <AgentViewingBanner
            entry={selectedRosterEntry}
            onSwitch={() => setSelectedRosterId(null)}
            colors={colors}
          />
        </>
      )}

      {/* Page header */}
      <View style={[s.listHeader, { borderBottomColor: colors.border }, (isWeb && !isWideWeb) && { paddingTop: TOP_TAB_H + 20 }]}>
        <View style={s.listHeaderTop}>
          <View style={s.segControl}>
            <TouchableOpacity
              style={[s.segBtn, inboxTab === 'enquiries' && s.segBtnActive]}
              onPress={() => setInboxTab('enquiries')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[s.segText, inboxTab === 'enquiries' && s.segTextActive]}>
                  {effectiveIsVenue ? 'Enquiries' : 'My Enquiries'}
                </Text>
                {enquiryNotifCount > 0 && (
                  <View style={[s.segBadge, inboxTab === 'enquiries' && s.segBadgeActive]}>
                    <Text style={[s.segBadgeText, inboxTab === 'enquiries' && s.segBadgeTextActive]}>{enquiryNotifCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.segBtn, inboxTab === 'messages' && s.segBtnActive]}
              onPress={() => setInboxTab('messages')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[s.segText, inboxTab === 'messages' && s.segTextActive]}>Messages</Text>
                {dmConvs.length > 0 && (
                  <View style={[s.segBadge, inboxTab === 'messages' && s.segBadgeActive]}>
                    <Text style={[s.segBadgeText, inboxTab === 'messages' && s.segBadgeTextActive]}>{dmConvs.length}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Filter pills — horizontal scroll */}
        {inboxTab === 'enquiries' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {FILTERS.map(f => {
              const count  = sorted.filter(e => matchesFilter(e, f.key)).length;
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.filterPill, active && s.filterPillActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
                  {count > 0 && (
                    <View style={[s.filterBadge, active && s.filterBadgeActive]}>
                      <Text style={[s.filterBadgeText, active && s.filterBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {inboxTab === 'messages' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {(['accepted', 'requests'] as const).map(f => {
              const count  = f === 'accepted' ? acceptedDMs.length : requestDMs.length;
              const active = dmFilter === f;
              return (
                <TouchableOpacity key={f} style={[s.filterPill, active && s.filterPillActive]} onPress={() => setDmFilter(f)}>
                  <Text style={[s.filterText, active && s.filterTextActive]}>
                    {f === 'accepted' ? 'Accepted' : 'Requests'}
                  </Text>
                  {count > 0 && (
                    <View style={[s.filterBadge, active && s.filterBadgeActive]}>
                      <Text style={[s.filterBadgeText, active && s.filterBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Content */}
      {inboxTab === 'enquiries' ? (
        loading ? (
          <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
        ) : filtered.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>📭</Text>
            <Text style={[s.emptyTitle, { color: colors.black }]}>
              {enquiries.length === 0 ? 'No enquiries yet' : 'None in this filter'}
            </Text>
            <Text style={s.emptySub}>
              {enquiries.length === 0
                ? (effectiveIsVenue
                    ? 'Enquiries from musicians will appear here'
                    : 'Your enquiries to venues will appear here')
                : 'Try a different filter'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const rosterLabel = (isAgent && !selectedRosterId)
                ? (agentRoster.find(r => r.type === 'venue' ? r.id === item.venueId : r.id === item.createdBy)?.name ?? null)
                : null;
              return (
                <ThreadTile
                  item={item}
                  isVenue={effectiveIsVenue}
                  myUid={myUid}
                  isSelected={false}
                  onPress={() => setSelected(item)}
                  onDelete={() => archiveEnquiry(item.id, effectiveIsVenue ? (effectiveVenueId ?? myUid) : myUid)}
                  rosterLabel={rosterLabel}
                />
              );
            }}
          />
        )
      ) : (
        filteredDMs.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>💬</Text>
            <Text style={[s.emptyTitle, { color: colors.black }]}>
              {dmFilter === 'requests' ? 'No message requests' : 'No messages yet'}
            </Text>
            <Text style={s.emptySub}>
              {dmFilter === 'accepted'
                ? 'Accepted conversations will appear here'
                : 'Message requests from others will appear here'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredDMs}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <DMTile
                conv={item}
                myUid={myUid}
                isSelected={false}
                onPress={() => {
                  const otherUid  = item.participants.find(p => p !== myUid) ?? '';
                  const otherName = item.participantNames[otherUid] ?? 'User';
                  router.push({ pathname: '/messages/[id]', params: { id: otherUid, name: otherName } });
                }}
                onDelete={() => deleteDMConv(item.id, myUid)}
              />
            )}
          />
        )
      )}
    </SafeAreaView>
  );
}

// ── Web sidebar styles ─────────────────────────────────────────────────────

const wb = StyleSheet.create({
  sidebar:          { width: 340, borderRightWidth: 1, flexDirection: 'column' },
  sidebarHead:      { padding: 20, paddingBottom: 14, borderBottomWidth: 1 },
  sidebarTitleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sidebarTitle:     { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  segControl:   { flexDirection: 'row', backgroundColor: '#f0ede8', borderRadius: 10, padding: 4, gap: 2 },
  segBtn:       { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  segBtnActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText:      { fontSize: 13, fontWeight: '600', color: '#888888' },
  segTextActive:{ color: '#111111', fontWeight: '700' },
  segBadge:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segBadgeActive:    { backgroundColor: '#b0aca7' },
  segBadgeText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  segBadgeTextActive:{ color: '#111111' },
  filterRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  filterBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#d0ccc7', backgroundColor: '#ffffff' },
  filterBtnActive:  { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 12, fontWeight: '600', color: '#777777' },
  filterTextActive: { color: '#111111' },
  filterCount:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterCountActive:    { backgroundColor: 'rgba(0,0,0,0.15)' },
  filterCountText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  filterCountTextActive:{ color: '#111111' },
  emptyText:        { textAlign: 'center', color: '#999999', fontSize: 14, padding: 40 },
  panel:            { flex: 1, flexDirection: 'column', overflow: 'hidden' as any },
  panelEmpty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panelEmptyText:   { fontSize: 15, color: '#bbbbbb' },
});

// ── Native styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1 },
  listHeader:    { padding: 20, paddingBottom: 14, borderBottomWidth: 1 },
  listHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:         { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  segControl:    { flexDirection: 'row', backgroundColor: '#f0ede8', borderRadius: 10, padding: 4, gap: 2 },
  segBtn:        { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  segBtnActive:  { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText:       { fontSize: 13, fontWeight: '600', color: '#888888' },
  segTextActive: { color: '#111111', fontWeight: '700' },
  segBadge:          { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  segBadgeActive:    { backgroundColor: '#b0aca7' },
  segBadgeText:      { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  segBadgeTextActive:{ color: '#111111' },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySub:      { fontSize: 14, color: '#999999', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn:           { backgroundColor: Colors.orange, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText:       { fontSize: 15, fontWeight: '700', color: '#111111' },
  filterPill:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, borderColor: '#d0ccc7', paddingHorizontal: 12, paddingVertical: 7, minHeight: 34, backgroundColor: '#ffffff' },
  filterPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterText:       { fontSize: 13, color: '#777777', fontWeight: '600' },
  filterTextActive: { color: '#111111' },
  filterBadge:       { backgroundColor: '#c8c4be', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterBadgeActive: { backgroundColor: 'rgba(0,0,0,0.15)' },
  filterBadgeText:   { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  filterBadgeTextActive: { color: '#111111' },
});
