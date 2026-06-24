// ===== SCAN FRAME (UI) =====
// Visual overlay shown on the camera screen: dims everything outside the
// green guide rectangle, draws the green frame itself, draws a dashed
// outline showing the crop safety margin, and shows an auto-capture
// countdown badge.
//
// The actual frame GEOMETRY (where the rectangle is, how much margin to
// add before cropping) lives in ScanFrameService.js - this file only
// renders it. Keeping the math in one place means the overlay the user
// sees always matches exactly what gets cropped out of the photo.
//
// IMPORTANT: because every NEW photo is pre-cropped to this frame, any
// Roll Number / Weight boxes saved on templates created BEFORE this change
// were drawn against the full (uncropped) photo and will be misaligned.
// Re-run Template Library -> Set Areas once for each existing template to
// re-align them with the new cropped photos.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getGreenFrame, getCropFrame } from './ScanFrameService';

// Re-exported for any old code that still imports geometry from here.
export { GREEN_FRAME as SCAN_FRAME, CROP_MARGIN as SCAN_TOLERANCE, expandFrame as getExpandedFrame } from './ScanFrameService';

// Visual overlay for the camera screen:
//  - darkens everything outside the green frame (70% black)
//  - draws the green guide frame
//  - draws a dashed outline showing the crop safety margin
//  - optionally shows an auto-capture countdown badge below the frame
export default function ScanFrameOverlay({ countdown }) {
  const frame = getGreenFrame();
  const tolerant = getCropFrame();

  const pct = (value) => `${value * 100}%`;

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {/* Dim bands covering everything OUTSIDE the green frame */}
      <View style={[styles.dim, { top: 0, left: 0, right: 0, height: pct(frame.y) }]} />
      <View
        style={[
          styles.dim,
          { bottom: 0, left: 0, right: 0, height: pct(1 - (frame.y + frame.height)) },
        ]}
      />
      <View
        style={[
          styles.dim,
          {
            top: pct(frame.y),
            bottom: pct(1 - (frame.y + frame.height)),
            left: 0,
            width: pct(frame.x),
          },
        ]}
      />
      <View
        style={[
          styles.dim,
          {
            top: pct(frame.y),
            bottom: pct(1 - (frame.y + frame.height)),
            right: 0,
            width: pct(1 - (frame.x + frame.width)),
          },
        ]}
      />

      {/* +10% tolerance outline (dashed, lighter green) */}
      <View
        style={[
          styles.toleranceBox,
          {
            left: pct(tolerant.x),
            top: pct(tolerant.y),
            width: pct(tolerant.width),
            height: pct(tolerant.height),
          },
        ]}
      />

      {/* Main green scan frame */}
      <View
        style={[
          styles.scanFrame,
          { left: pct(frame.x), top: pct(frame.y), width: pct(frame.width), height: pct(frame.height) },
        ]}
      >
        <Text style={styles.scanFrameText}>FIT LABEL IN FRAME</Text>
      </View>

      {/* Auto-capture countdown badge, shown just below the frame */}
      {countdown != null && countdown > 0 && (
        <View style={[styles.countdownWrap, { top: pct(frame.y + frame.height) }]}>
          <View style={styles.countdownBadge}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },

  toleranceBox: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(34, 197, 94, 0.45)',
    borderRadius: 16,
  },

  scanFrame: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#22c55e',
    borderRadius: 12,
    alignItems: 'center',
  },

  scanFrameText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: -14,
  },

  countdownWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginTop: 14,
  },

  countdownBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownText: {
    color: 'white',
    fontSize: 28,
    fontWeight: '900',
  },
});