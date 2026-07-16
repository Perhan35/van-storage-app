import React, { useEffect } from "react";
import { View, StyleSheet, Text, Pressable, useColorScheme, LogBox } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PaperProvider, IconButton } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../src/store/useAppStore";
import { useAppTheme } from "../src/theme/useAppTheme";
import { paperDarkTheme, paperLightTheme, darkPalette, lightPalette } from "../src/theme/palette";
import { configureNotificationHandler } from "../src/notifications/reminders";
import { OnboardingTutorial } from "../src/components/OnboardingTutorial";
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
  const { palette } = useAppTheme();

  return (
    <IconButton
      icon="close"
      size={26}
      iconColor={palette.headerTint}
      style={{ margin: 0 }}
      onPress={() => router.back()}
    />
  );
}

function HeaderRight() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const canUndo = useAppStore((s) => s.undoStack.length > 0);
  const canRedo = useAppStore((s) => s.redoStack.length > 0);
  const cancelEditChanges = useAppStore((s) => s.cancelEditChanges);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {!editMode && (
        <IconButton
          icon="exit-to-app"
          size={24}
          iconColor={palette.headerTint}
          style={{ margin: 0 }}
          onPress={() => router.push("/out-of-van")}
        />
      )}
      {!editMode && (
        <IconButton
          icon="magnify"
          size={24}
          iconColor={palette.headerTint}
          style={{ margin: 0 }}
          onPress={() => router.push("/search")}
        />
      )}
      {editMode && (
        <>
          <IconButton
            icon="undo-variant"
            size={24}
            iconColor={palette.headerTint}
            disabled={!canUndo}
            accessibilityLabel={t("nav.undo")}
            style={{ margin: 0 }}
            onPress={undo}
          />
          <IconButton
            icon="redo-variant"
            size={24}
            iconColor={palette.headerTint}
            disabled={!canRedo}
            accessibilityLabel={t("nav.redo")}
            style={{ margin: 0 }}
            onPress={redo}
          />
          <IconButton
            icon="cancel"
            size={24}
            iconColor={palette.danger}
            accessibilityLabel={t("nav.cancel_edit")}
            style={{ margin: 0 }}
            onPress={cancelEditChanges}
          />
        </>
      )}
      <IconButton
        icon={editMode ? "check" : "cursor-move"}
        size={24}
        iconColor={editMode ? palette.success : palette.headerTint}
        style={{ margin: 0 }}
        onPress={toggleEditMode}
      />
      {!editMode && (
        <IconButton
          icon="cog"
          size={24}
          iconColor={palette.headerTint}
          style={{ margin: 0 }}
          onPress={() => router.push("/settings")}
        />
      )}
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
              title: editMode ? t("nav.edit_mode") : t("nav.my_van"),
              headerRight: () => <HeaderRight />,
            }}
          />
          <Stack.Screen
            name="zone/[id]"
            options={{
              title: t("nav.zone"),
              animation: "fade",
              // Default fade duration (500ms, iOS-only) reads as sluggish next
              // to the map's own dive-in animation — shortened so the two
              // blend into one continuous motion instead of two visible steps.
              animationDuration: 320,
            }}
          />
          <Stack.Screen
            name="search"
            options={{ title: t("nav.search") }}
          />
          <Stack.Screen
            name="out-of-van"
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
