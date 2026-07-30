import { Platform } from "react-native";
import Constants from "expo-constants";
import { exportAllData } from "../db/repository";

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
export type BackupResult =
  | { ok: true; shared: boolean }
  | { ok: false; error: string };

export async function runBackupExport(): Promise<BackupResult> {
  try {
    const appVersion = Constants.expoConfig?.version ?? "";
    const data = JSON.stringify(await exportAllData(appVersion), null, 2);
    const filename = getBackupFilename();

    if (Platform.OS === "web") {
      downloadJsonWeb(data, filename);
      return { ok: true, shared: true };
    }

    const { File, Paths } = await import("expo-file-system");
    const Sharing = await import("expo-sharing");
    const file = new File(Paths.cache, filename);
    file.write(data);
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
