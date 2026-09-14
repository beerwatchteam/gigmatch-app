import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { Text } from '@/components/Text';
import { Colors } from '@/constants/colors';

interface ToastProps {
  visible: boolean;
  message: string;
  onUndo?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss duration in ms (default 4000) */
  duration?: number;
}

export function Toast({ visible, message, onUndo, onDismiss, duration = 4000 }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        dismiss();
      }, duration);
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible]);

  function dismiss() {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => onDismiss());
  }

  function handleUndo() {
    dismiss();
    onUndo?.();
  }

  if (!visible) return null;

  return (
    <Animated.View style={[s.container, { opacity }]} pointerEvents="box-none">
      <View style={s.toast}>
        <Text style={s.message} numberOfLines={1}>{message}</Text>
        {onUndo && (
          <TouchableOpacity onPress={handleUndo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.undo}>Undo</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 24 : 16,
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 9999,
    pointerEvents: 'box-none',
  } as any,
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 14,
    maxWidth: 400,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
  undo: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.orange,
    flexShrink: 0,
  },
});
