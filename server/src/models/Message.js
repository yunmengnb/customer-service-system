// 忆梦云团队开发
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  senderType: {
    type: String,
    enum: ['customer', 'agent', 'system', 'bot'],
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'senderTypeModel',
    default: null,
  },
  senderTypeModel: {
    type: String,
    enum: ['Customer', 'TenantUser', 'PlatformAdmin'],
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'file', 'system'],
    default: 'text',
  },
  autoReplyType: {
    type: String,
    enum: ['keyword', 'welcome', 'offline'],
    default: null,
  },
  recalledAt: {
    type: Date,
    default: null,
  },
  deletedForCustomerAt: {
    type: Date,
    default: null,
  },
  deletedForAgentAt: {
    type: Date,
    default: null,
  },
  content: {
    type: String,
    default: '',
  },
  attachmentUrl: {
    type: String,
    default: '',
  },
  attachmentName: {
    type: String,
    default: '',
  },
  thumbnailUrl: {
    type: String,
    default: '',
  },
  attachmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConversationAttachment',
    default: null,
    index: true,
  },
  attachmentStatus: {
    type: String,
    enum: ['none', 'active', 'expired', 'recalled', 'deleted'],
    default: 'none',
  },
  attachmentExpiredAt: { type: Date, default: null },
  // 客户端幂等 ID，防止重复发送
  clientMessageId: {
    type: String,
    index: true,
  },
  // 是否已读
  readByAgent: {
    type: Boolean,
    default: false,
  },
  readByCustomer: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
  versionKey: false,
});

MessageSchema.set('toJSON', {
  transform(doc, ret) {
    if (ret.attachmentId) {
      if (ret.attachmentStatus === 'active' && ret.attachmentExpiredAt && new Date(ret.attachmentExpiredAt) <= new Date()) {
        ret.attachmentStatus = 'expired';
      }
      const available = ret.attachmentStatus === 'active';
      ret.attachmentUrl = available ? `/api/files/${ret.attachmentId}` : '';
      ret.thumbnailUrl = available && ['image', 'video'].includes(ret.messageType)
        ? `/api/files/${ret.attachmentId}/thumbnail`
        : '';
    }
    return ret;
  },
});

MessageSchema.index({ conversationId: 1, createdAt: 1 });
// 仅对有 clientMessageId 的文档（非系统消息）做幂等唯一约束
MessageSchema.index(
  { conversationId: 1, senderType: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }
);

module.exports = mongoose.model('Message', MessageSchema, 'messages');
