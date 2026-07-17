import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, FlatList, ScrollView, StyleSheet } from "react-native";
import Animated, { LinearTransition, SlideOutRight, useReducedMotion } from "react-native-reanimated";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { Button, Divider, IconButton, List, Menu, SegmentedButtons, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../src/store/useAppStore";
import { getOutOfVanItems, getAllOutOfVanItems, OutOfVanItem } from "../src/db/repository";
import { Season } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { seasonIconName, seasonIconColor } from "../src/components/seasonIcon";
import { EditItemDialog } from "../src/components/dialogs/EditItemDialog";

type OutItem = OutOfVanItem;
type SeasonFilter = Season | "all";

export default function OutOfVanScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const locations = useAppStore((s) => s.locations);
  const activeLocationId = useAppStore((s) => s.activeLocationId);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const updateItem = useAppStore((s) => s.updateItem);
  // Frozen at mount: this screen is reached either from a single location's
  // map (scoped to that location) or from the all-locations overview (every
  // location's out items, with a location filter) — whichever it was when
  // opened, not whatever the store's overview flag happens to be later (e.g.
  // after handleLocate switches the active location while this screen is
  // still mounted, on its way to being dismissed).
  const [isGlobalView] = useState(() => useAppStore.getState().overviewMode);
  const [items, setItems] = useState<OutItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("all");
  const [locationMenuVisible, setLocationMenuVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<OutItem | null>(null);

  const load = useCallback(async () => {
    if (isGlobalView) {
      setItems(await getAllOutOfVanItems());
      return;
    }
    if (!activeLocationId) return;
    const data = await getOutOfVanItems(activeLocationId);
    setItems(data);
  }, [isGlobalView, activeLocationId]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Title reflects scope: the single location's name when opened from within
  // it, or the generic label when opened from the all-locations overview.
  useEffect(() => {
    const activeLocationName = locations.find((l) => l.id === activeLocationId)?.name ?? "";
    navigation.setOptions({
      title: isGlobalView
        ? t("nav.out_of_van")
        : t("nav.out_of_van_named", { name: activeLocationName }),
    });
  }, [navigation, isGlobalView, activeLocationId, locations, t]);

  const availableLocations = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    items.forEach((item) => {
      if (!seen.has(item.location_id)) {
        seen.set(item.location_id, { id: item.location_id, name: item.location_name });
      }
    });
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [items]);

  // Zone choices narrow down to whichever location is selected, so picking a
  // location doesn't leave the zone dropdown offering zones from elsewhere.
  const locationFilteredItems = useMemo(
    () => (selectedLocationId ? items.filter((item) => item.location_id === selectedLocationId) : items),
    [items, selectedLocationId]
  );

  const availableZones = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    locationFilteredItems.forEach((item) => {
      if (!seen.has(item.zone_id)) {
        seen.set(item.zone_id, {
          id: item.zone_id,
          name: item.zone_name,
          color: item.zone_color ?? palette.primary,
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [locationFilteredItems, palette.primary]);

  useEffect(() => {
    if (
      selectedLocationId !== null &&
      !availableLocations.some((l) => l.id === selectedLocationId)
    ) {
      setSelectedLocationId(null);
    }
  }, [availableLocations, selectedLocationId]);

  useEffect(() => {
    if (
      selectedZoneId !== null &&
      !availableZones.some((z) => z.id === selectedZoneId)
    ) {
      setSelectedZoneId(null);
    }
  }, [availableZones, selectedZoneId]);

  const visibleItems = locationFilteredItems
    .filter((item) => !selectedZoneId || item.zone_id === selectedZoneId)
    .filter((item) => seasonFilter === "all" || item.season === seasonFilter);

  const selectedLocation = availableLocations.find((l) => l.id === selectedLocationId);
  const selectedZone = availableZones.find((z) => z.id === selectedZoneId);

  const handlePutBack = async (item: OutItem) => {
    await setItemOutOfVan(item.id, false);
    await load();
  };

  const handleLocate = async (item: OutItem) => {
    if (item.location_id !== activeLocationId) {
      await setActiveLocation(item.location_id);
    }
    router.dismissTo(`/zone/${item.zone_id}?highlightItemId=${item.id}`);
  };

  const handleSaveEdit = async (
    name: string,
    notes: string,
    season: Season,
    expirationDate: string | null,
    reminderDays: number
  ) => {
    if (!editingItem) return;
    await updateItem(editingItem.id, name, notes, season, expirationDate, reminderDays);
    setEditingItem(null);
    await load();
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
      {(availableZones.length > 0 || (isGlobalView && availableLocations.length > 0)) && (
        <View style={[styles.filterRow, styles.filterRowInline]}>
          {isGlobalView && availableLocations.length > 0 && (
            <Menu
              visible={locationMenuVisible}
              onDismiss={() => setLocationMenuVisible(false)}
              anchor={
                <Button
                  mode="outlined"
                  icon="chevron-down"
                  contentStyle={styles.filterButtonContent}
                  style={[styles.filterButton, { backgroundColor: palette.surfaceVariant }]}
                  onPress={() => setLocationMenuVisible(true)}
                >
                  {selectedLocation ? selectedLocation.name : t("out.all_locations")}
                </Button>
              }
            >
              <ScrollView style={styles.menuScroll}>
                <Menu.Item
                  title={t("out.all_locations")}
                  trailingIcon={selectedLocationId === null ? "check" : undefined}
                  onPress={() => {
                    setSelectedLocationId(null);
                    setLocationMenuVisible(false);
                  }}
                />
                <Divider />
                {availableLocations.map((location) => (
                  <Menu.Item
                    key={location.id}
                    title={location.name}
                    trailingIcon={selectedLocationId === location.id ? "check" : undefined}
                    onPress={() => {
                      setSelectedLocationId(location.id);
                      setLocationMenuVisible(false);
                    }}
                  />
                ))}
              </ScrollView>
            </Menu>
          )}
          {availableZones.length > 0 && (
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
              <ScrollView style={styles.menuScroll}>
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
              </ScrollView>
            </Menu>
          )}
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
          <Animated.View
            exiting={reducedMotion ? undefined : SlideOutRight.duration(280)}
            layout={reducedMotion ? undefined : LinearTransition.duration(220)}
          >
          <List.Item
            title={item.name}
            description={`📍 ${isGlobalView ? `${item.location_name} • ` : ""}${item.zone_name}${item.notes ? ` • ${item.notes}` : ""}`}
            onPress={() => handleLocate(item)}
            onLongPress={() => setEditingItem(item)}
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
                icon={item.location_icon}
                size={24}
                onPress={() => handlePutBack(item)}
              />
            )}
          />
          </Animated.View>
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
      <EditItemDialog
        item={editingItem}
        onCancel={() => setEditingItem(null)}
        onSave={handleSaveEdit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16 },
  emptyContainer: { padding: 32, alignItems: "center" },
  filterRow: { paddingHorizontal: 16, paddingTop: 12, alignItems: "flex-start" },
  filterRowInline: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterButton: { borderRadius: 8 },
  filterButtonContent: { flexDirection: "row-reverse" },
  itemIcons: { flexDirection: "row" },
  // Caps the filter dropdown height so a long list (e.g. every location's zones
  // in the all-locations view) scrolls instead of running off-screen.
  menuScroll: { maxHeight: 320 },
});
