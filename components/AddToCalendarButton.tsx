/**
 * AddToCalendarButton — per-gig "add to calendar" UI.
 *
 * Web:    Google Calendar deep link  +  client-side .ics download
 * Native: expo-calendar (event written directly to the device calendar)
 *
 * No fee data is included in events per product requirement.
 */
import { useState } from 'react';
import {
  Platform, TouchableOpacity, View, StyleSheet, Linking, ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/Text';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import { fromZonedTime } from 'date-fns-tz';
import { type Enquiry } from '@/lib/useEnquiries';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Date to ICS/Google Calendar UTC string: YYYYMMDDTHHMMSSz */
function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

/** Escape ICS text values per RFC 5545. */
function escIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Build a minimal valid ICS string for a single event. */
function buildICS(
  gigId: string | undefined,
  start: Date,
  end: Date,
  summary: string,
  location: string,
  description: string,
): string {
  const uid = gigId ? `${gigId}@twaylo.com.au` : `${Date.now()}@twaylo.com.au`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Twaylo//Twaylo Gigs//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmtUtc(start)}`,
    `DTEND:${fmtUtc(end)}`,
    `SUMMARY:${escIcs(summary)}`,
    location   ? `LOCATION:${escIcs(location)}`    : '',
    description ? `DESCRIPTION:${escIcs(description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/** Open Google Calendar "quick add" template in a new tab. */
function openGoogleCalendar(start: Date, end: Date, summary: string, location: string, description: string) {
  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     summary,
    dates:    `${fmtUtc(start)}/${fmtUtc(end)}`,
    location,
    details:  description,
  });
  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
  } else {
    Linking.openURL(url);
  }
}

/** Trigger a .ics file download in the browser. */
function downloadICS(icsContent: string, filename: string) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Add event to native device calendar using expo-calendar. */
async function addToNativeCalendar(
  start: Date,
  end: Date,
  summary: string,
  location: string,
  description: string,
  timezone: string,
): Promise<'success' | 'denied' | 'no_calendar' | 'error'> {
  try {
    // Dynamic import keeps expo-calendar out of the web bundle.
    const Calendar = await import('expo-calendar');
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') return 'denied';

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable  =
      calendars.find(c => c.allowsModifications && c.isPrimary) ??
      calendars.find(c => c.allowsModifications) ??
      null;

    if (!writable) return 'no_calendar';

    await Calendar.createEventAsync(writable.id, {
      title:    summary,
      startDate: start,
      endDate:   end,
      location:  location || undefined,
      notes:     description || undefined,
      timeZone:  timezone,
    });

    return 'success';
  } catch {
    return 'error';
  }
}

// ── Base component ────────────────────────────────────────────────────────────

export type AddToCalendarButtonProps = {
  startDate:    Date;
  endDate:      Date;
  summary:      string;
  location?:    string;
  description?: string;
  gigId?:       string;
  timezone?:    string;
};

export function AddToCalendarButton({
  startDate,
  endDate,
  summary,
  location    = '',
  description = '',
  gigId,
  timezone    = 'Australia/Sydney',
}: AddToCalendarButtonProps) {
  const { colors } = useTheme();
  const [busy,     setBusy]    = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function clearFeedback() { setTimeout(() => setFeedback(null), 3000); }

  async function handleNative() {
    setBusy(true);
    const result = await addToNativeCalendar(startDate, endDate, summary, location, description, timezone);
    setBusy(false);
    if (result === 'success') {
      setFeedback('Added to your calendar.');
    } else if (result === 'denied') {
      setFeedback('Calendar access was denied. Allow it in Settings and try again.');
    } else {
      setFeedback('Could not add to calendar. Try the Google Calendar option instead.');
    }
    clearFeedback();
  }

  if (Platform.OS !== 'web') {
    // ── Native ──
    return (
      <View style={s.wrap}>
        <TouchableOpacity
          style={[s.btn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
          onPress={handleNative}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator size="small" color={Colors.orange} />
            : <Text style={[s.btnText, { color: colors.black }]}>+ Add to Calendar</Text>
          }
        </TouchableOpacity>
        {feedback ? <Text style={[s.feedback, { color: colors.grey }]}>{feedback}</Text> : null}
      </View>
    );
  }

  // ── Web ──
  const icsContent = buildICS(gigId, startDate, endDate, summary, location, description);

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TouchableOpacity
          style={[s.btn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
          onPress={() => openGoogleCalendar(startDate, endDate, summary, location, description)}
        >
          <Text style={[s.btnText, { color: colors.black }]}>Add to Google Calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
          onPress={() => downloadICS(icsContent, 'twaylo-gig.ics')}
        >
          <Text style={[s.btnText, { color: colors.black }]}>Download .ics</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Convenience wrapper for enquiry data ──────────────────────────────────────

/** Parse "HH:MM" or "H:MM AM/PM" into [hour, minute]. */
function parseEnquiryTime(t: string): [number, number] {
  const ampm = /(\d+):(\d+)\s*(AM|PM)/i.exec(t);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    if (/PM/i.test(ampm[3]) && h !== 12) h += 12;
    if (/AM/i.test(ampm[3]) && h === 12) h = 0;
    return [h, m];
  }
  const parts = t.split(':').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

/**
 * Builds calendar dates from enquiry slot data.
 * Returns null if the enquiry doesn't have a confirmed specific date.
 */
export function calendarDatesFromEnquiry(
  enquiry: Enquiry,
): { start: Date; end: Date; timezone: string } | null {
  const { date, time, setLength } = enquiry.requestedSlot;
  if (!date || !time) return null;

  const timezone = (enquiry as any).timezone ?? 'Australia/Sydney';
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute]     = parseEnquiryTime(time);

  const start = fromZonedTime(new Date(year, month - 1, day, hour, minute, 0, 0), timezone);

  const mins = setLength ? (parseInt(setLength.match(/(\d+)/)?.[1] ?? '60', 10) || 60) : 60;
  const end  = new Date(start.getTime() + mins * 60_000);

  return { start, end, timezone };
}

/**
 * Drop-in button for a confirmed enquiry thread.
 * Computes start/end from enquiry.requestedSlot — only renders if a specific
 * date is confirmed.
 */
export function AddToCalendarFromEnquiry({ enquiry }: { enquiry: Enquiry }) {
  const dates = calendarDatesFromEnquiry(enquiry);
  if (!dates) return null;

  return (
    <AddToCalendarButton
      startDate={dates.start}
      endDate={dates.end}
      summary={`${enquiry.bandName} @ ${enquiry.venueName}`}
      location={enquiry.venueName}
      description={[
        enquiry.requestedSlot.setLength ? `Set length: ${enquiry.requestedSlot.setLength}` : '',
        (enquiry as any).loadInTime ? `Load-in: ${(enquiry as any).loadInTime}` : '',
        (enquiry as any).soundCheckTime ? `Soundcheck: ${(enquiry as any).soundCheckTime}` : '',
        'For more information check twaylo.com.au',
      ].filter(Boolean).join('\n')}
      gigId={(enquiry as any).gigId}
      timezone={dates.timezone}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrap:     { gap: 4 },
  row:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 34,
  },
  btnText:  { fontSize: 13, fontWeight: '600' },
  feedback: { fontSize: 12, marginTop: 2 },
});
