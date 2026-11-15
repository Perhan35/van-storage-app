import { Alert, Platform } from "react-native";
import Constants from "expo-constants";
import { exportAllData, ExportedData } from "../db/repository";
import i18n from "../i18n";

// The export routine, shared by the Settings screen and the backup reminder's
// "do it now" button so both produce the same file the same way.

export function getBackupFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `my-inventory-backup-${y}${m}${d}.json`;
}

function downloadJsonWeb(data: string, filename: string) {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// `shared` tells the caller whether the file left the app through the share
// sheet (where the user picks a remote destination) or was only written to the
// cache directory, which needs a "file saved" notice instead.
// `cancelled` means the user said no at the confirmation step: nothing was
// written, and it's neither a backup nor an error.
export type BackupResult =
  | { ok: true; shared: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

// "Export 3 locations, 12 zones and 240 items?" — counted from the very data
// about to be written, so the numbers always match the file. The wanted list
// is only mentioned once it holds something.
function confirmMessage(data: ExportedData): string {
  const t = i18n.t.bind(i18n);
  const counts = {
    locations: t("backup.count_locations", { count: data.locations.length }),
    zones: t("backup.count_zones", { count: data.zones.length }),
    items: t("backup.count_items", { count: data.items.length }),
  };
  const wanted = data.wantedItems?.length ?? 0;
  return wanted > 0
    ? t("backup.export_confirm_text_wanted", {
        ...counts,
        wanted: t("backup.count_wanted", { count: wanted }),
      })
    : t("backup.export_confirm_text", counts);
}

function askToConfirm(message: string): Promise<boolean> {
  // react-native-web's Alert.alert does nothing, so the browser's own dialog
  // stands in for it there.
  if (Platform.OS === "web") return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t("backup.export_confirm_title"),
      message,
      [
        { text: i18n.t("map.cancel"), style: "cancel", onPress: () => resolve(false) },
        { text: i18n.t("backup.export_confirm_btn"), onPress: () => resolve(true) },
      ],
      // Android: tapping outside the alert closes it without pressing a button.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

// `onConfirmed` fires once the user says yes, so callers can show their
// spinner for the export itself rather than behind the confirmation alert.
export async function runBackupExport(onConfirmed?: () => void): Promise<BackupResult> {
  try {
    const appVersion = Constants.expoConfig?.version ?? "";
    const exported = await exportAllData(appVersion);
    if (!(await askToConfirm(confirmMessage(exported)))) {
      return { ok: false, cancelled: true };
    }
    onConfirmed?.();
    const data = JSON.stringify(exported, null, 2);
    const filename = getBackupFilename();

    if (Platform.OS === "web") {
      downloadJsonWeb(data, filename);
      return { ok: true, shared: true };
    }

    const { File, Paths } = await import("expo-file-system");
    const Sharing = await import("expo-sharing");
    const file = new File(Paths.cache, filename);
    await file.write(data);
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: true, shared: false };
    }
    // The share sheet reports no distinction between "sent" and "dismissed",
    // so a completed sheet counts as a backup — the same assumption the export
    // button has always made.
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
    });
    return { ok: true, shared: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
