import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Request push permission, get the Expo push token, and save it to Firestore.
 * Called once after login when the user profile is known.
 * Safe to call multiple times — just updates the token if it changed.
 */
export async function registerForPushNotifications(
  uid: string,
  profile: { type: string; venueId?: string },
): Promise<void> {
  if (Platform.OS === 'web') return;

  // Expo push tokens only work on physical devices
  if (!Device.isDevice) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f97316',
    });
  }

  // Save token to the Firestore doc that the Cloud Functions already read
  try {
    if (profile.type === 'venue' && profile.venueId) {
      await updateDoc(doc(db, 'venues', profile.venueId), { expoPushToken: token });
    } else if (profile.type === 'artist') {
      await updateDoc(doc(db, 'bandProfiles', uid), { expoPushToken: token });
    }
  } catch {
    // Non-fatal — the user can still receive emails
  }
}
