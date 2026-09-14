package br.org.creasp.dashdb.tv;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final long RETRY_DELAY_MS = 10_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView connectionMessage;
    private boolean destroyed;
    private boolean mainFrameFailed;

    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            if (!destroyed && connectionMessage.getVisibility() == View.VISIBLE) {
                webView.reload();
                handler.postDelayed(this, RETRY_DELAY_MS);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(3, 7, 24));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(3, 7, 24));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        connectionMessage = new TextView(this);
        connectionMessage.setText(R.string.connection_error);
        connectionMessage.setTextColor(Color.WHITE);
        connectionMessage.setTextSize(24);
        connectionMessage.setGravity(Gravity.CENTER);
        connectionMessage.setBackgroundColor(Color.rgb(3, 7, 24));
        connectionMessage.setVisibility(View.GONE);
        root.addView(connectionMessage, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        enterImmersiveMode();
        webView.loadUrl(BuildConfig.DASHBOARD_URL);
        webView.requestFocus();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " DashDB-TV/1.0");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView ignored, String url, Bitmap favicon) {
                mainFrameFailed = false;
                connectionMessage.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                return !isDashboardOrigin(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView ignored, String url) {
                return !isDashboardOrigin(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView ignored, String url) {
                if (!mainFrameFailed) {
                    connectionMessage.setVisibility(View.GONE);
                    handler.removeCallbacks(retry);
                }
            }

            @Override
            public void onReceivedError(
                    WebView ignored,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    mainFrameFailed = true;
                    showConnectionError();
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView ignored, RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });
    }

    private boolean isDashboardOrigin(Uri uri) {
        Uri expected = Uri.parse(BuildConfig.DASHBOARD_URL);
        return expected.getScheme() != null
                && expected.getScheme().equalsIgnoreCase(uri.getScheme())
                && expected.getHost() != null
                && expected.getHost().equalsIgnoreCase(uri.getHost())
                && effectivePort(expected) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private void showConnectionError() {
        connectionMessage.setVisibility(View.VISIBLE);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_DELAY_MS);
    }

    @SuppressWarnings("deprecation")
    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_REFRESH) {
            webView.reload();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
