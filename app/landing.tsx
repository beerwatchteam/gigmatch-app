import { Redirect } from 'expo-router';

// Native has no marketing landing page — go straight to the app.
export default function LandingFallback() {
  return <Redirect href="/(tabs)" />;
}
