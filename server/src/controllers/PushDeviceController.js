// 忆梦云团队开发
const PushDevice = require('../models/PushDevice');
const config = require('../config');
const { ok, error } = require('../utils');

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_:\-.]{10,128}$/;

function normalizeClientId(value) {
  return String(value || '').trim();
}

class PushDeviceController {
  async bind(req, res) {
    const clientId = normalizeClientId(req.body.clientId);
    const platform = String(req.body.platform || 'android').trim().toLowerCase();
    const appVersion = String(req.body.appVersion || '').trim().slice(0, 32);

    if (!CLIENT_ID_PATTERN.test(clientId)) {
      return error(res, '无效的推送设备标识', 4001, 400);
    }
    if (platform !== 'android') {
      return error(res, '不支持的推送平台', 4002, 400);
    }

    const getui = resolveGetuiSettings(await getSystemSettings());
    await PushDevice.findOneAndUpdate(
      { clientId },
      {
        $set: {
          tenantId: req.tenantId,
          userId: req.user.id,
          platform,
          appId: getui.appId,
          appVersion,
          enabled: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return ok(res, null, '推送设备绑定成功');
  }

  async unbindCurrent(req, res) {
    const clientId = normalizeClientId(req.body.clientId);
    if (!CLIENT_ID_PATTERN.test(clientId)) {
      return error(res, '无效的推送设备标识', 4001, 400);
    }

    await PushDevice.updateOne(
      { clientId, tenantId: req.tenantId, userId: req.user.id },
      { $set: { enabled: false, lastSeenAt: new Date() } }
    );
    return ok(res, null, '推送设备已解绑');
  }
}

module.exports = new PushDeviceController();
