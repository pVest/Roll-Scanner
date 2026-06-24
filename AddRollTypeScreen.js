// ===== ADD ROLL TYPE SCREEN (two-step, difficult rolls only) =====
// This is the NEW way to add a roll type to Template Library, replacing
// AddTemplateScreen for the specific purpose of teaching the scanner
// about a roll type that doesn't recognize correctly on its own (e.g.
// the original Sustana problem).
//
// WHY TWO STEPS, AND WHY THIS FIXES THE PREVIOUS GAP:
//   AddTemplateScreen took a single static PHOTO and asked the user to
//   manually confirm Roll ID/Weight as text. That worked for the visible
//   TEXT fields (vendor, product, basis weight, etc - OCR reads photos
//   fine), but barcodes are NOT text - recognizing what shapes of dark/
//   light bars are actually barcodes (and what values they encode)
//   requires expo-camera's live barcode scanner, which only works on a
//   live camera feed, not a saved photo. So AddTemplateScreen had no way
//   to know about OTHER barcodes on the label (e.g. Sustana's "No.
//   Position" service codes) - it only knew about the Roll ID/Weight the
//   user typed in, and assumed zero other barcodes existed. That
//   assumption broke recognition on any real scan where the camera
//   (correctly) saw those extra barcodes.
//
//   STEP 1 (this screen): hold the camera on the label for a few seconds
//   - the SAME live barcode scanner used during normal scanning runs
//   here too, so it sees Roll ID, Weight, AND every other barcode on the
//   label, exactly like a real future scan will.
//   STEP 2: take one photo, run OCR, fill in vendor/product/basis weight/
//   size/color/finish automatically (same as AddTemplateScreen did).
//
//   Combining both gives generateBarcodeProfile() a COMPLETE picture - it
//   knows exactly how many "noise" barcodes to expect, the same
//   knowledge a developer manually reading the photo would have had when
//   hand-writing a fix like the original Sustana one.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  Alert,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import ScanFrameOverlay from './ScanFrame';
import { useBarcodeScanner, getRecentBarcodeValues, ROLL_LABEL_BARCODE_TYPES } from './BarcodeService';
import { readTextFromImage } from './OCRService';
import { parseTemplateFields } from './TemplateFieldParser';
import { saveTemplate } from './TemplateService';
import { generateBarcodeProfile } from './BarcodeProfileService';
import { recordConfirmation } from './LearningLibraryService';
import { cropToScanFrame } from './ImageRegionService';

// Minimum seconds to hold the camera on the label during Step 1, so the
// live scanner has a real chance to see every barcode present (not just
// whichever one happens to be centered first).
const MIN_SCAN_SECONDS = 4;

