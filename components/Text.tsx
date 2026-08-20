import { Text as RNText, TextProps, StyleSheet, Platform } from 'react-native';

// Maps React Native fontWeight to bundled Satoshi font files (native only).
// On web, the browser uses the CSS fontWeight with the Satoshi CDN stylesheet.
const WEIGHT_TO_FONT: Record<string, string> = {
  '100': 'Satoshi-Regular',
  '200': 'Satoshi-Regular',
  '300': 'Satoshi-Regular',
  '400': 'Satoshi-Regular',
  'normal': 'Satoshi-Regular',
  '500': 'Satoshi-Medium',
  '600': 'Satoshi-Bold',
  '700': 'Satoshi-Bold',
  'bold': 'Satoshi-Bold',
  '800': 'Satoshi-Black',
  '900': 'Satoshi-Black',
};

export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const weight = String(flat.fontWeight ?? '400');

  const fontFamily = Platform.OS === 'web'
    ? 'Satoshi, -apple-system, BlinkMacSystemFont, sans-serif'
    : (WEIGHT_TO_FONT[weight] ?? 'Satoshi-Regular');

  return <RNText style={[{ fontFamily }, style]} {...props} />;
}
