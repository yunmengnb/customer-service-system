// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authAdmin, requireSuperAdmin } = require('../middleware/auth');
const validators = require('../middleware/validators');

const AdminAuthController = require('../controllers/AdminAuthController');
const TenantAdminController = require('../controllers/TenantAdminController');

// ===== 认证 =====
router.post('/auth/login', validators.adminLogin, AdminAuthController.login);
router.post('/auth/logout', authAdmin, AdminAuthController.logout);
router.get('/auth/me', authAdmin, AdminAuthController.me);

// ===== 只读（所有已登录 admin 都可访问）=====
router.get('/dashboard', authAdmin, TenantAdminController.dashboard);
router.get('/tenants', authAdmin, TenantAdminController.list);
router.get('/tenants/:id', authAdmin, TenantAdminController.detail);

// ===== 敏感写操作（需要超级管理员）=====
router.patch('/tenants/:id/status', authAdmin, requireSuperAdmin, TenantAdminController.updateStatus);
router.patch('/tenants/:id/plan', authAdmin, requireSuperAdmin, TenantAdminController.updatePlan);

module.exports = router;
