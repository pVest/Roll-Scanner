// ===== BARCODE INTERPRETER =====
// Takes the raw list of barcode values BarcodeService saw on a label and
// decides which one is the Roll ID and which one is the Weight - WITHOUT
// running OCR. This is what makes barcode-first scanning fast: if this
// module can confidently answer both questions, OCR never has to run.
//
// BarcodeService is deliberately "dumb" - it just reports what it sees:
//   [{ value: "DTR55H0829359", type: "code39" }, { value: "1747", type: "code39" }, ...]
// BarcodeInterpreter is where the actual decision-making happens.
//
// Two decision paths:
//   1. KNOWN shape (Learning Library has seen this Roll ID format before):
//      use the learned positional/format hints directly - very fast, very
//      confident, and gets MORE confident every time it's confirmed.
//   2. UNKNOWN shape (first time seeing this label format): fall back to
//      generic heuristics (see below) - lower confidence, but still often
//      good enough, and whatever the user confirms on the Confirm Screen
//      teaches the Learning Library this shape for next time.
//
// Generic heuristics (used when nothing is known yet):
//   - Weight candidates: barcode values that are PURE DIGITS and fall in a
//     plausible roll weight range (100-4000 - real warehouse rolls top out
//     around 2300lb, with some headroom for heavier ones; nothing in this
//     warehouse's stock has ever been seen anywhere near 10000). Roll IDs
//     on most sample labels mix letters and digits, so a pure-digit value
//     in this range is a strong (not certain) signal it's the weight.
//   - Roll ID candidate, TWO possible shapes:
//     (a) MIXED letters+digits, longest first (Domtar, Sappi, Holmen,
//         most vendors) - ties broken by seenCount (more consistently
//         read = more trustworthy - guards against a single misread frame
//         like "D66G5L2832429" instead of "DWWG5L2832429" winning just
//         because it happens to be the same length as the correct value).
//     (b) PURE DIGITS but NOT weight-shaped (Sustana: Roll ID like
//         "02431022" is 8 digits, always starts with a leading zero - a
//         real weight is never written with a leading zero, and is never
//         longer than 4000 i.e. never more than 4 digits). A pure-digit
//         value qualifies as a Roll ID candidate if it's outside the
//         plausible weight range (too long/too large) OR starts with "0" -
//         either signal alone is enough, since a genuine weight can do
//         neither. This is a SEPARATE pool from (a), only used as a
//         fallback if no mixed-format candidate was found, so it never
//         takes priority away from the normal Domtar/Sappi/Holmen case.
//     This requires the caller to pass full {value, seenCount} entries
//     (see BarcodeService.getRecentBarcodeEntries) rather than bare
//     strings - bare strings still work, just without this extra
//     reliability signal (seenCount defaults to 1 for all of them, so
//     ties fall back to original behavior).
//   - If MULTIPLE pure-digit values look like plausible weights (e.g. the
//     "46468" vs "1747" ambiguity), prefer the one that was seen
//     repeated more than once on the label (Roll ID and Weight are often
//     printed twice; one-off codes like order numbers usually aren't),
//     then fall back to the smallest plausible value (extreme outliers
//     are more likely to be unrelated order/lot numbers).

import { matchesProfile } from './BarcodeProfileService';

// "Shape" of a barcode value: letters become A, digits become 9. Used to
// recognize the same label format again without caring about the actual
// characters. "DTR55H0829359" -> "AAA99A9999999".
//
// NOTE: this used to live in a separate BarcodeShape.js file (to avoid a
// circular import with BarcodeProfileService.js, which also needs this
// function). That split caused a module-resolution error in Expo Snack
// when the new file wasn't picked up correctly, so the function is back
// here, and BarcodeProfileService.js now has its own small local copy
// instead of importing it - duplicating ~3 lines of trivial, stable code
// is a smaller risk than depending on a new file being created correctly.
export function shapeOf(value) {
  return (value || '').toUpperCase().replace(/[A-Z]/g, 'A').replace(/\d/g, '9');
}

