// ===== BARCODE SERVICE =====
// Reads barcodes directly off the camera preview using expo-camera's
// built-in scanner (CameraView's onBarcodeScanned). This works in Expo
// Snack / Expo Go because it ships inside expo-camera itself - no native
// build step required.
//
// IMPORTANT - how this is actually wired up:
// expo-camera can only scan barcodes from a LIVE camera feed, not from an
// already-captured static photo. So the real-time scanning happens while
// the camera preview is showing (see useBarcodeScanner hook below), and
// whatever barcode(s) were last seen right before the shutter fires are
// what ScanEngine uses as Roll ID candidates. There is no separate
// "scan this photo file for barcodes" function, because the platform
// doesn't expose one outside of the live preview.
//
// Multiple barcodes can be visible at once (the roll label often repeats
// the Roll ID barcode 2-4 times, like Domtar/Sappi/Holmen samples). This
// service hands back ALL distinct values seen; ScanEngine + LibraryMatcher
// decide which one is the real Roll ID (e.g. by checking which value also
// appears in the OCR text, or matches a known template's ID format).

import { useRef, useState, useCallback } from 'react';

// Barcode symbologies commonly used on roll labels / shipping labels.
// Code128 and Code39 cover the vast majority of industrial roll labels.
export const ROLL_LABEL_BARCODE_TYPES = [
  'code128',
  'code39',
  'code93',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'qr',
  'pdf417',
];

// How long a previously-seen barcode is still considered "recent enough"
// to use, in milliseconds. Keeps stale values from a different label
// (e.g. if the user re-aimed the camera) from leaking into a new scan.
const RECENT_BARCODE_WINDOW_MS = 4000;

// React hook that tracks barcodes seen on the live camera preview.
// Usage:
//   const { barcodes, handleBarcodeScanned, clearBarcodes } = useBarcodeScanner();
//   <CameraView onBarcodeScanned={handleBarcodeScanned} barcodeScannerSettings={{ barcodeTypes: ROLL_LABEL_BARCODE_TYPES }} />
//   // right before/after capture:
//   const candidates = getRecentBarcodeValues(barcodes);
export function useBarcodeScanner() {
  // Map of barcode value -> { value, type, lastSeenAt, seenCount }
  const seenRef = useRef(new Map());
  const [barcodes, setBarcodes] = useState([]);

  const handleBarcodeScanned = useCallback((event) => {
    const value = event?.data;
    const type = event?.type;

    if (!value) return;

    const isNewValue = !seenRef.current.has(value);
    const previous = seenRef.current.get(value);

    // seenCount matters for reliability, not just recency: a barcode
    // scanner can occasionally misread a character on a single frame
    // (e.g. "DWWG5L2832429" misread once as "D66G5L2832429" - a real
    // failure mode observed in testing). A value seen consistently across
    // multiple frames is much more trustworthy than one seen only once,
    // even if both are "recent". BarcodeInterpreter uses this to prefer
    // the more-consistently-read value when two same-length Roll ID
    // candidates disagree.
    seenRef.current.set(value, {
      value,
      type,
      lastSeenAt: Date.now(),
      seenCount: (previous?.seenCount || 0) + 1,
    });

    // Only trigger a React re-render when a genuinely NEW value shows up.
    // Repeated scans of the same barcode (which happen constantly while
    // it's in frame) update the timestamp/count in the ref but don't need
    // to re-render the screen every single frame.
    if (isNewValue) {
      setBarcodes(Array.from(seenRef.current.values()));
    }
  }, []);

  const clearBarcodes = useCallback(() => {
    seenRef.current.clear();
    setBarcodes([]);
  }, []);

  return { barcodes, handleBarcodeScanned, clearBarcodes };
}

// Filters a barcode list down to values seen within the last
// RECENT_BARCODE_WINDOW_MS, sorted most-recently-seen first.
export function getRecentBarcodeValues(barcodes, atTime = Date.now()) {
  if (!barcodes || barcodes.length === 0) return [];

  return barcodes
    .filter((entry) => atTime - entry.lastSeenAt <= RECENT_BARCODE_WINDOW_MS)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((entry) => entry.value);
}

// Same filtering as getRecentBarcodeValues, but returns the full entry
// objects ({ value, type, lastSeenAt }) instead of just the value strings.
// BarcodeInterpreter needs the full entries to reason about WHICH barcode
// is Roll ID vs Weight vs something else (e.g. preferring values seen
// earliest/most consistently, or matching a known shape).
export function getRecentBarcodeEntries(barcodes, atTime = Date.now()) {
  if (!barcodes || barcodes.length === 0) return [];

  return barcodes
    .filter((entry) => atTime - entry.lastSeenAt <= RECENT_BARCODE_WINDOW_MS)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}