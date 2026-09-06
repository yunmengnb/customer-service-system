// 忆梦云团队开发
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yimeng.customer.service',
  appName: '忆梦云客服',
  webDir: 'src',
  server: {
    url: 'https://user.ymfk.top',
    cleartext: false,
    allowNavigation: ['user.ymfk.top'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    appendUserAgent: ' YMKF-Android/1.0.0',
  },
};

export default config;
