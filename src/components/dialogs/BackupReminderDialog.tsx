import React, { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button, Dialog, Portal, Text } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import { useAppTheme } from "../../theme/useAppTheme";
import { runBackupExport } from "../../utils/backup";

// Offered at launch when data has gone a week without being exported (see
// checkBackupReminder). Three ways out: postpone a day, export right now, or
// turn the reminder off for good.
export function BackupReminderDialog() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const visible = useAppStore((s) => s.backupReminderVisible);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const snooze = useAppStore((s) => s.snoozeBackupReminder);
  const dismiss = useAppStore((s) => s.dismissBackupReminder);
  const recordBackupDone = useAppStore((s) => s.recordBackupDone);
  const setBackupRemindersEnabled = useAppStore((s) => s.setBackupRemindersEnabled);
  const [exporting, setExporting] = useState(false);

  const handleBackupNow = async () => {
    setExporting(true);
    const result = await runBackupExport();
    setExporting(false);
    if (!result.ok) {
      Alert.alert(t("settings.error"), t("settings.export_error") + " " + result.error);
      return;
    }
    await recordBackupDone();
    if (!result.shared) {
      Alert.alert(t("settings.export_success_title"), t("settings.export_success"));
    }
  };

  const handleNeverRemind = async () => {
    dismiss();
    await setBackupRemindersEnabled(false);
    Alert.alert(t("backup.reminder_off_title"), t("backup.reminder_off_text"));
  };

  const daysSince = lastBackupAt
    ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <Portal>
      {/* Not dismissible by tapping outside: the three actions each mean
          something different, and an accidental tap shouldn't stand in for
          "remind me tomorrow". */}
      <Dialog visible={visible} dismissable={false}>
        <Dialog.Icon icon="cloud-upload-outline" />
        <Dialog.Title style={styles.title}>{t("backup.reminder_title")}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">
            {daysSince === null
              ? t("backup.reminder_body_never")
              : t("backup.reminder_body", { count: daysSince })}
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.hint, { color: palette.onSurfaceVariant }]}
          >
            {t("backup.reminder_hint")}
          </Text>
          {/* Stacked, and kept in Dialog.Content rather than Dialog.Actions:
              three labelled actions don't fit side by side on a phone, and
              Actions lays its children out in a row. */}
          <View style={styles.actions}>
            <Button
              mode="contained"
              icon="cloud-upload-outline"
              loading={exporting}
              disabled={exporting}
              onPress={handleBackupNow}
            >
              {t("backup.reminder_now")}
            </Button>
            <Button mode="outlined" disabled={exporting} onPress={snooze}>
              {t("backup.reminder_tomorrow")}
            </Button>
            <Button
              mode="text"
              textColor={palette.onSurfaceVariant}
              disabled={exporting}
              onPress={handleNeverRemind}
            >
              {t("backup.reminder_never")}
            </Button>
          </View>
        </Dialog.Content>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  title: { textAlign: "center" },
  hint: { marginTop: 12 },
  actions: { marginTop: 24, gap: 8 },
});
