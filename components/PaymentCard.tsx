/**
 * PaymentCard
 *
 * Shown on:
 *  - The inbox details panel for Twaylo bookings
 *  - The gig detail row in My Gigs for all gigs
 *
 * The card only appears for confirmed gigs where payment.status is not 'not_applicable'.
 * All writes go through Cloud Function callables. The client never touches payment fields directly.
 */

import { useState } from 'react';
import {
  View, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '@/lib/firebase';
import { Text } from '@/components/Text';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import { type Gig, type PaymentTiming } from '@/lib/gig-types';
import {
  paymentExpectation, isPaymentActive, formatAud,
} from '@/lib/payments';
import { dollarsToCents } from '@/lib/gig-types';

const functions = getFunctions(app, 'australia-southeast1');

// ── Props ─────────────────────────────────────────────────────────────────────

interface PaymentCardProps {
  gig: Gig & { id: string };
  /** The current viewer's uid */
  uid: string;
  /** Whether this viewer is the venue side */
  isVenue: boolean;
  /** Name of the other party (for "waiting for X") */
  otherPartyName: string;
  /** Called when viewer taps "Open thread" */
  onOpenThread?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) return navigator.onLine;
  return true;
}

function formatDate(ts: { toDate(): Date } | null): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentCard({ gig, uid, isVenue, otherPartyName, onOpenThread }: PaymentCardProps) {
  const { colors } = useTheme();
  const payment    = gig.payment;
  const status     = payment?.status;

  // Don't render if payment doesn't apply or gig isn't confirmed
  if (!payment || status === 'not_applicable') return null;
  if (gig.status !== 'confirmed' && gig.status !== 'cancelled') return null;

  // Cancelled gig with confirmed payment
  if (gig.status === 'cancelled' && status === 'confirmed') {
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          Payment was confirmed ({formatAud(payment.confirmedAmountCents ?? 0)}).
          Twaylo doesn't handle refunds.
        </Text>
      </View>
    );
  }

  if (gig.status !== 'confirmed') return null;

  return <ActivePaymentCard
    gig={gig}
    uid={uid}
    isVenue={isVenue}
    otherPartyName={otherPartyName}
    onOpenThread={onOpenThread}
    colors={colors}
  />;
}

// ── ActivePaymentCard (confirmed gigs) ────────────────────────────────────────

