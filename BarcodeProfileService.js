// ===== BARCODE PROFILE SERVICE =====
// Generates and applies a "barcodeProfile" - a set of automatically
// learned rules describing what a given roll type's Roll ID and Weight
// barcodes look like, plus which OTHER barcodes on the same label should
// be ignored as noise (service/position codes etc).
//
// WHY THIS EXISTS: previously, teaching the scanner to recognize a new,
// unusual label format (e.g. Sustana's all-digit Roll ID) required a
// developer to manually edit BarcodeInterpreter.js. This service makes
// that same kind of rule get generated AUTOMATICALLY from a single
// confirmed photo added through Template Library - no code change
// needed for the next unusual vendor.
//
// SAFETY DESIGN (see project discussion - three required protections):
//
// 1. FALLBACK ONLY: a barcodeProfile is only ever consulted by
//    BarcodeInterpreter when the standard heuristics (mixed-format Roll
//    ID search, Learning Library shape match) found nothing confident.
//    It never overrides a working standard-path result.
//
// 2. CONTEXT MATCH REQUIRED: a profile only applies if the OTHER
//    barcodes seen on the current scan resemble what was seen when the
//    profile was created (similar count of "noise" barcodes). This is
//    what stops an unrelated vendor's barcode from accidentally matching
//    just because it happens to share the same digit-shape as an
//    existing profile (e.g. another vendor's all-digit reference number
//    that also starts with 0).
//
// 3. TRIAL PERIOD: a freshly created profile starts with trialUsesLeft
//    set to TRIAL_PERIOD_USES. Each time it's used to make a decision,
//    trialUsesLeft decrements. If the user ever corrects (Edit Manually)
//    a result that came from a profile still in its trial period, the
//    profile is immediately disabled (trustworthy: false) rather than
//    continuing to make the same mistake on every future scan. Once a
//    profile survives its trial period without a correction, it's
//    considered trustworthy permanently (until/unless a later correction
//    disables it).

// "Shape" of a barcode value: letters become A, digits become 9. Local
// copy (also defined in BarcodeInterpreter.js) rather than importing from
// a shared file - keeping these two small, stable functions duplicated in
// both places avoids both a circular import between this file and
// BarcodeInterpreter.js, AND a dependency on a separate file needing to
// be created correctly in Expo Snack (which caused a module-resolution
// error when that approach was tried).
function shapeOf(value) {
  return (value || '').toUpperCase().replace(/[A-Z]/g, 'A').replace(/\d/g, '9');
}

function isPureDigits(value) {
  return /^\d+$/.test(value || '');
}

// How many times a freshly created profile must be used (and NOT
// corrected by the user) before it's considered fully trustworthy rather
// than "on trial".
const TRIAL_PERIOD_USES = 3;

// Builds a barcodeProfile from a SINGLE confirmed Roll ID + Weight pair,
// plus every OTHER barcode seen on the same label (used to learn which
// values are "noise" to ignore - service/position codes etc).
//
// rollId, weight: the user-confirmed correct values for this label
// otherBarcodeValues: every other barcode value seen on this same photo/
//   scan, EXCLUDING rollId and weight themselves
//
// Returns a barcodeProfile object, ready to attach to a Template Library
// record.
export function generateBarcodeProfile({ rollId, weight, otherBarcodeValues = [] }) {
  if (!rollId) return null;

  const rollIdIsPureDigits = isPureDigits(rollId);
  const rollIdHasLeadingZero = rollIdIsPureDigits && rollId.length > 1 && rollId[0] === '0';

  const weightDigitLength = weight ? String(weight).length : null;
  const weightNumericValue = weight ? Number(weight) : null;

  // "Noise" barcodes: every other value seen on this label that ISN'T
  // the Roll ID or Weight - these are exactly the kind of service/
  // position codes that would otherwise confuse the standard heuristics
  // (see the Sustana "No. Position" codes from real-world testing).
  const noiseValues = otherBarcodeValues.filter(
    (value) => value && value !== rollId && value !== weight
  );

  // Distinct SHAPES among the noise barcodes (for reference/debugging -
  // not used for the context-count check, since two noise barcodes can
  // share a shape, e.g. Sustana's "R009492-020-2A" / "...-2B" both
  // reduce to "A999999-999-9A" but are still two separate physical
  // barcodes that should both count toward expectedNoiseBarcodeCount).
  const noiseShapes = Array.from(new Set(noiseValues.map((value) => shapeOf(value))));

  return {
    rollIdShape: shapeOf(rollId),
    rollIdIsPureDigits,
    rollIdHasLeadingZero,
    rollIdLength: rollId.length,
    weightDigitLength,
    // Expected weight range for THIS roll type - built with margin around
    // the single confirmed example (only one photo exists at creation
    // time, so this is a starting estimate, not a tight statistical
    // range). This is the signal that resolves ambiguity when a Roll ID
    // and Weight happen to share the same digit-length/leading-zero
    // pattern (e.g. both 4 digits, no leading zero) - shape rules alone
    // can't tell them apart in that case, but a real Roll ID is
    // essentially never inside a plausible weight's narrow expected
    // range for THIS specific roll type. 30% margin on each side.
    weightValueRange: weightNumericValue
      ? [Math.round(weightNumericValue * 0.7), Math.round(weightNumericValue * 1.3)]
      : null,
    // How many non-Roll-ID/non-Weight barcodes were present when this
    // profile was created - used as the CONTEXT MATCH signal at
    // application time (protection #2 above). Counts actual barcode
    // VALUES seen, not deduplicated shapes - see comment above.
    expectedNoiseBarcodeCount: noiseValues.length,
    noiseShapes,
    // Trial period tracking (protection #3 above).
    trialUsesLeft: TRIAL_PERIOD_USES,
    trustworthy: true, // becomes false permanently if corrected during trial
    createdAt: new Date().toISOString(),
  };
}

