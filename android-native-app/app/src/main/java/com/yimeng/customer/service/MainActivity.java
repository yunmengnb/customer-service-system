// 忆梦云团队开发
package com.yimeng.customer.service;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ProgressBar loading;
    private String pendingUrl = AppConfig.MESSAGES_URL;
    private ValueCallback<Uri[]> fileChooserCallback;
    private final ActivityResultLauncher<String> notificationPermission =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {});
    private final ActivityResultLauncher<Intent> fileChooser =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileChooserCallback == null) return;
                fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(
                        result.getResultCode(), result.getData()));
                fileChooserCallback = null;
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.web_view);
        loading = findViewById(R.id.loading);
        configureWebView();
        handleIntent(getIntent());
        requestNotificationPermission();
        startMessageService(null);
        checkForUpdates(true);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack(); else finish();
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        AppVisibility.setForeground(true);
    }

    @Override
    protected void onStop() {
        AppVisibility.setForeground(false);
        super.onStop();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new NativeBridge(), "YiMengAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loading.setVisibility(View.VISIBLE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                loading.setVisibility(View.GONE);
                installTokenObserver();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("user.ymfk.top".equalsIgnoreCase(uri.getHost()) && "https".equalsIgnoreCase(uri.getScheme())) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    fileChooser.launch(params.createIntent());
                    return true;
                } catch (RuntimeException error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }

            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message).setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
    }

    private void handleIntent(Intent intent) {
        String conversationId = intent == null ? null : intent.getStringExtra(AppConfig.EXTRA_CONVERSATION_ID);
        pendingUrl = AppConfig.conversationUrl(conversationId);
        if (webView != null) {
            String current = webView.getUrl();
            if (current == null || conversationId != null) webView.loadUrl(pendingUrl);
        }
    }

    private void installTokenObserver() {
        String script = "(function(){"
                + "if(window.__yimengNativeTokenObserver){window.__yimengNativeTokenObserver();return;}"
                + "window.__yimengNativeTokenObserver=function(){var t=sessionStorage.getItem('tenant_token')||localStorage.getItem('tenant_token')||'';YiMengAndroid.syncTenantToken(t);};"
                + "['setItem','removeItem','clear'].forEach(function(n){['localStorage','sessionStorage'].forEach(function(s){var o=Storage.prototype[n];if(!o.__yimengWrapped){var w=function(){var r=o.apply(this,arguments);if(!arguments.length||arguments[0]==='tenant_token')window.__yimengNativeTokenObserver();return r;};w.__yimengWrapped=true;Storage.prototype[n]=w;}});});"
                + "window.addEventListener('storage',window.__yimengNativeTokenObserver);"
                + "window.__yimengNativeTokenObserver();})();";
        webView.evaluateJavascript(script, null);
    }

    private void startMessageService(String token) {
        Intent service = new Intent(this, MessageSocketService.class);
        if (token != null) {
            service.setAction(MessageSocketService.ACTION_SYNC_TOKEN);
            service.putExtra(MessageSocketService.EXTRA_TOKEN, token);
        }
        ContextCompat.startForegroundService(this, service);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    private void showAboutDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.about_app)
                .setMessage(getString(R.string.app_name) + "\n版本 " + getVersionName())
                .setNeutralButton(R.string.cloud_announcements,
                        (dialog, which) -> showCloudAnnouncements())
                .setPositiveButton(R.string.check_update, (dialog, which) -> checkForUpdates(false))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private String getVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            return "";
        }
    }

    private long getVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException ignored) {
            return 1;
        }
    }

    private JSONObject getJson(String endpoint) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONObject root = new JSONObject(body.toString());
            if (root.optInt("code", -1) != 0) throw new IllegalStateException(root.optString("message"));
            return root;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showCloudAnnouncements() {
        new Thread(() -> {
            try {
                JSONObject data = getJson(AppConfig.ANNOUNCEMENTS_API_URL + "?page=1&limit=10")
                        .optJSONObject("data");
                JSONArray items = data == null ? null : data.optJSONArray("items");
                StringBuilder message = new StringBuilder();
                if (items != null) {
                    for (int index = 0; index < items.length(); index++) {
                        JSONObject item = items.optJSONObject(index);
                        if (item == null) continue;
                        if (message.length() > 0) message.append("\n\n");
                        message.append(item.optString("title", "未命名公告"));
                        String content = item.optString("content").trim();
                        if (!content.isEmpty()) message.append("\n").append(content);
                    }
                }
                runOnUiThread(() -> new AlertDialog.Builder(this)
                        .setTitle(R.string.cloud_announcements)
                        .setMessage(message.length() == 0 ? getString(R.string.no_cloud_announcements) : message)
                        .setPositiveButton(android.R.string.ok, null)
                        .setNeutralButton(R.string.view_announcement_page,
                                (dialog, which) -> webView.loadUrl(AppConfig.ANNOUNCEMENTS_URL))
                        .show());
            } catch (Exception ignored) {
                runOnUiThread(() -> Toast.makeText(
                        this, R.string.announcement_load_failed, Toast.LENGTH_SHORT).show());
            }
        }).start();
    }

    private void checkForUpdates(boolean silent) {
        new Thread(() -> {
            try {
                JSONObject root = getJson(AppConfig.VERSION_CHECK_URL + "?versionCode=" + getVersionCode());
                JSONObject data = root.optJSONObject("data");
                if (data == null) throw new IllegalStateException("Missing update data");
                boolean hasUpdate = data.optBoolean("hasUpdate", data.optBoolean("updateAvailable", false));
                JSONObject version = data.optJSONObject("version");
                JSONObject details = version == null ? data : version;
                String latestVersion = details.optString("versionName",
                        details.optString("latestVersion", details.optString("version", "")));
                String changelog = details.optString("releaseNotes",
                        details.optString("changelog", details.optString("description", "")));
                String downloadUrl = details.optString("downloadUrl", details.optString("url", ""));
                boolean forceUpdate = details.optBoolean("forceUpdate", false);
                runOnUiThread(() -> {
                    if (hasUpdate && isHttpsUrl(downloadUrl)) {
                        showUpdateDialog(latestVersion, changelog, downloadUrl, forceUpdate);
                    } else if (!silent) {
                        Toast.makeText(this, hasUpdate ? R.string.invalid_update_url : R.string.latest_version,
                                Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception ignored) {
                if (!silent) runOnUiThread(() -> Toast.makeText(
                        this, R.string.update_check_failed, Toast.LENGTH_SHORT).show());
            }
        }).start();
    }

    private boolean isHttpsUrl(String value) {
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
    }

    private void showUpdateDialog(String version, String changelog, String downloadUrl, boolean forceUpdate) {
        String title = version.isEmpty() ? "发现新版本" : "发现新版本 " + version;
        String message = changelog.isEmpty() ? "新版本已发布，是否前往下载？" : changelog;
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(R.string.download_update,
                        (dialog, which) -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))));
        if (!forceUpdate) builder.setNegativeButton(android.R.string.cancel, null);
        AlertDialog dialog = builder.create();
        dialog.setCancelable(!forceUpdate);
        dialog.setCanceledOnTouchOutside(!forceUpdate);
        dialog.show();
    }

    private final class NativeBridge {
        @JavascriptInterface public void syncTenantToken(String token) {
            runOnUiThread(() -> startMessageService(token == null ? "" : token));
        }

        @JavascriptInterface public void showAbout() {
            runOnUiThread(MainActivity.this::showAboutDialog);
        }

        @JavascriptInterface public void openCloudAnnouncements() {
            runOnUiThread(MainActivity.this::showCloudAnnouncements);
        }

        @JavascriptInterface public String getAppInfo() {
            JSONObject info = new JSONObject();
            try {
                info.put("platform", "android");
                info.put("versionName", getVersionName());
                info.put("versionCode", getVersionCode());
            } catch (Exception ignored) {}
            return info.toString();
        }

        @JavascriptInterface public void checkForUpdate() {
            runOnUiThread(() -> checkForUpdates(false));
        }

        @JavascriptInterface public void openNotificationSettings() {
            Intent settings;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            } else {
                settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getPackageName()));
            }
            startActivity(settings);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("YiMengAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
