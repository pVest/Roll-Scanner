// ===== SCANNER SCREEN =====
// This screen opens the camera, captures a roll label photo, and tries to
// extract the Roll Number and Weight automatically.
//
// Flow:
//  1. OCR the whole label -> used to find a matching saved template
//  2. If that template has saved Roll/Weight areas (set in Add Template or
//     Template Library -> Set Areas), crop the photo to those areas and OCR
//     just those small regions (much more accurate than reading everything)
//  3. Anything still missing falls back to the whole-label parser
//  4. Results are shown for review/editing, then "Fill Manifest" sends the
//     confirmed Roll Number and Weight back to the Roll Manifest form

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, Alert, ActivityIndicator, TextInput } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

// OCR parser used to extract Roll Number and Weight from recognized text
import { parseRollLabelText, parseFromRegions } from './OCRParser';
// OCR service used to read text from captured photo
import { readTextFromImage } from './OCRService';
// Template lookup used to find a matching saved label template
import { findBestTemplate } from './TemplateService';
// Crops a normalized region out of a photo for zone-based OCR, and crops a
// freshly captured photo down to the on-screen Scan Frame
import { cropImageRegion, cropToScanFrame } from './ImageRegionService';
// Green guide frame overlay shown on the camera screen
import ScanFrameOverlay from './ScanFrame';

// How many seconds the camera waits (showing a countdown) before it
// automatically takes the photo. The user can also tap "Capture Now".
const AUTO_CAPTURE_SECONDS = 2;

