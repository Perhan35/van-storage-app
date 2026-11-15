import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Dialog, Portal, Button, RadioButton, Switch, Text, Divider } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { WantedItem } from "../../db/database";
import { useAppStore } from "../../store/useAppStore";
import { useAppTheme } from "../../theme/useAppTheme";

type Props = {
  item: WantedItem | null;
  // Set when the kit is scoped to one location: only its zones are offered.
  locationId?: string | null;
  onCancel: () => void;
  onConfirm: (item: WantedItem, zoneId: string, outOfVan: boolean) => void;
};

// "Je l'ai": a real item always needs a zone, so picking one is required.
// Whether it is already in the van is a separate switch — a thing just bought
// often sits at home until the next trip, but it still has a spot waiting.
export function FulfillWantedDialog({ item, locationId, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const allLocations = useAppStore((s) => s.locations);
  const locations = locationId
    ? allLocations.filter((l) => l.id === locationId)
    : allLocations;
  const zonesByLocation = useAppStore((s) => s.zonesByLocation);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [atHome, setAtHome] = useState(false);

  useEffect(() => {
    if (!item) return;
    setZoneId(null);
    setAtHome(false);
  }, [item]);

  const showLocationNames = locations.length > 1;

  return (
    <Portal>
      <Dialog visible={!!item} onDismiss={onCancel}>
        <Dialog.Title>{t("kit.fulfill_title", { name: item?.name ?? "" })}</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
            {item ? t("kit.fulfill_season", { season: t(`season.${item.season}`) }) : ""}
          </Text>
        </Dialog.Content>
        <Dialog.ScrollArea style={{ maxHeight: Math.min(360, windowHeight * 0.45) }}>
          <ScrollView>
            <RadioButton.Group value={zoneId ?? ""} onValueChange={setZoneId}>
              {locations.map((location) => {
                const zones = zonesByLocation[location.id] ?? [];
                if (zones.length === 0) return null;
                return (
                  <View key={location.id}>
                    {showLocationNames && (
                      <Text
                        variant="labelLarge"
                        style={[styles.locationName, { color: palette.onSurfaceVariant }]}
                      >
                        {location.name}
                      </Text>
                    )}
                    {zones.map((zone) => (
                      <RadioButton.Item
                        key={zone.id}
                        label={zone.name}
                        value={zone.id}
                        position="leading"
                        labelStyle={styles.radioLabel}
                        style={styles.radio}
                      />
                    ))}
                  </View>
                );
              })}
            </RadioButton.Group>
          </ScrollView>
        </Dialog.ScrollArea>
        <Pressable
          onPress={() => setAtHome((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: atHome }}
          style={styles.switchRow}
        >
          <View style={styles.switchText}>
            <Text variant="bodyLarge">{t("kit.fulfill_at_home")}</Text>
            <Text variant="bodySmall" style={{ color: palette.onSurfaceVariant }}>
              {t("kit.fulfill_at_home_desc")}
            </Text>
          </View>
          <Switch value={atHome} onValueChange={setAtHome} />
        </Pressable>
        <Divider />
        <Dialog.Actions>
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button
            mode="contained"
            disabled={!zoneId}
            onPress={() => item && zoneId && onConfirm(item, zoneId, atHome)}
          >
            {t("kit.fulfill_confirm")}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 8 },
  locationName: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4 },
  radio: { paddingVertical: 4 },
  radioLabel: { textAlign: "left" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  switchText: { flex: 1, gap: 2 },
});
