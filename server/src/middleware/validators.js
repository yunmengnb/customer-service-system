// 忆梦云团队开发
const { body } = require('express-validator');

function hasReplyPayload(value, { req }) {
  if (String(value || '').trim() || String(req.body.imageUrl || '').trim()) return true;
  throw new Error('回复内容和图片至少填写一项');
}

const { validationResult: validate } = require('./validate');

// 管理员登录校验
const adminLogin = [
  body('username').trim().notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 6 }).withMessage('密码至少6位'),
  validate,
];

const createAnnouncement = [
  body('title').trim().notEmpty().withMessage('公告标题不能为空').isLength({ max: 200 }).withMessage('公告标题不能超过200字'),
  body('content').trim().notEmpty().withMessage('公告内容不能为空'),
  body('status').optional().isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const updateAnnouncement = [
  body('title').trim().notEmpty().withMessage('公告标题不能为空').isLength({ max: 200 }).withMessage('公告标题不能超过200字'),
  body('content').trim().notEmpty().withMessage('公告内容不能为空'),
  body('status').optional().isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const updateAnnouncementStatus = [
  body('status').isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const appVersion = [
  body('versionCode').isInt({ min: 1 }).withMessage('版本号必须为正整数').toInt(),
  body('versionName').trim().notEmpty().withMessage('版本名称不能为空').isLength({ max: 50 }).withMessage('版本名称不能超过50字'),
  body('downloadUrl').trim().notEmpty().withMessage('下载地址不能为空').isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('下载地址格式无效'),
  body('releaseNotes').optional({ nullable: true }).isString().withMessage('更新说明格式无效'),
  body('forceUpdate').optional().isBoolean().withMessage('强制更新标记无效').toBoolean(),
  body('status').optional().isIn(['draft', 'published']).withMessage('版本状态无效'),
  validate,
];

// 租户注册
const tenantRegister = [
  body('name').trim().notEmpty().withMessage('企业名称不能为空'),
  body('username').trim().notEmpty().withMessage('用户名不能为空').isLength({ min: 3 }).withMessage('用户名至少3位'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('email').trim().isEmail().withMessage('邮箱格式不正确'),
  validate,
];

// 租户用户登录
const tenantLogin = [
  body('username').trim().notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
  validate,
];

// 创建员工
const createAgent = [
  body('username').trim().notEmpty().withMessage('用户名不能为空').isLength({ min: 3 }).withMessage('用户名至少3位'),
  body('displayName').trim().notEmpty().withMessage('显示名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('role').optional().isIn(['admin', 'agent']).withMessage('角色无效'),
  validate,
];

// 客户登录/自动注册
const customerAuth = [
  body('phone').trim().notEmpty().withMessage('手机号不能为空').isLength({ min: 6 }).withMessage('手机号格式不正确'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 4 }).withMessage('密码至少4位'),
  body('fingerprint').optional().isString(),
  validate,
];

// 客户完善 QQ
const customerQQ = [
  body('qq').trim().matches(/^[1-9]\d{4,11}$/).withMessage('QQ号格式不正确'),
  validate,
];

// 客户修改密码
const customerPassword = [
  body('currentPassword').isString().notEmpty().withMessage('请输入当前密码'),
  body('newPassword').isString().isLength({ min: 6, max: 72 }).withMessage('新密码须为6-72位'),
  body('confirmPassword').isString().notEmpty().withMessage('请再次输入新密码').custom((value, { req }) => {
    if (value !== req.body.newPassword) throw new Error('两次输入的新密码不一致');
    return true;
  }),
  validate,
];

// 创建渠道
const createChannel = [
  body('name').trim().notEmpty().withMessage('渠道名称不能为空').isLength({ max: 50 }),
  body('brandName').optional().isString().isLength({ max: 50 }),
  body('brandColor').optional().isString(),
  body('welcomeMessage').optional().isString().isLength({ max: 500 }),
  validate,
];

// 关键词回复
const keywordReply = [
  body('keyword').trim().notEmpty().withMessage('关键词不能为空').isLength({ max: 100 }),
  body('matchType').optional().isIn(['exact', 'contains']),
  body('replyContent').optional({ nullable: true }).isString().isLength({ max: 500 }).custom(hasReplyPayload),
  body('imageUrl').optional({ checkFalsy: true }).isString(),
  body('imageName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  validate,
];

// 快捷回复
const quickReply = [
  body('title').trim().notEmpty().withMessage('标题不能为空').isLength({ max: 50 }),
  body('content').optional({ nullable: true }).isString().isLength({ max: 500 }).custom(hasReplyPayload),
  body('imageUrl').optional({ checkFalsy: true }).isString(),
  body('imageName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  validate,
];

module.exports = {
  adminLogin,
  createAnnouncement,
  updateAnnouncement,
  updateAnnouncementStatus,
  appVersion,
  tenantRegister,
  tenantLogin,
  createAgent,
  customerAuth,
  customerQQ,
  customerPassword,
  createChannel,
  keywordReply,
  quickReply,
};