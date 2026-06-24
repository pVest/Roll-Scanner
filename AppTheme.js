// ===== APP THEME =====
// Central design system for PaperRollsPro.
// ALL colors, fonts, spacing, and animation constants live here.
// Import what you need:
//   import { useTheme, FONTS, SPACING, animate } from './AppTheme';
//
// To get styles in a component:
//   const { styles, colors } = useTheme();
//
// This file has zero external dependencies - only React/RN built-ins.

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Appearance, StyleSheet, Animated, Easing } from 'react-native';

// ─── Color palettes ───────────────────────────────────────────────────────────
// Inspired by Expo.dev: clean whites, near-blacks, a strong blue accent,
// and semantic colors that remain consistent between themes.
export const COLORS = {
  light: {
    // Backgrounds
    bgPrimary:   '#f9fafb',   // page background
    bgCard:      '#ffffff',   // cards, inputs, modals
    bgElevated:  '#ffffff',   // elevated surfaces
    bgSubtle:    '#f3f4f6',   // subtle sections, table headers

    // Borders
    border:      '#e5e7eb',
    borderFocus: '#2563eb',

    // Text
    textPrimary:     '#111827',
    textSecondary:   '#6b7280',
    textPlaceholder: '#9ca3af',
    textInverse:     '#ffffff',

    // Top bar
    topBar:      '#111827',
    topBarText:  '#ffffff',

    // Accent / Primary action (Add Roll, Accept, main CTA)
    primary:     '#2563eb',
    primaryText: '#ffffff',

    // Danger (Delete)
    danger:      '#dc2626',
    dangerText:  '#ffffff',

    // Success (Done, Accept, Added toast)
    success:     '#16a34a',
    successText: '#ffffff',

    // Warning (Update/Edit action)
    warning:     '#d97706',
    warningText: '#ffffff',

    // Secondary (Template Library, Preview)
    secondary:     '#ffffff',
    secondaryText: '#111827',
    secondaryBorder: '#e5e7eb',

    // Scanner UI
    scannerBg:     '#111827',
    scannerText:   '#ffffff',
    scannerSubtext:'#d1d5db',
    scannerLocked: '#22c55e',
    scannerCandidate: '#fbbf24',

    // Highlight flash after edit
    highlightColor: '#fef08a',

    // Shadow (light theme only)
    shadowColor: '#000000',
    shadowOpacity: 0.06,

    // Toggle (theme switcher)
    toggleTrackOff: '#e5e7eb',
    toggleTrackOn:  '#2563eb',
    toggleThumb:    '#ffffff',
  },

  dark: {
    // Backgrounds
    bgPrimary:   '#0f0f0f',
    bgCard:      '#1c1c1e',
    bgElevated:  '#2c2c2e',
    bgSubtle:    '#1c1c1e',

    // Borders
    border:      '#2d2d2d',
    borderFocus: '#3b82f6',

    // Text
    textPrimary:     '#f9fafb',
    textSecondary:   '#a1a1aa',
    textPlaceholder: '#52525b',
    textInverse:     '#000000',

    // Top bar
    topBar:      '#000000',
    topBarText:  '#f9fafb',

    // Accent / Primary
    primary:     '#3b82f6',
    primaryText: '#ffffff',

    // Danger
    danger:      '#ef4444',
    dangerText:  '#ffffff',

    // Success
    success:     '#22c55e',
    successText: '#ffffff',

    // Warning
    warning:     '#f59e0b',
    warningText: '#ffffff',

    // Secondary
    secondary:     '#27272a',
    secondaryText: '#f4f4f5',
    secondaryBorder: '#3f3f46',

    // Scanner UI
    scannerBg:      '#111827',
    scannerText:    '#ffffff',
    scannerSubtext: '#d1d5db',
    scannerLocked:  '#22c55e',
    scannerCandidate: '#fbbf24',

    // Highlight flash
    highlightColor: '#854d0e',

    // Shadow (none in dark)
    shadowColor: '#000000',
    shadowOpacity: 0,

    // Toggle
    toggleTrackOff: '#3f3f46',
    toggleTrackOn:  '#3b82f6',
    toggleThumb:    '#ffffff',
  },
};

// ─── Typography ───────────────────────────────────────────────────────────────
export const FONTS = {
  // Sizes
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  xxl:  24,
  xxxl: 28,

  // Weights (as strings for StyleSheet)
  regular: '400',
  medium:  '500',
  semibold:'600',
  bold:    '700',
  heavy:   '800',
};

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const SPACING = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 28,
};

// ─── Border radius ────────────────────────────────────────────────────────────
export const RADIUS = {
  sm:  6,
  md:  10,
  lg:  14,
  xl:  20,
  full: 999,
};

