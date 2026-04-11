import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { PaperProvider, MD3LightTheme, IconButton, Text } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";

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
  const editMode = useAppStore((s) => s.editMode);
  const toggleEditMode = useAppStore((s) => s.toggleEditMode);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <IconButton
        icon="exit-to-app"
        size={24}
        iconColor="#fff"
        onPress={() => router.push("/out-of-van")}
      />
      <IconButton
        icon="magnify"
        size={24}
        iconColor="#fff"
        onPress={() => router.push("/search")}
      />
      {editMode && (
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
          Édition
        </Text>
      )}
      <IconButton
        icon={editMode ? "check" : "cursor-move"}
        size={24}
        iconColor={editMode ? "#FFD54F" : "#fff"}
        onPress={toggleEditMode}
      />
      <IconButton
        icon="cog"
        size={24}
        iconColor="#fff"
        onPress={() => router.push("/settings")}
      />
    </View>
  );
}

export default function RootLayout() {
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
            title: "My Van Inventory",
            headerRight: () => <HeaderRight />,
          }}
        />
        <Stack.Screen
          name="zone/[id]"
          options={{ title: "Zone" }}
        />
        <Stack.Screen
          name="search"
          options={{ title: "Rechercher un objet" }}
        />
        <Stack.Screen
          name="out-of-van"
          options={{ title: "Sortis du van" }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: "Paramètres" }}
        />
      </Stack>
    </PaperProvider>
  );
}
