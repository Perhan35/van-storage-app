import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Item } from "../db/database";
import { formatExpiration } from "../utils/date";
import i18n from "../i18n";

// Expo Go (SDK 53+) dropped support for expo-notifications and logs warnings
// on every API call. Local scheduled notifications work fine in a real dev
// client or standalone build (what this app ships via EAS/CI), so only skip
// them here — everywhere else reminders still show visually in the app.
const isWeb = Platform.OS === "web";
const isExpoGo = Constants.appOwnership === "expo";
const notificationsUnavailable = isWeb || isExpoGo;

export function configureNotificationHandler(): void {
  if (notificationsUnavailable) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (notificationsUnavailable) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// 9:00 local time on (expiration date − reminder_days), or null if the item
// has no expiration date.
function reminderTriggerDate(item: Item): Date | null {
  if (!item.expiration_date) return null;
  const [y, m, d] = item.expiration_date.split("-").map(Number);
  const trigger = new Date(y, m - 1, d);
  trigger.setDate(trigger.getDate() - item.reminder_days);
  trigger.setHours(9, 0, 0, 0);
  return trigger;
}

export async function cancelItemReminder(itemId: string): Promise<void> {
  if (notificationsUnavailable) return;
  await Notifications.cancelScheduledNotificationAsync(itemId);
}

export async function scheduleItemReminder(item: Item): Promise<void> {
  if (notificationsUnavailable) return;
  await cancelItemReminder(item.id);
  const trigger = reminderTriggerDate(item);
  if (!trigger || trigger.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: item.id,
    content: {
      title: i18n.t("reminder.title"),
      body: i18n.t("reminder.body", {
        name: item.name,
        date: formatExpiration(item.expiration_date as string, i18n.language),
      }),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

// Resyncs every scheduled reminder from scratch. Item counts in this app are
// small, so a full cancel-and-reschedule pass is simpler than diffing.
export async function syncReminders(items: Item[]): Promise<void> {
  if (notificationsUnavailable) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const item of items) {
    if (item.expiration_date) await scheduleItemReminder(item);
  }
}

export async function cancelAllReminders(): Promise<void> {
  if (notificationsUnavailable) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
