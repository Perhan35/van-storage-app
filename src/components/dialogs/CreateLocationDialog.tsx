import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button, SegmentedButtons } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { LAYOUT_TEMPLATES, getTemplate } from "../../db/templates";
import { LocationIconPicker } from "../LocationIconPicker";

type Props = {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string, templateId: string, icon: string) => void;
};

export function CreateLocationDialog({ visible, onCancel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(LAYOUT_TEMPLATES[0].id);
  const [icon, setIcon] = useState(LAYOUT_TEMPLATES[0].icon);
  const nameSelection = useTextSelectionFix();

  useEffect(() => {
    if (visible) {
      setName("");
      setTemplateId(LAYOUT_TEMPLATES[0].id);
      setIcon(LAYOUT_TEMPLATES[0].icon);
      nameSelection.resetSelection();
    }
  }, [visible]);

  // Picking a template suggests its default icon; the user can still change it.
  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    setIcon(getTemplate(id).icon);
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, templateId, icon);
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title>{t("location.create")}</Dialog.Title>
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
          <SegmentedButtons
            value={templateId}
            onValueChange={handleTemplateChange}
            buttons={LAYOUT_TEMPLATES.map((template) => ({
              value: template.id,
              icon: template.icon,
              label: t(template.nameKey),
            }))}
          />
          <LocationIconPicker value={icon} onChange={setIcon} />
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
