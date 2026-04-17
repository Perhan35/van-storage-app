import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Divider, IconButton, List, Text } from "react-native-paper";
import { useAppStore } from "../src/store/useAppStore";
import { Item } from "../src/db/database";
import { useTranslation } from "react-i18next";

type OutItem = Item & { zone_name: string };

export default function OutOfVanScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const getOutOfVanItems = useAppStore((s) => s.getOutOfVanItems);
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);
  const [items, setItems] = useState<OutItem[]>([]);

  const load = useCallback(async () => {
    const data = await getOutOfVanItems();
    setItems(data);
  }, [getOutOfVanItems]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handlePutBack = async (item: OutItem) => {
    await setItemOutOfVan(item.id, false);
    await load();
  };

  const handleLocate = (item: OutItem) => {
    setHighlightedZoneId(item.zone_id);
    router.replace("/");
    setTimeout(() => setHighlightedZoneId(null), 4000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="bodyMedium" style={styles.headerText}>
          {t(
            items.length === 1
              ? "out.currently_out_one"
              : "out.currently_out_other",
            { count: items.length }
          )}
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            description={`📍 ${item.zone_name}${item.notes ? ` • ${item.notes}` : ""}`}
            onPress={() => handleLocate(item)}
            left={(props) => (
              <List.Icon {...props} icon="exit-to-app" color="#E57373" />
            )}
            right={() => (
              <IconButton
                icon="tray-arrow-down"
                size={24}
                onPress={() => handlePutBack(item)}
              />
            )}
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text variant="bodyMedium" style={styles.emptyText}>
              {t("out.empty")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { padding: 16, backgroundColor: "#FFF3E0" },
  headerText: { color: "#E65100" },
  emptyContainer: { padding: 32, alignItems: "center" },
  emptyText: { color: "#9E9E9E", textAlign: "center" },
});
