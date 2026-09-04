// 忆梦云团队开发
const { body } = require('express-validator');

const { validationResult: validate } = require('./validate');

// 管理员登录校验
const adminLogin = [
  body('username').trim().notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 6 }).withMessage('密码至少6位'),
  validate,
];

// 管理员注册（系统初始化用，不对外开放）
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
  body('replyContent').trim().notEmpty().withMessage('回复内容不能为空').isLength({ max: 500 }),
  validate,
];

// 快捷回复
const quickReply = [
  body('title').trim().notEmpty().withMessage('标题不能为空').isLength({ max: 50 }),
  body('content').trim().notEmpty().withMessage('内容不能为空').isLength({ max: 500 }),
  validate,
];

module.exports = {
  adminLogin,
  tenantRegister,
  tenantLogin,
  createAgent,
  customerAuth,
  customerQQ,
  createChannel,
  keywordReply,
  quickReply,
};
