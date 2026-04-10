import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { PaperProvider, MD3LightTheme } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#4A90D9",
    secondary: "#FF8A65",
  },
};

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
          options={{ title: "Mon Van - Inventaire" }}
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
          name="settings"
          options={{ title: "Paramètres" }}
        />
      </Stack>
    </PaperProvider>
  );
}
