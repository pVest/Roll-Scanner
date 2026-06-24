// ===== SCAN FRAME SERVICE =====
// "Real Crop Engine" - pure geometry helpers for the green guide frame.
//
// This file owns the MATH (what rectangle to crop to). The visual overlay
// (dimming, drawing the green box, the countdown badge) lives in
// ScanFrame.js, which imports its constants from here so there is exactly
// one source of truth for the frame geometry.
//
// Pipeline this powers (Etap 1 of the new scanning system):
//   1. getGreenFrame()  -> the rectangle the user sees and aims at
//   2. getCropFrame()   -> green frame + 10-20% safety margin
//   3. cropToFrame()    -> actually cuts the captured photo down to that
//      rectangle (see ImageRegionService.cropToScanFrame, which calls this)
//
// Every photo that reaches BarcodeService / OCR / LibraryMatcher has
// already been cropped this way, so none of those services ever see
// warehouse background, pallets, hands, or unrelated shelf labels.

// Normalized (0-1) rectangle, relative to the camera preview / photo.
// This is the GREEN FRAME the user sees and must fit the label inside.
//
// SIZE NOTE: slightly smaller than the original (0.88 x 0.46) on purpose -
// real-world testing showed the smaller Weight barcode on a label is
// harder for the camera to lock onto at a distance where the frame is
// this large, because the user naturally stands far enough back to fit
// the whole label in a big frame. A smaller frame nudges the user to
// stand closer, which makes every barcode on the label (including the
// small Weight one) appear larger and easier to scan.
//
// POSITION NOTE: x is centered exactly ((1 - width) / 2). y is centered
// within the visible camera viewfinder area specifically (not the whole
// screen) - the live-mode bottom panel (Roll ID / Weight fields + hint +
// button) takes up real screen space below the camera, so centering
// against the full 0-1 photo height would visually sit the frame too low
// relative to what the user actually sees above that panel.
export const GREEN_FRAME = { x: 0.12, y: 0.30, width: 0.76, height: 0.40 };

// Extra margin added around the green frame before cropping, so a label
// that is slightly mis-aligned (but still basically "inside" the green
// frame) doesn't get cut off. Expressed as a fraction of the frame's own
// width/height, added on every side. 0.15 = 15% safety margin.
export const CROP_MARGIN = 0.15;

// Returns `frame` grown outward by `marginFraction` (of its own size) on
// every side, clamped so it never leaves the 0-1 photo bounds.
export function expandFrame(frame, marginFraction) {
  const extraWidth = frame.width * marginFraction;
  const extraHeight = frame.height * marginFraction;

  const x = Math.max(0, frame.x - extraWidth);
  const y = Math.max(0, frame.y - extraHeight);

  const width = Math.min(1 - x, frame.width + extraWidth * 2);
  const height = Math.min(1 - y, frame.height + extraHeight * 2);

  return { x, y, width, height };
}

// The rectangle shown to the user on the camera screen.
export function getGreenFrame() {
  return GREEN_FRAME;
}

// The rectangle actually used to crop the captured photo: green frame
// expanded by CROP_MARGIN. This is what every photo gets cut down to
// before barcode scanning, OCR, or library matching ever sees it.
export function getCropFrame() {
  return expandFrame(GREEN_FRAME, CROP_MARGIN);
}

// Converts a normalized (0-1) frame into pixel coordinates for a photo of
// the given width/height, clamped to valid bounds. Shared by every caller
// that needs to turn frame geometry into actual crop coordinates.
export function frameToPixels(frame, imageWidth, imageHeight) {
  let originX = Math.round(frame.x * imageWidth);
  let originY = Math.round(frame.y * imageHeight);
  let width = Math.round(frame.width * imageWidth);
  let height = Math.round(frame.height * imageHeight);

  originX = Math.max(0, Math.min(originX, imageWidth - 1));
  originY = Math.max(0, Math.min(originY, imageHeight - 1));
  width = Math.max(1, Math.min(width, imageWidth - originX));
  height = Math.max(1, Math.min(height, imageHeight - originY));

  return { originX, originY, width, height };
}