function isPureDigits(value) {
  return /^\d+$/.test(value || '');
}

// Plausible roll weight range in pounds - mirrors WeightExtractor so the
// barcode and OCR paths agree on what "looks like a weight".
//
// UPPER BOUND NOTE: lowered from 10000 to 4000 based on real warehouse
// data - rolls on hand top out around 2300lb, with some margin for
// heavier ones, but nothing anywhere near 10000lb. A tighter upper bound
// here directly helps distinguish Weight from a pure-digit Roll ID (see
// isPureDigitRollIdCandidate below) - Sustana Roll IDs like "02431022"
// are 8-digit numbers that would otherwise sit ambiguously close to what
// "looks like a weight" under the old, looser 10000 ceiling.
const MIN_PLAUSIBLE_WEIGHT = 100;
const MAX_PLAUSIBLE_WEIGHT = 4000;

function isPlausibleWeight(value) {
  const number = Number(value);
  return isPureDigits(value) && number >= MIN_PLAUSIBLE_WEIGHT && number <= MAX_PLAUSIBLE_WEIGHT;
}

// A pure-digit value can still be a Roll ID on some label formats
// (Sustana: "02431022", "02399906", etc. - always 8 digits, always a
// leading zero, never mixed with letters). A genuine Weight value can
// never satisfy either of these two signals - it's never written with a
// leading zero, and it's never outside the plausible weight range - so
// either signal alone safely identifies a pure-digit Roll ID candidate
// without risking misreading an actual weight as one.
function isPureDigitRollIdCandidate(value) {
  if (!isPureDigits(value)) return false;

  const hasLeadingZero = value.length > 1 && value[0] === '0';
  const outsideWeightRange = Number(value) > MAX_PLAUSIBLE_WEIGHT;

  return hasLeadingZero || outsideWeightRange;
}

// Accepts either bare value strings (legacy callers) or full
// {value, seenCount, ...} entries (BarcodeService.getRecentBarcodeEntries)
// and normalizes to a Map of value -> seenCount, deduplicating by value.
// Bare strings default to seenCount 1, which preserves old behavior
// exactly when no reliability data is available.
function normalizeToSeenCounts(rawValues) {
  const seenCounts = new Map();

  for (const item of rawValues) {
    if (item == null) continue;

    const isEntryObject = typeof item === 'object';
    const value = isEntryObject ? item.value : item;
    const count = isEntryObject && item.seenCount ? item.seenCount : 1;

    if (!value) continue;

    // If the same value appears from multiple raw items (shouldn't
    // normally happen, but stay safe), keep the higher seenCount.
    seenCounts.set(value, Math.max(seenCounts.get(value) || 0, count));
  }

  return seenCounts;
}

