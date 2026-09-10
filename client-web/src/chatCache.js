// 忆梦云团队开发 - 浏览器聊天消息与媒体缓存
const DB_NAME = 'yimeng-chat-cache-v1'
const DB_VERSION = 1
const MEDIA_CACHE = 'yimeng-chat-media-v1'
const DAY = 24 * 60 * 60 * 1000
const MESSAGE_TTL = 30 * DAY
const ATTACHMENT_TTL = 2 * DAY
const IMAGE_LIMIT = 20 * 1024 * 1024
const AVATAR_LIMIT = 2 * 1024 * 1024
const MEDIA_LIMIT = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches ? 150 * 1024 * 1024 : 500 * 1024 * 1024
const INVALID_STATUSES = new Set(['expired', 'recalled', 'deleted'])
const cleanupTimers = new Map()
let dbPromise

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'key' })
        store.createIndex('scopeConversation', ['scope', 'conversationId'])
      }
      if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function withStore(names, mode, run) {
  try {
    const db = await openDb()
    if (!db) return null
    const transaction = db.transaction(names, mode)
    const result = await run(transaction)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return result
  } catch { return null }
}
function valueId(value) { return String(value?._id || value?.id || '') }
function mediaRequest(cacheKey) { return new Request(`${location.origin}/__yimeng_chat_cache__/${encodeURIComponent(cacheKey)}`) }
function attachmentExpiry(message, now) {
  return message.attachmentExpiredAt || message.expiresAt || new Date(new Date(message.createdAt || now).getTime() + ATTACHMENT_TTL).toISOString()
}

