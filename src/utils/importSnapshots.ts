import { Platform } from "react-native";
import Constants from "expo-constants";
import { exportAllData, ExportedData } from "../db/repository";

// Safety copies of the device's data taken right before each import, so an
// import (which replaces everything) can be undone. Several are kept, newest
// first: after "import A, then import A again" the newest copy holds A, and
// the one before it still holds what the device had originally.
const MAX_SNAPSHOTS = 3;
const DIR_NAME = "import-snapshots";
const WEB_STORAGE_KEY = "importSnapshots";

export type ImportSnapshotInfo = { id: string; savedAt: string };

// File names are "<epoch ms>.json", so sorting by id sorts by age.
function idToSavedAt(id: string): string {
  return new Date(Number(id)).toISOString();
}

type WebEntry = { id: string; data: ExportedData };

function readWebEntries(): WebEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WEB_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function snapshotDir() {
  const { Directory, Paths } = await import("expo-file-system");
  // Documents, not cache: iOS may purge the cache directory at any time.
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) await dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function listNativeIds(): Promise<string[]> {
  const { File } = await import("expo-file-system");
  const dir = await snapshotDir();
  return dir
    .list()
    .filter((entry): entry is InstanceType<typeof File> => entry instanceof File)
    .map((f) => f.name.replace(/\.json$/, ""))
    .filter((id) => /^\d+$/.test(id))
    .sort((a, b) => Number(b) - Number(a));
}

// Returns the new snapshot's id. Throws on failure, so the caller can refuse
// to import without a safety copy.
export async function saveImportSnapshot(): Promise<string> {
  const data = await exportAllData(Constants.expoConfig?.version ?? "");
  const id = String(Date.now());

  if (Platform.OS === "web") {
    const entries = [{ id, data }, ...readWebEntries()].slice(0, MAX_SNAPSHOTS);
    try {
      localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage quota is small on web: fall back to keeping only this copy.
      localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(entries.slice(0, 1)));
    }
    return id;
  }

  const { File } = await import("expo-file-system");
  const dir = await snapshotDir();
  await new File(dir, `${id}.json`).write(JSON.stringify(data));
  const stale = (await listNativeIds()).slice(MAX_SNAPSHOTS);
  for (const oldId of stale) await new File(dir, `${oldId}.json`).delete();
  return id;
}

export async function getLatestImportSnapshotInfo(): Promise<ImportSnapshotInfo | null> {
  try {
    const id =
      Platform.OS === "web" ? readWebEntries()[0]?.id : (await listNativeIds())[0];
    return id ? { id, savedAt: idToSavedAt(id) } : null;
  } catch {
    return null;
  }
}

export async function readImportSnapshot(id: string): Promise<ExportedData> {
  if (Platform.OS === "web") {
    const entry = readWebEntries().find((e) => e.id === id);
    if (!entry) throw new Error("Snapshot not found");
    return entry.data;
  }
  const { File } = await import("expo-file-system");
  const dir = await snapshotDir();
  return JSON.parse(await new File(dir, `${id}.json`).text()) as ExportedData;
}

export async function deleteImportSnapshot(id: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(
      WEB_STORAGE_KEY,
      JSON.stringify(readWebEntries().filter((e) => e.id !== id))
    );
    return;
  }
  const { File } = await import("expo-file-system");
  const dir = await snapshotDir();
  const file = new File(dir, `${id}.json`);
  if (file.exists) await file.delete();
}
