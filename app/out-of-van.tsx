import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { Button, Divider, SegmentedButtons, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../src/store/useAppStore";
import { getOutOfVanItems, getAllOutOfVanItems, OutOfVanItem } from "../src/db/repository";
import { Season } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { OutOfVanRow } from "../src/components/OutOfVanRow";
import { EditItemDialog } from "../src/components/dialogs/EditItemDialog";
import { ContextMenu } from "../src/components/ContextMenu";

type OutItem = OutOfVanItem;
type SeasonFilter = Season | "all";

export default function OutOfVanScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
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
  type DropdownAnchor = { x: number; y: number; width: number; height: number };
  const [locationMenuAnchor, setLocationMenuAnchor] = useState<DropdownAnchor | null>(null);
  const [zoneMenuAnchor, setZoneMenuAnchor] = useState<DropdownAnchor | null>(null);
  const locationButtonRef = useRef<View>(null);
  const zoneButtonRef = useRef<View>(null);
  const swipeableRefs = useRef<Map<string, SwipeableMethods>>(new Map());

  // Measures the trigger button so the dropdown can open flush beneath it,
  // matching its width (react-native-web's measureInWindow needs a plain View
  // ref — Paper's Button ref isn't guaranteed to support it).
  const openDropdown = (
    ref: React.RefObject<View | null>,
    setAnchor: (a: DropdownAnchor) => void
  ) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };
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
  // it, or the generic label when opened from the all-locations overview. The
  // count of what's out rides beneath it as a subtitle, the same title/subtitle
  // pairing the map screen uses.
  useEffect(() => {
    const activeLocationName = locations.find((l) => l.id === activeLocationId)?.name ?? "";
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text
            style={{ color: palette.headerTint, fontWeight: "bold", fontSize: 18 }}
            numberOfLines={1}
          >
            {isGlobalView
              ? t("nav.out_of_van")
              : t("nav.out_of_van_named", { name: activeLocationName })}
          </Text>
          <Text
            style={{ color: palette.headerTint, opacity: 0.8, fontSize: 12 }}
            numberOfLines={1}
          >
            {t("nav.item_count", { count: items.length })}
          </Text>
        </View>
      ),
    });
  }, [navigation, isGlobalView, activeLocationId, locations, items.length, palette.headerTint, t]);

  const availableLocations = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; icon: string }>();
    items.forEach((item) => {
      if (!seen.has(item.location_id)) {
        seen.set(item.location_id, {
          id: item.location_id,
          name: item.location_name,
          icon: item.location_icon,
        });
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
    const seen = new Map<
      string,
      { id: string; name: string; color: string; locationIcon: string }
    >();
    locationFilteredItems.forEach((item) => {
      if (!seen.has(item.zone_id)) {
        seen.set(item.zone_id, {
          id: item.zone_id,
          name: item.zone_name,
          color: item.zone_color ?? palette.primary,
          locationIcon: item.location_icon,
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

  // useCallback'd: passed as props to OutOfVanRow, which is React.memo'd so
  // putting one item back doesn't re-render every other row's swipeable +
  // exit/layout animation wrappers.
  const handlePutBack = useCallback(
    async (item: OutItem) => {
      swipeableRefs.current.get(item.id)?.close();
      await setItemOutOfVan(item.id, false);
      await load();
    },
    [setItemOutOfVan, load]
  );

  const handleLocate = useCallback(
    async (item: OutItem) => {
      if (item.location_id !== activeLocationId) {
        await setActiveLocation(item.location_id);
      }
      router.dismissTo(`/zone/${item.zone_id}?highlightItemId=${item.id}`);
    },
    [activeLocationId, setActiveLocation, router]
  );

  const handleLongPressItem = useCallback((item: OutItem) => {
    setEditingItem(item);
  }, []);

  const handleSwipeableRef = useCallback((itemId: string, ref: SwipeableMethods | null) => {
    if (ref) swipeableRefs.current.set(itemId, ref);
    else swipeableRefs.current.delete(itemId);
  }, []);

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
      {(availableZones.length > 0 || (isGlobalView && availableLocations.length > 0)) && (
        <View style={[styles.filterRow, styles.filterRowInline]}>
          {isGlobalView && availableLocations.length > 0 && (
            <View ref={locationButtonRef} collapsable={false}>
              <Button
                mode="outlined"
                icon="chevron-down"
                contentStyle={styles.filterButtonContent}
                style={[styles.filterButton, { backgroundColor: palette.surfaceVariant }]}
                onPress={() => openDropdown(locationButtonRef, setLocationMenuAnchor)}
              >
                {selectedLocation ? selectedLocation.name : t("out.all_locations")}
              </Button>
            </View>
          )}
          {availableZones.length > 0 && (
            <View ref={zoneButtonRef} collapsable={false}>
              <Button
                mode="outlined"
                icon="chevron-down"
                contentStyle={styles.filterButtonContent}
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: selectedZone ? selectedZone.color + "33" : palette.surfaceVariant,
                  },
                ]}
                onPress={() => openDropdown(zoneButtonRef, setZoneMenuAnchor)}
              >
                {selectedZone ? selectedZone.name : t("out.all_zones")}
              </Button>
            </View>
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
        renderItem={({ item }) => (
          <OutOfVanRow
            item={item}
            isGlobalView={isGlobalView}
            onPutBack={handlePutBack}
            onLocate={handleLocate}
            onLongPressItem={handleLongPressItem}
            onSwipeableRef={handleSwipeableRef}
          />
        )}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={10}
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

      <ContextMenu
        visible={!!locationMenuAnchor}
        onDismiss={() => setLocationMenuAnchor(null)}
        anchor={locationMenuAnchor ?? { x: 0, y: 0 }}
        dropdown
        items={[
          {
            icon: "map-marker",
            label: t("out.all_locations"),
            selected: selectedLocationId === null,
            onPress: () => setSelectedLocationId(null),
          },
          ...availableLocations.map((location) => ({
            icon: location.icon,
            label: location.name,
            selected: selectedLocationId === location.id,
            onPress: () => setSelectedLocationId(location.id),
          })),
        ]}
      />

      <ContextMenu
        visible={!!zoneMenuAnchor}
        onDismiss={() => setZoneMenuAnchor(null)}
        anchor={zoneMenuAnchor ?? { x: 0, y: 0 }}
        dropdown
        items={[
          {
            icon: "shape-outline",
            label: t("out.all_zones"),
            selected: selectedZoneId === null,
            onPress: () => setSelectedZoneId(null),
          },
          ...availableZones.map((zone) => ({
            icon: zone.locationIcon,
            label: zone.name,
            color: zone.color,
            selected: selectedZoneId === zone.id,
            onPress: () => setSelectedZoneId(zone.id),
          })),
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Subtitle sits centred under the title rather than flush left with it.
  headerTitle: { alignItems: "center" },
  emptyContainer: { padding: 32, alignItems: "center" },
  filterRow: { paddingHorizontal: 16, paddingTop: 12, alignItems: "flex-start" },
  filterRowInline: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterButton: { borderRadius: 8 },
  filterButtonContent: { flexDirection: "row-reverse" },
});
