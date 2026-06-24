// ===== TEMPLATE AREA EDITOR SCREEN =====
// Lets the user open an EXISTING saved template photo and adjust the two
// scan boxes: Roll Number Box (blue) and Weight Box (green).
// Opened from Template Library -> "Set Areas". Useful for:
//  - templates saved before this feature existed (no boxes yet)
//  - fine-tuning boxes that were not accurate enough

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';

import { getTemplateById, setTemplateBoxes } from './TemplateService';
import RegionBox from './RegionBox';
import { getContainRect } from './ImageLayout';

// Reasonable starting positions if a template has no saved boxes yet
const DEFAULT_ROLL_BOX = { x: 0.15, y: 0.40, width: 0.50, height: 0.10 };
const DEFAULT_WEIGHT_BOX = { x: 0.55, y: 0.25, width: 0.25, height: 0.10 };

export default function TemplateAreaEditorScreen({ templateId, goBack }) {
  const [template, setTemplate] = useState(null);
  const [naturalSize, setNaturalSize] = useState(null); // real photo pixel size
  const [containerLayout, setContainerLayout] = useState({ width: 0, height: 0 });
  const [rollBox, setRollBox] = useState(DEFAULT_ROLL_BOX);
  const [weightBox, setWeightBox] = useState(DEFAULT_WEIGHT_BOX);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const found = await getTemplateById(templateId);

      if (!isMounted) return;

      setTemplate(found);

      if (found?.rollBox) setRollBox(found.rollBox);
      if (found?.weightBox) setWeightBox(found.weightBox);

      if (found?.imageUri) {
        Image.getSize(
          found.imageUri,
          (width, height) => {
            if (!isMounted) return;
            setNaturalSize({ width, height });
            setLoading(false);
          },
          () => {
            if (isMounted) setLoading(false);
          }
        );
      } else {
        setLoading(false);
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  // Where the photo is actually drawn inside the preview box, accounting
  // for resizeMode="contain" letterboxing. Boxes must be positioned and
  // saved relative to THIS rectangle so normalized coordinates line up
  // with the real photo pixels used for cropping later.
  const containRect = naturalSize
    ? getContainRect(containerLayout.width, containerLayout.height, naturalSize.width, naturalSize.height)
    : { x: 0, y: 0, width: 0, height: 0 };

  const save = async () => {
    await setTemplateBoxes(templateId, rollBox, weightBox);
    Alert.alert('Areas Saved', 'Roll Number and Weight areas have been saved for this template.');
    goBack();
  };

  const resetDefaults = () => {
    setRollBox(DEFAULT_ROLL_BOX);
    setWeightBox(DEFAULT_WEIGHT_BOX);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.message}>Loading template photo...</Text>
      </View>
    );
  }

  if (!template || !template.imageUri) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No Photo Found</Text>
        <Text style={styles.message}>
          This template has no saved photo, so areas cannot be set.
        </Text>

        <Pressable style={styles.secondaryButton} onPress={goBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Set Areas</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.vendorTitle}>{template.vendor || 'Unknown Vendor'}</Text>

        <Text style={styles.hint}>
          Перетягни рамки: СИНЯ — Roll Number, ЗЕЛЕНА — Weight. Тягни за
          кружечок у кутку, щоб змінити розмір рамки.
        </Text>

        <View
          style={styles.imageEditor}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setContainerLayout({ width, height });
          }}
        >
          <Image
            source={{ uri: template.imageUri }}
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

        <Pressable style={styles.mainButton} onPress={save}>
          <Text style={styles.buttonText}>Save Areas</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={resetDefaults}>
          <Text style={styles.secondaryButtonText}>Reset to Default Positions</Text>
        </Pressable>

        <Pressable style={styles.cancelButton} onPress={goBack}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f3f4f6' },

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
    fontWeight: '800',
  },

  content: {
    flex: 1,
    padding: 16,
  },

  vendorTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 6,
  },

  hint: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 14,
    lineHeight: 20,
  },

  imageEditor: {
    width: '100%',
    flex: 1,
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
  },

  photoPreview: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },

  mainButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
  },

  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  secondaryButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },

  secondaryButtonText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },

  cancelButton: {
    paddingVertical: 10,
  },

  cancelButtonText: {
    color: '#6b7280',
    fontSize: 16,
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
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
  },

  message: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
});