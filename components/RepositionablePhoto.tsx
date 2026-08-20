/**
 * RepositionablePhoto
 *
 * Shows a photo with drag-to-reposition.  Works on both web (PanResponder
 * maps to mouse events via react-native-web) and native (touch events).
 *
 * The image is rendered at cover-fit size so the user can pan through the
 * entire photo to choose the focal point.
 * Position is stored as { x: 0-100, y: 0-100 }.
 *
 * When no photo exists yet, the whole tile is tappable to add one.
 */

import { useRef, useState, useEffect } from 'react';
import {
  View, StyleSheet, PanResponder, Animated,
  TouchableOpacity, LayoutChangeEvent, Image,
} from 'react-native';
import { Text }   from '@/components/Text';
import { Colors } from '@/constants/colors';

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
  const repoRef = useRef(false);

  // Container width: ref for PanResponder (avoids stale closures), state to trigger renders
  const [cw, setCw] = useState(300);
  const cwRef = useRef(300);

  // Natural image dimensions: ref for PanResponder, state to trigger renders
  const nwRef = useRef(0);
  const nhRef = useRef(0);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });

  // Animated translation values (negative = shifted left/up)
  const tx      = useRef(new Animated.Value(0)).current;
  const ty      = useRef(new Animated.Value(0)).current;
  const txCur   = useRef(0);
  const tyCur   = useRef(0);
  const txStart = useRef(0);
  const tyStart = useRef(0);

  // ── Pan bounds: how far the image can travel (always positive px) ──
  function getPanBounds(w: number, nW: number, nH: number) {
    if (!nW || !nH || !w) return { maxTx: 0, maxTy: 0 };
    const scale = Math.max(w / nW, height / nH);
    return {
      maxTx: Math.max(0, nW * scale - w),
      maxTy: Math.max(0, nH * scale - height),
    };
  }

  function applyPosition(pos: PhotoPosition, w: number, nW: number, nH: number) {
    const { maxTx, maxTy } = getPanBounds(w, nW, nH);
    const newTx = -(pos.x / 100) * maxTx;
    const newTy = -(pos.y / 100) * maxTy;
    txCur.current = newTx;
    tyCur.current = newTy;
    tx.setValue(newTx);
    ty.setValue(newTy);
  }

  // Load natural image size when URI changes
  useEffect(() => {
    if (!uri) {
      nwRef.current = 0; nhRef.current = 0;
      setImgDims({ w: 0, h: 0 });
      return;
    }
    Image.getSize(uri, (w, h) => {
      nwRef.current = w; nhRef.current = h;
      setImgDims({ w, h });
      applyPosition(position, cwRef.current, w, h);
    }, () => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Sync when position prop changes (e.g. loaded from Firestore)
  useEffect(() => {
    applyPosition(position, cwRef.current, nwRef.current, nhRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.x, position.y]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    cwRef.current = w;
    setCw(w);
    applyPosition(position, w, nwRef.current, nhRef.current);
  };

  // ── PanResponder — all values accessed via refs, no stale closures ──
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => repoRef.current,
      onMoveShouldSetPanResponder:  () => repoRef.current,
      onPanResponderGrant: () => {
        txStart.current = txCur.current;
        tyStart.current = tyCur.current;
      },
      onPanResponderMove: (_, { dx, dy }) => {
        const { maxTx, maxTy } = getPanBounds(cwRef.current, nwRef.current, nhRef.current);
        const newTx = clamp(txStart.current + dx, -maxTx, 0);
        const newTy = clamp(tyStart.current + dy, -maxTy, 0);
        txCur.current = newTx;
        tyCur.current = newTy;
        tx.setValue(newTx);
        ty.setValue(newTy);
      },
      onPanResponderRelease: () => {
        const { maxTx, maxTy } = getPanBounds(cwRef.current, nwRef.current, nhRef.current);
        onPositionChange({
          x: maxTx ? clamp((-txCur.current / maxTx) * 100, 0, 100) : 50,
          y: maxTy ? clamp((-tyCur.current / maxTy) * 100, 0, 100) : 50,
        });
      },
    })
  ).current;

  function enterReposition() { repoRef.current = true;  setRepositioning(true); }
  function exitReposition()  { repoRef.current = false; setRepositioning(false); }

  // Cover-fit display dimensions for render
  const coverScale = (imgDims.w && imgDims.h && cw)
    ? Math.max(cw / imgDims.w, height / imgDims.h)
    : 1.6;
  const displayW = imgDims.w ? imgDims.w * coverScale : cw * 1.6;
  const displayH = imgDims.h ? imgDims.h * coverScale : height * 1.6;

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
                width:  displayW,
                height: displayH,
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
  dragOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    cursor: 'grab' as any,
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
