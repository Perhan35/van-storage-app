import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button, SegmentedButtons, Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { KitSeason, WantedItem } from "../../db/database";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { useAppTheme } from "../../theme/useAppTheme";

type Props = {
  visible: boolean;
  // null = noting a new thing; otherwise the wanted item being edited.
  item: WantedItem | null;
  // Pre-selected season for a new item: the kit the user is looking at.
  defaultSeason: KitSeason;
  onCancel: () => void;
  onSave: (name: string, season: KitSeason, notes: string) => void;
  onDelete?: (item: WantedItem) => void;
};

export function WantedItemDialog({
  visible,
  item,
  defaultSeason,
  onCancel,
  onSave,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [season, setSeason] = useState<KitSeason>(defaultSeason);
  const nameSelection = useTextSelectionFix();
  const notesSelection = useTextSelectionFix();

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? "");
    setNotes(item?.notes ?? "");
    setSeason(item?.season ?? defaultSeason);
    nameSelection.resetSelection();
    notesSelection.resetSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item, defaultSeason]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, season, notes.trim());
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title>{item ? t("kit.wanted_edit_title") : t("kit.wanted_new_title")}</Dialog.Title>
        <Dialog.Content>
          {!item && (
            <Text variant="bodyMedium" style={[styles.hint, { color: palette.onSurfaceVariant }]}>
              {t("kit.wanted_hint")}
            </Text>
          )}
          <TextInput
            mode="outlined"
            label={t("zone.name")}
            value={name}
            onChangeText={setName}
            selection={nameSelection.selection}
            onSelectionChange={nameSelection.onSelectionChange}
            autoFocus={!item}
            style={styles.input}
          />
          <Text variant="bodyMedium" style={[styles.label, { color: palette.onSurfaceVariant }]}>
            {t("kit.wanted_season")}
          </Text>
          <SegmentedButtons
            value={season}
            onValueChange={(v) => setSeason(v as KitSeason)}
            style={styles.input}
            buttons={[
              { value: "winter", icon: "snowflake", label: t("season.winter") },
              { value: "summer", icon: "weather-sunny", label: t("season.summer") },
            ]}
          />
          <TextInput
            mode="outlined"
            label={t("zone.notes")}
            value={notes}
            onChangeText={setNotes}
            selection={notesSelection.selection}
            onSelectionChange={notesSelection.onSelectionChange}
            multiline
            style={styles.input}
          />
        </Dialog.Content>
        <Dialog.Actions>
          {item && onDelete && (
            <Button textColor={palette.danger} onPress={() => onDelete(item)} style={styles.delete}>
              {t("zone.delete")}
            </Button>
          )}
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button onPress={handleSave} disabled={!name.trim()}>
            {item ? t("zone.save") : t("kit.add")}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 16 },
  label: { marginBottom: 8 },
  input: { marginBottom: 12 },
  // Pushes Delete to the far left, away from the Save button.
  delete: { marginRight: "auto" },
});
