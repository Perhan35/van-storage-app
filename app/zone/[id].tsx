import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
  FlatList,
  Platform,
  useWindowDimensions,
} from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Text,
  IconButton,
  List,
  Divider,
  Dialog,
  Portal,
  FAB,
} from "react-native-paper";
import { useAppStore } from "../../src/store/useAppStore";
import { listItemsForZone } from "../../src/db/repository";
import { Item } from "../../src/db/database";
import { DEFAULT_LOCATION_ICON } from "../../src/db/templates";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../src/theme/useAppTheme";
import { getReadableTextColor } from "../../src/utils/color";
import { EditItemDialog } from "../../src/components/dialogs/EditItemDialog";
import { EditZoneDialog } from "../../src/components/dialogs/EditZoneDialog";
import { AddItemDialog } from "../../src/components/dialogs/AddItemDialog";
import { Season } from "../../src/db/database";
import { ItemRow } from "../../src/components/ItemRow";
import { plusIcon, tagFabStyle } from "../../src/components/AddFab";
import { ContextMenu } from "../../src/components/ContextMenu";
import { ParentOptionList } from "../../src/components/ParentPickerField";
import { DeleteItemMode } from "../../src/db/repository";
import {
  ancestorsOf,
  applyChecked,
  canAddInto,
  childrenByParent,
  descendantsOf,
  indexById,
  isRoot,
  parentOptions,
} from "../../src/utils/itemTree";
import { loadExpandedItemIds, saveExpandedItemIds } from "../../src/utils/expandedItems";

// How long a freshly-checked item stays put before sliding to the bottom.
const MOVE_DELAY_MS = 1000;

const COMPLETED_HEADER_ID = "__completed_header__";

// The list holds the zone's items as a flattened tree (an open group is
// followed by what's inside it, indented), plus — in checklist zones — a
// single synthetic "Completed" divider.
type CompletedHeaderRow = { __header: true; id: string; count: number };
type ItemListRow = {
  id: string;
  item: Item;
  depth: number;
  // Things stored inside it, at any level (0 = not a group).
  contentCount: number;
  expanded: boolean;
};
type ListRow = ItemListRow | CompletedHeaderRow;

// iOS nav-bar geometry, used to size the custom header title to the space the
// bar button items leave free (see the headerTitle comment below): the native
// back button on the left, the header action buttons on the right.
//
// These are deliberate over-estimates. UIKit centers the title view in the
// free space, so a box *wider* than that space overhangs on both sides and
// slides back under the back button — the failure mode this went through
// several times. Erring high instead costs a few points of gap on the left,
// which is the harmless direction. BACK_BUTTON_WIDTH is the one to nudge if
// the title ever needs to sit tighter to the chevron: UIKit does not expose
// the real width, and on iOS 26 the back button is a circular "liquid glass"
// pill considerably wider than the old bare chevron.
const BACK_BUTTON_WIDTH = 80;
const HEADER_ICON_WIDTH = 44; // split + pencil, size 20
const RESET_ICON_WIDTH = 48; // reset checklist, default size
const HEADER_TRAILING_INSET = 12;

