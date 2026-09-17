import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Text';
import { searchSuburbs, AreaResult } from '@/lib/suburbSearch';
import { useTheme } from '@/lib/theme-context';
import { Colors } from '@/constants/colors';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onAutofill?: (suburb: string, state: string, postcode: string) => void;
  error?: boolean;
};

export default function SuburbSearch({ value, onChange, onAutofill, error }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AreaResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  function handleChange(text: string) {
    setQuery(text);
    onChange(text);
    if (text.length >= 1) {
      const found = searchSuburbs(text, 7);
      setResults(found);
      setOpen(found.length > 0);
    } else {
      setResults([]);
      setOpen(false);
    }
  }

  function select(r: AreaResult) {
    const parts = r.label.split(', ');
    const suburb = parts[0] || r.label;
    const state = parts[1] || '';
    const postcode = parts[2] || '';
    setQuery(suburb);
    onChange(suburb);
    if (onAutofill) onAutofill(suburb, state, postcode);
    setResults([]);
    setOpen(false);
  }

  return (
    <View>
      <TextInput
        style={[
          s.input,
          {
            backgroundColor: colors.bgFaint,
            borderColor: error ? Colors.danger : colors.border,
            color: colors.black,
          },
        ]}
        value={query}
        onChangeText={handleChange}
        placeholder="Suburb"
        placeholderTextColor={Colors.greyLight}
        autoCapitalize="words"
      />
      {open && (
        <View style={[s.dropdown, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          {results.map((r, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => select(r)}
              style={[
                s.dropdownItem,
                i < results.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderFaint },
              ]}
            >
              <Text style={{ fontSize: 14, color: colors.black }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
    zIndex: 999,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