export default function ScannerScreen({ goBack, onResult }) {
  // Camera permission state
  const [permission, requestPermission] = useCameraPermissions();

  // Camera reference used to take a photo
  const cameraRef = useRef(null);

  // Captured photo preview
  const [photoUri, setPhotoUri] = useState(null);

  // Captured photo base64 used for OCR upload
  const [photoBase64, setPhotoBase64] = useState(null);

  // Pixel dimensions of the captured photo, needed to crop regions accurately
  const [photoSize, setPhotoSize] = useState(null);

  // OCR loading state
  const [isReading, setIsReading] = useState(false);

  // True while a photo is being captured/cropped (prevents double-capture)
  const [isCapturing, setIsCapturing] = useState(false);

  // Seconds left before the camera auto-captures, shown as a countdown
  // badge below the green frame. null while a photo is being shown.
  const [countdown, setCountdown] = useState(AUTO_CAPTURE_SECONDS);

  // Parsed OCR result, shown for review/editing before filling the manifest
  const [scanResult, setScanResult] = useState(null);
  const [editRollNumber, setEditRollNumber] = useState('');
  const [editWeight, setEditWeight] = useState('');

  // Request camera permission
  const askPermission = async () => {
    const result = await requestPermission();

    if (!result.granted) {
      Alert.alert('Camera Permission', 'Camera access is required to scan roll labels.');
    }
  };

  // Capture roll label photo, then immediately crop it down to the green
  // Scan Frame (+ tolerance) so every photo has the same framing.
  const takePhoto = async () => {
    if (isCapturing) return;

    if (!cameraRef.current) {
      // Camera view isn't mounted yet - try again in a moment
      setCountdown(1);
      return;
    }

    setIsCapturing(true);

    try {
      // Capture photo with base64 so OCR can read it
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
    } catch (error) {
      console.log(error);
      Alert.alert('Camera Error', 'Could not take photo.');
    } finally {
      setIsCapturing(false);
    }
  };

  // Clear photo and scan again
  const retakePhoto = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
    setPhotoSize(null);
    setScanResult(null);
    setEditRollNumber('');
    setEditWeight('');
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

  // Read captured photo with OCR and extract Roll Number and Weight
  const usePhoto = async () => {
    if (isReading) return;

    if (!photoBase64 || !photoUri) {
      Alert.alert('OCR Error', 'No photo data found. Please retake the photo.');
      return;
    }

    setIsReading(true);

    try {
      // 1. Read the whole label first
      const fullText = await readTextFromImage(photoBase64);

      // 2. Try to find a matching saved template by vendor name
      let matchedTemplate = null;
      try {
        matchedTemplate = await findBestTemplate(fullText);
      } catch (error) {
        console.log('Template lookup error:', error);
      }

      let rollNumber = '';
      let weight = '';
      let usedRegions = false;

      // 3. If the template has saved Roll/Weight areas, crop and OCR those zones
      if (matchedTemplate?.rollBox && matchedTemplate?.weightBox && photoSize) {
        try {
          const rollCrop = await cropImageRegion(
            photoUri,
            matchedTemplate.rollBox,
            photoSize.width,
            photoSize.height
          );

          const weightCrop = await cropImageRegion(
            photoUri,
            matchedTemplate.weightBox,
            photoSize.width,
            photoSize.height
          );

          const rollText = rollCrop?.base64 ? await readTextFromImage(rollCrop.base64) : '';
          const weightText = weightCrop?.base64 ? await readTextFromImage(weightCrop.base64) : '';

          const regionResult = parseFromRegions({ rollText, weightText });

          rollNumber = regionResult.rollNumber;
          weight = regionResult.weight;
          usedRegions = true;
        } catch (error) {
          console.log('Region OCR error:', error);
          // Fall through to whole-label parsing below
        }
      }

      // 4. Fill in anything still missing using the whole-label parser
      if (!rollNumber || !weight) {
        const fallback = await parseRollLabelText(fullText);

        if (!rollNumber) rollNumber = fallback.rollNumber;
        if (!weight) weight = fallback.weight;
      }

      // Pre-fill the editable fields with whatever was found (may be empty)
      setEditRollNumber(rollNumber || '');
      setEditWeight(weight ? String(weight) : '');

      setScanResult({
        rollNumber,
        weight,
        success: Boolean(rollNumber && weight),
        templateVendor: matchedTemplate?.vendor || null,
        usedRegions,
      });

      if (!rollNumber || !weight) {
        Alert.alert(
          'Перевірте дані',
          'Не все вдалося розпізнати автоматично. Перевірте і виправте Roll Number / Weight нижче перед тим, як заповнити маніфест.'
        );
      }
    } catch (error) {
      console.log(error);
      Alert.alert('OCR Error', 'Could not read text from this photo.');
    } finally {
      setIsReading(false);
    }
  };

  // Send the (possibly corrected) Roll Number and Weight back to the manifest
  const confirmResult = () => {
    if (!editRollNumber.trim() || !editWeight.trim()) {
      Alert.alert('Missing Data', 'Enter Roll Number and Weight before continuing.');
      return;
    }

    if (onResult) {
      onResult({
        rollNumber: editRollNumber.trim(),
        weight: editWeight.trim(),
      });
    }
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
          We need camera access to scan roll labels.
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

  // Photo preview after capture
  if (photoUri) {
    return (
      <View style={styles.app}>
        <View style={styles.topBar}>
          <Pressable onPress={goBack} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topTitle}>Scan Preview</Text>
        </View>

        <Image source={{ uri: photoUri }} style={styles.photoPreview} />

          {/* OCR loading overlay */}
          {isReading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="white" />
              <Text style={styles.loadingText}>Reading OCR...</Text>
            </View>
          )}

        <View style={styles.bottomPanel}>

         {/* Read captured photo with OCR */}
        {!scanResult && (
          <Pressable style={styles.mainButton} onPress={usePhoto} disabled={isReading}>
            <Text style={styles.mainButtonText}>
              {isReading ? 'Reading OCR...' : 'Use Photo'}
            </Text>
          </Pressable>
        )}

        {/* Editable OCR result, shown after scanning */}
        {scanResult && (
          <View style={styles.resultBox}>
            {scanResult.templateVendor ? (
              <Text style={styles.templateInfo}>
                Template: {scanResult.templateVendor}
                {scanResult.usedRegions ? ' · zone scan' : ' · full scan'}
              </Text>
            ) : (
              <Text style={styles.templateInfo}>No matching template · full scan</Text>
            )}

            <Text style={styles.resultLabel}>Roll Number</Text>
            <TextInput
              style={styles.resultInput}
              value={editRollNumber}
              onChangeText={setEditRollNumber}
              placeholder="Roll Number"
              autoCapitalize="characters"
            />

            <Text style={styles.resultLabel}>Weight</Text>
            <TextInput
              style={styles.resultInput}
              value={editWeight}
              onChangeText={setEditWeight}
              placeholder="Weight"
              keyboardType="numeric"
            />

            <Pressable style={styles.mainButton} onPress={confirmResult}>
              <Text style={styles.mainButtonText}>Fill Manifest</Text>
            </Pressable>
          </View>
        )}

          <Pressable style={styles.secondaryButton} onPress={retakePhoto}>
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </Pressable>
        </View>
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
        <Text style={styles.topTitle}>AI Scanner</Text>
      </View>

     {/* Camera preview with green Scan Frame guide */}
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

// ===== SCANNER STYLES =====
// Change scanner colors, camera height, and buttons here
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
//camera style
  cameraWrapper: {
  flex: 1,
  position: 'relative',
},

camera: {
  flex: 1,
},
//end camera

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

  mainButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 12,
  },

  mainButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  secondaryButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    borderRadius: 10,
  },

  secondaryButtonText: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
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

  photoPreview: {
    flex: 1,
    resizeMode: 'contain',
    backgroundColor: '#000',
  },
  // Dark loading overlay shown while OCR is reading the photo
  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 72,
    bottom: 150,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingText: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 14,
  },

  // Box holding editable OCR results (Roll Number / Weight) after scanning
  resultBox: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },

  resultLabel: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },

  templateInfo: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  resultInput: {
    backgroundColor: 'white',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 12,
  },
});