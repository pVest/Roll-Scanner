// ===== TEMPLATE SERVICE (V3) =====
// Permanent storage for the human-curated Template Library: a catalog of
// known roll/label TYPES (Domtar LynxJet 60lb, Sappi Opus 87lb Cover, ...),
// each with structured facts (vendor, product, basis weight, size, color,
// finish) plus one example Roll ID / Weight and a reference photo.
//
// V3 CHANGE - what this file used to store vs. what it stores now:
//   OLD ("Library 1.0" / line-anchor era): every template kept the FULL
//   OCR text, a line-by-line array, the exact line index where Roll
//   Number/Weight were found, and the lines immediately before/after them
//   ("anchors"). That approach is what made matching brittle (a single
//   OCR misread line shifts every index) and made every record heavy to
//   store/read for no real benefit once barcode-first scanning + word-
//   overlap matching (LibraryMatcher) replaced it.
//
//   NEW: each template stores only the structured facts a person actually
//   cares about (vendor/product/basisWeight/size/color/finish), a short
//   list of distinctive OCR keywords for LibraryMatcher to compare against
//   (NOT the full raw text), and one example Roll ID/Weight for reference.
//   confirmedCount/correctedCount track how often this exact template was
//   confirmed via the Confirm Screen, so Template Library can sort by
//   real usage frequency automatically - no manual daily/weekly/rare
//   labeling needed (see ConfirmScreen + LearningLibraryService, which
//   link a barcode "shape" to a template id once OCR confirms it once).
//
// Backward compatibility: rollBox/weightBox/imageUri/vendor/rollNumber/
// weight are still accepted and returned exactly as before, so the
// existing AddTemplateScreen / TemplateAreaEditorScreen continue to work
// unchanged. New optional fields are simply additive.

import AsyncStorage from '@react-native-async-storage/async-storage';

const TEMPLATE_STORAGE_KEY = 'ROLL_LABEL_TEMPLATES';

// Create unique template ID
function createTemplateId() {
  return Date.now().toString();
}

// Builds a short list of distinctive keywords from the structured fields
// (vendor/product/etc), used by LibraryMatcher for word-overlap comparison
// instead of comparing against a full stored OCR transcript. Keeping this
// derived from structured fields (rather than stored raw OCR) means the
// keyword list stays short and meaningful even if the original OCR read
// was noisy.
function buildOcrKeywords({ vendor, product, basisWeight, size, color, finish }) {
  return [vendor, product, basisWeight, size, color, finish]
    .filter(Boolean)
    .join(' ');
}

// Get all saved templates
export async function getTemplates() {
  const saved = await AsyncStorage.getItem(TEMPLATE_STORAGE_KEY);
  return saved ? JSON.parse(saved) : [];
}

