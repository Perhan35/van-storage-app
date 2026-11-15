import * as Haptics from "expo-haptics";

export function triggerHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function triggerLightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function triggerSuccessHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