export default function ZoneDetailScreen() {
  const { id, highlightItemId } = useLocalSearchParams<{ id: string; highlightItemId?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const zones = useAppStore((s) => s.zones);
  const activeLocationIcon = useAppStore(
    (s) => s.locations.find((l) => l.id === s.activeLocationId)?.icon ?? DEFAULT_LOCATION_ICON
  );
  const addItem = useAppStore((s) => s.addItem);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const updateItem = useAppStore((s) => s.updateItem);
  const moveItem = useAppStore((s) => s.moveItem);
  const setItemParent = useAppStore((s) => s.setItemParent);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setItemChecked = useAppStore((s) => s.setItemChecked);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const splitZone = useAppStore((s) => s.splitZone);
  const zoneColorFullScreen = useAppStore((s) => s.zoneColorFullScreen);

  const [items, setItems] = useState<Item[]>([]);
  const [addItemVisible, setAddItemVisible] = useState(false);
  // Item the new one goes inside ("Ajouter dedans"), null from the "+" button.
  const [addParentId, setAddParentId] = useState<string | null>(null);
  // Item being stored inside another one ("Ranger dans…").
  const [storingItem, setStoringItem] = useState<Item | null>(null);
  // Groups (items with things inside) currently open. Closed by default;
  // remembered across visits (see utils/expandedItems).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedLoaded, setExpandedLoaded] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [menu, setMenu] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [movingItem, setMovingItem] = useState<Item | null>(null);
  const [zoneEditVisible, setZoneEditVisible] = useState(false);
  const swipeableRefs = useRef<Map<string, SwipeableMethods>>(new Map());
  // Items just checked linger in place (checked + struck through) for a beat
  // before sliding into the "Completed" section — these are the ids waiting
  // out that beat, plus the timers that release them.
  const [pendingMoveIds, setPendingMoveIds] = useState<Set<string>>(new Set());
  const moveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const listRef = useRef<FlatList<ListRow>>(null);
  // Item deep-linked from elsewhere (e.g. the expiration overview) that
  // should be scrolled to and flashed once the list has it. Tracked
  // separately from the route param so it only fires once per navigation.
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightHandledRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      moveTimers.current.forEach((timer) => clearTimeout(timer));
      moveTimers.current.clear();
    },
    []
  );

  const zone = zones.find((z) => z.id === id);
  // The header background is the zone's own color (solid, no blending), so
  // its tint must be derived from that color rather than the fixed app
  // palette.headerTint (always white) — otherwise text/icons disappear on
  // light zone colors.
  const zoneHeaderTint = zone ? getReadableTextColor(zone.color, 1) : palette.headerTint;

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
    let cancelled = false;
    loadExpandedItemIds()
      .then((ids) => {
        if (!cancelled) setExpandedIds(ids);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setExpandedLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Applies a change to the open groups and remembers it.
  const updateExpanded = useCallback((change: (prev: Set<string>) => Set<string>) => {
    setExpandedIds((prev) => {
      const next = change(prev);
      if (next !== prev) saveExpandedItemIds(next).catch(() => {});
      return next;
    });
  }, []);

  const handleToggleExpanded = useCallback(
    (item: Item) => {
      updateExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    },
    [updateExpanded]
  );

  // Latest items, for callbacks that must stay stable (they're ItemRow props,
  // see the useCallback note further down) yet need the current tree.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Opens the given items and every group they sit in, so they're visible.
  const revealItems = useCallback(
    (ids: (string | null | undefined)[]) => {
      const byId = indexById(itemsRef.current);
      const toOpen: string[] = [];
      for (const id of ids) {
        if (!id) continue;
        toOpen.push(id, ...ancestorsOf(id, byId).map((a) => a.id));
      }
      if (toOpen.length === 0) return;
      updateExpanded((prev) => {
        if (toOpen.every((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        toOpen.forEach((id) => next.add(id));
        return next;
      });
    },
    [updateExpanded]
  );

  const tree = useMemo(() => {
    const byId = indexById(items);
    const children = childrenByParent(items);
    const contentCounts = new Map<string, number>();
    for (const parentId of children.keys()) {
      contentCounts.set(parentId, descendantsOf(parentId, children).length);
    }
    return { byId, children, contentCounts };
  }, [items]);
  // A checked item counts as "done" (and sinks to the bottom) only once its
  // linger window has elapsed — while pending it keeps its active-list spot.
  const isDone = useCallback(
    (item: Item) => !!item.checked && !pendingMoveIds.has(item.id),
    [pendingMoveIds]
  );

  // Stable partition: active items keep their loaded order on top, done items
  // fall to the bottom (also keeping their relative order). Applied to each
  // set of siblings, so a group's checked contents sink within the group and
  // only a whole finished group drops into "Completed".
  const sortSiblings = useCallback(
    (list: Item[]) => {
      if (!zone?.checklist) return list;
      return list
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const rank = Number(isDone(a.item)) - Number(isDone(b.item));
          return rank !== 0 ? rank : a.index - b.index;
        })
        .map((entry) => entry.item);
    },
    [zone?.checklist, isDone]
  );

  const listData = useMemo<ListRow[]>(() => {
    const { byId, children, contentCounts } = tree;
    const rows: ListRow[] = [];
    const seen = new Set<string>();
    const pushTree = (item: Item, depth: number) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      const contentCount = contentCounts.get(item.id) ?? 0;
      const expanded = contentCount > 0 && expandedIds.has(item.id);
      rows.push({ id: item.id, item, depth, contentCount, expanded });
      if (!expanded) return;
      for (const child of sortSiblings(children.get(item.id) ?? [])) pushTree(child, depth + 1);
    };
    const roots = sortSiblings(items.filter((item) => isRoot(item, byId)));
    const firstDone = zone?.checklist ? roots.findIndex(isDone) : -1;
    roots.forEach((root, index) => {
      // Inject a "Completed" divider ahead of the first done group.
      if (index === firstDone) {
        rows.push({ __header: true, id: COMPLETED_HEADER_ID, count: roots.length - firstDone });
      }
      pushTree(root, 1);
    });
    return rows;
  }, [tree, items, expandedIds, sortSiblings, zone?.checklist, isDone]);

  // Opens the groups a deep-linked item (search, expiration overview) sits
  // in, so the scroll below can find its row.
  useEffect(() => {
    if (!highlightItemId || !expandedLoaded || highlightHandledRef.current === highlightItemId) return;
    if (!tree.byId.has(highlightItemId)) return;
    revealItems(ancestorsOf(highlightItemId, tree.byId).map((a) => a.id));
  }, [highlightItemId, expandedLoaded, tree, revealItems]);

  useEffect(() => {
    if (!highlightItemId || highlightHandledRef.current === highlightItemId) return;
    const index = listData.findIndex((row) => !("__header" in row) && row.id === highlightItemId);
    // Not visible yet: its groups are still opening (see the effect above).
    if (index === -1) return;
    highlightHandledRef.current = highlightItemId;
    setHighlightedItemId(highlightItemId);
    const scrollTimer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }, 100);
    return () => clearTimeout(scrollTimer);
  }, [highlightItemId, listData]);

  // useCallback'd (and moved above the setOptions effect below, which lists
  // them as deps) so that effect doesn't rebuild the header on every render —
  // a plain function here would get a new identity each time regardless of
  // whether anything the header shows actually changed.
  const handleResetChecklist = useCallback(() => {
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
  }, [id, t, resetChecklist, loadItems]);

  const handleSplitZone = useCallback(() => {
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
  }, [zone, t, id, splitZone, router]);

  // Narrowed to the two primitives the header actually reads (a count and a
  // boolean) rather than the whole `items` array: `items` is replaced wholesale
  // by every optimistic checkbox toggle (see handleToggleChecked), which
  // otherwise reran this effect — rebuilding both header closures and calling
  // navigation.setOptions — on every single tap.
  const itemsCount = items.length;
  const hasChecked = !!zone?.checklist && items.some((i) => i.checked);

  useEffect(() => {
    if (!zone) return;
    navigation.setOptions({
      title: zone.name,
      headerStyle: { backgroundColor: zone.color },
      headerTintColor: zoneHeaderTint,
      // On iOS the custom headerTitle is handed to UIKit as the nav bar's
      // `titleView`, which is always centered — `headerTitleAlign` is a
      // documented no-op there. Its width comes from Yoga, and UIKit centers
      // it inside the space left free by the bar button items *without*
      // clamping it: left = BACK_BUTTON_WIDTH + (available - W) / 2. So a
      // short zone name sat in the middle, and anything wider than the free
      // space (a long name, or an over-wide box) spilled back under the
      // chevron.
      //
      // Sizing the box to that free space is what makes its centered position
      // land against the chevron, with its far edge stopping where the action
      // buttons start. The widths above are rounded up rather than down, so
      // the box stays narrower than the gap and can never slide back under the
      // chevron. Android left-aligns the title itself.
      headerTitleAlign: "left",
      headerTitle: () => (
        <View
          style={[
            styles.headerTitleContainer,
            Platform.OS === "ios" && {
              width:
                windowWidth -
                BACK_BUTTON_WIDTH -
                2 * HEADER_ICON_WIDTH -
                (hasChecked ? RESET_ICON_WIDTH : 0) -
                HEADER_TRAILING_INSET,
            },
          ]}
        >
          <Text
            variant="titleMedium"
            style={{ color: zoneHeaderTint, fontWeight: "bold" }}
            numberOfLines={1}
          >
            {zone.name}
          </Text>
          <Text variant="bodySmall" style={{ color: zoneHeaderTint }}>
            {t(
              itemsCount === 1 ? "map.objects_count_one" : "map.objects_count_other",
              { count: itemsCount }
            )}
          </Text>
        </View>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          {hasChecked && (
            <IconButton
              icon="checkbox-multiple-blank-outline"
              iconColor={zoneHeaderTint}
              accessibilityLabel={t("zone.reset_checklist")}
              onPress={handleResetChecklist}
            />
          )}
          <IconButton
            icon="call-split"
            size={20}
            iconColor={zoneHeaderTint}
            accessibilityLabel={t("zone.split_zone_alert_title")}
            onPress={handleSplitZone}
          />
          <IconButton
            icon="pencil"
            size={20}
            iconColor={zoneHeaderTint}
            accessibilityLabel={t("zone.edit_zone")}
            onPress={() => setZoneEditVisible(true)}
          />
        </View>
      ),
    });
  }, [
    zone,
    itemsCount,
    hasChecked,
    navigation,
    palette,
    windowWidth,
    t,
    zoneHeaderTint,
    handleResetChecklist,
    handleSplitZone,
  ]);

  const openAddItem = (parentId: string | null) => {
    setAddParentId(parentId);
    setAddItemVisible(true);
  };

  const handleCreateItem = async (
    name: string,
    notes: string,
    season: Season,
    targetZoneId: string,
    expirationDate: string | null,
    reminderDays: number,
    parentId: string | null
  ) => {
    await addItem(name, targetZoneId, notes, season, expirationDate, reminderDays, parentId);
    setAddItemVisible(false);
    // Open the group it went into, so the new item shows up.
    revealItems([parentId]);
    await loadItems();
  };

  const handleDeleteItem = (item: Item) => {
    setMenu(null);
    const contentCount = tree.contentCounts.get(item.id) ?? 0;
    const runDelete = async (mode: DeleteItemMode) => {
      const removed =
        mode === "all"
          ? [item.id, ...descendantsOf(item.id, tree.children).map((d) => d.id)]
          : [item.id];
      updateExpanded((prev) => {
        if (!removed.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        removed.forEach((id) => next.delete(id));
        return next;
      });
      await deleteItem(item.id, mode);
      await loadItems();
    };
    if (contentCount === 0) {
      Alert.alert(t("zone.delete"), t("zone.delete_alert", { name: item.name }), [
        { text: t("map.cancel"), style: "cancel" },
        { text: t("zone.delete"), style: "destructive", onPress: () => runDelete("all") },
      ]);
      return;
    }
    // A group: ask every time what happens to what's inside it.
    Alert.alert(
      t("zone.delete_alert", { name: item.name }),
      t("zone.delete_group_text", { count: contentCount }),
      [
        { text: t("map.cancel"), style: "cancel" },
        { text: t("zone.delete_keep_contents"), onPress: () => runDelete("keep") },
        { text: t("zone.delete_with_contents"), style: "destructive", onPress: () => runDelete("all") },
      ]
    );
  };

  const handleSetParent = async (item: Item, parentId: string | null) => {
    setStoringItem(null);
    if (parentId === item.parent_id) return;
    await setItemParent(item.id, parentId);
    // Keep the item in sight: open the group it went into.
    revealItems([parentId]);
    await loadItems();
  };

  const handleSaveEdit = async (
    name: string,
    notes: string,
    season: Season,
    expirationDate: string | null,
    reminderDays: number,
    parentId?: string | null
  ) => {
    if (!editingItem) return;
    await updateItem(editingItem.id, name, notes, season, expirationDate, reminderDays);
    if (parentId !== undefined && parentId !== editingItem.parent_id) {
      await setItemParent(editingItem.id, parentId);
      revealItems([parentId]);
    }
    setEditingItem(null);
    await loadItems();
  };

  const handleMoveItem = async (itemId: string, newZoneId: string) => {
    await moveItem(itemId, newZoneId);
    setMovingItem(null);
    await loadItems();
  };

  // useCallback'd from here down through handleHighlightDone: these are
  // passed as props to ItemRow (see below), which is React.memo'd precisely
  // so an unrelated row's re-render doesn't cascade into every other row's
  // swipeable/animated wrappers. A plain function identity here would defeat
  // that memoization on every render of this screen.
  const handleToggleOutOfVan = useCallback(
    async (item: Item) => {
      setMenu(null);
      swipeableRefs.current.get(item.id)?.close();
      await setItemOutOfVan(item.id, !item.out_of_van);
      await loadItems();
    },
    [setItemOutOfVan, loadItems]
  );

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

  // Holds freshly checked items in place (checked + struck through) for a
  // beat so the completion registers, then releases them to slide down.
  const holdInPlace = useCallback(
    (ids: string[]) => {
      for (const itemId of ids) {
        clearPendingMove(itemId);
        setPendingMoveIds((prev) => new Set(prev).add(itemId));
        const timer = setTimeout(() => {
          moveTimers.current.delete(itemId);
          setPendingMoveIds((prev) => {
            if (!prev.has(itemId)) return prev;
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
        }, MOVE_DELAY_MS);
        moveTimers.current.set(itemId, timer);
      }
    },
    [clearPendingMove]
  );

  const handleToggleChecked = useCallback(
    async (item: Item) => {
      swipeableRefs.current.get(item.id)?.close();
      const nextChecked = !item.checked;
      // Reset any in-flight move so re-tapping doesn't leave a stale timer.
      clearPendingMove(item.id);
      // Reflect the toggle immediately so the checkbox + strikethrough land the
      // instant the row is tapped, rather than after the async DB write. The
      // same checklist rule as the database applies: everything inside the
      // item follows it, and the groups it sits in update (see applyChecked).
      const prev = itemsRef.current;
      const next = applyChecked(prev, item.id, nextChecked);
      setItems(next);
      if (zone?.checklist) {
        const newlyChecked = next
          .filter((it, i) => it.checked && !prev[i].checked)
          .map((it) => it.id);
        holdInPlace(newlyChecked);
      }
      try {
        await setItemChecked(item.id, nextChecked);
      } catch {
        // Roll the optimistic toggle back if the write failed.
        clearPendingMove(item.id);
        await loadItems();
      }
    },
    [zone?.checklist, clearPendingMove, holdInPlace, setItemChecked, loadItems]
  );

  const handlePressItem = useCallback((item: Item) => {
    setEditingItem(item);
  }, []);

  const handleOpenItemMenu = useCallback((item: Item, x: number, y: number) => {
    setMenu({ item, x, y });
  }, []);

  const handleSwipeableRef = useCallback((itemId: string, ref: SwipeableMethods | null) => {
    if (ref) swipeableRefs.current.set(itemId, ref);
    else swipeableRefs.current.delete(itemId);
  }, []);

  const handleHighlightDone = useCallback(() => {
    setHighlightedItemId(null);
  }, []);

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

  const addParentOptions = addItemVisible ? parentOptions(items, null) : [];
  const editParentOptions = editingItem ? parentOptions(items, editingItem.id) : undefined;
  const storeParentOptions = storingItem ? parentOptions(items, storingItem.id) : [];

  const screenBackground = zoneColorFullScreen ? zone.color + "26" : palette.surface;

  return (
    <View style={[styles.container, { backgroundColor: screenBackground }]}>
      {/* Items list */}
      <Animated.FlatList
        ref={listRef}
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        itemLayoutAnimation={LinearTransition.duration(300)}
        // Windowing tuning, now that rows are cheap to skip re-rendering (see
        // ItemRow's memo) — worth also trimming how many render off-screen.
        // removeClippedSubviews is deliberately left off: it's known to
        // conflict with gesture-handler Swipeable rows (a clipped row can
        // lose its open/close state), and this list's rows are swipeable.
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={10}
        onScrollToIndexFailed={(info) => {
          // Row not yet measured (e.g. off-screen on first render) — jump to
          // an estimated offset, then retry once layout has settled.
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
          }, 100);
        }}
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
            <ItemRow
              item={item.item}
              depth={item.depth}
              contentCount={item.contentCount}
              expanded={item.expanded}
              onToggleExpanded={handleToggleExpanded}
              zoneChecklist={!!zone.checklist}
              activeLocationIcon={activeLocationIcon}
              highlighted={highlightedItemId === item.id}
              onHighlightDone={handleHighlightDone}
              onToggleChecked={handleToggleChecked}
              onToggleOutOfVan={handleToggleOutOfVan}
              onPressItem={handlePressItem}
              onOpenMenu={handleOpenItemMenu}
              onSwipeableRef={handleSwipeableRef}
            />
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

      <ContextMenu
        visible={!!menu}
        onDismiss={() => setMenu(null)}
        anchor={menu ? { x: menu.x, y: menu.y } : { x: 0, y: 0 }}
        header={
          menu
            ? {
                title: menu.item.name,
                icon: "package-variant",
                subtitle: t("zone.item_kind_label"),
              }
            : undefined
        }
        items={
          menu
            ? [
                {
                  icon: "pencil-outline",
                  label: t("zone.edit"),
                  onPress: () => setEditingItem(menu.item),
                },
                ...(canAddInto(menu.item.id, items)
                  ? [
                      {
                        icon: "package-variant-plus",
                        label: t("zone.add_inside"),
                        onPress: () => openAddItem(menu.item.id),
                      },
                    ]
                  : []),
                ...(parentOptions(items, menu.item.id).some((o) => o.id !== menu.item.parent_id)
                  ? [
                      {
                        icon: "package-down",
                        label: t("zone.store_in"),
                        onPress: () => setStoringItem(menu.item),
                      },
                    ]
                  : []),
                ...(menu.item.parent_id && tree.byId.has(menu.item.parent_id)
                  ? [
                      {
                        icon: "package-up",
                        label: t("zone.remove_from", {
                          name: tree.byId.get(menu.item.parent_id)!.name,
                        }),
                        // Up one level: into the group the parent sits in,
                        // or straight into the zone.
                        onPress: () =>
                          handleSetParent(
                            menu.item,
                            tree.byId.get(menu.item.parent_id!)!.parent_id ?? null
                          ),
                      },
                    ]
                  : []),
                ...(otherZones.length > 0
                  ? [
                      {
                        icon: "arrow-right-bold",
                        label: t("zone.move"),
                        onPress: () => setMovingItem(menu.item),
                      },
                    ]
                  : []),
                {
                  icon: menu.item.out_of_van ? "tray-arrow-down" : "export",
                  label: menu.item.out_of_van ? t("zone.put_back") : t("zone.take_out"),
                  onPress: () => handleToggleOutOfVan(menu.item),
                },
                {
                  icon: "delete-outline",
                  label: t("zone.delete"),
                  tone: "danger",
                  dividerBefore: true,
                  onPress: () => handleDeleteItem(menu.item),
                },
              ]
            : []
        }
      />

      {/* Always painted in the zone's own color like the header above it, so
          the add button reads as belonging to this zone rather than to the
          app chrome — independent of zoneColorFullScreen, which only governs
          the screen background. It therefore borrows the header's derived
          tint for the "+" glyph. */}
      <FAB
        icon={plusIcon}
        color={zoneHeaderTint}
        style={[
          styles.fab,
          tagFabStyle(palette.secondary),
          {
            backgroundColor: zone.color,
            shadowColor: zone.color,
            shadowOpacity: 0.35,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 8,
            bottom: insets.bottom + 16,
          },
        ]}
        onPress={() => openAddItem(null)}
        accessibilityLabel={t("zone.add_item")}
      />

      <AddItemDialog
        visible={addItemVisible}
        zones={zones}
        zoneId={id ?? ""}
        zoneLocked
        parentOptions={addParentOptions}
        initialParentId={addParentId}
        onCancel={() => setAddItemVisible(false)}
        onSave={handleCreateItem}
      />

      <EditItemDialog
        item={editingItem}
        parentOptions={editParentOptions}
        currentParentName={
          editingItem?.parent_id ? tree.byId.get(editingItem.parent_id)?.name : undefined
        }
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
        {/* "Ranger dans…": store an item inside another one of this zone */}
        <Dialog visible={!!storingItem} onDismiss={() => setStoringItem(null)}>
          <Dialog.Title>{t("zone.store_in_title", { name: storingItem?.name ?? "" })}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {!!storingItem && (
                <ParentOptionList
                  options={storeParentOptions}
                  selectedId={storingItem.parent_id ?? null}
                  onPick={(parentId) => handleSetParent(storingItem, parentId)}
                />
              )}
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>

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
  headerTitleContainer: { alignItems: "flex-start" },
  headerActions: { flexDirection: "row", alignItems: "center" },
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
