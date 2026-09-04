// 忆梦云团队开发
const { verifyToken } = require('../utils');
const Channel = require('../models/Channel');
const TenantUser = require('../models/TenantUser');

function setupSocketIO(io) {
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
      } else if (socket.user.type === 'customer') {
        socket.join(`customer-${socket.user.id}`);
        socket.join(`channel-${socket.user.channelId}`);
      } else if (socket.user.type === 'admin') {
        socket.join('admin');
      }
    }
    
    socket.emit('connected', { ok: true });
    
    socket.on('disconnect', () => {
      // 连接断开
    });
    
    // 心跳
    socket.on('ping', (cb) => {
      if (cb) cb({ pong: true });
    });
  });
  
  return io;
}

module.exports = setupSocketIO;
