import { create } from "zustand";
import {
  getDb,
  resetDbConnection,
  Zone,
  ZoneWithCount,
  Season,
  Location,
  LabelSide,
  LabelDef,
  LocationLabels,
} from "../db/database";
import { getPreference, setPreference } from "../db/preferences";
import * as repo from "../db/repository";
import { cancelAllReminders, requestNotificationPermissions, syncReminders } from "../notifications/reminders";
import { getTemplate, Outline } from "../db/templates";
import i18n from "../i18n";

export type ThemeMode = "auto" | "light" | "dark";
export type SeasonMode = "summer" | "winter";

// A frozen picture of where every zone sat at one moment, keyed by zone id.
// The undo/redo stacks are lists of these; restoring one writes each zone
// back to its recorded geometry.
type ZoneGeometrySnapshot = Record<string, Zone["geometry"]>;

// Cap the history so a long editing session can't grow it without bound.
const MAX_HISTORY = 50;

// Cap recent searches so the list stays a quick glance, not a full log.
const MAX_RECENT_SEARCHES = 8;

// How long data may go un-backed-up before the reminder is offered.
const BACKUP_REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

let highlightTimer: ReturnType<typeof setTimeout> | null = null;

// Bumped by every setActiveLocation call so an earlier, slower zone query can't
// overwrite a later switch's result (see setActiveLocation).
let activeLocationSeq = 0;

// The startup run currently in progress, so the recovery attempts (see
// retryInit) join it instead of stacking competing passes over the same tables.
let initRun: Promise<void> | null = null;

function snapshotGeometry(zones: ZoneWithCount[]): ZoneGeometrySnapshot {
  const snapshot: ZoneGeometrySnapshot = {};
  for (const zone of zones) snapshot[zone.id] = zone.geometry;
  return snapshot;
}

// True when two outlines describe the same polygon (same canvas size and the
// same points, curve control points included). Used to skip no-op outline
// writes so a drag that ends where it started doesn't record an empty
// undo step.
function outlinesEqual(a: Outline, b: Outline): boolean {
  return a.w === b.w && a.h === b.h && JSON.stringify(a.points) === JSON.stringify(b.points);
}

// Everything outline-edit can change about a location: the polygon, and where
// its inscriptions sit on it. The two share one history — they're edited in the
// same session, on the same drawing, so undo and "discard" have to treat them
// as one piece of work.
type PlanSnapshot = { outline: Outline; labels: LocationLabels };

const LABEL_SIDES: LabelSide[] = ["front", "rear", "left", "right"];

function planSnapshot(location: Location): PlanSnapshot {
  return { outline: location.outline, labels: location.labels ?? {} };
}

// Compares the fields a label carries rather than the objects, since an absent
// side and a blank one mean the same thing on the plan.
function labelsEqual(a: LocationLabels, b: LocationLabels): boolean {
  return LABEL_SIDES.every((side) => {
    const x = a[side] ?? {};
    const y = b[side] ?? {};
    return (
      (x.text ?? "") === (y.text ?? "") &&
      !!x.hidden === !!y.hidden &&
      (x.x ?? null) === (y.x ?? null) &&
      (x.y ?? null) === (y.y ?? null)
    );
  });
}

// Restores a plan snapshot. Each half is written only if it actually differs,
// so undoing a label drag doesn't rewrite the outline row (and vice versa).
async function applyPlanSnapshot(
  locationId: string,
  target: PlanSnapshot,
  current: PlanSnapshot | null
) {
  if (!current || !outlinesEqual(current.outline, target.outline)) {
    await repo.updateLocationOutline(locationId, target.outline);
  }
  if (!current || !labelsEqual(current.labels, target.labels)) {
    await repo.updateLocationLabels(locationId, target.labels);
  }
}

// Write each zone in `snapshot` back to its recorded geometry, skipping zones
// that already match (avoids needless writes) or that no longer exist.
async function applyGeometrySnapshot(
  snapshot: ZoneGeometrySnapshot,
  zones: ZoneWithCount[]
) {
  for (const zone of zones) {
    const target = snapshot[zone.id];
    if (!target) continue;
    const g = zone.geometry;
    if (g.x === target.x && g.y === target.y && g.w === target.w && g.h === target.h) {
      continue;
    }
    await repo.updateZoneGeometry(zone.id, target);
  }
}

