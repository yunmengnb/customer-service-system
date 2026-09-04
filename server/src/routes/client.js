// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authCustomer } = require('../middleware/auth');
const validators = require('../middleware/validators');

const CustomerAuthController = require('../controllers/CustomerAuthController');
const ChatController = require('../controllers/ChatController');

// 渠道公开信息
router.get('/channels/:token', CustomerAuthController.getChannelInfo);

// 客户登录 / 自动注册
router.post('/channels/:token/auth', validators.customerAuth, CustomerAuthController.auth);

// 客户资料
router.get('/me', authCustomer, CustomerAuthController.me);
router.post('/profile/qq', authCustomer, validators.customerQQ, CustomerAuthController.updateQQ);

// 会话与消息
router.get('/conversation', authCustomer, ChatController.getClientConversation);
router.get('/conversation/messages', authCustomer, ChatController.getClientMessages);
router.post('/conversation/messages', authCustomer, ChatController.customerSendMessage);
router.post('/conversation/messages/:messageId/recall', authCustomer, ChatController.customerRecallMessage);
router.delete('/conversation/messages/:messageId', authCustomer, ChatController.customerDeleteMessage);

module.exports = router;
