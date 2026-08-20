import * as Haptics from 'expo-haptics';

let lastFeedbackAt = 0;

export function triggerHaptic(
  kind: 'light' | 'selection' | 'success' | 'warning' = 'light',
): void {
  const now = Date.now();
  if (now - lastFeedbackAt < 45) return;
  lastFeedbackAt = now;

  const feedback =
    kind === 'selection'
      ? Haptics.selectionAsync()
      : kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === 'warning'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void feedback.catch(() => undefined);
}
