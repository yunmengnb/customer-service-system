// 忆梦云团队开发
const mongoose = require('mongoose');

const QuickReplySchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    index: true,
    default: null, // null 表示租户通用
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  content: {
    type: String,
    required: true,
    maxlength: 500,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantUser',
  },
}, {
  timestamps: true,
  versionKey: false,
});

QuickReplySchema.index({ tenantId: 1, channelId: 1 });

module.exports = mongoose.model('QuickReply', QuickReplySchema, 'quick_replies');
