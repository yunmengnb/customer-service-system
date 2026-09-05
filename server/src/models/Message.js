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
    enum: ['keyword', 'welcome'],
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

MessageSchema.index({ conversationId: 1, createdAt: 1 });
// 仅对有 clientMessageId 的文档（非系统消息）做幂等唯一约束
MessageSchema.index(
  { conversationId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $exists: true } } }
);

module.exports = mongoose.model('Message', MessageSchema, 'messages');
