// 忆梦云团队开发 - 文件上传
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const multer = require('multer');
const { authAdmin, authTenantUser, authCustomer } = require('../middleware/auth');
const { ok, error } = require('../utils');
const { getSystemSettings } = require('../utils/systemSettings');

const router = express.Router();
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const MIME_BY_EXTENSION = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], gif: ['image/gif'], webp: ['image/webp'],
  pdf: ['application/pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], zip: ['application/zip', 'application/x-zip-compressed'],
  txt: ['text/plain'], mp3: ['audio/mpeg'], wav: ['audio/wav', 'audio/x-wav'], ogg: ['audio/ogg'],
  mp4: ['video/mp4'], webm: ['video/webm'], mov: ['video/quicktime'],
};

function buildStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = req.tenantId || req.customer?.tenantId || req.admin?.id || 'public';
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

function removeFile(filePath) {
  fs.unlink(filePath, () => {});
}

function createVideoThumbnail(videoPath) {
  const parsed = path.parse(videoPath);
  const thumbnailPath = path.join(parsed.dir, `${parsed.name}.thumbnail.jpg`);
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.2', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', thumbnailPath,
    ], { windowsHide: true, timeout: 30000 }, (err) => {
      if (err) {
        removeFile(thumbnailPath);
        return reject(err);
      }
      resolve(thumbnailPath);
    });
  });
}

async function handleUpload(req, res) {
  if (!req.file) return error(res, '未上传文件');
  const isImage = req.file.mimetype.startsWith('image/');
  const isVideo = req.file.mimetype.startsWith('video/');
  let thumbnailUrl = '';
  if (isVideo) {
    try {
      const thumbnailPath = await createVideoThumbnail(req.file.path);
      thumbnailUrl = '/uploads/' + path.relative(UPLOAD_DIR, thumbnailPath).replace(/\\/g, '/');
    } catch (err) {
      removeFile(req.file.path);
      console.error('[Upload] 视频缩略图生成失败:', err.message);
      return error(res, '无法解析视频或生成缩略图失败', 4001, 400);
    }
  }
  const url = '/uploads/' + path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, '/');
  return ok(res, {
    url, thumbnailUrl, name: req.file.originalname, size: req.file.size,
    mimetype: req.file.mimetype, isImage, isVideo,
  });
}

function configuredUpload(subDir) {
  return async (req, res) => {
    const settings = await getSystemSettings();
    const allowed = new Set(settings.upload.allowedTypes);
    const upload = multer({
      storage: buildStorage(subDir),
      limits: { fileSize: settings.upload.maxFileSizeMB * 1024 * 1024 },
      fileFilter: (uploadReq, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        const validMimes = MIME_BY_EXTENSION[ext] || [];
        if (allowed.has(ext) && validMimes.includes(file.mimetype.toLowerCase())) return cb(null, true);
        cb(new Error('不支持的文件类型'));
      },
    });
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return error(res, `文件大小不能超过 ${settings.upload.maxFileSizeMB}MB`, 4001, 400);
      }
      if (err instanceof multer.MulterError) return error(res, '文件错误：' + err.message, 4001, 400);
      if (err) return error(res, err.message, 4001, 400);
      return handleUpload(req, res);
    });
  };
}

router.post('/admin', authAdmin, configuredUpload('admin'));
router.post('/tenant', authTenantUser, configuredUpload('tenant'));
router.post('/client', authCustomer, configuredUpload('customer'));

module.exports = router;