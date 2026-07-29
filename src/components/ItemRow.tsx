import React from "react";
import { View, StyleSheet, GestureResponderEvent } from "react-native";
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
import { Text, IconButton, List } from "react-native-paper";
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
      dragOffsetFromLeftEdge={zoneChecklist ? undefined : DISABLE_RIGHTWARD_DRAG}
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
              right={() => (
                <IconButton icon="dots-vertical" size={24} onPress={openMenuAt} />
              )}
            />
          </HighlightFlashRow>
        </AnimatedCheckRow>
      </AnimatedOutOfVanRow>
    </ReanimatedSwipeable>
  );
}

export const ItemRow = React.memo(ItemRowInner);

const styles = StyleSheet.create({
  itemLeft: { flexDirection: "row", alignItems: "center" },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
});
