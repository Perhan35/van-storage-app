import React, { useEffect } from "react";
import { View, StyleSheet, Text, Pressable, useColorScheme, LogBox } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../src/store/useAppStore";
import { useAppTheme } from "../src/theme/useAppTheme";
import { paperDarkTheme, paperLightTheme, darkPalette, lightPalette } from "../src/theme/palette";
import { configureNotificationHandler } from "../src/notifications/reminders";
import { OnboardingTutorial } from "../src/components/OnboardingTutorial";
import { HeaderIcon } from "../src/components/HeaderIcon";
import { DiscardEditChangesDialog } from "../src/components/dialogs/DiscardEditChangesDialog";
import i18n from "../src/i18n";

// expo-notifications warns on import when running in Expo Go (SDK 53+ dropped
// support there); real dev client / production builds never hit this. Silence
// the in-app overlay for it since it's expected noise, not an actionable bug.
LogBox.ignoreLogs([
  "`expo-notifications` functionality is not fully supported in Expo Go",
  "expo-notifications: Android Push notifications (remote notifications) functionality",
]);

// Rendered *instead of* RootLayout when a render error escapes, so it must not
// depend on PaperProvider or the store — use plain RN components, the default
// i18n instance (initializes on import), and the OS color scheme directly.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const scheme = useColorScheme();
  const palette = scheme === "dark" ? darkPalette : lightPalette;
  return (
    <View style={[styles.errorContainer, { backgroundColor: palette.background }]}>
      <Text style={[styles.errorMessage, { color: palette.onSurface }]}>
        {i18n.t("startup.error")}
      </Text>
      <Text style={[styles.errorDetail, { color: palette.onSurfaceVariant }]}>
        {error.message}
      </Text>
      <Pressable
        onPress={retry}
        style={[styles.retryButton, { backgroundColor: palette.primary }]}
      >
        <Text style={[styles.retryLabel, { color: palette.headerTint }]}>
          {i18n.t("startup.retry")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorMessage: { textAlign: "center", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  errorDetail: { textAlign: "center", fontSize: 13, marginBottom: 20 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryLabel: { fontSize: 15, fontWeight: "600" },
});

function GameHeaderRight() {
  const router = useRouter();

  return <HeaderIcon icon="close" size={26} onPress={() => router.back()} />;
}

function HeaderRight() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);
  const outlineEditMode = useAppStore((s) => s.outlineEditMode);
  const toggleOutlineEditMode = useAppStore((s) => s.toggleOutlineEditMode);
  // Editing zones/outline is meaningless in the all-locations overview, so the
  // edit toggle is hidden there (#4).
  const overviewMode = useAppStore((s) => s.overviewMode);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const canUndo = useAppStore((s) => s.undoStack.length > 0);
  const canRedo = useAppStore((s) => s.redoStack.length > 0);
  // Leaving an edit session is guarded by a confirmation, and both the ✕ below
  // and the Android back button (registered on the map screen) go through it.
  const discardPrompt = useAppStore((s) => s.discardPrompt);
  const requestDiscard = useAppStore((s) => s.requestDiscard);
  const dismissDiscard = useAppStore((s) => s.dismissDiscard);
  const confirmDiscard = useAppStore((s) => s.confirmDiscard);
  // Outline-edit sub-mode has its own history and its own ok/cancel that act
  // only on the outline, returning to zone editing rather than leaving edit
  // mode entirely.
  const undoOutline = useAppStore((s) => s.undoOutline);
  const redoOutline = useAppStore((s) => s.redoOutline);
  const canUndoOutline = useAppStore((s) => s.outlineUndoStack.length > 0);
  const canRedoOutline = useAppStore((s) => s.outlineRedoStack.length > 0);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {!editMode && (
        <HeaderIcon
          icon="exit-to-app"
          tone="outOfVan"
          size={30}
          onPress={() => router.push("/out-of-van")}
        />
      )}
      {!editMode && (
        <HeaderIcon icon="magnify" tone="search" size={30} onPress={() => router.push("/search")} />
      )}
      {editMode && (
        <>
          {/* Hidden while editing the outline: the polygon toggle is the way
              *into* outline-edit; you leave it with the ok/cancel below. A
              divider sets it apart from the undo/redo/cancel/confirm group
              that follows, since it's a mode switch rather than a session
              control. */}
          {!outlineEditMode && (
            <>
              <HeaderIcon
                icon="vector-polygon"
                tone="accent"
                size={30}
                accessibilityLabel={t("nav.edit_outline")}
                onPress={toggleOutlineEditMode}
              />
              <View
                style={{
                  width: 1.5,
                  height: 32,
                  backgroundColor: palette.headerTintMuted,
                  marginHorizontal: 2,
                  borderRadius: 1,
                }}
              />
            </>
          )}
          <HeaderIcon
            icon="undo-variant"
            tone="action"
            size={30}
            disabled={outlineEditMode ? !canUndoOutline : !canUndo}
            accessibilityLabel={t("nav.undo")}
            onPress={outlineEditMode ? undoOutline : undo}
          />
          <HeaderIcon
            icon="redo-variant"
            tone="action"
            size={30}
            disabled={outlineEditMode ? !canRedoOutline : !canRedo}
            accessibilityLabel={t("nav.redo")}
            onPress={outlineEditMode ? redoOutline : redo}
          />
          {/* In outline-edit, discard drops only the outline changes and returns
              to zone editing; otherwise it reverts the whole session. A plain
              cross, paired with the check that follows: ✕ discards, ✓ keeps. */}
          <HeaderIcon
            icon="close"
            tone="danger"
            size={30}
            accessibilityLabel={outlineEditMode ? t("nav.cancel_outline") : t("nav.cancel_edit")}
            onPress={requestDiscard}
          />
        </>
      )}
      {!overviewMode && (
        // In outline-edit, the check confirms the outline and returns to zone
        // editing (stays in edit mode); otherwise it toggles edit mode itself.
        <HeaderIcon
          icon={editMode ? "check" : "cursor-move"}
          tone={editMode ? "success" : "accent"}
          size={30}
          accessibilityLabel={outlineEditMode ? t("nav.confirm_outline") : undefined}
          onPress={outlineEditMode ? toggleOutlineEditMode : toggleEditMode}
        />
      )}
      {!editMode && (
        <HeaderIcon icon="cog" tone="utility" size={30} onPress={() => router.push("/settings")} />
      )}

      {/* Renders through Paper's portal, so it fills the screen rather than
          being clipped to the header bar it's declared in. */}
      <DiscardEditChangesDialog
        prompt={discardPrompt}
        onDismiss={dismissDiscard}
        onConfirm={confirmDiscard}
      />
    </View>
  );
}

