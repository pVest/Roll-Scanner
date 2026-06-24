// ===== TEMPLATE FIELD PARSER =====
// Extracts the structured Template Library fields (vendor, product,
// basisWeight, size, color, finish) from raw OCR text of a roll label
// photo - so AddTemplateScreen can auto-fill the form instead of
// requiring the user to type every field by hand.
//
// WHY THIS EXISTS: previously, adding a new roll type to Template
// Library meant manually typing vendor, product, basis weight, size,
// color, and finish, on top of confirming Roll ID and Weight. That's a
// lot of typing for something already printed on the label - this module
// reads it directly from the OCR text instead, leaving the user to just
// review and correct anything OCR got wrong (much faster than typing
// from scratch).
//
// This is intentionally heuristic, not exhaustive - it's built from the
// label formats seen across this project's real-world testing (Domtar,
// Sappi, Sustana, Sylvamo, Holmen, WestRock, ND Paper, Billerud,
// Norpac, ProAmpac, Neenah, Finch, Paper Plus/APP). New vendors not yet
// seen may parse less completely - the user can always fill in/correct
// any field manually, this just reduces typing for the common case.

// Recognized vendor names - matched case-insensitively against the OCR
// text. Order matters: more specific names should come before generic
// substrings they might accidentally contain.
const KNOWN_VENDORS = [
  'Domtar', 'Sappi', 'Sustana', 'Sylvamo', 'WestRock', 'Holmen', 'Norpac',
  'ND Paper', 'ProAmpac', 'Neenah', 'Finch', 'Paper Plus', 'APP',
  'BillerudKorsnas', 'BillerudKorsnäs', 'Billerud',
];

// Recognized finish/surface keywords
const KNOWN_FINISHES = ['Smooth', 'Gloss', 'Matte', 'Dull', 'Lisse', 'C1S', 'SM-LI'];

// Recognized color keywords - checked in order, first match wins
const KNOWN_COLORS = ['True White', 'Blanc Pur', 'White', 'Blanc', 'Vanilla', 'Natural'];

function findVendor(text) {
  const upperText = text.toUpperCase();
  for (const vendor of KNOWN_VENDORS) {
    if (upperText.includes(vendor.toUpperCase())) {
      return vendor;
    }
  }
  return '';
}

// Product name: the line right after the vendor's logo/header, or a line
// matching common product-name patterns (all-caps product line, often
// right under "Product Description"). Falls back to the first
// distinctive all-caps word sequence near the top of the label.
function findProduct(text, vendor) {
  const lines = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Look for an explicit "Product Description" / "Produit" / "Grade"
  // label, and take the line(s) right after it.
  const labelIndex = lines.findIndex((line) =>
    /PRODUCT\s*DESCRIPTION|PRODUIT|^GRADE$/i.test(line)
  );
  if (labelIndex !== -1 && lines[labelIndex + 1]) {
    return lines[labelIndex + 1].replace(/[^A-Za-z0-9 /]/g, '').trim();
  }

  // Fallback: the first all-caps line of reasonable length that isn't
  // just the vendor name itself (covers labels like "LYNXJET" or "HUSKY
  // OPAQUE OFFSET" appearing directly under the vendor logo with no
  // explicit "Product Description" label).
  const vendorUpper = (vendor || '').toUpperCase();
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    if (
      line.length >= 4 &&
      line.length <= 40 &&
      /^[A-Z0-9 /]+$/.test(upperLine) &&
      upperLine !== vendorUpper &&
      !upperLine.includes(vendorUpper)
    ) {
      return line;
    }
  }

  return '';
}

// Basis weight: a number directly followed by "LB" or "#" near the start
// of the label (distinct from Roll Weight, which is a much larger number
// usually followed by "LBS" near a barcode).
function findBasisWeight(text) {
  // "60 LB" / "70lb" / "87 LB" pattern, but NOT followed immediately by
  // another large number pattern that would indicate it's actually the
  // roll weight read out of context. Basis weights in this warehouse are
  // consistently small (under 200).
  const matches = text.match(/\b(\d{1,3})\s*(?:LB|lb)\b/g);
  if (matches) {
    for (const match of matches) {
      const number = parseInt(match, 10);
      if (number >= 10 && number <= 200) {
        return `${number}lb`;
      }
    }
  }

  // "60#" pattern (Sylvamo-style)
  const hashMatch = text.match(/\b(\d{1,3})#/);
  if (hashMatch) {
    const number = parseInt(hashMatch[1], 10);
    if (number >= 10 && number <= 200) {
      return `${number}lb`;
    }
  }

  return '';
}

// Size: width x length pattern, e.g. "18 in" + "50 in" -> "18x50in", or a
// single diameter-style measurement if that's all that's present.
function findSize(text) {
  // Look for two separate "NN in" or "NN.NN in" values close together
  // (Width and Diameter/Length lines)
  const widthMatch = text.match(/\bWIDTH\b[^\d]*(\d{1,3}(?:\.\d+)?)\s*in/i);
  const secondMatch = text.match(/(?:LENGTH|DIAM(?:ETER)?)\b[^\d]*(\d{1,3}(?:\.\d+)?)\s*in/i);

  if (widthMatch && secondMatch) {
    return `${widthMatch[1]}x${secondMatch[1]}in`;
  }
  if (widthMatch) {
    return `${widthMatch[1]}in`;
  }

  return '';
}

function findColor(text) {
  for (const color of KNOWN_COLORS) {
    if (text.toUpperCase().includes(color.toUpperCase())) {
      return color;
    }
  }
  return '';
}

function findFinish(text) {
  for (const finish of KNOWN_FINISHES) {
    if (text.toUpperCase().includes(finish.toUpperCase())) {
      return finish;
    }
  }
  return '';
}

// Main entry point - parses every structured field from raw OCR text at
// once. Returns an object with empty strings for any field that couldn't
// be confidently identified (never guesses - leaving a field blank for
// the user to fill in manually is always safer than a wrong guess).
export function parseTemplateFields(ocrText) {
  if (!ocrText) {
    return { vendor: '', product: '', basisWeight: '', size: '', color: '', finish: '' };
  }

  const vendor = findVendor(ocrText);

  return {
    vendor,
    product: findProduct(ocrText, vendor),
    basisWeight: findBasisWeight(ocrText),
    size: findSize(ocrText),
    color: findColor(ocrText),
    finish: findFinish(ocrText),
  };
}