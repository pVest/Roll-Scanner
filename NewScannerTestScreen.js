// ===== NEW SCANNER TEST SCREEN (V3 - LIVE MODE + CONSENSUS) =====
// Isolated screen to try out the barcode-first pipeline WITHOUT touching
// the existing ScannerScreen / manifest flow. Reachable from the manifest
// screen via a "Test New Scanner" button.
//
// Pipeline:
//   1. Camera scans barcodes continuously in the background the whole
//      time the preview is showing (BarcodeService.useBarcodeScanner)
//   2. On every new barcode seen, BarcodeInterpreter re-runs against
//      everything accumulated SO FAR.
//   3. Each field (Roll ID, Weight) goes through THREE states:
//        EMPTY (gray "—")   - nothing plausible seen yet
//        CANDIDATE (yellow) - something plausible seen, but not read
//                             consistently enough yet to trust - MAY
//                             still change to a different value if a
//                             later, more-consistent reading disagrees
//                             (this is what protects against a single
//                             misread frame becoming the "final" answer)
//        LOCKED (green)     - seen the SAME value at least
//                             CONSENSUS_THRESHOLD times in a row -
//                             considered final, a short vibration fires
//                             at the exact moment of this transition,
//                             and the field never changes itself again
//                             (only an explicit user action - Edit or
//                             double-tap-to-reset - can change it after
//                             this point)
//   4. Once BOTH fields are LOCKED, a "Done" button appears, leading to
//      ConfirmScreen - no photo is taken or needed for this path at all.
//   5. Either field, locked or not, can be tapped: a SINGLE tap opens a
//      small inline edit box (type the correct value by hand); a DOUBLE
//      tap (two taps within DOUBLE_TAP_WINDOW_MS) just clears that one
//      field back to empty, so the user can re-aim the camera at it.
//   6. ConfirmScreen: Accept / Edit Manually / Start Over. Accept teaches
//      the Learning Library (see LearningLibraryService) so the SAME
//      label format is interpreted faster and more confidently next time.
//
// OCR is NOT used in this flow - it has no role when both fields come
// from live barcode scanning. (OCR-based Template Library matching is on
// pause per current project priorities - see ScanEngine, which still
// supports it for the OLDER photo-based ScannerScreen flow untouched by
// this rewrite.)
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  TextInput,
  Vibration,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import ScanFrameOverlay from './ScanFrame';
import { useBarcodeScanner, getRecentBarcodeEntries, ROLL_LABEL_BARCODE_TYPES } from './BarcodeService';
import { interpretBarcodes } from './BarcodeInterpreter';
import { getLearnedShapes } from './LearningLibraryService';
import { getAllBarcodeProfiles } from './TemplateService';
import ConfirmScreen from './ConfirmScreen';

// How many times the SAME value must be read consistently before a field
// locks in (turns green + vibrates). Tuned to be near-instant for a
// clean, well-focused barcode (camera frames arrive many times per
// second, so 3 consistent reads happens in a fraction of a second) while
// still filtering out a one-off misread frame from becoming the final
// answer on harder-to-read labels.
const CONSENSUS_THRESHOLD = 3;

// Max time between two taps on the same field to count as "double tap"
// (reset), rather than two separate single-tap (edit) actions.
const DOUBLE_TAP_WINDOW_MS = 400;

// Short vibration fired the moment a field locks in (CANDIDATE -> LOCKED).
const LOCK_VIBRATION_MS = 60;

