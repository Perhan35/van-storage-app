import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, Alert, ScrollView } from "react-native";
import ReanimatedSwipeable, {
  SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  LinearTransition,
  SharedValue,
} from "react-native-reanimated";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Text,
  IconButton,
  List,
  Divider,
  Dialog,
  Portal,
  Menu,
  FAB,
} from "react-native-paper";
import { useAppStore } from "../../src/store/useAppStore";
import { listItemsForZone } from "../../src/db/repository";
import { Item } from "../../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../src/theme/useAppTheme";
import { EditItemDialog } from "../../src/components/dialogs/EditItemDialog";
import { EditZoneDialog } from "../../src/components/dialogs/EditZoneDialog";
import { AddItemDialog } from "../../src/components/dialogs/AddItemDialog";
import { Season } from "../../src/db/database";
import { seasonIconName, seasonIconColor } from "../../src/components/seasonIcon";
import { expirationIconName, expirationIconColor } from "../../src/components/expirationIcon";
import { getExpirationStatus } from "../../src/utils/expiration";
import { formatExpiration } from "../../src/utils/date";
import { AnimatedCheckbox } from "../../src/components/AnimatedCheckbox";
import { AnimatedCheckRow } from "../../src/components/AnimatedCheckRow";
import { AnimatedOutOfVanRow } from "../../src/components/AnimatedOutOfVanRow";

const ACTION_WIDTH = 64;

// How long a freshly-checked item stays put before sliding to the bottom.
const MOVE_DELAY_MS = 1000;

const COMPLETED_HEADER_ID = "__completed_header__";

// The checklist list holds items plus a single synthetic "Completed" divider.
type CompletedHeaderRow = { __header: true; id: string; count: number };
type ListRow = Item | CompletedHeaderRow;

// Slides the action button in from its edge as the row is swiped open.
// `translation` mirrors the legacy Swipeable's `drag` value: positive while
// revealing a left action, negative while revealing a right action.
function SwipeActionButton({
  translation,
  side,
  backgroundColor,
  icon,
  onPress,
}: {
  translation: SharedValue<number>;
  side: "left" | "right";
  backgroundColor: string;
  icon: string;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          side === "left"
            ? interpolate(
                translation.value,
                [0, ACTION_WIDTH],
                [-ACTION_WIDTH, 0],
                Extrapolation.CLAMP
              )
            : interpolate(
                translation.value,
                [-ACTION_WIDTH, 0],
                [0, ACTION_WIDTH],
                Extrapolation.CLAMP
              ),
      },
    ],
  }));

  return (
    <Animated.View style={[styles.swipeAction, { backgroundColor }, animatedStyle]}>
      <IconButton icon={icon} iconColor="#fff" size={26} onPress={onPress} />
    </Animated.View>
  );
}

