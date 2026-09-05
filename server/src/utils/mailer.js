// 忆梦云团队开发
const nodemailer = require('nodemailer');
const { getSystemSettings } = require('./systemSettings');

async function sendMail({ to, subject, text, html }) {
  const settings = await getSystemSettings();
  const smtp = settings.smtp;
  if (!smtp.enabled || !smtp.host || !smtp.fromEmail) return false;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  });
  await transporter.sendMail({
    from: smtp.fromName ? `"${smtp.fromName.replace(/["\r\n]/g, '')}" <${smtp.fromEmail}>` : smtp.fromEmail,
    to,
    subject,
    text,
    html,
  });
  return true;
}

module.exports = { sendMail };
