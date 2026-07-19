import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Icon, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/useAppTheme";
import { useAppStore } from "../store/useAppStore";
import { hexToRgba } from "../utils/color";

export type ContextMenuItem = {
  icon: string; // Material Community icon name
  label: string;
  onPress: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  // Draws a separator above this item — used to set the destructive action apart.
  dividerBefore?: boolean;
  // Shows a trailing checkmark — used by the selection dropdowns.
  selected?: boolean;
};

type Props = {
  visible: boolean;
  onDismiss: () => void;
  // Point mode (default): screen coordinates of the touch that opened the
  // menu (pageX / pageY) — the card floats centered on that point.
  // Dropdown mode: the trigger's measured rect (x/y/width/height via
  // measureInWindow) — the card opens flush below it, matching its width.
  anchor: { x: number; y: number; width?: number; height?: number };
  // Optional contextual header (target name + icon, plus a category
  // subtitle e.g. "Location" / "Item"). Hidden when the "show menu header"
  // setting is off, or when `dropdown` is set (a header doesn't fit a
  // width-matched filter dropdown), so callers can always pass it.
  header?: { title: string; icon: string; subtitle?: string };
  items: ContextMenuItem[];
  // Renders as a select-style dropdown: matches the anchor's width and opens
  // flush beneath it, instead of floating centered on a touch point.
  dropdown?: boolean;
};

const MENU_WIDTH = 220;
const EDGE_PADDING = 12;
const DROPDOWN_GAP = 6;
const DROPDOWN_RADIUS = 14;
const POPUP_RADIUS = 20;

