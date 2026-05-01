import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import {
  Text,
  Button,
  Dialog,
  Portal,
} from "react-native-paper";
import ColorPicker, {
  Panel1,
  HueSlider,
  type ColorPickerRef,
} from "reanimated-color-picker";
import { useTranslation } from "react-i18next";
import { PRESET_COLORS } from "../utils/colors";
import { sanitizeHex } from "../utils/color";

type Props = {
  value: string;
  onChange: (color: string) => void;
  label?: string;
};

export function ColorPickerField({ value, onChange, label }: Props) {
  const { t } = useTranslation();
  const safeValue = sanitizeHex(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(safeValue);
  const pickerRef = useRef<ColorPickerRef>(null);

  useEffect(() => {
    if (open) setDraft(safeValue);
  }, [open, safeValue]);

  const handleSwatchPress = (color: string) => {
    setDraft(color);
    pickerRef.current?.setColor(color);
  };

  const handleConfirm = () => {
    onChange(draft);
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  return (
    <View>
      <Text variant="bodySmall" style={styles.label}>
        {label ?? t("map.color")}
      </Text>
      <Pressable onPress={() => setOpen(true)} style={styles.field}>
        <View style={[styles.fieldDot, { backgroundColor: safeValue }]} />
        <Text style={styles.fieldHex}>{safeValue.toUpperCase()}</Text>
        <Text style={styles.fieldChevron}>▾</Text>
      </Pressable>

      <Portal>
        <Dialog visible={open} onDismiss={handleCancel}>
          <Dialog.Title>{label ?? t("map.color")}</Dialog.Title>
          <Dialog.Content>
            <View style={styles.swatches}>
              {PRESET_COLORS.map((c) => {
                const selected = draft.toLowerCase() === c.toLowerCase();
                return (
                  <Pressable
                    key={c}
                    onPress={() => handleSwatchPress(c)}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: c,
                        borderWidth: selected ? 3 : 0,
                      },
                    ]}
                  />
                );
              })}
            </View>

            <ColorPicker
              ref={pickerRef}
              value={sanitizeHex(draft)}
              onChangeJS={(colors) => {
                if (colors.hex) setDraft(colors.hex);
              }}
              style={styles.picker}
            >
              <Panel1 style={styles.panel} />
              <HueSlider style={styles.slider} />
            </ColorPicker>

            <View style={styles.preview}>
              <View style={[styles.previewDot, { backgroundColor: sanitizeHex(draft) }]} />
              <Text style={styles.previewHex}>{sanitizeHex(draft).toUpperCase()}</Text>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={handleCancel}>{t("map.cancel")}</Button>
            <Button onPress={handleConfirm}>OK</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: "#666", marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 4,
    padding: 12,
  },
  fieldDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  fieldHex: { flex: 1, fontFamily: "monospace" },
  fieldChevron: { color: "#666" },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: "#333",
  },
  picker: { marginBottom: 12 },
  panel: { borderRadius: 8, marginBottom: 12 },
  slider: { borderRadius: 8 },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    gap: 8,
  },
  previewDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  previewHex: { fontFamily: "monospace", fontSize: 16 },
});