// Checks whether a value falls OUTSIDE this profile's learned weight
// range - used to disambiguate when a Roll ID candidate happens to share
// the exact same shape (digit-length, leading-zero pattern) as the
// Weight on the same label. A value within the expected weight range is
// more likely to BE the weight; a value outside it is more likely to be
// the Roll ID instead.
function isOutsideWeightRange(value, profile) {
  if (!profile.weightValueRange) return true; // no range learned yet - can't rule it out, treat permissively
  const [min, max] = profile.weightValueRange;
  const number = Number(value);
  return number < min || number > max;
}

// Checks whether a given barcodeProfile is a plausible match for a Roll
// ID candidate, given the FULL set of barcodes seen on the current scan.
// This is the function BarcodeInterpreter calls as its fallback path.
//
// candidateValue: a pure-digit or mixed-format barcode value being
//   considered as a possible Roll ID
// allValuesOnThisScan: every barcode value seen on the current scan
//   (including candidateValue itself, and including a Weight candidate
//   if one was found)
// weightCandidate: the value (if any) already identified as the likely
//   Weight on this same scan - excluded from the "noise" count, since
//   generateBarcodeProfile also excludes the confirmed Weight when it
//   built expectedNoiseBarcodeCount. Without this, the two counts would
//   be measuring different things (one excludes Weight, one doesn't) and
//   the context comparison would be unreliable.
// profile: a barcodeProfile from a Template Library record
//
// Returns true if the profile's shape rules AND context (noise barcode
// count) both plausibly match this scan.
export function matchesProfile(candidateValue, allValuesOnThisScan, profile, weightCandidate = null) {
  if (!profile || !profile.trustworthy || !candidateValue) return false;

  const isPureDigit = isPureDigits(candidateValue);

  // Shape check: pure-digit profiles only match pure-digit candidates,
  // and vice versa for mixed-format profiles. Length must match exactly
  // for pure-digit Roll IDs (Sustana is always 8 digits, for example) -
  // mixed-format profiles use shapeOf() for an exact shape match instead.
  if (profile.rollIdIsPureDigits) {
    if (!isPureDigit) return false;
    if (candidateValue.length !== profile.rollIdLength) return false;
    if (profile.rollIdHasLeadingZero && candidateValue[0] !== '0') return false;

    // DISAMBIGUATION: if this profile's Roll ID has NO leading zero, its
    // shape alone (just "N pure digits") is indistinguishable from a
    // plausible Weight value of the same length (e.g. both are 4-digit
    // numbers). In that specific case, additionally require the
    // candidate to fall OUTSIDE the profile's learned weight range -
    // otherwise a genuine Weight value of the same digit-length would
    // satisfy the shape check and could be mistaken for the Roll ID.
    // (When there IS a leading zero, no extra check is needed - a real
    // weight is never written with one, so the leading-zero check above
    // already disambiguates fully on its own.)
    if (!profile.rollIdHasLeadingZero && !isOutsideWeightRange(candidateValue, profile)) {
      return false;
    }
  } else {
    if (isPureDigit) return false;
    if (shapeOf(candidateValue) !== profile.rollIdShape) return false;
  }

  // CONTEXT MATCH (protection #2): count how many OTHER barcodes on this
  // scan are neither the candidate itself nor the identified Weight
  // candidate, and check whether that count is close to what was seen
  // when the profile was created. The tolerance is intentionally tight
  // and scales with the expected count, rather than a flat allowance - a
  // flat tolerance would let a label with very different surrounding
  // barcodes "pass" against a profile that expected several, which
  // defeats the whole point of this check (catching an unrelated vendor
  // whose Roll ID just coincidentally shares the same digit-shape).
  const otherBarcodesOnThisScan = allValuesOnThisScan.filter(
    (v) => v !== candidateValue && v !== weightCandidate
  ).length;
  const expected = profile.expectedNoiseBarcodeCount || 0;
  const tolerance = Math.floor(expected / 2);
  const contextMatches = Math.abs(otherBarcodesOnThisScan - expected) <= tolerance;

  return contextMatches;
}

// Call this every time a profile is actually USED to make a decision
// (i.e. matchesProfile returned true and the result was accepted).
// Decrements the trial counter; once it reaches 0 the profile graduates
// to permanently trustworthy (no further special handling needed - it
// simply stops decrementing, trustworthy stays true unless corrected).
export function recordProfileUsage(profile) {
  if (!profile) return profile;

  return {
    ...profile,
    trialUsesLeft: Math.max(0, (profile.trialUsesLeft || 0) - 1),
  };
}

// Call this if the user corrects (Edit Manually) a result that came from
// a profile still in its trial period. Immediately and permanently marks
// the profile untrustworthy - protection #3. A profile that already
// graduated past its trial period (trialUsesLeft already 0) is NOT
// auto-disabled by a single correction, since by that point it has a
// track record of multiple successful uses; a one-off correction at that
// stage is treated as an unusual single scan, not evidence the whole
// profile is wrong.
export function recordProfileCorrection(profile) {
  if (!profile) return profile;

  const wasStillOnTrial = (profile.trialUsesLeft || 0) > 0;

  if (!wasStillOnTrial) return profile;

  return {
    ...profile,
    trustworthy: false,
  };
}