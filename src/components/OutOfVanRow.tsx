import React from "react";
import { View, StyleSheet } from "react-native";
import ReanimatedSwipeable, {
  SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  Extrapolation,
  LinearTransition,
  SharedValue,
  SlideOutRight,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated";
import { IconButton, List } from "react-native-paper";
import { useAppTheme } from "../theme/useAppTheme";
import { OutOfVanItem } from "../db/repository";
import { seasonIconName, seasonIconColor } from "./seasonIcon";
import { triggerHaptic } from "../utils/haptics";

const ACTION_WIDTH = 64;

// Slides the action button in from its edge as the row is swiped open.
// Swiping left reveals it, matching the out-of-van toggle direction used
// elsewhere in the app (zone list, search results).
function SwipeActionButton({
  translation,
  backgroundColor,
  icon,
  onPress,
}: {
  translation: SharedValue<number>;
  backgroundColor: string;
  icon: string;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
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
  item: OutOfVanItem;
  isGlobalView: boolean;
  onPutBack: (item: OutOfVanItem) => void;
  onLocate: (item: OutOfVanItem) => void;
  onLongPressItem: (item: OutOfVanItem) => void;
  onSwipeableRef: (itemId: string, ref: SwipeableMethods | null) => void;
};

// One row of the out-of-van list, memoized like ItemRow/SearchResultRow:
// without it, putting one item back rebuilt every other row's swipeable and
// exit/layout animation wrappers too.
function OutOfVanRowInner({
  item,
  isGlobalView,
  onPutBack,
  onLocate,
  onLongPressItem,
  onSwipeableRef,
}: Props) {
  const { palette } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const seasonIcon = seasonIconName(item.season);

  return (
    <Animated.View
      exiting={reducedMotion ? undefined : SlideOutRight.duration(280)}
      layout={reducedMotion ? undefined : LinearTransition.duration(220)}
    >
      <ReanimatedSwipeable
        ref={(ref) => onSwipeableRef(item.id, ref)}
        overshootRight={false}
        onSwipeableOpen={(direction) => {
          if (direction === SwipeDirection.LEFT) onPutBack(item);
        }}
        renderRightActions={(_progress, translation) => (
          <SwipeActionButton
            translation={translation}
            backgroundColor={palette.success}
            icon={item.location_icon}
            onPress={() => onPutBack(item)}
          />
        )}
      >
        <List.Item
          title={item.name}
          description={`📍 ${isGlobalView ? `${item.location_name} • ` : ""}${item.zone_name}${item.notes ? ` • ${item.notes}` : ""}`}
          onPress={() => onLocate(item)}
          onLongPress={() => {
            triggerHaptic();
            onLongPressItem(item);
          }}
          left={(props) => (
            <View style={styles.itemIcons}>
              <List.Icon {...props} icon="export" color={palette.danger} />
              {seasonIcon && (
                <List.Icon {...props} icon={seasonIcon} color={seasonIconColor(item.season)} />
              )}
            </View>
          )}
          right={() => <IconButton icon={item.location_icon} size={24} onPress={() => onPutBack(item)} />}
        />
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

export const OutOfVanRow = React.memo(OutOfVanRowInner);

const styles = StyleSheet.create({
  itemIcons: { flexDirection: "row" },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
});
