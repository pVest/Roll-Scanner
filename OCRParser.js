// ===== OCR PARSER =====
// This file reads OCR text and tries to find Roll Number and Weight
import { findTemplateByText } from './TemplateService';
// Main function used by scanner
export async function parseRollLabelText(rawText) {
  const text = rawText || '';
  // Try to find matching label template by vendor name
  const template = await findTemplateByText(text);

  if (template) {
    console.log('Template Found:', template.vendor);
  }
  
    let rollNumber = '';
  let weight = '';

  if (template) {
    const templateResult = parseWithTemplate(text, template);

    rollNumber = templateResult.rollNumber;
    weight = templateResult.weight;
  }

  if (!rollNumber) {
    rollNumber = findRollNumber(text);
  }

  if (!weight) {
    weight = findWeight(text);
  }

  return {
    rollNumber,
    weight,
    success: Boolean(rollNumber && weight),
  };
}
// Use trained template line positions to extract Roll Number and Weight.
//
// NOTE (V3 compatibility): templates created via the new seedTemplateLibrary
// / V3 AddTemplateScreen flow no longer carry rollAnchor/weightAnchor/
// rollNumberLineIndex/weightLineIndex - those fields will simply be
// undefined on such templates. That's safe: every check below already
// guards on the field being truthy/non-negative, so this function just
// returns empty strings for a V3 template, and the caller
// (parseRollLabelText) falls through to the plain whole-text
// findRollNumber/findWeight search instead. This only affects the OLDER
// ScannerScreen.js flow - the V3 pipeline (ScanEngine.js) does not call
// this function at all.
function parseWithTemplate(text, template) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  let rollNumber = '';
  let weight = '';

    // 1. First try: find by anchors
    rollNumber = findValueNearAnchor(
      text,
      template.rollAnchor,
      findRollNumber
    );

    weight = findValueNearAnchor(
      text,
      template.weightAnchor,
      findWeight
    );

    // 2. Second try: use saved line positions
    if (!rollNumber && template.rollNumberLineIndex >= 0 && lines[template.rollNumberLineIndex]) {
      rollNumber = findRollNumber(lines[template.rollNumberLineIndex]);
    }

    if (!weight && template.weightLineIndex >= 0 && lines[template.weightLineIndex]) {
      weight = findWeight(lines[template.weightLineIndex]);
    }

  return {
    rollNumber,
    weight,
  };
}
function findValueNearAnchor(text, anchorText, finderFunction) {
  if (!anchorText) return '';

  const lines = text
    .split('\n')
    .map(line => line.trim());

  const anchorUpper = anchorText.toUpperCase();

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].toUpperCase();

    if (currentLine.includes(anchorUpper)) {

      // same line
      let result = finderFunction(lines[i]);

      if (result) {
        return result;
      }

      // next line
      if (lines[i + 1]) {
        result = finderFunction(lines[i + 1]);

        if (result) {
          return result;
        }
      }

      // previous line
      if (lines[i - 1]) {
        result = finderFunction(lines[i - 1]);

        if (result) {
          return result;
        }
      }
    }
  }

  return '';
}
// Find possible roll number from OCR text.
// Patterns are tried in order from MOST specific to LEAST specific, so a
// confident match on a known vendor format always wins over the generic
// fallback. Based on real label samples: Domtar, Sappi, WestRock, Holmen,
// Norpac, Sustana, Sylvamo, Billerud, ND Paper.
export function findRollNumber(text) {
  if (!text) return '';

  // Prefer a number that appears right after an explicit "Roll ID" /
  // "Roll Number" / "Roll Package ID" / "Roll #" label, when present -
  // this is the strongest possible signal regardless of format.
  const labeledMatch = text.match(
    /(?:ROLL\s*ID|ROLL\s*NUMBER|ROLL\s*PACKAGE\s*ID|ROLL\s*#)\s*[:\-]?\s*\n?\s*([A-Z0-9][A-Z0-9\-]{5,19})/i
  );
  if (labeledMatch) {
    return labeledMatch[1].toUpperCase();
  }

  const patterns = [
    /[A-Z]{3,4}\d[A-Z]\d{6,}/g,          // Domtar Husky: DWWG5L2832429 (3-4 letters + digit + letter + digits)
    /[A-Z]{2}\d{3}[A-Z]\d{7,}/g,         // Domtar LynxJet: DTJ56B1501183
    /[A-Z]{2}\d[A-Z]\d{5,}[A-Z0-9]*/g,   // Sappi: SW716E1709361
    /[A-Z]{2}\d{2}[A-Z]\d{4,}[A-Z]/g,    // Norpac: NW26D16172F (2 letters + 2 digits + letter + digits + letter) - must come BEFORE the 1-letter WestRock pattern below, or that pattern partially matches starting at the second letter
    /[A-Z]\d{2}[A-Z]\d{5,}[A-Z]/g,       // WestRock/Sylvamo: E44H25093E, E16D18311Z
    /\d[A-Z]\d[A-Z]\d{4,}[A-Z]/g,        // ND Paper: 7S6E04052B (digit-led mixed format)
    /[A-Z]{2}\d[A-Z]\d{5,}/g,            // Billerud: RA6C061047 (letter+digit+letter+digits, no trailing letter)
    /\d{4,6}-\d{1,2}-\d{1,3}[A-Z]?/g,    // Holmen Roll Package ID: 414820-1-19 (digits with dashes)
    /[A-Z0-9]{8,18}/g,                   // General roll number backup
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);

    if (matches && matches.length > 0) {
      return matches[0];
    }
  }

  return '';
}


