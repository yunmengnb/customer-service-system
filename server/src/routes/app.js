// 忆梦云团队开发 - APP 公开接口
const express = require('express');
const AppController = require('../controllers/AppController');

const router = express.Router();

router.get('/announcements', AppController.publicAnnouncements);
router.get('/announcements/:id', AppController.publicAnnouncementDetail);
router.get('/android/check-update', AppController.checkAndroidUpdate);

module.exports = router;
