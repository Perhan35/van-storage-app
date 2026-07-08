import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Dialog, Portal, TextInput, Button, Text } from "react-native-paper";
import Slider from "@react-native-community/slider";
import { useTranslation } from "react-i18next";
import { Zone } from "../../db/database";
import { DEFAULT_FILL_OPACITY } from "../../db/repository";
import { ColorPickerField } from "../ColorPickerField";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";

type Props = {
  zone: Zone | null;
  visible: boolean;
  onCancel: () => void;
  onSave: (name: string, color: string, fillOpacity: number) => void;
  onDelete: () => void;
};

export function EditZoneDialog({
  zone,
  visible,
  onCancel,
  onSave,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4A90D9");
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_FILL_OPACITY);
  const nameSelection = useTextSelectionFix();

  useEffect(() => {
    if (zone && visible) {
      setName(zone.name);
      setColor(zone.color);
      setFillOpacity(zone.fill_opacity ?? DEFAULT_FILL_OPACITY);
      nameSelection.resetSelection();
    }
  }, [zone, visible]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, color, fillOpacity);
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title>{t("zone.edit_zone")}</Dialog.Title>
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
          <ColorPickerField
            value={color}
            onChange={setColor}
            label={t("zone.color_hex")}
          />
          <View style={styles.opacityRow}>
            <Text variant="bodySmall" style={styles.opacityLabel}>
              {t("zone.opacity")} : {Math.round(fillOpacity * 100)}%
            </Text>
            <Slider
              minimumValue={0.1}
              maximumValue={1}
              step={0.05}
              value={fillOpacity}
              onValueChange={setFillOpacity}
              minimumTrackTintColor={color}
            />
            <View style={styles.opacityHintRow}>
              <Text variant="labelSmall" style={styles.opacityHint}>
                {t("zone.opacity_hint_light")}
              </Text>
              <Text variant="labelSmall" style={styles.opacityHint}>
                {t("zone.opacity_hint_solid")}
              </Text>
            </View>
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button textColor="#D32F2F" onPress={onDelete}>
            {t("zone.delete")}
          </Button>
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
  opacityRow: { marginTop: 16 },
  opacityLabel: { color: "#666", marginBottom: 6 },
  opacityHintRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  opacityHint: { color: "#999" },
});
