import React, { useState, useCallback } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Searchbar, List, Divider, Text } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";
import { Item } from "../src/db/database";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../src/theme/useAppTheme";

type SearchResult = Item & { zone_name: string };

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const searchItems = useAppStore((s) => s.searchItems);
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(
    async (text: string) => {
      setQuery(text);
      if (text.trim().length === 0) {
        setResults([]);
        setSearched(false);
        return;
      }
      const r = await searchItems(text.trim());
      setResults(r);
      setSearched(true);
    },
    [searchItems]
  );

  const handleItemPress = (item: SearchResult) => {
    setHighlightedZoneId(item.zone_id);
    router.back();
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
