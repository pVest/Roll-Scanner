// ===== CONFIRM SCREEN =====
// Shown after a scan completes (NewScannerTestScreen runs ScanEngine, then
// shows this). Three actions:
//
//   Accept         - use the result as-is, send it to the manifest, and
//                    teach the Learning Library that the barcode guess
//                    (if barcode was the source) was CORRECT.
//   Edit Manually  - let the user fix Roll ID / Weight by hand, then
//                    Accept the corrected values. Teaches the Learning
//                    Library too, but marks the original guess as
//                    INCORRECT if it was different from the user's edit -
//                    this is the most valuable learning signal, since it's
//                    an explicit human correction.
//   Retake         - discard this result and go back to scanning.
//
// This is the one place in the whole app where the Learning Library AND
// Template Library's usage counts get written to. Accept does two things:
//   1. recordConfirmation (LearningLibraryService) - teaches the barcode
//      shape its correct Roll ID/Weight, and links it to a Template
//      Library record if one was identified for this scan (see
//      ScanEngine.debug.matchedTemplateId).
//   2. recordTemplateUsage (TemplateService) - if a template WAS
//      identified, increments its confirmedCount so Template Library can
//      automatically surface "most used roll types" without any manual
//      daily/weekly/rare labeling.
// If no template was identified for this scan (e.g. an unfamiliar label,
// or barcode succeeded and OCR never ran on a not-yet-linked shape), only
// the Learning Library write happens - that's expected and fine; the
// template link will be filled in automatically the next time OCR
// confirms this same shape.

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Image, ScrollView, Alert } from 'react-native';
import { recordConfirmation, getLearnedShapes, getLinkedTemplateId } from './LearningLibraryService';
import { recordTemplateUsage, getTemplateById, updateTemplateBarcodeProfile } from './TemplateService';
import { recordProfileUsage, recordProfileCorrection } from './BarcodeProfileService';

// If a barcode-only scan's confidence is at or above this threshold, the
// Learning Library clearly already knows this Roll ID shape well (see
// LearningLibraryService - confidence climbs with confirmedCount, capped
// at 0.97). At that point it's safe to credit a linked Template Library
// record's confirmedCount automatically, even without OCR running on
// this particular scan - see the HIGH-CONFIDENCE AUTO-CONFIRM block below.
const HIGH_CONFIDENCE_AUTO_CONFIRM_THRESHOLD = 0.96;

