import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button, SegmentedButtons } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Item, Season } from "../../db/database";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { ExpirationField } from "../ExpirationField";

type Props = {
  item: Item | null;
  onCancel: () => void;
  onSave: (
    name: string,
    notes: string,
    season: Season,
    expirationDate: string | null,
    reminderDays: number
  ) => void;
};

export function EditItemDialog({ item, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [season, setSeason] = useState<Season>("none");
  const [expirationDate, setExpirationDate] = useState<string | null>(null);
  const [reminderDaysText, setReminderDaysText] = useState("7");
  const nameSelection = useTextSelectionFix();
  const notesSelection = useTextSelectionFix();
  const reminderDaysSelection = useTextSelectionFix();

  useEffect(() => {
    if (item) {
      setName(item.name);
      setNotes(item.notes);
      setSeason(item.season);
      setExpirationDate(item.expiration_date);
      setReminderDaysText(String(item.reminder_days));
      nameSelection.resetSelection();
      notesSelection.resetSelection();
      reminderDaysSelection.resetSelection();
    }
  }, [item]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const reminderDays = Math.max(1, parseInt(reminderDaysText, 10) || 7);
    onSave(trimmed, notes.trim(), season, expirationDate, reminderDays);
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
          <ExpirationField
            expirationDate={expirationDate}
            reminderDaysText={reminderDaysText}
            onChangeExpirationDate={setExpirationDate}
            onChangeReminderDaysText={setReminderDaysText}
            reminderDaysSelection={reminderDaysSelection.selection}
            onReminderDaysSelectionChange={reminderDaysSelection.onSelectionChange}
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
