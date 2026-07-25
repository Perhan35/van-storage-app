import React from "react";
import { View, StyleSheet } from "react-native";
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
import { List, IconButton } from "react-native-paper";
import { Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../theme/useAppTheme";
import { SearchResultItem } from "../db/repository";
import { seasonIconName, seasonIconColor } from "./seasonIcon";
import { expirationIconColor } from "./expirationIcon";
import { getExpirationStatus } from "../utils/expiration";
import { formatExpiration } from "../utils/date";
import { triggerHaptic } from "../utils/haptics";
import { AnimatedCheckRow } from "./AnimatedCheckRow";
import { AnimatedOutOfVanRow } from "./AnimatedOutOfVanRow";

const ACTION_WIDTH = 64;

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
  item: SearchResultItem;
  // Global search (opened from the all-locations overview) prefixes each
  // row's zone line with the location name, since results can span more
  // than one location.
  isGlobalView: boolean;
  onToggleChecked: (item: SearchResultItem) => void;
  onToggleOutOfVan: (item: SearchResultItem) => void;
  onPressItem: (item: SearchResultItem) => void;
  onLongPressItem: (item: SearchResultItem) => void;
  onSwipeableRef: (itemId: string, ref: SwipeableMethods | null) => void;
};

// One row of the search results list, memoized for the same reason as
// zone/[id].tsx's ItemRow: without it, every row rebuilt its swipeable +
// animated wrappers on every keystroke-driven results refresh, even for rows
// whose data didn't change.
function SearchResultRowInner({
  item,
  isGlobalView,
  onToggleChecked,
  onToggleOutOfVan,
  onPressItem,
  onLongPressItem,
  onSwipeableRef,
}: Props) {
  const { t, i18n } = useTranslation();
  const { palette } = useAppTheme();

  return (
    <ReanimatedSwipeable
      ref={(ref) => onSwipeableRef(item.id, ref)}
      overshootRight={false}
      onSwipeableOpen={(direction) => {
        // ReanimatedSwipeable's SwipeDirection is inverted relative to the
        // legacy Swipeable: LEFT means the row moved left, revealing the
        // *right* actions panel (out-of-van), and RIGHT reveals the left
        // actions panel (checked).
        if (direction === SwipeDirection.LEFT) onToggleOutOfVan(item);
        else if (direction === SwipeDirection.RIGHT) onToggleChecked(item);
      }}
      renderLeftActions={
        item.zone_checklist
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
          icon={item.out_of_van ? item.location_icon : "export"}
          onPress={() => onToggleOutOfVan(item)}
        />
      )}
    >
      <AnimatedOutOfVanRow
        outOfVan={!!item.out_of_van}
        outColor={palette.danger}
        inColor={palette.success}
        outIcon="export"
        inIcon={item.location_icon}
      >
        <AnimatedCheckRow checked={!!item.checked}>
          <List.Item
            title={item.name}
            description={(props) => {
              const location = isGlobalView ? `${item.location_name} • ` : "";
              const zoneLine = item.out_of_van
                ? `📍 ${location}${item.zone_name} • ${t("search.out_of_van")}`
                : `📍 ${location}${item.zone_name}`;
              return (
                <View>
                  <Text style={{ color: props.color, fontSize: props.fontSize }}>{zoneLine}</Text>
                  {!!item.expiration_date && (
                    <Text
                      style={{
                        color: expirationIconColor(
                          getExpirationStatus(item.expiration_date, item.reminder_days),
                          palette
                        ),
                        fontSize: props.fontSize,
                      }}
                    >
                      {t("zone.expires_on", {
                        date: formatExpiration(item.expiration_date, i18n.language),
                      })}
                    </Text>
                  )}
                </View>
              );
            }}
            onPress={() => onPressItem(item)}
            onLongPress={() => {
              triggerHaptic();
              onLongPressItem(item);
            }}
            titleStyle={
              item.checked
                ? { color: palette.onSurfaceVariant, textDecorationLine: "line-through" }
                : undefined
            }
            left={(props) => {
              const seasonIcon = seasonIconName(item.season);
              return (
                <View style={styles.itemIcons}>
                  <List.Icon
                    {...props}
                    icon={item.out_of_van ? "export" : item.location_icon}
                    color={item.out_of_van ? palette.danger : undefined}
                  />
                  {seasonIcon && (
                    <List.Icon {...props} icon={seasonIcon} color={seasonIconColor(item.season)} />
                  )}
                </View>
              );
            }}
          />
        </AnimatedCheckRow>
      </AnimatedOutOfVanRow>
    </ReanimatedSwipeable>
  );
}

export const SearchResultRow = React.memo(SearchResultRowInner);

const styles = StyleSheet.create({
  itemIcons: { flexDirection: "row" },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
});