export default function RootLayout() {
  const { t } = useTranslation();
  const init = useAppStore((s) => s.init);
  const editMode = useAppStore((s) => s.editMode);
  const { palette, isDark } = useAppTheme();

  useEffect(() => {
    configureNotificationHandler();
    init();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={isDark ? paperDarkTheme : paperLightTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.headerBackground },
            headerTintColor: palette.headerTint,
            headerTitleStyle: { fontWeight: "bold" },
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          <Stack.Screen
            name="index"
            options={{
              // Fallback shown only before the screen sets its own dynamic
              // headerTitle (active location name / overview / edit mode).
              title: editMode ? t("nav.edit_mode") : t("nav.app_title"),
              headerRight: () => <HeaderRight />,
            }}
          />
          <Stack.Screen
            name="zone/[id]"
            options={{
              title: t("nav.zone"),
              animation: "fade",
              // Shortened fade duration (200ms) to blend seamlessly with the map's
              // fast de-zoom animation on return.
              animationDuration: 200,
            }}
          />
          <Stack.Screen
            name="search"
            options={{ title: t("nav.search") }}
          />
          <Stack.Screen
            name="out-of-van"
            // Fallback shown only before the screen sets its own dynamic
            // title (location name vs. the all-locations overview label).
            options={{ title: t("nav.out_of_van") }}
          />
          <Stack.Screen
            name="settings"
            options={{ title: t("nav.settings") }}
          />
          <Stack.Screen
            name="game"
            options={{
              title: t("game.title"),
              headerBackVisible: false,
              headerRight: () => <GameHeaderRight />,
            }}
          />
        </Stack>
        <OnboardingTutorial />
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
