import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PaperProvider, IconButton, Text } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../src/store/useAppStore";
import { useAppTheme } from "../src/theme/useAppTheme";
import { paperDarkTheme, paperLightTheme } from "../src/theme/palette";
import "../src/i18n";

function HeaderRight() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <IconButton
        icon="exit-to-app"
        size={24}
        iconColor={palette.headerTint}
        style={{ margin: 0 }}
        onPress={() => router.push("/out-of-van")}
      />
      <IconButton
        icon="magnify"
        size={24}
        iconColor={palette.headerTint}
        style={{ margin: 0 }}
        onPress={() => router.push("/search")}
      />
      {editMode && (
        <Text style={{ color: palette.headerTint, fontWeight: "600", fontSize: 12, marginHorizontal: 4 }}>
          {t("nav.edit_mode")}
        </Text>
      )}
      <IconButton
        icon={editMode ? "check" : "cursor-move"}
        size={24}
        iconColor={editMode ? palette.editModeAccent : palette.headerTint}
        style={{ margin: 0 }}
        onPress={toggleEditMode}
      />
      <IconButton
        icon="cog"
        size={24}
        iconColor={palette.headerTint}
        style={{ margin: 0 }}
        onPress={() => router.push("/settings")}
      />
    </View>
  );
}

export default function RootLayout() {
  const { t } = useTranslation();
  const init = useAppStore((s) => s.init);
  const { palette, isDark } = useAppTheme();

  useEffect(() => {
    init();
  }, []);

  return (
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
            title: t("nav.my_van"),
            headerRight: () => <HeaderRight />,
          }}
        />
        <Stack.Screen
          name="zone/[id]"
          options={{ title: t("nav.zone") }}
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
      </Stack>
    </PaperProvider>
  );
}
