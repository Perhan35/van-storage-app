import React, { useState } from "react";
import { Platform, View, StyleSheet, Pressable } from "react-native";
import { Button, TextInput, IconButton } from "react-native-paper";
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
}: Props) {
  const { t } = useTranslation();
  const [pickerVisible, setPickerVisible] = useState(false);

  const handleValueChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    setPickerVisible(false);
    onChangeExpirationDate(toIso(date));
  };

  const handleDismiss = () => {
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
              onPress={() => setPickerVisible(true)}
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
      {Platform.OS !== "web" && pickerVisible && (
        <DateTimePicker
          value={expirationDate ? parseIso(expirationDate) : new Date()}
          mode="date"
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
        />
      )}
      {!!expirationDate && (
        <TextInput
          mode="outlined"
          label={t("zone.reminder_days")}
          value={reminderDaysText}
          onChangeText={onChangeReminderDaysText}
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
  reminderInput: { marginTop: 12 },
});