export function ContextMenu({ visible, onDismiss, anchor, header, items, dropdown }: Props) {
  const { palette } = useAppTheme();
  const showHeader = useAppStore((s) => s.showMenuHeader);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Dropdown mode only: the items' natural (untruncated, unclamped) content
  // size, learned from an invisible off-screen render before the real card is
  // laid out. Needed because ScrollView — unlike a plain View — doesn't
  // shrink-wrap to its content's width on native (so the real card can't just
  // be given a `minWidth` and left to size itself), and because a ScrollView
  // reserves scrollbar gutter space even when it doesn't need to scroll,
  // which would otherwise shave a few pixels off the available label width.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const opacity = useSharedValue(0);
  const scale = useSharedValue(dropdown ? 1 : 0.92);
  const translateY = useSharedValue(dropdown ? -8 : 0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Re-measure on every open (and whenever the anchor moves to a new target).
  useEffect(() => {
    if (visible) {
      setSize(null);
      setNaturalSize(null);
    } else {
      opacity.value = 0;
      scale.value = dropdown ? 1 : 0.92;
      translateY.value = dropdown ? -8 : 0;
      setSize(null);
      setNaturalSize(null);
    }
  }, [visible, anchor.x, anchor.y, dropdown, opacity, scale, translateY]);

  // Only animate in once the card has been measured (and, in dropdown mode,
  // its natural size is known), so it never flashes at the wrong position or
  // width before the edge-clamping is applied.
  const ready = dropdown ? !!size && naturalSize !== null : !!size;
  useEffect(() => {
    if (visible && ready) {
      opacity.value = withTiming(1, { duration: 120 });
      if (dropdown) {
        translateY.value = withTiming(0, { duration: reduceMotion ? 100 : 160 });
      } else {
        scale.value = reduceMotion
          ? withTiming(1, { duration: 120 })
          : withSpring(1, { damping: 18, stiffness: 240, mass: 0.6 });
      }
    }
  }, [visible, ready, dropdown, reduceMotion, opacity, scale, translateY]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  const backdropAnim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!visible) return null;

  // Dropdown width floors at the anchor's own width (never narrower than the
  // trigger) and grows to fit the widest label, learned from the off-screen
  // measurer below; capped so it never runs off the screen edge. A few extra
  // pixels absorb the sub-pixel rounding drift between the measurer's layout
  // pass and the real one — without it, a label can land 1-2px past its
  // allotted space and get needlessly ellipsized.
  const MEASURE_SAFETY_MARGIN = 6;
  const menuWidth = dropdown
    ? Math.min(
        Math.max(
          (naturalSize?.w ?? anchor.width ?? MENU_WIDTH) + MEASURE_SAFETY_MARGIN,
          anchor.width ?? MENU_WIDTH
        ),
        screenW - EDGE_PADDING * 2
      )
    : MENU_WIDTH;

  const maxListHeight = screenH - insets.top - insets.bottom - 140;

  // A ScrollView reserves scrollbar gutter space even when nothing overflows,
  // which would shave a few pixels off the width we just measured. Only pay
  // that cost in dropdown mode when the content genuinely needs to scroll;
  // popup mode always uses a ScrollView regardless (its width is fixed, not
  // content-derived, so the gutter doesn't cause truncation there).
  const dropdownNeedsScroll = dropdown && (naturalSize ? naturalSize.h > maxListHeight : false);

  // Position: point mode centers on the touch point, flipping left / up when
  // it would overflow. Dropdown mode opens flush below the anchor rect,
  // flipping above it if there's no room underneath.
  let left = anchor.x;
  let top = anchor.y;
  if (size) {
    if (dropdown) {
      top = anchor.y + (anchor.height ?? 0) + DROPDOWN_GAP;
      if (top + size.h > screenH - insets.bottom - EDGE_PADDING) {
        top = anchor.y - size.h - DROPDOWN_GAP;
      }
      // Clamp against the card's actual (content-driven) measured width, not
      // the anchor's width — the card only ever grows from the anchor's
      // width, so a long label can push it past the anchor without
      // overflowing the screen edge.
      left = Math.min(Math.max(left, EDGE_PADDING), screenW - size.w - EDGE_PADDING);
    } else {
      if (left + size.w > screenW - EDGE_PADDING) left = anchor.x - size.w;
      left = Math.min(Math.max(left, EDGE_PADDING), screenW - size.w - EDGE_PADDING);
      if (top + size.h > screenH - insets.bottom - EDGE_PADDING) top = anchor.y - size.h;
      top = Math.min(
        Math.max(top, insets.top + EDGE_PADDING),
        Math.max(insets.top + EDGE_PADDING, screenH - size.h - insets.bottom - EDGE_PADDING)
      );
    }
  } else {
    left = Math.min(Math.max(anchor.x, EDGE_PADDING), screenW - menuWidth - EDGE_PADDING);
    if (dropdown) top = anchor.y + (anchor.height ?? 0) + DROPDOWN_GAP;
  }

  const handlePress = (item: ContextMenuItem) => {
    if (item.disabled) return;
    onDismiss();
    item.onPress();
  };

  // When `measuring`, the label is laid out at its intrinsic width (no flex,
  // no line clamp) so the off-screen pass reports the true content width. In a
  // width-unconstrained container, a `flex: 1` label collapses toward zero on
  // native Yoga (it doesn't on web), which is what made the dropdown fall back
  // to the trigger's width and truncate. The real, on-screen rows keep
  // `flex: 1` + `numberOfLines={1}` so a label still ellipsizes if the card
  // ever hits the screen-edge cap.
  const renderRows = (measuring = false) =>
    items.map((item, idx) => {
      const danger = item.tone === "danger";
      const fg = item.disabled
        ? palette.onSurfaceVariant
        : danger
          ? palette.danger
          : palette.onSurface;
      const chipBg = danger
        ? hexToRgba(palette.danger, 0.13)
        : hexToRgba(palette.primary, 0.12);
      const chipFg = item.disabled
        ? palette.onSurfaceVariant
        : danger
          ? palette.danger
          : palette.primary;
      return (
        <React.Fragment key={idx}>
          {item.dividerBefore && (
            <View style={[styles.divider, { backgroundColor: palette.divider }]} />
          )}
          <Pressable
            onPress={() => handlePress(item)}
            disabled={item.disabled}
            android_ripple={{ color: hexToRgba(palette.onSurface, 0.08) }}
            style={({ pressed }) => [
              styles.item,
              pressed && !item.disabled && { backgroundColor: hexToRgba(palette.onSurface, 0.06) },
              item.disabled && styles.itemDisabled,
            ]}
          >
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <Icon source={item.icon} size={18} color={chipFg} />
            </View>
            <Text
              style={[styles.label, !measuring && styles.labelFlex, { color: fg }]}
              numberOfLines={measuring ? undefined : 1}
            >
              {item.label}
            </Text>
            {item.selected && <Icon source="check" size={18} color={palette.primary} />}
          </Pressable>
        </React.Fragment>
      );
    });

  return (
    <Portal>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Off-screen measurer (dropdown mode only): lays out the same rows,
            unconstrained and un-scrolled, purely to learn their natural size
            before the real card renders — ScrollView doesn't shrink-wrap to
            content on native the way a plain View does, so the real card
            needs an explicit width up front rather than a minWidth to grow
            into, and needs to know whether it'll actually need to scroll. */}
        {dropdown && naturalSize === null && (
          <View
            style={styles.measurer}
            pointerEvents="none"
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setNaturalSize({ w: width, h: height });
            }}
          >
            {renderRows(true)}
          </View>
        )}

        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        </Animated.View>

        <Animated.View
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setSize((prev) =>
              prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }
            );
          }}
          style={[
            styles.card,
            {
              left,
              top,
              width: menuWidth,
              borderRadius: dropdown ? DROPDOWN_RADIUS : POPUP_RADIUS,
              backgroundColor: palette.surface,
              borderColor: hexToRgba(palette.onSurface, 0.08),
            },
            cardAnim,
          ]}
        >
          {header && showHeader && !dropdown && (
            <View style={[styles.header, { borderBottomColor: palette.divider }]}>
              <View style={[styles.chip, { backgroundColor: hexToRgba(palette.primary, 0.16) }]}>
                <Icon source={header.icon} size={18} color={palette.primary} />
              </View>
              <View style={styles.headerText}>
                <Text
                  style={[styles.headerTitle, { color: palette.onSurface }]}
                  numberOfLines={1}
                >
                  {header.title}
                </Text>
                {!!header.subtitle && (
                  <Text
                    style={[styles.headerSubtitle, { color: palette.onSurfaceVariant }]}
                    numberOfLines={1}
                  >
                    {header.subtitle}
                  </Text>
                )}
              </View>
            </View>
          )}

          {dropdown && !dropdownNeedsScroll ? (
            <View>{renderRows()}</View>
          ) : (
            <ScrollView
              style={{ maxHeight: maxListHeight }}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {renderRows()}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.34)",
  },
  measurer: {
    position: "absolute",
    opacity: 0,
    left: -9999,
    top: 0,
  },
  card: {
    position: "absolute",
    borderWidth: 1,
    paddingVertical: 6,
    overflow: "hidden",
    // Soft, layered elevation on both platforms.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 11,
    marginBottom: 6,
    borderBottomWidth: 1,
  },
  headerText: {
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  itemDisabled: {
    opacity: 0.45,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 15,
    fontWeight: "500",
  },
  // On-screen rows only. Kept off the off-screen measure pass so the label
  // reports its intrinsic text width there — a `flex: 1` label collapses
  // toward zero in a width-unconstrained container on native Yoga (not on
  // web), which is what made the dropdown fall back to the trigger width and
  // truncate.
  labelFlex: {
    flex: 1,
  },
  divider: {
    height: 1,
    marginVertical: 6,
    marginHorizontal: 12,
  },
});
