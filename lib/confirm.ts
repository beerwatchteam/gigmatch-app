import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirm dialog.
 * Uses window.confirm on web and Alert.alert on native.
 * The confirm button label defaults to "Confirm" or "Delete" when destructive.
 */
export function crossConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  destructive = false,
): void {
  if (Platform.OS === 'web') {
    if ((window as any).confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: destructive ? 'Delete' : 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: onConfirm,
      },
    ]);
  }
}
