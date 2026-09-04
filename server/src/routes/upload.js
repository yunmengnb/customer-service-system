// 忆梦云团队开发 - 文件上传
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authTenantUser, authCustomer } = require('../middleware/auth');
const { ok, error } = require('../utils');

const router = express.Router();

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');

function buildStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = req.tenantId || (req.customer && req.customer.tenantId) || 'public';
      const dir = path.join(UPLOAD_DIR, String(tenantId), subDir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 10) + ext);
    },
  });
}

const tenantUpload = multer({
  storage: buildStorage('tenant'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allow = /^(image\/(jpeg|png|gif|webp)|application\/pdf|application\/vnd.openxmlformats|application\/zip|text\/plain|audio\/|video\/)$/i;
    if (allow.test(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型：' + file.mimetype));
  },
});

const customerUpload = multer({
  storage: buildStorage('customer'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: tenantUpload.fileFilter,
});

function handleUpload(req, res) {
  if (!req.file) return error(res, '未上传文件');
  const relPath = path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, '/');
  const url = '/uploads/' + relPath;
  return ok(res, {
    url,
    name: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    isImage: req.file.mimetype.startsWith('image/'),
  });
}

// POST /api/upload/tenant
router.post('/tenant', authTenantUser, (req, res) => {
  tenantUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) return error(res, '文件错误：' + err.message);
    if (err) return error(res, err.message, 400);
    handleUpload(req, res);
  });
});

// POST /api/upload/client
router.post('/client', authCustomer, (req, res) => {
  customerUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) return error(res, '文件错误：' + err.message);
    if (err) return error(res, err.message, 400);
    handleUpload(req, res);
  });
});

module.exports = router;
