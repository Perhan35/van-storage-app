import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView, Alert, GestureResponderEvent } from "react-native";
import Svg, { Rect as SvgRect } from "react-native-svg";
import { Text, IconButton, Icon } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { LocationOutline } from "./LocationOutline";
import { RenameLocationDialog } from "./dialogs/RenameLocationDialog";
import { ContextMenu } from "./ContextMenu";
import { useAppTheme } from "../theme/useAppTheme";
import { Rect } from "./locationTransition";
import * as repo from "../db/repository";
import { ZoneWithCount, Location } from "../db/database";

type Props = {
  // `planRect` is the on-screen box of the tile's miniature plan, in window
  // coordinates — the map screen grows out of it. Null when it couldn't be
  // measured, which the caller treats as "open without the transition".
  onSelectLocation: (locationId: string, planRect: Rect | null) => void;
  onCreateNew: () => void;
};

export function LocationsOverview({ onSelectLocation, onCreateNew }: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const locations = useAppStore((s) => s.locations);
  const renameLocation = useAppStore((s) => s.renameLocation);
  const deleteLocation = useAppStore((s) => s.deleteLocation);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const enterOutlineEditMode = useAppStore((s) => s.enterOutlineEditMode);
  const [zonesByLocation, setZonesByLocation] = useState<Record<string, ZoneWithCount[]>>({});
  // Long-press context menu, anchored at the touch point (#7).
  const [menu, setMenu] = useState<{ location: Location; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<Location | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        locations.map(
          async (loc) => [loc.id, await repo.listZonesWithCounts(loc.id)] as const
        )
      );
      if (!cancelled) setZonesByLocation(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [locations]);

  // The plan box inside each tile, measured on tap so the map screen knows
  // where to grow from.
  const planRefs = useRef<Record<string, View | null>>({});

  const handleTilePress = (locationId: string) => {
    const node = planRefs.current[locationId];
    if (!node) {
      onSelectLocation(locationId, null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onSelectLocation(locationId, width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  };

  const openMenu = (location: Location, e: GestureResponderEvent) => {
    // pageX/pageY can be absent on some platforms; fall back to the top-left.
    const { pageX, pageY } = e.nativeEvent;
    setMenu({
      location,
      x: typeof pageX === "number" ? pageX : 40,
      y: typeof pageY === "number" ? pageY : 120,
    });
  };

  const handleRename = (locationId: string, name: string, icon: string) => {
    renameLocation(locationId, name, icon);
    setRenaming(null);
  };

  // Open the location and drop straight into reshaping its outline. Activating
  // it first (awaited) makes it the active location and loads its zones, so the
  // outline-edit session snapshots the right location's outline and zones.
  const handleEditOutline = async (location: Location) => {
    setMenu(null);
    await setActiveLocation(location.id);
    enterOutlineEditMode();
  };

  const confirmDelete = (location: Location) => {
    setMenu(null);
    Alert.alert(
      t("location.delete_confirm_title"),
      t("location.delete_confirm_text", { name: location.name }),
      [
        { text: t("map.cancel"), style: "cancel" },
        {
          text: t("location.delete"),
          style: "destructive",
          onPress: () => deleteLocation(location.id),
        },
      ]
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.grid}
      style={{ backgroundColor: palette.background }}
    >
      {locations.map((loc) => (
        <Pressable
          key={loc.id}
          onPress={() => handleTilePress(loc.id)}
          onLongPress={(e) => openMenu(loc, e)}
          style={[styles.tile, { backgroundColor: palette.surface, borderColor: palette.divider }]}
        >
          <View
            ref={(node) => {
              planRefs.current[loc.id] = node;
            }}
            collapsable={false}
            style={styles.tilePlan}
          >
            <Svg
              viewBox={`0 0 ${loc.outline.w} ${loc.outline.h}`}
              style={styles.tileSvg}
            >
              <LocationOutline outline={loc.outline} />
              {(zonesByLocation[loc.id] ?? []).map((zone) => (
                <SvgRect
                  key={zone.id}
                  x={zone.geometry.x}
                  y={zone.geometry.y}
                  width={zone.geometry.w}
                  height={zone.geometry.h}
                  rx={6}
                  ry={6}
                  fill={zone.color || "#78909C"}
                  opacity={zone.fill_opacity ?? 0.4}
                />
              ))}
            </Svg>
          </View>
          <View style={styles.tileLabelRow}>
            <Icon source={loc.icon} size={16} color={palette.onSurfaceVariant} />
            <Text
              variant="bodyMedium"
              numberOfLines={1}
              style={[styles.tileLabel, { color: palette.onSurface }]}
            >
              {loc.name}
            </Text>
          </View>
        </Pressable>
      ))}
      <Pressable
        onPress={onCreateNew}
        style={[
          styles.tile,
          styles.newTile,
          { backgroundColor: palette.surfaceVariant, borderColor: palette.divider },
        ]}
      >
        <IconButton icon="plus" size={32} iconColor={palette.primary} />
        <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
          {t("location.new")}
        </Text>
      </Pressable>

      <ContextMenu
        visible={!!menu}
        onDismiss={() => setMenu(null)}
        anchor={menu ? { x: menu.x, y: menu.y } : { x: 0, y: 0 }}
        header={
          menu
            ? {
                title: menu.location.name,
                icon: menu.location.icon,
                subtitle: t("location.kind_label"),
              }
            : undefined
        }
        items={
          menu
            ? [
                {
                  icon: "pencil",
                  label: t("location.edit"),
                  onPress: () => setRenaming(menu.location),
                },
                {
                  icon: "vector-polygon",
                  label: t("location.edit_outline"),
                  onPress: () => handleEditOutline(menu.location),
                },
                {
                  icon: "delete",
                  label: t("location.delete"),
                  tone: "danger",
                  dividerBefore: true,
                  // Never delete the last remaining location.
                  disabled: locations.length <= 1,
                  onPress: () => confirmDelete(menu.location),
                },
              ]
            : []
        }
      />

      <RenameLocationDialog
        location={renaming}
        onCancel={() => setRenaming(null)}
        onSave={handleRename}
      />
    </ScrollView>
  );
}

const TILE_SIZE = 168;

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    padding: 16,
    gap: 16,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tilePlan: {
    width: "100%",
    flex: 1,
  },
  tileSvg: {
    flex: 1,
  },
  tileLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    maxWidth: "100%",
  },
  tileLabel: {
    fontWeight: "600",
    flexShrink: 1,
  },
  newTile: {
    alignItems: "center",
    justifyContent: "center",
  },
});
