import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Dialog, Portal, TextInput, Button, Checkbox, HelperText } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { LabelSide, LabelDef } from "../../db/database";

type Props = {
  // The side being edited, or null when the dialog is closed.
  side: LabelSide | null;
  // The current custom text for this side ("" when none is set).
  currentText: string;
  // Built-in fallback for front/rear; null for left/right (no default).
  defaultText: string | null;
  hidden: boolean;
  onCancel: () => void;
  onSave: (side: LabelSide, def: LabelDef) => void;
  onReset: (side: LabelSide) => void;
};

export function EditInscriptionDialog({
  side,
  currentText,
  defaultText,
  hidden,
  onCancel,
  onSave,
  onReset,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const textSelection = useTextSelectionFix();

  useEffect(() => {
    if (side) {
      setText(currentText);
      setIsHidden(hidden);
      textSelection.resetSelection();
    }
  }, [side]);

  const hasDefault = defaultText !== null;
  // Reset is offered whenever the side carries anything to clear.
  const canReset = hasDefault || currentText.length > 0 || hidden;

  const handleSave = () => {
    if (!side) return;
    onSave(side, { text: text.trim(), hidden: isHidden });
  };

  const handleReset = () => {
    if (!side) return;
    onReset(side);
  };

  return (
    <Portal>
      <Dialog visible={!!side} onDismiss={onCancel}>
        <Dialog.Title>{t("map.edit_inscription")}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode="outlined"
            label={t("map.inscription_label")}
            value={text}
            placeholder={defaultText ?? undefined}
            onChangeText={setText}
            autoCapitalize="characters"
            selection={textSelection.selection}
            onSelectionChange={textSelection.onSelectionChange}
            style={styles.input}
          />
          {hasDefault && (
            <HelperText type="info" visible>
              {t("map.inscription_default", { value: defaultText })}
            </HelperText>
          )}
          {/* Available for every side, including left/right, so an inscription
              can be kept but temporarily hidden without losing its text. */}
          <Checkbox.Item
            label={t("map.inscription_hide")}
            status={isHidden ? "checked" : "unchecked"}
            onPress={() => setIsHidden((v) => !v)}
            style={styles.checkbox}
          />
        </Dialog.Content>
        <Dialog.Actions>
          {canReset && <Button onPress={handleReset}>{t("map.inscription_reset")}</Button>}
          <View style={styles.spacer} />
          <Button onPress={onCancel}>{t("map.cancel")}</Button>
          <Button onPress={handleSave}>{t("zone.save")}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 4 },
  checkbox: { paddingHorizontal: 0, marginTop: 4 },
  spacer: { flex: 1 },
});
