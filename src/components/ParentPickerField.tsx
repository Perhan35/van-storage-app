import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, List } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { ParentOption } from "../utils/itemTree";

type Props = {
  // Where the item can go, in tree order (see itemTree.parentOptions).
  options: ParentOption[];
  // null = straight in the zone.
  value: string | null;
  // The name of the current parent, in case it isn't among `options`.
  currentName?: string;
  onChange: (parentId: string | null) => void;
  style?: object;
};

const INDENT_PER_LEVEL = 20;

// "Dans :" field of the item forms: picks which item this one is stored in
// (Trousse de toilette), or none to keep it directly in the zone.
export function ParentPickerField({ options, value, currentName, onChange, style }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedName = value
    ? options.find((o) => o.id === value)?.name ?? currentName ?? ""
    : t("zone.parent_none");

  const pick = (parentId: string | null) => {
    onChange(parentId);
    setOpen(false);
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
        <TextInput
          mode="outlined"
          label={t("zone.parent_field")}
          value={selectedName}
          editable={false}
          pointerEvents="none"
          left={<TextInput.Icon icon="package-variant" />}
          right={<TextInput.Icon icon="menu-down" />}
          style={style}
        />
      </Pressable>
      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)}>
          <Dialog.Title>{t("zone.parent_field")}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              <ParentOptionList options={options} selectedId={value} onPick={pick} />
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
    </>
  );
}

// The rows themselves, shared with the zone screen's "Ranger dans…" dialog.
export function ParentOptionList({
  options,
  selectedId,
  onPick,
}: {
  options: ParentOption[];
  selectedId: string | null;
  onPick: (parentId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <List.Item
        title={t("zone.parent_none")}
        left={(props) => <List.Icon {...props} icon="shape-outline" />}
        right={(props) => (selectedId === null ? <List.Icon {...props} icon="check" /> : null)}
        onPress={() => onPick(null)}
      />
      {options.map((option) => (
        <List.Item
          key={option.id}
          title={option.name}
          style={{ paddingLeft: (option.depth - 1) * INDENT_PER_LEVEL }}
          left={(props) => <List.Icon {...props} icon="package-variant" />}
          right={(props) => (selectedId === option.id ? <List.Icon {...props} icon="check" /> : null)}
          onPress={() => onPick(option.id)}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  scrollArea: { maxHeight: 400 },
});
