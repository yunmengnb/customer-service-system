// 忆梦云团队开发
const mongoose = require('mongoose');

const SystemSettingSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'platform', unique: true, immutable: true },
  registerEnabled: { type: Boolean, default: true },
  loginEnabled: { type: Boolean, default: true },
  customerServiceDomain: { type: String, default: '', trim: true },
  siteTitle: { type: String, default: '忆梦云客服', trim: true, maxlength: 120 },
  siteKeywords: { type: String, default: '', trim: true, maxlength: 500 },
  siteDescription: { type: String, default: '', trim: true, maxlength: 500 },
  forbiddenWords: {
    type: [String],
    default: [],
  },
  upload: {
    allowedTypes: {
      type: [String],
      default: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'zip', 'txt', 'mp3', 'wav', 'mp4', 'webm'],
    },
    maxFileSizeMB: { type: Number, default: 10, min: 1, max: 1024 },
  },
  captcha: {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['image', 'geetest'], default: 'image' },
    imageLength: { type: Number, default: 4, min: 4, max: 8 },
    expireSeconds: { type: Number, default: 300, min: 60, max: 1800 },
    geetestId: { type: String, default: '', trim: true },
    geetestKey: { type: String, default: '', trim: true },
  },
  smtp: {
    enabled: { type: Boolean, default: false },
    host: { type: String, default: '', trim: true },
    port: { type: Number, default: 465, min: 1, max: 65535 },
    secure: { type: Boolean, default: true },
    username: { type: String, default: '', trim: true },
    password: { type: String, default: '' },
    fromName: { type: String, default: '', trim: true },
    fromEmail: { type: String, default: '', trim: true, lowercase: true },
  },
  getui: {
    enabled: { type: Boolean, default: true },
    appId: { type: String, default: '', trim: true },
    appKey: { type: String, default: '', trim: true },
    masterSecret: { type: String, default: '' },
    baseUrl: { type: String, default: '', trim: true },
    timeoutMs: { type: Number, default: null, min: 1000, max: 60000 },
    ttlMs: { type: Number, default: null, min: 60000, max: 604800000 },
    hideMessageContent: { type: Boolean, default: null },
  },
}, { timestamps: true, versionKey: false });

SystemSettingSchema.statics.getSingleton = function() {
  return this.findOneAndUpdate(
    { singletonKey: 'platform' },
    { $setOnInsert: { singletonKey: 'platform' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

module.exports = mongoose.model('SystemSetting', SystemSettingSchema, 'system_settings');