export default function ZoneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
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
  const [addItemVisible, setAddItemVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<Item | null>(null);
  const [zoneEditVisible, setZoneEditVisible] = useState(false);
  const swipeableRefs = useRef<Map<string, SwipeableMethods>>(new Map());
  // Items just checked linger in place (checked + struck through) for a beat
  // before sliding into the "Completed" section — these are the ids waiting
  // out that beat, plus the timers that release them.
  const [pendingMoveIds, setPendingMoveIds] = useState<Set<string>>(new Set());
  const moveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(
    () => () => {
      moveTimers.current.forEach((timer) => clearTimeout(timer));
      moveTimers.current.clear();
    },
    []
  );

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

  // A checked item counts as "done" (and sinks to the bottom) only once its
  // linger window has elapsed — while pending it keeps its active-list spot.
  const isDone = useCallback(
    (item: Item) => !!item.checked && !pendingMoveIds.has(item.id),
    [pendingMoveIds]
  );

  // Stable partition: active items keep their loaded order on top, done items
  // fall to the bottom (also keeping their relative order).
  const sortedItems = useMemo(() => {
    if (!zone?.checklist) return items;
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const rank = Number(isDone(a.item)) - Number(isDone(b.item));
        return rank !== 0 ? rank : a.index - b.index;
      })
      .map((entry) => entry.item);
  }, [items, zone?.checklist, isDone]);

  // Inject a "Completed" divider ahead of the first done item.
  const listData = useMemo<ListRow[]>(() => {
    if (!zone?.checklist) return sortedItems;
    const firstDone = sortedItems.findIndex(isDone);
    if (firstDone === -1) return sortedItems;
    return [
      ...sortedItems.slice(0, firstDone),
      { __header: true, id: COMPLETED_HEADER_ID, count: sortedItems.length - firstDone },
      ...sortedItems.slice(firstDone),
    ];
  }, [sortedItems, zone?.checklist, isDone]);

  useEffect(() => {
    if (!zone) return;
    navigation.setOptions({
      title: zone.name,
      headerStyle: { backgroundColor: zone.color },
      headerTitle: () => (
        <View style={styles.headerTitleContainer}>
          <Text
            variant="titleMedium"
            style={{ color: palette.headerTint, fontWeight: "bold" }}
            numberOfLines={1}
          >
            {zone.name}
          </Text>
          <Text variant="bodySmall" style={{ color: palette.headerTint }}>
            {t(
              items.length === 1
                ? "map.objects_count_one"
                : "map.objects_count_other",
              { count: items.length }
            )}
          </Text>
        </View>
      ),
      headerRight: () => {
        const hasChecked = !!zone.checklist && items.some((i) => i.checked);
        return (
          <View style={styles.headerActions}>
            {hasChecked && (
              <IconButton
                icon="checkbox-multiple-blank-outline"
                iconColor={palette.headerTint}
                accessibilityLabel={t("zone.reset_checklist")}
                onPress={handleResetChecklist}
              />
            )}
            <IconButton
              icon="call-split"
              size={20}
              iconColor={palette.headerTint}
              accessibilityLabel={t("zone.split_zone_alert_title")}
              onPress={handleSplitZone}
            />
            <IconButton
              icon="pencil"
              size={20}
              iconColor={palette.headerTint}
              accessibilityLabel={t("zone.edit_zone")}
              onPress={() => setZoneEditVisible(true)}
            />
          </View>
        );
      },
    });
  }, [zone, items, navigation, palette]);

  const handleCreateItem = async (
    name: string,
    notes: string,
    season: Season,
    targetZoneId: string,
    expirationDate: string | null,
    reminderDays: number
  ) => {
    await addItem(name, targetZoneId, notes, season, expirationDate, reminderDays);
    setAddItemVisible(false);
    await loadItems();
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

  const clearPendingMove = useCallback((itemId: string) => {
    const timer = moveTimers.current.get(itemId);
    if (timer) {
      clearTimeout(timer);
      moveTimers.current.delete(itemId);
    }
    setPendingMoveIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const handleToggleChecked = async (item: Item) => {
    swipeableRefs.current.get(item.id)?.close();
    const nextChecked = !item.checked;
    // Reset any in-flight move so re-tapping doesn't leave a stale timer.
    clearPendingMove(item.id);
    // Reflect the toggle immediately so the checkbox + strikethrough land the
    // instant the row is tapped, rather than after the async DB write.
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, checked: nextChecked ? 1 : 0 } : it))
    );
    if (nextChecked && zone?.checklist) {
      // Hold the item in its current spot (checked + struck through) for a beat
      // so the completion registers, then release it to slide into "Completed".
      setPendingMoveIds((prev) => new Set(prev).add(item.id));
      const timer = setTimeout(() => {
        moveTimers.current.delete(item.id);
        setPendingMoveIds((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }, MOVE_DELAY_MS);
      moveTimers.current.set(item.id, timer);
    }
    try {
      await setItemChecked(item.id, nextChecked);
    } catch {
      // Roll the optimistic toggle back if the write failed.
      clearPendingMove(item.id);
      await loadItems();
    }
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
          text: t("zone.split_confirm"),
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
    <View style={[styles.container, { backgroundColor: zone.color + "26" }]}>
      {/* Items list */}
      <Animated.FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        itemLayoutAnimation={LinearTransition.duration(300)}
        renderItem={({ item }) => {
          if ("__header" in item) {
            return (
              <View style={styles.completedHeader}>
                <Text
                  variant="labelMedium"
                  style={{ color: palette.onSurfaceVariant }}
                >
                  {t("zone.completed", { count: item.count })}
                </Text>
              </View>
            );
          }
          return (
          <ReanimatedSwipeable
            ref={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref);
              else swipeableRefs.current.delete(item.id);
            }}
            overshootRight={false}
            onSwipeableOpen={(direction) => {
              // ReanimatedSwipeable's SwipeDirection is inverted relative to the
              // legacy Swipeable: LEFT means the row moved left, revealing the
              // *right* actions panel (out-of-van), and vice versa.
              if (direction === SwipeDirection.LEFT) handleToggleOutOfVan(item);
              else if (direction === SwipeDirection.RIGHT && zone.checklist)
                handleToggleChecked(item);
            }}
            renderLeftActions={
              zone.checklist
                ? (_progress, translation) => (
                    <SwipeActionButton
                      translation={translation}
                      side="left"
                      backgroundColor={palette.primary}
                      icon={item.checked ? "checkbox-blank-outline" : "check-bold"}
                      onPress={() => handleToggleChecked(item)}
                    />
                  )
                : undefined
            }
            renderRightActions={(_progress, translation) => (
              <SwipeActionButton
                translation={translation}
                side="right"
                backgroundColor={item.out_of_van ? palette.success : palette.danger}
                icon={item.out_of_van ? "van-utility" : "exit-to-app"}
                onPress={() => handleToggleOutOfVan(item)}
              />
            )}
          >
          <AnimatedOutOfVanRow
            outOfVan={!!item.out_of_van}
            outColor={palette.danger}
            inColor={palette.success}
          >
          <AnimatedCheckRow checked={!!item.checked}>
          <List.Item
            title={item.name}
            description={
              item.expiration_date
                ? (props) => {
                    const status = getExpirationStatus(item.expiration_date as string, item.reminder_days);
                    return (
                      <View>
                        {!!item.notes && (
                          <Text
                            style={{ color: props.color, fontSize: props.fontSize }}
                            numberOfLines={2}
                          >
                            {item.notes}
                          </Text>
                        )}
                        <Text
                          style={{
                            color: expirationIconColor(status, palette),
                            fontSize: props.fontSize,
                          }}
                        >
                          {t("zone.expires_on", {
                            date: formatExpiration(item.expiration_date as string, i18n.language),
                          })}
                        </Text>
                      </View>
                    );
                  }
                : item.notes || undefined
            }
            onPress={() => setEditingItem(item)}
            titleStyle={
              item.checked
                ? { color: palette.onSurfaceVariant, textDecorationLine: "line-through" }
                : undefined
            }
            left={(props) => {
              const seasonIcon = seasonIconName(item.season);
              const rawExpirationStatus = item.expiration_date
                ? getExpirationStatus(item.expiration_date, item.reminder_days)
                : null;
              // Only surface the calendar icon when the item is actually at
              // risk (expired or expiring soon) — an up-to-date expiration
              // date doesn't need a persistent icon on the row.
              const expirationStatus = rawExpirationStatus === "ok" ? null : rawExpirationStatus;
              const hasIcons = !!item.out_of_van || !!seasonIcon || !!expirationStatus;
              if (!zone.checklist && !hasIcons) return null;
              return (
                <View style={[styles.itemLeft, props.style]}>
                  {!!zone.checklist && (
                    <AnimatedCheckbox
                      checked={!!item.checked}
                      onPress={() => handleToggleChecked(item)}
                    />
                  )}
                  {!!item.out_of_van && (
                    <List.Icon icon="exit-to-app" color={palette.danger} />
                  )}
                  {!!seasonIcon && (
                    <List.Icon icon={seasonIcon} color={seasonIconColor(item.season)} />
                  )}
                  {!!expirationStatus && (
                    <List.Icon
                      icon={expirationIconName(expirationStatus)}
                      color={expirationIconColor(expirationStatus, palette)}
                    />
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
          </AnimatedCheckRow>
          </AnimatedOutOfVanRow>
          </ReanimatedSwipeable>
          );
        }}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
              {t("zone.empty")}
            </Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: palette.primary, bottom: insets.bottom + 16 }]}
        onPress={() => setAddItemVisible(true)}
        accessibilityLabel={t("zone.add_item")}
      />

      <AddItemDialog
        visible={addItemVisible}
        zones={zones}
        zoneId={id ?? ""}
        zoneLocked
        onCancel={() => setAddItemVisible(false)}
        onSave={handleCreateItem}
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
  headerTitleContainer: { alignItems: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  itemLeft: { flexDirection: "row", alignItems: "center" },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: { paddingBottom: 120 },
  completedHeader: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  scrollArea: { maxHeight: 400 },
  zoneColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: 8,
    alignSelf: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
  },
});
