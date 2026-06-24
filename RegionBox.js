// ===== REGION BOX =====
// A draggable, resizable rectangle drawn over an image.
// `box` is normalized (0 to 1) relative to the container size
// (containerWidth / containerHeight).
// Drag the body to move it, drag the corner circle to resize it.
//
// IMPORTANT: the PanResponder objects below are created ONCE (via useRef)
// and their handler functions are NOT re-created on every render. If those
// handlers read `box`, `containerWidth`, `containerHeight` or `onChange`
// directly from the closure, they would always see the values from the
// FIRST render (a "stale closure"), causing the box to jump back to its
// original position after the first drag. To avoid this, every value the
// handlers need is stored in a `latest` ref that is updated on every
// render, and the handlers always read from `latest.current`.

import React, { useRef } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';

const MIN_SIZE = 40; // smallest box size in pixels

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export default function RegionBox({
  label,
  color,
  box,
  containerWidth,
  containerHeight,
  onChange,
}) {
  const width = containerWidth || 0;
  const height = containerHeight || 0;

  // Current box in pixels, recalculated every render from normalized props
  const pixelBox = {
    x: box.x * width,
    y: box.y * height,
    width: box.width * width,
    height: box.height * height,
  };

  // Always-fresh snapshot of everything the gesture handlers need.
  // Updated on every render (plain assignment, not inside useRef),
  // so the handlers (created once below) always see current values.
  const latest = useRef({ pixelBox, width, height, onChange });
  latest.current = { pixelBox, width, height, onChange };

  // Snapshot of the box taken at the moment a drag/resize gesture starts
  const startBoxRef = useRef(pixelBox);

  // ----- Move the whole box -----
  const movePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startBoxRef.current = latest.current.pixelBox;
      },
      onPanResponderMove: (evt, gesture) => {
        const { width: w, height: h, onChange: change } = latest.current;
        if (!w || !h) return;

        const start = startBoxRef.current;

        const newX = clamp(start.x + gesture.dx, 0, w - start.width);
        const newY = clamp(start.y + gesture.dy, 0, h - start.height);

        change({
          x: newX / w,
          y: newY / h,
          width: start.width / w,
          height: start.height / h,
        });
      },
    })
  ).current;

  // ----- Resize from the bottom-right corner -----
  const resizePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startBoxRef.current = latest.current.pixelBox;
      },
      onPanResponderMove: (evt, gesture) => {
        const { width: w, height: h, onChange: change } = latest.current;
        if (!w || !h) return;

        const start = startBoxRef.current;

        const newWidth = clamp(start.width + gesture.dx, MIN_SIZE, w - start.x);
        const newHeight = clamp(start.height + gesture.dy, MIN_SIZE, h - start.y);

        change({
          x: start.x / w,
          y: start.y / h,
          width: newWidth / w,
          height: newHeight / h,
        });
      },
    })
  ).current;

  // All hooks above run unconditionally on every render (Rules of Hooks).
  // It is safe to bail out AFTER the hooks have been called.
  if (!width || !height) return null;

  return (
    <View
      {...movePanResponder.panHandlers}
      style={[
        styles.box,
        {
          left: pixelBox.x,
          top: pixelBox.y,
          width: pixelBox.width,
          height: pixelBox.height,
          borderColor: color,
        },
      ]}
    >
      <View style={[styles.labelTag, { backgroundColor: color }]}>
        <Text style={styles.labelText}>{label}</Text>
      </View>

      <View
        {...resizePanResponder.panHandlers}
        style={[styles.resizeHandle, { backgroundColor: color }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 3,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.12)',
    zIndex: 20,
    elevation: 20,
  },

  labelTag: {
    position: 'absolute',
    top: -34,
    left: -3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },

  labelText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
  },

  resizeHandle: {
    position: 'absolute',
    right: -16,
    bottom: -16,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: 'white',
  },
});