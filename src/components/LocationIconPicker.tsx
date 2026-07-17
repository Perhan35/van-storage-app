import React, { useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { IconButton, Icon } from "react-native-paper";
import { useAppTheme } from "../theme/useAppTheme";
import { LOCATION_ICON_OPTIONS } from "../db/templates";

type Props = {
  value: string;
  onChange: (icon: string) => void;
};

// Horizontal row of selectable location icons; the current one is highlighted.
// Chevrons at each edge hint that the list scrolls to reveal more icons, and
// hide once that edge is reached.
export function LocationIconPicker({ value, onChange }: Props) {
  const { palette } = useAppTheme();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const containerWidth = React.useRef(0);
  const contentWidth = React.useRef(0);

  const refreshRight = () => {
    setCanScrollRight(contentWidth.current > containerWidth.current + 4);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setCanScrollLeft(contentOffset.x > 4);
    setCanScrollRight(contentOffset.x < contentSize.width - layoutMeasurement.width - 4);
  };

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        containerWidth.current = e.nativeEvent.layout.width;
        refreshRight();
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(w) => {
          contentWidth.current = w;
          refreshRight();
        }}
      >
        {LOCATION_ICON_OPTIONS.map((icon) => {
          const selected = icon === value;
          return (
            <View
              key={icon}
              style={[
                styles.item,
                selected
                  ? { backgroundColor: palette.primary + "33", borderColor: palette.primary }
                  : { borderColor: "transparent" },
              ]}
            >
              <IconButton
                icon={icon}
                size={24}
                iconColor={selected ? palette.primary : palette.onSurfaceVariant}
                onPress={() => onChange(icon)}
              />
            </View>
          );
        })}
      </ScrollView>
      {canScrollLeft && (
        <View style={[styles.chevron, styles.chevronLeft]} pointerEvents="none">
          <Icon source="chevron-left" size={22} color={palette.onSurfaceVariant} />
        </View>
      )}
      {canScrollRight && (
        <View style={[styles.chevron, styles.chevronRight]} pointerEvents="none">
          <Icon source="chevron-right" size={22} color={palette.onSurfaceVariant} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center" },
  row: { gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  item: { borderRadius: 12, borderWidth: 2 },
  chevron: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  chevronLeft: { left: 0 },
  chevronRight: { right: 0 },
});