export default function ConfirmScreen({ photoUri, result, onAccept, onRetake }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editRollId, setEditRollId] = useState(result?.rollId || '');
  const [editWeight, setEditWeight] = useState(result?.weight || '');
  const [isSaving, setIsSaving] = useState(false);

  const startEdit = () => {
    setEditRollId(result?.rollId || '');
    setEditWeight(result?.weight || '');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  // Shared by both "Accept" (unedited) and "Accept" after editing -
  // teaches the Learning Library either way, since both are confirmed-
  // correct data points once the user accepts them.
  const acceptValues = async (finalRollId, finalWeight) => {
    if (!finalRollId.trim() || !finalWeight.trim()) {
      Alert.alert('Missing Data', 'Roll ID and Weight are both required.');
      return;
    }

    setIsSaving(true);

    try {
      // Was the system's original guess (before any edit) already
      // correct? Compared against what's being accepted now.
      const wasGuessCorrect =
        result?.rollId === finalRollId.trim() && result?.weight === finalWeight.trim();

      const matchedTemplateId = result?.debug?.matchedTemplateId || null;

      await recordConfirmation({
        rollId: finalRollId.trim(),
        weight: finalWeight.trim(),
        wasGuessCorrect,
        templateId: matchedTemplateId,
      });

      // Only Roll ID/Weight corrections affect the Learning Library's
      // correctedCount above. Template usage is counted separately and
      // simply means "this roll type was scanned and confirmed" -
      // whether or not the user had to fix a value along the way.
      if (matchedTemplateId) {
        await recordTemplateUsage(matchedTemplateId, { wasCorrected: !wasGuessCorrect });
      }

      // HIGH-CONFIDENCE AUTO-CONFIRM (96%+): if this Roll ID's barcode
      // shape is already linked to a Template Library record (from a
      // PAST scan where OCR confirmed it), and this scan's confidence is
      // high enough (>= 96%) that the Learning Library clearly already
      // knows this shape well, credit that template's confirmedCount
      // automatically - even though OCR never ran on THIS scan. This is
      // what makes Template Library's "Scanned N times" numbers grow
      // during normal live-barcode-only scanning, not just on scans
      // where OCR happened to run. Skipped if recordTemplateUsage already
      // ran above via matchedTemplateId, to avoid double-counting the
      // same Accept.
      if (!matchedTemplateId && result?.confidence >= HIGH_CONFIDENCE_AUTO_CONFIRM_THRESHOLD) {
        try {
          const knownShapes = await getLearnedShapes();
          const linkedTemplateId = getLinkedTemplateId(finalRollId.trim(), knownShapes);
          if (linkedTemplateId) {
            await recordTemplateUsage(linkedTemplateId, { wasCorrected: !wasGuessCorrect });
          }
        } catch (autoConfirmError) {
          console.log('ConfirmScreen: high-confidence auto-confirm failed:', autoConfirmError);
          // Non-fatal - the manifest entry itself still succeeds either way
        }
      }

      // barcodeProfile trial-period tracking (see BarcodeProfileService
      // header comment for the full safety design): if this scan's Roll
      // ID came from a Template Library profile (the fallback
      // recognition path for unusual formats like Sustana), record
      // whether the guess was correct or had to be corrected. A
      // correction during the trial period permanently disables the
      // profile, so one bad photo doesn't keep producing wrong answers
      // indefinitely - see recordProfileCorrection.
      const matchedProfileTemplateId = result?.debug?.matchedProfileTemplateId || null;
      if (matchedProfileTemplateId) {
        try {
          const template = await getTemplateById(matchedProfileTemplateId);
          if (template?.barcodeProfile) {
            const updatedProfile = wasGuessCorrect
              ? recordProfileUsage(template.barcodeProfile)
              : recordProfileCorrection(template.barcodeProfile);
            await updateTemplateBarcodeProfile(matchedProfileTemplateId, updatedProfile);
          }
        } catch (profileError) {
          console.log('ConfirmScreen: failed to update barcodeProfile trial state:', profileError);
          // Non-fatal - don't block the user's workflow over this
        }
      }
    } catch (error) {
      console.log('ConfirmScreen: failed to record learning confirmation:', error);
      // Don't block the user's workflow just because learning-write failed
    } finally {
      setIsSaving(false);
    }

    if (onAccept) {
      onAccept({ rollNumber: finalRollId.trim(), weight: finalWeight.trim() });
    }
  };

  const acceptAsIs = () => acceptValues(result?.rollId || '', result?.weight || '');
  const acceptEdited = () => acceptValues(editRollId, editWeight);

  const confidencePercent = Math.round((result?.confidence || 0) * 100);
  const confidenceColor = confidencePercent >= 80 ? '#16a34a' : confidencePercent >= 50 ? '#d97706' : '#dc2626';

  return (
    <ScrollView style={styles.app} contentContainerStyle={styles.content}>
      {photoUri && <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="contain" />}

      <View style={styles.resultBox}>
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>
            {result?.success ? 'Scan Result' : 'Incomplete Result'}
          </Text>
          {result?.timedOut && <Text style={styles.timeoutBadge}>OCR timed out</Text>}
        </View>

        {!isEditing ? (
          <>
            <FieldRow label="Roll ID" value={result?.rollId} method={result?.method?.rollId} />
            <FieldRow label="Weight" value={result?.weight} method={result?.method?.weight} />
            {result?.labelType && (
              <FieldRow label="Label Type" value={result.labelType} method={result?.method?.labelType} />
            )}

            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Confidence</Text>
              <Text style={[styles.confidenceValue, { color: confidenceColor }]}>
                {confidencePercent}%
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.editLabel}>Roll ID</Text>
            <TextInput
              style={styles.editInput}
              value={editRollId}
              onChangeText={setEditRollId}
              autoCapitalize="characters"
              placeholder="Roll ID"
            />

            <Text style={styles.editLabel}>Weight</Text>
            <TextInput
              style={styles.editInput}
              value={editWeight}
              onChangeText={setEditWeight}
              keyboardType="numeric"
              placeholder="Weight"
            />
          </>
        )}
      </View>

      {!isEditing ? (
        <>
          <Pressable
            style={[styles.acceptButton, !result?.success && styles.acceptButtonDisabled]}
            onPress={acceptAsIs}
            disabled={!result?.success || isSaving}
          >
            <Text style={styles.acceptButtonText}>{isSaving ? 'Saving...' : 'Accept'}</Text>
          </Pressable>

          <Pressable style={styles.editButton} onPress={startEdit}>
            <Text style={styles.editButtonText}>Edit Manually</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.acceptButton} onPress={acceptEdited} disabled={isSaving}>
            <Text style={styles.acceptButtonText}>{isSaving ? 'Saving...' : 'Accept Edited Values'}</Text>
          </Pressable>

          <Pressable style={styles.editButton} onPress={cancelEdit}>
            <Text style={styles.editButtonText}>Cancel Edit</Text>
          </Pressable>
        </>
      )}

      <Pressable style={styles.retakeButton} onPress={onRetake}>
        <Text style={styles.retakeButtonText}>Retake</Text>
      </Pressable>
    </ScrollView>
  );
}

function FieldRow({ label, value, method }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueWrap}>
        <Text style={styles.fieldValue}>{value || '—'}</Text>
        {method && <Text style={styles.fieldMethod}>{method}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },

  photoPreview: { width: '100%', height: 240, backgroundColor: '#000', borderRadius: 10, marginBottom: 14 },

  resultBox: { backgroundColor: 'white', borderRadius: 10, padding: 16, marginBottom: 14 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerText: { fontSize: 18, fontWeight: '900', color: '#111827' },
  timeoutBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },

  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  fieldValueWrap: { alignItems: 'flex-end' },
  fieldValue: { fontSize: 17, fontWeight: '800', color: '#111827' },
  fieldMethod: { fontSize: 11, fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', marginTop: 2 },

  confidenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 4 },
  confidenceLabel: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  confidenceValue: { fontSize: 20, fontWeight: '900' },

  editLabel: { fontSize: 14, fontWeight: '700', color: '#6b7280', marginBottom: 6, marginTop: 8 },
  editInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 8,
  },

  acceptButton: { backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 10, marginBottom: 12 },
  acceptButtonDisabled: { backgroundColor: '#9ca3af' },
  acceptButtonText: { color: 'white', fontSize: 18, fontWeight: '800', textAlign: 'center' },

  editButton: { backgroundColor: 'white', paddingVertical: 16, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#d1d5db' },
  editButtonText: { color: '#111827', fontSize: 17, fontWeight: '800', textAlign: 'center' },

  retakeButton: { paddingVertical: 14 },
  retakeButtonText: { color: '#6b7280', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});