// ===== SCAN ENGINE (V3 - barcode-first) =====
// The "brain" of the scanning pipeline. V3 changes the priority order from
// earlier versions: barcode is now tried FIRST for both Roll ID AND
// Weight, and OCR only runs as a fallback for whichever field barcode
// could not confidently answer. This is what gets scans from 20-30s down
// toward the 2-10s target: when barcode-interpretation finds both values,
// OCR (the slow network call) never runs at all.
//
// Returns:
//   {
//     success: true,
//     rollId: "DTR55H0829359",
//     weight: "1747",
//     labelType: "Domtar LynxJet",   // optional, from Template Library (human-curated)
//     confidence: 0.94,
//     method: { rollId: "barcode", weight: "barcode", labelType: "library" },
//     timedOut: false,
//     debug: { ... }
//   }
//
// Decision flow per field:
//   rollId / weight:
//     1. BarcodeInterpreter (using Learning Library shape hints if any
//        exist) - fast, no network call.
//     2. If still missing after step 1, OCR fallback - but ONLY asked to
//        find the specific missing field(s), not asked to "read
//        everything". The OCR call itself still reads the whole label
//        (OCR.space has no concept of "only look for a number"), but we
//        skip the call ENTIRELY if both fields were already found by
//        barcode, which is the actual time savings.
//   labelType:
//     1. If OCR ran (for another reason), LibraryMatcher compares its
//        text against the Template Library - most accurate, since it's
//        based on this exact scan.
//     2. Otherwise, fast path: if this Roll ID's barcode shape was
//        already linked to a Template Library record on a PREVIOUS scan
//        (see LearningLibraryService.linkedTemplateId), reuse that link.
//        This means "Domtar LynxJet 60lb" can show up on the Confirm
//        Screen even when barcode alone succeeded and OCR never ran.
//     3. If neither applies, labelType stays null - never worth spending
//        an extra OCR network call just to label it; the manifest only
//        needs rollId + weight to function.
//
// Timeout safety: if the OCR fallback call takes longer than
// OCR_TIMEOUT_MS, ScanEngine gives up waiting and returns whatever it has
// (timedOut: true), rather than letting one slow network call block the
// user past the ~10s "go manual" threshold.

import { readTextFromImage } from './OCRService';
import { findRollNumber } from './OCRParser';
import { extractWeight } from './WeightExtractor';
import { matchLibrary } from './LibraryMatcher';
import { interpretBarcodes } from './BarcodeInterpreter';
import { getLearnedShapes, getLinkedTemplateId } from './LearningLibraryService';
import { getTemplates, getTemplateById } from './TemplateService';

// If the OCR fallback hasn't responded within this long, stop waiting and
// return with whatever was found so far. Keeps worst-case scan time
// bounded even if OCR.space is slow or unreachable.
//
// FIX (real-world testing): every test scan that needed OCR (because the
// Weight barcode wasn't caught in time - see AUTO_CAPTURE_SECONDS fix in
// NewScannerTestScreen.js) hit the full 8s timeout without ever getting a
// response back. Waiting 8s for something that has a track record of
// never finishing in time just makes the user wait longer for nothing -
// shortened so a failed OCR call surfaces faster and the user can use
// Edit Manually sooner instead of staring at a spinner.
const OCR_TIMEOUT_MS = 4000;

// Wraps a promise with a timeout. Resolves to { timedOut: true } instead
// of rejecting, so callers don't need try/catch just for the timeout case.
function withTimeout(promise, ms) {
  let timeoutId;

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  return Promise.race([promise, timeout]).then((result) => {
    clearTimeout(timeoutId);
    return result;
  });
}

