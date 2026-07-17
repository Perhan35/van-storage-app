import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { Location } from "../../db/database";
import { LocationIconPicker } from "../LocationIconPicker";
import { DEFAULT_LOCATION_ICON } from "../../db/templates";

type Props = {
  location: Location | null;
  onCancel: () => void;
  onSave: (locationId: string, name: string, icon: string) => void;
};

export function RenameLocationDialog({ location, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_LOCATION_ICON);
  const nameSelection = useTextSelectionFix();

  useEffect(() => {
    if (location) {
      setName(location.name);
      setIcon(location.icon);
      nameSelection.resetSelection();
    }
  }, [location]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !location) return;
    onSave(location.id, trimmed, icon);
  };

  return (
    <Portal>
      <Dialog visible={!!location} onDismiss={onCancel}>
        <Dialog.Title>{t("location.edit_title")}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode="outlined"
            label={t("location.name")}
            value={name}
            onChangeText={setName}
            selection={nameSelection.selection}
            onSelectionChange={nameSelection.onSelectionChange}
            style={styles.input}
          />
          <LocationIconPicker value={icon} onChange={setIcon} />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button onPress={handleSave}>{t("zone.save")}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
});
