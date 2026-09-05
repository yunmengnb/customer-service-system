// 忆梦云团队开发
import { Capacitor, registerPlugin } from '@capacitor/core'
import api from './api'

const NativePush = Capacitor.isNativePlatform() ? registerPlugin('YmkfNative') : null
let installed = false

function tokenExists() {
  return Boolean(sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token'))
}

function validPayload(payload) {
  return payload?.type === 'message' && /^[a-f\d]{24}$/i.test(String(payload.conversationId || ''))
}

export async function bindNativePushDevice() {
  if (!NativePush || !tokenExists()) return
  const { clientId } = await NativePush.getPushClientId()
  if (!clientId) return
  await api.post('/tenant/push-devices', {
    clientId,
    platform: 'android',
    appVersion: '1.1.0',
  })
  await NativePush.setCurrentUser({ loggedIn: true })
}

export async function unbindNativePushDevice() {
  if (!NativePush || !tokenExists()) return
  try {
    const { clientId } = await NativePush.getPushClientId()
    if (clientId) await api.delete('/tenant/push-devices/current', { data: { clientId } })
  } finally {
    await NativePush.setCurrentUser({ loggedIn: false })
  }
}

export async function installNativePushBridge(router) {
  if (!NativePush || installed) return
  installed = true

  const open = async payload => {
    if (!validPayload(payload)) return
    const target = `/m/messages/${payload.conversationId}`
    if (!tokenExists()) {
      await router.push({ path: '/login', query: { redirect: target } })
      return
    }
    await router.push(target)
  }

  await NativePush.addListener('pushClientIdChanged', () => {
    bindNativePushDevice().catch(() => {})
  })
  await NativePush.addListener('notificationOpened', open)
  const launchPayload = await NativePush.getLaunchNotification()
  if (launchPayload) await open(launchPayload)
  await bindNativePushDevice().catch(() => {})
}
