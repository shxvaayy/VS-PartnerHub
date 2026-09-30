package com.vijaysoftwaresolutions.partnerhub;

import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private static final String CONNECTION_LOG = "PartnerHubConnection";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Log.w(CONNECTION_LOG, "Workspace load failed: code=" + error.getErrorCode()
                        + " host=" + request.getUrl().getHost());
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) {
                    Log.w(CONNECTION_LOG, "Workspace HTTP failure: status=" + response.getStatusCode()
                        + " host=" + request.getUrl().getHost());
                }
                super.onReceivedHttpError(view, request, response);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                Log.w(CONNECTION_LOG, "Workspace TLS verification failed: code=" + error.getPrimaryError()
                    + " host=" + Uri.parse(error.getUrl()).getHost());
                // Preserve Android's default rejection of an untrusted certificate.
                super.onReceivedSslError(view, handler, error);
            }
        });
    }
}
