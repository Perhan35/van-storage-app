import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, FlatList, StyleSheet } from "react-native";
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
import { useRouter } from "expo-router";
import { Searchbar, List, Divider, Text, IconButton } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";
import { searchItems } from "../src/db/repository";
import { Item } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";
import { seasonIconName, seasonIconColor } from "../src/components/seasonIcon";

type SearchResult = Item & { zone_name: string };

const SEARCH_DEBOUNCE_MS = 250;
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

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setItemChecked = useAppStore((s) => s.setItemChecked);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const swipeableRefs = useRef<Map<string, SwipeableMethods>>(new Map());

  // Debouncing collapses fast typing into one query instead of one per
  // keystroke (fewer overlapping in-flight calls), and the sequence guard
  // drops any response that's no longer the latest as the user keeps typing.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const runSearch = useCallback(async (text: string) => {
    const seq = ++searchSeq.current;
    let r: SearchResult[];
    try {
      r = await searchItems(text);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      console.warn("Search query failed:", err);
      setResults([]);
      setSearched(false);
      setSearchError(true);
      return;
    }
    if (seq !== searchSeq.current) return;
    setResults(r);
    setSearched(true);
    setSearchError(false);
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (text.trim().length === 0) {
        searchSeq.current++;
        setResults([]);
        setSearched(false);
        setSearchError(false);
        return;
      }

      debounceTimer.current = setTimeout(() => {
        runSearch(text.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [runSearch]
  );

  const handleItemPress = (item: SearchResult) => {
    setHighlightedZoneId(item.zone_id);
    router.dismissTo("/");
  };

  const handleToggleOutOfVan = async (item: SearchResult) => {
    swipeableRefs.current.get(item.id)?.close();
    const outOfVan = !item.out_of_van;
    await setItemOutOfVan(item.id, outOfVan);
    setResults((rs) =>
      rs.map((r) => (r.id === item.id ? { ...r, out_of_van: outOfVan ? 1 : 0 } : r))
    );
  };

  const handleToggleChecked = async (item: SearchResult) => {
    swipeableRefs.current.get(item.id)?.close();
    const checked = !item.checked;
    await setItemChecked(item.id, checked);
    setResults((rs) =>
      rs.map((r) => (r.id === item.id ? { ...r, checked: checked ? 1 : 0 } : r))
    );
  };

  const emptyTextStyle = { color: palette.onSurfaceVariant, textAlign: "center" as const };

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      <Searchbar
        placeholder={t("search.placeholder")}
        value={query}
        onChangeText={handleSearch}
        autoFocus
        style={styles.searchbar}
      />
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ReanimatedSwipeable
            ref={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref);
              else swipeableRefs.current.delete(item.id);
            }}
            overshootRight={false}
            onSwipeableOpen={(direction) => {
              // ReanimatedSwipeable's SwipeDirection is inverted relative to
              // the legacy Swipeable: LEFT means the row moved left,
              // revealing the *right* actions panel (out-of-van), and
              // RIGHT reveals the left actions panel (checked).
              if (direction === SwipeDirection.LEFT) handleToggleOutOfVan(item);
              else if (direction === SwipeDirection.RIGHT) handleToggleChecked(item);
            }}
            renderLeftActions={(_progress, translation) => (
              <SwipeActionButton
                translation={translation}
                side="left"
                backgroundColor={palette.primary}
                icon={item.checked ? "checkbox-blank-outline" : "check-bold"}
                onPress={() => handleToggleChecked(item)}
              />
            )}
            renderRightActions={(_progress, translation) => (
              <SwipeActionButton
                translation={translation}
                side="right"
                backgroundColor={palette.danger}
                icon={item.out_of_van ? "tray-arrow-down" : "exit-to-app"}
                onPress={() => handleToggleOutOfVan(item)}
              />
            )}
          >
            <List.Item
              title={item.name}
              description={
                item.out_of_van
                  ? `📍 ${item.zone_name} • ${t("search.out_of_van")}`
                  : `📍 ${item.zone_name}`
              }
              onPress={() => handleItemPress(item)}
              style={item.checked ? styles.checkedRow : undefined}
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
                      icon={item.out_of_van ? "exit-to-app" : "package-variant"}
                      color={item.out_of_van ? palette.danger : undefined}
                    />
                    {seasonIcon && (
                      <List.Icon {...props} icon={seasonIcon} color={seasonIconColor(item.season)} />
                    )}
                  </View>
                );
              }}
            />
          </ReanimatedSwipeable>
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          searchError ? (
            <View style={styles.emptyContainer}>
              <Text variant="bodyMedium" style={[emptyTextStyle, { color: palette.danger }]}>
                {t("search.error")}
              </Text>
            </View>
          ) : searched ? (
            <View style={styles.emptyContainer}>
              <Text variant="bodyMedium" style={emptyTextStyle}>
                {t("search.no_results", { query })}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text variant="bodyMedium" style={emptyTextStyle}>
                {t("search.empty")}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchbar: { margin: 12 },
  itemIcons: { flexDirection: "row" },
  emptyContainer: { padding: 32, alignItems: "center" },
  checkedRow: { opacity: 0.55 },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
});
