import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Divider, IconButton, List, Menu, SegmentedButtons, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../src/store/useAppStore";
import { getOutOfVanItems } from "../src/db/repository";
import { Item, Season } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { seasonIconName, seasonIconColor } from "../src/components/seasonIcon";

type OutItem = Item & { zone_name: string };
type SeasonFilter = Season | "all";

export default function OutOfVanScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const zones = useAppStore((s) => s.zones);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);
  const [items, setItems] = useState<OutItem[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("all");
  const [menuVisible, setMenuVisible] = useState(false);

  const load = useCallback(async () => {
    const data = await getOutOfVanItems();
    setItems(data);
  }, [getOutOfVanItems]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const zoneColorById = useMemo(() => {
    const map = new Map<string, string>();
    zones.forEach((z) => map.set(z.id, z.color));
    return map;
  }, [zones]);

  const availableZones = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    items.forEach((item) => {
      if (!seen.has(item.zone_id)) {
        seen.set(item.zone_id, {
          id: item.zone_id,
          name: item.zone_name,
          color: zoneColorById.get(item.zone_id) ?? palette.primary,
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [items, zoneColorById, palette.primary]);

  useEffect(() => {
    if (
      selectedZoneId !== null &&
      !availableZones.some((z) => z.id === selectedZoneId)
    ) {
      setSelectedZoneId(null);
    }
  }, [availableZones, selectedZoneId]);

  const visibleItems = items
    .filter((item) => !selectedZoneId || item.zone_id === selectedZoneId)
    .filter((item) => seasonFilter === "all" || item.season === seasonFilter);

  const selectedZone = availableZones.find((z) => z.id === selectedZoneId);

  const handlePutBack = async (item: OutItem) => {
    await setItemOutOfVan(item.id, false);
    await load();
  };

  const handleLocate = (item: OutItem) => {
    setHighlightedZoneId(item.zone_id);
    router.dismissTo("/");
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      <View style={[styles.header, { backgroundColor: palette.warningSurface }]}>
        <Text variant="bodyMedium" style={{ color: palette.warningOn }}>
          {t(
            items.length === 1
              ? "out.currently_out_one"
              : "out.currently_out_other",
            { count: items.length }
          )}
        </Text>
      </View>
      {availableZones.length > 0 && (
        <View style={styles.filterRow}>
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                icon="chevron-down"
                contentStyle={styles.filterButtonContent}
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: selectedZone
                      ? selectedZone.color + "33"
                      : palette.surfaceVariant,
                  },
                ]}
                onPress={() => setMenuVisible(true)}
              >
                {selectedZone ? selectedZone.name : t("out.all_zones")}
              </Button>
            }
          >
            <Menu.Item
              title={t("out.all_zones")}
              trailingIcon={selectedZoneId === null ? "check" : undefined}
              onPress={() => {
                setSelectedZoneId(null);
                setMenuVisible(false);
              }}
            />
            <Divider />
            {availableZones.map((zone) => (
              <Menu.Item
                key={zone.id}
                title={zone.name}
                style={{ backgroundColor: zone.color + "33" }}
                trailingIcon={selectedZoneId === zone.id ? "check" : undefined}
                onPress={() => {
                  setSelectedZoneId(zone.id);
                  setMenuVisible(false);
                }}
              />
            ))}
          </Menu>
        </View>
      )}
      <View style={styles.filterRow}>
        <SegmentedButtons
          value={seasonFilter}
          onValueChange={(v) => setSeasonFilter(v as SeasonFilter)}
          buttons={[
            { value: "all", label: t("out.filter_all") },
            { value: "summer", icon: "weather-sunny", accessibilityLabel: t("out.filter_summer") },
            { value: "winter", icon: "snowflake", accessibilityLabel: t("out.filter_winter") },
            { value: "none", label: t("out.filter_none") },
          ]}
        />
      </View>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        renderItem={({ item }) => {
          const seasonIcon = seasonIconName(item.season);
          return (
          <List.Item
            title={item.name}
            description={`📍 ${item.zone_name}${item.notes ? ` • ${item.notes}` : ""}`}
            onPress={() => handleLocate(item)}
            left={(props) => (
              <View style={styles.itemIcons}>
                <List.Icon {...props} icon="exit-to-app" color={palette.danger} />
                {seasonIcon && (
                  <List.Icon {...props} icon={seasonIcon} color={seasonIconColor(item.season)} />
                )}
              </View>
            )}
            right={() => (
              <IconButton
                icon="tray-arrow-down"
                size={24}
                onPress={() => handlePutBack(item)}
              />
            )}
          />
          );
        }}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant, textAlign: "center" }}>
              {t("out.empty")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16 },
  emptyContainer: { padding: 32, alignItems: "center" },
  filterRow: { paddingHorizontal: 16, paddingTop: 12, alignItems: "flex-start" },
  filterButton: { borderRadius: 8 },
  filterButtonContent: { flexDirection: "row-reverse" },
  itemIcons: { flexDirection: "row" },
});
