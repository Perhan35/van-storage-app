import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ScrollView,
  useWindowDimensions,
  ListRenderItemInfo,
} from "react-native";
import { Portal, Text, Button, Icon } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { useAppTheme } from "../theme/useAppTheme";
import { seasonIconColor } from "./seasonIcon";

const MOCK_ACTION_WIDTH = 56;

// A fake item row that gently nudges left then right on a loop, hinting at the
// swipe gestures. The action panels behind it (check on the left, take-out on
// the right) peek through as the card slides, mirroring the real zone screen.
function MockItemCard() {
  const { palette } = useAppTheme();
  const { t } = useTranslation();
  const nudge = useSharedValue(0);

  useEffect(() => {
    // Reveal the full action panel (its icon sits centred in MOCK_ACTION_WIDTH),
    // so slide the card the panel's whole width in each direction.
    nudge.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 700 }),
        withTiming(-MOCK_ACTION_WIDTH, { duration: 600, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 600, easing: Easing.out(Easing.ease) }),
        withTiming(MOCK_ACTION_WIDTH, { duration: 600, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 600, easing: Easing.out(Easing.ease) })
      ),
      -1
    );
  }, [nudge]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

  return (
    <View style={[styles.mockStage, { borderColor: palette.divider }]}>
      <View style={[styles.mockAction, styles.mockActionLeft, { backgroundColor: palette.primary }]}>
        <Icon source="check-bold" size={22} color="#fff" />
      </View>
      <View style={[styles.mockAction, styles.mockActionRight, { backgroundColor: palette.danger }]}>
        <Icon source="exit-to-app" size={22} color="#fff" />
      </View>
      <Animated.View style={[styles.mockCard, { backgroundColor: palette.surface }, cardStyle]}>
        <Icon source="weather-sunny" size={26} color={seasonIconColor("summer")} />
        <View style={styles.mockCardText}>
          <Text variant="titleSmall" style={{ color: palette.onSurface }} numberOfLines={1}>
            {t("tutorial.demo_item_name")}
          </Text>
          <Text variant="bodySmall" style={{ color: palette.onSurfaceVariant }} numberOfLines={1}>
            {t("tutorial.demo_item_note")}
          </Text>
        </View>
        <Icon source="dots-vertical" size={22} color={palette.onSurfaceVariant} />
      </Animated.View>
    </View>
  );
}

type GestureRow = { icon: string; title: string; desc: string };
type Slide = {
  key: string;
  icon: string;
  // When set, a cluster of icons is shown in the circle instead of the single
  // `icon` — used to convey that the app spans several kinds of location.
  icons?: string[];
  title: string;
  desc?: string;
  gestures?: GestureRow[];
};

