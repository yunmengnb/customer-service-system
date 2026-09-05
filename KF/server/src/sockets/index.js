// 忆梦云团队开发
const { createAdapter } = require('@socket.io/redis-adapter');
const { verifyToken } = require('../utils');
const { getRedis, createRedisDuplicate } = require('../config/redis');
const presence = require('../utils/presence');
const Channel = require('../models/Channel');
const TenantUser = require('../models/TenantUser');

function broadcastPresence(io, user, online) {
  const room = user.type === 'admin' ? 'admin' : user.tenantId && `presence-tenant-${user.tenantId}`;
  if (!room) return;
  io.to(room).emit('presence:changed', {
    type: user.type,
    userId: user.id,
    online,
  });
}

async function setupSocketIO(io) {
  const pubClient = getRedis();
  if (pubClient) {
    try {
      const subClient = await createRedisDuplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Socket.IO] Redis Adapter 已启用');
    } catch (err) {
      console.warn('[Socket.IO] Redis Adapter 启用失败，使用内存 Adapter:', err.message);
    }
  }
  // 认证中间件
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const userType = socket.handshake.auth?.type || socket.handshake.query?.type;
    
    if (!token) {
      // 允许未认证的连接但不加入任何房间
      return next();
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return next(new Error('Invalid token'));
    }
    
    socket.user = payload;
    socket.userType = payload.type;
    
    // 验证坐席权限（可选：保持轻量）
    try {
      if (payload.type === 'tenant_user') {
        const user = await TenantUser.findOne({ _id: payload.id, tenantId: payload.tenantId });
        if (!user || user.status !== 'active') {
          return next(new Error('User not found or disabled'));
        }
        socket.user = {
          ...payload,
          role: user.role,
          tenantId: user.tenantId.toString(),
        };
      }
    } catch (err) {
      return next(new Error('Authentication failed'));
    }
    
    next();
  });
  
  io.on('connection', async (socket) => {
    // 按用户类型加入房间
    if (socket.user) {
      if (socket.user.type === 'tenant_user') {
        if (socket.user.role === 'agent') {
          const channels = await Channel.find({
            tenantId: socket.user.tenantId,
            agentIds: socket.user.id,
          }).select('_id');
          channels.forEach(channel => socket.join(`channel-staff-${channel._id}`));
        } else {
          socket.join(`tenant-${socket.user.tenantId}`);
        }
        socket.join(`agent-${socket.user.id}`);
        socket.join(`presence-tenant-${socket.user.tenantId}`);
      } else if (socket.user.type === 'customer') {
        socket.join(`customer-${socket.user.id}`);
        socket.join(`presence-tenant-${socket.user.tenantId}`);
        socket.join(`channel-${socket.user.channelId}`);
      } else if (socket.user.type === 'admin') {
        socket.join('admin');
      }
    }
    
    if (socket.user) {
      await presence.connect(socket.user.type, socket.user.id, socket.id);
      broadcastPresence(io, socket.user, true);
    }

    socket.emit('connected', { ok: true });

    const presenceTimer = socket.user
      ? setInterval(() => presence.touch(socket.user.type, socket.user.id, socket.id), 30000)
      : null;
    presenceTimer?.unref();

    socket.on('presence:query', async ({ type, userId } = {}, cb) => {
      if (socket.user && typeof cb === 'function') {
        cb({ online: await presence.isOnline(type, userId) });
      }
    });
    
    socket.on('disconnect', async () => {
      if (presenceTimer) clearInterval(presenceTimer);
      if (!socket.user) return;
      await presence.disconnect(socket.user.type, socket.user.id, socket.id);
      const online = await presence.isOnline(socket.user.type, socket.user.id);
      broadcastPresence(io, socket.user, online);
    });
    
    // 心跳
    socket.on('ping', async (cb) => {
      if (socket.user) await presence.touch(socket.user.type, socket.user.id, socket.id);
      if (cb) cb({ pong: true });
    });
  });
  
  return io;
}

module.exports = setupSocketIO;
