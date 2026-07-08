import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import { Dialog, Portal, Text, List, Button, IconButton, Divider } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { listSeasonalItems } from "../../db/repository";
import { Item } from "../../db/database";
import { SeasonMode, useAppStore } from "../../store/useAppStore";
import { useAppTheme } from "../../theme/useAppTheme";
import { seasonIconName, seasonIconColor } from "../seasonIcon";

type SeasonalItem = Item & { zone_name: string };

type Props = {
  visible: boolean;
  season: SeasonMode;
  onDismiss: () => void;
};

export function SeasonChangeoverDialog({ visible, season, onDismiss }: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const setItemOutOfVan = useAppStore((s) => s.setItemOutOfVan);
  const [items, setItems] = useState<SeasonalItem[]>([]);

  const load = useCallback(async () => {
    const data = await listSeasonalItems();
    setItems(data);
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, season, load]);

  const opposite: SeasonMode = season === "summer" ? "winter" : "summer";

  const toRemove = useMemo(
    () => items.filter((i) => i.season === opposite && !i.out_of_van),
    [items, opposite]
  );
  const toAdd = useMemo(
    () => items.filter((i) => i.season === season && i.out_of_van),
    [items, season]
  );

  const handleApply = async (item: SeasonalItem, outOfVan: boolean) => {
    await setItemOutOfVan(item.id, outOfVan);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, out_of_van: outOfVan ? 1 : 0 } : i))
    );
  };

  const renderRow = (item: SeasonalItem, action: "remove" | "add") => {
    const seasonIcon = seasonIconName(item.season);
    return (
      <List.Item
        key={item.id}
        title={item.name}
        description={`📍 ${item.zone_name}`}
        left={(props) =>
          seasonIcon ? (
            <List.Icon {...props} icon={seasonIcon} color={seasonIconColor(item.season)} />
          ) : null
        }
        right={(props) => (
          <IconButton
            {...props}
            icon={action === "remove" ? "exit-to-app" : "tray-arrow-down"}
            accessibilityLabel={action === "remove" ? t("zone.take_out") : t("zone.put_back")}
            onPress={() => handleApply(item, action === "remove")}
          />
        )}
      />
    );
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{t("changeover.title", { season: t(`season.${season}`) })}</Dialog.Title>
        <Dialog.ScrollArea style={{ maxHeight: Math.min(420, windowHeight * 0.6) }}>
          <ScrollView style={styles.scrollView}>
            {toRemove.length === 0 && toAdd.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text variant="bodyMedium" style={{ color: palette.onSurfaceVariant }}>
                  {t("changeover.nothing")}
                </Text>
              </View>
            ) : (
              <>
                {toRemove.length > 0 && (
                  <>
                    <Text variant="labelLarge" style={[styles.sectionTitle, { color: palette.onSurfaceVariant }]}>
                      {t("changeover.to_remove")}
                    </Text>
                    {toRemove.map((item) => renderRow(item, "remove"))}
                    <Divider />
                  </>
                )}
                {toAdd.length > 0 && (
                  <>
                    <Text variant="labelLarge" style={[styles.sectionTitle, { color: palette.onSurfaceVariant }]}>
                      {t("changeover.to_add")}
                    </Text>
                    {toAdd.map((item) => renderRow(item, "add"))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t("changeover.close")}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  scrollView: { flexGrow: 0 },
  sectionTitle: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  emptyContainer: { padding: 32, alignItems: "center" },
});
