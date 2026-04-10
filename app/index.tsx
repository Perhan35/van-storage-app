import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FAB, IconButton } from "react-native-paper";
import { VanLayoutSVG } from "../src/components/VanLayoutSVG";
import { ZoomableContainer } from "../src/components/ZoomableContainer";
import { useAppStore } from "../src/store/useAppStore";

export default function VanMapScreen() {
  const router = useRouter();
  const initialized = useAppStore((s) => s.initialized);

  if (!initialized) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <IconButton
          icon="magnify"
          size={28}
          onPress={() => router.push("/search")}
        />
        <IconButton
          icon="cog"
          size={28}
          onPress={() => router.push("/settings")}
        />
      </View>
      <ZoomableContainer>
        <VanLayoutSVG
          onZonePress={(zoneId) => router.push(`/zone/${zoneId}`)}
        />
      </ZoomableContainer>
      <FAB
        icon="plus"
        style={styles.fab}
        label="Ajouter"
        onPress={() => {
          // Navigate to first zone for quick add
          router.push("/search");
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    backgroundColor: "#4A90D9",
  },
});
