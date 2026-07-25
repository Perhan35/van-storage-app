import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Dialog, Portal, List, Text, Button, IconButton } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { listItemsWithExpiration, clearItemExpiration, ItemWithExpiration } from "../../db/repository";
import { ExpirationStatus, getExpirationStatus } from "../../utils/expiration";
import { formatExpiration } from "../../utils/date";
import { expirationIconName, expirationIconColor } from "../expirationIcon";
import { useAppTheme } from "../../theme/useAppTheme";

type Props = {
  visible: boolean;
  categories: ExpirationStatus[];
  title: string;
  onDismiss: () => void;
};

const CATEGORY_ORDER: ExpirationStatus[] = ["expired", "soon", "ok"];

export function ExpirationOverviewDialog({ visible, categories, title, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const { palette } = useAppTheme();
  const router = useRouter();
  const [items, setItems] = useState<ItemWithExpiration[]>([]);

  useEffect(() => {
    if (visible) {
      listItemsWithExpiration().then(setItems);
    }
  }, [visible]);

  const handleAcknowledge = async (item: ItemWithExpiration) => {
    await clearItemExpiration(item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  const categoryLabel = (status: ExpirationStatus) => {
    if (status === "expired") return t("expiration.cat_expired");
    if (status === "soon") return t("expiration.cat_soon");
    return t("expiration.cat_ok");
  };

  // Query already returns items ordered by expiration_date ascending, so the
  // most urgent item within each category stays first after filtering.
  // Memoized: this calls getExpirationStatus up to items.length × 3 times,
  // and previously reran on every render of this dialog (including renders
  // from unrelated parent state while it's open), not just when `items` or
  // `categories` actually changed. Both call sites pass an inline array
  // literal for `categories`, so the dep is its joined content rather than
  // the array reference — otherwise this would still recompute every render.
  const categoriesKey = categories.join(",");
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.filter((status) => categories.includes(status))
        .map((status) => ({
          status,
          items: items.filter(
            (item) => getExpirationStatus(item.expiration_date as string, item.reminder_days) === status
          ),
        }))
        .filter((group) => group.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- categoriesKey stands in for categories
    [items, categoriesKey]
  );

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView>
            {groups.length === 0 ? (
              <Text style={[styles.empty, { color: palette.onSurfaceVariant }]}>
                {t("expiration.empty")}
              </Text>
            ) : (
              groups.map((group) => (
                <View key={group.status}>
                  <Text
                    variant="labelLarge"
                    style={[styles.categoryHeader, { color: expirationIconColor(group.status, palette) }]}
                  >
                    {categoryLabel(group.status)}
                  </Text>
                  {group.items.map((item) => (
                    <List.Item
                      key={item.id}
                      title={item.name}
                      description={`${item.location_name} • ${item.zone_name} • ${formatExpiration(
                        item.expiration_date as string,
                        i18n.language
                      )}`}
                      left={(props) => (
                        <List.Icon
                          {...props}
                          icon={expirationIconName(group.status)}
                          color={expirationIconColor(group.status, palette)}
                        />
                      )}
                      right={(props) => (
                        <IconButton
                          {...props}
                          icon="check"
                          accessibilityLabel={t("expiration.acknowledge")}
                          onPress={() => handleAcknowledge(item)}
                        />
                      )}
                      onPress={() => {
                        onDismiss();
                        router.push(`/zone/${item.zone_id}?highlightItemId=${item.id}`);
                      }}
                    />
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t("expiration.close")}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  scrollArea: { maxHeight: 480 },
  categoryHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontWeight: "700" },
  empty: { padding: 24, textAlign: "center" },
});