// Generic fallback heuristics, used when the Learning Library doesn't
// recognize this label's barcode shapes yet.
//
// uniqueValues: deduplicated barcode value strings
// seenCounts: Map of value -> number of times consistently read (from
// normalizeToSeenCounts) - used both as a Roll ID tie-breaker (prefer a
// value the scanner agreed on repeatedly over a one-off misread) and, for
// Weight, as the "printed more than once on the label" signal that used
// to come from counting raw (non-deduplicated) occurrences.
function interpretWithHeuristics(uniqueValues, seenCounts) {
  // Roll ID candidates, pool (a): mixed letters+digits (not pure digits),
  // longest first; ties broken by seenCount (more consistently read =
  // more trustworthy - guards against a single misread frame like
  // "D66G5L2832429" instead of "DWWG5L2832429" winning just because it
  // happens to be the same length as the correct value). Covers Domtar,
  // Sappi, Holmen, and most vendors - compared against pool (b) below
  // rather than blindly preferred (see the comparison logic further down).
  const mixedRollIdCandidates = uniqueValues
    .filter((value) => !isPureDigits(value) && value.length >= 6)
    .sort((a, b) => {
      const lengthDiff = b.length - a.length;
      if (lengthDiff !== 0) return lengthDiff;
      return (seenCounts.get(b) || 1) - (seenCounts.get(a) || 1);
    });

  // Roll ID candidates, pool (b): pure-digit values that can't be a
  // Weight (see isPureDigitRollIdCandidate) - covers Sustana-style labels
  // where the Roll ID itself is all digits. Only consulted as a FALLBACK
  // if pool (a) found nothing, so it never overrides the normal
  // mixed-format case. Longest first, then seenCount, same tie-break
  // logic as pool (a).
  const pureDigitRollIdCandidates = uniqueValues
    .filter(isPureDigitRollIdCandidate)
    .sort((a, b) => {
      const lengthDiff = b.length - a.length;
      if (lengthDiff !== 0) return lengthDiff;
      return (seenCounts.get(b) || 1) - (seenCounts.get(a) || 1);
    });

  // Choosing between the two pools: do NOT blindly prefer pool (a) just
  // because it's non-empty. On some labels (Sustana), small mixed-format
  // SERVICE barcodes (e.g. "R009492-020-2A", the "No. Position" code) are
  // also present and would otherwise out-rank the real pure-digit Roll
  // ID purely by virtue of being in pool (a). Instead, compare the best
  // candidate from each pool by seenCount - the REAL Roll ID barcode is
  // printed large and reliably scanned many times; a small service
  // barcode is typically scanned less consistently (harder to land the
  // camera on it precisely), so seenCount is a meaningful tie-breaker
  // here, not just a coincidence.
  const bestMixed = mixedRollIdCandidates[0] || null;
  const bestPureDigit = pureDigitRollIdCandidates[0] || null;

  let rollIdCandidates;
  if (bestMixed && bestPureDigit) {
    const mixedCount = seenCounts.get(bestMixed) || 1;
    const pureDigitCount = seenCounts.get(bestPureDigit) || 1;
    rollIdCandidates = pureDigitCount >= mixedCount ? pureDigitRollIdCandidates : mixedRollIdCandidates;
  } else {
    rollIdCandidates = bestMixed ? mixedRollIdCandidates : pureDigitRollIdCandidates;
  }

  // Weight candidates: pure digits within plausible range
  const weightCandidates = uniqueValues.filter(isPlausibleWeight);

  const rollId = rollIdCandidates[0] || null;
  const rollIdSeenCount = rollId ? (seenCounts.get(rollId) || 1) : 0;

  let weight = null;
  let weightConfidence = 0;
  let weightSeenCount = 0;

  if (weightCandidates.length === 1) {
    weight = weightCandidates[0];
    weightConfidence = 0.6;
    weightSeenCount = seenCounts.get(weight) || 1;
  } else if (weightCandidates.length > 1) {
    // Multiple plausible weight-shaped values - prefer the one repeated
    // more than once on the label (order/lot numbers are usually printed
    // only once; Roll ID and Weight are often repeated 2+ times)
    const sorted = [...weightCandidates].sort((a, b) => {
      const countDiff = (seenCounts.get(b) || 1) - (seenCounts.get(a) || 1);
      if (countDiff !== 0) return countDiff;
      // Tie-break: prefer the smaller value (less likely to be an
      // unrelated reference/lot number, which tend to run larger)
      return Number(a) - Number(b);
    });

    weight = sorted[0];
    weightConfidence = 0.45; // ambiguous - multiple candidates, lower trust
    weightSeenCount = seenCounts.get(weight) || 1;
  }

  return {
    rollId,
    weight,
    rollIdConfidence: rollId ? 0.65 : 0,
    weightConfidence,
    rollIdSeenCount,
    weightSeenCount,
  };
}

