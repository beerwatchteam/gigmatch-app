/**
 * ArtistGigForm
 * Creates or edits an artist-added gig.
 * Used by My Gigs for both new gigs and editing existing ones.
 *
 * Section 1: Gig details
 * Section 2: Public visibility + preview
 * Section 3: Private (fee, payment, documents, notes) — collapsible
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
import { doc, getDoc, collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  createArtistGig, updateArtistGig, setGigPublic, savePrivateGigData,
  uploadGigDoc, type ArtistGigInput, type UploadProgress,
} from '@/lib/useGigs';
import {
  STATE_TZ, dollarsToCents, type Gig, type GigPrivateDoc,
  type GigFee, type FeeType, type GigDocKind,
} from '@/lib/gig-types';

// ── Constants ─────────────────────────────────────────────────────────────────

const AU_STATES = ['NSW','VIC','QLD','SA','WA','TAS','NT','ACT'];

const FEE_TYPES: { value: FeeType; label: string }[] = [
  { value: 'flat',              label: 'Flat fee'          },
  { value: 'door_split',        label: 'Door split'        },
  { value: 'guarantee_vs_door', label: 'Guarantee + door'  },
  { value: 'ticket_split',      label: 'Ticket split'      },
  { value: 'unpaid',            label: 'Unpaid'            },
  { value: 'other',             label: 'Other'             },
];

const DOC_KINDS: { value: GigDocKind; label: string }[] = [
  { value: 'contract',   label: 'Contract'     },
  { value: 'tech_spec',  label: 'Tech spec'    },
  { value: 'stage_plot', label: 'Stage plot'   },
  { value: 'run_sheet',  label: 'Run sheet'    },
  { value: 'invoice',    label: 'Invoice'      },
  { value: 'other',      label: 'Other'        },
];

// ── Date/time inputs (web vs native) ─────────────────────────────────────────

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

// ── Inline form field ─────────────────────────────────────────────────────────

function Field({ label, hint, children, error }: { label: string; hint?: string; children: React.ReactNode; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={fi.field}>
      <Text style={[fi.label, { color: colors.black }]}>{label}</Text>
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

// ── State picker (AU states) ──────────────────────────────────────────────────

function StatePicker({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  return (
    <View style={sp.row}>
      {AU_STATES.map(s => (
        <TouchableOpacity
          key={s}
          style={[sp.chip, { borderColor: colors.border, backgroundColor: value === s ? Colors.orange : colors.bg }]}
          onPress={() => onChange(s)}
        >
          <Text style={[sp.chipText, { color: value === s ? '#111' : colors.grey }]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const sp = StyleSheet.create({
  row:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600' },
});

// ── Fee type picker ───────────────────────────────────────────────────────────

function FeeTypePicker({ value, onChange, colors }: { value: FeeType; onChange: (v: FeeType) => void; colors: any }) {
  return (
    <View style={sp.row}>
      {FEE_TYPES.map(ft => (
        <TouchableOpacity
          key={ft.value}
          style={[sp.chip, { borderColor: colors.border, backgroundColor: value === ft.value ? Colors.orange : colors.bg }]}
          onPress={() => onChange(ft.value)}
        >
          <Text style={[sp.chipText, { color: value === ft.value ? '#111' : colors.grey }]}>{ft.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Document row ──────────────────────────────────────────────────────────────

function DocRow({ doc: d, onRemove, colors }: { doc: GigPrivateDoc['docs'][0]; onRemove: () => void; colors: any }) {
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

// ── Main form ─────────────────────────────────────────────────────────────────

type Props = {
  gigId?:       string;
  existingGig?: Gig & { id: string };
  artistUid:    string;
  artistName:   string;
  allGigDates:  string[];   // YYYY-MM-DD dates of other artist gigs (for conflict warning)
  onClose:      () => void;
  onSaved:      (gigId: string) => void;
};

export default function ArtistGigForm({
  gigId, existingGig, artistUid, artistName, allGigDates, onClose, onSaved,
}: Props) {
  const { colors } = useTheme();
  const isEdit     = !!gigId;

  // ── Section 1: Gig details ──
  const [title,          setTitle]          = useState(existingGig?.title ?? '');
  const [venueName,      setVenueName]      = useState(existingGig?.venueName ?? '');
  const [locationText,   setLocationText]   = useState(existingGig?.locationText ?? '');
  const [state,          setState]          = useState(existingGig?.state ?? 'VIC');
  const [localDate,      setLocalDate]      = useState(existingGig ? localDateFromGig(existingGig) : '');
  const [localStartTime, setLocalStartTime] = useState(existingGig ? localTimeFromGig(existingGig, false) : '');
  const [localEndTime,   setLocalEndTime]   = useState(existingGig ? localTimeFromGig(existingGig, true) : '');
  const [doorsTime,      setDoorsTime]      = useState('');
  const [ticketUrl,      setTicketUrl]      = useState(existingGig?.fee?.ticketUrl ?? '');
  const [ticketPrice,    setTicketPrice]    = useState(existingGig?.fee?.ticketPriceCents ? String(existingGig.fee.ticketPriceCents / 100) : '');
  const [description,    setDescription]    = useState(existingGig?.description ?? '');
  const [attendance,     setAttendance]     = useState(existingGig?.attendance != null ? String(existingGig.attendance) : '');

  // ── Section 2: Visibility ──
  const [isPublic, setIsPublic] = useState(existingGig?.isPublic ?? false);

  // ── Section 3: Private ──
  const [showPrivate,   setShowPrivate]   = useState(false);
  const [feeType,       setFeeType]       = useState<FeeType>(existingGig?.fee?.type ?? 'other');
  const [feeAmount,     setFeeAmount]     = useState(existingGig?.fee?.amountCents ? String(existingGig.fee.amountCents / 100) : '');
  const [doorPercent,   setDoorPercent]   = useState(existingGig?.fee?.doorPercent ? String(existingGig.fee.doorPercent) : '');
  const [feeNotes,      setFeeNotes]      = useState(existingGig?.fee?.notes ?? '');
  const [privateNotes,  setPrivateNotes]  = useState('');
  const [privateDocs,   setPrivateDocs]   = useState<GigPrivateDoc['docs']>([]);
  const [pendingDocKind, setPendingDocKind] = useState<GigDocKind>('contract');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError,   setUploadError]   = useState('');

  // ── Submit state ──
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Past date detection
  const today = new Date().toISOString().slice(0, 10);
  const isPast = !!localDate && localDate < today;

  // Date conflict warning
  const otherDates = allGigDates.filter(d => d !== localDate && d === localDate);
  const hasConflict = localDate && allGigDates.filter(d => d === localDate && d !== (existingGig ? localDateFromGig(existingGig) : '')).length > 0;

  // Load private doc for edit
  useEffect(() => {
    if (!gigId) return;
    getDoc(doc(db, 'gigs', gigId, 'private', artistUid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as GigPrivateDoc;
        setPrivateNotes(d.notes ?? '');
        setPrivateDocs(d.docs ?? []);
      }
    }).catch(() => {});
  }, [gigId, artistUid]);

  // Auto-fill set length when end time changes
  const setLength = (() => {
    if (!localStartTime || !localEndTime) return null;
    const [sh, sm] = localStartTime.split(':').map(Number);
    const [eh, em] = localEndTime.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60;
    return diff > 0 ? diff : null;
  })();

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
        const url = URL.createObjectURL(file);
        await doUpload({ uri: url, name: file.name, mimeType: file.type });
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
      const { url, storagePath } = await uploadGigDoc(artistUid, targetGigId, file, p => setUploadProgress(p));
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
    if (!title.trim() || !venueName.trim() || !localDate) return false;
    if (!isPast && !localStartTime) return false;
    if (!isPast && ticketUrl.trim() && !ticketUrl.trim().startsWith('https://')) return false;
    return true;
  }

  // ── Submit ──
  async function handleSubmit() {
    if (!validate()) { setShowErrors(true); setError('Please fill in all required fields.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const attendanceVal = attendance.trim() ? Math.round(Math.abs(parseFloat(attendance))) : null;
      const effectiveStartTime = isPast ? (localStartTime || '00:00') : localStartTime;

      const input: ArtistGigInput = {
        title:            title.trim(),
        venueName:        venueName.trim(),
        locationText:     locationText.trim() || null,
        state,
        localDate,
        localStartTime:   effectiveStartTime,
        localEndTime:     (!isPast && localEndTime) ? localEndTime : null,
        doorsTime:        (!isPast && doorsTime) ? doorsTime : null,
        ticketUrl:        (!isPast && ticketUrl.trim()) ? ticketUrl.trim() : null,
        ticketPriceCents: (!isPast && ticketPrice) ? dollarsToCents(ticketPrice) : null,
        description:      description.trim() || null,
        setLengthMinutes: setLength,
        isPublic,
        attendance:       attendanceVal,
        fee: {
          type:            feeType,
          amountCents:     feeAmount ? dollarsToCents(feeAmount) : null,
          doorPercent:     doorPercent ? parseFloat(doorPercent) : null,
          ticketPriceCents: (!isPast && ticketPrice) ? dollarsToCents(ticketPrice) : null,
          ticketUrl:        (!isPast && ticketUrl.trim()) ? ticketUrl.trim() : null,
          notes:            feeNotes.trim() || null,
          includesGst:      null,
        },
      };

      let savedGigId: string;

      if (isEdit && gigId) {
        await updateArtistGig({ gigId, artistUid, input });
        await setGigPublic(gigId, isPublic);
        savedGigId = gigId;
      } else {
        savedGigId = await createArtistGig({ artistUid, artistName, input });
      }

      // Save private doc (notes + docs)
      if (privateNotes.trim() || privateDocs.length > 0) {
        await savePrivateGigData(savedGigId, artistUid, {
          notes: privateNotes,
          docs:  privateDocs,
        });
      }

      onSaved(savedGigId);
    } catch (e: any) {
      if (e?.code === 'unavailable') {
        setError("You're offline. Try again when connected.");
      } else {
        setError(e?.message ?? 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Public preview ──
  function PublicPreview() {
    if (!isPublic) return null;
    const tz   = STATE_TZ[state] ?? 'Australia/Melbourne';
    return (
      <View style={[pv.box, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[pv.heading, { color: colors.grey }]}>Public preview</Text>
        <Text style={[pv.title, { color: colors.black }]}>{title || 'Event name'}</Text>
        <Text style={[pv.line, { color: colors.grey }]}>
          {[venueName, locationText].filter(Boolean).join(' · ') || 'Venue'}
        </Text>
        <Text style={[pv.line, { color: colors.grey }]}>
          {localDate ? `${localDate}  ${localStartTime}` : 'Date'}
          {state ? `  (${tz.replace('Australia/', '')})` : ''}
        </Text>
        {ticketUrl ? <Text style={[pv.link, { color: Colors.orange }]}>Tickets available</Text> : null}
        {description ? <Text style={[pv.desc, { color: colors.grey }]}>{description}</Text> : null}
      </View>
    );
  }

  const pv = StyleSheet.create({
    box:     { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 },
    heading: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 },
    title:   { fontSize: 16, fontWeight: '700', marginBottom: 3 },
    line:    { fontSize: 13, marginBottom: 2 },
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
              placeholder="e.g. Jazz Night at The Corner"
              placeholderTextColor={Colors.greyLight}
            />
          </Field>

          <Field label="Venue name *" error={showErrors && !venueName.trim()}>
            <TextInput
              style={fi.input}
              value={venueName}
              onChangeText={setVenueName}
              placeholder="e.g. The Corner Hotel"
              placeholderTextColor={Colors.greyLight}
            />
          </Field>

          <Field label="Suburb / address">
            <TextInput
              style={fi.input}
              value={locationText}
              onChangeText={setLocationText}
              placeholder="e.g. Richmond VIC"
              placeholderTextColor={Colors.greyLight}
            />
          </Field>

          <Field label="State *">
            <StatePicker value={state} onChange={setState} colors={colors} />
          </Field>

          <View style={fi.row}>
            <View style={fi.half}>
              <Field label="Date *" error={showErrors && !localDate}>
                <DateInput value={localDate} onChange={setLocalDate} placeholder="YYYY-MM-DD" />
              </Field>
            </View>
          </View>

          {hasConflict && (
            <View style={[ms.warning, { backgroundColor: Colors.orange + '18' }]}>
              <Text style={[ms.warningText, { color: Colors.orange }]}>
                You already have a gig on this date.
              </Text>
            </View>
          )}

          {!isPast && (
            <>
              <View style={fi.row}>
                <View style={fi.half}>
                  <Field label="Start time *" error={showErrors && !localStartTime}>
                    <TimeInput value={localStartTime} onChange={setLocalStartTime} placeholder="HH:MM" />
                  </Field>
                </View>
                <View style={fi.half}>
                  <Field label="End time">
                    <TimeInput value={localEndTime} onChange={setLocalEndTime} placeholder="HH:MM" />
                  </Field>
                </View>
              </View>

              {setLength && setLength > 0 ? (
                <Text style={[ms.setLength, { color: colors.grey }]}>Set length: {setLength} min</Text>
              ) : null}

              <Field label="Doors time">
                <TimeInput value={doorsTime} onChange={setDoorsTime} placeholder="HH:MM" />
              </Field>
            </>
          )}

          <Field label="Description">
            <TextInput
              style={[fi.input, ms.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Public description of the event"
              placeholderTextColor={Colors.greyLight}
              multiline
              numberOfLines={3}
            />
          </Field>

          {!isPast && (
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
          )}

          {isPast && (
            <Field label="Attendance" hint="How many people showed up? This feeds your average draw on your public profile.">
              <TextInput
                style={fi.input}
                value={attendance}
                onChangeText={setAttendance}
                placeholder="e.g. 120"
                placeholderTextColor={Colors.greyLight}
                keyboardType="number-pad"
              />
            </Field>
          )}

          {/* ── Section 2: Public visibility ── */}
          <Text style={[ms.sectionTitle, { color: colors.black }]}>Public profile</Text>

          <View style={[ms.toggleRow, { borderColor: colors.border }]}>
            <View style={ms.toggleLeft}>
              <Text style={[ms.toggleLabel, { color: colors.black }]}>Show on my public profile</Text>
              <Text style={[ms.toggleHint, { color: colors.grey }]}>
                Shows the event name, venue, date, time, suburb and ticket link. Never fees, documents or notes.
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: Colors.border, true: Colors.orange }}
              thumbColor={isPublic ? '#fff' : '#fff'}
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
              <Text style={[ms.subTitle, { color: colors.black }]}>Fee</Text>
              <Field label="Fee type">
                <FeeTypePicker value={feeType} onChange={setFeeType} colors={colors} />
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
                  placeholder="Any notes about the fee arrangement"
                  placeholderTextColor={Colors.greyLight}
                  multiline
                  numberOfLines={2}
                />
              </Field>

              {/* Private notes */}
              <Text style={[ms.subTitle, { color: colors.black }]}>Private notes</Text>
              <Text style={[ms.privateNote, { color: colors.grey }]}>Only you can see this</Text>
              <Field label="">
                <TextInput
                  style={[fi.input, ms.multiline]}
                  value={privateNotes}
                  onChangeText={setPrivateNotes}
                  placeholder="Your private notes about this gig"
                  placeholderTextColor={Colors.greyLight}
                  multiline
                  numberOfLines={4}
                />
              </Field>

              {/* Documents */}
              <Text style={[ms.subTitle, { color: colors.black }]}>Documents</Text>
              <Text style={[ms.privateNote, { color: colors.grey }]}>Only you can see this</Text>

              {privateDocs.map(d => (
                <DocRow key={d.id} doc={d} onRemove={() => removeDoc(d.id)} colors={colors} />
              ))}

              <View style={fi.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[fi.label, { color: colors.black }]}>Document type</Text>
                  <View style={sp.row}>
                    {DOC_KINDS.map(k => (
                      <TouchableOpacity
                        key={k.value}
                        style={[sp.chip, { borderColor: colors.border, backgroundColor: pendingDocKind === k.value ? Colors.orange : colors.bg }]}
                        onPress={() => setPendingDocKind(k.value)}
                      >
                        <Text style={[sp.chipText, { color: pendingDocKind === k.value ? '#111' : colors.grey }]}>{k.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

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

// ── Helpers for existing gig ──────────────────────────────────────────────────

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
    const date = ts.toDate();
    const fmt  = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(date);
  } catch { return ''; }
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
  warning:      { borderRadius: 8, padding: 10, marginBottom: 10 },
  warningText:  { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 14, marginTop: 8 },
  setLength:    { fontSize: 13, marginBottom: 10 },
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
