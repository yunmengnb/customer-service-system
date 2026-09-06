// 忆梦云团队开发 - APP 版本管理
const mongoose = require('mongoose');

const AppVersionSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['android'],
    default: 'android',
    index: true,
  },
  versionCode: {
    type: Number,
    required: true,
    min: 1,
  },
  versionName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  downloadUrl: {
    type: String,
    required: true,
    trim: true,
  },
  releaseNotes: {
    type: String,
    default: '',
  },
  forceUpdate: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
    index: true,
  },
  publishedAt: {
    type: Date,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
  versionKey: false,
});

AppVersionSchema.index({ platform: 1, versionCode: 1 }, { unique: true });
AppVersionSchema.index({ platform: 1, status: 1, versionCode: -1 });

module.exports = mongoose.model('AppVersion', AppVersionSchema, 'app_versions');