// ─── Animation constants ──────────────────────────────────────────────────────
export const ANIM = {
  // Durations
  fast:   150,
  normal: 250,
  slow:   400,

  // Easing presets
  easeOut: Easing.out(Easing.cubic),
  spring:  { tension: 140, friction: 12 },
};

// Fade in/out an Animated.Value
// Usage: animate.fade(myValue, 1, ANIM.fast)
export const animate = {
  // Simple timing
  to: (value, toValue, duration = ANIM.normal, easing = ANIM.easeOut) =>
    Animated.timing(value, { toValue, duration, easing, useNativeDriver: true }),

  // Fade (opacity only, native driver safe)
  fade: (value, toValue, duration = ANIM.normal) =>
    Animated.timing(value, { toValue, duration, easing: ANIM.easeOut, useNativeDriver: true }),

  // Spring (for toggle thumb, bouncy feel)
  spring: (value, toValue) =>
    Animated.spring(value, { toValue, ...ANIM.spring, useNativeDriver: true }),

  // Highlight flash: 1 → 0 over `slow` duration
  // Value should drive opacity of a colored overlay
  highlight: (value, duration = ANIM.slow) => {
    value.setValue(1);
    return Animated.timing(value, {
      toValue: 0,
      duration,
      easing: ANIM.easeOut,
      useNativeDriver: true,
    });
  },

  // Screen transition: fade out, call callback, fade in
  screenTransition: (value, callback, outDuration = ANIM.fast, inDuration = ANIM.normal) =>
    Animated.timing(value, { toValue: 0, duration: outDuration, useNativeDriver: true })
      .start(() => {
        callback();
        Animated.timing(value, { toValue: 1, duration: inDuration, useNativeDriver: true }).start();
      }),
};

// ─── makeStyles factory ───────────────────────────────────────────────────────
// Returns a StyleSheet for the given color palette.
// Components call this once per render (memoized by theme key).
export function makeStyles(colors) {
  return StyleSheet.create({
    // Layout
    app:    { flex: 1, backgroundColor: colors.bgPrimary },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },

    // Top bar
    topBar: {
      backgroundColor: colors.topBar,
      paddingTop: 50,
      paddingBottom: SPACING.lg,
      paddingHorizontal: SPACING.lg,
      flexDirection: 'row',
      alignItems: 'center',
    },
    topTitle: {
      color: colors.topBarText,
      fontSize: FONTS.lg,
      fontWeight: FONTS.bold,
      flex: 1,
    },
    menuButton:  { marginRight: SPACING.md },
    menuIcon:    { color: colors.topBarText, fontSize: FONTS.xl },
    backIcon:    { color: colors.topBarText, fontSize: 28 },

    // Page / form layout
    formPage:    { flex: 1, backgroundColor: colors.bgPrimary },
    formContent: { padding: SPACING.lg, paddingBottom: 60 },

    // Section title
    sectionTitle: {
      fontSize: FONTS.lg,
      fontWeight: FONTS.bold,
      color: colors.textPrimary,
      marginTop: SPACING.xl,
      marginBottom: SPACING.sm,
    },

    // Input fields
    input: {
      backgroundColor: colors.bgCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      fontSize: FONTS.md,
      color: colors.textPrimary,
      marginBottom: SPACING.md,
      minHeight: 52,
      justifyContent: 'center',
    },

    // Buttons
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md + 2,
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: FONTS.md,
      fontWeight: FONTS.bold,
    },

    secondaryButton: {
      backgroundColor: colors.secondary,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md + 2,
      alignItems: 'center',
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: colors.secondaryBorder,
    },
    secondaryButtonText: {
      color: colors.secondaryText,
      fontSize: FONTS.md,
      fontWeight: FONTS.semibold,
    },

    dangerButton: {
      backgroundColor: colors.danger,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md + 2,
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    dangerButtonText: {
      color: colors.dangerText,
      fontSize: FONTS.md,
      fontWeight: FONTS.bold,
    },

    warningButton: {
      backgroundColor: colors.warning,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md + 2,
      alignItems: 'center',
      marginBottom: SPACING.md,
    },

    successButton: {
      backgroundColor: colors.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md + 2,
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    successButtonText: {
      color: colors.successText,
      fontSize: FONTS.md,
      fontWeight: FONTS.bold,
    },

    cancelButton: {
      paddingVertical: SPACING.md,
      alignItems: 'center',
      marginBottom: SPACING.sm,
    },
    cancelButtonText: {
      color: colors.textSecondary,
      fontSize: FONTS.md,
      fontWeight: FONTS.medium,
    },

    // Cards / item boxes
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.lg,
      marginBottom: SPACING.md,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.shadowOpacity,
      shadowRadius: 6,
      elevation: colors.shadowOpacity > 0 ? 2 : 0,
    },

    // Empty state
    emptyBox: {
      backgroundColor: colors.bgCard,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.xl,
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: FONTS.md,
    },

    // Table rows
    tableHeader: {
      flexDirection: 'row',
      paddingVertical: SPACING.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableHeaderText: {
      fontSize: FONTS.xs,
      fontWeight: FONTS.heavy,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: SPACING.sm + 2,
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableRowText: {
      fontSize: FONTS.sm,
      color: colors.textPrimary,
    },

    // Totals / summary
    totalBox: {
      backgroundColor: colors.bgCard,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.lg,
      marginVertical: SPACING.md,
    },
    totalText: {
      fontSize: FONTS.md,
      fontWeight: FONTS.bold,
      color: colors.textPrimary,
      marginBottom: SPACING.xs,
    },

    // Modal backdrop
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      paddingHorizontal: SPACING.xl,
    },
    modalCard: {
      backgroundColor: colors.bgCard,
      borderRadius: RADIUS.xl,
      padding: SPACING.xl,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
      elevation: 10,
    },
    modalTitle: {
      fontSize: FONTS.lg,
      fontWeight: FONTS.bold,
      color: colors.textPrimary,
      marginBottom: SPACING.md,
    },

    // Text helpers
    textPrimary:   { color: colors.textPrimary },
    textSecondary: { color: colors.textSecondary },
    textDanger:    { color: colors.danger },
    textSuccess:   { color: colors.success },
  });
}

