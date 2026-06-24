// ===== ADD TEMPLATE SCREEN =====
// This screen trains the scanner using a real roll label photo.
// The user takes a photo, reads OCR, confirms Vendor / Roll Number / Weight,
// and drags two boxes onto the photo to mark where the Roll Number and
// Weight actually are. Those boxes are saved with the template and later
// used by the scanner to crop and OCR just those small areas.

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

// OCR service reads text from the captured photo
import { readTextFromImage } from './OCRService';

// Extracts Roll ID / Weight from raw OCR text
import { findRollNumber, findWeight } from './OCRParser';

// Auto-fills vendor/product/basisWeight/size/color/finish from raw OCR
// text - reduces manual typing when adding a new roll type
import { parseTemplateFields } from './TemplateFieldParser';

// Template service saves confirmed label examples
import { saveTemplate } from './TemplateService';

// Generates automatic barcode-recognition rules for unusual Roll ID
// formats (see plan discussion - "the Sustana problem", solved generically)
import { generateBarcodeProfile } from './BarcodeProfileService';

// Links a newly added template's Roll ID shape to the Learning Library
// immediately, so usage can be counted automatically on future scans
// without waiting for OCR to discover the link some other way
import { recordConfirmation } from './LearningLibraryService';

// Draggable boxes used to mark Roll Number and Weight areas
import RegionBox from './RegionBox';

// Computes where a "contain"-resized image actually sits inside its box
import { getContainRect } from './ImageLayout';

// Crops a freshly captured photo down to the on-screen Scan Frame
import { cropToScanFrame } from './ImageRegionService';

// Green guide frame overlay shown on the camera screen
import ScanFrameOverlay from './ScanFrame';

// How many seconds the camera waits (showing a countdown) before it
// automatically takes the photo. The user can also tap "Capture Now".
const AUTO_CAPTURE_SECONDS = 2;

// Reasonable starting positions for the two boxes (normalized 0-1)
const DEFAULT_ROLL_BOX = { x: 0.15, y: 0.40, width: 0.50, height: 0.10 };
const DEFAULT_WEIGHT_BOX = { x: 0.55, y: 0.25, width: 0.25, height: 0.10 };