export function clientIdentityScope(customer = null) {
  const identityId = customer?.accountId || customer?.bindingId || customer?._id || customer?.id
  return identityId ? ['client', identityId].map(String).join(':') : ''
}
export function clientCacheScope(customer = null, channelId = '') {
  const identityScope = clientIdentityScope(customer)
  return identityScope ? `${identityScope}:${channelId || customer?.channelId || 'all'}` : ''
}
export async function cacheConversations(scope, conversations) {
  if (!scope || !Array.isArray(conversations)) return
  const now = Date.now()
  await withStore(['conversations'], 'readwrite', async tx => {
    const store = tx.objectStore('conversations')
    for (const data of conversations) {
      const id = valueId(data) || data.publicToken
      if (id) store.put({ key: `${scope}:${id}`, scope, conversationId: String(id), lastMessageAt: data.lastMessageAt || '', updatedAt: now, data })
    }
  })
}
export async function getCachedConversations(scope) {
  if (!scope) return []
  const rows = await withStore(['conversations'], 'readonly', tx => requestResult(tx.objectStore('conversations').getAll()))
  return (rows || []).filter(row => row.scope === scope).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt))).map(row => row.data)
}
export async function cacheMessages(scope, conversationId, messages) {
  if (!scope || !conversationId || !Array.isArray(messages)) return
  const now = Date.now()
  await withStore(['messages', 'syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    for (const data of messages.slice(-500)) {
      const id = valueId(data) || data.clientMessageId
      if (id && !String(id).startsWith('temp_')) store.put({ key: `${scope}:${id}`, scope, conversationId: String(conversationId), createdAt: data.createdAt || new Date(now).toISOString(), updatedAt: now, data })
    }
    const latest = messages[messages.length - 1]
    if (latest) tx.objectStore('syncState').put({ key: `${scope}:${conversationId}`, scope, conversationId: String(conversationId), lastSequence: latest.sequence ?? valueId(latest), syncedAt: now })
  })
  trimConversation(scope, conversationId)
}
export async function getCachedMessages(scope, conversationId) {
  if (!scope || !conversationId) return []
  const rows = await withStore(['messages'], 'readonly', tx => requestResult(tx.objectStore('messages').index('scopeConversation').getAll([scope, String(conversationId)])))
  return (rows || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-500).map(row => row.data)
}
async function trimConversation(scope, conversationId) {
  await withStore(['messages'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    const rows = await requestResult(store.index('scopeConversation').getAll([scope, String(conversationId)]))
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(500).forEach(row => store.delete(row.key))
  })
}
export async function removeCachedMessage(scope, messageId) {
  if (!scope || !messageId) return
  await withStore(['messages'], 'readwrite', tx => requestResult(tx.objectStore('messages').delete(`${scope}:${messageId}`)))
}
export async function loadCachedMedia(scope, message, thumbnail, loader) {
  const attachmentId = String(message?.attachmentId || '')
  if (!scope || !attachmentId || !('caches' in window)) return loader()
  if (INVALID_STATUSES.has(message.attachmentStatus)) {
    await invalidateAttachment(scope, attachmentId)
    return null
  }
  if (!thumbnail && message.messageType !== 'image') return loader()
  const variant = thumbnail ? 'thumbnail' : 'original'
  const cacheKey = `${scope}:${attachmentId}:${variant}`
  const request = mediaRequest(cacheKey)
  try {
    const cache = await caches.open(MEDIA_CACHE)
    const cached = await cache.match(request)
    if (cached) {
      touchAttachment(scope, attachmentId, cacheKey)
      return cached.blob()
    }
    const blob = await loader()
    if (!blob || (!thumbnail && blob.size > IMAGE_LIMIT)) return blob
    const estimate = await navigator.storage?.estimate?.().catch(() => ({})) || {}
    if (estimate.quota && estimate.quota - (estimate.usage || 0) <= blob.size * 2) {
      const shortfall = blob.size * 2 - (estimate.quota - (estimate.usage || 0))
      await cleanupChatCache(scope, true, shortfall)
      const refreshed = await navigator.storage?.estimate?.().catch(() => ({})) || {}
      if (refreshed.quota && refreshed.quota - (refreshed.usage || 0) <= blob.size) return blob
    }
    await ensureMediaSpace(scope, blob.size)
    await cache.put(request, new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }))
    const now = Date.now()
    await withStore(['attachments'], 'readwrite', tx => requestResult(tx.objectStore('attachments').put({ key: `${scope}:${attachmentId}:${variant}`, scope, attachmentId, status: message.attachmentStatus || 'active', expiresAt: attachmentExpiry(message, now), size: blob.size, cachedAt: now, lastAccessedAt: now, cacheKey })))
    return blob
  } catch { return loader() }
}
export async function loadCachedAvatar(scope, url, loader) {
  if (!scope || !url || !('caches' in window)) return loader()
  const attachmentId = `avatar:${url}`
  const cacheKey = `${scope}:${attachmentId}`
  const request = mediaRequest(cacheKey)
  let blob = null
  try {
    const cache = await caches.open(MEDIA_CACHE)
    const cached = await cache.match(request)
    if (cached) {
      touchAttachment(scope, attachmentId, cacheKey)
      return cached.blob()
    }
    blob = await loader()
    if (!blob || !String(blob.type || '').startsWith('image/') || blob.size > AVATAR_LIMIT) return blob
    const estimate = await navigator.storage?.estimate?.().catch(() => ({})) || {}
    if (estimate.quota && estimate.quota - (estimate.usage || 0) <= blob.size * 2) {
      const shortfall = blob.size * 2 - (estimate.quota - (estimate.usage || 0))
      await cleanupChatCache(scope, true, shortfall)
      const refreshed = await navigator.storage?.estimate?.().catch(() => ({})) || {}
      if (refreshed.quota && refreshed.quota - (refreshed.usage || 0) <= blob.size) return blob
    }
    await ensureMediaSpace(scope, blob.size)
    await cache.put(request, new Response(blob, { headers: { 'Content-Type': blob.type } }))
    const now = Date.now()
    await withStore(['attachments'], 'readwrite', tx => requestResult(tx.objectStore('attachments').put({ key: `${scope}:${attachmentId}`, scope, attachmentId, status: 'active', expiresAt: new Date(now + ATTACHMENT_TTL).toISOString(), size: blob.size, cachedAt: now, lastAccessedAt: now, cacheKey })))
    return blob
  } catch {
    return blob || loader()
  }
}
async function touchAttachment(scope, attachmentId, cacheKey) {
  await withStore(['attachments'], 'readwrite', async tx => {
    const store = tx.objectStore('attachments')
    for (const row of await requestResult(store.getAll())) if (row.scope === scope && row.attachmentId === attachmentId && row.cacheKey === cacheKey) store.put({ ...row, lastAccessedAt: Date.now() })
  })
}
export async function invalidateAttachment(scope, attachmentId, status = 'expired') {
  if (!scope || !attachmentId) return
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  const targets = rows.filter(row => row.scope === scope && String(row.attachmentId) === String(attachmentId))
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(targets.map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  await withStore(['attachments'], 'readwrite', tx => targets.forEach(row => tx.objectStore('attachments').delete(row.key)))
  await withStore(['messages'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    for (const row of await requestResult(store.getAll())) if (row.scope === scope && String(row.data?.attachmentId) === String(attachmentId)) store.put({ ...row, data: { ...row.data, attachmentStatus: status } })
  })
}
async function ensureMediaSpace(scope, incomingSize) {
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  const usage = rows.filter(row => row.scope === scope).reduce((sum, row) => sum + (row.size || 0), 0)
  if (usage + incomingSize > MEDIA_LIMIT) await cleanupChatCache(scope, true, usage + incomingSize - MEDIA_LIMIT)
}
export async function cleanupChatCache(scope, forceLru = false, bytesToFree = 0) {
  if (!scope) return
  const now = Date.now()
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  const scoped = rows.filter(row => row.scope === scope)
  const isExpired = row => row.status === 'expired' || (row.expiresAt && new Date(row.expiresAt).getTime() <= now) || now - row.cachedAt > ATTACHMENT_TTL
  const expired = scoped.filter(isExpired)
  const recalled = scoped.filter(row => !isExpired(row) && row.status === 'recalled')
  const deleted = scoped.filter(row => !isExpired(row) && row.status === 'deleted')
  const invalid = [...expired, ...recalled, ...deleted]
  let freed = invalid.reduce((sum, row) => sum + (row.size || 0), 0)
  const targets = [...invalid]
  if (forceLru) for (const row of scoped.filter(item => !invalid.includes(item)).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)) {
    if (freed >= bytesToFree && bytesToFree > 0) break
    targets.push(row); freed += row.size || 0
  }
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(targets.map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  await withStore(['attachments', 'messages'], 'readwrite', async tx => {
    targets.forEach(row => tx.objectStore('attachments').delete(row.key))
    const messages = await requestResult(tx.objectStore('messages').getAll())
    messages.filter(row => row.scope === scope && now - new Date(row.createdAt).getTime() > MESSAGE_TTL).forEach(row => tx.objectStore('messages').delete(row.key))
  })
  try { localStorage.setItem(`yimeng_chat_cleanup:${scope}`, String(now)) } catch {}
}
export async function initializeChatCache(scope) {
  if (!scope) return
  navigator.storage?.persist?.().catch(() => false)
  let last = 0
  try { last = Number(localStorage.getItem(`yimeng_chat_cleanup:${scope}`) || 0) } catch {}
  if (Date.now() - last >= DAY) await cleanupChatCache(scope)
  if (!cleanupTimers.has(scope)) cleanupTimers.set(scope, setInterval(() => cleanupChatCache(scope), DAY))
}
export async function clearIdentityCache(scope) {
  if (!scope) return
  for (const [timerScope, timer] of cleanupTimers) {
    if (timerScope === scope || timerScope.startsWith(`${scope}:`)) {
      clearInterval(timer)
      cleanupTimers.delete(timerScope)
    }
  }
  const attachmentRows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(attachmentRows.filter(row => row.scope === scope || row.scope.startsWith(`${scope}:`)).map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  for (const storeName of ['conversations', 'messages', 'attachments', 'syncState']) await withStore([storeName], 'readwrite', async tx => {
    const store = tx.objectStore(storeName)
    for (const row of await requestResult(store.getAll())) if (row.scope === scope || row.scope.startsWith(`${scope}:`)) store.delete(row.key)
  })
  try { Object.keys(localStorage).filter(key => key.startsWith(`yimeng_chat_cleanup:${scope}`)).forEach(key => localStorage.removeItem(key)) } catch {}
}
