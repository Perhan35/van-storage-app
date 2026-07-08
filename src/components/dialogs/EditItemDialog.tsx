import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button, SegmentedButtons } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Item, Season } from "../../db/database";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";

type Props = {
  item: Item | null;
  onCancel: () => void;
  onSave: (name: string, notes: string, season: Season) => void;
};

export function EditItemDialog({ item, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [season, setSeason] = useState<Season>("none");
  const nameSelection = useTextSelectionFix();
  const notesSelection = useTextSelectionFix();

  useEffect(() => {
    if (item) {
      setName(item.name);
      setNotes(item.notes);
      setSeason(item.season);
      nameSelection.resetSelection();
      notesSelection.resetSelection();
    }
  }, [item]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, notes.trim(), season);
  };

  return (
    <Portal>
      <Dialog visible={!!item} onDismiss={onCancel}>
        <Dialog.Title>{t("zone.edit_item")}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode="outlined"
            label={t("zone.name")}
            value={name}
            onChangeText={setName}
            selection={nameSelection.selection}
            onSelectionChange={nameSelection.onSelectionChange}
            style={styles.input}
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
          <SegmentedButtons
            value={season}
            onValueChange={(v) => setSeason(v as Season)}
            style={styles.input}
            buttons={[
              { value: "none", label: t("season.none") },
              { value: "summer", icon: "weather-sunny", accessibilityLabel: t("season.summer") },
              { value: "winter", icon: "snowflake", accessibilityLabel: t("season.winter") },
            ]}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button onPress={handleSave} disabled={!name.trim()}>
            {t("zone.save")}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
});
