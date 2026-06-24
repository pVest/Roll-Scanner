// ===== TEMPLATE LIBRARY SCREEN (V3) =====
// Shows the human-curated catalog of known roll/label types, sorted by
// real usage frequency (confirmedCount) automatically - the roll types
// scanned and Accepted most often surface at the top with no manual
// daily/weekly/rare labeling needed (see TemplateService.recordTemplateUsage,
// written from ConfirmScreen on every Accept).

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  TextInput,
  Alert,
} from 'react-native';

import {
  getTemplatesByUsage,
  clearTemplates,
  deleteTemplate,
  updateTemplate,
} from './TemplateService';

export default function TemplateLibraryScreen({ goBack, goAddTemplate, goSetAreas }) {
  const [templates, setTemplates] = useState([]);
  const [editingId, setEditingId] = useState(null);

  const [editVendor, setEditVendor] = useState('');
  const [editProduct, setEditProduct] = useState('');
  const [editBasisWeight, setEditBasisWeight] = useState('');
  const [editRollNumber, setEditRollNumber] = useState('');
  const [editWeight, setEditWeight] = useState('');

  const loadTemplates = async () => {
    const savedTemplates = await getTemplatesByUsage();
    setTemplates(savedTemplates);
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const startEdit = template => {
    setEditingId(template.id);
    setEditVendor(template.vendor || '');
    setEditProduct(template.product || '');
    setEditBasisWeight(template.basisWeight || '');
    setEditRollNumber(template.exampleRollId || template.rollNumber || '');
    setEditWeight(template.exampleWeight || template.weight || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditVendor('');
    setEditProduct('');
    setEditBasisWeight('');
    setEditRollNumber('');
    setEditWeight('');
  };

  const saveEdit = async templateId => {
    await updateTemplate(templateId, {
      vendor: editVendor,
      product: editProduct,
      basisWeight: editBasisWeight,
      exampleRollId: editRollNumber,
      exampleWeight: editWeight,
      // Keep legacy fields in sync too, for any older screen still reading them
      rollNumber: editRollNumber,
      weight: editWeight,
    });

    await loadTemplates();
    cancelEdit();
  };

  const removeTemplate = async templateId => {
    await deleteTemplate(templateId);
    await loadTemplates();
  };

  const clearAll = async () => {
    await clearTemplates();
    setTemplates([]);
  };

  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>

        <Text style={styles.topTitle}>Template Library</Text>
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.countText}>Saved Templates: {templates.length}</Text>
        <Text style={styles.sortHint}>Sorted by usage - most scanned first</Text>

        {goAddTemplate && (
          <Pressable style={styles.addTemplateButton} onPress={goAddTemplate}>
            <Text style={styles.addTemplateButtonText}>+ Add Template</Text>
          </Pressable>
        )}

        {templates.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No templates saved yet</Text>
          </View>
        )}

        {templates.map((template, index) => (
          <View key={template.id} style={styles.card}>
            {template.imageUri ? (
              <Image source={{ uri: template.imageUri }} style={styles.image} />
            ) : null}

            {editingId === template.id ? (
              <>
                <TextInput
                  style={styles.input}
                  value={editVendor}
                  onChangeText={setEditVendor}
                  placeholder="Vendor (e.g. Domtar)"
                />

                <TextInput
                  style={styles.input}
                  value={editProduct}
                  onChangeText={setEditProduct}
                  placeholder="Product (e.g. LynxJet)"
                />

                <TextInput
                  style={styles.input}
                  value={editBasisWeight}
                  onChangeText={setEditBasisWeight}
                  placeholder="Basis Weight (e.g. 60lb)"
                />

                <TextInput
                  style={styles.input}
                  value={editRollNumber}
                  onChangeText={setEditRollNumber}
                  placeholder="Example Roll ID"
                />

                <TextInput
                  style={styles.input}
                  value={editWeight}
                  onChangeText={setEditWeight}
                  placeholder="Example Weight"
                  keyboardType="numeric"
                />

                <Pressable style={styles.saveButton} onPress={() => saveEdit(template.id)}>
                  <Text style={styles.buttonText}>Save Changes</Text>
                </Pressable>

                <Pressable style={styles.cancelEditButton} onPress={cancelEdit}>
                  <Text style={styles.cancelEditText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.titleRow}>
                  {index < 3 && template.confirmedCount > 0 && (
                    <Text style={styles.rankBadge}>#{index + 1}</Text>
                  )}
                  <Text style={styles.vendor}>
                    {[template.vendor, template.product, template.basisWeight].filter(Boolean).join(' ') || 'Unknown'}
                  </Text>
                </View>

                {(template.size || template.color || template.finish) ? (
                  <Text style={styles.info}>
                    {[template.size, template.color, template.finish].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}

                <Text style={styles.info}>
                  Example Roll ID: {template.exampleRollId || template.rollNumber || '—'}
                </Text>
                <Text style={styles.info}>
                  Example Weight: {template.exampleWeight || template.weight || '—'} lb
                </Text>

                <Text style={styles.usageBadge}>
                  Scanned {template.confirmedCount || 0} time{template.confirmedCount === 1 ? '' : 's'}
                  {template.correctedCount > 0 ? ` · corrected ${template.correctedCount}x` : ''}
                </Text>

                <Text style={styles.smallInfo}>Saved: {template.createdAt}</Text>

                {template.barcodeProfile ? (
                  <View style={styles.profileBox}>
                    <Text style={styles.profileTitle}>
                      🔧 Recognition Rule {template.barcodeProfile.trustworthy === false ? '(disabled)' : ''}
                    </Text>
                    <Text style={styles.profileLine}>
                      Roll ID format: {template.barcodeProfile.rollIdIsPureDigits ? 'Numbers only' : 'Letters + numbers'}
                      {template.barcodeProfile.rollIdHasLeadingZero ? ', starts with 0' : ''}
                      {' · '}{template.barcodeProfile.rollIdLength} characters
                    </Text>
                    {template.barcodeProfile.weightValueRange ? (
                      <Text style={styles.profileLine}>
                        Expected weight: {template.barcodeProfile.weightValueRange[0]}–{template.barcodeProfile.weightValueRange[1]} lb
                      </Text>
                    ) : null}
                    <Text style={styles.profileLine}>
                      Other barcodes on label to ignore: {template.barcodeProfile.expectedNoiseBarcodeCount || 0}
                    </Text>
                    <Text
                      style={[
                        styles.profileStatus,
                        template.barcodeProfile.trustworthy === false
                          ? styles.profileStatusDisabled
                          : template.barcodeProfile.trialUsesLeft > 0
                          ? styles.profileStatusTrial
                          : styles.profileStatusActive,
                      ]}
                    >
                      {template.barcodeProfile.trustworthy === false
                        ? 'Disabled - a correction during testing showed this rule was wrong'
                        : template.barcodeProfile.trialUsesLeft > 0
                        ? `Being tested - used ${3 - template.barcodeProfile.trialUsesLeft}/3 times so far`
                        : 'Active and trusted - this rule is helping recognize this roll type'}
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.areaStatus}>
                  Scan Areas: {template.rollBox && template.weightBox ? 'Set ✅' : 'Not set ⚠️'}
                </Text>

                {template.imageUri ? (
                  <Pressable
                    style={styles.areasButton}
                    onPress={() => goSetAreas && goSetAreas(template.id)}
                  >
                    <Text style={styles.buttonText}>Set Areas</Text>
                  </Pressable>
                ) : null}

                <Pressable style={styles.editButton} onPress={() => startEdit(template)}>
                  <Text style={styles.buttonText}>Edit</Text>
                </Pressable>

                <Pressable style={styles.deleteButton} onPress={() => removeTemplate(template.id)}>
                  <Text style={styles.buttonText}>Delete</Text>
                </Pressable>
              </>
            )}
          </View>
        ))}

        {templates.length > 0 && (
          <Pressable style={styles.clearButton} onPress={clearAll}>
            <Text style={styles.clearButtonText}>Clear All Templates</Text>
          </Pressable>
        )}
      </ScrollView>
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

  content: { padding: 16 },

  countText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },

  sortHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },

  addTemplateButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 20,
  },

  addTemplateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },

  emptyBox: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },

  emptyText: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: '700',
  },

  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },

  image: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    resizeMode: 'contain',
    backgroundColor: '#000',
    marginBottom: 12,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },

  rankBadge: {
    fontSize: 13,
    fontWeight: '900',
    color: 'white',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 8,
  },

  vendor: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },

  usageBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
    marginTop: 8,
  },

  info: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },

  smallInfo: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },

  areaStatus: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginTop: 10,
  },

  areasButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 10,
  },

  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 14,
    fontSize: 17,
    marginBottom: 10,
  },

  editButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 12,
  },

  saveButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 8,
  },

  deleteButton: {
    backgroundColor: '#991b1b',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 10,
  },

  cancelEditButton: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 10,
  },

  cancelEditText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  clearButton: {
    backgroundColor: '#991b1b',
    paddingVertical: 16,
    borderRadius: 10,
    marginBottom: 30,
  },

  clearButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  profileBox: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },

  profileTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
    marginBottom: 6,
  },

  profileLine: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 3,
  },

  profileStatus: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },

  profileStatusTrial: { color: '#d97706' },
  profileStatusActive: { color: '#16a34a' },
  profileStatusDisabled: { color: '#dc2626' },
});