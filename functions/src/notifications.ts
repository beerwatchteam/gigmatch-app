import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';

const resendApiKey = defineSecret('RESEND_API_KEY');

// ── Expo push helper ──────────────────────────────────────────────────────────

async function sendPush(token: string, title: string, body: string): Promise<void> {
  if (!token.startsWith('ExponentPushToken[')) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default', priority: 'high' }),
  });
}

const FROM_ADDRESS = 'Twaylo <notifications@twaylo.com.au>';
const APP_URL      = 'https://twaylo.com.au';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSlot(slot: { day?: string; date?: string; time?: string; room?: string }): string {
  const parts: string[] = [];
  if (slot.day)  parts.push(slot.day);
  if (slot.date) parts.push(slot.date);
  if (slot.time) parts.push(slot.time);
  if (slot.room) parts.push(`(${slot.room})`);
  return parts.join(' · ') || 'TBC';
}

function emailWrapper(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;">
        <tr><td style="padding-bottom:28px;">
          <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">GigMatch</span>
        </td></tr>
        <tr><td style="background:#1a1a1a;border-radius:12px;padding:32px;border:1px solid #2a2a2a;">
          ${body}
        </td></tr>
        <tr><td style="padding-top:24px;font-size:12px;color:#555;text-align:center;">
          You're receiving this because you have email notifications enabled.<br>
          <a href="${APP_URL}/edit-profile" style="color:#555;">Manage notification settings</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const BUTTON = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`;

const META_ROW = (label: string, value: string) =>
  `<tr>
    <td style="padding:8px 0;font-size:13px;color:#888;width:100px;">${label}</td>
    <td style="padding:8px 0;font-size:13px;color:#ccc;">${value}</td>
  </tr>`;

// ── onEnquiryCreated — notify venue ──────────────────────────────────────────

export const onEnquiryCreated = onDocumentCreated(
  { document: 'inquiries/{enquiryId}', secrets: [resendApiKey], region: 'australia-southeast1' },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { venueId, bandName, venueName, requestedSlot } = data as {
      venueId: string;
      bandName: string;
      venueName: string;
      requestedSlot: { day?: string; date?: string; time?: string; room?: string };
    };

    if (!venueId) return;

    const db = getFirestore();
    const [venueSnap, venuePrivateSnap] = await Promise.all([
      db.doc(`venues/${venueId}`).get(),
      db.doc(`venues/${venueId}/private/details`).get(),
    ]);
    const venue        = venueSnap.data();
    const venuePrivate = venuePrivateSnap.data();

    const venueEmail = venuePrivate?.email as string | undefined;
    if (!venueEmail || venue?.settings?.emailOnNewEnquiry !== true) return;

    const slotLabel    = formatSlot(requestedSlot ?? {});
    const enquiryId    = event.params.enquiryId;
    const inboxUrl     = `${APP_URL}/inbox`;

    const html = emailWrapper(`
      <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#fff;">New enquiry</p>
      <p style="margin:0 0 24px;font-size:15px;color:#888;">${venueName}</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${META_ROW('Artist', bandName)}
        ${META_ROW('Slot', slotLabel)}
        ${META_ROW('Enquiry', `#${enquiryId.slice(0, 8)}`)}
      </table>
      ${BUTTON(inboxUrl, 'View in inbox')}
    `);

    const pushToken = venue?.expoPushToken as string | undefined;

    await Promise.all([
      new Resend(resendApiKey.value()).emails.send({
        from:    FROM_ADDRESS,
        to:      venueEmail,
        subject: `New enquiry from ${bandName}`,
        html,
      }),
      pushToken ? sendPush(pushToken, `New enquiry from ${bandName}`, `${slotLabel} — tap to review in your inbox`) : Promise.resolve(),
    ]);
  },
);

// ── onEnquiryUpdated — notify artist on status change ────────────────────────

const NOTIFIABLE_STATUSES = new Set(['confirmed', 'accepted', 'declined', 'cancelled']);

const STATUS_LABELS: Record<string, { heading: string; line: string }> = {
  confirmed: { heading: 'Enquiry confirmed',  line: 'Your enquiry has been confirmed. Get in touch to sort out the details.' },
  accepted:  { heading: 'Enquiry confirmed',  line: 'Your enquiry has been confirmed. Get in touch to sort out the details.' },
  declined:  { heading: 'Enquiry declined',   line: "Unfortunately this one didn't go ahead. Keep looking for the right slot." },
  cancelled: { heading: 'Booking cancelled',  line: 'The venue has cancelled this booking. Check your inbox for any messages.' },
};

export const onEnquiryUpdated = onDocumentUpdated(
  { document: 'inquiries/{enquiryId}', secrets: [resendApiKey], region: 'australia-southeast1' },
  async (event) => {
    const before = event.data?.before.data();
    const after  = event.data?.after.data();
    if (!before || !after) return;

    const prevStatus = before.status as string;
    const newStatus  = after.status  as string;

    // Only fire when status actually changed to a notifiable value
    if (prevStatus === newStatus || !NOTIFIABLE_STATUSES.has(newStatus)) return;

    const { createdBy, venueName, requestedSlot } = after as {
      createdBy:    string;
      venueName:    string;
      requestedSlot: { day?: string; date?: string; time?: string; room?: string };
    };

    if (!createdBy) return;

    const db = getFirestore();
    const [profileSnap, profilePrivateSnap] = await Promise.all([
      db.doc(`bandProfiles/${createdBy}`).get(),
      db.doc(`bandProfiles/${createdBy}/private/details`).get(),
    ]);
    const profile        = profileSnap.data();
    const profilePrivate = profilePrivateSnap.data();

    const artistEmail = profilePrivate?.email as string | undefined;
    if (!artistEmail || profile?.settings?.emailOnEnquiryResponse !== true) return;

    const slotLabel = formatSlot(requestedSlot ?? {});
    const inboxUrl  = `${APP_URL}/inbox`;
    const labels    = STATUS_LABELS[newStatus] ?? STATUS_LABELS['confirmed'];

    const html = emailWrapper(`
      <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#fff;">${labels.heading}</p>
      <p style="margin:0 0 24px;font-size:15px;color:#888;">${venueName}</p>
      <p style="margin:0 0 24px;font-size:14px;color:#aaa;line-height:1.6;">${labels.line}</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${META_ROW('Venue', venueName)}
        ${META_ROW('Slot', slotLabel)}
      </table>
      ${BUTTON(inboxUrl, 'Open inbox')}
    `);

    const pushToken = profile?.expoPushToken as string | undefined;

    await Promise.all([
      new Resend(resendApiKey.value()).emails.send({
        from:    FROM_ADDRESS,
        to:      artistEmail,
        subject: `${labels.heading}: ${venueName}`,
        html,
      }),
      pushToken ? sendPush(pushToken, labels.heading, `${venueName} · ${slotLabel}`) : Promise.resolve(),
    ]);
  },
);