// Uses a Learning Library shape record (see LearningLibraryService) to
// interpret the SAME barcode values with much higher confidence, because
// we've seen this exact label format confirmed by a human before.
//
// uniqueValues: deduplicated barcode value strings
function interpretWithLearnedShape(uniqueValues, learnedShape, seenCounts) {
  const rollIdMatch = uniqueValues.find((value) => shapeOf(value) === learnedShape.rollIdShape);
  const weightMatch = uniqueValues.find(
    (value) => isPureDigits(value) && value.length === learnedShape.weightLength
  );

  // Confidence scales with how many times this shape has been confirmed
  // before (see LearningLibraryService.recordConfirmation), capped so it
  // never claims absolute certainty.
  const confirmations = learnedShape.confirmedCount || 1;
  const learnedConfidence = Math.min(0.7 + confirmations * 0.03, 0.97);

  return {
    rollId: rollIdMatch || null,
    weight: weightMatch || null,
    rollIdConfidence: rollIdMatch ? learnedConfidence : 0,
    weightConfidence: weightMatch ? learnedConfidence : 0,
    rollIdSeenCount: rollIdMatch ? (seenCounts.get(rollIdMatch) || 1) : 0,
    weightSeenCount: weightMatch ? (seenCounts.get(weightMatch) || 1) : 0,
  };
}

