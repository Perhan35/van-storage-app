import React from "react";
import { View, StyleSheet, GestureResponderEvent, Pressable } from "react-native";
import ReanimatedSwipeable, {
  SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
} from "react-native-reanimated";
import { Text, IconButton, List, Icon } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../theme/useAppTheme";
import { Item } from "../db/database";
import { seasonIconName, seasonIconColor } from "./seasonIcon";
import { expirationIconName, expirationIconColor } from "./expirationIcon";
import { getExpirationStatus } from "../utils/expiration";
import { formatExpiration } from "../utils/date";
import { triggerHaptic } from "../utils/haptics";
import { AnimatedCheckbox } from "./AnimatedCheckbox";
import { AnimatedCheckRow } from "./AnimatedCheckRow";
import { AnimatedOutOfVanRow } from "./AnimatedOutOfVanRow";
import { HighlightFlashRow } from "./HighlightFlashRow";

const ACTION_WIDTH = 64;
// Indent per nesting level (Sac > Trousse > Brosse à dent).
const INDENT_PER_LEVEL = 28;
// Where a level's guide line sits: just under the start of the title of the
// group it belongs to (List.Item's content starts 16px in).
const GUIDE_OFFSET = 18;

// Non-checklist rows have no renderLeftActions, but ReanimatedSwipeable's
// pan gesture still claims any rightward drag past its default 10px
// threshold (see activeOffsetX in the library source) even with nothing to
// reveal — which steals the touch from the native swipe-back gesture before
// it can recognize it. Pushing the threshold far past any real swipe lets
// the row's own gesture never activate rightward, so the touch falls
// through to the stack's back gesture instead (same as swiping over the
// screen's empty background, where no gesture competes for it at all).
const DISABLE_RIGHTWARD_DRAG = 100000;

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

type Props = {
  item: Item;
  zoneChecklist: boolean;
  activeLocationIcon: string;
  // 1 for an item directly in the zone, 2 inside another item, 3 below that.
  depth: number;
  // How many things are stored inside it (at any level); 0 = not a group.
  contentCount: number;
  // Whether its contents are shown below it (only meaningful for a group).
  expanded: boolean;
  onToggleExpanded: (item: Item) => void;
  // Deep-link highlight (see zone/[id].tsx's highlightedItemId).
  highlighted: boolean;
  onHighlightDone: () => void;
  onToggleChecked: (item: Item) => void;
  onToggleOutOfVan: (item: Item) => void;
  onPressItem: (item: Item) => void;
  onOpenMenu: (item: Item, x: number, y: number) => void;
  // Registers/unregisters this row's swipeable so the parent can close it
  // programmatically (e.g. after a menu action).
  onSwipeableRef: (itemId: string, ref: SwipeableMethods | null) => void;
};