export default function AddTemplateScreen({ goBack }) {
  // Camera permission state
  const [permission, requestPermission] = useCameraPermissions();

  // Camera reference used to take a photo
  const cameraRef = useRef(null);

  // Captured photo data
  const [photoUri, setPhotoUri] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);

  // Pixel dimensions of the captured photo (needed so the saved boxes line
  // up with the real photo, not just the on-screen preview box)
  const [photoSize, setPhotoSize] = useState({ width: 0, height: 0 });

  // OCR and saving states
  const [isReading, setIsReading] = useState(false);
  const [ocrText, setOcrText] = useState('');

  // True while a photo is being captured/cropped (prevents double-capture)
  const [isCapturing, setIsCapturing] = useState(false);

  // Seconds left before the camera auto-captures, shown as a countdown
  // badge below the green frame.
  const [countdown, setCountdown] = useState(AUTO_CAPTURE_SECONDS);

  // User-confirmed template fields
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState('');
  const [basisWeight, setBasisWeight] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [finish, setFinish] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [weight, setWeight] = useState('');

  // Roll Number Box / Weight Box areas, normalized 0-1 relative to the photo
  const [rollBox, setRollBox] = useState(DEFAULT_ROLL_BOX);
  const [weightBox, setWeightBox] = useState(DEFAULT_WEIGHT_BOX);

  // Pixel size of the on-screen preview container (from onLayout)
  const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });

  // Request camera permission
  const askPermission = async () => {
    const result = await requestPermission();

    if (!result.granted) {
      Alert.alert('Camera Permission', 'Camera access is required to add templates.');
    }
  };

  // Capture label photo, then immediately crop it down to the green Scan
  // Frame (+ tolerance) so it matches the framing the scanner will use.
  const takePhoto = async () => {
    if (isCapturing) return;

    if (!cameraRef.current) {
      // Camera view isn't mounted yet - try again in a moment
      setCountdown(1);
      return;
    }

    setIsCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });

      const cropped = await cropToScanFrame(photo.uri, photo.width, photo.height);

      if (cropped?.uri) {
        setPhotoUri(cropped.uri);
        setPhotoBase64(cropped.base64);
        setPhotoSize({ width: cropped.width, height: cropped.height });
      } else {
        // Fallback: use the uncropped photo if cropping fails for any reason
        setPhotoUri(photo.uri);
        setPhotoBase64(photo.base64);
        setPhotoSize({ width: photo.width, height: photo.height });
      }

      setOcrText('');
    } catch (error) {
      console.log(error);
      Alert.alert('Camera Error', 'Could not take photo.');
    } finally {
      setIsCapturing(false);
    }
  };

  // Clear photo and start again
  const retakePhoto = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
    setPhotoSize({ width: 0, height: 0 });
    setOcrText('');
    setVendor('');
    setProduct('');
    setBasisWeight('');
    setSize('');
    setColor('');
    setFinish('');
    setRollNumber('');
    setWeight('');
    setRollBox(DEFAULT_ROLL_BOX);
    setWeightBox(DEFAULT_WEIGHT_BOX);
    setCountdown(AUTO_CAPTURE_SECONDS);
  };

  // Auto-capture countdown: while the camera view is shown (no photo yet),
  // count down once per second and take the photo automatically at 0.
  // Resets whenever the user retakes the photo.
  useEffect(() => {
    if (photoUri || !permission?.granted || isCapturing) return;

    if (countdown <= 0) {
      takePhoto();
      return;
    }

    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);

    return () => clearTimeout(timer);
  }, [countdown, photoUri, permission?.granted, isCapturing]);

  // Read OCR text from captured photo, then auto-fill every form field
  // from it - vendor/product/basisWeight/size/color/finish via
  // TemplateFieldParser, Roll ID/Weight via the same OCRParser functions
  // the live scanner's OCR fallback uses. The user only needs to review
  // and correct anything OCR got wrong, rather than typing every field
  // from scratch.
  const readPhoto = async () => {
    if (isReading) return;

    if (!photoBase64) {
      Alert.alert('OCR Error', 'No photo data found. Please retake the photo.');
      return;
    }

    setIsReading(true);

    try {
      const text = await readTextFromImage(photoBase64);
      setOcrText(text);

      const fields = parseTemplateFields(text);
      setVendor(fields.vendor);
      setProduct(fields.product);
      setBasisWeight(fields.basisWeight);
      setSize(fields.size);
      setColor(fields.color);
      setFinish(fields.finish);

      const detectedRollNumber = findRollNumber(text);
      const detectedWeight = findWeight(text);
      setRollNumber(detectedRollNumber);
      setWeight(detectedWeight);

      const missingFields = [
        !fields.vendor && 'Vendor',
        !detectedRollNumber && 'Roll Number',
        !detectedWeight && 'Weight',
      ].filter(Boolean);

      Alert.alert(
        'OCR Complete',
        missingFields.length > 0
          ? `Most fields filled in automatically. Please check/fill in: ${missingFields.join(', ')}.`
          : 'Fields filled in automatically - review and correct anything OCR got wrong, then save.'
      );
    } catch (error) {
      console.log(error);
      Alert.alert('OCR Error', 'Could not read text from this photo.');
    } finally {
      setIsReading(false);
    }
  };

  // Save confirmed template with Roll Number Box and Weight Box
  const saveCurrentTemplate = async () => {
    if (!photoUri || !ocrText) {
      Alert.alert('Template Error', 'Please read OCR before saving template.');
      return;
    }

    if (!vendor.trim() || !rollNumber.trim() || !weight.trim()) {
      Alert.alert('Missing Data', 'Please enter Vendor, Roll Number, and Weight.');
      return;
    }

    const trimmedRollNumber = rollNumber.trim();
    const trimmedWeight = weight.trim();

    // Auto-generate a barcodeProfile ONLY if the Roll ID format isn't
    // already something the standard heuristics handle on their own
    // (mixed letters+digits, 6+ chars - covers Domtar, Sappi, Holmen,
    // and most vendors). A profile is only useful as a fallback for
    // unusual formats the standard path can't recognize - generating one
    // unconditionally would just add unused data for the common case.
    //
    // NOTE: this screen doesn't do live barcode scanning (it's OCR-only),
    // so there's no way to know what OTHER barcodes appear on this label
    // (e.g. Sustana's "No. Position" service codes) - otherBarcodeValues
    // is passed as empty. This means expectedNoiseBarcodeCount will be 0,
    // making the context-match check strict (requires an exact-or-close
    // match of 0 other barcodes on future scans). This is a known,
    // acceptable limitation of adding a template through a static photo
    // rather than live scanning - it's still strictly better than no
    // profile at all, since the shape/leading-zero/weight-range checks
    // still apply and do most of the disambiguation work.
    const isMixedFormat = !/^\d+$/.test(trimmedRollNumber);
    const needsProfile = !isMixedFormat || trimmedRollNumber.length < 6;
    const barcodeProfile = needsProfile
      ? generateBarcodeProfile({
          rollId: trimmedRollNumber,
          weight: trimmedWeight,
          otherBarcodeValues: [],
        })
      : null;

    const savedTemplate = await saveTemplate({
      vendor: vendor.trim(),
      product: product.trim(),
      basisWeight: basisWeight.trim(),
      size: size.trim(),
      color: color.trim(),
      finish: finish.trim(),
      imageUri: photoUri,
      ocrText,
      rollNumber: trimmedRollNumber,
      weight: trimmedWeight,
      rollBox,
      weightBox,
      barcodeProfile,
    });

    // LINK this template's Roll ID shape to the Learning Library right
    // now, rather than waiting for it to happen automatically on some
    // future scan. Without this, Template Library could show "Scanned 0
    // times" indefinitely even after many real scans of this roll type,
    // because the high-confidence auto-confirm mechanism (see
    // ConfirmScreen) only credits a template whose shape is ALREADY
    // linked - it has no way to discover the link on its own. This one
    // photo IS a genuine confirmation (the user just verified these
    // exact values), so confirmedCount starting at 1 here is accurate,
    // not an inflated guess.
    try {
      await recordConfirmation({
        rollId: trimmedRollNumber,
        weight: trimmedWeight,
        wasGuessCorrect: true,
        templateId: savedTemplate.id,
      });
    } catch (linkError) {
      console.log('AddTemplateScreen: failed to link template to Learning Library:', linkError);
      // Non-fatal - the template itself is still saved either way, it
      // just won't auto-credit usage until OCR links it some other way
    }

    Alert.alert(
      'Template Saved',
      `Vendor: ${savedTemplate.vendor}\nRoll Number: ${savedTemplate.rollNumber}\nWeight: ${savedTemplate.weight}${
        barcodeProfile
          ? '\n\nThis Roll ID format was unusual, so a recognition profile was generated automatically - future scans of this roll type should now be recognized even without OCR.'
          : ''
      }\n\nFuture scans of this roll type will now be counted automatically in Template Library.\n\nScan areas saved. You can adjust them anytime from Template Library -> Set Areas.`
    );

    retakePhoto();
  };

  // Camera permission loading
  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Loading camera permission...</Text>
      </View>
    );
  }

  // Permission not granted yet
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera Permission Required</Text>
        <Text style={styles.message}>
          Camera access is required to add label templates.
        </Text>

        <Pressable style={styles.mainButton} onPress={askPermission}>
          <Text style={styles.mainButtonText}>Allow Camera</Text>
        </Pressable>

        <Pressable style={styles.cancelButton} onPress={goBack}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // Photo preview and template form
  if (photoUri) {
    // Where the photo is actually drawn inside the preview box, accounting
    // for resizeMode="contain" letterboxing. Boxes are positioned and saved
    // relative to THIS rectangle so normalized coordinates line up with the
    // real photo pixels (needed for accurate cropping later).
    const containRect = getContainRect(
      containerLayout.width,
      containerLayout.height,
      photoSize.width,
      photoSize.height
    );

    return (
      <View style={styles.app}>
        <View style={styles.topBar}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topTitle}>Add Template</Text>
        </View>

        
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={true}
          >
          <Text style={styles.sectionTitle}>Set Scan Areas</Text>

          <Text style={styles.helperText}>
            Move BLUE box to Roll Number. Move GREEN box to Weight. Drag the
            corner circle to resize.
          </Text>

          <View
            style={styles.imageEditor}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setContainerLayout({ width, height });
            }}
          >
            <Image
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              resizeMode="contain"
            />

            {containRect.width > 0 && containRect.height > 0 && (
              <View
                style={{
                  position: 'absolute',
                  left: containRect.x,
                  top: containRect.y,
                  width: containRect.width,
                  height: containRect.height,
                }}
              >
                <RegionBox
                  label="ROLL #"
                  color="#2563eb"
                  box={rollBox}
                  containerWidth={containRect.width}
                  containerHeight={containRect.height}
                  onChange={setRollBox}
                />

                <RegionBox
                  label="WEIGHT"
                  color="#22c55e"
                  box={weightBox}
                  containerWidth={containRect.width}
                  containerHeight={containRect.height}
                  onChange={setWeightBox}
                />
              </View>
            )}
          </View>

          {isReading && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={styles.loadingText}>Reading OCR...</Text>
            </View>
          )}

          <Pressable style={styles.readButton} onPress={readPhoto} disabled={isReading}>
            <Text style={styles.buttonText}>
              {isReading ? 'Reading OCR...' : 'Read OCR'}
            </Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Confirmed Template Data</Text>

          <TextInput
            style={styles.input}
            placeholder="Vendor (e.g. Domtar)"
            value={vendor}
            onChangeText={setVendor}
          />

          <TextInput
            style={styles.input}
            placeholder="Product (e.g. LynxJet)"
            value={product}
            onChangeText={setProduct}
          />

          <TextInput
            style={styles.input}
            placeholder="Basis Weight (e.g. 60lb)"
            value={basisWeight}
            onChangeText={setBasisWeight}
          />

          <TextInput
            style={styles.input}
            placeholder="Size (e.g. 18x50in)"
            value={size}
            onChangeText={setSize}
          />

          <TextInput
            style={styles.input}
            placeholder="Color (e.g. White)"
            value={color}
            onChangeText={setColor}
          />

          <TextInput
            style={styles.input}
            placeholder="Finish (e.g. Smooth)"
            value={finish}
            onChangeText={setFinish}
          />

          <TextInput
            style={styles.input}
            placeholder="Correct Roll Number"
            value={rollNumber}
            onChangeText={setRollNumber}
          />

          <TextInput
            style={styles.input}
            placeholder="Correct Weight"
            value={weight}
            onChangeText={setWeight}
            keyboardType="numeric"
          />

          <Pressable style={styles.saveButton} onPress={saveCurrentTemplate}>
            <Text style={styles.buttonText}>Save Template</Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={retakePhoto}>
            <Text style={styles.secondaryButtonText}>Retake Photo</Text>
          </Pressable>

          {ocrText ? (
            <View style={styles.ocrBox}>
              <Text style={styles.ocrTitle}>OCR Text</Text>
              <Text style={styles.ocrText}>{ocrText}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // Camera view
  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Add Template</Text>
      </View>

      <View style={styles.cameraWrapper}>
        <CameraView
          style={styles.camera}
          facing="back"
          ref={cameraRef}
        />

        <ScanFrameOverlay countdown={countdown} />
      </View>

      <View style={styles.bottomPanel}>
        <Text style={styles.hintText}>
          {countdown > 0
            ? `Fit the label in the green frame. Auto-capturing in ${countdown}s...`
            : 'Capturing...'}
        </Text>

        <Pressable style={styles.captureButton} onPress={takePhoto} disabled={isCapturing}>
          <Text style={styles.captureButtonText}>Capture Now</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ===== ADD TEMPLATE STYLES =====
// Change template screen colors, spacing, and form layout here.
const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: '#111827',
  },

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

  backIcon: {
    color: 'white',
    fontSize: 38,
    fontWeight: '300',
    marginTop: -4,
  },

  topTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
  },

  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },

  camera: {
    flex: 1,
  },

  bottomPanel: {
    backgroundColor: '#111827',
    padding: 18,
  },

  hintText: {
    color: '#d1d5db',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 14,
  },

  captureButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 10,
  },

  captureButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  formContent: {
    backgroundColor: '#f3f4f6',
    padding: 16,
    paddingBottom: 40,
  },

  imageEditor: {
    width: '100%',
    height: 320,
    position: 'relative',
    marginBottom: 14,
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
  },

  photoPreview: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },

  helperText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
  },

  loadingBox: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },

  loadingText: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    marginTop: 10,
    marginBottom: 12,
  },

  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },

  readButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 14,
  },

  saveButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 12,
  },

  mainButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
  },

  mainButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  secondaryButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 14,
  },

  secondaryButtonText: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  ocrBox: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },

  ocrTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
  },

  ocrText: {
    fontSize: 13,
    color: '#111827',
    lineHeight: 18,
  },

  cancelButton: {
    marginTop: 14,
    paddingVertical: 14,
  },

  cancelButtonText: {
    color: '#6b7280',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },

  center: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },

  message: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 20,
  },
});