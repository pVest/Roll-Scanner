// ===== SEED TEMPLATE LIBRARY =====
// One-time helper to bulk-populate the Template Library with the roll
// types already identified from real label photos, instead of using the
// Add Template screen 33 times by hand.
//
// HOW TO USE THIS (in Expo Snack):
//   1. Add a temporary button anywhere reachable in the app, e.g. on the
//      Roll Manifest screen:
//        import { seedTemplateLibrary } from './RollManifest/Scaner/seedTemplateLibrary';
//        <Pressable onPress={async () => {
//          const result = await seedTemplateLibrary();
//          Alert.alert('Seeded', `Added ${result.added}, skipped ${result.skipped} (already existed)`);
//        }}>
//          <Text>Seed Template Library</Text>
//        </Pressable>
//   2. Tap it once. It will add every roll type below that isn't already
//      present (matched by vendor+product+basisWeight+exampleRollId, so
//      running it twice never creates duplicates).
//   3. Remove the button afterward - this is a one-time setup helper, not
//      a permanent part of the app.
//
// Each entry has NO photo (imageUri is empty) and NO scan areas
// (rollBox/weightBox are null) since these were created from reference
// photos, not captured live through the camera. You can still open each
// one from Template Library and tap "Edit" to add more detail, or use
// "Add Template" normally going forward to attach a live photo + scan
// areas to a NEW roll type.
//
// confirmedCount starts at 0 for every seeded entry - usage frequency is
// earned automatically through real scans confirmed on the Confirm
// Screen (see ConfirmScreen.js + TemplateService.recordTemplateUsage),
// never assigned manually here.

import { getTemplates, saveTemplate } from './TemplateService';