// Main entry point.
//
// rawValues: array of barcode value strings seen on the label (from
//   BarcodeService.getRecentBarcodeValues)
// knownShapes: array of learned shape records from LearningLibraryService
//   (pass [] if the Learning Library is empty or unavailable)
// barcodeProfiles: array of { templateId, profile } from
//   TemplateService.getAllBarcodeProfiles (pass [] if Template Library is
//   empty or unavailable). ONLY consulted as a last-resort fallback, when
//   neither the Learning Library shape match nor the standard heuristics
//   found a Roll ID at all - see the "three decision paths" note below.
//
// THREE DECISION PATHS, IN PRIORITY ORDER:
//   1. Learning Library shape match (interpretWithLearnedShape) - highest
//      confidence, used whenever this exact barcode shape has been
//      confirmed by a human before.
//   2. Standard heuristics (interpretWithHeuristics) - mixed-format Roll
//      ID search, plus the pure-digit fallback pool (handles Domtar,
//      Sappi, Holmen, Sustana, and most vendors without needing any
//      saved profile at all).
//   3. Template Library barcodeProfile match (LAST RESORT) - only tried
//      if path 2 found NO Roll ID candidate whatsoever. Checks every
//      saved profile's shape rules AND context (surrounding barcode
//      count) before accepting a match - see BarcodeProfileService for
//      the full safety design (trial period, context matching). This
//      path exists specifically so a brand-new, unusual label format
//      added once through Template Library can be recognized
//      automatically on every future scan, without needing a code change.
//
// Returns:
//   {
//     rollId, weight,            // best guesses, or null if not found
//     confidence,                 // 0-1, combined confidence
//     rollIdSeenCount,             // how many times the chosen rollId was
//                                  // consistently read - callers can use
//                                  // this as a "wait for consensus before
//                                  // locking the field in" threshold
//     weightSeenCount,             // same, for weight
//     source: "barcode",
//     allBarcodes: rawValues,
//     usedLearnedShape: boolean,  // true if a known shape was used
//     usedBarcodeProfile: boolean, // true if a Template Library profile
//                                   // was the source of the rollId
//     matchedProfileTemplateId: string | null, // which template's
//                                                // profile matched, if any
//   }
export function interpretBarcodes(rawValues, knownShapes = [], barcodeProfiles = []) {
  if (!rawValues || rawValues.length === 0) {
    return {
      rollId: null,
      weight: null,
      confidence: 0,
      rollIdSeenCount: 0,
      weightSeenCount: 0,
      source: 'barcode',
      allBarcodes: [],
      usedLearnedShape: false,
      usedBarcodeProfile: false,
      matchedProfileTemplateId: null,
    };
  }

  // Normalize once at the top: rawValues may be bare strings (legacy
  // callers, or BarcodeService.getRecentBarcodeValues) OR full
  // {value, seenCount, ...} entries (BarcodeService.getRecentBarcodeEntries).
  // Building seenCounts here (rather than inside Set(rawValues) below)
  // matters - Set() on raw objects would dedupe by reference, not by
  // value, silently breaking everything downstream if entries were passed.
  const seenCounts = normalizeToSeenCounts(rawValues);
  const uniqueValues = Array.from(seenCounts.keys());

  // Try every known shape and use the first one where a Roll-ID-shaped
  // value actually appears among this scan's barcodes - i.e. don't just
  // trust the most-recently-learned shape, check it actually applies here.
  const matchingShape = knownShapes.find((shape) =>
    uniqueValues.some((value) => shapeOf(value) === shape.rollIdShape)
  );

  let result = matchingShape
    ? interpretWithLearnedShape(uniqueValues, matchingShape, seenCounts)
    : interpretWithHeuristics(uniqueValues, seenCounts);

  let usedBarcodeProfile = false;
  let matchedProfileTemplateId = null;

  // PATH 3 (last resort): only tried if paths 1 and 2 found NO Roll ID at
  // all. Never overrides a result those paths already produced - this is
  // the "fallback only" safety guarantee from the project design
  // discussion. Loop through every saved profile and use the first one
  // whose shape AND context both match - see BarcodeProfileService for
  // what "match" means in detail.
  if (!result.rollId && barcodeProfiles.length > 0) {
    for (const { templateId, profile } of barcodeProfiles) {
      for (const candidate of uniqueValues) {
        // Compute the likely Weight candidate FIRST (using the profile's
        // own weightDigitLength rule), so it can be correctly excluded
        // from the "noise barcode" count that matchesProfile's context
        // check relies on - without this, a same-shape Weight value
        // would incorrectly count as unexpected noise and could cause a
        // valid match to be rejected (this matters specifically when the
        // Roll ID and Weight happen to share the same digit-length/
        // leading-zero pattern, e.g. both 4-digit numbers).
        const likelyWeight =
          uniqueValues.find(
            (v) =>
              v !== candidate &&
              isPureDigits(v) &&
              String(v).length === profile.weightDigitLength
          ) || null;

        if (matchesProfile(candidate, uniqueValues, profile, likelyWeight)) {
          result = {
            rollId: candidate,
            weight: likelyWeight,
            // Confidence reflects this being a fallback path: lower than
            // the standard heuristics' 0.65, and lower still while the
            // profile is on trial (extra caution until it's proven
            // itself across a few real scans).
            rollIdConfidence: profile.trialUsesLeft > 0 ? 0.5 : 0.6,
            weightConfidence: profile.trialUsesLeft > 0 ? 0.45 : 0.55,
            rollIdSeenCount: seenCounts.get(candidate) || 1,
            weightSeenCount: likelyWeight ? seenCounts.get(likelyWeight) || 1 : 0,
          };
          usedBarcodeProfile = true;
          matchedProfileTemplateId = templateId;
          break;
        }
      }
      if (usedBarcodeProfile) break;
    }
  }

  const confidence =
    result.rollId && result.weight
      ? Math.round(((result.rollIdConfidence + result.weightConfidence) / 2) * 100) / 100
      : Math.round(Math.max(result.rollIdConfidence, result.weightConfidence) * 100) / 100;

  return {
    rollId: result.rollId,
    weight: result.weight,
    rollIdSeenCount: result.rollIdSeenCount || 0,
    weightSeenCount: result.weightSeenCount || 0,
    confidence,
    source: 'barcode',
    allBarcodes: uniqueValues,
    usedLearnedShape: Boolean(matchingShape),
    usedBarcodeProfile,
    matchedProfileTemplateId,
  };
}