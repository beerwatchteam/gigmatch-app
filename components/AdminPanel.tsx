import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import SuburbSearch from '@/components/SuburbSearch';
import { Text } from '@/components/Text';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';

// ── Types ───────────────────────────────────────────────────────────────────

type VenueApplication = {
  uid: string;
  venueName: string;
  email: string;
  username: string;
  selectedVenueId: string | null;
  isNewVenue: boolean;
  status: 'pending' | 'awaiting_code' | 'manual_review' | 'approved' | 'rejected';
  submittedAt?: Timestamp;
  verificationContact: string;
  verificationContactType: 'email' | 'phone' | 'manual';
  notes?: string;
  isDispute?: boolean;
};

type VenueDispute = {
  id: string;
  venueDocId: string;
  venueName: string;
  claimId: string;
  currentOwnerId: string;
  challengerUserId: string;
  challengerEmail: string;
  status: string;
  disputeWindowExpiry?: Timestamp;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function formatDate(ts?: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Main Component ───────────────────────────────────────────────────────────

type Props = { visible: boolean; onClose: () => void };

const BLANK_VENUE_FORM = {
  name: '', streetAddress: '', suburb: '', postcode: '', phone: '', email: '', website: '',
};

export default function AdminPanel({ visible, onClose }: Props) {
  const [apps, setApps]       = useState<VenueApplication[]>([]);
  const [disputes, setDisputes] = useState<VenueDispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState<string | null>(null);
  const [generatedCodes, setGeneratedCodes] = useState<Record<string, string>>({});

  // ── Add Venue form ─────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]   = useState(false);
  const [addForm, setAddForm]   = useState({ ...BLANK_VENUE_FORM });
  const [addBusy, setAddBusy]   = useState(false);
  const [addErrors, setAddErrors] = useState<string[]>([]);

  function setField(key: keyof typeof BLANK_VENUE_FORM, value: string) {
    setAddForm(prev => ({ ...prev, [key]: value }));
    setAddErrors(prev => prev.filter(e => e !== key));
  }

  async function handleAddVenue() {
    const errors: string[] = [];
    if (!addForm.name.trim()) errors.push('name');
    if (!addForm.suburb.trim()) errors.push('suburb');
    if (errors.length > 0) { setAddErrors(errors); return; }

    setAddBusy(true);
    try {
      const location = [addForm.suburb.trim(), 'VIC', addForm.postcode.trim()].filter(Boolean).join(', ');
      await addDoc(collection(db, 'venues'), {
        name: addForm.name.trim(),
        streetAddress: addForm.streetAddress.trim(),
        location,
        suburb: addForm.suburb.trim(),
        state: 'VIC',
        postcode: addForm.postcode.trim(),
        phone: addForm.phone.trim(),
        email: addForm.email.trim(),
        website: addForm.website.trim(),
        description: '',
        photoUrl: '',
        latitude: '',
        longitude: '',
        rooms: [],
        gigNights: [],
        techSpecs: {},
        settings: { emailOnNewEnquiry: false, emailEnquiryReminders: false, listed: true },
        photos: [],
        videos: [],
        payment: {},
        photoPosition: { x: 50, y: 50 },
        onboardingComplete: true,
        importSource: 'admin',
        createdAt: serverTimestamp(),
      });
      setAddForm({ ...BLANK_VENUE_FORM });
      setAddOpen(false);
      Alert.alert('Venue added', `"${addForm.name.trim()}" is now live.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to add venue.');
    } finally {
      setAddBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsSnap, disputesSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'venueApplications'),
          where('status', 'in', ['pending', 'awaiting_code', 'manual_review']),
          orderBy('submittedAt', 'desc'),
          limit(50),
        )),
        getDocs(query(
          collection(db, 'venueDisputes'),
          where('status', '==', 'pending_owner'),
          limit(20),
        )),
      ]);
      setApps(appsSnap.docs.map(d => ({ uid: d.id, ...d.data() } as VenueApplication)));
      setDisputes(disputesSnap.docs.map(d => ({ id: d.id, ...d.data() } as VenueDispute)));
    } catch (e) {
      console.error('AdminPanel load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setGeneratedCodes({}); load(); }
  }, [visible, load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleGenerateCode(app: VenueApplication) {
    setBusy(app.uid);
    try {
      const code = generateCode();
      const expiry = new Date();
      if (app.verificationContactType === 'email') {
        expiry.setHours(expiry.getHours() + 24);
      } else {
        expiry.setMinutes(expiry.getMinutes() + 10);
      }
      await updateDoc(doc(db, 'venueApplications', app.uid), {
        verificationCode: code,
        verificationCodeExpiry: Timestamp.fromDate(expiry),
        status: 'awaiting_code',
      });
      await updateDoc(doc(db, 'users', app.uid), { claimStatus: 'awaiting_code' });
      setGeneratedCodes(prev => ({ ...prev, [app.uid]: code }));
      setApps(prev => prev.map(a => a.uid === app.uid ? { ...a, status: 'awaiting_code' } : a));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to generate code.');
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove(app: VenueApplication) {
    setBusy(app.uid);
    try {
      let venueId = app.selectedVenueId;
      if (!venueId) {
        const venueRef = await addDoc(collection(db, 'venues'), {
          name: app.venueName,
          claimedBy: app.uid,
          claimedByEmail: app.email,
          claimedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        venueId = venueRef.id;
      } else {
        await updateDoc(doc(db, 'venues', venueId), {
          claimedBy: app.uid,
          claimedByEmail: app.email,
          claimedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'venueApplications', app.uid), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser?.email ?? '',
        linkedVenueId: venueId,
      });
      await updateDoc(doc(db, 'users', app.uid), {
        claimStatus: 'approved',
        venueId,
        type: 'venue',
      });
      setApps(prev => prev.filter(a => a.uid !== app.uid));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to approve.');
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(app: VenueApplication) {
    setBusy(app.uid);
    try {
      await updateDoc(doc(db, 'venueApplications', app.uid), {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        rejectedBy: auth.currentUser?.email ?? '',
      });
      await updateDoc(doc(db, 'users', app.uid), { claimStatus: 'rejected' });
      setApps(prev => prev.filter(a => a.uid !== app.uid));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to reject.');
    } finally {
      setBusy(null);
    }
  }

  async function handleMoveToManual(app: VenueApplication) {
    setBusy(app.uid);
    try {
      await updateDoc(doc(db, 'venueApplications', app.uid), { status: 'manual_review' });
      await updateDoc(doc(db, 'users', app.uid), { claimStatus: 'manual_review' });
      setApps(prev => prev.map(a => a.uid === app.uid ? { ...a, status: 'manual_review' } : a));
    } catch {
    } finally {
      setBusy(null);
    }
  }

  async function handleForceTransfer(dispute: VenueDispute) {
    setBusy(dispute.id);
    try {
      await updateDoc(doc(db, 'venues', dispute.venueDocId), {
        claimedBy: dispute.challengerUserId,
        claimedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'venueApplications', dispute.challengerUserId), {
        status: 'approved',
        approvedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', dispute.challengerUserId), {
        claimStatus: 'approved',
        venueId: dispute.venueDocId,
      });
      await updateDoc(doc(db, 'venueDisputes', dispute.id), { status: 'admin_transferred' });
      setDisputes(prev => prev.filter(d => d.id !== dispute.id));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to force transfer.');
    } finally {
      setBusy(null);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const pendingApps  = apps.filter(a => a.status === 'pending');
  const awaitingApps = apps.filter(a => a.status === 'awaiting_code');
  const manualApps   = apps.filter(a => a.status === 'manual_review');

  function renderApp(app: VenueApplication) {
    const isBusy     = busy === app.uid;
    const isManual   = app.verificationContactType === 'manual';
    const isAwaiting = app.status === 'awaiting_code';
    const code       = generatedCodes[app.uid];

    return (
      <View key={app.uid} style={[s.card, app.isDispute && s.cardDispute]}>
        {app.isDispute && <Text style={s.disputeBadge}>DISPUTE CLAIM</Text>}

        <View style={s.cardHeader}>
          <Text style={s.cardVenueName}>{app.venueName}</Text>
          <View style={[s.typeBadge, app.isNewVenue ? s.typeBadgeNew : s.typeBadgeClaim]}>
            <Text style={s.typeBadgeText}>{app.isNewVenue ? 'New Venue' : 'Claiming Existing'}</Text>
          </View>
        </View>

        <Text style={s.cardEmail}>{app.email}</Text>
        {!!app.submittedAt && <Text style={s.cardDate}>{formatDate(app.submittedAt)}</Text>}

        {!isManual && !!app.verificationContact && (
          <View style={s.contactRow}>
            <View style={s.contactBadge}>
              <Text style={s.contactBadgeText}>
                {app.verificationContactType === 'email' ? 'EMAIL' : 'PHONE'}
              </Text>
            </View>
            <Text style={s.contactValue}>{app.verificationContact}</Text>
          </View>
        )}
        {isManual && <Text style={s.manualBadge}>MANUAL REVIEW REQUESTED</Text>}
        {!!app.notes && <Text style={s.notes}>"{app.notes}"</Text>}

        {/* Code generated this session — show prominently */}
        {code && (
          <View style={s.codeBox}>
            <Text style={s.codeLabel}>
              {app.verificationContactType === 'email'
                ? `Email this code to ${app.verificationContact}:`
                : `Call or SMS this code to ${app.verificationContact}:`}
            </Text>
            <Text style={s.codeValue}>{code}</Text>
            <Text style={s.codeExpiry}>
              Expires in {app.verificationContactType === 'email' ? '24 hours' : '10 minutes'}
            </Text>
          </View>
        )}

        {/* Already in awaiting_code from a previous session */}
        {isAwaiting && !code && (
          <View style={[s.codeBox, s.codeBoxAmber]}>
            <Text style={s.codeBoxAmberText}>Code was already sent — claimant is entering it now.</Text>
            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, { marginTop: 8, flex: 0 }, isBusy && s.actionBtnDim]}
              onPress={() => handleGenerateCode(app)}
              disabled={isBusy}
            >
              <Text style={s.actionBtnText}>{isBusy ? 'Generating…' : 'Resend New Code'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Primary actions */}
        <View style={s.actionRow}>
          {!isManual && !isAwaiting && !code && (
            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, isBusy && s.actionBtnDim]}
              onPress={() => handleGenerateCode(app)}
              disabled={isBusy}
            >
              {isBusy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.actionBtnText}>Generate Code</Text>}
            </TouchableOpacity>
          )}
          {isManual && (
            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, isBusy && s.actionBtnDim]}
              onPress={() => handleApprove(app)}
              disabled={isBusy}
            >
              {isBusy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.actionBtnText}>Approve</Text>}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.actionBtn, s.actionBtnDanger, isBusy && s.actionBtnDim]}
            onPress={() => handleReject(app)}
            disabled={isBusy}
          >
            <Text style={[s.actionBtnText, { color: Colors.danger }]}>Reject</Text>
          </TouchableOpacity>
        </View>

        {/* Move to manual review option */}
        {!isManual && !isAwaiting && !code && (
          <TouchableOpacity style={s.manualMoveBtn} onPress={() => handleMoveToManual(app)} disabled={isBusy}>
            <Text style={s.manualMoveBtnText}>Move to Manual Review</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Admin — Venue Claims</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={s.doneBtn}>Done</Text>
          </TouchableOpacity>
        </View>

        {loading
          ? <View style={s.center}><ActivityIndicator color={Colors.orange} size="large" /></View>
          : (
            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Add Venue */}
              <TouchableOpacity style={s.addVenueToggle} onPress={() => { setAddOpen(o => !o); setAddErrors([]); }}>
                <Text style={s.addVenueToggleText}>{addOpen ? 'Cancel' : '+ Add Venue'}</Text>
              </TouchableOpacity>

              {addOpen && (
                <View style={s.addVenueForm}>
                  <Text style={s.addVenueFormTitle}>New Venue</Text>

                  <Text style={s.fieldLabel}>Venue name *</Text>
                  <TextInput
                    style={[s.input, addErrors.includes('name') && s.inputError]}
                    value={addForm.name}
                    onChangeText={v => setField('name', v)}
                    placeholder="e.g. Corner Hotel"
                    placeholderTextColor={Colors.greyLight}
                  />

                  <Text style={s.fieldLabel}>Street address</Text>
                  <TextInput
                    style={s.input}
                    value={addForm.streetAddress}
                    onChangeText={v => setField('streetAddress', v)}
                    placeholder="e.g. 57 Swan Street"
                    placeholderTextColor={Colors.greyLight}
                  />

                  <Text style={s.fieldLabel}>Suburb *</Text>
                  <SuburbSearch
                    value={addForm.suburb}
                    onChange={v => setField('suburb', v)}
                    onAutofill={(suburb, _state, postcode) => {
                      setAddForm(prev => ({ ...prev, suburb, postcode }));
                      setAddErrors(prev => prev.filter(e => e !== 'suburb'));
                    }}
                    error={addErrors.includes('suburb')}
                  />

                  <Text style={s.fieldLabel}>Phone</Text>
                  <TextInput
                    style={s.input}
                    value={addForm.phone}
                    onChangeText={v => setField('phone', v)}
                    placeholder="e.g. 03 9999 0000"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="phone-pad"
                  />

                  <Text style={s.fieldLabel}>Email</Text>
                  <TextInput
                    style={s.input}
                    value={addForm.email}
                    onChangeText={v => setField('email', v)}
                    placeholder="e.g. bookings@venue.com.au"
                    placeholderTextColor={Colors.greyLight}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <Text style={s.fieldLabel}>Website</Text>
                  <TextInput
                    style={s.input}
                    value={addForm.website}
                    onChangeText={v => setField('website', v)}
                    placeholder="e.g. https://venue.com.au"
                    placeholderTextColor={Colors.greyLight}
                    autoCapitalize="none"
                    keyboardType="url"
                  />

                  {addErrors.length > 0 && (
                    <Text style={s.errorText}>Please fill in the required fields.</Text>
                  )}

                  <TouchableOpacity
                    style={[s.addVenueSubmit, addBusy && s.actionBtnDim]}
                    onPress={handleAddVenue}
                    disabled={addBusy}
                  >
                    {addBusy
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.addVenueSubmitText}>Add Venue</Text>}
                  </TouchableOpacity>
                </View>
              )}

              <View style={s.divider} />

              {/* Pending */}
              <Text style={s.sectionTitle}>Pending ({pendingApps.length})</Text>
              {pendingApps.length === 0
                ? <Text style={s.emptyText}>No pending claims.</Text>
                : pendingApps.map(renderApp)}

              {/* Awaiting code */}
              <Text style={[s.sectionTitle, { marginTop: 28 }]}>Awaiting Code ({awaitingApps.length})</Text>
              {awaitingApps.length === 0
                ? <Text style={s.emptyText}>None awaiting code entry.</Text>
                : awaitingApps.map(renderApp)}

              {/* Manual review */}
              <Text style={[s.sectionTitle, { marginTop: 28 }]}>Manual Review ({manualApps.length})</Text>
              {manualApps.length === 0
                ? <Text style={s.emptyText}>No manual reviews.</Text>
                : manualApps.map(renderApp)}

              {/* Disputes */}
              {disputes.length > 0 && (
                <>
                  <Text style={[s.sectionTitle, { marginTop: 28, color: Colors.danger }]}>
                    Disputes ({disputes.length})
                  </Text>
                  {disputes.map(dispute => (
                    <View key={dispute.id} style={[s.card, s.cardDispute]}>
                      <Text style={s.disputeBadge}>OWNERSHIP DISPUTE</Text>
                      <Text style={s.cardVenueName}>{dispute.venueName}</Text>
                      <Text style={s.cardEmail}>Challenger: {dispute.challengerEmail}</Text>
                      {dispute.disputeWindowExpiry && (
                        <Text style={s.notes}>
                          Window expires: {formatDate(dispute.disputeWindowExpiry)}
                        </Text>
                      )}
                      <View style={s.actionRow}>
                        <TouchableOpacity
                          style={[s.actionBtn, s.actionBtnDanger, busy === dispute.id && s.actionBtnDim]}
                          onPress={() => handleForceTransfer(dispute)}
                          disabled={busy === dispute.id}
                        >
                          {busy === dispute.id
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={[s.actionBtnText, { color: '#fff' }]}>Force Transfer</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </>
              )}

              <View style={{ height: 48 }} />
            </ScrollView>
          )}
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f9f9f9' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.black },
  doneBtn:     { fontSize: 16, color: Colors.orange, fontWeight: '600' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:      { flex: 1 },
  scrollContent: { padding: 16 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.black, marginBottom: 10 },
  emptyText:    { fontSize: 13, color: Colors.grey, marginBottom: 8 },

  card: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 16, marginBottom: 12, gap: 5,
  },
  cardDispute:  { borderColor: Colors.danger, borderWidth: 1.5 },
  disputeBadge: { fontSize: 11, fontWeight: '800', color: Colors.danger, letterSpacing: 0.5 },

  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardVenueName:{ fontSize: 16, fontWeight: '700', color: Colors.black, flex: 1 },

  typeBadge:     { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  typeBadgeNew:  { backgroundColor: 'rgba(250,131,12,0.12)' },
  typeBadgeClaim:{ backgroundColor: 'rgba(17,17,17,0.07)' },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.orange },

  cardEmail:   { fontSize: 13, color: Colors.grey },
  cardDate:    { fontSize: 12, color: Colors.greyLight },

  contactRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  contactBadge:     { backgroundColor: '#e8f4f8', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  contactBadgeText: { fontSize: 10, fontWeight: '800', color: '#0277bd', letterSpacing: 0.5 },
  contactValue:     { fontSize: 13, fontWeight: '600', color: Colors.black },
  manualBadge:      { fontSize: 11, fontWeight: '800', color: '#b45309', marginTop: 2 },
  notes:            { fontSize: 12, color: Colors.grey, fontStyle: 'italic' },

  codeBox: {
    backgroundColor: '#f0faf4', borderRadius: 10, borderWidth: 1, borderColor: '#a7d7b8',
    padding: 14, marginTop: 10, alignItems: 'center', gap: 4,
  },
  codeBoxAmber:     { backgroundColor: '#fffbeb', borderColor: '#d97706' },
  codeBoxAmberText: { fontSize: 13, color: '#92400e', textAlign: 'center' },
  codeLabel:        { fontSize: 12, color: Colors.grey, textAlign: 'center' },
  codeValue:        { fontSize: 36, fontWeight: '800', color: Colors.black, letterSpacing: 10, marginVertical: 4 },
  codeExpiry:       { fontSize: 11, color: Colors.grey },

  actionRow:       { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn:       { flex: 1, borderRadius: 8, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  actionBtnPrimary:{ backgroundColor: Colors.orange, borderColor: Colors.orange },
  actionBtnDanger: { backgroundColor: '#fff', borderColor: Colors.danger },
  actionBtnDim:    { opacity: 0.5 },
  actionBtnText:   { fontSize: 14, fontWeight: '700', color: '#fff' },

  manualMoveBtn:    { paddingVertical: 10, alignItems: 'center' },
  manualMoveBtnText:{ fontSize: 13, color: Colors.grey, fontWeight: '600' },

  addVenueToggle:     { backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  addVenueToggleText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  addVenueForm:      { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 14, gap: 4 },
  addVenueFormTitle: { fontSize: 16, fontWeight: '700', color: Colors.black, marginBottom: 8 },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.grey, marginTop: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.black, backgroundColor: '#fafafa',
  },
  inputError:    { borderColor: Colors.danger },
  rowFields:     { flexDirection: 'row', gap: 10 },
  errorText:     { fontSize: 13, color: Colors.danger, marginTop: 6 },

  addVenueSubmit:     { backgroundColor: Colors.black, borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  addVenueSubmitText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  divider: { height: 1, backgroundColor: Colors.border, marginBottom: 20 },
});