// ─── Theme Context ─────────────────────────────────────────────────────────────
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = Appearance.getColorScheme() || 'light';
  const [scheme, setScheme] = useState(systemScheme);

  // Listen for OS theme changes
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      // Only auto-update if user hasn't manually overridden
      if (!userOverrideRef.current) {
        setScheme(colorScheme || 'light');
      }
    });
    return () => sub?.remove?.();
  }, []);

  // Track whether user manually toggled (prevents OS listener from overriding)
  const userOverrideRef = useRef(false);

  // Screen fade value for theme transitions
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const toggleTheme = () => {
    userOverrideRef.current = true;
    // Fade out → swap → fade in
    animate.fade(fadeAnim, 0, ANIM.fast).start(() => {
      setScheme((s) => (s === 'light' ? 'dark' : 'light'));
      animate.fade(fadeAnim, 1, ANIM.normal).start();
    });
  };

  const isDark = scheme === 'dark';
  const colors = COLORS[scheme];
  const styles = makeStyles(colors);

  return (
    <ThemeContext.Provider value={{ isDark, colors, styles, toggleTheme, fadeAnim, scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook for components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

// ─── AnimatedThemeToggle ──────────────────────────────────────────────────────
// Beautiful animated sun/moon toggle for the side menu.
// Usage: <AnimatedThemeToggle />
import { View, Text, Pressable } from 'react-native';

export function AnimatedThemeToggle() {
  const { isDark, toggleTheme, colors } = useTheme();

  const thumbAnim = useRef(new Animated.Value(isDark ? 1 : 0)).current;
  const trackColorAnim = useRef(new Animated.Value(isDark ? 1 : 0)).current;

  useEffect(() => {
    const toVal = isDark ? 1 : 0;
    Animated.parallel([
      animate.spring(thumbAnim, toVal),
      animate.to(trackColorAnim, toVal, ANIM.normal),
    ]).start();
  }, [isDark]);

  const thumbTranslate = thumbAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  const trackBg = trackColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.toggleTrackOff, colors.toggleTrackOn],
  });

  return (
    <Pressable
      onPress={toggleTheme}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.lg,
        gap: SPACING.md,
      }}
    >
      <Text style={{ fontSize: 18 }}>{isDark ? '🌙' : '☀️'}</Text>
      <Text style={{
        flex: 1,
        fontSize: FONTS.md,
        color: colors.textPrimary,
        fontWeight: FONTS.medium,
      }}>
        {isDark ? 'Dark Mode' : 'Light Mode'}
      </Text>

      {/* Toggle track */}
      <Animated.View style={{
        width: 48,
        height: 28,
        borderRadius: RADIUS.full,
        backgroundColor: trackBg,
        justifyContent: 'center',
        padding: 2,
      }}>
        {/* Toggle thumb */}
        <Animated.View style={{
          width: 24,
          height: 24,
          borderRadius: RADIUS.full,
          backgroundColor: colors.toggleThumb,
          transform: [{ translateX: thumbTranslate }],
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.15,
          shadowRadius: 3,
          elevation: 2,
        }} />
      </Animated.View>
    </Pressable>
  );
}