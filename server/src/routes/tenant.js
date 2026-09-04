// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authTenantUser, requireTenantAdmin } = require('../middleware/auth');
const validators = require('../middleware/validators');

const TenantAuthController = require('../controllers/TenantAuthController');
const AgentController = require('../controllers/AgentController');
const ChannelController = require('../controllers/ChannelController');
const ChatController = require('../controllers/ChatController');

// ===== 认证 =====
router.post('/auth/register', validators.tenantRegister, TenantAuthController.register);
router.post('/auth/login', validators.tenantLogin, TenantAuthController.login);
router.get('/auth/me', authTenantUser, TenantAuthController.me);
router.post('/auth/logout', authTenantUser, TenantAuthController.logout);

// ===== 员工管理 =====
router.get('/employees', authTenantUser, requireTenantAdmin, AgentController.list);
router.post('/employees', authTenantUser, requireTenantAdmin, validators.createAgent, AgentController.create);
router.patch('/employees/:id', authTenantUser, requireTenantAdmin, AgentController.update);
router.delete('/employees/:id', authTenantUser, requireTenantAdmin, AgentController.delete);
router.post('/employees/:id/reset-password', authTenantUser, requireTenantAdmin, AgentController.resetPassword);
router.post('/employees/:id/login', authTenantUser, requireTenantAdmin, AgentController.loginAsEmployee);

// ===== 渠道管理 =====
router.get('/channels', authTenantUser, ChannelController.list);
router.post('/channels', authTenantUser, requireTenantAdmin, validators.createChannel, ChannelController.create);
router.get('/channels/:id', authTenantUser, ChannelController.detail);
router.patch('/channels/:id', authTenantUser, ChannelController.update);
router.delete('/channels/:id', authTenantUser, requireTenantAdmin, ChannelController.delete);
router.post('/channels/:id/rotate-token', authTenantUser, requireTenantAdmin, ChannelController.rotateToken);
router.put('/channels/:id/employees', authTenantUser, requireTenantAdmin, ChannelController.setAgents);

// 关键词回复
router.get('/channels/:channelId/keywords', authTenantUser, ChannelController.listKeywordReplies);
router.post('/channels/:channelId/keywords', authTenantUser, validators.keywordReply, ChannelController.createKeywordReply);
router.patch('/channels/:channelId/keywords/:krId', authTenantUser, ChannelController.updateKeywordReply);
router.delete('/channels/:channelId/keywords/:krId', authTenantUser, ChannelController.deleteKeywordReply);

// 快捷回复
router.get('/channels/:channelId/quick-replies', authTenantUser, ChannelController.listQuickReplies);
router.post('/channels/:channelId/quick-replies', authTenantUser, validators.quickReply, ChannelController.createQuickReply);
router.patch('/channels/:channelId/quick-replies/:qrId', authTenantUser, ChannelController.updateQuickReply);
router.delete('/channels/:channelId/quick-replies/:qrId', authTenantUser, ChannelController.deleteQuickReply);

// ===== 会话与消息 =====
router.get('/conversations', authTenantUser, ChatController.listConversations);
router.get('/conversations/:id', authTenantUser, ChatController.conversationDetail);
router.post('/conversations/:id/accept', authTenantUser, ChatController.acceptConversation);
router.get('/conversations/:id/messages', authTenantUser, ChatController.getMessages);
router.post('/conversations/:id/messages', authTenantUser, ChatController.agentSendMessage);
router.post('/conversations/:id/messages/:messageId/recall', authTenantUser, ChatController.recallMessage);
router.delete('/conversations/:id/messages/:messageId', authTenantUser, ChatController.deleteMessage);
router.post('/conversations/:id/close', authTenantUser, ChatController.closeConversation);

module.exports = router;
