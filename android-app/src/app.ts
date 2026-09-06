// 忆梦云团队开发
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const MESSAGE_LIST_PATH = '/m/messages';

export async function installAndroidBackHandler(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;

  await App.addListener('backButton', ({ canGoBack }) => {
    const { pathname } = window.location;

    if (/^\/m\/messages\/[^/]+$/.test(pathname)) {
      window.location.assign(MESSAGE_LIST_PATH);
      return;
    }

    if (canGoBack) {
      window.history.back();
      return;
    }

    void App.exitApp();
  });
}
