import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const ALARM_CHANNEL_ID = 'busalarm-alarm';
export const STOP_ACTION_ID = 'stop-alarm';
export const ALARM_CATEGORY_ID = 'alarm-category';

// Controls how notifications behave while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
      name: 'Arrival alarm',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'alarm.wav',
      vibrationPattern: [0, 500, 250, 500, 250, 500, 250, 500],
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
      enableLights: true,
      lightColor: '#FF3B30',
    });
  }

  await Notifications.setNotificationCategoryAsync(ALARM_CATEGORY_ID, [
    {
      identifier: STOP_ACTION_ID,
      buttonTitle: 'Stop alarm',
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function presentArrivalNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "You've arrived",
      body: 'Tap to open BusAlarm and stop the alarm.',
      sound: 'alarm.wav',
      categoryIdentifier: ALARM_CATEGORY_ID,
      priority: Notifications.AndroidNotificationPriority.MAX,
      sticky: true,
      autoDismiss: false,
      data: { type: 'arrival-alarm' },
    },
    // On Android a `null` trigger posts to Expo's silent fallback channel;
    // naming our channel is what gives the notification its siren + vibration.
    trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
  });
}

export async function dismissArrivalNotifications(): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    presented
      // Match on several fields: on Android the `data` payload isn't always
      // round-tripped on presented notifications, so data.type alone missed it.
      .filter((n) => {
        const { content, trigger } = n.request;
        return (
          content.data?.type === 'arrival-alarm' ||
          content.title === "You've arrived" ||
          (trigger as { channelId?: string } | null)?.channelId === ALARM_CHANNEL_ID
        );
      })
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
  );
}
