// 忆梦云团队开发 - APP 公告与 Android 版本接口
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const AppVersion = require('../models/AppVersion');
const { ok, error } = require('../utils');

function pagination(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 100);
  return { page, limit };
}

function validId(id) {
  return mongoose.isValidObjectId(id);
}

class AppController {
  async adminAnnouncementList(req, res) {
    const { page, limit } = pagination(req.query);
    const where = { audience: 'app' };
    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;

    const [items, total] = await Promise.all([
      Announcement.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Announcement.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async createAnnouncement(req, res) {
    const status = req.body.status || 'draft';
    const announcement = await Announcement.create({
      title: String(req.body.title).trim(),
      content: String(req.body.content).trim(),
      audience: 'app',
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    res.status(201);
    return ok(res, announcement.toJSON(), 'APP 公告创建成功');
  }

  async updateAnnouncement(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    announcement.title = String(req.body.title).trim();
    announcement.content = String(req.body.content).trim();
    await announcement.save();
    return ok(res, announcement.toJSON(), 'APP 公告更新成功');
  }

  async updateAnnouncementStatus(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    announcement.status = req.body.status;
    announcement.publishedAt = req.body.status === 'published' ? new Date() : null;
    await announcement.save();
    return ok(res, announcement.toJSON(), req.body.status === 'published' ? 'APP 公告已发布' : 'APP 公告已下架');
  }

  async removeAnnouncement(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    await announcement.deleteOne();
    return ok(res, null, 'APP 公告删除成功');
  }

  async publicAnnouncements(req, res) {
    const { page, limit } = pagination(req.query, 20);
    const where = { audience: 'app', status: 'published', publishedAt: { $lte: new Date() } };
    const [items, total] = await Promise.all([
      Announcement.find(where).sort({ publishedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Announcement.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async publicAnnouncementDetail(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      audience: 'app',
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).lean();
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);
    return ok(res, announcement);
  }

  async adminVersionList(req, res) {
    const { page, limit } = pagination(req.query);
    const where = { platform: 'android' };
    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;

    const [items, total] = await Promise.all([
      AppVersion.find(where).sort({ versionCode: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AppVersion.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async createVersion(req, res) {
    const status = req.body.status || 'draft';
    const version = await AppVersion.create({
      platform: 'android',
      versionCode: req.body.versionCode,
      versionName: String(req.body.versionName).trim(),
      downloadUrl: String(req.body.downloadUrl).trim(),
      releaseNotes: String(req.body.releaseNotes || '').trim(),
      forceUpdate: req.body.forceUpdate === true,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    res.status(201);
    return ok(res, version.toJSON(), 'Android 版本创建成功');
  }

  async updateVersion(req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const version = await AppVersion.findOne({ _id: req.params.id, platform: 'android' });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);

    version.versionCode = req.body.versionCode;
    version.versionName = String(req.body.versionName).trim();
    version.downloadUrl = String(req.body.downloadUrl).trim();
    version.releaseNotes = String(req.body.releaseNotes || '').trim();
    version.forceUpdate = req.body.forceUpdate === true;
    await version.save();
    return ok(res, version.toJSON(), 'Android 版本更新成功');
  }

  async updateVersionStatus(req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const version = await AppVersion.findOne({ _id: req.params.id, platform: 'android' });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);

    version.status = req.body.status;
    version.publishedAt = req.body.status === 'published' ? new Date() : null;
    await version.save();
    return ok(res, version.toJSON(), req.body.status === 'published' ? 'Android 版本已发布' : 'Android 版本已下架');
  }

  async removeVersion(req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const version = await AppVersion.findOneAndDelete({ _id: req.params.id, platform: 'android' });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);
    return ok(res, null, 'Android 版本删除成功');
  }

  async checkAndroidUpdate(req, res) {
    const currentVersionCode = Number.parseInt(req.query.versionCode, 10);
    if (!Number.isInteger(currentVersionCode) || currentVersionCode < 1) {
      return error(res, 'versionCode 必须为正整数');
    }

    const version = await AppVersion.findOne({
      platform: 'android',
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).sort({ versionCode: -1 }).lean();

    return ok(res, {
      hasUpdate: Boolean(version && version.versionCode > currentVersionCode),
      version: version && version.versionCode > currentVersionCode ? version : null,
    });
  }
}

module.exports = new AppController();