type AppState = {
  zones: ZoneWithCount[];
  highlightedZoneId: string | null;
  initialized: boolean;
  initError: string | null;
  editMode: boolean;
  // Layout-edit history: geometry snapshots taken *before* each move/resize.
  // Only meaningful while editMode is on; cleared whenever the set of zones
  // changes structurally (add/delete/split) so the snapshots always line up
  // with the zones that currently exist.
  undoStack: ZoneGeometrySnapshot[];
  redoStack: ZoneGeometrySnapshot[];
  // Geometry as it was the moment edit mode was entered, so "cancel all
  // changes" has a fixed target to restore to regardless of how many
  // undo/redo steps happened in between.
  editSessionSnapshot: ZoneGeometrySnapshot | null;
  themeMode: ThemeMode;
  seasonMode: SeasonMode;
  showMenuHeader: boolean;
  remindersEnabled: boolean;
  backupRemindersEnabled: boolean;
  // When the last export completed (ISO), null if this install never exported.
  lastBackupAt: string | null;
  // Whether the "time to back up" modal is on screen. Decided once per launch
  // by checkBackupReminder.
  backupReminderVisible: boolean;
  expirationAlertShown: boolean;
  tutorialVisible: boolean;
  recentSearches: string[];
  locations: Location[];
  activeLocationId: string | null;
  // Whether the map screen is showing the all-locations overview (true) or a
  // single location's map (false). Lives in the store so the header (a separate
  // component in the Stack config) can hide location-only actions while it's up.
  overviewMode: boolean;
  // Sub-mode of editMode: swaps the canvas from moving/resizing zones to
  // editing the location's outline polygon (add/move/delete a vertex).
  outlineEditMode: boolean;
  // Outline-edit history, kept separate from the zone undo/redo stacks so the
  // two sub-modes each have their own undo. Each entry is a full plan snapshot
  // (outline + inscriptions) taken *before* a change; meaningful only while
  // outlineEditMode is on for the active location.
  outlineUndoStack: PlanSnapshot[];
  outlineRedoStack: PlanSnapshot[];
  // The active location's plan the moment outline-edit was entered, so "cancel"
  // can restore it regardless of how many edits happened in between.
  outlineEditSessionSnapshot: PlanSnapshot | null;
  // Which "discard your changes?" confirmation is on screen, null for none.
  // Lives in the store because the two ways of asking to leave — the header's
  // ✕ and the Android back button — sit in different components, and both must
  // land on the same prompt.
  discardPrompt: "session" | "outline" | null;

  init: () => Promise<void>;
  // Restarts a startup that failed or never came back (see the action).
  retryInit: () => Promise<void>;
  reloadLocations: () => Promise<void>;
  setOverviewMode: (overview: boolean) => void;
  setActiveLocation: (locationId: string) => Promise<void>;
  addLocation: (name: string, templateId: string, icon: string) => Promise<string>;
  renameLocation: (locationId: string, name: string, icon: string) => Promise<void>;
  deleteLocation: (locationId: string) => Promise<void>;
  updateLocationOutline: (locationId: string, outline: Outline) => Promise<void>;
  updateLocationLabel: (
    locationId: string,
    side: LabelSide,
    patch: Partial<LabelDef>
  ) => Promise<void>;
  resetLocationLabel: (locationId: string, side: LabelSide) => Promise<void>;
  toggleOutlineEditMode: () => void;
  enterOutlineEditMode: () => void;
  undoOutline: () => Promise<void>;
  redoOutline: () => Promise<void>;
  cancelOutlineEdit: () => Promise<void>;
  showTutorial: () => void;
  dismissTutorial: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  reloadThemeMode: () => Promise<void>;
  setShowMenuHeader: (show: boolean) => Promise<void>;
  reloadShowMenuHeader: () => Promise<void>;
  setSeasonMode: (mode: SeasonMode) => Promise<void>;
  reloadSeasonMode: () => Promise<void>;
  setRemindersEnabled: (enabled: boolean) => Promise<boolean>;
  reloadRemindersEnabled: () => Promise<void>;
  setBackupRemindersEnabled: (enabled: boolean) => Promise<void>;
  reloadBackupSettings: () => Promise<void>;
  checkBackupReminder: () => Promise<void>;
  snoozeBackupReminder: () => Promise<void>;
  dismissBackupReminder: () => void;
  recordBackupDone: () => Promise<void>;
  setExpirationAlertShown: (shown: boolean) => void;
  addRecentSearch: (query: string) => Promise<void>;
  removeRecentSearch: (query: string) => Promise<void>;
  reloadRecentSearches: () => Promise<void>;
  syncRemindersIfEnabled: () => Promise<void>;
  loadZones: () => Promise<void>;
  addItem: (
    name: string,
    zoneId: string,
    notes?: string,
    season?: Season,
    expirationDate?: string | null,
    reminderDays?: number
  ) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  updateItem: (
    itemId: string,
    name: string,
    notes: string,
    season: Season,
    expirationDate: string | null,
    reminderDays: number
  ) => Promise<void>;
  moveItem: (itemId: string, newZoneId: string) => Promise<void>;
  setItemOutOfVan: (itemId: string, outOfVan: boolean) => Promise<void>;
  setItemChecked: (itemId: string, checked: boolean) => Promise<void>;
  resetChecklist: (zoneId: string) => Promise<void>;
  setHighlightedZoneId: (zoneId: string | null) => void;
  updateZone: (
    zoneId: string,
    name: string,
    color: string,
    fillOpacity: number,
    checklist: boolean
  ) => Promise<void>;
  deleteZone: (zoneId: string) => Promise<void>;
  addZone: (
    name: string,
    color: string,
    geometry: Zone["geometry"],
    checklist?: boolean
  ) => Promise<void>;
  splitZone: (zoneId: string) => Promise<string | undefined>;
  toggleEditMode: () => void;
  updateZoneGeometry: (zoneId: string, geometry: Zone["geometry"]) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  cancelEditChanges: () => Promise<void>;
  requestDiscard: () => void;
  dismissDiscard: () => void;
  confirmDiscard: () => Promise<void>;
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useAppStore = create<AppState>((set, get) => ({
  zones: [],
  highlightedZoneId: null,
  initialized: false,
  initError: null,
  editMode: false,
  undoStack: [],
  redoStack: [],
  editSessionSnapshot: null,
  discardPrompt: null,
  themeMode: "auto",
  seasonMode: "summer",
  showMenuHeader: true,
  remindersEnabled: false,
  backupRemindersEnabled: true,
  lastBackupAt: null,
  backupReminderVisible: false,
  expirationAlertShown: false,
  tutorialVisible: false,
  recentSearches: [],
  locations: [],
  activeLocationId: null,
  overviewMode: false,
  outlineEditMode: false,
  outlineUndoStack: [],
  outlineRedoStack: [],
  outlineEditSessionSnapshot: null,

  init: async () => {
    if (get().initialized) return;
    // Called on mount and again by every recovery attempt (focus, foreground,
    // pull-to-refresh): join the pass already running rather than starting a
    // competing one.
    if (initRun) return initRun;
    const run = (async () => {
      set({ initError: null });
      try {
        await getDb();
        await get().reloadThemeMode();
        await get().reloadShowMenuHeader();
        await get().reloadSeasonMode();
        await get().reloadRemindersEnabled();
        await get().reloadBackupSettings();
        await get().reloadRecentSearches();
        await get().reloadLocations();

        // The backup reminder measures "how long has it been" from the last
        // export — an install that never exported has nothing to measure from,
        // so first launch is recorded as the starting point.
        if (!(await getPreference("firstLaunchAt"))) {
          await setPreference("firstLaunchAt", new Date().toISOString());
        }

        // Resolve which location is active: the persisted preference if it
        // still exists, otherwise the first location (e.g. right after the
        // one-time migration created the default "Van" location).
        const locations = get().locations;
        const storedId = await getPreference("activeLocationId");
        const resolvedId =
          (storedId && locations.some((l) => l.id === storedId) ? storedId : null) ??
          locations[0]?.id ??
          null;
        set({ activeLocationId: resolvedId });
        if (resolvedId && resolvedId !== storedId) {
          await setPreference("activeLocationId", resolvedId);
        }

        // Start on the all-locations overview, unless there's exactly one
        // location — then land directly inside it (no reason to show a one-tile
        // overview). Migrated single-"Van" installs therefore behave as before.
        set({ overviewMode: locations.length !== 1 });

        await get().loadZones();
        // First launch: no "tutorialShown" preference yet → surface the guided
        // tour. Dismissing it records the preference so it never auto-opens again.
        const tutorialShown = await getPreference("tutorialShown");
        set({ initialized: true, tutorialVisible: tutorialShown !== "yes" });
      } catch (err) {
        set({ initError: err instanceof Error ? err.message : String(err) });
      }
    })();
    initRun = run;
    // Only clears its own registration: a retry that gave up on this run has
    // already replaced it, and must not be unregistered by the run it replaced.
    run.finally(() => {
      if (initRun === run) initRun = null;
    });
    return run;
  },

  // Startup that never finished — an error, or a pass still hanging on a
  // database call that will never come back — used to mean a blank main screen
  // for the life of the process, since nothing ever asked again. This is the
  // way back: throw away whatever the last attempt was waiting on and start a
  // clean one. Safe to call at any time; it's a no-op once startup succeeded.
  retryInit: async () => {
    if (get().initialized) return;
    resetDbConnection();
    initRun = null;
    await get().init();
  },

  reloadLocations: async () => {
    const locations = await repo.listLocations();
    set({ locations });
  },

  setOverviewMode: (overview) => set({ overviewMode: overview }),

  setActiveLocation: async (locationId) => {
    // Fetch the new location's zones *before* switching. Committing the id
    // first would render one frame of the new outline against the previous
    // location's zones (they only arrive when the query resolves) — the map
    // visibly flashed the old layout before snapping to the right one.
    const seq = ++activeLocationSeq;
    const zones = await repo.listZonesWithCounts(locationId);
    // A newer switch started while this query was in flight (fast taps in the
    // overview): its result is the one that must win, so drop this one.
    if (seq !== activeLocationSeq) return;
    // Location, its zones and leaving the overview land in a single render, so
    // the first frame of the new map is already the correct one.
    set({ activeLocationId: locationId, zones, overviewMode: false });
    await setPreference("activeLocationId", locationId);
  },

  addLocation: async (name, templateId, icon) => {
    const template = getTemplate(templateId);
    const id = generateId();
    await repo.insertLocation(id, name, template.outline, icon);
    await repo.instantiateTemplate(id, template);
    await get().reloadLocations();
    await get().setActiveLocation(id);
    return id;
  },

  renameLocation: async (locationId, name, icon) => {
    await repo.updateLocation(locationId, name, icon);
    await get().reloadLocations();
  },

  deleteLocation: async (locationId) => {
    const { locations, activeLocationId } = get();
    // Never delete the last remaining location — there must always be
    // somewhere for zones/items to live.
    if (locations.length <= 1) return;
    await repo.deleteLocation(locationId);
    await get().reloadLocations();
    if (activeLocationId === locationId) {
      const next = get().locations[0];
      if (next) await get().setActiveLocation(next.id);
    }
  },

  updateLocationOutline: async (locationId, outline) => {
    const loc = get().locations.find((l) => l.id === locationId);
    // A drag that ends where it started (or a discrete edit that changes
    // nothing) is a no-op — don't write it or push an empty undo step.
    if (loc && outlinesEqual(loc.outline, outline)) return;
    await repo.updateLocationOutline(locationId, outline);
    // While editing the outline, record how the plan stood *before* this change
    // so it can be undone (mirrors updateZoneGeometry for zones). Edits made
    // outside outline-edit mode don't feed the history.
    set((s) =>
      s.outlineEditMode && loc
        ? {
            outlineUndoStack: [...s.outlineUndoStack, planSnapshot(loc)].slice(-MAX_HISTORY),
            outlineRedoStack: [],
          }
        : {}
    );
    await get().reloadLocations();
  },

  updateLocationLabel: async (locationId, side, patch) => {
    const loc = get().locations.find((l) => l.id === locationId);
    if (!loc) return;
    // Merge the patch onto the existing side so a drag ({x,y}) keeps the text
    // and a rename keeps a dragged position.
    const prev = loc.labels?.[side] ?? {};
    const merged = { ...prev, ...patch };
    const text = merged.text?.trim() ?? "";
    const hasPos = merged.x != null && merged.y != null;
    const next = { ...(loc.labels ?? {}) };
    // A side carries information if it has custom text, is hidden, OR sits at a
    // custom (dragged) position. Only when none of these hold is it dropped so
    // front/rear fall back to their default and left/right disappear.
    if (!text && !merged.hidden && !hasPos) {
      delete next[side];
    } else {
      next[side] = {
        ...(text ? { text } : {}),
        ...(merged.hidden ? { hidden: true } : {}),
        ...(hasPos ? { x: Math.round(merged.x!), y: Math.round(merged.y!) } : {}),
      };
    }
    // A rename that changes nothing, or a drag that lands where it started,
    // shouldn't cost an undo step.
    if (labelsEqual(loc.labels ?? {}, next)) return;
    const before = planSnapshot(loc);
    await repo.updateLocationLabels(locationId, next);
    // Inscriptions are only editable inside outline-edit, and they're part of
    // the same drawing as the outline — so they go on the same history, and
    // "discard" puts them back too.
    set((s) =>
      s.outlineEditMode
        ? {
            outlineUndoStack: [...s.outlineUndoStack, before].slice(-MAX_HISTORY),
            outlineRedoStack: [],
          }
        : {}
    );
    await get().reloadLocations();
  },

  resetLocationLabel: async (locationId, side) => {
    const loc = get().locations.find((l) => l.id === locationId);
    if (!loc?.labels?.[side]) return;
    // Full clear: text, hidden and any custom position all go, returning the
    // side to its default text at its default anchor.
    const next = { ...loc.labels };
    delete next[side];
    const before = planSnapshot(loc);
    await repo.updateLocationLabels(locationId, next);
    set((s) =>
      s.outlineEditMode
        ? {
            outlineUndoStack: [...s.outlineUndoStack, before].slice(-MAX_HISTORY),
            outlineRedoStack: [],
          }
        : {}
    );
    await get().reloadLocations();
  },

  showTutorial: () => set({ tutorialVisible: true }),

  dismissTutorial: async () => {
    set({ tutorialVisible: false });
    await setPreference("tutorialShown", "yes");
  },

  setThemeMode: async (mode) => {
    set({ themeMode: mode });
    await setPreference("themeMode", mode);
  },

  // Reads the persisted themeMode into in-memory state without writing back
  // to the DB. Used on startup and after an import (whose row is already in
  // the DB) so the UI reflects the stored/restored theme.
  reloadThemeMode: async () => {
    const storedMode = await getPreference("themeMode");
    if (storedMode === "auto" || storedMode === "light" || storedMode === "dark") {
      set({ themeMode: storedMode });
    }
  },

  setShowMenuHeader: async (show) => {
    set({ showMenuHeader: show });
    await setPreference("showMenuHeader", show ? "on" : "off");
  },

  // Mirrors reloadThemeMode. Absence of a stored preference means "on" (the
  // default), so only an explicit "off" flips it.
  reloadShowMenuHeader: async () => {
    const stored = await getPreference("showMenuHeader");
    set({ showMenuHeader: stored !== "off" });
  },

  setSeasonMode: async (mode) => {
    set({ seasonMode: mode });
    await setPreference("seasonMode", mode);
  },

  // Mirrors reloadThemeMode: reads the persisted seasonMode into in-memory
  // state without writing back, for startup and post-import refresh.
  reloadSeasonMode: async () => {
    const storedMode = await getPreference("seasonMode");
    if (storedMode === "summer" || storedMode === "winter") {
      set({ seasonMode: storedMode });
    }
  },

  setRemindersEnabled: async (enabled) => {
    if (!enabled) {
      set({ remindersEnabled: false });
      await setPreference("remindersEnabled", "off");
      await cancelAllReminders();
      return true;
    }
    const granted = await requestNotificationPermissions();
    set({ remindersEnabled: granted });
    await setPreference("remindersEnabled", granted ? "on" : "off");
    if (granted) await get().syncRemindersIfEnabled();
    return granted;
  },

  // Mirrors reloadThemeMode: reads the persisted preference into in-memory
  // state without writing back, for startup and post-import refresh.
  reloadRemindersEnabled: async () => {
    const stored = await getPreference("remindersEnabled");
    set({ remindersEnabled: stored === "on" });
  },

  setBackupRemindersEnabled: async (enabled) => {
    set({ backupRemindersEnabled: enabled });
    await setPreference("backupRemindersEnabled", enabled ? "on" : "off");
  },

  // Mirrors reloadThemeMode for the backup section: absence of a stored
  // preference means "on" (reminders are opt-out), so only an explicit "off"
  // disables them.
  reloadBackupSettings: async () => {
    const [stored, lastBackupAt] = await Promise.all([
      getPreference("backupRemindersEnabled"),
      getPreference("lastBackupAt"),
    ]);
    set({ backupRemindersEnabled: stored !== "off", lastBackupAt });
  },

  // Decides once per launch whether to prompt for a backup. All three of the
  // conditions must hold: reminders on, nothing exported for a week, and data
  // that has actually moved since the last export — nagging about a backup
  // that would be byte-identical to the last one is just noise.
  checkBackupReminder: async () => {
    if (!get().backupRemindersEnabled) return;

    // "Remind me tomorrow" parks the prompt until the stored moment passes.
    const snoozedUntil = await getPreference("backupReminderSnoozeUntil");
    if (snoozedUntil && Date.now() < Date.parse(snoozedUntil)) return;

    // An install with no items has nothing worth losing yet.
    const { fingerprint, itemCount } = await repo.getDataFingerprint();
    if (itemCount === 0) return;
    if (fingerprint === (await getPreference("lastBackupFingerprint"))) return;

    const reference =
      (await getPreference("lastBackupAt")) ?? (await getPreference("firstLaunchAt"));
    const referenceMs = reference ? Date.parse(reference) : NaN;
    if (Number.isNaN(referenceMs)) return;
    if (Date.now() - referenceMs < BACKUP_REMINDER_DAYS * DAY_MS) return;

    set({ backupReminderVisible: true });
  },

  snoozeBackupReminder: async () => {
    set({ backupReminderVisible: false });
    await setPreference(
      "backupReminderSnoozeUntil",
      new Date(Date.now() + DAY_MS).toISOString()
    );
  },

  dismissBackupReminder: () => set({ backupReminderVisible: false }),

  // Records the data as safely exported: the moment, and the fingerprint it had
  // at that moment, so the reminder stays quiet until something actually
  // changes. Any pending snooze is cleared — it was about a backup that has
  // now happened.
  recordBackupDone: async () => {
    const now = new Date().toISOString();
    const { fingerprint } = await repo.getDataFingerprint();
    set({ lastBackupAt: now, backupReminderVisible: false });
    await setPreference("lastBackupAt", now);
    await setPreference("lastBackupFingerprint", fingerprint);
    await setPreference("backupReminderSnoozeUntil", "");
  },

  setExpirationAlertShown: (shown) => set({ expirationAlertShown: shown }),

  addRecentSearch: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const withoutDupes = get().recentSearches.filter(
      (s) => s.toLowerCase() !== trimmed.toLowerCase()
    );
    const next = [trimmed, ...withoutDupes].slice(0, MAX_RECENT_SEARCHES);
    set({ recentSearches: next });
    await setPreference("recentSearches", JSON.stringify(next));
  },

  removeRecentSearch: async (query) => {
    const next = get().recentSearches.filter(
      (s) => s.toLowerCase() !== query.toLowerCase()
    );
    set({ recentSearches: next });
    await setPreference("recentSearches", JSON.stringify(next));
  },

  // Mirrors reloadThemeMode: reads the persisted preference into in-memory
  // state without writing back, for startup. Guards against missing/malformed
  // stored data since it's free-form JSON rather than a fixed enum.
  reloadRecentSearches: async () => {
    const stored = await getPreference("recentSearches");
    try {
      const parsed = JSON.parse(stored ?? "[]");
      if (Array.isArray(parsed)) {
        set({ recentSearches: parsed.filter((s) => typeof s === "string") });
      }
    } catch {
      // Leave the default [] in place.
    }
  },

  syncRemindersIfEnabled: async () => {
    if (!get().remindersEnabled) return;
    const items = await repo.listAllItems();
    await syncReminders(items);
  },

  loadZones: async () => {
    const locationId = get().activeLocationId;
    if (!locationId) {
      set({ zones: [] });
      return;
    }
    const zones = await repo.listZonesWithCounts(locationId);
    set({ zones });
  },

  addItem: async (name, zoneId, notes = "", season = "none", expirationDate = null, reminderDays = 7) => {
    const id = generateId();
    await repo.insertItem(id, name, zoneId, notes, season, expirationDate, reminderDays);
    await get().loadZones();
    await get().syncRemindersIfEnabled();
  },

  deleteItem: async (itemId) => {
    await repo.deleteItem(itemId);
    await get().loadZones();
    await get().syncRemindersIfEnabled();
  },

  updateItem: async (itemId, name, notes, season, expirationDate, reminderDays) => {
    await repo.updateItem(itemId, name, notes, season, expirationDate, reminderDays);
    await get().loadZones();
    await get().syncRemindersIfEnabled();
  },

  moveItem: async (itemId, newZoneId) => {
    await repo.moveItem(itemId, newZoneId);
    await get().loadZones();
  },

  setItemOutOfVan: async (itemId, outOfVan) => {
    await repo.setItemOutOfVan(itemId, outOfVan);
    await get().loadZones();
  },

  setItemChecked: async (itemId, checked) => {
    await repo.setItemChecked(itemId, checked);
    await get().loadZones();
  },

  resetChecklist: async (zoneId) => {
    await repo.resetChecklistItems(zoneId);
    await get().loadZones();
  },

  setHighlightedZoneId: (zoneId) => {
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    set({ highlightedZoneId: zoneId });
    if (zoneId !== null) {
      highlightTimer = setTimeout(() => {
        highlightTimer = null;
        set({ highlightedZoneId: null });
      }, 6000);
    }
  },

  updateZone: async (zoneId, name, color, fillOpacity, checklist) => {
    await repo.updateZone(zoneId, name, color, fillOpacity, checklist);
    await get().loadZones();
  },

  deleteZone: async (zoneId) => {
    await repo.deleteZone(zoneId);
    // Structural change: past geometry snapshots no longer match the zone set.
    set({ undoStack: [], redoStack: [] });
    await get().loadZones();
  },

  addZone: async (name, color, geometry, checklist = false) => {
    const locationId = get().activeLocationId;
    if (!locationId) return;
    const id = generateId();
    await repo.insertZone(id, name, color, geometry, locationId, checklist);
    set({ undoStack: [], redoStack: [] });
    await get().loadZones();
  },

  splitZone: async (zoneId) => {
    const zone = get().zones.find((z) => z.id === zoneId);
    if (!zone) return undefined;

    const { x, y, w, h } = zone.geometry;
    const gap = 4;
    let geom1: Zone["geometry"], geom2: Zone["geometry"];
    let suffix1: string, suffix2: string;

    if (w >= h) {
      const halfW = (w - gap) / 2;
      geom1 = { type: "rect", x, y, w: halfW, h };
      geom2 = { type: "rect", x: x + halfW + gap, y, w: halfW, h };
      suffix1 = i18n.t("zone.split_suffix_left");
      suffix2 = i18n.t("zone.split_suffix_right");
    } else {
      const halfH = (h - gap) / 2;
      geom1 = { type: "rect", x, y, w, h: halfH };
      geom2 = { type: "rect", x, y: y + halfH + gap, w, h: halfH };
      suffix1 = i18n.t("zone.split_suffix_top");
      suffix2 = i18n.t("zone.split_suffix_bottom");
    }

    const id1 = generateId();
    const id2 = generateId();

    await repo.splitZoneInDb(zone, id1, id2, geom1, geom2, suffix1, suffix2);

    set({ undoStack: [], redoStack: [] });
    await get().loadZones();
    return id1;
  },

  // Toggling edit mode starts (or ends) a fresh editing session, so any
  // pending undo/redo history from before is dropped. Entering also records
  // a snapshot of the current geometry as the "cancel all changes" target.
  toggleEditMode: () =>
    set((s) => {
      const turningOn = !s.editMode;
      return {
        editMode: turningOn,
        outlineEditMode: false,
        undoStack: [],
        redoStack: [],
        editSessionSnapshot: turningOn ? snapshotGeometry(s.zones) : null,
        outlineUndoStack: [],
        outlineRedoStack: [],
        outlineEditSessionSnapshot: null,
      };
    }),

  // Entering outline-edit records the current outline as the "cancel" target
  // and starts a fresh history; leaving it (the "ok" path) keeps whatever edits
  // were committed and just clears the session state, returning to zone editing.
  toggleOutlineEditMode: () =>
    set((s) => {
      const turningOn = !s.outlineEditMode;
      const active = s.locations.find((l) => l.id === s.activeLocationId);
      return {
        outlineEditMode: turningOn,
        outlineUndoStack: [],
        outlineRedoStack: [],
        outlineEditSessionSnapshot: turningOn && active ? planSnapshot(active) : null,
      };
    }),

  // Enter outline editing directly from the map (long-press on a location),
  // spinning up a zone-edit session around it too so the usual "ok/cancel"
  // controls are present and zones stay safe while the outline is reshaped.
  enterOutlineEditMode: () =>
    set((s) => {
      const active = s.locations.find((l) => l.id === s.activeLocationId);
      return {
        editMode: true,
        editSessionSnapshot: snapshotGeometry(s.zones),
        undoStack: [],
        redoStack: [],
        outlineEditMode: true,
        outlineUndoStack: [],
        outlineRedoStack: [],
        outlineEditSessionSnapshot: active ? planSnapshot(active) : null,
      };
    }),

  undoOutline: async () => {
    const { outlineUndoStack, activeLocationId, locations } = get();
    if (outlineUndoStack.length === 0 || !activeLocationId) return;
    const loc = locations.find((l) => l.id === activeLocationId);
    const current = loc ? planSnapshot(loc) : null;
    const target = outlineUndoStack[outlineUndoStack.length - 1];
    await applyPlanSnapshot(activeLocationId, target, current);
    set((s) => ({
      outlineUndoStack: s.outlineUndoStack.slice(0, -1),
      outlineRedoStack: current
        ? [...s.outlineRedoStack, current].slice(-MAX_HISTORY)
        : s.outlineRedoStack,
    }));
    await get().reloadLocations();
  },

  redoOutline: async () => {
    const { outlineRedoStack, activeLocationId, locations } = get();
    if (outlineRedoStack.length === 0 || !activeLocationId) return;
    const loc = locations.find((l) => l.id === activeLocationId);
    const current = loc ? planSnapshot(loc) : null;
    const target = outlineRedoStack[outlineRedoStack.length - 1];
    await applyPlanSnapshot(activeLocationId, target, current);
    set((s) => ({
      outlineRedoStack: s.outlineRedoStack.slice(0, -1),
      outlineUndoStack: current
        ? [...s.outlineUndoStack, current].slice(-MAX_HISTORY)
        : s.outlineUndoStack,
    }));
    await get().reloadLocations();
  },

  // Discards every outline and inscription change made this session, restoring
  // the plan to how it looked when outline-edit was entered, then returns to
  // zone editing (editMode itself, and the zones, are left untouched).
  cancelOutlineEdit: async () => {
    const { outlineEditSessionSnapshot, activeLocationId, locations } = get();
    if (outlineEditSessionSnapshot && activeLocationId) {
      const loc = locations.find((l) => l.id === activeLocationId);
      await applyPlanSnapshot(
        activeLocationId,
        outlineEditSessionSnapshot,
        loc ? planSnapshot(loc) : null
      );
      await get().reloadLocations();
    }
    set({
      outlineEditMode: false,
      outlineUndoStack: [],
      outlineRedoStack: [],
      outlineEditSessionSnapshot: null,
    });
  },

  updateZoneGeometry: async (zoneId, geometry) => {
    const zones = get().zones;
    const prev = zones.find((z) => z.id === zoneId)?.geometry;
    // A drag/resize that ends exactly where it started (or snapped back) is a
    // no-op — don't record an empty step the user would have to undo twice.
    const unchanged =
      prev &&
      prev.x === geometry.x &&
      prev.y === geometry.y &&
      prev.w === geometry.w &&
      prev.h === geometry.h;
    if (unchanged) return;
    // Record where things stood *before* this move/resize, so it can be undone.
    const before = snapshotGeometry(zones);
    await repo.updateZoneGeometry(zoneId, geometry);
    set((s) => ({
      undoStack: [...s.undoStack, before].slice(-MAX_HISTORY),
      redoStack: [],
    }));
    await get().loadZones();
  },

  undo: async () => {
    const { undoStack, zones } = get();
    if (undoStack.length === 0) return;
    const target = undoStack[undoStack.length - 1];
    const current = snapshotGeometry(zones);
    await applyGeometrySnapshot(target, zones);
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current].slice(-MAX_HISTORY),
    }));
    await get().loadZones();
  },

  redo: async () => {
    const { redoStack, zones } = get();
    if (redoStack.length === 0) return;
    const target = redoStack[redoStack.length - 1];
    const current = snapshotGeometry(zones);
    await applyGeometrySnapshot(target, zones);
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, current].slice(-MAX_HISTORY),
    }));
    await get().loadZones();
  },

  // Discards every move/resize made this editing session, restoring zones to
  // how they sat when edit mode was entered, then leaves edit mode.
  cancelEditChanges: async () => {
    const { editSessionSnapshot, zones } = get();
    if (editSessionSnapshot) {
      await applyGeometrySnapshot(editSessionSnapshot, zones);
    }
    set({
      editMode: false,
      outlineEditMode: false,
      undoStack: [],
      redoStack: [],
      editSessionSnapshot: null,
      outlineUndoStack: [],
      outlineRedoStack: [],
      outlineEditSessionSnapshot: null,
      discardPrompt: null,
    });
    await get().loadZones();
  },

  // Asks to leave the current edit session — from the header's ✕ or from the
  // Android back button. Which session that is depends on the sub-mode: in
  // outline-edit only the outline is at stake, otherwise it's the whole
  // editing session.
  requestDiscard: () => {
    const { editMode, outlineEditMode, undoStack, outlineUndoStack } = get();
    if (!editMode) return;
    // The undo stacks are empty exactly while the current state still matches
    // the one the session started from — nothing to discard, nothing to ask,
    // so leaving is immediate.
    const hasChanges = (outlineEditMode ? outlineUndoStack : undoStack).length > 0;
    if (!hasChanges) {
      if (outlineEditMode) get().cancelOutlineEdit();
      else get().cancelEditChanges();
      return;
    }
    set({ discardPrompt: outlineEditMode ? "outline" : "session" });
  },

  dismissDiscard: () => set({ discardPrompt: null }),

  // Reads the prompt rather than the live sub-mode, so it discards exactly what
  // was asked about.
  confirmDiscard: async () => {
    const { discardPrompt } = get();
    set({ discardPrompt: null });
    if (discardPrompt === "outline") await get().cancelOutlineEdit();
    else if (discardPrompt === "session") await get().cancelEditChanges();
  },
}));
