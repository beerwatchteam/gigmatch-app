import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';

export default function DiscoverScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={s.center}>
        <Text style={[s.label, { color: Colors.orange }]}>DISCOVER</Text>
        <Text style={[s.title, { color: colors.black }]}>Coming Soon</Text>
        <Text style={[s.sub, { color: colors.grey }]}>
          We're building something new here. Check back soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  label:  { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  title:  { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12, textAlign: 'center' },
  sub:    { fontSize: 15, lineHeight: 24, textAlign: 'center' },
});
