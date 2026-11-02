package ai.x.grokbuild.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.stream.Collectors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 2001;
    private static final int QR_SCANNER_REQUEST = 2002;
    private static final String PREFS = "grok_remote";
    private static final String SERVER_URL = "server_url";

    private WebView webView;
    private String remoteOrigin;
    private boolean loadingRemote;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String previousCrash = CrashLog.consume(this);
        CrashLog.install(this);
        getWindow().setStatusBarColor(Color.rgb(215, 223, 220));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        setContentView(webView);
        configureWebView();
        if (previousCrash != null) showPreviousCrash(previousCrash);

        Uri deepLink = getIntent().getData();
        if (deepLink != null && "grokremote".equals(deepLink.getScheme())) {
            if ("scan".equals(deepLink.getHost())) {
                showLauncher();
                startQrScan();
            } else {
                connect(deepLink.getQueryParameter("url"));
            }
        } else {
            showLauncher();
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " GrokRemoteAndroid/0.1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        webView.addJavascriptInterface(new LauncherBridge(), "GrokRemoteLauncher");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (RuntimeException error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && loadingRemote) {
                    loadingRemote = false;
                    Toast.makeText(MainActivity.this, "无法连接电脑，请检查地址和局域网", Toast.LENGTH_LONG).show();
                    showLauncher();
                }
            }
        });
    }

    private boolean handleNavigation(Uri uri) {
        if ("grokremote".equals(uri.getScheme()) && "connect".equals(uri.getHost())) {
            connect(uri.getQueryParameter("url"));
            return true;
        }
        if ("grokremote".equals(uri.getScheme()) && "scan".equals(uri.getHost())) {
            startQrScan();
            return true;
        }
        if (isHttp(uri)) {
            String origin = originOf(uri);
            if (remoteOrigin == null || remoteOrigin.equals(origin)) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }
        return true;
    }

    private void startQrScan() {
        try {
            startActivityForResult(new Intent(this, QrScannerActivity.class), QR_SCANNER_REQUEST);
        } catch (RuntimeException error) {
            Toast.makeText(this, "无法启动相机扫码，请检查相机权限", Toast.LENGTH_LONG).show();
        }
    }

    private void showPreviousCrash(String report) {
        new AlertDialog.Builder(this)
                .setTitle("上次崩溃详情")
                .setMessage(report)
                .setPositiveButton("复制", (dialog, which) -> {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newPlainText("Grok Remote crash", report));
                    Toast.makeText(this, "崩溃详情已复制", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private final class LauncherBridge {
        @JavascriptInterface
        public void scanQr() {
            runOnUiThread(() -> {
                if (remoteOrigin == null) startQrScan();
            });
        }
    }

    private void connectQrResult(String contents) {
        Uri scanned = Uri.parse(contents == null ? "" : contents.trim());
        if ("grokremote".equals(scanned.getScheme()) && "connect".equals(scanned.getHost())) {
            connect(scanned.getQueryParameter("url"));
        } else {
            connect(contents);
        }
    }

    private void connect(String value) {
        Uri target;
        try {
            target = Uri.parse(value == null ? "" : value.trim());
        } catch (RuntimeException error) {
            showInvalidAddress();
            return;
        }
        if (!isHttp(target) || target.getHost() == null) {
            showInvalidAddress();
            return;
        }

        remoteOrigin = originOf(target);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SERVER_URL, remoteOrigin).apply();
        loadingRemote = true;
        webView.loadUrl(target.toString());
    }

    private void showInvalidAddress() {
        Toast.makeText(this, "电脑地址无效", Toast.LENGTH_SHORT).show();
        showLauncher();
    }

    private void showLauncher() {
        loadingRemote = false;
        remoteOrigin = null;
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = preferences.getString(SERVER_URL, "");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                getAssets().open("launcher.html"), StandardCharsets.UTF_8))) {
            String html = reader.lines().collect(Collectors.joining("\n"));
            String base = "https://appassets.androidplatform.net/launcher/?url=" + Uri.encode(saved);
            webView.loadDataWithBaseURL(base, html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            Toast.makeText(this, "无法加载启动页", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean isHttp(Uri uri) {
        return "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
    }

    private static String originOf(Uri uri) {
        StringBuilder origin = new StringBuilder();
        origin.append(uri.getScheme()).append("://").append(uri.getEncodedAuthority()).append("/");
        return origin.toString();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == QR_SCANNER_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                connectQrResult(data.getStringExtra(QrScannerActivity.EXTRA_QR_TEXT));
            }
            return;
        }
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int index = 0; index < count; index++) {
                    results[index] = data.getClipData().getItemAt(index).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else if (remoteOrigin != null) showLauncher();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) filePathCallback.onReceiveValue(null);
        webView.destroy();
        super.onDestroy();
    }
}
