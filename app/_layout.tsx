import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PaperProvider, MD3LightTheme, IconButton, Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../src/store/useAppStore";
import "../src/i18n";

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#4A90D9",
    secondary: "#FF8A65",
  },
};

function HeaderRight() {
  const router = useRouter();
  const { t } = useTranslation();
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <IconButton
        icon="exit-to-app"
        size={24}
        iconColor="#fff"
        style={{ margin: 0 }}
        onPress={() => router.push("/out-of-van")}
      />
      <IconButton
        icon="magnify"
        size={24}
        iconColor="#fff"
        style={{ margin: 0 }}
        onPress={() => router.push("/search")}
      />
      {editMode && (
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12, marginHorizontal: 4 }}>
          {t("nav.edit_mode")}
        </Text>
      )}
      <IconButton
        icon={editMode ? "check" : "cursor-move"}
        size={24}
        iconColor={editMode ? "#FFD54F" : "#fff"}
        style={{ margin: 0 }}
        onPress={toggleEditMode}
      />
      <IconButton
        icon="cog"
        size={24}
        iconColor="#fff"
        style={{ margin: 0 }}
        onPress={() => router.push("/settings")}
      />
    </View>
  );
}

export default function RootLayout() {
  const { t } = useTranslation();
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    init();
  }, []);

  return (
    <PaperProvider theme={theme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#4A90D9" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
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