// Main entry point.
//
// photo: { uri, base64 } of the photo, ALREADY cropped to the Scan Frame
// rawBarcodes: array of barcode values seen on the live camera feed right
//   before capture - either bare strings (BarcodeService.getRecentBarcodeValues,
//   legacy) or full {value, seenCount} entries
//   (BarcodeService.getRecentBarcodeEntries, preferred - lets
//   BarcodeInterpreter prefer values the scanner read consistently over a
//   one-off misread). BarcodeInterpreter accepts either.
export async function runScanEngine(photo, rawBarcodes = []) {
  // Step 1: Barcode-first interpretation - no network call, near-instant.
  // Uses the Learning Library's known shapes (if any) to interpret with
  // higher confidence than the first time a label format is seen.
  let knownShapes = [];
  try {
    knownShapes = await getLearnedShapes();
  } catch (error) {
    console.log('ScanEngine: could not load Learning Library shapes:', error);
  }

  const barcodeResult = interpretBarcodes(rawBarcodes, knownShapes);

  let rollId = barcodeResult.rollId;
  let weight = barcodeResult.weight;
  let rollIdMethod = rollId ? 'barcode' : null;
  let weightMethod = weight ? 'barcode' : null;
  let rollIdConfidence = rollId ? barcodeResult.confidence : 0;
  let weightConfidence = weight ? barcodeResult.confidence : 0;

  let ocrText = '';
  let ocrRan = false;
  let timedOut = false;
  let labelMatch = null;

  // Fast path: if this Roll ID's barcode shape has already been linked to
  // a known Template Library record (because OCR confirmed it at least
  // once before), we can report a human-readable label type immediately -
  // no OCR call needed. This is what lets "Domtar LynxJet 60lb" show up
  // on the Confirm Screen even on scans where barcode alone succeeded.
  //
  // PERFORMANCE NOTE: this lookup (AsyncStorage read, ~5-20ms) and the OCR
  // fallback call below (network round-trip, ~1-8s) are independent of
  // each other - neither needs the other's result. They're kicked off
  // together rather than awaited one after another, so on the (uncommon)
  // case where OCR also needs to run, we don't pay the template lookup's
  // time on top of the OCR wait.
  const linkedTemplateId = rollId ? getLinkedTemplateId(rollId, knownShapes) : null;
  const fastPathTemplatePromise = linkedTemplateId
    ? getTemplateById(linkedTemplateId).catch((error) => {
        console.log('ScanEngine: could not load linked template:', error);
        return null;
      })
    : Promise.resolve(null);

  // Step 2: OCR fallback - ONLY runs if barcode didn't find everything.
  // This is the key time-saving change: a fully-successful barcode scan
  // skips this entire block, including the photo upload to OCR.space.
  const needsOcrFallback = !rollId || !weight;

  if (needsOcrFallback && photo?.base64) {
    ocrRan = true;

    const ocrOutcome = await withTimeout(
      readTextFromImage(photo.base64).catch((error) => {
        console.log('ScanEngine OCR error:', error);
        return '';
      }),
      OCR_TIMEOUT_MS
    );

    if (ocrOutcome?.timedOut) {
      timedOut = true;
    } else {
      ocrText = ocrOutcome || '';
    }

    // Fill in ONLY the field(s) barcode could not answer - OCR is asked
    // to do the minimum work needed, not asked to "find everything".
    if (!rollId && ocrText) {
      const ocrRollId = findRollNumber(ocrText);
      if (ocrRollId) {
        rollId = ocrRollId;
        rollIdMethod = 'ocr';
        rollIdConfidence = 0.6;
      }
    }

    if (!weight && ocrText) {
      const weightResult = extractWeight(ocrText);
      if (weightResult.weight) {
        weight = weightResult.weight;
        weightMethod = 'ocr';
        weightConfidence = weightResult.confidence;
      }
    }
  }

  // Step 3: Label type - best-effort, never blocks the result, never
  // triggers its own OCR call. If OCR ran (for another reason above), its
  // match against the Template Library wins since it's based on this
  // exact scan's text. Otherwise, fall back to the fast-path template
  // kicked off above (now safe to await - it was running in parallel
  // with the OCR call this whole time, so this resolves instantly if OCR
  // took any meaningful amount of time, or close to instantly either way
  // since it's just an AsyncStorage read).
  if (ocrText) {
    try {
      const templates = await getTemplates();
      labelMatch = matchLibrary(ocrText, templates);
    } catch (error) {
      console.log('ScanEngine library match error:', error);
    }
  }

  if (!labelMatch) {
    const fastPathTemplate = await fastPathTemplatePromise;
    if (fastPathTemplate) {
      const parts = [fastPathTemplate.vendor, fastPathTemplate.product, fastPathTemplate.basisWeight].filter(Boolean);
      labelMatch = {
        template: fastPathTemplate,
        labelType: parts.length > 0 ? parts.join(' ') : fastPathTemplate.vendor || 'Unknown',
        confidence: 0.8, // linked via shape, not re-verified by this scan's own OCR
        viaFastPath: true,
      };
    }
  }

  const labelTypeConfidence = labelMatch?.confidence || 0;

  // Overall confidence: weighted average. Roll ID and Weight matter most
  // since the manifest needs both; label type is a nice-to-have.
  const overallConfidence = Math.round(
    (rollIdConfidence * 0.45 + weightConfidence * 0.4 + labelTypeConfidence * 0.15) * 100
  ) / 100;

  return {
    success: Boolean(rollId && weight),
    rollId,
    weight,
    labelType: labelMatch?.labelType || null,
    confidence: overallConfidence,
    method: {
      rollId: rollIdMethod,
      weight: weightMethod,
      labelType: labelMatch ? (labelMatch.viaFastPath ? 'linked_shape' : 'library') : null,
    },
    timedOut,
    // Extra detail for the Confirm/debug screen and for tuning - not
    // required by callers that just want rollId/weight/labelType.
    debug: {
      ocrRan,
      ocrText,
      barcodesSeen: barcodeResult.allBarcodes,
      usedLearnedShape: barcodeResult.usedLearnedShape,
      matchedTemplateId: labelMatch?.template?.id || null,
    },
  };
}