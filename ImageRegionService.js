// ===== IMAGE REGION SERVICE =====
// Crops a normalized region (0 to 1 coordinates) from a photo.

import * as ImageManipulator from 'expo-image-manipulator';
import { getCropFrame } from './ScanFrameService';

// Add 20% padding around selected box
function addPaddingToBox(box, paddingPercent = 0.2) {
  if (!box) return null;

  const extraWidth = box.width * paddingPercent;
  const extraHeight = box.height * paddingPercent;

  const x = Math.max(0, box.x - extraWidth / 2);
  const y = Math.max(0, box.y - extraHeight / 2);

  const width = Math.min(1 - x, box.width + extraWidth);
  const height = Math.min(1 - y, box.height + extraHeight);

  return { x, y, width, height };
}

// Shared low-level crop. `box` is normalized (0-1), no extra padding is
// added here - callers decide how much padding/tolerance to apply first.
async function cropByBox(photoUri, box, imageWidth, imageHeight) {
  if (!photoUri || !box || !imageWidth || !imageHeight) {
    return null;
  }

  let originX = Math.round(box.x * imageWidth);
  let originY = Math.round(box.y * imageHeight);
  let width = Math.round(box.width * imageWidth);
  let height = Math.round(box.height * imageHeight);

  originX = Math.max(0, Math.min(originX, imageWidth - 1));
  originY = Math.max(0, Math.min(originY, imageHeight - 1));
  width = Math.max(1, Math.min(width, imageWidth - originX));
  height = Math.max(1, Math.min(height, imageHeight - originY));

  try {
    const result = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ crop: { originX, originY, width, height } }],
      {
        compress: 1,
        base64: true,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    return result;
  } catch (error) {
    console.log('Crop error:', error);
    return null;
  }
}

// photoUri = full captured photo
// box = { x, y, width, height } from 0 to 1
// imageWidth / imageHeight = full photo size in pixels
//
// Used for zone-based OCR: crops the saved Roll Number Box / Weight Box,
// with an extra 20% padding for tolerance against slight misalignment.
export async function cropImageRegion(photoUri, box, imageWidth, imageHeight) {
  if (!photoUri || !box || !imageWidth || !imageHeight) {
    return null;
  }

  const paddedBox = addPaddingToBox(box, 0.2);

  return cropByBox(photoUri, paddedBox, imageWidth, imageHeight);
}

// Crops a freshly captured photo down to the "Real Crop Engine" frame:
// the green guide rectangle expanded by the crop safety margin (see
// ScanFrameService.getCropFrame). This is the FIRST thing that happens to
// every photo - barcode scanning, OCR, and library matching never see
// anything outside this rectangle (no warehouse background, pallets,
// hands, or unrelated shelf labels).
//
// photoWidth / photoHeight = pixel size of the captured photo (from
// takePictureAsync). This assumes the captured photo has the same aspect
// ratio as the camera preview, so the normalized frame coordinates map
// directly onto the photo. The safety margin absorbs small differences.
export async function cropToScanFrame(photoUri, photoWidth, photoHeight) {
  const cropFrame = getCropFrame();

  return cropByBox(photoUri, cropFrame, photoWidth, photoHeight);
}