import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, FlatList, StyleSheet, Alert, ScrollView, Animated } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import {
  Text,
  TextInput,
  IconButton,
  List,
  Divider,
  Button,
  Dialog,
  Portal,
  Menu,
  Checkbox,
} from "react-native-paper";
import { useAppStore } from "../../src/store/useAppStore";
import { listItemsForZone } from "../../src/db/repository";
import { Item } from "../../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../src/theme/useAppTheme";
import { EditItemDialog } from "../../src/components/dialogs/EditItemDialog";
import { EditZoneDialog } from "../../src/components/dialogs/EditZoneDialog";
import { useTextSelectionFix } from "../../src/hooks/useTextSelectionFix";
import { Season } from "../../src/db/database";
import { seasonIconName, seasonIconColor } from "../../src/components/seasonIcon";

export default function ZoneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const zones = useAppStore((s) => s.zones);
  const addItem = useAppStore((s) => s.addItem);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const updateItem = useAppStore((s) => s.updateItem);
  const moveItem = useAppStore((s) => s.moveItem);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setItemChecked = useAppStore((s) => s.setItemChecked);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const splitZone = useAppStore((s) => s.splitZone);

  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<Item | null>(null);
  const [zoneEditVisible, setZoneEditVisible] = useState(false);
  const [adding, setAdding] = useState(false);
  const newItemNameSelection = useTextSelectionFix();
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const zone = zones.find((z) => z.id === id);

  const loadItems = useCallback(async () => {
    if (id) {
      const data = await listItemsForZone(id);
      setItems(data);
    }
  }, [id]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!zone) return;
    navigation.setOptions({
      title: zone.name,
      headerRight: zone.checklist
        ? () => {
            const hasChecked = items.some((i) => i.checked);
            if (!hasChecked) return null;
            return (
              <IconButton
                icon="checkbox-multiple-blank-outline"
                iconColor={palette.headerTint}
                accessibilityLabel={t("zone.reset_checklist")}
                onPress={handleResetChecklist}
              />
            );
          }
        : undefined,
    });
  }, [zone, items, navigation, palette]);

  const handleAddItem = async () => {
    const trimmed = newItemName.trim();
    if (!trimmed || !id || adding) return;
    setAdding(true);
    try {
      await addItem(trimmed, id);
      setNewItemName("");
      newItemNameSelection.resetSelection();
      await loadItems();
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteItem = (item: Item) => {
    setMenuVisible(null);
    Alert.alert(t("zone.delete"), t("zone.delete_alert", { name: item.name }), [
      { text: t("map.cancel"), style: "cancel" },
      {
        text: t("zone.delete"),
        style: "destructive",
        onPress: async () => {
          await deleteItem(item.id);
          await loadItems();
        },
      },
    ]);
  };

  const handleSaveEdit = async (name: string, notes: string, season: Season) => {
    if (!editingItem) return;
    await updateItem(editingItem.id, name, notes, season);
    setEditingItem(null);
    await loadItems();
  };

  const handleMoveItem = async (itemId: string, newZoneId: string) => {
    await moveItem(itemId, newZoneId);
    setMovingItem(null);
    await loadItems();
  };

  const handleToggleOutOfVan = async (item: Item) => {
    setMenuVisible(null);
    swipeableRefs.current.get(item.id)?.close();
    await setItemOutOfVan(item.id, !item.out_of_van);
    await loadItems();
  };

  const handleToggleChecked = async (item: Item) => {
    swipeableRefs.current.get(item.id)?.close();
    await setItemChecked(item.id, !item.checked);
    await loadItems();
  };

  const handleResetChecklist = () => {
    if (!id) return;
    Alert.alert(t("zone.reset_checklist"), t("zone.reset_checklist_confirm"), [
      { text: t("map.cancel"), style: "cancel" },
      {
        text: t("zone.reset_checklist"),
        onPress: async () => {
          await resetChecklist(id);
          await loadItems();
        },
      },
    ]);
  };

  const handleSaveZone = async (
    name: string,
    color: string,
    fillOpacity: number,
    checklist: boolean
  ) => {
    if (!id) return;
    await updateZone(id, name, color, fillOpacity, checklist);
    setZoneEditVisible(false);
  };

  const handleDeleteZone = () => {
    Alert.alert(
      t("zone.delete_zone_alert_title"),
      t("zone.delete_zone_alert_text"),
      [
        { text: t("map.cancel"), style: "cancel" },
        {
          text: t("zone.delete"),
          style: "destructive",
          onPress: async () => {
            if (id) {
              setZoneEditVisible(false);
              await deleteZone(id);
              router.back();
            }
          },
        },
      ]
    );
  };

  const handleSplitZone = () => {
    if (!zone) return;
    const { w, h } = zone.geometry;
    const direction = w >= h ? t("zone.split_left_right") : t("zone.split_top_bottom");
    Alert.alert(
      t("zone.split_zone_alert_title"),
      t("zone.split_zone_alert_text", { name: zone.name, direction }),
      [
        { text: t("map.cancel"), style: "cancel" },
        {
          text: "Split",
          onPress: async () => {
            if (id) {
              const newZoneId = await splitZone(id);
              if (newZoneId) {
                router.replace(`/zone/${newZoneId}`);
              }
            }
          },
        },
      ]
    );
  };

  if (!zone) {
    return (
      <View style={[styles.center, { backgroundColor: palette.surface }]}>
        <Text>{t("zone.not_found")}</Text>
      </View>
    );
  }

  const otherZones = zones
    .filter((z) => z.id !== id)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      {/* Zone header */}
      <View style={[styles.header, { backgroundColor: zone.color + "33" }]}>
        <View style={styles.headerRow}>
          <View style={[styles.colorDot, { backgroundColor: zone.color }]} />
          <Text variant="titleMedium" style={[styles.headerTitle, { color: palette.onSurface }]}>
            {zone.name}
          </Text>
          <IconButton
            icon="call-split"
            size={20}
            onPress={handleSplitZone}
          />
          <IconButton
            icon="pencil"
            size={20}
            onPress={() => setZoneEditVisible(true)}
          />
        </View>
        <Text variant="bodySmall" style={[styles.itemCount, { color: palette.onSurfaceVariant }]}>
          {t(
            items.length === 1
              ? "map.objects_count_one"
              : "map.objects_count_other",
            { count: items.length }
          )}
        </Text>
      </View>

      {/* Add item */}
      <View style={styles.addRow}>
        <TextInput
          mode="outlined"
          placeholder={t("zone.add_item")}
          value={newItemName}
          onChangeText={setNewItemName}
          selection={newItemNameSelection.selection}
          onSelectionChange={newItemNameSelection.onSelectionChange}
          onSubmitEditing={handleAddItem}
          style={styles.addInput}
          dense
        />
        <IconButton
          icon="plus-circle"
          size={32}
          iconColor={palette.primary}
          onPress={handleAddItem}
          disabled={adding}
        />
      </View>

      {/* Items list */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Swipeable
            ref={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref);
              else swipeableRefs.current.delete(item.id);
            }}
            overshootRight={false}
            onSwipeableOpen={(direction) => {
              if (direction === "right") handleToggleOutOfVan(item);
              else if (direction === "left" && zone.checklist)
                handleToggleChecked(item);
            }}
            renderLeftActions={
              zone.checklist
                ? (_progress, drag) => (
                    <Animated.View
                      style={[
                        styles.swipeAction,
                        {
                          backgroundColor: palette.primary,
                          transform: [
                            {
                              translateX: drag.interpolate({
                                inputRange: [0, 100],
                                outputRange: [-100, 0],
                                extrapolate: "clamp",
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <IconButton
                        icon={item.checked ? "checkbox-blank-outline" : "check-bold"}
                        iconColor="#fff"
                        size={26}
                        onPress={() => handleToggleChecked(item)}
                      />
                    </Animated.View>
                  )
                : undefined
            }
            renderRightActions={(_progress, drag) => (
              <Animated.View
                style={[
                  styles.swipeAction,
                  {
                    backgroundColor: palette.danger,
                    transform: [
                      {
                        translateX: drag.interpolate({
                          inputRange: [-100, 0],
                          outputRange: [0, 100],
                          extrapolate: "clamp",
                        }),
                      },
                    ],
                  },
                ]}
              >
                <IconButton
                  icon={item.out_of_van ? "tray-arrow-down" : "exit-to-app"}
                  iconColor="#fff"
                  size={26}
                  onPress={() => handleToggleOutOfVan(item)}
                />
              </Animated.View>
            )}
          >
          <List.Item
            title={item.name}
            description={item.notes || undefined}
            onPress={() => setEditingItem(item)}
            style={item.checked ? styles.checkedRow : undefined}
            titleStyle={
              item.checked
                ? { color: palette.onSurfaceVariant, textDecorationLine: "line-through" }
                : undefined
            }
            left={(props) => {
              const seasonIcon = seasonIconName(item.season);
              const hasIcons = !!item.out_of_van || !!seasonIcon;
              if (!zone.checklist && !hasIcons) return null;
              return (
                <View style={[styles.itemLeft, props.style]}>
                  {zone.checklist && (
                    <Checkbox.Android
                      status={item.checked ? "checked" : "unchecked"}
                      onPress={() => handleToggleChecked(item)}
                    />
                  )}
                  {!!item.out_of_van && (
                    <List.Icon icon="exit-to-app" color={palette.danger} />
                  )}
                  {!!seasonIcon && (
                    <List.Icon icon={seasonIcon} color={seasonIconColor(item.season)} />
                  )}
                </View>
              );
            }}
            right={() => (
              <Menu
                visible={menuVisible === item.id}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={24}
                    onPress={() => setMenuVisible(item.id)}
                  />
                }
              >
                <Menu.Item
                  leadingIcon="pencil-outline"
                  title={t("zone.edit")}
                  onPress={() => {
                    setMenuVisible(null);
                    setEditingItem(item);
                  }}
                />
                {otherZones.length > 0 && (
                  <Menu.Item
                    leadingIcon="arrow-right-bold"
                    title={t("zone.move")}
                    onPress={() => {
                      setMenuVisible(null);
                      setMovingItem(item);
                    }}
                  />
                )}
                <Menu.Item
                  leadingIcon={
                    item.out_of_van ? "tray-arrow-down" : "exit-to-app"
                  }
                  title={
                    item.out_of_van
                      ? t("zone.put_back")
                      : t("zone.take_out")
                  }
                  onPress={() => handleToggleOutOfVan(item)}
                />
                <Divider />
                <Menu.Item
                  leadingIcon="delete-outline"
                  title={t("zone.delete")}
                  titleStyle={{ color: palette.danger }}
                  onPress={() => handleDeleteItem(item)}
                />
              </Menu>
            )}
          />
          </Swipeable>
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
              {t("zone.empty")}
            </Text>
          </View>
        }
      />

      <EditItemDialog
        item={editingItem}
        onCancel={() => setEditingItem(null)}
        onSave={handleSaveEdit}
      />

      <EditZoneDialog
        zone={zone}
        visible={zoneEditVisible}
        onCancel={() => setZoneEditVisible(false)}
        onSave={handleSaveZone}
        onDelete={handleDeleteZone}
      />

      <Portal>
        {/* Move item dialog */}
        <Dialog
          visible={!!movingItem}
          onDismiss={() => setMovingItem(null)}
        >
          <Dialog.Title>{t("zone.move_to")}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {otherZones.map((z) => (
                <List.Item
                  key={z.id}
                  title={z.name}
                  left={() => (
                    <View
                      style={[
                        styles.zoneColorDot,
                        { backgroundColor: z.color },
                      ]}
                    />
                  )}
                  onPress={() => {
                    if (movingItem) handleMoveItem(movingItem.id, z.id);
                  }}
                />
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  header: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  colorDot: { width: 16, height: 16, borderRadius: 8, marginRight: 8 },
  headerTitle: { flex: 1 },
  itemCount: { marginTop: 4 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addInput: { flex: 1 },
  itemLeft: { flexDirection: "row", alignItems: "center" },
  checkedRow: { opacity: 0.55 },
  swipeAction: {
    width: 64,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: { paddingBottom: 120 },
  scrollArea: { maxHeight: 400 },
  zoneColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: 8,
    alignSelf: "center",
  },
});
