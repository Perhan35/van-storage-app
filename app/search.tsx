import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Searchbar, List, Divider, Text } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";
import { searchItems } from "../src/db/repository";
import { Item } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";

type SearchResult = Item & { zone_name: string };

const SEARCH_DEBOUNCE_MS = 250;

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

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
    } catch {
      // expo-sqlite's web driver can occasionally fail a read with
      // "Error finalizing statement" (an upstream worker issue, not
      // something callers can prevent). One retry usually recovers it;
      // if it doesn't, fail quietly to an empty result rather than
      // leaving the screen stuck or throwing an unhandled rejection.
      try {
        r = await searchItems(text);
      } catch (err) {
        console.warn("Search query failed:", err);
        r = [];
      }
    }
    if (seq !== searchSeq.current) return;
    setResults(r);
    setSearched(true);
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (text.trim().length === 0) {
        searchSeq.current++;
        setResults([]);
        setSearched(false);
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
          <List.Item
            title={item.name}
            description={
              item.out_of_van
                ? `📍 ${item.zone_name} • ${t("search.out_of_van")}`
                : `📍 ${item.zone_name}`
            }
            onPress={() => handleItemPress(item)}
            left={(props) => (
              <List.Icon
                {...props}
                icon={item.out_of_van ? "exit-to-app" : "package-variant"}
                color={item.out_of_van ? palette.danger : undefined}
              />
            )}
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          searched ? (
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
  emptyContainer: { padding: 32, alignItems: "center" },
});
