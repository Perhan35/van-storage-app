import React, { useState, useCallback } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Searchbar, List, Divider, Text } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";
import { Item } from "../src/db/database";

type SearchResult = Item & { zone_name: string };

export default function SearchScreen() {
  const router = useRouter();
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
    // The highlight will auto-clear after a few seconds via the map screen
    setTimeout(() => setHighlightedZoneId(null), 4000);
  };

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Chercher un objet..."
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
            description={`📍 ${item.zone_name}`}
            onPress={() => handleItemPress(item)}
            left={(props) => <List.Icon {...props} icon="package-variant" />}
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          searched ? (
            <View style={styles.emptyContainer}>
              <Text variant="bodyMedium" style={styles.emptyText}>
                Aucun objet trouvé pour "{query}"
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text variant="bodyMedium" style={styles.emptyText}>
                Tapez le nom d'un objet pour le localiser dans le van
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  searchbar: { margin: 12 },
  emptyContainer: { padding: 32, alignItems: "center" },
  emptyText: { color: "#9E9E9E", textAlign: "center" },
});