// Find roll weight from OCR text
export function findWeight(text) {
  const lines = text.split('\n').map(line => line.toUpperCase());

  // Words that usually point to real roll weight
  const weightKeywords = [
    'ROLL WEIGHT',
    'GROSS WEIGHT',
    'GROSS WT',
    'NET WEIGHT',
    'NET WT',
    'WEIGHT',
    'GROSS',
    'NET',
    'BRUT',
    'BRUT GROSS',
    'WT',
  ];

  // Weight ceiling (4000) kept in sync with BarcodeInterpreter.js's
  // MAX_PLAUSIBLE_WEIGHT and WeightExtractor.js's MAX_PLAUSIBLE_WEIGHT -
  // real warehouse rolls top out around 2300lb, with some margin for
  // heavier ones, never anywhere near what the old 10000 ceiling allowed.

  // First priority: number near LB or LBS
  for (const line of lines) {
    const lbMatches = line.match(/\b\d{3,5}\s*(LB|LBS)\b/g);

    if (lbMatches) {
      const numbers = lbMatches
        .map(value => value.match(/\d{3,5}/)?.[0])
        .filter(Boolean)
        .map(Number);

      const validWeights = numbers.filter(number => number >= 300 && number <= 4000);

      if (validWeights.length > 0) {
        return String(validWeights[validWeights.length - 1]);
      }
    }
  }

  // Second priority: number on the same line as weight keywords
  for (const line of lines) {
    const hasWeightKeyword = weightKeywords.some(keyword => line.includes(keyword));

    if (hasWeightKeyword) {
      const numbers = line.match(/\b\d{3,5}\b/g);

      if (numbers) {
        const validWeights = numbers
          .map(Number)
          .filter(number => number >= 300 && number <= 4000);

        if (validWeights.length > 0) {
          return String(validWeights[validWeights.length - 1]);
        }
      }
    }
  }

  // Third priority: number on the line after weight keyword
  for (let i = 0; i < lines.length - 1; i++) {
    const hasWeightKeyword = weightKeywords.some(keyword => lines[i].includes(keyword));

    if (hasWeightKeyword) {
      const nextLineNumbers = lines[i + 1].match(/\b\d{3,5}\b/g);

      if (nextLineNumbers) {
        const validWeights = nextLineNumbers
          .map(Number)
          .filter(number => number >= 300 && number <= 4000);

        if (validWeights.length > 0) {
          return String(validWeights[0]);
        }
      }
    }
  }

  // Backup: use possible weight numbers, but avoid dates and tiny paper specs
  const allNumbers = text.match(/\b\d{3,5}\b/g);

  if (allNumbers) {
    const validWeights = allNumbers
      .map(Number)
      .filter(number => {
        // Ignore years
        if (number >= 2020 && number <= 2035) return false;

        // Ignore small paper specs like 50, 70, 87, 119
        if (number < 300) return false;

        // Roll weight limit
        if (number > 4000) return false;

        return true;
      });

    if (validWeights.length > 0) {
      return String(validWeights[0]);
    }
  }

  return '';
}

// ===== ZONE-BASED EXTRACTION =====
// These functions work on OCR text that comes from a small, tightly cropped
// region of the photo (Roll Number Box / Weight Box). Because the area is
// already known to contain only that value, extraction can be simpler and
// more forgiving than the full-page parser above.

// Extract a Roll Number from a cropped Roll Number region
export function extractRollNumberFromRegion(text) {
  if (!text) return '';

  // First try the same strict patterns used for full-page parsing
  const patternMatch = findRollNumber(text);
  if (patternMatch) return patternMatch;

  // Fallback: the longest alphanumeric token in the cropped text is very
  // likely the roll number, since labels/captions in this region are rare
  const cleaned = text.toUpperCase();
  const tokens = cleaned.match(/[A-Z0-9]{6,}/g);

  if (tokens && tokens.length > 0) {
    return tokens.sort((a, b) => b.length - a.length)[0];
  }

  return '';
}

// Extract a Weight value from a cropped Weight region
export function extractWeightFromRegion(text) {
  if (!text) return '';

  const numbers = text.match(/\d{3,5}/g);
  if (!numbers) return '';

  const validWeights = numbers
    .map(Number)
    .filter(number => number >= 300 && number <= 4000);

  return validWeights.length > 0 ? String(validWeights[0]) : '';
}

// Combine OCR text from the two cropped regions into a final result
export function parseFromRegions({ rollText, weightText }) {
  const rollNumber = extractRollNumberFromRegion(rollText);
  const weight = extractWeightFromRegion(weightText);

  return {
    rollNumber,
    weight,
    success: Boolean(rollNumber && weight),
  };
}