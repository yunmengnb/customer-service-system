// 忆梦云团队开发
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service',
  },

  redis: {
    url: process.env.REDIS_URL || '',
    connectTimeoutMs: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 2000,
    cacheTtlSeconds: parseInt(process.env.REDIS_CACHE_TTL_SECONDS, 10) || 300,
  },

  getui: {
    appId: process.env.GETUI_APP_ID || '',
    appKey: process.env.GETUI_APP_KEY || '',
    masterSecret: process.env.GETUI_MASTER_SECRET || '',
    baseUrl: (process.env.GETUI_BASE_URL || 'https://restapi.getui.com/v2').replace(/\/$/, ''),
    timeoutMs: parseInt(process.env.GETUI_TIMEOUT_MS, 10) || 8000,
    ttlMs: parseInt(process.env.GETUI_TTL_MS, 10) || 2 * 60 * 60 * 1000,
    hideMessageContent: process.env.GETUI_HIDE_MESSAGE_CONTENT === 'true',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me_in_production_abc123',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  cors: {
    origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()),
    credentials: true,
  },
  
  defaults: {
    admin: {
      username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
      password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
      email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com',
    },
    tenant: {
      name: process.env.DEFAULT_TENANT_NAME || '示例企业',
      username: process.env.DEFAULT_TENANT_USERNAME || 'demo',
      password: process.env.DEFAULT_TENANT_PASSWORD || 'demo123',
    },
  },
};