// Save all templates
async function saveAllTemplates(templates) {
  await AsyncStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

// Save a new roll/label type into the Template Library.
//
// Required for the library to be useful: vendor, exampleRollId/weight as a
// reference. basisWeight/size/color/finish/product are optional but
// strongly recommended - they're what actually distinguishes "Domtar
// LynxJet 60lb" from "Domtar LynxJet 70lb" on the same vendor.
export async function saveTemplate({
  vendor,
  product,
  basisWeight,
  size,
  color,
  finish,
  imageUri,
  // Accepted for backward compatibility with AddTemplateScreen, which
  // still reads a full OCR pass to help the user fill the form and to
  // locate rollBox/weightBox. We do NOT persist the full text long-term -
  // only short derived keywords are kept (see ocrKeywords below).
  ocrText,
  rollNumber,
  weight,
  rollBox,
  weightBox,
  // Auto-generated barcode recognition rules (see BarcodeProfileService) -
  // null for templates that don't need one (e.g. mixed-format Roll IDs
  // already handled by the standard heuristics). Only Roll ID formats
  // the standard heuristics can't already handle need one of these.
  barcodeProfile,
}) {
  const templates = await getTemplates();

  const newTemplate = {
    id: createTemplateId(),

    vendor: vendor || '',
    product: product || '',
    basisWeight: basisWeight || '',
    size: size || '',
    color: color || '',
    finish: finish || '',

    imageUri: imageUri || '',

    // One example Roll ID / Weight, kept purely for human reference on
    // the Template Library screen. NEVER used as a match target - actual
    // roll IDs are always different per physical roll (see
    // BarcodeInterpreter, which only ever compares ID *shape*, not value).
    exampleRollId: rollNumber || '',
    exampleWeight: weight || '',

    // Short, structured keyword string for LibraryMatcher - derived from
    // the fields above, NOT the raw OCR transcript.
    ocrKeywords: buildOcrKeywords({ vendor, product, basisWeight, size, color, finish }),

    // Saved scan regions (normalized 0-1 coordinates), used for zone-based
    // OCR in the older template-based scanner screens.
    rollBox: rollBox || null,
    weightBox: weightBox || null,

    // Auto-generated barcode recognition rules - see BarcodeProfileService
    // and BarcodeInterpreter (fallback path). null if this Roll ID format
    // is already handled by the standard mixed-format heuristics.
    barcodeProfile: barcodeProfile || null,

    // Usage frequency, counted automatically - see ConfirmScreen. Starts
    // at 0 and grows every time a scan is confirmed as this template type.
    confirmedCount: 0,
    correctedCount: 0,

    createdAt: new Date().toISOString(),

    // Backward-compat fields some older screens may still reference.
    // Kept as empty/neutral values rather than removed outright, so
    // nothing crashes if an old screen reads template.rollNumber etc.
    rollNumber: rollNumber || '',
    weight: weight || '',
    ocrText: '', // intentionally not persisted - see file header comment
  };

  const updatedTemplates = [...templates, newTemplate];

  await saveAllTemplates(updatedTemplates);

  return newTemplate;
}

// Clear all templates
export async function clearTemplates() {
  await AsyncStorage.removeItem(TEMPLATE_STORAGE_KEY);
}

// Delete one template by ID
export async function deleteTemplate(templateId) {
  const templates = await getTemplates();

  const updatedTemplates = templates.filter(
    template => template.id !== templateId
  );

  await saveAllTemplates(updatedTemplates);

  return updatedTemplates;
}

// Update one template by ID
export async function updateTemplate(templateId, updatedData) {
  const templates = await getTemplates();

  const updatedTemplates = templates.map(template => {
    if (template.id !== templateId) return template;

    const merged = { ...template, ...updatedData, updatedAt: new Date().toISOString() };

    // Keep ocrKeywords in sync if any of the structured fields changed.
    merged.ocrKeywords = buildOcrKeywords(merged);

    return merged;
  });

  await saveAllTemplates(updatedTemplates);

  return updatedTemplates;
}

// Increments confirmedCount (or correctedCount) for a template - called
// from ConfirmScreen.Accept once a scan has been matched to a known
// template type. This is the ONLY place usage frequency is updated, and
// it requires no manual daily/weekly/rare input from the user.
export async function recordTemplateUsage(templateId, { wasCorrected = false } = {}) {
  if (!templateId) return null;

  const templates = await getTemplates();
  const index = templates.findIndex((template) => template.id === templateId);
  if (index === -1) return null;

  templates[index] = {
    ...templates[index],
    confirmedCount: (templates[index].confirmedCount || 0) + 1,
    correctedCount: (templates[index].correctedCount || 0) + (wasCorrected ? 1 : 0),
    lastConfirmedAt: new Date().toISOString(),
  };

  await saveAllTemplates(templates);

  return templates[index];
}

// Find templates by vendor
export async function findTemplatesByVendor(vendor) {
  if (!vendor) return [];

  const templates = await getTemplates();

  return templates.filter(template =>
    (template.vendor || '').toUpperCase() === vendor.toUpperCase()
  );
}

// Find similar templates by vendor text inside OCR
export async function findSimilarTemplates(ocrText) {
  if (!ocrText) return [];

  const templates = await getTemplates();
  const upperText = ocrText.toUpperCase();

  return templates.filter(template => {
    const vendor = (template.vendor || '').toUpperCase();
    if (!vendor) return false;

    return upperText.includes(vendor);
  });
}

// Find best matching template
export async function findTemplateByText(ocrText) {
  const matches = await findSimilarTemplates(ocrText);

  if (matches.length === 0) {
    return null;
  }

  return matches[0];
}

// Get one template by ID
export async function getTemplateById(templateId) {
  const templates = await getTemplates();

  return templates.find(template => template.id === templateId) || null;
}

// Save the Roll Number Box and Weight Box areas for a template
export async function setTemplateBoxes(templateId, rollBox, weightBox) {
  return updateTemplate(templateId, { rollBox, weightBox });
}

// Returns all templates sorted by usage frequency (confirmedCount),
// highest first - this is what Template Library should display by
// default, so the roll types actually used most often surface
// automatically without any manual prioritization.
export async function getTemplatesByUsage() {
  const templates = await getTemplates();

  return [...templates].sort((a, b) => (b.confirmedCount || 0) - (a.confirmedCount || 0));
}

// Returns every saved barcodeProfile, each tagged with its template's id
// (so a caller that finds a match knows which Template Library record to
// credit). Templates with no profile (barcodeProfile: null) are skipped.
// Used by BarcodeInterpreter's fallback path - see BarcodeProfileService.
export async function getAllBarcodeProfiles() {
  const templates = await getTemplates();

  return templates
    .filter((template) => template.barcodeProfile)
    .map((template) => ({
      templateId: template.id,
      profile: template.barcodeProfile,
    }));
}

// Persists an updated barcodeProfile back to its template - used after
// BarcodeProfileService.recordProfileUsage/recordProfileCorrection change
// a profile's trial-period state, so those changes aren't lost on the
// next app load.
export async function updateTemplateBarcodeProfile(templateId, updatedProfile) {
  return updateTemplate(templateId, { barcodeProfile: updatedProfile });
}

// Find the single best template to use for this scan.
// 1. Find all templates whose vendor name appears in the OCR text.
// 2. If there is more than one, pick the one whose keyword string shares
//    the most words with the new scan (most similar label layout).
export async function findBestTemplate(ocrText) {
  const candidates = await findSimilarTemplates(ocrText);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const upperText = (ocrText || '').toUpperCase();
  const textWords = new Set(upperText.split(/\s+/).filter(Boolean));

  let best = candidates[0];
  let bestScore = -1;

  for (const candidate of candidates) {
    const candidateWords = new Set(
      (candidate.ocrKeywords || '').toUpperCase().split(/\s+/).filter(Boolean)
    );

    let score = 0;
    for (const word of candidateWords) {
      if (textWords.has(word)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}