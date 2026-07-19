import React, { useState } from "react";
import { Platform, View, StyleSheet, Pressable } from "react-native";
import { Button, TextInput, IconButton, Dialog, Portal } from "react-native-paper";
import type { TextInputSelectionChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import DateTimePicker, {
  DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import i18n from "../i18n";
import { formatExpiration } from "../utils/date";

type Props = {
  expirationDate: string | null;
  reminderDaysText: string;
  onChangeExpirationDate: (iso: string | null) => void;
  onChangeReminderDaysText: (text: string) => void;
  reminderDaysSelection?: { start: number; end: number };
  onReminderDaysSelectionChange?: (e: TextInputSelectionChangeEvent) => void;
};

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function ExpirationField({
  expirationDate,
  reminderDaysText,
  onChangeExpirationDate,
  onChangeReminderDaysText,
  reminderDaysSelection,
  onReminderDaysSelectionChange,
}: Props) {
  const { t } = useTranslation();
  const [pickerVisible, setPickerVisible] = useState(false);
  // On iOS the picker lives inside a modal dialog, so the selection is held
  // here until the user confirms with "Done" rather than committed on every
  // spin of the wheel.
  const [draftDate, setDraftDate] = useState<Date | null>(null);

  const openPicker = () => {
    setDraftDate(expirationDate ? parseIso(expirationDate) : new Date());
    setPickerVisible(true);
  };

  // Android renders a native dialog and fires this once the user confirms.
  const handleAndroidChange = (
    _event: DateTimePickerChangeEvent,
    date: Date,
  ) => {
    setPickerVisible(false);
    onChangeExpirationDate(toIso(date));
  };

  const handleIosChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    setDraftDate(date);
  };

  const confirmIos = () => {
    if (draftDate) onChangeExpirationDate(toIso(draftDate));
    setPickerVisible(false);
  };

  const dismissPicker = () => {
    setPickerVisible(false);
  };

  const buttonLabel = expirationDate
    ? formatExpiration(expirationDate, i18n.language)
    : t("zone.add_expiration");

  return (
    <View style={styles.container}>
      <View style={styles.dateRow}>
        <View style={styles.dateButtonWrapper}>
          <Button mode="outlined" icon="calendar" style={styles.dateButton}>
            {buttonLabel}
          </Button>
          {Platform.OS === "web" &&
            // Invisible native <input type="date"> stacked over the Paper
            // Button so the browser's own date picker opens on tap, while
            // the visible control still matches the native button styling.
            React.createElement("input", {
              type: "date",
              value: expirationDate ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChangeExpirationDate(e.target.value || null),
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: "100%",
                height: "100%",
                opacity: 0,
                cursor: "pointer",
                border: "none",
              },
            })}
          {Platform.OS !== "web" && (
            <Pressable
              style={StyleSheet.absoluteFill}
              android_ripple={{ color: "rgba(0,0,0,0.12)" }}
              onPress={openPicker}
            />
          )}
        </View>
        {!!expirationDate && (
          <IconButton
            icon="close"
            onPress={() => onChangeExpirationDate(null)}
          />
        )}
      </View>

      {/* Android shows the OS date dialog directly; iOS would render inline
          (pushing the layout down), so it's wrapped in a Paper Dialog to
          present as a proper modal overlay instead. */}
      {Platform.OS === "android" && pickerVisible && (
        <DateTimePicker
          value={expirationDate ? parseIso(expirationDate) : new Date()}
          mode="date"
          onValueChange={handleAndroidChange}
          onDismiss={dismissPicker}
        />
      )}
      {Platform.OS === "ios" && (
        <Portal>
          <Dialog visible={pickerVisible} onDismiss={dismissPicker}>
            <Dialog.Title>{t("zone.pick_expiration")}</Dialog.Title>
            <Dialog.Content>
              <View style={styles.iosPicker}>
                <DateTimePicker
                  value={draftDate ?? new Date()}
                  mode="date"
                  display="inline"
                  onValueChange={handleIosChange}
                />
              </View>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={dismissPicker}>
                {t("zone.expiration_cancel")}
              </Button>
              <Button onPress={confirmIos}>
                {t("zone.expiration_confirm")}
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      )}

      {!!expirationDate && (
        <TextInput
          mode="outlined"
          label={t("zone.reminder_days")}
          value={reminderDaysText}
          onChangeText={onChangeReminderDaysText}
          selection={reminderDaysSelection}
          onSelectionChange={onReminderDaysSelectionChange}
          keyboardType="numeric"
          style={styles.reminderInput}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  dateRow: { flexDirection: "row", alignItems: "center" },
  dateButtonWrapper: { flex: 1, position: "relative" },
  dateButton: { width: "100%" },
  iosPicker: { alignItems: "center" },
  reminderInput: { marginTop: 12 },
});
