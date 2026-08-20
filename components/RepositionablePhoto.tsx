/**
 * RepositionablePhoto
 *
 * Shows a photo with drag-to-reposition.  Works on both web (PanResponder
 * maps to mouse events via react-native-web) and native (touch events).
 *
 * The image is rendered at SCALE × the container size so the user can pan
 * to choose the focal point.  Position is stored as { x: 0-100, y: 0-100 }.
 *
 * When no photo exists yet, the whole tile is tappable to add one.
 */

import { useRef, useState, useEffect } from 'react';
import {
  View, StyleSheet, PanResponder, Animated,
  TouchableOpacity, LayoutChangeEvent,
} from 'react-native';
import { Text }   from '@/components/Text';
import { Colors } from '@/constants/colors';

// Image is rendered SCALE× larger than the container → allows (SCALE-1)×100%
// of panning room in each axis.
const SCALE = 1.6;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export interface PhotoPosition { x: number; y: number }

interface Props {
  uri:              string | null;
  position:         PhotoPosition;
  onPositionChange: (pos: PhotoPosition) => void;
  onChangePhoto:    () => void;
  height?:          number;
  uploading?:       boolean;
  placeholderText?: string;
}

export function RepositionablePhoto({
  uri, position, onPositionChange, onChangePhoto,
  height = 220, uploading = false,
  placeholderText = 'Tap to add photo',
}: Props) {
  const [repositioning, setRepositioning] = useState(false);
  const repoRef    = useRef(false);
  const containerW = useRef(300);

  // Animated translation values (in px, negative = shifted left/up)
  const tx    = useRef(new Animated.Value(0)).current;
  const ty    = useRef(new Animated.Value(0)).current;
  const txCur = useRef(0);
  const tyCur = useRef(0);
  const txStart = useRef(0);
  const tyStart = useRef(0);

  // ── position ↔ translation helpers ────────────────────────────────
  function posToTx(x: number, w: number) { return -(x / 100) * (SCALE - 1) * w; }
  function posToTy(y: number)             { return -(y / 100) * (SCALE - 1) * height; }

  function txToX(t: number, w: number): number {
    if (!w) return 50;
    return clamp((-t / ((SCALE - 1) * w)) * 100, 0, 100);
  }
  function tyToY(t: number): number {
    return clamp((-t / ((SCALE - 1) * height)) * 100, 0, 100);
  }

  function applyPosition(pos: PhotoPosition, w: number) {
    const newTx = posToTx(pos.x, w);
    const newTy = posToTy(pos.y);
    txCur.current = newTx;
    tyCur.current = newTy;
    tx.setValue(newTx);
    ty.setValue(newTy);
  }

  // Sync when position prop changes (e.g. loaded from Firestore)
  useEffect(() => {
    applyPosition(position, containerW.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.x, position.y]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    containerW.current = w;
    applyPosition(position, w);
  };

  // ── PanResponder (works on native via touch, on web via mouse) ────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => repoRef.current,
      onMoveShouldSetPanResponder:  () => repoRef.current,
      onPanResponderGrant: () => {
        txStart.current = txCur.current;
        tyStart.current = tyCur.current;
      },
      onPanResponderMove: (_, { dx, dy }) => {
        const w     = containerW.current;
        const maxTx = (SCALE - 1) * w;
        const maxTy = (SCALE - 1) * height;
        const newTx = clamp(txStart.current + dx, -maxTx, 0);
        const newTy = clamp(tyStart.current + dy, -maxTy, 0);
        txCur.current = newTx;
        tyCur.current = newTy;
        tx.setValue(newTx);
        ty.setValue(newTy);
      },
      onPanResponderRelease: () => {
        onPositionChange({
          x: txToX(txCur.current, containerW.current),
          y: tyToY(tyCur.current),
        });
      },
    })
  ).current;

  function enterReposition() { repoRef.current = true;  setRepositioning(true); }
  function exitReposition()  { repoRef.current = false; setRepositioning(false); }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <View>
      {/* Image tile */}
      <View
        style={[styles.container, { height }, repositioning && styles.containerActive]}
        onLayout={onLayout}
      >
        {uri ? (
          <Animated.Image
            source={{ uri }}
            style={[
              styles.img,
              {
                width:  `${SCALE * 100}%` as any,
                height: SCALE * height,
                transform: [{ translateX: tx }, { translateY: ty }],
              },
            ]}
            resizeMode="cover"
          />
        ) : (
          /* No photo yet — tappable placeholder */
          <TouchableOpacity style={styles.placeholder} onPress={onChangePhoto} activeOpacity={0.7}>
            <Text style={styles.placeholderText}>
              {uploading ? 'Uploading…' : placeholderText}
            </Text>
          </TouchableOpacity>
        )}

        {/* Transparent overlay captures drag events when repositioning,
            preventing the browser from triggering native image drag */}
        {uri && repositioning && (
          <View style={styles.dragOverlay} {...panResponder.panHandlers} />
        )}

        {repositioning && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>Drag to reposition</Text>
          </View>
        )}
      </View>

      {/* Action row — only shown when photo exists */}
      {uri ? (
        <View style={styles.actions}>
          {!repositioning ? (
            <>
              <TouchableOpacity style={styles.actionBtn} onPress={onChangePhoto} disabled={uploading}>
                <Text style={styles.actionBtnText}>{uploading ? 'Uploading…' : 'Change photo'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={enterReposition}>
                <Text style={styles.actionBtnText}>Reposition</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDone]} onPress={exitReposition}>
              <Text style={[styles.actionBtnText, { color: '#fff' }]}>Done repositioning</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Colors.bgFaint,
  },
  containerActive: {
    borderWidth: 2,
    borderColor: Colors.orange,
  },
  img: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: Colors.greyLight,
  },
  dragOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    cursor: 'grab' as any,
  },
  hint: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    pointerEvents: 'none' as any,
  },
  hintText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  actionBtnDone: {
    backgroundColor: Colors.orange,
    borderColor:     Colors.orange,
  },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: Colors.grey },
});