// Full-screen guided tour shown on first launch (and re-openable from
// Settings). It explains the core concepts — zones, items, expiration,
// seasons — plus the item-row gestures, which aren't otherwise discoverable.
export function OnboardingTutorial() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const visible = useAppStore((s) => s.tutorialVisible);
  const dismiss = useAppStore((s) => s.dismissTutorial);
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  // The component stays mounted (rendered in the root layout), so its state
  // survives across open/close. Reset to the first slide each time it reopens
  // — otherwise a relaunch from Settings starts on the stale last slide.
  useEffect(() => {
    if (visible) {
      setIndex(0);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [visible]);

  if (!visible) return null;

  const slides: Slide[] = [
    {
      key: "welcome",
      icon: "van-utility",
      title: t("tutorial.welcome_title"),
      desc: t("tutorial.welcome_desc"),
    },
    {
      key: "locations",
      icon: "home-group",
      icons: ["van-utility", "home-city-outline", "silverware-fork-knife"],
      title: t("tutorial.locations_title"),
      desc: t("tutorial.locations_desc"),
    },
    {
      key: "zones",
      icon: "map-marker-radius",
      title: t("tutorial.zones_title"),
      desc: t("tutorial.zones_desc"),
    },
    {
      key: "items",
      icon: "package-variant-closed",
      title: t("tutorial.items_title"),
      desc: t("tutorial.items_desc"),
    },
    {
      key: "expiration",
      icon: "calendar-clock",
      title: t("tutorial.expiration_title"),
      desc: t("tutorial.expiration_desc"),
    },
    {
      key: "season",
      icon: "sun-snowflake-variant",
      title: t("tutorial.season_title"),
      desc: t("tutorial.season_desc"),
    },
    {
      key: "gestures",
      icon: "gesture-tap",
      title: t("tutorial.gestures_title"),
      gestures: [
        {
          icon: "gesture-swipe-left",
          title: t("tutorial.gesture_swipe_left_title"),
          desc: t("tutorial.gesture_swipe_left_desc"),
        },
        {
          icon: "gesture-swipe-right",
          title: t("tutorial.gesture_swipe_right_title"),
          desc: t("tutorial.gesture_swipe_right_desc"),
        },
        {
          icon: "gesture-tap-hold",
          title: t("tutorial.gesture_long_press_title"),
          desc: t("tutorial.gesture_long_press_desc"),
        },
      ],
    },
  ];

  const isLast = index === slides.length - 1;

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(i, slides.length - 1));
    listRef.current?.scrollToOffset({ offset: clamped * width, animated: true });
    setIndex(clamped);
  };

  const handleNext = () => {
    if (isLast) dismiss();
    else goTo(index + 1);
  };

  const renderSlide = ({ item }: ListRenderItemInfo<Slide>) => (
    <View style={[styles.slide, { width }]}>
      {item.gestures ? (
        <ScrollView
          style={styles.gestureScroll}
          contentContainerStyle={styles.gestureScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="headlineSmall" style={[styles.title, { color: palette.onSurface }]}>
            {item.title}
          </Text>
          <MockItemCard />
          {item.gestures.map((g) => (
            <View key={g.icon} style={styles.gestureRow}>
              <View style={[styles.gestureIcon, { backgroundColor: palette.surfaceVariant }]}>
                <Icon source={g.icon} size={34} color={palette.primary} />
              </View>
              <View style={styles.gestureText}>
                <Text variant="titleMedium" style={{ color: palette.onSurface }}>
                  {g.title}
                </Text>
                <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
                  {g.desc}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <>
          <View style={[styles.iconCircle, { backgroundColor: palette.surfaceVariant }]}>
            {item.icons ? (
              <View style={styles.iconCluster}>
                {item.icons.map((ic, i) => (
                  <Icon
                    key={ic}
                    source={ic}
                    size={i === 1 ? 48 : 36}
                    color={i === 1 ? palette.primary : palette.onSurfaceVariant}
                  />
                ))}
              </View>
            ) : (
              <Icon source={item.icon} size={72} color={palette.primary} />
            )}
          </View>
          <Text variant="headlineSmall" style={[styles.title, { color: palette.onSurface }]}>
            {item.title}
          </Text>
          <Text variant="bodyLarge" style={[styles.desc, { color: palette.onSurfaceVariant }]}>
            {item.desc}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Portal>
      <View
        style={[
          styles.overlay,
          {
            backgroundColor: palette.background,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.topBar}>
          <Button mode="text" onPress={dismiss} textColor={palette.onSurfaceVariant}>
            {t("tutorial.skip")}
          </Button>
        </View>

        <FlatList
          ref={listRef}
          data={slides}
          keyExtractor={(s) => s.key}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
        />

        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.dot,
                { backgroundColor: i === index ? palette.primary : palette.divider },
              ]}
            />
          ))}
        </View>

        <View style={styles.bottomBar}>
          <Button
            mode="text"
            disabled={index === 0}
            onPress={() => goTo(index - 1)}
            textColor={palette.onSurfaceVariant}
          >
            {t("tutorial.back")}
          </Button>
          <Button mode="contained" onPress={handleNext}>
            {isLast ? t("tutorial.done") : t("tutorial.next")}
          </Button>
        </View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  topBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 8, minHeight: 48 },
  slide: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
  },
  iconCluster: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  title: { textAlign: "center", fontWeight: "bold", marginBottom: 12 },
  desc: { textAlign: "center", lineHeight: 24 },
  gestureScroll: { alignSelf: "stretch" },
  gestureScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  mockStage: {
    position: "relative",
    width: "100%",
    maxWidth: 420,
    height: 68,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 20,
    marginBottom: 4,
  },
  mockAction: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: MOCK_ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
  mockActionLeft: { left: 0 },
  mockActionRight: { right: 0 },
  mockCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  mockCardText: { flex: 1, marginHorizontal: 12 },
  gestureRow: { flexDirection: "row", alignItems: "center", marginTop: 22, width: "100%", maxWidth: 420 },
  gestureIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  gestureText: { flex: 1 },
  dots: { flexDirection: "row", justifyContent: "center", paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