function ActivePaymentCard({
  gig, uid, isVenue, otherPartyName, onOpenThread, colors,
}: PaymentCardProps & { colors: ReturnType<typeof useTheme>['colors'] }) {
  const payment     = gig.payment;
  const status      = payment.status;
  const expectation = paymentExpectation(gig.fee);
  const active      = isPaymentActive(gig, new Date());
  const isTwoParty  = gig.participantIds.length > 1;

  const myConfirm    = isVenue ? payment.venueConfirm  : payment.artistConfirm;
  const theirConfirm = isVenue ? payment.artistConfirm : payment.venueConfirm;
  const proposal     = payment.timingProposal;

  const [amountInput,    setAmountInput]    = useState('');
  const [error,          setError]          = useState<string | null>(null);
  const [loading,        setLoading]        = useState(false);

  async function call<T>(name: string, data: object): Promise<T> {
    if (!isOnline()) {
      throw new Error("You're offline, try again when connected.");
    }
    const fn = httpsCallable<object, T>(functions, name);
    const res = await fn(data);
    return res.data;
  }

  async function handleConfirm(cents?: number) {
    setError(null);
    const resolvedCents = cents ?? dollarsToCents(amountInput);
    if (!resolvedCents || resolvedCents <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setLoading(true);
    try {
      await call('confirmPayment', { gigId: gig.id, amountCents: resolvedCents });
      setAmountInput('');
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRetract() {
    setError(null);
    setLoading(true);
    try {
      await call('retractPaymentConfirmation', { gigId: gig.id });
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleProposeTiming(timing: PaymentTiming) {
    setError(null);
    setLoading(true);
    try {
      await call('proposePaymentTiming', { gigId: gig.id, timing });
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRespondTiming(accept: boolean) {
    setError(null);
    setLoading(true);
    try {
      await call('respondPaymentTiming', { gigId: gig.id, accept });
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const expectedStr = expectation.expectedCents != null
    ? formatAud(expectation.expectedCents) + (expectation.isMinimum ? ' min.' : '')
    : null;

  // ── Timing proposal open ─────────────────────────────────────────────────
  if (proposal) {
    const isProposer = proposal.proposedBy === uid;
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT TIMING</Text>
        <Text style={[card.body, { color: colors.black }]}>
          {isProposer
            ? `You proposed paying ${proposal.timing} the gig. Waiting for ${otherPartyName} to respond.`
            : `${otherPartyName} proposed paying ${proposal.timing} the gig.`}
        </Text>
        {error && <Text style={card.error}>{error}</Text>}
        <View style={card.row}>
          {isProposer ? (
            <Btn label="Cancel proposal" onPress={() => handleRespondTiming(false)} loading={loading} variant="ghost" colors={colors} />
          ) : (
            <>
              <Btn label="Accept" onPress={() => handleRespondTiming(true)}  loading={loading} variant="primary" colors={colors} />
              <Btn label="Decline" onPress={() => handleRespondTiming(false)} loading={loading} variant="ghost"   colors={colors} />
            </>
          )}
        </View>
      </View>
    );
  }

  // ── Not yet active (timing 'after', gig hasn't ended) ───────────────────
  if (!active && isTwoParty) {
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          Payment due after the gig{expectedStr ? ` · ${expectedStr}` : ''}
        </Text>
        {error && <Text style={card.error}>{error}</Text>}
        {!myConfirm && (
          <Btn
            label="Change timing"
            onPress={() => handleProposeTiming('before')}
            loading={loading}
            variant="ghost"
            colors={colors}
          />
        )}
      </View>
    );
  }

  // ── Confirmed ────────────────────────────────────────────────────────────
  if (status === 'confirmed') {
    return (
      <View style={[card.wrap, card.confirmed, { borderColor: '#16a34a40' }]}>
        <Text style={[card.label, { color: '#16a34a' }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          Payment confirmed{payment.confirmedAmountCents != null ? ` · ${formatAud(payment.confirmedAmountCents)}` : ''}
          {payment.confirmedAt ? ` · ${formatDate(payment.confirmedAt)}` : ''}
        </Text>
      </View>
    );
  }

  // ── Self-reported ────────────────────────────────────────────────────────
  if (status === 'self_reported') {
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          Marked paid by you{payment.confirmedAmountCents != null ? ` · ${formatAud(payment.confirmedAmountCents)} (self-reported)` : ' (self-reported)'}
        </Text>
        {error && <Text style={card.error}>{error}</Text>}
        <Btn label="Undo" onPress={handleRetract} loading={loading} variant="ghost" colors={colors} />
      </View>
    );
  }

  // ── Disputed ─────────────────────────────────────────────────────────────
  if (status === 'disputed') {
    const venueCents  = payment.venueConfirm?.amountCents;
    const artistCents = payment.artistConfirm?.amountCents;
    return (
      <View style={[card.wrap, card.disputed, { borderColor: '#d97706' }]}>
        <Text style={[card.label, { color: '#d97706' }]}>PAYMENT — AMOUNTS DON'T MATCH</Text>
        <View style={{ gap: 4, marginBottom: 10 }}>
          {venueCents  != null && <Text style={[card.body, { color: colors.black }]}>Venue: {formatAud(venueCents)}</Text>}
          {artistCents != null && <Text style={[card.body, { color: colors.black }]}>Artist: {formatAud(artistCents)}</Text>}
        </View>
        {error && <Text style={card.error}>{error}</Text>}
        <View style={card.row}>
          {myConfirm && (
            <Btn
              label={`Update my amount`}
              onPress={() => {
                const current = myConfirm.amountCents / 100;
                setAmountInput(Number.isInteger(current) ? String(current) : current.toFixed(2));
              }}
              loading={false}
              variant="ghost"
              colors={colors}
            />
          )}
          {onOpenThread && (
            <Btn label="Open thread" onPress={onOpenThread} loading={false} variant="ghost" colors={colors} />
          )}
        </View>
        {/* Inline amount update input (shown when "Update my amount" tapped) */}
        {amountInput !== '' && (
          <View style={[card.amountRow, { marginTop: 10 }]}>
            <View style={[card.amountInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[card.dollarSign, { color: colors.black }]}>$</Text>
              <TextInput
                style={[card.amountInput, { color: colors.black }]}
                value={amountInput}
                onChangeText={setAmountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.greyLight}
              />
            </View>
            <Btn label="Confirm" onPress={() => handleConfirm()} loading={loading} variant="primary" colors={colors} />
          </View>
        )}
      </View>
    );
  }

  // ── Pending — you confirmed, waiting for them ────────────────────────────
  if (myConfirm && !theirConfirm && isTwoParty) {
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          You confirmed {formatAud(myConfirm.amountCents)} · waiting for {otherPartyName}
        </Text>
        {error && <Text style={card.error}>{error}</Text>}
        <Btn label="Undo" onPress={handleRetract} loading={loading} variant="ghost" colors={colors} />
      </View>
    );
  }

  // ── Pending — they confirmed, you haven't ───────────────────────────────
  if (!myConfirm && theirConfirm && isTwoParty) {
    const theirCents = theirConfirm.amountCents;
    return (
      <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
        <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
        <Text style={[card.body, { color: colors.black }]}>
          {otherPartyName} confirmed {formatAud(theirCents)}
        </Text>
        {expectation.mode === 'variable' ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <View style={[card.amountRow]}>
              <View style={[card.amountInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[card.dollarSign, { color: colors.black }]}>$</Text>
                <TextInput
                  style={[card.amountInput, { color: colors.black }]}
                  value={amountInput}
                  onChangeText={setAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.greyLight}
                />
              </View>
              <Btn label="Confirm" onPress={() => handleConfirm()} loading={loading} variant="primary" colors={colors} />
            </View>
            {error && <Text style={card.error}>{error}</Text>}
            <Btn
              label="Amount differs"
              onPress={() => {
                const oc = theirCents / 100;
                setAmountInput(Number.isInteger(oc) ? String(oc) : oc.toFixed(2));
              }}
              loading={false}
              variant="ghost"
              colors={colors}
            />
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: 8 }}>
            {error && <Text style={card.error}>{error}</Text>}
            <View style={card.row}>
              <Btn
                label={`Confirm ${formatAud(theirCents)}`}
                onPress={() => handleConfirm(theirCents)}
                loading={loading}
                variant="primary"
                colors={colors}
              />
              <Btn
                label="Amount differs"
                onPress={() => {
                  const oc = theirCents / 100;
                  setAmountInput(Number.isInteger(oc) ? String(oc) : oc.toFixed(2));
                }}
                loading={false}
                variant="ghost"
                colors={colors}
              />
            </View>
            {amountInput !== '' && (
              <View style={card.amountRow}>
                <View style={[card.amountInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Text style={[card.dollarSign, { color: colors.black }]}>$</Text>
                  <TextInput
                    style={[card.amountInput, { color: colors.black }]}
                    value={amountInput}
                    onChangeText={setAmountInput}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={Colors.greyLight}
                  />
                </View>
                <Btn label="Confirm" onPress={() => handleConfirm()} loading={loading} variant="primary" colors={colors} />
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  // ── Pending — nothing confirmed yet ─────────────────────────────────────
  const verb = isVenue ? "Confirm I've paid" : "Confirm I've received";

  return (
    <View style={[card.wrap, { backgroundColor: colors.bgFaint, borderColor: colors.border }]}>
      <Text style={[card.label, { color: colors.grey }]}>PAYMENT</Text>
      {expectedStr && (
        <Text style={[card.body, { color: colors.black }]}>
          {expectedStr}{payment.timing ? ` · Pay ${payment.timing} the gig` : ''}
        </Text>
      )}
      {expectation.mode === 'variable' ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <View style={card.amountRow}>
            <View style={[card.amountInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[card.dollarSign, { color: colors.black }]}>$</Text>
              <TextInput
                style={[card.amountInput, { color: colors.black }]}
                value={amountInput}
                onChangeText={setAmountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.greyLight}
              />
            </View>
            <Btn label="Confirm" onPress={() => handleConfirm()} loading={loading} variant="primary" colors={colors} />
          </View>
          {error && <Text style={card.error}>{error}</Text>}
        </View>
      ) : expectation.expectedCents != null ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          {error && <Text style={card.error}>{error}</Text>}
          <View style={card.row}>
            <Btn
              label={`${verb} ${formatAud(expectation.expectedCents)}`}
              onPress={() => handleConfirm(expectation.expectedCents!)}
              loading={loading}
              variant="primary"
              colors={colors}
            />
            <Btn
              label="Amount differs"
              onPress={() => {
                const d = expectation.expectedCents! / 100;
                setAmountInput(Number.isInteger(d) ? String(d) : d.toFixed(2));
              }}
              loading={false}
              variant="ghost"
              colors={colors}
            />
          </View>
          {amountInput !== '' && (
            <View style={card.amountRow}>
              <View style={[card.amountInputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[card.dollarSign, { color: colors.black }]}>$</Text>
                <TextInput
                  style={[card.amountInput, { color: colors.black }]}
                  value={amountInput}
                  onChangeText={setAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.greyLight}
                />
              </View>
              <Btn label="Confirm" onPress={() => handleConfirm()} loading={loading} variant="primary" colors={colors} />
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          {error && <Text style={card.error}>{error}</Text>}
          <View style={card.row}>
            <Btn
              label={verb}
              onPress={() => handleConfirm()}
              loading={loading && !amountInput}
              variant="primary"
              colors={colors}
            />
          </View>
        </View>
      )}
      {/* Timing change proposal (two-party gigs, before any confirmation) */}
      {isTwoParty && !myConfirm && !theirConfirm && payment.timing != null && (
        <TouchableOpacity
          onPress={() => handleProposeTiming(payment.timing === 'after' ? 'before' : 'after')}
          style={{ marginTop: 8 }}
        >
          <Text style={{ fontSize: 12, color: colors.grey }}>
            Change timing (currently pay {payment.timing} the gig)
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Payment Due chip (for My Gigs rows) ───────────────────────────────────────

export function PaymentDueChip({ colors }: { colors: any }) {
  return (
    <View style={[chip.wrap, { backgroundColor: Colors.orange + '20', borderColor: Colors.orange + '60' }]}>
      <Text style={[chip.text, { color: Colors.orange }]}>Payment due</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, alignSelf: 'flex-start', marginTop: 4 },
  text: { fontSize: 11, fontWeight: '700' },
});

// ── Btn helper ────────────────────────────────────────────────────────────────

function Btn({
  label, onPress, loading, variant, colors,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  variant: 'primary' | 'ghost';
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={[
        btn.base,
        variant === 'primary'
          ? { backgroundColor: Colors.orange }
          : { borderWidth: 1, borderColor: colors.border },
      ]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}
    >
      {loading
        ? <ActivityIndicator size="small" color={variant === 'primary' ? '#111' : colors.grey} />
        : <Text style={[btn.text, { color: variant === 'primary' ? '#111111' : colors.black }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const btn = StyleSheet.create({
  base: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 13, fontWeight: '700' },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const card = StyleSheet.create({
  wrap: {
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 6, marginVertical: 8,
  },
  confirmed: { backgroundColor: 'rgba(22,163,74,0.05)' },
  disputed:  { backgroundColor: 'rgba(217,119,6,0.06)' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  body:  { fontSize: 14 },
  error: { fontSize: 12, color: '#dc2626' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amountRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  amountInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 8, paddingLeft: 10, height: 40,
  },
  dollarSign: { fontSize: 14, fontWeight: '600', marginRight: 2 },
  amountInput: { flex: 1, height: 40, fontSize: 14, paddingRight: 10 },
});
