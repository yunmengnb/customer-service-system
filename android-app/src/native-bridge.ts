// 忆梦云团队开发
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface PushPayload {
  type: 'message';
  messageId?: string;
  conversationId: string;
  channelId?: string;
}

export interface YmkfNativePlugin {
  getPushClientId(): Promise<{ clientId: string }>;
  getLaunchNotification(): Promise<PushPayload | null>;
  setCurrentUser(options: { loggedIn: boolean }): Promise<void>;
  getAppState(): Promise<{ state: 'active' | 'background' }>;
}

export const YmkfNative = Capacitor.isNativePlatform()
  ? registerPlugin<YmkfNativePlugin>('YmkfNative')
  : null;
