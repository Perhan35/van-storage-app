import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { ColorPickerField } from "../ColorPickerField";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";

const DEFAULT_COLOR = "#4A90D9";

type Props = {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string, color: string) => void;
};

export function CreateZoneDialog({ visible, onCancel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const nameSelection = useTextSelectionFix();

  useEffect(() => {
    if (visible) {
      setName("");
      setColor(DEFAULT_COLOR);
      nameSelection.resetSelection();
    }
  }, [visible]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title>{t("map.new_zone")}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode="outlined"
            label={t("map.zone_name")}
            value={name}
            onChangeText={setName}
            selection={nameSelection.selection}
            onSelectionChange={nameSelection.onSelectionChange}
            style={styles.input}
          />
          <ColorPickerField
            value={color}
            onChange={setColor}
            label={t("map.color")}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button onPress={handleCreate}>{t("map.create")}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
});
