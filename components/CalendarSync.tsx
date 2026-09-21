/**
 * CalendarSync — "Calendar sync" settings section.
 *
 * Shows the user's personal ICS feed URL, subscribe buttons for Google /
 * Apple / Outlook, and a "Reset link" flow.
 *
 * Drop this into the Settings tab of edit-profile.tsx and edit-venue.tsx.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Linking, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { getOrCreateCalendarFeed, rotateCalendarFeed } from '@/lib/useCalendarFeed';

// ── Clipboard helper ──────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    await navigator.clipboard.writeText(text);
  } else {
    // Native: use the Share sheet — user can tap "Copy" from there.
    // React Native's built-in Share API requires no extra dependency.
    const { Share } = await import('react-native');
    await Share.share({ message: text, url: text });
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CalendarSync() {
  const { colors } = useTheme();
  const { user }   = useAuth();

  const [feedUrl,       setFeedUrl]       = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);
  const [resetting,     setResetting]     = useState(false);
  const [confirmReset,  setConfirmReset]  = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const url = await getOrCreateCalendarFeed();
      setFeedUrl(url);
    } catch {
      setError('Could not load your calendar link. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function handleCopy() {
    if (!feedUrl) return;
    try {
      await copyToClipboard(feedUrl);
      if (Platform.OS === 'web') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setError('Could not copy. Try long-pressing the URL field and choosing Copy.');
    }
  }

  function handleOpenWebcal() {
    if (!feedUrl) return;
    const webcal = feedUrl.replace(/^https?:\/\//, 'webcal://');
    Linking.openURL(webcal);
  }

  async function handleReset() {
    setResetting(true);
    setError(null);
    setConfirmReset(false);
    try {
      const url = await rotateCalendarFeed();
      setFeedUrl(url);
    } catch {
      setError('Reset failed. Check your connection and try again.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <View style={[cs.section, { borderTopColor: colors.borderFaint }]}>
      <Text style={[cs.sectionTitle, { color: colors.black }]}>Calendar sync</Text>

      <Text style={[cs.explainer, { color: colors.grey }]}>
        Subscribe to your Twaylo gigs in Google, Apple or Outlook Calendar.
        Updates flow one way, from Twaylo to your calendar, and can take a
        few hours to appear depending on your app.
      </Text>

      {error ? (
        <View style={[cs.errorBanner, { borderColor: Colors.danger + '44' }]}>
          <Text style={cs.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator size="small" color={Colors.orange} style={{ marginTop: 12 }} />
      ) : feedUrl ? (
        <>
          {/* URL field — selectable on all platforms for manual copy */}
          <TextInput
            style={[cs.urlField, { color: colors.grey, backgroundColor: colors.bgFaint, borderColor: colors.border }]}
            value={feedUrl}
            editable={false}
            selectTextOnFocus
            multiline={false}
          />

          {/* Subscribe buttons */}
          <View style={cs.btnGroup}>
            <TouchableOpacity
              style={[cs.actionBtn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
              onPress={handleOpenWebcal}
            >
              <Text style={[cs.actionBtnText, { color: colors.black }]}>
                Open in Apple or Outlook Calendar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[cs.actionBtn, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
              onPress={handleCopy}
            >
              <Text style={[cs.actionBtnText, {
                color: (copied && Platform.OS === 'web') ? Colors.orange : colors.black,
              }]}>
                {(copied && Platform.OS === 'web') ? 'Copied!' : 'Copy link'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Google Calendar instructions */}
          <View style={[cs.googleBox, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
            <Text style={[cs.googleTitle, { color: colors.grey }]}>FOR GOOGLE CALENDAR</Text>
            <Text style={[cs.googleBody, { color: colors.black }]}>
              Open Google Calendar on desktop. Next to{' '}
              <Text style={{ fontWeight: '700' }}>Other calendars</Text>, click{' '}
              <Text style={{ fontWeight: '700' }}>+</Text>, choose{' '}
              <Text style={{ fontWeight: '700' }}>From URL</Text>, and paste your link.
            </Text>
          </View>

          {/* Reset link */}
          {confirmReset ? (
            <View style={cs.confirmRow}>
              <Text style={[cs.confirmText, { color: colors.grey }]}>
                The old link will stop working immediately.
              </Text>
              <View style={cs.confirmBtns}>
                <TouchableOpacity onPress={() => setConfirmReset(false)}>
                  <Text style={[cs.confirmCancel, { color: colors.grey }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cs.confirmResetBtn, { borderColor: Colors.danger + '66' }]}
                  onPress={handleReset}
                  disabled={resetting}
                >
                  {resetting
                    ? <ActivityIndicator size="small" color={Colors.danger} />
                    : <Text style={cs.confirmResetBtnText}>Reset link</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={cs.resetTrigger}
              onPress={() => setConfirmReset(true)}
            >
              <Text style={[cs.resetTriggerText, { color: Colors.danger }]}>Reset link</Text>
            </TouchableOpacity>
          )}
        </>
      ) : null}
    </View>
  );
}

const cs = StyleSheet.create({
  section: {
    borderTopWidth: 1,
    paddingTop: 24,
    marginTop: 8,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  explainer: {
    fontSize: 13,
    lineHeight: 19,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    backgroundColor: 'rgba(220,38,38,0.04)',
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
  },
  urlField: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  btnGroup: {
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  googleBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  googleTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  googleBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  resetTrigger: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    marginTop: 4,
  },
  resetTriggerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmRow: {
    gap: 8,
    marginTop: 4,
  },
  confirmText: {
    fontSize: 13,
  },
  confirmBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  confirmCancel: {
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 4,
  },
  confirmResetBtn: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 90,
    alignItems: 'center',
  },
  confirmResetBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },
});
