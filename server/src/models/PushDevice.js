// 忆梦云团队开发
const mongoose = require('mongoose');

const PushDeviceSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantUser',
    required: true,
    index: true,
  },
  clientId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    maxlength: 128,
  },
  platform: {
    type: String,
    enum: ['android'],
    required: true,
  },
  appId: {
    type: String,
    default: '',
    maxlength: 64,
  },
  appVersion: {
    type: String,
    default: '',
    maxlength: 32,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  versionKey: false,
});

PushDeviceSchema.index({ tenantId: 1, userId: 1, enabled: 1 });

module.exports = mongoose.model('PushDevice', PushDeviceSchema, 'push_devices');
