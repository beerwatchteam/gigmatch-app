/**
 * VenueGigForm
 * Creates or edits a venue-created gig.
 *
 * Section 1: Gig details (title, date/time, room, act name, tickets, listing)
 * Section 2: Read-only public preview (visibility driven by listAsBooked)
 * Section 3: Private (fee, load-in, soundcheck, production docs, staff notes) — collapsible
 */
import { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Switch, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import * as DocumentPicker from 'expo-document-picker';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  createVenueGig, updateVenueGig, savePrivateGigData,
  uploadGigDoc, type VenueGigInput, type UploadProgress,
} from '@/lib/useGigs';
import {
  STATE_TZ, dollarsToCents, type Gig, type GigPrivateDoc,
  type FeeType, type GigDocKind,
} from '@/lib/gig-types';

// ── Helpers shared from ArtistGigForm ─────────────────────────────────────────

function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (Platform.OS === 'web') {
    return (
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: 15, padding: 10, borderRadius: 10, border: '1px solid #e0e0e0', background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' } as any}
      />
    );
  }
  return (
    <TextInput
      style={fi.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? 'YYYY-MM-DD'}
      placeholderTextColor={Colors.greyLight}
      keyboardType="numbers-and-punctuation"
    />
  );
}

function TimeInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (Platform.OS === 'web') {
    return (
      <input
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: 15, padding: 10, borderRadius: 10, border: '1px solid #e0e0e0', background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' } as any}
      />
    );
  }
  return (
    <TextInput
      style={fi.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? 'HH:MM'}
      placeholderTextColor={Colors.greyLight}
      keyboardType="numbers-and-punctuation"
    />
  );
}

function Field({ label, hint, children, error }: { label: string; hint?: string; children: React.ReactNode; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={fi.field}>
      {label ? <Text style={[fi.label, { color: colors.black }]}>{label}</Text> : null}
      {hint ? <Text style={fi.hint}>{hint}</Text> : null}
      <View style={error ? fi.errorWrap : undefined}>{children}</View>
    </View>
  );
}

const fi = StyleSheet.create({
  field:    { marginBottom: 14 },
  label:    { fontSize: 13, fontWeight: '700', marginBottom: 5 },
  hint:     { fontSize: 12, color: Colors.grey, marginBottom: 5 },
  input:    { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 10, fontSize: 15, color: Colors.black },
  errorWrap:{ borderWidth: 1, borderColor: Colors.danger, borderRadius: 10 },
  row:      { flexDirection: 'row', gap: 10 },
  half:     { flex: 1 },
});

// ── Chip picker ───────────────────────────────────────────────────────────────