// The 33 known roll types, gathered from real label photos sent during
// Template Library population. vendor/product/basisWeight/size/color/
// finish are the structured facts a person actually cares about;
// exampleRollId/exampleWeight are just one real example for reference -
// remember Roll ID is NEVER the same between physical rolls (see
// BarcodeInterpreter/LearningLibraryService, which only ever compare the
// ID's *shape*, never its value).
const KNOWN_ROLL_TYPES = [
  { vendor: 'Domtar', product: 'LynxJet', basisWeight: '60lb', size: '18x50in', color: 'White', finish: 'Smooth', exampleRollId: 'DTJ56D0221253', exampleWeight: '2189' },
  { vendor: 'Domtar', product: 'LynxJet', basisWeight: '70lb', size: '18x50in', color: 'White', finish: 'Smooth', exampleRollId: 'DTJ56A1328308', exampleWeight: '2181' },
  { vendor: 'Sappi', product: 'Opus PS Glos Web 9PT Cover', basisWeight: '87lb', size: '20in', color: '', finish: 'Gloss', exampleRollId: 'SW716E1715341', exampleWeight: '1442' },
  { vendor: 'Sappi', product: 'Opus PS Glos Web 7PT Cover', basisWeight: '70lb', size: '20in', color: '', finish: 'Gloss', exampleRollId: 'SW715L0625300', exampleWeight: '1546' },
  { vendor: 'Paper Plus / APP', product: 'Woodfree Offset Paper P026411', basisWeight: '75GSM', size: '457mm', color: 'Bluish White', finish: '', exampleRollId: '011700161727', exampleWeight: '419.456' },
  { vendor: 'Sustana', product: 'Opaque True White', basisWeight: '40lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02431022', exampleWeight: '2090' },
  { vendor: 'Sustana', product: 'HiTech InkJet True White Lisse', basisWeight: '70lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02416399', exampleWeight: '2020' },
  { vendor: 'Sylvamo', product: 'Simply Inkjet 18 50/3', basisWeight: '60lb', size: '18x50in', color: '', finish: '', exampleRollId: 'E16C21033C', exampleWeight: '2242' },
  { vendor: 'Finch', product: 'Opaque Vanilla', basisWeight: '60lb', size: '18x40in', color: 'Vanilla', finish: '', exampleRollId: 'FI125L2902000210', exampleWeight: '1274' },
  { vendor: 'Sappi', product: 'OPU PS DU Web 9PT Cover', basisWeight: '87lb', size: '20in', color: '', finish: 'Dull', exampleRollId: 'SW716A0717361', exampleWeight: '1428' },
  { vendor: 'Sappi', product: 'OPU PS GL Web 7PT Cover', basisWeight: '70lb', size: '18in', color: '', finish: 'Gloss', exampleRollId: 'SW726E1520399', exampleWeight: '1392' },
  { vendor: 'BillerudKorsnas', product: 'White', basisWeight: '11.4pt caliper', size: '10in', color: 'White', finish: '', exampleRollId: '225257-101', exampleWeight: '1460' },
  { vendor: 'Domtar', product: 'Husky Opaque Offset', basisWeight: '50lb', size: '17.5x40in', color: 'White', finish: 'SM-LI', exampleRollId: 'DWW85A0135487', exampleWeight: '1296' },
  { vendor: 'Sappi', product: 'Opus Matte Web 70LB Text', basisWeight: '70lb', size: '18in', color: '', finish: 'Matte', exampleRollId: 'SW725M2116328', exampleWeight: '1594' },
  { vendor: 'Sustana', product: 'Opaque Couverture/Cover True White Lisse', basisWeight: '80lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02389836', exampleWeight: '980' },
  { vendor: 'Domtar', product: 'Lynx Digital Text', basisWeight: '70lb', size: '18x40in', color: 'White', finish: 'Smooth', exampleRollId: 'DTJ13A2922300', exampleWeight: '1306' },
  { vendor: 'Sustana', product: 'HiTech InkJet True White Lisse', basisWeight: '70lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02439806', exampleWeight: '2071' },
  { vendor: 'Sappi', product: 'Opus Matte Web 100LB Text', basisWeight: '100lb', size: '18in', color: '', finish: 'Matte', exampleRollId: 'SW725G2613399', exampleWeight: '1416' },
  { vendor: 'Billerud', product: 'Voyager PTS SB 14pt', basisWeight: '119lb', size: '10in', color: '', finish: '', exampleRollId: 'RA6C061073', exampleWeight: '780' },
  { vendor: 'Domtar', product: 'Husky Opaque Offset', basisWeight: '60lb', size: '17.5x40in', color: 'White', finish: 'Smooth', exampleRollId: 'DTJ14L2302321', exampleWeight: '1256' },
  { vendor: 'ND Paper', product: 'Oxford C1S Hi Bright', basisWeight: '70lb', size: '46.5in', color: '', finish: 'C1S', exampleRollId: '7S6E04052B', exampleWeight: '3933' },
  { vendor: 'ProAmpac', product: '35# Size', basisWeight: '35lb', size: '34x50in', color: '', finish: '', exampleRollId: 'UPM16E26353Z0', exampleWeight: '1670' },
  { vendor: 'Holmen', product: 'Invercote G', basisWeight: '14.2pt caliper', size: '10in', color: 'White', finish: 'C1S', exampleRollId: '414880-1-20', exampleWeight: '758' },
  { vendor: 'WestRock', product: 'KraftPak 20pt', basisWeight: '20pt caliper', size: '20in', color: '', finish: '', exampleRollId: 'E44H25093E', exampleWeight: '3749' },
  { vendor: 'WestRock', product: '8PT C1S Printers Edge', basisWeight: '8pt caliper', size: '11.5in', color: '', finish: 'C1S', exampleRollId: 'DX6F080058', exampleWeight: '1704' },
  { vendor: 'Neenah', product: 'Conservation Writing', basisWeight: '24lb', size: '18in', color: 'White PC 100', finish: 'Smooth', exampleRollId: '120181MP', exampleWeight: '2210' },
  { vendor: 'Sustana', product: 'HiTech InkJet True White Lisse', basisWeight: '70lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02449900', exampleWeight: '2037' },
  { vendor: 'Domtar', product: 'Husky Opaque Offset', basisWeight: '60lb', size: '18x50in', color: 'White', finish: 'Smooth', exampleRollId: 'DWW75B2263377', exampleWeight: '2147' },
  { vendor: 'Sappi', product: 'Opus PS Glos Web 9PT Cover', basisWeight: '87lb', size: '20in', color: '', finish: 'Gloss', exampleRollId: 'SW716E1715410', exampleWeight: '1444' },
  { vendor: 'Norpac', product: '7PT Norbrite Reply', basisWeight: '7pt caliper', size: '45.7cm', color: '', finish: '', exampleRollId: 'NW26D16173P', exampleWeight: '326' },
  { vendor: 'Sylvamo', product: 'Simply Inkjet', basisWeight: '70lb', size: '18x50in', color: '', finish: '', exampleRollId: 'E16D18302U', exampleWeight: '1121' },
  { vendor: 'Sustana', product: 'HiTech InkJet True White', basisWeight: '60lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02414031', exampleWeight: '2065' },
  { vendor: 'Sustana', product: 'HiTech InkJet True White', basisWeight: '60lb', size: '18in', color: 'True White', finish: 'Smooth', exampleRollId: '02453309', exampleWeight: '2050' },
];

// Builds a key used to detect "is this roll type already in the
// library?" so running the seed twice never creates duplicate entries.
function templateKey(entry) {
  return [entry.vendor, entry.product, entry.basisWeight, entry.exampleRollId]
    .join('|')
    .toUpperCase();
}

// Adds every known roll type that isn't already present. Returns
// { added, skipped } counts.
export async function seedTemplateLibrary() {
  const existing = await getTemplates();
  const existingKeys = new Set(existing.map(templateKey));

  let added = 0;
  let skipped = 0;

  for (const entry of KNOWN_ROLL_TYPES) {
    if (existingKeys.has(templateKey(entry))) {
      skipped++;
      continue;
    }

    await saveTemplate({
      vendor: entry.vendor,
      product: entry.product,
      basisWeight: entry.basisWeight,
      size: entry.size,
      color: entry.color,
      finish: entry.finish,
      imageUri: '',
      ocrText: '',
      rollNumber: entry.exampleRollId,
      weight: entry.exampleWeight,
      rollBox: null,
      weightBox: null,
    });

    added++;
  }

  return { added, skipped, total: KNOWN_ROLL_TYPES.length };
}