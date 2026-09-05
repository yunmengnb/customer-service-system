// 忆梦云团队开发
const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema({
  key: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  content: {
    type: String,
    required: true,
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

AnnouncementSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('Announcement', AnnouncementSchema, 'announcements');
