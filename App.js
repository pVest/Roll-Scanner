// ===== IMPORTS =====
import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  Animated,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import ScannerScreen from './RollManifest/Scaner/ScannerScreen';
import AddTemplateScreen from './RollManifest/Scaner/AddTemplateScreen';
import AddRollTypeScreen from './RollManifest/Scaner/AddRollTypeScreen';
import TemplateLibraryScreen from './RollManifest/Scaner/TemplateLibraryScreen';
import TemplateAreaEditorScreen from './RollManifest/Scaner/TemplateAreaEditorScreen';
import NewScannerTestScreen from './RollManifest/Scaner/NewScannerTestScreen';
import { seedTemplateLibrary } from './RollManifest/Scaner/SeedTemplateLibrary';
import { ThemeProvider, useTheme, AnimatedThemeToggle, animate, ANIM } from './AppTheme';

// ===== ROOT =====
export default function App() {
  return (
    <ThemeProvider>
      <AppRoot />
    </ThemeProvider>
  );
}

function AppRoot() {
  const { colors, fadeAnim } = useTheme();
  const [screen, setScreen] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen((v) => !v);
  };

  // Manifest header fields
  const today = new Date();
  const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}.${today.getFullYear()}`;
  const [date, setDate] = useState(todayStr);
  const [customerName, setCustomerName] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [customerPO, setCustomerPO] = useState('');

  const [itemNumber, setItemNumber] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [weight, setWeight] = useState('');

  const [items, setItems] = useState([]);
  const [editingRoll, setEditingRoll] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const manifestData = {
    date,
    customerName,
    orderNumber,
    customerPO,
    items,
  };

  // ===== SCREEN ROUTING =====
  if (screen === 'manifest') {
    return (
      <RollManifestScreen
        goTemplateLibrary={() => setScreen('templateLibrary')}
        goBack={() => setScreen('home')}
        goPreview={() => setScreen('preview')}
        goScanner={() => setScreen('scanner')}
        goNewScannerTest={() => setScreen('newScannerTest')}
        goAddTemplate={() => setScreen('addTemplate')}
        date={date}
        setDate={setDate}
        customerName={customerName}
        setCustomerName={setCustomerName}
        orderNumber={orderNumber}
        setOrderNumber={setOrderNumber}
        customerPO={customerPO}
        setCustomerPO={setCustomerPO}
        itemNumber={itemNumber}
        setItemNumber={setItemNumber}
        rollNumber={rollNumber}
        setRollNumber={setRollNumber}
        weight={weight}
        setWeight={setWeight}
        items={items}
        setItems={setItems}
        editingRoll={editingRoll}
        setEditingRoll={setEditingRoll}
      />
    );
  }

  if (screen === 'preview') {
    return <PreviewScreen data={manifestData} goBack={() => setScreen('manifest')} />;
  }

  const handleScanResult = (result) => {
    const rollId = result.rollId || result.rollNumber || '';
    const rollWeight = result.weight || '';

    if (!rollId || !rollWeight) {
      setScreen('manifest');
      return;
    }

    const weightNumber = Number(rollWeight);
    if (isNaN(weightNumber) || items.length === 0) {
      setRollNumber(rollId);
      setWeight(rollWeight);
      setScreen('manifest');
      return;
    }

    const updatedItems = [...items];
    const lastItemIndex = updatedItems.length - 1;
    updatedItems[lastItemIndex].rolls.push({
      id: Date.now().toString(),
      rollNumber: rollId,
      weight: weightNumber,
    });
    setItems(updatedItems);
    // Scanner stays open - no setScreen() here
  };

  const handleLegacyScanResult = (result) => {
    setRollNumber(result.rollNumber || '');
    setWeight(result.weight || '');
    setScreen('manifest');
  };

  if (screen === 'scanner') {
    return <ScannerScreen goBack={() => setScreen('manifest')} onResult={handleLegacyScanResult} />;
  }
  if (screen === 'newScannerTest') {
    return <NewScannerTestScreen goBack={() => setScreen('manifest')} onResult={handleScanResult} />;
  }
  if (screen === 'addTemplate') {
    return <AddTemplateScreen goBack={() => setScreen('manifest')} />;
  }
  if (screen === 'addRollType') {
    return <AddRollTypeScreen goBack={() => setScreen('templateLibrary')} />;
  }
  if (screen === 'templateLibrary') {
    return (
      <TemplateLibraryScreen
        goBack={() => setScreen('manifest')}
        goAddTemplate={() => setScreen('addRollType')}
        goSetAreas={(templateId) => {
          setSelectedTemplateId(templateId);
          setScreen('templateAreaEditor');
        }}
      />
    );
  }
  if (screen === 'templateAreaEditor') {
    return (
      <TemplateAreaEditorScreen
        templateId={selectedTemplateId}
        goBack={() => setScreen('templateLibrary')}
      />
    );
  }

  // ===== HOME SCREEN =====
  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={toggleMenu} style={styles.menuButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
        <Text style={styles.topTitle}>PaperRollsPro</Text>
      </View>

      {/* Side menu */}
      {menuOpen && (
        <View style={[styles.sideMenu, { backgroundColor: colors.bgCard, borderRightColor: colors.border }]}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              setScreen('manifest');
            }}
          >
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Roll Manifest</Text>
          </Pressable>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              setScreen('templateLibrary');
            }}
          >
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Template Library</Text>
          </Pressable>
          {/* Theme toggle at bottom of menu */}
          <View style={[styles.menuToggleRow, { borderTopColor: colors.border }]}>
            <AnimatedThemeToggle />
          </View>
        </View>
      )}

      {/* Home content */}
      <Animated.View style={[styles.homeContent, { opacity: fadeAnim }]}>
        <Text style={styles.title}>PaperRollsPro</Text>
        <Text style={styles.subtitle}>Warehouse Roll Manifest App</Text>

        <Pressable style={styles.mainButton} onPress={() => setScreen('manifest')}>
          <Text style={styles.mainButtonText}>Roll Manifest</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ===== ROLL MANIFEST SCREEN =====
function RollManifestScreen({
  goBack,
  goPreview,
  goScanner,
  goNewScannerTest,
  goAddTemplate,
  goTemplateLibrary,
  date,
  setDate,
  customerName,
  setCustomerName,
  orderNumber,
  setOrderNumber,
  customerPO,
  setCustomerPO,
  itemNumber,
  setItemNumber,
  rollNumber,
  setRollNumber,
  weight,
  setWeight,
  items,
  setItems,
  editingRoll,
  setEditingRoll,
}) {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  const scrollViewRef = React.useRef(null);
  const addRollSectionY = React.useRef(0);
  const highlightAnims = React.useRef({});
  const blurTimer = React.useRef(null);

  // ── Customer Name autocomplete ─────────────────────────────────────
  const [savedCustomerNames, setSavedCustomerNames] = React.useState([]);
  const [showNameSuggestions, setShowNameSuggestions] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem('SAVED_CUSTOMER_NAMES')
      .then((raw) => { if (raw) setSavedCustomerNames(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const saveCustomerName = async (name) => {
    if (!name.trim()) return;
    const updated = [name.trim(), ...savedCustomerNames.filter((n) => n !== name.trim())].slice(0, 20);
    setSavedCustomerNames(updated);
    await AsyncStorage.setItem('SAVED_CUSTOMER_NAMES', JSON.stringify(updated));
  };

  const deleteCustomerName = async (name) => {
    const updated = savedCustomerNames.filter((n) => n !== name);
    setSavedCustomerNames(updated);
    await AsyncStorage.setItem('SAVED_CUSTOMER_NAMES', JSON.stringify(updated));
  };

  const nameSuggestions = customerName.trim()
    ? savedCustomerNames
        .filter((n) => n.toLowerCase().startsWith(customerName.toLowerCase()))
        .slice(0, 3)
    : savedCustomerNames.slice(0, 3);

  // ── Add item ──────────────────────────────────────────────────────
  const addItem = () => {
    if (itemNumber.trim() === '') return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems([...items, { id: Date.now().toString(), itemNumber: itemNumber.trim(), rolls: [] }]);
    setItemNumber('');
  };

  // ── Add or update roll ────────────────────────────────────────────
  const addOrUpdateRoll = () => {
    if (rollNumber.trim() === '' || weight.trim() === '' || items.length === 0) return;
    const weightNumber = Number(weight);
    if (isNaN(weightNumber)) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const updatedItems = [...items];

    if (editingRoll) {
      const itemIndex = updatedItems.findIndex((item) => item.id === editingRoll.itemId);
      if (itemIndex !== -1) {
        const rollIndex = updatedItems[itemIndex].rolls.findIndex((r) => r.id === editingRoll.rollId);
        if (rollIndex !== -1) {
          updatedItems[itemIndex].rolls[rollIndex] = {
            ...updatedItems[itemIndex].rolls[rollIndex],
            rollNumber: rollNumber.trim(),
            weight: weightNumber,
          };

          // Trigger highlight flash on updated roll
          const key = editingRoll.rollId;
          if (!highlightAnims.current[key]) {
            highlightAnims.current[key] = new Animated.Value(0);
          }
          const anim = highlightAnims.current[key];
          anim.setValue(1);
          Animated.timing(anim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false,
          }).start();

          // Scroll to updated roll
          const updatedRollId = editingRoll.rollId;
          setTimeout(() => {
            rollRowRefs.current[updatedRollId]?.measureLayout(
              scrollViewRef.current?.getInnerViewNode?.() || scrollViewRef.current,
              (_x, y) => {
                scrollViewRef.current?.scrollTo({ y: y - 80, animated: true });
              },
              () => {}
            );
          }, 100);
        }
      }
      setEditingRoll(null);
    } else {
      updatedItems[updatedItems.length - 1].rolls.push({
        id: Date.now().toString(),
        rollNumber: rollNumber.trim(),
        weight: weightNumber,
      });
    }

    setItems(updatedItems);
    setRollNumber('');
    setWeight('');
  };

  const rollRowRefs = React.useRef({});

  const runSeedTemplateLibrary = async () => {
    try {
      const result = await seedTemplateLibrary();
      Alert.alert('Template Library Seeded',
        `Added: ${result.added}\nSkipped (already existed): ${result.skipped}\nTotal known roll types: ${result.total}`);
    } catch (error) {
      Alert.alert('Seed Error', 'Could not seed Template Library.');
    }
  };

  const deleteItem = (itemId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(items.filter((item) => item.id !== itemId));
  };

  const deleteRoll = (itemId, rollId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(items.map((item) =>
      item.id !== itemId ? item : { ...item, rolls: item.rolls.filter((r) => r.id !== rollId) }
    ));
  };

  const startEditRoll = (itemId, roll) => {
    setRollNumber(roll.rollNumber);
    setWeight(String(roll.weight));
    setEditingRoll({ itemId, rollId: roll.id });
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: addRollSectionY.current - 40, animated: true });
    }, 50);
  };

  const totalRolls = items.reduce((sum, item) => sum + item.rolls.length, 0);
  const totalWeight = items.reduce((sum, item) =>
    sum + item.rolls.reduce((s, r) => s + r.weight, 0), 0);

  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.menuButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Roll Manifest</Text>
      </View>

      <ScrollView ref={scrollViewRef} style={styles.formPage} contentContainerStyle={styles.formContent}>
        <Text style={styles.sectionTitle}>Manifest Header</Text>

        <TextInput style={styles.input} placeholder="Date" value={date} onChangeText={setDate} />

        {/* Customer Name with fixed autocomplete */}
        <TextInput
          style={styles.input}
          placeholder="Customer Name"
          value={customerName}
          onChangeText={(text) => { setCustomerName(text); setShowNameSuggestions(true); }}
          onFocus={() => setShowNameSuggestions(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setShowNameSuggestions(false), 200);
            saveCustomerName(customerName);
          }}
        />
        {showNameSuggestions && nameSuggestions.length > 0 && (
          <View style={styles.suggestionsBox}>
            {nameSuggestions.map((name) => (
              <View key={name} style={styles.suggestionItem}>
                <Pressable
                  style={styles.suggestionNameArea}
                  onPressIn={() => {
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    setCustomerName(name);
                    setShowNameSuggestions(false);
                    saveCustomerName(name);
                  }}
                >
                  <Text style={styles.suggestionText}>{name}</Text>
                </Pressable>
                <Pressable
                  style={styles.suggestionDeleteBtn}
                  onPressIn={() => {
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    deleteCustomerName(name);
                  }}
                >
                  <Text style={styles.suggestionDeleteText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <TextInput style={styles.input} placeholder="Order Number" value={orderNumber} onChangeText={setOrderNumber} />
        <TextInput style={styles.input} placeholder="Customer PO" value={customerPO} onChangeText={setCustomerPO} />

        <Text style={styles.sectionTitle}>Item</Text>
        <TextInput style={styles.input} placeholder="Item Number" value={itemNumber} onChangeText={setItemNumber} />
        <Pressable style={styles.mainButton} onPress={addItem}>
          <Text style={styles.mainButtonText}>Add Item</Text>
        </Pressable>

        {/* Measure Y so startEditRoll can scroll exactly here */}
        <Text
          style={styles.sectionTitle}
          onLayout={(e) => { addRollSectionY.current = e.nativeEvent.layout.y; }}
        >
          Add Roll
        </Text>
        <TextInput style={styles.input} placeholder="Roll Number" value={rollNumber} onChangeText={setRollNumber} />
        <TextInput style={styles.input} placeholder="Weight" value={weight} onChangeText={setWeight} keyboardType="numeric" />
        <Pressable style={styles.mainButton} onPress={addOrUpdateRoll}>
          <Text style={styles.mainButtonText}>{editingRoll ? 'Update Roll' : 'Add Roll'}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Roll List</Text>

        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No items added yet</Text>
          </View>
        ) : (
          items.map((item) => {
            const itemWeight = item.rolls.reduce((sum, r) => sum + r.weight, 0);
            return (
              <View key={item.id} style={styles.itemBox}>
                <View style={styles.itemHeaderRow}>
                  <Text style={styles.itemTitle}>Item: {item.itemNumber}</Text>
                  <Pressable onPress={() => deleteItem(item.id)} style={styles.deleteItemButton}>
                    <Text style={styles.deleteItemText}>Delete Item</Text>
                  </Pressable>
                </View>

                <View style={styles.tableHeader}>
                  <Text style={styles.rollCol}>ROLL #</Text>
                  <Text style={styles.weightCol}>WEIGHT</Text>
                  <Text style={styles.actionCol}>ACTION</Text>
                </View>

                {item.rolls.length === 0 ? (
                  <Text style={styles.noRollsText}>No rolls added</Text>
                ) : (
                  item.rolls.map((roll) => {
                    if (!highlightAnims.current[roll.id]) {
                      highlightAnims.current[roll.id] = new Animated.Value(0);
                    }
                    const highlightOpacity = highlightAnims.current[roll.id].interpolate({
                      inputRange: [0, 1],
                      outputRange: ['rgba(250,204,21,0)', 'rgba(250,204,21,0.35)'],
                    });
                    return (
                      <Animated.View
                        key={roll.id}
                        ref={(ref) => { rollRowRefs.current[roll.id] = ref; }}
                        style={[styles.tableRow, { backgroundColor: highlightOpacity }]}
                      >
                        <Text style={styles.rollCol}>{roll.rollNumber}</Text>
                        <Text style={styles.weightCol}>{roll.weight}</Text>
                        <View style={styles.actionCol}>
                          <Pressable onPress={() => startEditRoll(item.id, roll)} style={styles.smallEditButton}>
                            <Text style={styles.smallButtonText}>Edit</Text>
                          </Pressable>
                          <Pressable onPress={() => deleteRoll(item.id, roll.id)} style={styles.smallDeleteButton}>
                            <Text style={styles.smallButtonText}>Del</Text>
                          </Pressable>
                        </View>
                      </Animated.View>
                    );
                  })
                )}

                <View style={styles.itemTotalRow}>
                  <Text style={styles.itemTotalText}>Item Rolls: {item.rolls.length}</Text>
                  <Text style={styles.itemTotalText}>Item Weight: {itemWeight} lb</Text>
                </View>
              </View>
            );
          })
        )}

        <View style={styles.totalBox}>
          <Text style={styles.totalText}>Total Rolls: {totalRolls}</Text>
          <Text style={styles.totalText}>Total Weight: {totalWeight} lb</Text>
        </View>

        <Pressable style={styles.scanButton} onPress={goNewScannerTest}>
          <Text style={styles.scanButtonText}>Test New Scanner</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={goTemplateLibrary}>
          <Text style={styles.secondaryButtonText}>Template Library</Text>
        </Pressable>
        <Pressable style={styles.previewButton} onPress={goPreview}>
          <Text style={styles.previewButtonText}>Preview / Share</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ===== PREVIEW SCREEN =====
function PreviewScreen({ data, goBack }) {
  const totalRolls = data.items.reduce((sum, item) => sum + item.rolls.length, 0);
  const totalWeight = data.items.reduce((sum, item) => {
    const itemWeight = item.rolls.reduce((rollSum, roll) => rollSum + roll.weight, 0);
    return sum + itemWeight;
  }, 0);

  const buildPdfHtml = () => {
    const rowsHtml = data.items
      .map((item) => {
        const itemWeight = item.rolls.reduce((sum, roll) => sum + roll.weight, 0);
        const rollRows = item.rolls
          .map(
            (roll, index) => `
              <tr>
                <td>${index === 0 ? item.itemNumber : ''}</td>
                <td>1</td>
                <td>${roll.rollNumber}</td>
                <td>${roll.weight}</td>
              </tr>
            `
          )
          .join('');
        return `
          ${rollRows}
          <tr class="itemTotal">
            <td>ITEM TOTAL</td>
            <td>${item.rolls.length}</td>
            <td></td>
            <td>${itemWeight}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #000; }
            .title { font-size: 24px; font-weight: bold; border: 2px solid #000; display: inline-block; padding: 10px 20px; margin-bottom: 18px; }
            .headerTable { width: 60%; margin-bottom: 16px; border-collapse: collapse; font-size: 13px; }
            .headerTable td { border-bottom: 1px solid #777; padding: 4px; }
            .label { font-weight: bold; width: 170px; }
            .mainTable { width: 100%; border-collapse: collapse; font-size: 12px; }
            .mainTable th, .mainTable td { border: 1px solid #000; padding: 6px; }
            .mainTable th { background: #e5e5e5; font-weight: bold; }
            .itemTotal { background: #fff200; font-weight: bold; }
            .grand { margin-top: 20px; border: 2px solid #000; padding: 12px; font-size: 18px; font-weight: bold; display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <div class="title">ROLL MANIFEST</div>
          <table class="headerTable">
            <tr><td class="label">Date:</td><td>${data.date}</td></tr>
            <tr><td class="label">Customer Name:</td><td>${data.customerName}</td></tr>
            <tr><td class="label">Order Number:</td><td>${data.orderNumber}</td></tr>
            <tr><td class="label">Customer PO:</td><td>${data.customerPO}</td></tr>
            <tr><td class="label">FSC Certification Code:</td><td>SW-COC-1439</td></tr>
          </table>
          <table class="mainTable">
            <tr><th>Item</th><th>Rolls</th><th>Roll #</th><th>Weight</th></tr>
            ${rowsHtml}
          </table>
          <div class="grand">
            <div>TOTAL ROLLS:<br/>TOTAL WEIGHT:</div>
            <div style="text-align:right;">${totalRolls}<br/>${totalWeight} lb</div>
          </div>
        </body>
      </html>
    `;
  };

  const sharePDF = async () => {
    try {
      const html = buildPdfHtml();
      const file = await Print.printToFileAsync({ html });

      // Build filename: SO{orderNumber}_{date}.pdf
      // Strips any existing "SO" prefix from Order Number before adding
      // our own, so "SO3194825" and "3194825" both give "SO3194825_date.pdf"
      const rawSO = (data.orderNumber || '').trim().replace(/^SO/i, '').replace(/[^a-zA-Z0-9]/g, '');
      const dateStr = (data.date || '').trim().replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = rawSO
        ? `SO${rawSO}_${dateStr}.pdf`
        : `${dateStr || 'manifest'}.pdf`;

      // Using require() instead of a top-level import avoids Snack's
      // module resolution bug that adds ".js" to package names.
      try {
        const FileSystem = require('expo-file-system');
        const destUri = file.uri.replace(/[^/]+\.pdf$/, fileName);
        await FileSystem.moveAsync({ from: file.uri, to: destUri });

        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Sharing not available', 'Sharing is not available on this device.');
          return;
        }
        await Sharing.shareAsync(destUri, {
          mimeType: 'application/pdf',
          dialogTitle: fileName,
          UTI: 'com.adobe.pdf',
        });
      } catch (fsError) {
        console.log('FileSystem rename failed, sharing original:', fsError);
        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Sharing not available', 'Sharing is not available on this device.');
          return;
        }
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/pdf',
          dialogTitle: fileName,
          UTI: 'com.adobe.pdf',
        });
      }
    } catch (error) {
      console.log(error);
      Alert.alert('PDF Error', 'Could not create or share PDF.');
    }
  };

  return (
    <View style={styles.app}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} style={styles.menuButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle}>Preview Manifest</Text>
      </View>

      <ScrollView style={styles.previewPage} contentContainerStyle={styles.previewContent}>
        <View style={styles.mobilePaper}>
          <View style={styles.previewTopRow}>
            <Text style={styles.previewTitle}>ROLL MANIFEST</Text>
            <View style={styles.previewLogoBox}>
              <Text style={styles.previewLogo}>Midland Paper</Text>
              <Text style={styles.previewLogoSub}>Packaging + Supplies</Text>
              <Text style={styles.previewFsc}>FSC</Text>
            </View>
          </View>

          <View style={styles.previewHeaderBox}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewHeaderLabel}>Date:</Text>
              <Text style={styles.previewHeaderValue}>{data.date}</Text>
            </View>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewHeaderLabel}>Customer:</Text>
              <Text style={styles.previewHeaderValue}>{data.customerName}</Text>
            </View>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewHeaderLabel}>Order:</Text>
              <Text style={styles.previewHeaderValue}>{data.orderNumber}</Text>
            </View>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewHeaderLabel}>Customer PO:</Text>
              <Text style={styles.previewHeaderValue}>{data.customerPO}</Text>
            </View>
          </View>

          {data.items.map((item) => {
            const itemWeight = item.rolls.reduce((sum, roll) => sum + roll.weight, 0);
            return (
              <View key={item.id} style={styles.mobileItemBox}>
                <Text style={styles.mobileItemTitle}>ITEM: {item.itemNumber}</Text>
                <View style={styles.mobileTableHeader}>
                  <Text style={styles.mobileNumCol}>#</Text>
                  <Text style={styles.mobileRollCol}>ROLL #</Text>
                  <Text style={styles.mobileWeightCol}>WEIGHT</Text>
                </View>
                {item.rolls.map((roll, index) => (
                  <View key={roll.id} style={styles.mobileTableRow}>
                    <Text style={styles.mobileNumCol}>{index + 1}</Text>
                    <Text style={styles.mobileRollCol}>{roll.rollNumber}</Text>
                    <Text style={styles.mobileWeightCol}>{roll.weight}</Text>
                  </View>
                ))}
                <View style={styles.mobileItemTotal}>
                  <Text style={styles.mobileItemTotalText}>ROLLS: {item.rolls.length}</Text>
                  <Text style={styles.mobileItemTotalText}>WEIGHT: {itemWeight} lb</Text>
                </View>
              </View>
            );
          })}

          <View style={styles.mobileGrandTotal}>
            <View>
              <Text style={styles.mobileGrandLabel}>TOTAL ROLLS:</Text>
              <Text style={styles.mobileGrandLabel}>TOTAL WEIGHT:</Text>
            </View>
            <View>
              <Text style={styles.mobileGrandValue}>{totalRolls}</Text>
              <Text style={styles.mobileGrandValue}>{totalWeight} lb</Text>
            </View>
          </View>
        </View>

        <View style={styles.pdfButtonsRow}>
          <Pressable style={styles.shareButton} onPress={sharePDF}>
            <Text style={styles.pdfButtonText}>Share PDF</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ===== STYLES =====
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

  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  menuIcon: { color: 'white', fontSize: 26, fontWeight: 'bold' },
  backIcon: { color: 'white', fontSize: 38, fontWeight: '300', marginTop: -4 },
  topTitle: { color: 'white', fontSize: 22, fontWeight: '700' },

  sideMenu: {
    position: 'absolute',
    top: 72,
    left: 0,
    width: 260,
    bottom: 0,
    backgroundColor: 'white',
    zIndex: 10,
    paddingTop: 20,
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
  },

  menuItem: {
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f1f1',
  },

  menuItemText: { fontSize: 18, fontWeight: '600', color: '#111827' },

  menuToggleRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingBottom: 30,
    paddingTop: 8,
  },

  homeContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 8, color: '#111827' },
  subtitle: { fontSize: 16, marginBottom: 32, color: '#6b7280' },

  mainButton: {
    backgroundColor: '#111827',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
  },

  mainButtonText: { color: 'white', fontSize: 17, textAlign: 'center', fontWeight: 'bold' },

  secondaryButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },

  secondaryButtonText: { color: '#111827', fontSize: 17, textAlign: 'center', fontWeight: '600' },

  formPage: { flex: 1 },
  formContent: { padding: 20, paddingBottom: 40 },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    marginTop: 8,
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

  suggestionsBox: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    marginTop: -8,
    marginBottom: 12,
    overflow: 'hidden',
  },

  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },

  suggestionNameArea: {
    flex: 1,
    padding: 14,
  },

  suggestionText: {
    fontSize: 16,
    color: '#111827',
  },

  suggestionDeleteBtn: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  suggestionDeleteText: {
    fontSize: 20,
    color: '#9ca3af',
    fontWeight: '300',
  },

  emptyBox: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 20,
    marginBottom: 16,
  },

  emptyText: { color: '#6b7280', textAlign: 'center', fontSize: 16 },

  itemBox: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },

  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },

  itemTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },

  deleteItemButton: {
    backgroundColor: '#991b1b',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },

  deleteItemText: { color: 'white', fontSize: 12, fontWeight: '700' },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginBottom: 4,
  },

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },

  rollCol: { flex: 2, fontSize: 13, fontWeight: '600', color: '#111827' },
  weightCol: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111827' },
  actionCol: { flex: 1.3, flexDirection: 'row', justifyContent: 'flex-end' },

  smallEditButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 5,
    marginRight: 4,
  },

  smallDeleteButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 5,
  },

  smallButtonText: { color: 'white', fontSize: 11, fontWeight: '700' },

  noRollsText: { color: '#6b7280', paddingVertical: 10, textAlign: 'center' },

  itemTotalRow: {
    backgroundColor: '#f9fafb',
    marginTop: 10,
    padding: 10,
    borderRadius: 6,
  },

  itemTotalText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 3,
  },

  totalBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginBottom: 16,
  },

  totalText: { fontSize: 17, fontWeight: '700', marginBottom: 6, color: '#111827' },

  scanButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 10,
    width: '100%',
    marginBottom: 12,
  },

  scanButtonText: { color: 'white', fontSize: 17, fontWeight: '800', textAlign: 'center' },

  previewButton: {
    backgroundColor: '#111827',
    paddingVertical: 16,
    borderRadius: 10,
    width: '100%',
  },

  previewButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  previewPage: {
    flex: 1,
    backgroundColor: '#e5e7eb',
  },

  previewContent: {
    padding: 14,
    paddingBottom: 40,
  },

  mobilePaper: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 14,
  },

  previewTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },

  previewTitle: {
    borderWidth: 2,
    borderColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 20,
    fontWeight: '900',
    color: '#000',
  },

  previewLogoBox: {
    alignItems: 'center',
    maxWidth: 135,
  },

  previewLogo: {
    fontSize: 17,
    fontWeight: '800',
    color: '#000',
  },

  previewLogoSub: {
    fontSize: 8,
    fontWeight: '700',
    fontStyle: 'italic',
    color: '#000',
  },

  previewFsc: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
    color: '#000',
  },

  previewHeaderBox: {
    marginBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
    paddingBottom: 8,
  },

  previewHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#999',
    paddingVertical: 3,
  },

  previewHeaderLabel: {
    width: 115,
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
  },

  previewHeaderValue: {
    flex: 1,
    fontSize: 12,
    color: '#000',
  },

  mobileItemBox: {
    borderWidth: 1.5,
    borderColor: '#111827',
    marginBottom: 14,
  },

  mobileItemTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#000',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },

  mobileTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderTopWidth: 1,
    borderBottomWidth: 1.5,
    borderColor: '#111827',
    paddingVertical: 6,
  },

  mobileTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    paddingVertical: 6,
  },

  mobileNumCol: {
    width: 34,
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
    textAlign: 'center',
  },

  mobileRollCol: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
  },

  mobileWeightCol: {
    width: 72,
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
    textAlign: 'right',
    paddingRight: 8,
  },

  mobileItemTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1.5,
    borderColor: '#111827',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },

  mobileItemTotalText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
  },

  mobileGrandTotal: {
    borderWidth: 2,
    borderColor: '#111827',
    padding: 12,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  mobileGrandLabel: {
    fontSize: 17,
    fontWeight: '900',
    color: '#000',
    marginBottom: 10,
  },

  mobileGrandValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#000',
    textAlign: 'right',
    marginBottom: 10,
  },

  pdfButtonsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 20,
    marginBottom: 20,
  },

  shareButton: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 8,
  },

  pdfButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
});
