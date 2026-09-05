// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authCustomer } = require('../middleware/auth');
const validators = require('../middleware/validators');

const CustomerAuthController = require('../controllers/CustomerAuthController');
const ChatController = require('../controllers/ChatController');
const CaptchaController = require('../controllers/CaptchaController');
const { verifyCaptcha } = require('../middleware/captcha');
const SystemSettingController = require('../controllers/SystemSettingController');

router.get('/public-settings', SystemSettingController.getPublic);

// 已登录客户访问过的渠道（必须置于动态 token 路由之前）
router.get('/channels/history', authCustomer, CustomerAuthController.channelHistory);
router.post('/channels/:token/switch', authCustomer, CustomerAuthController.switchChannel);

// 渠道公开信息
router.get('/channels/:token/captcha', CaptchaController.create);
router.get('/channels/:token', CustomerAuthController.getChannelInfo);

// 客户登录 / 自动注册
router.post('/channels/:token/auth', verifyCaptcha, validators.customerAuth, CustomerAuthController.auth);

// 客户资料
router.get('/me', authCustomer, CustomerAuthController.me);
router.post('/profile/qq', authCustomer, validators.customerQQ, CustomerAuthController.updateQQ);
router.post('/profile/password', authCustomer, validators.customerPassword, CustomerAuthController.updatePassword);

// 会话与消息
router.get('/conversation', authCustomer, ChatController.getClientConversation);
router.get('/conversation/messages', authCustomer, ChatController.getClientMessages);
router.post('/conversation/messages', authCustomer, ChatController.customerSendMessage);
router.post('/conversation/messages/:messageId/recall', authCustomer, ChatController.customerRecallMessage);
router.delete('/conversation/messages/:messageId', authCustomer, ChatController.customerDeleteMessage);

module.exports = router;