function ChipPicker<T extends string>({
  options, value, onChange, colors,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  colors: any;
}) {
  return (
    <View style={cp.row}>
      {options.map(o => (
        <TouchableOpacity
          key={o.value}
          style={[cp.chip, { borderColor: colors.border, backgroundColor: value === o.value ? Colors.orange : colors.bg }]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[cp.text, { color: value === o.value ? '#111' : colors.grey }]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const cp = StyleSheet.create({
  row:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '600' },
});

const DOC_KINDS: { value: GigDocKind; label: string }[] = [
  { value: 'contract',   label: 'Contract'     },
  { value: 'run_sheet',  label: 'Run sheet'    },
  { value: 'stage_plot', label: 'Stage plot'   },
  { value: 'tech_spec',  label: 'Tech spec'    },
  { value: 'invoice',    label: 'Invoice'      },
  { value: 'other',      label: 'Other'        },
];

const FEE_TYPE_OPTIONS: { value: FeeType; label: string }[] = [
  { value: 'flat',              label: 'Flat fee'         },
  { value: 'door_split',        label: 'Door split'       },
  { value: 'guarantee_vs_door', label: 'Guarantee + door' },
  { value: 'ticket_split',      label: 'Ticket split'     },
  { value: 'unpaid',            label: 'Unpaid'           },
  { value: 'other',             label: 'Other'            },
];

// ── Doc row ───────────────────────────────────────────────────────────────────

function DocRow({ d, onRemove, colors }: { d: GigPrivateDoc['docs'][0]; onRemove: () => void; colors: any }) {
  return (
    <View style={[dr.row, { borderColor: colors.border }]}>
      <View style={dr.info}>
        <Text style={[dr.name, { color: colors.black }]} numberOfLines={1}>{d.name}</Text>
        <Text style={[dr.kind, { color: colors.grey }]}>{d.kind}</Text>
      </View>
      <TouchableOpacity onPress={onRemove} style={dr.remove}>
        <Text style={dr.removeText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

const dr = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  info:   { flex: 1, gap: 2 },
  name:   { fontSize: 14, fontWeight: '600' },
  kind:   { fontSize: 12 },
  remove: { paddingLeft: 10 },
  removeText: { fontSize: 13, color: Colors.danger, fontWeight: '600' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function localDateFromGig(gig: Gig & { id: string }): string {
  try {
    const tz   = gig.timezone ?? 'Australia/Melbourne';
    const date = gig.startAt.toDate();
    const fmt  = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value  ?? '';
    const m = parts.find(p => p.type === 'month')?.value ?? '';
    const d = parts.find(p => p.type === 'day')?.value   ?? '';
    return `${y}-${m}-${d}`;
  } catch { return ''; }
}

function localTimeFromGig(gig: Gig & { id: string }, useEnd: boolean): string {
  try {
    const tz   = gig.timezone ?? 'Australia/Melbourne';
    const ts   = useEnd ? gig.endAt : gig.startAt;
    if (!ts) return '';
    const fmt  = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(ts.toDate());
  } catch { return ''; }
}

// ── Main form ─────────────────────────────────────────────────────────────────

type VenueDoc = {
  id:     string;
  name:   string;
  state?: string;
  rooms?: { name?: string }[];
  [key: string]: any;
};

type Props = {
  gigId?:       string;
  existingGig?: Gig & { id: string };
  venueId:      string;
  venueUid:     string;
  venue:        VenueDoc | null;
  onClose:      () => void;
  onSaved:      (gigId: string) => void;
};

export default function VenueGigForm({
  gigId, existingGig, venueId, venueUid, venue, onClose, onSaved,
}: Props) {
  const { colors } = useTheme();
  const isEdit     = !!gigId;

  const venueTimezone = STATE_TZ[venue?.state ?? ''] ?? 'Australia/Melbourne';
  const rooms         = (venue?.rooms ?? []).map((r: any) => r.name ?? '').filter(Boolean) as string[];

  // ── Section 1: Gig details ──
  const [title,          setTitle]          = useState(existingGig?.title ?? '');
  const [artistName,     setArtistName]     = useState(existingGig?.artistName ?? existingGig?.bandName ?? '');
  const [description,    setDescription]    = useState(existingGig?.description ?? '');
  const [localDate,      setLocalDate]      = useState(existingGig ? localDateFromGig(existingGig) : '');
  const [localStartTime, setLocalStartTime] = useState(existingGig ? localTimeFromGig(existingGig, false) : '');
  const [localEndTime,   setLocalEndTime]   = useState(existingGig ? localTimeFromGig(existingGig, true) : '');
  const [doorsTime,      setDoorsTime]      = useState('');
  const [room,           setRoom]           = useState(existingGig?.room ?? '');
  const [ticketUrl,      setTicketUrl]      = useState(existingGig?.fee?.ticketUrl ?? '');
  const [ticketPrice,    setTicketPrice]    = useState(existingGig?.fee?.ticketPriceCents ? String(existingGig.fee.ticketPriceCents / 100) : '');
  const [listAsBooked,   setListAsBooked]   = useState(existingGig?.listAsBooked ?? true);
  const [loadInTime,     setLoadInTime]     = useState(existingGig?.loadInTime ?? '');
  const [soundCheckTime, setSoundCheckTime] = useState(existingGig?.soundCheckTime ?? '');

  // ── Section 3: Private ──
  const [showPrivate,    setShowPrivate]    = useState(false);
  const [feeType,        setFeeType]        = useState<FeeType>(existingGig?.fee?.type ?? 'other');
  const [feeAmount,      setFeeAmount]      = useState(existingGig?.fee?.amountCents ? String(existingGig.fee.amountCents / 100) : '');
  const [doorPercent,    setDoorPercent]    = useState(existingGig?.fee?.doorPercent ? String(existingGig.fee.doorPercent) : '');
  const [feeNotes,       setFeeNotes]       = useState(existingGig?.fee?.notes ?? '');
  const [staffNotes,     setStaffNotes]     = useState('');
  const [privateDocs,    setPrivateDocs]    = useState<GigPrivateDoc['docs']>([]);
  const [pendingDocKind, setPendingDocKind] = useState<GigDocKind>('contract');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError,    setUploadError]    = useState('');

  // ── Submit state ──
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Load private doc for edit
  useEffect(() => {
    if (!gigId) return;
    getDoc(doc(db, 'gigs', gigId, 'private', venueUid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as GigPrivateDoc;
        setStaffNotes(d.notes ?? '');
        setPrivateDocs(d.docs ?? []);
      }
    }).catch(() => {});
  }, [gigId, venueUid]);

  // ── File upload ──
  async function pickDoc() {
    setUploadError('');
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,image/*,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        await doUpload({ uri: URL.createObjectURL(file), name: file.name, mimeType: file.type });
      };
      input.click();
    } else {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      await doUpload({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? undefined });
    }
  }

  async function doUpload(file: { uri: string; name: string; mimeType?: string }) {
    const targetGigId = gigId ?? 'pending';
    setUploadProgress({ bytes: 0, total: 1 });
    try {
      const { url, storagePath } = await uploadGigDoc(venueUid, targetGigId, file, p => setUploadProgress(p));
      const newDoc: GigPrivateDoc['docs'][0] = {
        id:          Date.now().toString(),
        kind:        pendingDocKind,
        name:        file.name,
        url,
        storagePath,
        uploadedAt: Timestamp.now(),
      };
      setPrivateDocs(prev => [...prev, newDoc]);
    } catch (e: any) {
      setUploadError(e?.message ?? 'Upload failed.');
    } finally {
      setUploadProgress(null);
    }
  }

  function removeDoc(id: string) {
    setPrivateDocs(prev => prev.filter(d => d.id !== id));
  }

  // ── Validation ──
  function validate(): boolean {
    if (!title.trim() || !localDate || !localStartTime) return false;
    if (ticketUrl.trim() && !ticketUrl.trim().startsWith('https://')) return false;
    return true;
  }

  // ── Submit ──
  async function handleSubmit() {
    if (!validate()) { setShowErrors(true); setError('Please fill in all required fields.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const input: VenueGigInput = {
        title:            title.trim(),
        artistName:       artistName.trim() || null,
        description:      description.trim() || null,
        localDate,
        localStartTime,
        localEndTime:     localEndTime || null,
        doorsTime:        doorsTime || null,
        ticketUrl:        ticketUrl.trim() || null,
        ticketPriceCents: ticketPrice ? dollarsToCents(ticketPrice) : null,
        room:             room.trim() || null,
        listAsBooked,
        loadInTime:       loadInTime.trim() || null,
        soundCheckTime:   soundCheckTime.trim() || null,
        venueName:        venue?.name ?? '',
        venueTimezone,
      };

      let savedGigId: string;

      if (isEdit && gigId) {
        await updateVenueGig({ gigId, venueId, input });
        savedGigId = gigId;
      } else {
        savedGigId = await createVenueGig({ venueId, venueUid, input });
      }

      // Save private doc
      if (staffNotes.trim() || privateDocs.length > 0 || feeType !== 'other' || feeAmount) {
        await savePrivateGigData(savedGigId, venueUid, {
          notes: staffNotes,
          docs:  privateDocs,
        });
        // Also update fee on gig
        if (feeType !== 'other' || feeAmount) {
          await updateVenueGig({
            gigId: savedGigId,
            venueId,
            input: {
              venueTimezone,
              ...({} as any),
            },
          }).catch(() => {});
        }
      }

      onSaved(savedGigId);
    } catch (e: any) {
      if (e?.code === 'unavailable') {
        setError("You're offline. Try again when connected.");
      } else if (e?.name === 'SlotConflictError') {
        setError('This slot is already booked by another act.');
      } else {
        setError(e?.message ?? 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Public preview ──
  function PublicPreview() {
    return (
      <View style={[pv.box, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[pv.heading, { color: colors.grey }]}>
          This appears on your public timetable
        </Text>
        <Text style={[pv.title, { color: colors.black }]}>{title || 'Event name'}</Text>
        {artistName ? <Text style={[pv.line, { color: colors.black }]}>{artistName}</Text> : null}
        <Text style={[pv.line, { color: colors.grey }]}>
          {localDate ? `${localDate}  ${localStartTime}` : 'Date'}
          {room ? `  ·  ${room}` : ''}
        </Text>
        <Text style={[pv.badge, { color: listAsBooked ? '#16a34a' : Colors.orange }]}>
          {listAsBooked ? 'Booked' : 'Pending'}
        </Text>
        {ticketUrl ? <Text style={[pv.link, { color: Colors.orange }]}>Tickets available</Text> : null}
        {description ? <Text style={[pv.desc, { color: colors.grey }]}>{description}</Text> : null}
      </View>
    );
  }

  const pv = StyleSheet.create({
    box:     { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 14 },
    heading: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 },
    title:   { fontSize: 16, fontWeight: '700', marginBottom: 3 },
    line:    { fontSize: 13, marginBottom: 2 },
    badge:   { fontSize: 13, fontWeight: '700', marginBottom: 2 },
    link:    { fontSize: 13, fontWeight: '600', marginTop: 2 },
    desc:    { fontSize: 13, marginTop: 4 },
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ms.wrap, { backgroundColor: colors.bg }]}>
        {/* Nav bar */}
        <View style={[ms.nav, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={ms.cancelBtn}>
            <Text style={[ms.cancelText, { color: colors.grey }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[ms.navTitle, { color: colors.black }]}>{isEdit ? 'Edit gig' : 'Add gig'}</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            style={[ms.saveBtn, submitting && ms.saveBtnDisabled]}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={ms.saveText}>{isEdit ? 'Save' : 'Add'}</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={ms.scroll} keyboardShouldPersistTaps="handled">

          {error ? (
            <View style={[ms.banner, { backgroundColor: Colors.danger + '18' }]}>
              <Text style={[ms.bannerText, { color: Colors.danger }]}>{error}</Text>
            </View>
          ) : null}

          {/* ── Section 1: Gig details ── */}
          <Text style={[ms.sectionTitle, { color: colors.black }]}>Gig details</Text>

          <Field label="Event name *" error={showErrors && !title.trim()}>
            <TextInput
              style={fi.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Saturday Night Live Music"
              placeholderTextColor={Colors.greyLight}
            />
          </Field>

          <Field label="Act name(s)">
            <TextInput
              style={fi.input}
              value={artistName}
              onChangeText={setArtistName}
              placeholder="e.g. The Jazzpeople"
              placeholderTextColor={Colors.greyLight}
            />
          </Field>

          {rooms.length > 0 && (
            <Field label="Room">
              <View style={cp.row}>
                <TouchableOpacity
                  style={[cp.chip, { borderColor: colors.border, backgroundColor: !room ? Colors.orange : colors.bg }]}
                  onPress={() => setRoom('')}
                >
                  <Text style={[cp.text, { color: !room ? '#111' : colors.grey }]}>Main room</Text>
                </TouchableOpacity>
                {rooms.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[cp.chip, { borderColor: colors.border, backgroundColor: room === r ? Colors.orange : colors.bg }]}
                    onPress={() => setRoom(r)}
                  >
                    <Text style={[cp.text, { color: room === r ? '#111' : colors.grey }]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
          )}

          {rooms.length === 0 && (
            <Field label="Room (optional)">
              <TextInput
                style={fi.input}
                value={room}
                onChangeText={setRoom}
                placeholder="e.g. Bandroom"
                placeholderTextColor={Colors.greyLight}
              />
            </Field>
          )}

          <View style={fi.row}>
            <View style={fi.half}>
              <Field label="Date *" error={showErrors && !localDate}>
                <DateInput value={localDate} onChange={setLocalDate} />
              </Field>
            </View>
          </View>

          <View style={fi.row}>
            <View style={fi.half}>
              <Field label="Start time *" error={showErrors && !localStartTime}>
                <TimeInput value={localStartTime} onChange={setLocalStartTime} />
              </Field>
            </View>
            <View style={fi.half}>
              <Field label="End time">
                <TimeInput value={localEndTime} onChange={setLocalEndTime} />
              </Field>
            </View>
          </View>

          <View style={fi.row}>
            <View style={fi.half}>
              <Field label="Load-in time">
                <TimeInput value={loadInTime} onChange={setLoadInTime} />
              </Field>
            </View>
            <View style={fi.half}>
              <Field label="Soundcheck time">
                <TimeInput value={soundCheckTime} onChange={setSoundCheckTime} />
              </Field>
            </View>
          </View>

          <Field label="Description">
            <TextInput
              style={[fi.input, ms.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Public description shown on the timetable"
              placeholderTextColor={Colors.greyLight}
              multiline
              numberOfLines={3}
            />
          </Field>

          <View style={fi.row}>
            <View style={fi.half}>
              <Field label="Ticket URL" hint="Must start with https://" error={showErrors && !!ticketUrl && !ticketUrl.startsWith('https://')}>
                <TextInput
                  style={fi.input}
                  value={ticketUrl}
                  onChangeText={setTicketUrl}
                  placeholder="https://..."
                  placeholderTextColor={Colors.greyLight}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </Field>
            </View>
            <View style={fi.half}>
              <Field label="Ticket price ($)">
                <TextInput
                  style={fi.input}
                  value={ticketPrice}
                  onChangeText={setTicketPrice}
                  placeholder="0.00"
                  placeholderTextColor={Colors.greyLight}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
          </View>

          {/* ── Section 2: Public preview ── */}
          <Text style={[ms.sectionTitle, { color: colors.black }]}>Timetable listing</Text>

          <View style={[ms.toggleRow, { borderColor: colors.border }]}>
            <View style={ms.toggleLeft}>
              <Text style={[ms.toggleLabel, { color: colors.black }]}>List as booked</Text>
              <Text style={[ms.toggleHint, { color: colors.grey }]}>
                Turn on once the booking is confirmed. Off shows as "Pending" until then.
              </Text>
            </View>
            <Switch
              value={listAsBooked}
              onValueChange={setListAsBooked}
              trackColor={{ false: Colors.border, true: '#16a34a' }}
              thumbColor="#fff"
            />
          </View>

          <PublicPreview />

          {/* ── Section 3: Private ── */}
          <TouchableOpacity
            style={[ms.sectionToggle, { borderColor: colors.border }]}
            onPress={() => setShowPrivate(v => !v)}
          >
            <Text style={[ms.sectionTitle, { color: colors.black, marginBottom: 0 }]}>Private</Text>
            <Text style={[ms.collapseArrow, { color: colors.grey }]}>{showPrivate ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          <Text style={[ms.privateNote, { color: colors.grey }]}>Only you can see this</Text>

          {showPrivate && (
            <View style={ms.privateWrap}>
              {/* Fee */}
              <Text style={[ms.subTitle, { color: colors.black }]}>Artist fee</Text>
              <Field label="Fee type">
                <ChipPicker options={FEE_TYPE_OPTIONS} value={feeType} onChange={setFeeType} colors={colors} />
              </Field>

              {(feeType === 'flat' || feeType === 'guarantee_vs_door') && (
                <Field label="Amount ($)">
                  <TextInput
                    style={fi.input}
                    value={feeAmount}
                    onChangeText={setFeeAmount}
                    placeholder="0.00"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="decimal-pad"
                  />
                </Field>
              )}

              {(feeType === 'door_split' || feeType === 'guarantee_vs_door' || feeType === 'ticket_split') && (
                <Field label="Split %">
                  <TextInput
                    style={fi.input}
                    value={doorPercent}
                    onChangeText={setDoorPercent}
                    placeholder="e.g. 70"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="decimal-pad"
                  />
                </Field>
              )}

              <Field label="Fee notes">
                <TextInput
                  style={[fi.input, ms.multiline]}
                  value={feeNotes}
                  onChangeText={setFeeNotes}
                  placeholder="Notes about the fee arrangement"
                  placeholderTextColor={Colors.greyLight}
                  multiline
                  numberOfLines={2}
                />
              </Field>

              {/* Staff notes */}
              <Text style={[ms.subTitle, { color: colors.black }]}>Staff notes</Text>
              <Text style={[ms.privateNote, { color: colors.grey }]}>Only you can see this</Text>
              <Field label="">
                <TextInput
                  style={[fi.input, ms.multiline]}
                  value={staffNotes}
                  onChangeText={setStaffNotes}
                  placeholder="Internal notes for your team"
                  placeholderTextColor={Colors.greyLight}
                  multiline
                  numberOfLines={4}
                />
              </Field>

              {/* Production documents */}
              <Text style={[ms.subTitle, { color: colors.black }]}>Production docs</Text>
              <Text style={[ms.privateNote, { color: colors.grey }]}>Only you can see this</Text>

              {privateDocs.map(d => (
                <DocRow key={d.id} d={d} onRemove={() => removeDoc(d.id)} colors={colors} />
              ))}

              <View style={fi.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[fi.label, { color: colors.black }]}>Document type</Text>
                  <ChipPicker options={DOC_KINDS} value={pendingDocKind} onChange={setPendingDocKind} colors={colors} />
                </View>
              </View>
              <View style={{ height: 10 }} />

              {uploadProgress ? (
                <View style={ms.progressWrap}>
                  <View style={[ms.progressBar, { width: `${uploadProgress.total ? Math.round(uploadProgress.bytes / uploadProgress.total * 100) : 0}%` as any }]} />
                  <Text style={[ms.progressText, { color: colors.grey }]}>Uploading...</Text>
                </View>
              ) : (
                <TouchableOpacity style={[ms.uploadBtn, { borderColor: colors.border }]} onPress={pickDoc}>
                  <Text style={[ms.uploadBtnText, { color: colors.black }]}>+ Attach document</Text>
                </TouchableOpacity>
              )}

              {uploadError ? (
                <Text style={[ms.uploadError, { color: Colors.danger }]}>{uploadError}</Text>
              ) : null}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  wrap:         { flex: 1 },
  nav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  cancelBtn:    { minWidth: 60 },
  cancelText:   { fontSize: 15 },
  navTitle:     { fontSize: 16, fontWeight: '700' },
  saveBtn:      { backgroundColor: Colors.orange, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnDisabled: { opacity: 0.6 },
  saveText:     { fontSize: 14, fontWeight: '700', color: '#111' },
  scroll:       { padding: 16, paddingBottom: 40 },
  banner:       { borderRadius: 10, padding: 12, marginBottom: 14 },
  bannerText:   { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 14, marginTop: 8 },
  multiline:    { minHeight: 80, textAlignVertical: 'top' as const },
  toggleRow:    { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14, gap: 12 },
  toggleLeft:   { flex: 1, gap: 4 },
  toggleLabel:  { fontSize: 15, fontWeight: '600' },
  toggleHint:   { fontSize: 12 },
  sectionToggle:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 14, marginBottom: 4 },
  collapseArrow:{ fontSize: 12 },
  privateNote:  { fontSize: 12, marginBottom: 10 },
  privateWrap:  { paddingTop: 8 },
  subTitle:     { fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  progressWrap: { height: 6, backgroundColor: Colors.border, borderRadius: 3, marginBottom: 10, overflow: 'hidden', position: 'relative' },
  progressBar:  { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: Colors.orange, borderRadius: 3 },
  progressText: { fontSize: 11, textAlign: 'center', marginTop: 8 },
  uploadBtn:    { borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 8 },
  uploadBtnText:{ fontSize: 14, fontWeight: '600' },
  uploadError:  { fontSize: 13, marginBottom: 8 },
});
