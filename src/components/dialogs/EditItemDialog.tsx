import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Item } from "../../db/database";

type Props = {
  item: Item | null;
  onCancel: () => void;
  onSave: (name: string, notes: string) => void;
};

export function EditItemDialog({ item, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (item) {
      setName(item.name);
      setNotes(item.notes);
    }
  }, [item]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, notes.trim());
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
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label={t("zone.notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            style={styles.input}
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