export default function AddRollTypeScreen({ goBack }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Which step the user is on: 'scan' (Step 1) -> 'photo' (Step 2) -> 'review'
  const [step, setStep] = useState('scan');

  // ---- Step 1 state: live barcode scanning ----
  const { barcodes, handleBarcodeScanned, clearBarcodes } = useBarcodeScanner();
  const [scanSecondsElapsed, setScanSecondsElapsed] = useState(0);
  const [confirmedRollId, setConfirmedRollId] = useState('');
  const [confirmedWeight, setConfirmedWeight] = useState('');
  const [allSeenBarcodes, setAllSeenBarcodes] = useState([]);

  // ---- Step 2 state: photo + OCR ----
  const [photoUri, setPhotoUri] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [ocrText, setOcrText] = useState('');

  // ---- Review/save state: all fields editable before saving ----
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState('');
  const [basisWeight, setBasisWeight] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [finish, setFinish] = useState('');

  // Step 1 timer - counts up while the camera is held on the label
  useEffect(() => {
    if (step !== 'scan') return;
    const timer = setInterval(() => {
      setScanSecondsElapsed((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  // Keep a running record of every distinct barcode value seen during
  // Step 1, regardless of whether it's been classified as Roll ID/Weight
  // yet - this is what lets the final profile know the TRUE noise-barcode
  // count, fixing the gap described in the header comment.
  useEffect(() => {
    if (barcodes.length === 0) return;
    setAllSeenBarcodes(getRecentBarcodeValues(barcodes));
  }, [barcodes]);

  const askPermission = async () => {
    const granted = await requestPermission();
    if (!granted.granted) {
      Alert.alert('Camera Permission', 'Camera access is required to add a roll type.');
    }
  };

  // Step 1 -> Step 2: requires the user to have manually confirmed which
  // barcode is the Roll ID and which is the Weight (typed in below the
  // camera), and to have held the camera for at least MIN_SCAN_SECONDS.
  const proceedToPhotoStep = () => {
    if (!confirmedRollId.trim() || !confirmedWeight.trim()) {
      Alert.alert('Missing Info', 'Please enter the Roll ID and Weight you see on the barcodes below.');
      return;
    }
    if (scanSecondsElapsed < MIN_SCAN_SECONDS) {
      Alert.alert(
        'Keep Scanning',
        `Please hold the camera on the label for at least ${MIN_SCAN_SECONDS} seconds, so it can see every barcode on it.`
      );
      return;
    }
    setStep('photo');
  };

  // Step 2: capture photo + run OCR, then auto-fill the review fields
  const captureAndRead = async () => {
    if (isCapturing || !cameraRef.current) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: true });
      const cropped = await cropToScanFrame(photo.uri, photo.width, photo.height);
      const finalPhoto = cropped?.uri ? cropped : { uri: photo.uri, base64: photo.base64 };

      setPhotoUri(finalPhoto.uri);
      setPhotoBase64(finalPhoto.base64);
      setIsCapturing(false);

      setIsReading(true);
      const text = await readTextFromImage(finalPhoto.base64);
      setOcrText(text);

      const fields = parseTemplateFields(text);
      setVendor(fields.vendor);
      setProduct(fields.product);
      setBasisWeight(fields.basisWeight);
      setSize(fields.size);
      setColor(fields.color);
      setFinish(fields.finish);

      setStep('review');
    } catch (error) {
      console.log('AddRollTypeScreen capture/OCR error:', error);
      Alert.alert('Error', 'Could not capture or read the photo. Please try again.');
    } finally {
      setIsCapturing(false);
      setIsReading(false);
    }
  };

  // Final save: combines Step 1's complete barcode picture with Step 2's
  // text fields into one Template Library record with a full, accurate
  // barcodeProfile.
  const saveRollType = async () => {
    if (!vendor.trim()) {
      Alert.alert('Missing Info', 'Please enter a Vendor name.');
      return;
    }

    // Every barcode seen in Step 1 that ISN'T the confirmed Roll ID or
    // Weight is "noise" - this is the complete picture AddTemplateScreen
    // never had.
    const otherBarcodeValues = allSeenBarcodes.filter(
      (v) => v !== confirmedRollId.trim() && v !== confirmedWeight.trim()
    );

    const barcodeProfile = generateBarcodeProfile({
      rollId: confirmedRollId.trim(),
      weight: confirmedWeight.trim(),
      otherBarcodeValues,
    });

    const savedTemplate = await saveTemplate({
      vendor: vendor.trim(),
      product: product.trim(),
      basisWeight: basisWeight.trim(),
      size: size.trim(),
      color: color.trim(),
      finish: finish.trim(),
      imageUri: photoUri,
      ocrText,
      rollNumber: confirmedRollId.trim(),
      weight: confirmedWeight.trim(),
      rollBox: null,
      weightBox: null,
      barcodeProfile,
    });

    try {
      await recordConfirmation({
        rollId: confirmedRollId.trim(),
        weight: confirmedWeight.trim(),
        wasGuessCorrect: true,
        templateId: savedTemplate.id,
      });
    } catch (linkError) {
      console.log('AddRollTypeScreen: failed to link to Learning Library:', linkError);
    }

    Alert.alert(
      'Roll Type Saved',
      `${savedTemplate.vendor} ${savedTemplate.product}\n\nRecognition rule saved with ${otherBarcodeValues.length} other barcode${
        otherBarcodeValues.length === 1 ? '' : 's'
      } on the label correctly accounted for - check Template Library to see the full rule.`
    );

    goBack();
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
        <Pressable style={styles.mainButton} onPress={askPermission}>
          <Text style={styles.mainButtonText}>Allow Camera</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={goBack}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // ---- STEP 1: live barcode scan ----
  if (step === 'scan') {
    return (
      <View style={styles.app}>
        <View style={styles.topBar}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topTitle}>Add Roll Type - Step 1 of 2</Text>
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

        <ScrollView style={styles.bottomPanel}>
          <Text style={styles.stepLabel}>STEP 1: Scan all barcodes</Text>
          <Text style={styles.hintText}>
            Hold the camera on the label for {MIN_SCAN_SECONDS} seconds. This lets the scanner
            see every barcode on it (including ones we don't need), not just the Roll ID and Weight.
          </Text>

          <Text style={styles.barcodeCount}>
            {allSeenBarcodes.length} barcode{allSeenBarcodes.length === 1 ? '' : 's'} seen
            {scanSecondsElapsed < MIN_SCAN_SECONDS ? ` · ${MIN_SCAN_SECONDS - scanSecondsElapsed}s left` : ' · ready'}
          </Text>

          <Text style={styles.fieldLabel}>Which one is the Roll ID?</Text>
          <TextInput
            style={styles.input}
            value={confirmedRollId}
            onChangeText={setConfirmedRollId}
            placeholder="Type the Roll ID you see"
            autoCapitalize="characters"
          />

          <Text style={styles.fieldLabel}>Which one is the Weight?</Text>
          <TextInput
            style={styles.input}
            value={confirmedWeight}
            onChangeText={setConfirmedWeight}
            placeholder="Type the Weight you see"
            keyboardType="numeric"
          />

          <Pressable style={styles.nextButton} onPress={proceedToPhotoStep}>
            <Text style={styles.nextButtonText}>Next: Take Photo →</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ---- STEP 2: photo + OCR ----
  if (step === 'photo') {
    return (
      <View style={styles.app}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setStep('scan')} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topTitle}>Add Roll Type - Step 2 of 2</Text>
        </View>

        <View style={styles.cameraWrapper}>
          <CameraView style={styles.camera} facing="back" ref={cameraRef} />
          <ScanFrameOverlay />
        </View>

        <View style={styles.bottomPanel}>
          <Text style={styles.stepLabel}>STEP 2: Photo for text details</Text>
          <Text style={styles.hintText}>
            Fit the whole label in the frame, then take the photo. We'll read the
            vendor, product, and other details automatically.
          </Text>

          {isCapturing || isReading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={styles.message}>
                {isCapturing ? 'Capturing...' : 'Reading label details...'}
              </Text>
            </View>
          ) : (
            <Pressable style={styles.nextButton} onPress={captureAndRead}>
              <Text style={styles.nextButtonText}>Take Photo & Read</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ---- REVIEW: confirm/edit all fields, then save ----
  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={() => setStep('photo')} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Review & Save</Text>
      </View>

      <ScrollView style={styles.content}>
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.previewImage} /> : null}

        <Text style={styles.fieldLabel}>Vendor</Text>
        <TextInput style={styles.input} value={vendor} onChangeText={setVendor} />

        <Text style={styles.fieldLabel}>Product</Text>
        <TextInput style={styles.input} value={product} onChangeText={setProduct} />

        <Text style={styles.fieldLabel}>Basis Weight</Text>
        <TextInput style={styles.input} value={basisWeight} onChangeText={setBasisWeight} />

        <Text style={styles.fieldLabel}>Size</Text>
        <TextInput style={styles.input} value={size} onChangeText={setSize} />

        <Text style={styles.fieldLabel}>Color</Text>
        <TextInput style={styles.input} value={color} onChangeText={setColor} />

        <Text style={styles.fieldLabel}>Finish</Text>
        <TextInput style={styles.input} value={finish} onChangeText={setFinish} />

        <Text style={styles.fieldLabel}>Roll ID (from Step 1)</Text>
        <TextInput style={styles.input} value={confirmedRollId} onChangeText={setConfirmedRollId} />

        <Text style={styles.fieldLabel}>Weight (from Step 1)</Text>
        <TextInput style={styles.input} value={confirmedWeight} onChangeText={setConfirmedWeight} />

        <Text style={styles.noiseInfo}>
          {allSeenBarcodes.length - (confirmedRollId ? 1 : 0) - (confirmedWeight ? 1 : 0) > 0
            ? `${allSeenBarcodes.length - 2} other barcode(s) on this label will be remembered as "ignore" for this roll type.`
            : 'No other barcodes were seen on this label.'}
        </Text>

        <Pressable style={styles.saveButton} onPress={saveRollType}>
          <Text style={styles.saveButtonText}>Save Roll Type</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  topBar: {
    backgroundColor: '#111827',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: { marginRight: 12 },
  backIcon: { color: 'white', fontSize: 28 },
  topTitle: { color: 'white', fontSize: 17, fontWeight: '700', flex: 1 },

  title: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 16, textAlign: 'center' },
  message: { fontSize: 15, color: '#6b7280', textAlign: 'center', marginTop: 10 },

  mainButton: { backgroundColor: '#2563eb', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 10 },
  mainButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },
  cancelButton: { marginTop: 14 },
  cancelButtonText: { color: '#6b7280', fontSize: 15 },

  cameraWrapper: { flex: 1, position: 'relative' },
  camera: { flex: 1 },

  bottomPanel: { backgroundColor: '#111827', padding: 18, maxHeight: '55%' },

  stepLabel: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  hintText: { color: '#d1d5db', fontSize: 14, marginBottom: 12 },

  barcodeCount: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 14,
  },

  fieldLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 4,
  },

  input: {
    backgroundColor: 'white',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    marginBottom: 12,
  },

  nextButton: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 10, marginTop: 8 },
  nextButtonText: { color: 'white', fontSize: 17, fontWeight: '800', textAlign: 'center' },

  content: { flex: 1, padding: 16 },

  previewImage: { width: '100%', height: 220, borderRadius: 12, marginBottom: 16, backgroundColor: '#e5e7eb' },

  noiseInfo: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    marginTop: 8,
    marginBottom: 16,
  },

  saveButton: { backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 10, marginBottom: 30 },
  saveButtonText: { color: 'white', fontSize: 17, fontWeight: '800', textAlign: 'center' },
});