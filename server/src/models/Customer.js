// 忆梦云团队开发
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  qq: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  nickname: {
    type: String,
    default: '访客',
    maxlength: 50,
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  registerIp: {
    type: String,
  },
  registerUserAgent: {
    type: String,
  },
  registerFingerprintHash: {
    type: String,
  },
  lastLoginIp: {
    type: String,
  },
  lastLoginAt: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
}, {
  timestamps: true,
  versionKey: false,
});

// 同一 channel 内 phone 唯一
CustomerSchema.index({ channelId: 1, phone: 1 }, { unique: true });

CustomerSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.registerFingerprintHash;
  return obj;
};

module.exports = mongoose.model('Customer', CustomerSchema, 'customers');