// One row of the zone item list, split out of the FlatList's renderItem and
// memoized: without this, every row rebuilt its swipeable + three nested
// animated wrappers + List.Item on every render of the list — including a
// single checkbox tap, which only ever changes one row's data. `item` keeps
// its object identity for every row untouched by a given edit (see
// handleToggleChecked's setItems in zone/[id].tsx), so as long as the
// callback props below stay stable, React.memo actually skips the rest.
function ItemRowInner({
  item,
  zoneChecklist,
  activeLocationIcon,
  depth,
  contentCount,
  expanded,
  onToggleExpanded,
  highlighted,
  onHighlightDone,
  onToggleChecked,
  onToggleOutOfVan,
  onPressItem,
  onOpenMenu,
  onSwipeableRef,
}: Props) {
  const { t, i18n } = useTranslation();
  const { palette } = useAppTheme();

  const openMenuAt = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    onOpenMenu(item, typeof pageX === "number" ? pageX : 40, typeof pageY === "number" ? pageY : 120);
  };

  return (
    <ReanimatedSwipeable
      ref={(ref) => onSwipeableRef(item.id, ref)}
      overshootRight={false}
      dragOffsetFromLeft={zoneChecklist ? undefined : DISABLE_RIGHTWARD_DRAG}
      onSwipeableOpen={(direction) => {
        // ReanimatedSwipeable's SwipeDirection is inverted relative to the
        // legacy Swipeable: LEFT means the row moved left, revealing the
        // *right* actions panel (out-of-van), and vice versa.
        if (direction === SwipeDirection.LEFT) onToggleOutOfVan(item);
        else if (direction === SwipeDirection.RIGHT && zoneChecklist) onToggleChecked(item);
      }}
      renderLeftActions={
        zoneChecklist
          ? (_progress, translation) => (
              <SwipeActionButton
                translation={translation}
                side="left"
                backgroundColor={palette.primary}
                icon={item.checked ? "checkbox-blank-outline" : "check-bold"}
                onPress={() => onToggleChecked(item)}
              />
            )
          : undefined
      }
      renderRightActions={(_progress, translation) => (
        <SwipeActionButton
          translation={translation}
          side="right"
          backgroundColor={item.out_of_van ? palette.success : palette.danger}
          icon={item.out_of_van ? activeLocationIcon : "export"}
          onPress={() => onToggleOutOfVan(item)}
        />
      )}
    >
      <AnimatedOutOfVanRow
        outOfVan={!!item.out_of_van}
        outColor={palette.danger}
        inColor={palette.success}
        outIcon="export"
        inIcon={activeLocationIcon}
      >
        <AnimatedCheckRow checked={!!item.checked}>
          <HighlightFlashRow active={highlighted} color={palette.editModeAccent} onDone={onHighlightDone}>
            <List.Item
              title={item.name}
              description={
                item.expiration_date
                  ? (props) => {
                      const status = getExpirationStatus(
                        item.expiration_date as string,
                        item.reminder_days
                      );
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
              onPress={() => onPressItem(item)}
              onLongPress={(e) => {
                triggerHaptic();
                openMenuAt(e);
              }}
              titleStyle={[
                contentCount > 0 && styles.groupTitle,
                !!item.checked && {
                  color: palette.onSurfaceVariant,
                  textDecorationLine: "line-through" as const,
                },
              ]}
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
                if (!zoneChecklist && !hasIcons) return null;
                return (
                  <View style={[styles.itemLeft, props.style]}>
                    {!!zoneChecklist && (
                      <AnimatedCheckbox checked={!!item.checked} onPress={() => onToggleChecked(item)} />
                    )}
                    {!!item.out_of_van && <List.Icon icon="export" color={palette.danger} />}
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
              style={[
                styles.listItem,
                depth > 1 && { paddingLeft: (depth - 1) * INDENT_PER_LEVEL },
              ]}
              right={() => (
                <View style={styles.itemRight}>
                  {contentCount > 0 && (
                    // The count and the arrow open/close the group together,
                    // on the right, so every title starts at the same place
                    // and only nesting moves a row to the right.
                    <Pressable
                      onPress={() => onToggleExpanded(item)}
                      style={styles.groupToggle}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={`${t(expanded ? "zone.group_collapse" : "zone.group_expand", {
                        name: item.name,
                      })}, ${t("zone.group_count", { count: contentCount })}`}
                    >
                      <Text
                        variant="labelMedium"
                        style={[
                          styles.countChip,
                          { backgroundColor: palette.surfaceVariant, color: palette.onSurfaceVariant },
                        ]}
                      >
                        {contentCount}
                      </Text>
                      <Icon
                        source={expanded ? "chevron-up" : "chevron-down"}
                        size={22}
                        color={palette.onSurfaceVariant}
                      />
                    </Pressable>
                  )}
                  <IconButton
                    icon="dots-vertical"
                    size={24}
                    onPress={openMenuAt}
                    style={styles.menuButton}
                  />
                </View>
              )}
            />
            {/* One vertical guide per group the item sits in, so what's
                inside a group reads as hanging from it. */}
            {Array.from({ length: depth - 1 }, (_, level) => (
              <View
                key={level}
                pointerEvents="none"
                style={[
                  styles.guide,
                  { left: level * INDENT_PER_LEVEL + GUIDE_OFFSET, backgroundColor: palette.outline },
                ]}
              />
            ))}
          </HighlightFlashRow>
        </AnimatedCheckRow>
      </AnimatedOutOfVanRow>
    </ReanimatedSwipeable>
  );
}

export const ItemRow = React.memo(ItemRowInner);

const styles = StyleSheet.create({
  itemLeft: { flexDirection: "row", alignItems: "center" },
  // Paper's MD3 List.Item reserves 24px on the right, and IconButton adds its
  // own 6px margin — together they pushed the ⋮ well inside the row. Trim both
  // so the ⋮ sits near the right edge (keeping IconButton's vertical margin so
  // the row height is unchanged).
  listItem: { paddingRight: 4 },
  menuButton: { marginRight: 0 },
  itemRight: { flexDirection: "row", alignItems: "center" },
  groupToggle: { flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 4 },
  guide: { position: "absolute", top: 0, bottom: 0, width: 2, borderRadius: 1, opacity: 0.5 },
  groupTitle: { fontWeight: "600" },
  countChip: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
    textAlign: "center",
  },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
});
