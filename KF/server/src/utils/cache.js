// 忆梦云团队开发
const { getRedis } = require('../config/redis');

const memoryCache = new Map();

function readMemory(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

async function getJson(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      console.warn('[Cache] Redis 读取失败，使用内存缓存:', err.message);
    }
  }
  return readMemory(key);
}

async function setJson(key, value, ttlSeconds) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn('[Cache] Redis 写入失败，使用内存缓存:', err.message);
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function remove(...keys) {
  const filtered = keys.filter(Boolean);
  if (!filtered.length) return;
  filtered.forEach(key => memoryCache.delete(key));
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(filtered);
    } catch (err) {
      console.warn('[Cache] Redis 失效失败:', err.message);
    }
  }
}

module.exports = { getJson, setJson, remove };
