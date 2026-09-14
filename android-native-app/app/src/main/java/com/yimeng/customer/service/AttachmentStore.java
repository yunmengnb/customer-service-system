// 忆梦云团队开发 - Android 应用内部聊天附件存储
package com.yimeng.customer.service;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class AttachmentStore {
    private static final String DIRECTORY = "chat_files";
    private static final String IDENTITY_KEY = "attachment_identity_v1";
    private static final long MAX_BYTES = 256L * 1024L * 1024L;
    private static final String ID_PATTERN = "[a-fA-F0-9]{24}";
    private final Activity activity;
    private final WebView webView;
    private final SharedPreferences preferences;
    private final Set<String> activeDownloads = ConcurrentHashMap.newKeySet();
    private volatile String currentIdentity;

    AttachmentStore(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.preferences = activity.getSharedPreferences(AppConfig.PREFS_NAME, Activity.MODE_PRIVATE);
        currentIdentity = preferences.getString(IDENTITY_KEY, "");
        if (currentIdentity == null) currentIdentity = "";
    }

    synchronized void syncIdentity(String token) {
        String identity = digest(token == null ? "" : token.trim());
        String previous = preferences.getString(IDENTITY_KEY, "");
        // #region debug-point A:sync-identity-null-state
        reportDebug("A", "AttachmentStore.syncIdentity", "同步附件身份", "previousNull=" + (previous == null) + ",identityNull=" + (identity == null) + ",currentNull=" + (currentIdentity == null));
        // #endregion
        if (!previous.equals(identity)) {
            clearDirectory(filesDirectory());
            preferences.edit().putString(IDENTITY_KEY, identity).apply();
        }
    }

    String state(String attachmentId) {
        if (!validId(attachmentId)) return result("error", "附件标识无效");
        File file = savedFile(attachmentId);
        return file != null && file.isFile() && file.length() >= 0
                ? result("saved", "") : result("missing", "");
    }

    String save(String attachmentId, String fileName, String mimeType) {
        if (!validId(attachmentId)) return result("error", "附件标识无效");
        String token = preferences.getString(AppConfig.TOKEN_KEY, "");
        if (token == null || token.trim().isEmpty()) return result("error", "登录状态无效，请重新登录");
        if (!activeDownloads.add(attachmentId)) return result("busy", "文件正在保存");
        String safeName = safeName(fileName);
        String safeMime = safeMime(mimeType);
        String identity = currentIdentity;
        // #region debug-point B:save-identity-snapshot
        reportDebug("B", "AttachmentStore.save", "准备保存附件", "identityNull=" + (identity == null) + ",mimeNull=" + (safeMime == null));
        // #endregion
        new Thread(() -> download(attachmentId, safeName, safeMime, token.trim(), identity), "attachment-save").start();
        return result("started", "");
    }

    String open(String attachmentId) {
        if (!validId(attachmentId)) return result("error", "附件标识无效");
        File file = savedFile(attachmentId);
        if (file == null || !file.isFile()) return result("missing", "文件不存在，请重新保存");
        String mime = preferences.getString(metaKey(attachmentId, "mime"), "application/octet-stream");
        Uri uri = FileProvider.getUriForFile(activity,
                activity.getPackageName() + ".fileprovider", file);
        Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, safeMime(mime))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (activity.getPackageManager().queryIntentActivities(view, 0).isEmpty()) {
            Toast.makeText(activity, "没有可打开此文件的应用", Toast.LENGTH_LONG).show();
            return result("no_handler", "没有可打开此文件的应用");
        }
        try {
            activity.startActivity(Intent.createChooser(view, "选择应用打开文件"));
            return result("opened", "");
        } catch (ActivityNotFoundException error) {
            Toast.makeText(activity, "没有可打开此文件的应用", Toast.LENGTH_LONG).show();
            return result("no_handler", "没有可打开此文件的应用");
        }
    }

    private void download(String attachmentId, String fileName, String requestedMime, String token, String identity) {
        HttpURLConnection connection = null;
        File part = new File(filesDirectory(), attachmentId + ".part");
        try {
            URL url = new URL(AppConfig.ORIGIN + "/api/files/" + attachmentId);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(120000);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new DownloadException(status);
            long expected = connection.getContentLengthLong();
            if (expected > MAX_BYTES) throw new IllegalStateException("文件超过应用保存上限");
            String responseMime = safeMime(connection.getContentType());
            String mime = "application/octet-stream".equals(requestedMime) ? responseMime : requestedMime;
            String extension = safeExtension(fileName);
            File target = new File(filesDirectory(), attachmentId + extension);
            long copied = 0;
            byte[] buffer = new byte[32 * 1024];
            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(part, false))) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    copied += count;
                    if (copied > MAX_BYTES) throw new IllegalStateException("文件超过应用保存上限");
                    output.write(buffer, 0, count);
                    emit(attachmentId, "progress", "", copied, expected);
                }
            }
            if (expected >= 0 && copied != expected) throw new IllegalStateException("文件下载不完整");
            // #region debug-point B:download-identity-compare
            reportDebug("B", "AttachmentStore.download", "下载完成校验身份", "identityNull=" + (identity == null) + ",currentNull=" + (currentIdentity == null) + ",bytes=" + copied);
            // #endregion
            if (!identity.equals(currentIdentity)) throw new IllegalStateException("登录账号已切换，保存已取消");
            deleteSavedVariants(attachmentId, part);
            if (!part.renameTo(target)) throw new IllegalStateException("无法完成文件保存");
            preferences.edit()
                    .putString(metaKey(attachmentId, "file"), target.getName())
                    .putString(metaKey(attachmentId, "mime"), mime)
                    .apply();
            if (!target.isFile()) throw new IllegalStateException("文件保存校验失败");
            emit(attachmentId, "saved", "", copied, copied);
        } catch (DownloadException error) {
            part.delete();
            String message = error.status == 410 ? "该文件已过期并自动清理"
                    : error.status == 401 || error.status == 403 ? "登录已失效，请重新登录"
                    : "文件保存失败（HTTP " + error.status + "）";
            emit(attachmentId, "failed", message, 0, 0, error.status);
        } catch (Exception error) {
            part.delete();
            emit(attachmentId, "failed", error.getMessage() == null ? "文件保存失败" : error.getMessage(), 0, 0);
        } finally {
            activeDownloads.remove(attachmentId);
            if (connection != null) connection.disconnect();
        }
    }

    private File filesDirectory() {
        File directory = new File(activity.getFilesDir(), DIRECTORY);
        if (!directory.exists()) directory.mkdirs();
        return directory;
    }

    private File savedFile(String attachmentId) {
        String name = preferences.getString(metaKey(attachmentId, "file"), "");
        if (name == null || !name.matches("^" + ID_PATTERN + "(?:\\.[A-Za-z0-9]{1,10})?$")) return null;
        File directory = filesDirectory();
        File file = new File(directory, name);
        try {
            return file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator) ? file : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void deleteSavedVariants(String attachmentId, File except) {
        File[] files = filesDirectory().listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!file.equals(except) && file.getName().matches("^" + attachmentId + "(?:\\.[A-Za-z0-9]{1,10})?$")) file.delete();
        }
    }

    private void clearDirectory(File directory) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) if (file.isFile()) file.delete();
        preferences.edit().remove("attachment_metadata_marker").apply();
    }

    private void emit(String attachmentId, String status, String message, long loaded, long total) {
        emit(attachmentId, status, message, loaded, total, 0);
    }

    private void emit(String attachmentId, String status, String message, long loaded, long total, int httpStatus) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("attachmentId", attachmentId);
            detail.put("status", status);
            detail.put("message", message);
            detail.put("loaded", loaded);
            detail.put("total", Math.max(0, total));
            if (httpStatus > 0) detail.put("httpStatus", httpStatus);
        } catch (Exception ignored) {}
        String json = detail.toString();
        String script = "window.dispatchEvent(new CustomEvent('yimeng-native-attachment',"
                + "{detail:JSON.parse(" + JSONObject.quote(json) + ")}));";
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed() && webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private String safeName(String value) {
        String cleaned = value == null ? "" : value.replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_")
                .replaceAll("^\\.+|[. ]+$", "");
        return cleaned.isEmpty() ? "下载文件" : cleaned.substring(0, Math.min(180, cleaned.length()));
    }

    private String safeExtension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        String extension = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return extension.matches("[a-z0-9]{1,10}") ? "." + extension : "";
    }

    private String safeMime(String value) {
        if (value == null) return "application/octet-stream";
        String mime = value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return mime.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+") ? mime : "application/octet-stream";
    }

    private boolean validId(String value) {
        return value != null && value.matches(ID_PATTERN);
    }

    private String metaKey(String id, String field) {
        return "attachment_" + id + "_" + field;
    }

    private void reportDebug(String hypothesisId, String location, String message, String data) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                // #region debug-point D:native-network-reporter
                JSONObject event = new JSONObject();
                event.put("sessionId", "android-attachment-null");
                event.put("runId", "post-fix");
                event.put("hypothesisId", hypothesisId);
                event.put("location", location);
                event.put("msg", "[DEBUG] " + message);
                event.put("data", data);
                event.put("ts", System.currentTimeMillis());
                connection = (HttpURLConnection) new URL("http://192.168.1.146:7777/event").openConnection();
                connection.setConnectTimeout(1000);
                connection.setReadTimeout(1000);
                connection.setDoOutput(true);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.getOutputStream().write(event.toString().getBytes(StandardCharsets.UTF_8));
                connection.getResponseCode();
                // #endregion
            } catch (Exception ignored) {
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "attachment-debug").start();
    }

    private String result(String status, String message) {
        JSONObject result = new JSONObject();
        try { result.put("status", status); result.put("message", message); } catch (Exception ignored) {}
        return result.toString();
    }

    private String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte current : bytes) result.append(String.format(Locale.ROOT, "%02x", current));
            return result.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static final class DownloadException extends Exception {
        final int status;
        DownloadException(int status) { this.status = status; }
    }
}
