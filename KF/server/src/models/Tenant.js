// 忆梦云团队开发
const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  password: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  plan: {
    agentLimit: { type: Number, default: 10 },
    channelLimit: { type: Number, default: 5 },
    messageRetentionDays: { type: Number, default: 90 },
    attachmentLimitMB: { type: Number, default: 1024 },
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'trial'],
    default: 'active',
  },
  expiresAt: {
    type: Date,
  },
  lastLoginAt: {
    type: Date,
  },
}, {
  timestamps: true,
  versionKey: false,
});

TenantSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('Tenant', TenantSchema, 'tenants');
