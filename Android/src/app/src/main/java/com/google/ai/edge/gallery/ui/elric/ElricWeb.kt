/*
 * Copyright 2026 Elric
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.ai.edge.gallery.ui.elric

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color as AColor
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

/** The live Elric AI web app. Android shows it when online, so web updates reach Android. */
private const val ELRIC_WEB_URL = "https://elricai.sbs/?src=android"
private const val ELRIC_WEB_HOST = "elricai.sbs"

private fun hasInternet(context: Context): Boolean {
  val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
  val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
  return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}

/**
 * Online: the latest Elric AI (web) inside the app. No internet, or the page fails to load: the
 * built-in offline app.
 */
@Composable
fun ElricRoot(content: @Composable () -> Unit) {
  val context = LocalContext.current
  var useWeb by rememberSaveable { mutableStateOf(hasInternet(context)) }
  if (useWeb) {
    ElricWebScreen(onFallback = { useWeb = false })
  } else {
    content()
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ElricWebScreen(onFallback: () -> Unit) {
  val context = LocalContext.current
  var webView by remember { mutableStateOf<WebView?>(null) }
  var canGoBack by remember { mutableStateOf(false) }
  var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
  var pendingMic by remember { mutableStateOf<PermissionRequest?>(null) }

  val fileLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val uris =
        if (result.resultCode == Activity.RESULT_OK) {
          WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        } else {
          null
        }
      fileCallback?.onReceiveValue(uris)
      fileCallback = null
    }

  val micLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      val req = pendingMic
      pendingMic = null
      if (req != null) {
        if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
      }
    }

  BackHandler(enabled = canGoBack) { webView?.goBack() }

  Box(
    modifier =
      Modifier.fillMaxSize()
        .background(Color(0xFF0E1020))
        .statusBarsPadding()
        .navigationBarsPadding()
        .imePadding()
  ) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { ctx ->
        WebView(ctx).apply {
          setBackgroundColor(AColor.parseColor("#0E1020"))
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          settings.databaseEnabled = true
          settings.mediaPlaybackRequiresUserGesture = false
          settings.allowFileAccess = false
          settings.allowContentAccess = true
          settings.userAgentString = settings.userAgentString + " ElricAndroid/0.5.0"

          addJavascriptInterface(
            object {
              /** Lets the web page switch to the built-in offline app. */
              @JavascriptInterface
              fun openOffline() {
                Handler(Looper.getMainLooper()).post { onFallback() }
              }
            },
            "ElricAndroid",
          )

          webViewClient =
            object : WebViewClient() {
              override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
              ): Boolean {
                val url = request.url
                val host = url.host ?: ""
                if (url.scheme == "https" && (host == ELRIC_WEB_HOST || host.endsWith(".$ELRIC_WEB_HOST"))) {
                  return false
                }
                // Shops, sources, WhatsApp, mail: open outside the app.
                try {
                  ctx.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) {}
                return true
              }

              override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                canGoBack = view.canGoBack()
              }

              override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
              ) {
                // The page itself could not load (no internet, site down): use the offline app.
                if (request.isForMainFrame) onFallback()
              }
            }

          webChromeClient =
            object : WebChromeClient() {
              override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
              ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                  fileLauncher.launch(params.createIntent())
                  true
                } catch (_: Exception) {
                  fileCallback = null
                  false
                }
              }

              override fun onPermissionRequest(request: PermissionRequest) {
                if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                  request.deny()
                  return
                }
                val has =
                  ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED
                if (has) {
                  request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                  pendingMic = request
                  micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
              }
            }

          loadUrl(ELRIC_WEB_URL)
          webView = this
        }
      },
    )
  }
}
