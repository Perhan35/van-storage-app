import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Dialog, Portal, TextInput, Button, SegmentedButtons, List } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { Season, ZoneWithCount } from "../../db/database";
import { useTextSelectionFix } from "../../hooks/useTextSelectionFix";
import { ExpirationField } from "../ExpirationField";

type Props = {
  visible: boolean;
  zones: ZoneWithCount[];
  zoneId: string;
  zoneLocked?: boolean;
  onCancel: () => void;
  onSave: (
    name: string,
    notes: string,
    season: Season,
    zoneId: string,
    expirationDate: string | null,
    reminderDays: number
  ) => void;
};

export function AddItemDialog({ visible, zones, zoneId, zoneLocked = false, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [season, setSeason] = useState<Season>("none");
  const [selectedZoneId, setSelectedZoneId] = useState(zoneId);
  const [zonePickerVisible, setZonePickerVisible] = useState(false);
  const [expirationDate, setExpirationDate] = useState<string | null>(null);
  const [reminderDaysText, setReminderDaysText] = useState("7");
  const nameSelection = useTextSelectionFix();
  const notesSelection = useTextSelectionFix();

  useEffect(() => {
    if (visible) {
      setName("");
      setNotes("");
      setSeason("none");
      setSelectedZoneId(zoneId);
      setExpirationDate(null);
      setReminderDaysText("7");
      nameSelection.resetSelection();
      notesSelection.resetSelection();
    }
  }, [visible, zoneId]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !selectedZoneId) return;
    const reminderDays = Math.max(1, parseInt(reminderDaysText, 10) || 7);
    onSave(trimmed, notes.trim(), season, selectedZoneId, expirationDate, reminderDays);
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  return (
    <>
      <Portal>
        <Dialog visible={visible} onDismiss={onCancel}>
          <Dialog.Title>{t("zone.new_item")}</Dialog.Title>
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
            {zoneLocked ? (
              <TextInput
                mode="outlined"
                label={t("nav.zone")}
                value={selectedZone?.name ?? ""}
                editable={false}
                style={styles.input}
              />
            ) : (
              <Pressable onPress={() => setZonePickerVisible(true)}>
                <TextInput
                  mode="outlined"
                  label={t("nav.zone")}
                  value={selectedZone?.name ?? ""}
                  editable={false}
                  pointerEvents="none"
                  right={<TextInput.Icon icon="menu-down" />}
                  style={styles.input}
                />
              </Pressable>
            )}
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
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={onCancel}>{t("map.cancel")}</Button>
            <Button onPress={handleSave} disabled={!name.trim() || !selectedZoneId}>
              {t("zone.save")}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {!zoneLocked && (
        <Portal>
          <Dialog visible={zonePickerVisible} onDismiss={() => setZonePickerVisible(false)}>
            <Dialog.Title>{t("nav.zone")}</Dialog.Title>
            <Dialog.ScrollArea style={styles.scrollArea}>
              <ScrollView>
                {zones.map((zone) => (
                  <List.Item
                    key={zone.id}
                    title={zone.name}
                    style={{ backgroundColor: zone.color + "33" }}
                    onPress={() => {
                      setSelectedZoneId(zone.id);
                      setZonePickerVisible(false);
                    }}
                  />
                ))}
              </ScrollView>
            </Dialog.ScrollArea>
          </Dialog>
        </Portal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
  scrollArea: { maxHeight: 400 },
});