export default function NewScannerTestScreen({ goBack, onResult }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Live-found values, updated as barcodes accumulate - independent of
  // each other, neither is cleared when the other is found.
  //
  // liveRollId / liveWeight: the current best-guess VALUE (may be a
  //   CANDIDATE that hasn't met the consensus threshold yet, or a LOCKED
  //   final value).
  // rollIdLocked / weightLocked: true once that field has reached
  //   CONSENSUS_THRESHOLD consistent reads. Once true, the live-fill
  //   effect below stops touching that field entirely - only explicit
  //   user action (edit or double-tap-reset) can change it after that.
  const [liveRollId, setLiveRollId] = useState(null);
  const [liveWeight, setLiveWeight] = useState(null);
  const [rollIdLocked, setRollIdLocked] = useState(false);
  const [weightLocked, setWeightLocked] = useState(false);
  const [liveConfidence, setLiveConfidence] = useState(0);

  // Inline manual-edit state: which field (if any) currently has its
  // small text input open, and the text being typed into it.
  const [editingField, setEditingField] = useState(null); // 'rollId' | 'weight' | null
  const [editValue, setEditValue] = useState('');

  // Tracks the timestamp of the last tap on each field, to distinguish a
  // single tap (open edit box) from a double tap (reset field).
  const lastTapRef = useRef({ rollId: 0, weight: 0 });

  // Pending single-tap timer per field - lets a fast second tap cancel
  // the edit box from opening at all, rather than opening then immediately
  // closing it (which would briefly flash the keyboard open on a
  // double-tap-to-reset, an ugly real-device side effect of the simpler
  // immediate-startEdit approach).
  const pendingTapTimerRef = useRef({ rollId: null, weight: null });

  // Learning Library shape hints, loaded once when the camera opens so
  // every live re-interpretation can use them without re-reading
  // AsyncStorage on every single barcode event.
  const [knownShapes, setKnownShapes] = useState([]);

  // Template Library barcodeProfiles - the fallback recognition path for
  // unusual Roll ID formats (see BarcodeProfileService). Loaded once
  // alongside knownShapes, same reasoning.
  const [barcodeProfiles, setBarcodeProfiles] = useState([]);

  // Tracks which template's profile (if any) produced the CURRENTLY
  // locked Roll ID, so ConfirmScreen's Accept handler can report back
  // whether the profile's guess was correct or needed correction (trial
  // period tracking - see BarcodeProfileService).
  const [matchedProfileInfo, setMatchedProfileInfo] = useState(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState(null);

  // Live barcode tracking - see BarcodeService.useBarcodeScanner. Runs
  // continuously while the camera preview is visible.
  const { barcodes, handleBarcodeScanned, clearBarcodes } = useBarcodeScanner();

  useEffect(() => {
    let isMounted = true;
    getLearnedShapes()
      .then((shapes) => {
        if (isMounted) setKnownShapes(shapes);
      })
      .catch((error) => {
        console.log('NewScannerTestScreen: could not load Learning Library shapes:', error);
      });
    getAllBarcodeProfiles()
      .then((profiles) => {
        if (isMounted) setBarcodeProfiles(profiles);
      })
      .catch((error) => {
        console.log('NewScannerTestScreen: could not load barcode profiles:', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Re-interpret barcodes EVERY time a new one is seen - this is what
  // makes the Roll ID / Weight fields fill in live. interpretBarcodes is
  // pure CPU logic (no network, no AsyncStorage call), so running it on
  // every barcode event is cheap (sub-millisecond - see prior performance
  // testing) even though it re-runs from scratch each time rather than
  // incrementally updating.
  useEffect(() => {
    if (barcodes.length === 0) return;

    const entries = getRecentBarcodeEntries(barcodes);
    const interpreted = interpretBarcodes(entries, knownShapes, barcodeProfiles);

    if (interpreted.usedBarcodeProfile && interpreted.matchedProfileTemplateId) {
      setMatchedProfileInfo({ templateId: interpreted.matchedProfileTemplateId });
    }

    // Roll ID: once LOCKED, never touched again by this effect - only
    // Edit / double-tap-reset (which also un-locks) can change it.
    if (!rollIdLocked && interpreted.rollId) {
      // Always show the current best candidate (even before consensus),
      // so the user sees yellow feedback rather than a blank field.
      setLiveRollId(interpreted.rollId);

      if (interpreted.rollIdSeenCount >= CONSENSUS_THRESHOLD) {
        setRollIdLocked(true);
        Vibration.vibrate(LOCK_VIBRATION_MS);
      }
    }

    // Weight: same logic, independent of Roll ID.
    if (!weightLocked && interpreted.weight) {
      setLiveWeight(interpreted.weight);

      if (interpreted.weightSeenCount >= CONSENSUS_THRESHOLD) {
        setWeightLocked(true);
        Vibration.vibrate(LOCK_VIBRATION_MS);
      }
    }

    if (interpreted.confidence) {
      setLiveConfidence(interpreted.confidence);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodes, rollIdLocked, weightLocked]);

  const askPermission = async () => {
    const granted = await requestPermission();
    if (!granted.granted) {
      Alert.alert('Camera Permission', 'Camera access is required to test the scanner.');
    }
  };

  // Both fields LOCKED - build the result and move to ConfirmScreen. No
  // photo is taken for this path; ConfirmScreen already tolerates a null
  // photoUri (it just skips rendering the photo preview).
  const finishScan = () => {
    setResult({
      success: true,
      rollId: liveRollId,
      weight: liveWeight,
      labelType: null, // OCR-based labelType is on pause - see header comment
      confidence: liveConfidence,
      method: { rollId: 'barcode', weight: 'barcode', labelType: null },
      timedOut: false,
      debug: {
        ocrRan: false,
        ocrText: '',
        matchedTemplateId: null,
        // If a Template Library barcodeProfile (fallback recognition
        // path) was what found this Roll ID, ConfirmScreen's Accept
        // handler uses this to record trial-period usage/correction -
        // see BarcodeProfileService.
        matchedProfileTemplateId: matchedProfileInfo?.templateId || null,
      },
    });
    setShowConfirm(true);
  };

  const startOver = () => {
    setLiveRollId(null);
    setLiveWeight(null);
    setRollIdLocked(false);
    setWeightLocked(false);
    setLiveConfidence(0);
    setMatchedProfileInfo(null);
    setEditingField(null);
    setEditValue('');
    setResult(null);
    setShowConfirm(false);
    clearBarcodes();

    // Cancel any pending single-tap-edit timers so a stale one doesn't
    // fire after everything else has been reset.
    if (pendingTapTimerRef.current.rollId) {
      clearTimeout(pendingTapTimerRef.current.rollId);
      pendingTapTimerRef.current.rollId = null;
    }
    if (pendingTapTimerRef.current.weight) {
      clearTimeout(pendingTapTimerRef.current.weight);
      pendingTapTimerRef.current.weight = null;
    }
  };

  // Resets ONLY one field back to empty - the other field (locked or
  // not) is left untouched. Used by double-tap.
  const resetField = (field) => {
    if (field === 'rollId') {
      setLiveRollId(null);
      setRollIdLocked(false);
    } else {
      setLiveWeight(null);
      setWeightLocked(false);
    }
    setEditingField(null);
  };

  // Opens the inline manual-edit box for one field, pre-filled with its
  // current value (if any) so the user can fix just a couple of
  // characters rather than retyping the whole thing.
  const startEdit = (field) => {
    setEditingField(field);
    setEditValue((field === 'rollId' ? liveRollId : liveWeight) || '');
  };

  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (editingField === 'rollId') {
      setLiveRollId(trimmed || null);
      setRollIdLocked(Boolean(trimmed)); // a manual entry is trusted immediately
    } else if (editingField === 'weight') {
      setLiveWeight(trimmed || null);
      setWeightLocked(Boolean(trimmed));
    }
    setEditingField(null);
    setEditValue('');
  };

  // Single tap -> open edit box, but only after waiting to make sure a
  // second tap doesn't follow (which would mean "double tap", i.e. reset
  // instead). Double tap (within DOUBLE_TAP_WINDOW_MS) -> reset that
  // field, and the pending single-tap edit never opens.
  const handleFieldTap = (field) => {
    const now = Date.now();
    const lastTap = lastTapRef.current[field];
    lastTapRef.current[field] = now;

    if (now - lastTap < DOUBLE_TAP_WINDOW_MS) {
      // This IS the second tap - cancel the pending single-tap edit that
      // was scheduled after the first tap, then reset instead.
      lastTapRef.current[field] = 0; // consume the double-tap, don't chain into a triple
      if (pendingTapTimerRef.current[field]) {
        clearTimeout(pendingTapTimerRef.current[field]);
        pendingTapTimerRef.current[field] = null;
      }
      resetField(field);
      return;
    }

    // This MIGHT be a single tap - wait out the double-tap window before
    // actually opening the edit box, in case a second tap follows.
    pendingTapTimerRef.current[field] = setTimeout(() => {
      pendingTapTimerRef.current[field] = null;
      startEdit(field);
    }, DOUBLE_TAP_WINDOW_MS);
  };

  const [showAddedToast, setShowAddedToast] = useState(false);

  const handleAccept = (finalResult) => {
    if (onResult) {
      onResult(finalResult);
      // Show a brief confirmation, then reset back to the camera for the
      // next scan - the user stays in a continuous scanning loop.
      setShowAddedToast(true);
      setTimeout(() => setShowAddedToast(false), 1500);
      startOver();
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Loading camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera Permission Required</Text>
        <Text style={styles.message}>Camera access is required to test the new scanner.</Text>
        <Pressable style={styles.mainButton} onPress={askPermission}>
          <Text style={styles.mainButtonText}>Allow Camera</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={goBack}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // Result review screen (Confirm Screen), once both fields were found
  if (showConfirm && result) {
    return (
      <View style={styles.app}>
        <View style={styles.topBar}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topTitle}>New Scanner (Test)</Text>
        </View>

        <ConfirmScreen
          photoUri={null}
          result={result}
          onAccept={handleAccept}
          onRetake={startOver}
        />
      </View>
    );
  }

  const bothLocked = Boolean(rollIdLocked && weightLocked);

  // Camera view - live mode, no photo, no countdown
  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>New Scanner (Test)</Text>
      </View>

      <View style={styles.cameraWrapper}>
        <CameraView
          style={styles.camera}
          facing="back"
          ref={cameraRef}
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ROLL_LABEL_BARCODE_TYPES }}
        />
        <ScanFrameOverlay />
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.liveFieldsRow}>
          <Pressable style={styles.liveField} onPress={() => handleFieldTap('rollId')}>
            <Text style={styles.liveFieldLabel}>Roll ID</Text>
            <Text
              style={[
                styles.liveFieldValue,
                liveRollId && (rollIdLocked ? styles.liveFieldValueLocked : styles.liveFieldValueCandidate),
              ]}
            >
              {liveRollId || '—'}
            </Text>
          </Pressable>
          <View style={styles.liveFieldDivider} />
          <Pressable style={styles.liveField} onPress={() => handleFieldTap('weight')}>
            <Text style={styles.liveFieldLabel}>Weight</Text>
            <Text
              style={[
                styles.liveFieldValue,
                liveWeight && (weightLocked ? styles.liveFieldValueLocked : styles.liveFieldValueCandidate),
              ]}
            >
              {liveWeight || '—'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.hintText}>
          {bothLocked
            ? 'Both found! Tap Done to continue.'
            : !liveRollId
            ? 'Aim at the Roll ID barcode'
            : !rollIdLocked
            ? 'Hold steady - confirming Roll ID...'
            : !liveWeight
            ? 'Now aim at the Weight barcode'
            : 'Hold steady - confirming Weight...'}
        </Text>

        {bothLocked ? (
          <Pressable style={styles.doneButton} onPress={finishScan}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.resetButton} onPress={startOver}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </Pressable>
        )}
      </View>

      {/* Floating edit overlay - rendered as a Modal so it's guaranteed to
          sit on top of everything (including the keyboard), rather than
          being a small inline TextInput at the bottom of the screen that
          the keyboard would cover up. KeyboardAvoidingView pushes this
          box up above the keyboard on both iOS and Android. */}
      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingField(null)}
      >
        <KeyboardAvoidingView
          style={styles.editModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.editModalBackdropTouchable} onPress={saveEdit}>
            <Pressable style={styles.editModalCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.editModalLabel}>
                {editingField === 'rollId' ? 'Roll ID' : 'Weight'}
              </Text>
              <TextInput
                style={styles.editModalInput}
                value={editValue}
                onChangeText={setEditValue}
                onSubmitEditing={saveEdit}
                autoFocus
                autoCapitalize={editingField === 'rollId' ? 'characters' : 'none'}
                keyboardType={editingField === 'weight' ? 'numeric' : 'default'}
                selectTextOnFocus
              />
              <Pressable style={styles.editModalDoneButton} onPress={saveEdit}>
                <Text style={styles.editModalDoneButtonText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Brief "Added to manifest ✓" confirmation that appears for 1.5s
          after Accept, confirming the roll was saved before the scanner
          resets for the next label. Rendered as an absolute-positioned
          overlay so it doesn't shift the camera layout at all. */}
      {showAddedToast && (
        <View style={styles.addedToast} pointerEvents="none">
          <Text style={styles.addedToastText}>✓ Added to manifest</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#111827' },

  topBar: {
    height: 72,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 18,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  backIcon: { color: 'white', fontSize: 38, fontWeight: '300', marginTop: -4 },
  topTitle: { color: 'white', fontSize: 20, fontWeight: '700', flex: 1 },

  cameraWrapper: { flex: 1, position: 'relative' },
  camera: { flex: 1 },

  // Raised ~10% off the bottom edge per user feedback - the fields, hint
  // text, and button all sit a bit higher above the screen's bottom edge
  // rather than hugging it directly.
  bottomPanel: { backgroundColor: '#111827', padding: 18, paddingBottom: 34, marginBottom: 24 },

  liveFieldsRow: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
  },

  liveField: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },

  liveFieldDivider: { width: 1, backgroundColor: '#374151' },

  liveFieldLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  liveFieldValue: {
    color: '#6b7280',
    fontSize: 18,
    fontWeight: '800',
  },

  // CANDIDATE state (yellow) - something plausible seen, not yet
  // confirmed by consensus. Value may still change.
  liveFieldValueCandidate: { color: '#eab308' },

  // LOCKED state (green) - consensus reached, field is final until the
  // user explicitly edits or resets it.
  liveFieldValueLocked: { color: '#22c55e' },

  // Floating edit Modal - rendered on top of everything (including the
  // keyboard), so the field being edited is always fully visible no
  // matter how tall the on-screen keyboard is.
  editModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
  },

  editModalBackdropTouchable: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  editModalCard: {
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },

  editModalLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: 'center',
  },

  editModalInput: {
    color: 'white',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingVertical: 10,
    marginBottom: 20,
  },

  editModalDoneButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
  },

  editModalDoneButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },

  hintText: { color: '#d1d5db', fontSize: 15, textAlign: 'center', marginBottom: 12 },

  doneButton: { backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 10 },
  doneButtonText: { color: 'white', fontSize: 18, fontWeight: '800', textAlign: 'center' },

  resetButton: { backgroundColor: '#374151', paddingVertical: 14, borderRadius: 10 },
  resetButtonText: { color: '#d1d5db', fontSize: 15, fontWeight: '700', textAlign: 'center' },

  addedToast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: '#16a34a',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  addedToastText: { color: 'white', fontSize: 16, fontWeight: '800' },

  mainButton: { backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 10, marginBottom: 12, width: '100%' },
  mainButtonText: { color: 'white', fontSize: 18, fontWeight: '800', textAlign: 'center' },

  cancelButton: { marginTop: 14, paddingVertical: 14 },
  cancelButtonText: { color: '#6b7280', fontSize: 17, fontWeight: '700', textAlign: 'center' },

  center: { flex: 1, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 12, textAlign: 'center' },
  message: { fontSize: 16, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
});