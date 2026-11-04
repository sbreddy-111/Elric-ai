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
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.StatFs
import android.speech.tts.TextToSpeech
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.google.ai.edge.gallery.BuildConfig
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.data.ModelDownloadStatusType
import com.google.ai.edge.gallery.data.Task
import com.google.ai.edge.gallery.proto.Theme
import com.google.ai.edge.gallery.ui.common.tos.AppTosDialog
import com.google.ai.edge.gallery.ui.common.tos.TosViewModel
import com.google.ai.edge.gallery.ui.modelmanager.ModelManagerViewModel
import com.google.ai.edge.gallery.ui.theme.ThemeSettings
import com.google.android.gms.oss.licenses.OssLicensesMenuActivity
import java.util.Calendar
import java.util.Locale
import kotlinx.coroutines.delay

private enum class Screen {
  SPLASH,
  ONBOARD,
  ABOUT,
  DOWNLOAD,
  HOME,
  CHAT,
  MODELS,
  PRIVACY,
  MEMORY,
  PROFILE,
}

private enum class Overlay {
  NONE,
  MODE,
  DRAWER,
  CAMERA,
  ABOUT_APP,
  FEEDBACK,
}

private val LITE_NAME = Regex("(?i)^gemma[-_ ]?4[-_ ]?e2b[-_ ]?it$")
private val STANDARD_NAME = Regex("(?i)^gemma[-_ ]?4[-_ ]?e4b[-_ ]?it$")

/** The Elric Lite and Elric Standard models of the chat task, when the model list has loaded. */
private fun elricModels(task: Task?): Pair<Model?, Model?> {
  val models = task?.models?.toList().orEmpty()
  val lite =
    models.firstOrNull { LITE_NAME.matches(it.name) }
      ?: models.firstOrNull { elricModelDisplayName(it.name) == "Elric Lite" }
  val standard =
    models.firstOrNull { STANDARD_NAME.matches(it.name) }
      ?: models.firstOrNull { elricModelDisplayName(it.name) == "Elric Standard" }
  return lite to standard
}

/** Elric AI: the whole app, as approved in the Android UI design. */
@Composable
fun ElricApp(
  modelManagerViewModel: ModelManagerViewModel,
  tosViewModel: TosViewModel,
  modifier: Modifier = Modifier,
) {
  val vm: ElricViewModel = hiltViewModel()
  val context = LocalContext.current
  val mmState by modelManagerViewModel.uiState.collectAsState()

  val light = ThemeSettings.themeOverride.value == Theme.THEME_LIGHT
  val palette = if (light) ElricLightPalette else ElricDarkPalette

  // Models.
  val chatTask = mmState.tasks.firstOrNull { it.id == BuiltInTaskId.LLM_CHAT }
  val (lite, standard) = elricModels(chatTask)
  val statuses = mmState.modelDownloadStatus
  val downloaded = listOfNotNull(lite, standard).filter { statuses[it.name].isDownloaded() }
  val currentModel =
    downloaded.firstOrNull { it.name == vm.activeModelName } ?: downloaded.firstOrNull()
  val listError = mmState.loadingModelAllowlistError.isNotEmpty()

  // Navigation.
  var screen by rememberSaveable {
    mutableStateOf(if (!vm.onboarded) Screen.SPLASH else if (vm.turns.isNotEmpty()) Screen.CHAT else Screen.HOME)
  }
  var returnTo by rememberSaveable { mutableStateOf(Screen.HOME) }
  var profileReturn by rememberSaveable { mutableStateOf(Screen.HOME) }
  var overlay by rememberSaveable { mutableStateOf(Overlay.NONE) }
  var input by rememberSaveable { mutableStateOf("") }
  var toast by remember { mutableStateOf<String?>(null) }
  var toastSeq by remember { mutableStateOf(0) }
  var showTos by remember { mutableStateOf(!tosViewModel.getIsTosAccepted()) }
  val offline = !rememberOnline()

  // Feedback sheet (opened by 👎). Nothing is sent until the user taps Send.
  var fbIndex by remember { mutableStateOf(-1) }
  var fbKind by remember { mutableStateOf("wrong_answer") }
  var fbNote by remember { mutableStateOf("") }
  var fbInclude by remember { mutableStateOf(false) }
  var fbSending by remember { mutableStateOf(false) }

  fun showToast(msg: String) {
    toast = msg
    toastSeq++
  }
  LaunchedEffect(toastSeq) {
    if (toast != null) {
      delay(1600)
      toast = null
    }
  }

  fun go(s: Screen) {
    overlay = Overlay.NONE
    if (vm.voiceState == ElricVoiceState.RECORDING) vm.cancelVoice()
    vm.stopTalk()
    screen = s
  }

  fun openFromMenu(s: Screen) {
    returnTo = if (screen == Screen.CHAT) Screen.CHAT else Screen.HOME
    go(s)
  }

  // Settings live on the Profile page (drawer avatar); its sub-screens come back to it.
  fun openProfile() {
    if (screen != Screen.PROFILE) profileReturn = if (screen == Screen.CHAT) Screen.CHAT else Screen.HOME
    go(Screen.PROFILE)
  }

  fun openFromProfile(s: Screen) {
    returnTo = Screen.PROFILE
    go(s)
  }

  fun ask(text: String) {
    val q = text.trim()
    if ((q.isEmpty() && vm.attachment == null) || vm.busy || vm.voiceState != ElricVoiceState.IDLE) return
    vm.send(q, currentModel)
    input = ""
    if (screen != Screen.CHAT) go(Screen.CHAT)
  }

  fun newChat() {
    vm.newChat()
    input = ""
    go(Screen.HOME)
  }

  // Downloads. Notifications show download progress; the download runs either way.
  var pendingDownload by remember { mutableStateOf<Model?>(null) }
  fun startDownload(model: Model) {
    vm.updateActiveModel(model.name)
    if (modelManagerViewModel.downloadClickAction(model) is
        com.google.ai.edge.gallery.ui.modelmanager.DownloadClickAction.ResolveAuth
    ) {
      showToast(T.needsAccess.get(vm.lang))
      return
    }
    modelManagerViewModel.downloadModelAfterMobileDataCheck(task = chatTask, model = model)
  }
  val notifLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
      pendingDownload?.let { startDownload(it) }
      pendingDownload = null
    }
  fun download(model: Model) {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      pendingDownload = model
      notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      startDownload(model)
    }
  }

  // Offline mode: the offline model is downloaded only when the user turns it on (with progress
  // and Cancel). Off means online answers only; the model may stay on the phone.
  var offlineDialog by remember { mutableStateOf(false) }
  var offlineOffDialog by remember { mutableStateOf(false) }
  val offlineSize =
    (lite ?: standard)?.downloadInfo?.totalBytes?.takeIf { it > 0 }?.let { gbText(it) } ?: "1.4 GB"
  val downloadingModel = listOfNotNull(lite, standard).firstOrNull { statuses[it.name].isDownloading() }
  val offlineTarget = downloadingModel ?: lite ?: standard
  val hasOffline = vm.offlineOn && downloaded.isNotEmpty()
  fun requestOffline() {
    if (downloaded.isNotEmpty()) {
      vm.updateOfflineOn(true)
      showToast(T.offlineOnToast.get(vm.lang))
    } else {
      offlineDialog = true
    }
  }
  fun toggleOffline() {
    when {
      !vm.offlineOn -> requestOffline()
      downloaded.isEmpty() -> offlineDialog = true
      else -> offlineOffDialog = true
    }
  }

  // Voice: recorded on the phone (at most 30 s) and turned into text by the on-device model.
  fun finishVoice() {
    vm.finishRecording(
      model = currentModel,
      onText = { text ->
        input = if (input.isBlank()) text else input.trimEnd() + " " + text
        showToast(T.voiceCheck.get(vm.lang))
      },
      onError = { msg ->
        showToast(msg.get(vm.lang))
        if (msg === T.voiceNeedModel) requestOffline()
      },
    )
  }
  fun beginRecording() {
    if (!vm.startRecording(onMax = { finishVoice() })) showToast(T.voiceUnavailable.get(vm.lang))
  }
  var micForTalk by remember { mutableStateOf(false) }
  fun beginTalk() {
    val err = vm.startTalk(currentModel)
    if (err != null) {
      showToast(err.get(vm.lang))
      if (err === T.voiceNeedModel) requestOffline()
    } else if (screen != Screen.CHAT) {
      // Talk turns are saved in the chat, which shows when Talk ends.
      screen = Screen.CHAT
    }
  }
  val micLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (!granted) showToast(T.micNeeded.get(vm.lang)) else if (micForTalk) beginTalk() else beginRecording()
    }
  fun startTalk() {
    overlay = Overlay.NONE
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      beginTalk()
    } else {
      micForTalk = true
      micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
  }
  fun startMic() {
    overlay = Overlay.NONE
    if (vm.busy) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      beginRecording()
    } else {
      micForTalk = false
      micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
  }

  // Photo: from the camera or the gallery, read on the phone by the on-device model.
  val photoFailed = { showToast(T.photoFailed.get(vm.lang)) }
  val galleryLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
      if (uri != null) vm.attachPhoto(uri, photoFailed)
    }
  val cameraUri = remember { ElricImages.cameraUri(context) }
  val cameraLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
      if (ok) vm.attachPhoto(cameraUri, photoFailed)
    }
  val cameraPermLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) cameraLauncher.launch(cameraUri) else showToast(T.cameraNeeded.get(vm.lang))
    }
  fun takePhoto() {
    overlay = Overlay.NONE
    try {
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
          PackageManager.PERMISSION_GRANTED
      ) {
        cameraLauncher.launch(cameraUri)
      } else {
        cameraPermLauncher.launch(Manifest.permission.CAMERA)
      }
    } catch (e: Exception) {
      showToast(T.photoFailed.get(vm.lang))
    }
  }
  fun pickPhoto() {
    overlay = Overlay.NONE
    try {
      galleryLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    } catch (e: Exception) {
      showToast(T.photoFailed.get(vm.lang))
    }
  }
  val tts = rememberTts()

  // Back handling.
  val voiceActive = vm.voiceState != ElricVoiceState.IDLE || vm.talkState != ElricTalkState.OFF
  BackHandler(enabled = voiceActive) {
    if (vm.talkState != ElricTalkState.OFF) vm.stopTalk() else vm.cancelVoice()
  }
  BackHandler(enabled = overlay != Overlay.NONE) { overlay = Overlay.NONE }
  BackHandler(enabled = overlay == Overlay.NONE && !voiceActive && screen in setOf(Screen.CHAT, Screen.MODELS, Screen.PRIVACY, Screen.MEMORY, Screen.DOWNLOAD, Screen.PROFILE) ||
    (overlay == Overlay.NONE && !voiceActive && screen == Screen.ABOUT && vm.onboarded)) {
    when (screen) {
      Screen.CHAT -> newChat()
      Screen.DOWNLOAD -> go(Screen.HOME)
      Screen.PROFILE -> go(profileReturn)
      Screen.ABOUT -> go(returnTo)
      else -> go(returnTo)
    }
  }
  BackHandler(enabled = overlay == Overlay.NONE && screen == Screen.ABOUT && !vm.onboarded) {
    go(Screen.ONBOARD)
  }

  CompositionLocalProvider(LocalElricPalette provides palette, LocalElricLang provides vm.lang) {
    Box(
      modifier =
        modifier.fillMaxSize().background(palette.bg).statusBarsPadding().navigationBarsPadding().imePadding()
    ) {
      AnimatedContent(
        targetState = screen,
        transitionSpec = {
          (fadeIn(tween(250, easing = ElricEase)) +
            slideInVertically(tween(250, easing = ElricEase)) { 24 }) togetherWith
            fadeOut(tween(200, easing = ElricEase))
        },
        label = "screen",
      ) { s ->
        when (s) {
          Screen.SPLASH -> SplashScreen(onDone = { if (screen == Screen.SPLASH) go(Screen.HOME) })
          Screen.ONBOARD ->
            OnboardingScreen(
              lang = vm.lang,
              onLang = { vm.updateLang(it) },
              onDone = { go(Screen.HOME) },
            )
          Screen.ABOUT ->
            AboutYouScreen(
              initialName = vm.name,
              initialStudy = vm.study,
              showBack = true,
              buttonText = if (vm.onboarded) tr(T.save) else tr(T.cont),
              onBack = { if (vm.onboarded) go(returnTo) else go(Screen.ONBOARD) },
              onContinue = { n, st ->
                vm.updateProfile(n, st)
                if (vm.onboarded) {
                  go(returnTo)
                } else {
                  go(Screen.HOME)
                }
              },
            )
          Screen.DOWNLOAD ->
            DownloadScreen(
              lite = lite,
              standard = standard,
              statuses = statuses,
              listLoading = mmState.loadingModelAllowlist,
              listError = listError,
              onRetryList = { modelManagerViewModel.loadModelAllowlist() },
              onDownload = {
                vm.updateOfflineOn(true)
                download(it)
              },
              onBack = { go(Screen.HOME) },
              onReady = { m ->
                vm.updateActiveModel(m.name)
                go(Screen.HOME)
              },
              canChatOnline = vm.onlineOn && !offline,
              onChatOnline = { go(Screen.HOME) },
              onCancel = { m -> modelManagerViewModel.cancelDownloadModel(m) },
            )
          Screen.HOME,
          Screen.CHAT ->
            Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
              val isChat = s == Screen.CHAT
              ElricTopBar(
                isChat = isChat,
                mode = vm.mode,
                onLeft = {
                  if (isChat) {
                    newChat()
                  } else {
                    overlay = Overlay.DRAWER
                  }
                },
                onMode = { overlay = Overlay.MODE },
                onNewChat = { newChat() },
              )
              if (isChat) {
                ChatThread(
                  turns = vm.turns,
                  busy = vm.busy,
                  engine = vm.engine,
                  loadStartedAt = vm.loadStartedAt,
                  firstStart = vm.firstStart,
                  mediaLoading = vm.mediaLoading,
                  needsModel = vm.needsModel,
                  streamTick = vm.streamTick,
                  onEdit = { i -> vm.editQuestion(i)?.let { input = it } },
                  onCopy = { text ->
                    val cm = context.getSystemService(ClipboardManager::class.java)
                    cm?.setPrimaryClip(ClipData.newPlainText("Elric AI", text))
                    showToast(T.copied.get(vm.lang))
                  },
                  onSpeak = { text ->
                    tts.speak(text, vm.lang)
                    showToast(T.readingAloud.get(vm.lang))
                  },
                  onRegenerate = { vm.regenerate(currentModel) },
                  onRate = { i, v ->
                    val was = vm.turns.getOrNull(i)?.rating
                    vm.rate(i, v)
                    if (v == -1 && was != -1) {
                      fbIndex = i
                      fbKind = "wrong_answer"
                      fbNote = ""
                      fbInclude = false
                      overlay = Overlay.FEEDBACK
                    }
                  },
                  onFollow = { ask(it) },
                  needText =
                    tr(
                      when {
                        downloaded.isNotEmpty() && !vm.offlineOn -> T.needTurnOnOffline
                        vm.onlineOn && vm.needsModelLimit -> T.needLimit
                        vm.onlineOn -> T.needNoNet
                        else -> T.needOffline
                      }
                    ),
                  needButton =
                    tr(if (downloaded.isNotEmpty()) T.turnOnOffline else T.downloadOfflineModel) +
                      if (downloaded.isEmpty()) " · $offlineSize" else "",
                  onNeedAction = { requestOffline() },
                  modifier = Modifier.weight(1f).fillMaxWidth(),
                )
              } else {
                HomeContent(
                  mode = vm.mode,
                  offline = offline,
                  online = vm.onlineOn && !offline,
                  hasOffline = hasOffline,
                  showOfflineTip = !vm.offlineOn && downloadingModel == null,
                  name = vm.name,
                  onSuggestion = { i, text ->
                    if (i == 1) {
                      overlay = Overlay.CAMERA
                    } else {
                      ask(text)
                    }
                  },
                  modifier = Modifier.weight(1f),
                )
              }
              if (isChat && vm.askReports && !vm.busy) {
                ReportsAskCard(
                  onYes = { vm.updateReportsOn(true) },
                  onNo = { vm.dismissReportsAsk() },
                )
              }
              Composer(
                value = input,
                onValueChange = { input = it },
                busy = vm.busy,
                attachment = vm.attachment,
                voiceState = vm.voiceState,
                voiceMs = vm.voiceMs,
                onPhoto = { overlay = Overlay.CAMERA },
                onRemovePhoto = { vm.removeAttachment() },
                onMic = { startMic() },
                onFinishVoice = { finishVoice() },
                onCancelVoice = { vm.cancelVoice() },
                onTalk = { startTalk() },
                onSend = { ask(input) },
                onStop = { vm.stop() },
              )
            }
          Screen.MODELS ->
            ModelsScreen(
              lite = lite,
              standard = standard,
              statuses = statuses,
              activeName = currentModel?.name,
              listLoading = mmState.loadingModelAllowlist,
              listError = listError,
              onRetryList = { modelManagerViewModel.loadModelAllowlist() },
              totalStorageBytes = remember { totalStorage(context) },
              onBack = { go(returnTo) },
              onDownload = {
                vm.updateOfflineOn(true)
                download(it)
              },
              onRemove = { m ->
                vm.releaseModel(m) { modelManagerViewModel.deleteModel(m) }
                if (vm.activeModelName == m.name) vm.updateActiveModel("")
              },
              onUse = { m -> vm.updateActiveModel(m.name) },
            )
          Screen.PRIVACY ->
            PrivacyScreen(
              reportsOn = vm.reportsOn,
              onReports = { vm.updateReportsOn(it) },
              onBack = { go(returnTo) },
            )
          Screen.MEMORY ->
            MemoryScreen(
              memories = vm.memories,
              on = vm.memoryOn,
              onToggle = { vm.updateMemoryOn(it) },
              onDelete = { vm.deleteMemory(it) },
              onClearAll = { vm.clearMemories() },
              onBack = { go(returnTo) },
            )
          Screen.PROFILE ->
            ProfileScreen(
              vm = vm,
              light = light,
              showModels = downloaded.isNotEmpty(),
              modelValue = currentModel?.let { elricModelDisplayName(it.name) } ?: "",
              offlineOn = vm.offlineOn,
              offlineReady = downloaded.isNotEmpty(),
              offlineSize = offlineSize,
              offlinePct = downloadingModel?.let { (statuses[it.name].fraction(it) * 100).toInt() },
              onClose = { go(profileReturn) },
              onAboutYou = { openFromProfile(Screen.ABOUT) },
              onOffline = { toggleOffline() },
              onModels = { openFromProfile(Screen.MODELS) },
              onMemory = { openFromProfile(Screen.MEMORY) },
              onPrivacy = { openFromProfile(Screen.PRIVACY) },
              onAboutApp = { overlay = Overlay.ABOUT_APP },
              onLicenses = { context.startActivity(Intent(context, OssLicensesMenuActivity::class.java)) },
              onTheme = { wantLight ->
                val t = if (wantLight) Theme.THEME_LIGHT else Theme.THEME_DARK
                ThemeSettings.themeOverride.value = t
                modelManagerViewModel.saveThemeOverride(t)
              },
            )
        }
      }

      Toast(toast)

      // 7 mode sheet.
      BottomSheetOverlay(visible = overlay == Overlay.MODE, onDismiss = { overlay = Overlay.NONE }) {
        ModeSheet(
          mode = vm.mode,
          short = vm.short,
          offline = offline,
          onMode = { vm.updateMode(it) },
          onShort = { vm.updateShort(it) },
          onDone = { overlay = Overlay.NONE },
        )
      }

      // 11 camera sheet.
      BottomSheetOverlay(visible = overlay == Overlay.CAMERA, onDismiss = { overlay = Overlay.NONE }) {
        SheetOption("◉", tr(T.takePhoto), null, false) { takePhoto() }
        SheetOption("▣", tr(T.chooseGallery), null, false) { pickPhoto() }
        TinyText(
          tr(T.photoPrivate),
          modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        )
      }

      // Feedback sheet (👎).
      BottomSheetOverlay(visible = overlay == Overlay.FEEDBACK, onDismiss = { overlay = Overlay.NONE }) {
        EText(tr(T.fbTitle), size = 18.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
        SheetOption("✕", tr(T.fbWrong), null, fbKind == "wrong_answer") { fbKind = "wrong_answer" }
        SheetOption("◌", tr(T.fbNotHelpful), null, fbKind == "thumbs_down") { fbKind = "thumbs_down" }
        FeedbackNote(value = fbNote, onValueChange = { fbNote = it.take(1000) })
        Row(
          modifier =
            Modifier.fillMaxWidth()
              .clip(RoundedCornerShape(12.dp))
              .clickable { fbInclude = !fbInclude }
              .padding(vertical = 4.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Checkbox(
            checked = fbInclude,
            onCheckedChange = { fbInclude = it },
            colors =
              CheckboxDefaults.colors(
                checkedColor = pal().gold,
                uncheckedColor = pal().muted,
                checkmarkColor = pal().onGold,
              ),
          )
          EText(tr(T.fbInclude), size = 14.sp)
        }
        TinyText(tr(T.fbOnlySend), modifier = Modifier.padding(horizontal = 4.dp))
        Row(
          modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
          horizontalArrangement = Arrangement.End,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          TextBtn(tr(T.cancel), onClick = { overlay = Overlay.NONE })
          GoldButton(
            tr(T.send),
            enabled = !fbSending,
            small = true,
            onClick = {
              fbSending = true
              vm.sendFeedback(fbIndex, fbKind, fbNote, fbInclude) { ok ->
                fbSending = false
                if (ok) {
                  overlay = Overlay.NONE
                  showToast(T.fbThanks.get(vm.lang))
                } else {
                  showToast(T.fbFailed.get(vm.lang))
                }
              }
            },
          )
        }
      }

      // About app sheet.
      BottomSheetOverlay(visible = overlay == Overlay.ABOUT_APP, onDismiss = { overlay = Overlay.NONE }) {
        Column(
          modifier = Modifier.fillMaxWidth(),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          EText(tr(T.brand), size = 22.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
          EText(tr(T.tagline), color = pal().muted)
          TinyText(tr(T.aboutLine, "v" to BuildConfig.VERSION_NAME))
          TextBtn(
            tr(T.licenses),
            onClick = {
              overlay = Overlay.NONE
              context.startActivity(Intent(context, OssLicensesMenuActivity::class.java))
            },
            color = pal().goldInk,
          )
        }
      }

      // 8 drawer.
      Scrim(visible = overlay == Overlay.DRAWER, onDismiss = { overlay = Overlay.NONE })
      AnimatedVisibility(
        visible = overlay == Overlay.DRAWER,
        enter = slideInHorizontally(tween(300, easing = ElricEase)) { -it },
        exit = slideOutHorizontally(tween(300, easing = ElricEase)) { -it },
      ) {
        ElricDrawer(
          vm = vm,
          onClose = { overlay = Overlay.NONE },
          onOpenChat = { id ->
            vm.openChat(id)
            input = ""
            go(Screen.CHAT)
          },
          onNewChat = { newChat() },
          onTalk = { startTalk() },
          onPhoto = { overlay = Overlay.CAMERA },
          onProfile = { openProfile() },
        )
      }

      // Talk: full screen over everything while it is on.
      if (vm.talkState != ElricTalkState.OFF) {
        Box(modifier = Modifier.fillMaxSize().background(palette.bg)) {
          TalkView(
            state = vm.talkState,
            muted = vm.talkMuted,
            level = vm.talkLevel,
            caption = vm.talkCaption,
            onTap = { vm.tapTalk() },
            onMute = { vm.toggleTalkMute() },
            onEnd = { vm.stopTalk() },
          )
        }
      }
    }

    if (offlineDialog) {
      val m = offlineTarget
      val st = m?.let { statuses[it.name] }
      val isDl = st.isDownloading()
      val isReady = downloaded.isNotEmpty()
      val isFailed =
        !isDl &&
          (st?.status == ModelDownloadStatusType.FAILED ||
            st?.status == ModelDownloadStatusType.PARTIALLY_DOWNLOADED)
      AlertDialog(
        onDismissRequest = { offlineDialog = false },
        containerColor = palette.surface,
        title = {
          EText(tr(if (isReady) T.offlineMode else T.offlineDlTitle), size = 17.sp, weight = FontWeight.SemiBold)
        },
        text = {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (isReady) {
              EText(tr(T.offlineReadyMsg), size = 14.sp, color = palette.muted)
            } else if (m == null) {
              if (listError) Banner(tr(T.listFailed), warn = true) else TinyText(tr(T.gettingReady))
            } else {
              EText(tr(T.offlineDlBody, "size" to offlineSize), size = 14.sp, color = palette.muted)
              TinyText(tr(T.offlineWifi))
              if (isDl || (st?.receivedBytes ?: 0L) > 0L) {
                GradBar(st.fraction(m))
                val total = st?.totalBytes?.takeIf { it > 0 } ?: m.downloadInfo.totalBytes
                TinyText(tr(T.ofGb, "done" to gbText(st?.receivedBytes ?: 0L), "total" to gbText(total)))
              }
              if (isFailed) Banner(tr(T.dlFailed), warn = true)
            }
          }
        },
        confirmButton = {
          if (isReady) {
            TextButton(onClick = { offlineDialog = false }) {
              EText(tr(T.done), color = palette.goldInk, weight = FontWeight.SemiBold)
            }
          } else if (m == null) {
            TextButton(onClick = { modelManagerViewModel.loadModelAllowlist() }) {
              EText(tr(T.retry), color = palette.goldInk, weight = FontWeight.SemiBold)
            }
          } else if (isDl) {
            TextButton(onClick = { offlineDialog = false }) {
              EText(tr(T.hide), color = palette.goldInk, weight = FontWeight.SemiBold)
            }
          } else {
            TextButton(
              onClick = {
                vm.updateOfflineOn(true)
                download(m)
              }
            ) {
              EText(tr(if (isFailed) T.resume else T.download), color = palette.goldInk, weight = FontWeight.SemiBold)
            }
          }
        },
        dismissButton = {
          if (!isReady) {
            if (m != null && isDl) {
              TextButton(
                onClick = {
                  modelManagerViewModel.cancelDownloadModel(m)
                  vm.updateOfflineOn(false)
                  offlineDialog = false
                }
              ) {
                EText(tr(T.cancelDownload), color = palette.danger)
              }
            } else {
              TextButton(
                onClick = {
                  vm.updateOfflineOn(false)
                  offlineDialog = false
                }
              ) {
                EText(tr(T.notNow), color = palette.muted)
              }
            }
          }
        },
      )
    }

    if (offlineOffDialog) {
      val size =
        downloaded.sumOf { it.downloadInfo.totalBytes }.takeIf { it > 0 }?.let { gbText(it) } ?: offlineSize
      AlertDialog(
        onDismissRequest = { offlineOffDialog = false },
        containerColor = palette.surface,
        title = { EText(tr(T.offlineOffTitle), size = 17.sp, weight = FontWeight.SemiBold) },
        text = { EText(tr(T.offlineOffBody, "size" to size), size = 14.sp, color = palette.muted) },
        confirmButton = {
          TextButton(
            onClick = {
              offlineOffDialog = false
              vm.updateOfflineOn(false)
            }
          ) {
            EText(tr(T.keep), color = palette.goldInk, weight = FontWeight.SemiBold)
          }
        },
        dismissButton = {
          TextButton(
            onClick = {
              offlineOffDialog = false
              vm.updateOfflineOn(false)
              for (m in downloaded) {
                vm.releaseModel(m) { modelManagerViewModel.deleteModel(m) }
              }
              vm.updateActiveModel("")
            }
          ) {
            EText(tr(T.deleteModel), color = palette.danger)
          }
        },
      )
    }

    // First launch (new installs): one short welcome dialog over the chat. Continue confirms 18+
    // and starts online; "Under 18?" keeps online off and offers the offline download.
    if (!vm.onboarded && screen == Screen.HOME) {
      fun finishWelcome() {
        if (showTos) {
          showTos = false
          tosViewModel.acceptTos()
        }
        vm.finishOnboarding()
      }
      AlertDialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        containerColor = palette.surface,
        title = {
          Row(verticalAlignment = Alignment.CenterVertically) {
            EText(tr(T.welcomeTitle), size = 18.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            EText(
              if (vm.lang == ElricLang.HI) "English" else "हिन्दी",
              size = 13.sp,
              color = palette.goldInk,
              weight = FontWeight.Medium,
              modifier =
                Modifier.clip(CircleShape)
                  .clickable { vm.updateLang(if (vm.lang == ElricLang.HI) ElricLang.EN else ElricLang.HI) }
                  .padding(horizontal = 8.dp, vertical = 6.dp),
            )
          }
        },
        text = {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            EText(tr(T.welcomePrivacy), size = 14.sp, color = palette.muted)
            EText(tr(T.welcomeAge), size = 14.sp, color = palette.text)
          }
        },
        confirmButton = {
          TextButton(
            onClick = {
              vm.confirmAge18AndGoOnline()
              vm.updateOfflineOn(false)
              finishWelcome()
            }
          ) {
            EText(tr(T.welcomeContinue), color = palette.goldInk, weight = FontWeight.SemiBold)
          }
        },
        dismissButton = {
          TextButton(
            onClick = {
              vm.updateOnlineOn(false)
              vm.updateOfflineOn(false)
              finishWelcome()
              requestOffline()
            }
          ) {
            EText(tr(T.welcomeUnder18), size = 13.sp, color = palette.muted)
          }
        },
      )
    }

    if (showTos && vm.onboarded && screen == Screen.HOME) {
      AppTosDialog(
        onTosAccepted = {
          showTos = false
          tosViewModel.acceptTos()
        }
      )
    }
  }
}

// ------------------------------------------------------------------ mode sheet

@Composable
private fun ModeSheet(
  mode: ElricMode,
  short: Boolean,
  offline: Boolean,
  onMode: (ElricMode) -> Unit,
  onShort: (Boolean) -> Unit,
  onDone: () -> Unit,
) {
  val p = pal()
  SecLabel(tr(T.modeSec))
  SheetOption("◎", tr(T.study), tr(T.studyDesc), mode == ElricMode.STUDY) { onMode(ElricMode.STUDY) }
  SheetOption("◴", tr(T.shopping), tr(T.shoppingDesc), mode == ElricMode.SHOPPING) {
    onMode(ElricMode.SHOPPING)
  }
  SheetOption("✦", tr(T.general), tr(T.generalDesc), mode == ElricMode.GENERAL) { onMode(ElricMode.GENERAL) }
  if (mode == ElricMode.SHOPPING) {
    Banner(tr(T.livePricesSoon), warn = false)
  }
  SecLabel(tr(T.lengthSec))
  Row(
    modifier = Modifier.fillMaxWidth().clip(CircleShape).background(p.surface2).padding(4.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    for ((isShort, label) in listOf(true to T.short, false to T.detailed)) {
      val sel = short == isShort
      Box(
        modifier =
          Modifier.weight(1f)
            .heightIn(min = 44.dp)
            .clip(CircleShape)
            .background(if (sel) p.gold else androidx.compose.ui.graphics.Color.Transparent)
            .clickable { onShort(isShort) },
        contentAlignment = Alignment.Center,
      ) {
        EText(
          tr(label),
          size = 14.sp,
          weight = if (sel) FontWeight.SemiBold else FontWeight.Normal,
          color = if (sel) p.onGold else p.muted,
        )
      }
    }
  }
  GoldButton(tr(T.done), onClick = onDone, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
}

// ------------------------------------------------------------------ drawer

private fun dayGroup(at: Long): Int {
  val now = Calendar.getInstance()
  val c = Calendar.getInstance().apply { timeInMillis = at }
  fun sameDay(a: Calendar, b: Calendar) =
    a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
  if (sameDay(now, c)) return 0
  val y = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
  if (sameDay(y, c)) return 1
  return 2
}

@Composable
private fun ElricDrawer(
  vm: ElricViewModel,
  onClose: () -> Unit,
  onOpenChat: (String) -> Unit,
  onNewChat: () -> Unit,
  onTalk: () -> Unit,
  onPhoto: () -> Unit,
  onProfile: () -> Unit,
) {
  val p = pal()
  var query by rememberSaveable { mutableStateOf("") }
  var searching by rememberSaveable { mutableStateOf(false) }
  var menuFor by remember { mutableStateOf<String?>(null) }
  var renaming by remember { mutableStateOf<String?>(null) }
  val shape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp)
  var dragX by remember { mutableStateOf(0f) }
  val searchFocus = remember { FocusRequester() }
  LaunchedEffect(searching) { if (searching) searchFocus.requestFocus() }
  Box(
    modifier =
      Modifier.fillMaxHeight()
        .fillMaxWidth(0.84f)
        .clip(shape)
        .background(p.bg)
        .border(1.dp, p.line, shape)
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
          menuFor = null
        }
        .pointerInput(Unit) {
          detectHorizontalDragGestures(
            onDragStart = { dragX = 0f },
            onDragEnd = { if (dragX < -60f) onClose() },
          ) { _, dx ->
            dragX += dx
          }
        }
  ) {
    Column(modifier = Modifier.fillMaxSize()) {
      // Header: mark, name, search.
      Row(
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 14.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Image(
          painterResource(R.drawable.elric_mark),
          contentDescription = null,
          modifier = Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)),
        )
        EText(tr(T.brand), size = 20.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Box(
          modifier =
            Modifier.size(42.dp)
              .clip(CircleShape)
              .background(p.surface)
              .border(1.dp, p.line, CircleShape)
              .clickable {
                searching = !searching
                if (!searching) query = ""
              },
          contentAlignment = Alignment.Center,
        ) {
          Icon(Icons.Outlined.Search, contentDescription = tr(T.searchChats), tint = p.text, modifier = Modifier.size(22.dp))
        }
      }
      if (searching) {
        Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp)) {
          EField(
            value = query,
            onValueChange = { query = it },
            placeholder = tr(T.searchChats),
            height = 44,
            modifier = Modifier.focusRequester(searchFocus),
          )
        }
      }

      val q = query.trim().lowercase()
      val filtered = vm.chats.filter { q.isEmpty() || it.title.lowercase().contains(q) }
      LazyColumn(
        modifier = Modifier.weight(1f).fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 96.dp),
      ) {
        item(key = "nav") {
          Column(Modifier.padding(top = 2.dp, bottom = 8.dp)) {
            DrawerItem(Icons.Outlined.GraphicEq, tr(T.talk), onTalk)
            DrawerItem(Icons.Outlined.PhotoCamera, tr(T.photoQuestion), onPhoto)
          }
        }
        item(key = "modes") {
          Row(
            modifier =
              Modifier.fillMaxWidth()
                .padding(start = 10.dp, end = 10.dp, top = 2.dp, bottom = 10.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(p.surface)
                .border(1.dp, p.line, RoundedCornerShape(12.dp))
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            for (m in listOf(ElricMode.STUDY, ElricMode.SHOPPING, ElricMode.GENERAL)) {
              val sel = vm.mode == m
              Box(
                modifier =
                  Modifier.weight(1f)
                    .heightIn(min = 36.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (sel) p.surface2 else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable {
                      vm.updateMode(m)
                      onClose()
                    },
                contentAlignment = Alignment.Center,
              ) {
                EText(
                  tr(
                    when (m) {
                      ElricMode.STUDY -> T.study
                      ElricMode.SHOPPING -> T.shopping
                      ElricMode.GENERAL -> T.general
                    }
                  ),
                  size = 13.5.sp,
                  weight = if (sel) FontWeight.SemiBold else FontWeight.Normal,
                  color = if (sel) p.goldInk else p.muted,
                )
              }
            }
          }
        }
        item(key = "recents") {
          EText(
            tr(T.recents),
            size = 13.sp,
            weight = FontWeight.SemiBold,
            color = p.muted,
            modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 12.dp, bottom = 4.dp),
          )
        }
        if (filtered.isEmpty()) {
          item(key = "empty") {
            EText(
              tr(if (q.isEmpty()) T.noChats else T.noMatches),
              size = 14.sp,
              color = p.muted,
              modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            )
          }
        }
        for (c in filtered) {
          item(key = c.id) {
            ChatRow(
              chat = c,
              active = c.id == vm.chatId,
              renaming = renaming == c.id,
              menuOpen = menuFor == c.id,
              onOpen = { onOpenChat(c.id) },
              onMenu = { menuFor = if (menuFor == c.id) null else c.id },
              onDismissMenu = { menuFor = null },
              onRename = {
                menuFor = null
                renaming = c.id
              },
              onDelete = {
                menuFor = null
                vm.deleteChat(c.id)
              },
              onRenamed = { title ->
                vm.renameChat(c.id, title)
                renaming = null
              },
            )
          }
        }
      }
    }

    // Footer: New chat pill + profile avatar.
    Row(
      modifier =
        Modifier.align(Alignment.BottomStart)
          .fillMaxWidth()
          .background(
            androidx.compose.ui.graphics.Brush.verticalGradient(
              0f to p.bg.copy(alpha = 0f),
              0.38f to p.bg,
              1f to p.bg,
            )
          )
          .padding(horizontal = 16.dp, vertical = 14.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween,
    ) {
      Row(
        modifier =
          Modifier.heightIn(min = 46.dp)
            .clip(CircleShape)
            .background(p.gold)
            .clickable(onClick = onNewChat)
            .padding(start = 16.dp, end = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Icon(Icons.Outlined.Edit, contentDescription = null, tint = p.onGold, modifier = Modifier.size(20.dp))
        EText(tr(T.newChat), size = 15.5.sp, weight = FontWeight.SemiBold, color = p.onGold)
      }
      Box(modifier = Modifier.clip(CircleShape).clickable(onClick = onProfile)) {
        Avatar(vm.name, size = 46)
      }
    }
  }
}

/** Round avatar: the user's initials, or a person icon when no name is set. */
@Composable
private fun Avatar(name: String, size: Int) {
  val p = pal()
  val initials =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") {
      it.substring(0, it.offsetByCodePoints(0, 1)).uppercase()
    }
  Box(
    modifier =
      Modifier.size(size.dp)
        .clip(CircleShape)
        .background(p.surface2)
        .border(if (size > 60) 1.5.dp else 1.dp, p.gold.copy(alpha = 0.45f), CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    if (initials.isNotEmpty()) {
      EText(initials, size = (size * 0.36f).sp, weight = FontWeight.SemiBold, color = p.goldInk)
    } else {
      Icon(Icons.Outlined.Person, contentDescription = tr(T.profile), tint = p.goldInk, modifier = Modifier.size((size * 0.48f).dp))
    }
  }
}

/** Drawer action row (`.dw-it`). */
@Composable
private fun DrawerItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
  val p = pal()
  Row(
    modifier =
      Modifier.fillMaxWidth()
        .heightIn(min = 48.dp)
        .clip(RoundedCornerShape(12.dp))
        .clickable(onClick = onClick)
        .padding(horizontal = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    Icon(icon, contentDescription = null, tint = p.muted, modifier = Modifier.size(22.dp))
    EText(label, size = 16.sp)
  }
}

/** Small on/off switch (`.sw`). */
@Composable
private fun ESwitch(on: Boolean) {
  val p = pal()
  val x by androidx.compose.animation.core.animateDpAsState(if (on) 20.dp else 2.dp, tween(200), label = "sw")
  Box(
    modifier =
      Modifier.width(46.dp)
        .height(28.dp)
        .clip(CircleShape)
        .background(if (on) p.gold else p.surface2)
        .border(1.dp, if (on) p.gold else p.line, CircleShape)
  ) {
    Box(
      Modifier.padding(start = x, top = 2.dp)
        .size(22.dp)
        .clip(CircleShape)
        .background(androidx.compose.ui.graphics.Color.White)
    )
  }
}

/** One row of a profile group (`.pr`). */
@Composable
private fun ProfileRow(
  icon: androidx.compose.ui.graphics.vector.ImageVector,
  label: String,
  value: String? = null,
  caption: String? = null,
  captionColor: androidx.compose.ui.graphics.Color? = null,
  chevron: Boolean = true,
  switchOn: Boolean? = null,
  danger: Boolean = false,
  first: Boolean = false,
  onClick: (() -> Unit)? = null,
) {
  val p = pal()
  Column {
    if (!first) Box(Modifier.padding(start = 52.dp).fillMaxWidth().height(1.dp).background(p.line))
    Row(
      modifier =
        Modifier.fillMaxWidth()
          .heightIn(min = 52.dp)
          .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
          .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Icon(icon, contentDescription = null, tint = if (danger) p.danger else p.muted, modifier = Modifier.size(22.dp))
      Column(Modifier.weight(1f)) {
        EText(label, size = 16.sp, color = if (danger) p.danger else p.text, lineHeight = 21.sp)
        if (caption != null) EText(caption, size = 12.5.sp, color = captionColor ?: p.muted, lineHeight = 17.sp)
      }
      if (value != null) EText(value, size = 13.sp, color = p.muted, maxLines = 1, modifier = Modifier.widthIn(max = 140.dp))
      if (switchOn != null) ESwitch(switchOn)
      else if (chevron) EText("›", size = 20.sp, color = p.muted, lineHeight = 20.sp)
    }
  }
}

@Composable
private fun ProfileGroup(title: String, content: @Composable () -> Unit) {
  val p = pal()
  EText(
    title,
    size = 13.sp,
    weight = FontWeight.SemiBold,
    color = p.muted,
    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 7.dp),
  )
  Column(
    modifier =
      Modifier.fillMaxWidth()
        .clip(RoundedCornerShape(14.dp))
        .background(p.surface)
        .border(1.dp, p.line, RoundedCornerShape(14.dp))
  ) {
    content()
  }
}

/** Profile & settings (mirrors the web app's profile page), opened from the drawer avatar. */
@Composable
private fun ProfileScreen(
  vm: ElricViewModel,
  light: Boolean,
  showModels: Boolean,
  modelValue: String,
  offlineOn: Boolean,
  offlineReady: Boolean,
  offlineSize: String,
  offlinePct: Int?,
  onClose: () -> Unit,
  onAboutYou: () -> Unit,
  onOffline: () -> Unit,
  onModels: () -> Unit,
  onMemory: () -> Unit,
  onPrivacy: () -> Unit,
  onAboutApp: () -> Unit,
  onLicenses: () -> Unit,
  onTheme: (Boolean) -> Unit,
) {
  val p = pal()
  val lang = LocalElricLang.current
  var askAge by remember { mutableStateOf(false) }
  var pick by remember { mutableStateOf<String?>(null) }
  var confirmClear by remember { mutableStateOf(false) }
  if (askAge) {
    AlertDialog(
      onDismissRequest = { askAge = false },
      containerColor = p.surface,
      title = { EText(tr(T.onlineAnswers), size = 17.sp, weight = FontWeight.SemiBold) },
      text = { EText(tr(T.age18Text), size = 14.sp, color = p.muted) },
      confirmButton = {
        TextButton(
          onClick = {
            askAge = false
            vm.confirmAge18AndGoOnline()
          }
        ) {
          EText(tr(T.age18Yes), color = p.goldInk, weight = FontWeight.SemiBold)
        }
      },
      dismissButton = { TextButton(onClick = { askAge = false }) { EText(tr(T.notNow), color = p.muted) } },
    )
  }
  if (confirmClear) {
    AlertDialog(
      onDismissRequest = { confirmClear = false },
      containerColor = p.surface,
      title = { EText(tr(T.clearChats), size = 17.sp, weight = FontWeight.SemiBold) },
      text = { EText(tr(T.clearChatsConfirm), size = 14.sp, color = p.muted) },
      confirmButton = {
        TextButton(
          onClick = {
            confirmClear = false
            vm.clearChats()
          }
        ) {
          EText(tr(T.delete), color = p.danger, weight = FontWeight.SemiBold)
        }
      },
      dismissButton = { TextButton(onClick = { confirmClear = false }) { EText(tr(T.cancel), color = p.muted) } },
    )
  }
  pick?.let { which ->
    // Small picker: one choice from a short list (like the web app's chooser sheet).
    val (title, opts, cur) =
      when (which) {
        "len" -> Triple(tr(T.lengthSec), listOf("short" to tr(T.short), "long" to tr(T.detailed)), if (vm.short) "short" else "long")
        "lang" -> Triple(tr(T.language), listOf("en" to "English", "hi" to "हिन्दी"), if (lang == ElricLang.HI) "hi" else "en")
        else -> Triple(tr(T.appearance), listOf("dark" to tr(T.dark), "light" to tr(T.light)), if (light) "light" else "dark")
      }
    AlertDialog(
      onDismissRequest = { pick = null },
      containerColor = p.surface,
      title = { EText(title, size = 17.sp, weight = FontWeight.SemiBold) },
      text = {
        Column {
          for ((v, l) in opts) {
            Row(
              modifier =
                Modifier.fillMaxWidth()
                  .heightIn(min = 48.dp)
                  .clip(RoundedCornerShape(12.dp))
                  .clickable {
                    when (which) {
                      "len" -> vm.updateShort(v == "short")
                      "lang" -> vm.updateLang(if (v == "hi") ElricLang.HI else ElricLang.EN)
                      else -> onTheme(v == "light")
                    }
                    pick = null
                  }
                  .padding(horizontal = 12.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              EText(l, size = 16.sp, weight = if (v == cur) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.weight(1f))
              if (v == cur) EText("✓", color = p.goldInk, weight = FontWeight.SemiBold)
            }
          }
        }
      },
      confirmButton = {},
    )
  }

  Box(Modifier.fillMaxSize()) {
    Column(
      modifier =
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp)
    ) {
      Column(
        modifier = Modifier.fillMaxWidth().padding(top = 30.dp, bottom = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Box(modifier = Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onAboutYou)) {
          Avatar(vm.name, size = 88)
          Box(
            modifier =
              Modifier.align(Alignment.BottomEnd)
                .size(30.dp)
                .clip(CircleShape)
                .background(p.surface2)
                .border(2.dp, p.bg, CircleShape),
            contentAlignment = Alignment.Center,
          ) {
            Icon(Icons.Outlined.Edit, contentDescription = tr(T.aboutYou), tint = p.text, modifier = Modifier.size(15.dp))
          }
        }
        if (vm.name.isNotBlank()) EText(vm.name.trim(), size = 20.sp, weight = FontWeight.SemiBold)
        else EText(tr(T.addName), size = 16.sp, weight = FontWeight.Medium, color = p.muted)
      }

      ProfileGroup(tr(T.secPersonalise)) {
        ProfileRow(Icons.Outlined.Person, tr(T.aboutYou), value = vm.name.trim().ifEmpty { tr(T.addName) }, first = true, onClick = onAboutYou)
        ProfileRow(Icons.Outlined.TextFields, tr(T.lengthSec), value = tr(if (vm.short) T.short else T.detailed)) { pick = "len" }
        ProfileRow(Icons.Outlined.Language, tr(T.language), value = if (lang == ElricLang.HI) "हिन्दी" else "English") { pick = "lang" }
        ProfileRow(Icons.Outlined.DarkMode, tr(T.appearance), value = tr(if (light) T.light else T.dark)) { pick = "theme" }
      }
      ProfileGroup(tr(T.secAI)) {
        ProfileRow(
          Icons.Outlined.Cloud,
          tr(T.onlineAnswers),
          caption = tr(T.onlineHow),
          switchOn = vm.onlineOn,
          first = true,
        ) {
          if (!vm.onlineOn && !vm.age18) askAge = true else vm.updateOnlineOn(!vm.onlineOn)
        }
        ProfileRow(
          Icons.Outlined.DownloadForOffline,
          tr(T.offlineMenu),
          caption =
            when {
              offlinePct != null -> tr(T.offlineDownloadingPct, "pct" to offlinePct.toString())
              offlineReady -> tr(T.offlineReadyCap)
              else -> tr(T.offlineHow, "size" to offlineSize)
            },
          captionColor = if (offlinePct != null) p.goldInk else null,
          switchOn = offlineOn,
          onClick = onOffline,
        )
        if (showModels) ProfileRow(Icons.Outlined.Memory, tr(T.models), value = modelValue, onClick = onModels)
      }
      ProfileGroup(tr(T.secPrivacy)) {
        ProfileRow(Icons.Outlined.AutoAwesome, tr(T.memory), value = tr(if (vm.memoryOn) T.on else T.off), first = true, onClick = onMemory)
        ProfileRow(Icons.Outlined.VerifiedUser, tr(T.age), value = tr(if (vm.age18) T.ageYes else T.ageNo), chevron = false)
        ProfileRow(Icons.Outlined.Delete, tr(T.clearChats), chevron = false, danger = true) {
          if (vm.chats.isNotEmpty()) confirmClear = true
        }
        ProfileRow(Icons.Outlined.Shield, tr(T.privacy), onClick = onPrivacy)
      }
      ProfileGroup(tr(T.secAbout)) {
        ProfileRow(Icons.Outlined.Info, tr(T.aboutElric), first = true, onClick = onAboutApp)
        ProfileRow(Icons.Outlined.Code, tr(T.licenses), onClick = onLicenses)
        ProfileRow(Icons.Outlined.Sell, tr(T.version), value = BuildConfig.VERSION_NAME, chevron = false)
      }
      EText(
        "Elric AI · ${tr(T.version)} ${BuildConfig.VERSION_NAME}",
        size = 12.5.sp,
        color = p.muted,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 22.dp),
      )
    }
    Box(
      modifier =
        Modifier.align(Alignment.TopEnd)
          .padding(12.dp)
          .size(42.dp)
          .clip(CircleShape)
          .background(p.surface)
          .border(1.dp, p.line, CircleShape)
          .clickable(onClick = onClose),
      contentAlignment = Alignment.Center,
    ) {
      Icon(Icons.Outlined.Close, contentDescription = tr(T.close), tint = p.text, modifier = Modifier.size(20.dp))
    }
  }
}

@Composable
private fun ChatRow(
  chat: ElricChat,
  active: Boolean,
  renaming: Boolean,
  menuOpen: Boolean,
  onOpen: () -> Unit,
  onMenu: () -> Unit,
  onDismissMenu: () -> Unit,
  onRename: () -> Unit,
  onDelete: () -> Unit,
  onRenamed: (String) -> Unit,
) {
  val p = pal()
  Row(
    modifier =
      Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(
        if (active) p.surface2 else androidx.compose.ui.graphics.Color.Transparent
      ),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (renaming) {
      var value by remember { mutableStateOf(TextFieldValue(chat.title, TextRange(0, chat.title.length))) }
      val focus = remember { FocusRequester() }
      var hadFocus by remember { mutableStateOf(false) }
      LaunchedEffect(Unit) { focus.requestFocus() }
      BasicTextField(
        value = value,
        onValueChange = { value = it },
        singleLine = true,
        textStyle = TextStyle(color = p.text, fontSize = 14.sp),
        cursorBrush = SolidColor(p.gold),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onRenamed(value.text) }),
        modifier =
          Modifier.weight(1f)
            .heightIn(min = 44.dp)
            .padding(horizontal = 8.dp, vertical = 12.dp)
            .focusRequester(focus)
            .onFocusChanged {
              if (it.isFocused) hadFocus = true else if (hadFocus) onRenamed(value.text)
            },
      )
      Box(Modifier.size(44.dp))
    } else {
      Box(
        modifier =
          Modifier.weight(1f).heightIn(min = 44.dp).clickable(onClick = onOpen).padding(horizontal = 12.dp),
        contentAlignment = Alignment.CenterStart,
      ) {
        EText(chat.title.ifBlank { "…" }, size = 14.sp, maxLines = 1)
      }
      Box {
        Box(
          modifier = Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onMenu),
          contentAlignment = Alignment.Center,
        ) {
          Icon(Icons.Rounded.MoreVert, contentDescription = tr(T.moreOptions), tint = p.muted, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(
          expanded = menuOpen,
          onDismissRequest = onDismissMenu,
          containerColor = p.surface2,
          shape = RoundedCornerShape(12.dp),
        ) {
          DropdownMenuItem(text = { EText(tr(T.rename), size = 14.sp) }, onClick = onRename)
          DropdownMenuItem(text = { EText(tr(T.delete), size = 14.sp, color = p.danger) }, onClick = onDelete)
        }
      }
    }
  }
}

// ------------------------------------------------------------------ platform helpers

private fun totalStorage(context: Context): Long =
  try {
    StatFs(context.filesDir.absolutePath).totalBytes
  } catch (e: Exception) {
    0L
  }

/** True while the phone has a validated internet connection. */
@Composable
private fun rememberOnline(): Boolean {
  val context = LocalContext.current
  val cm = remember { context.getSystemService(ConnectivityManager::class.java) }
  fun check(): Boolean {
    val caps = cm?.getNetworkCapabilities(cm.activeNetwork) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
      caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }
  var online by remember { mutableStateOf(check()) }
  DisposableEffect(cm) {
    val cb =
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          online = check()
        }

        override fun onLost(network: Network) {
          online = check()
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
          online = check()
        }
      }
    try {
      cm?.registerDefaultNetworkCallback(cb)
    } catch (e: Exception) {
      // Ignore; the banner just won't update.
    }
    onDispose {
      try {
        cm?.unregisterNetworkCallback(cb)
      } catch (e: Exception) {}
    }
  }
  return online
}

class ElricTts(private val speakFn: (String, ElricLang) -> Unit) {
  fun speak(text: String, lang: ElricLang) = speakFn(text, lang)
}

@Composable
private fun rememberTts(): ElricTts {
  val context = LocalContext.current
  val holder = remember { arrayOfNulls<TextToSpeech>(1) }
  val ready = remember { booleanArrayOf(false) }
  val pending = remember { arrayOfNulls<String>(1) }
  val pendingLocale = remember { arrayOfNulls<Locale>(1) }
  DisposableEffect(Unit) {
    onDispose {
      holder[0]?.shutdown()
      holder[0] = null
    }
  }
  return remember {
    ElricTts { text, lang ->
      val plain = text.replace(Regex("[*#`|_>]"), " ")
      val locale = if (lang == ElricLang.HI) Locale("hi", "IN") else Locale("en", "IN")
      val t = holder[0]
      pending[0] = plain
      pendingLocale[0] = locale
      if (t != null && ready[0]) {
        pending[0] = null
        t.language = locale
        t.speak(plain, TextToSpeech.QUEUE_FLUSH, null, "elric")
      } else if (t == null) {
        // The latest text asked for while the speech engine starts is read once it is ready.
        holder[0] =
          TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
              ready[0] = true
              val text = pending[0]
              pending[0] = null
              if (text != null) {
                pendingLocale[0]?.let { holder[0]?.language = it }
                holder[0]?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "elric")
              }
            } else {
              holder[0] = null
            }
          }
      }
    }
  }
}

/** Optional note in the feedback sheet. */
@Composable
private fun FeedbackNote(value: String, onValueChange: (String) -> Unit) {
  val p = pal()
  Box(
    modifier =
      Modifier.fillMaxWidth()
        .heightIn(min = 72.dp)
        .clip(RoundedCornerShape(16.dp))
        .background(p.surface2)
        .border(1.dp, p.line, RoundedCornerShape(16.dp))
        .padding(horizontal = 14.dp, vertical = 12.dp)
  ) {
    if (value.isEmpty()) EText(tr(T.fbNote), size = 14.sp, color = p.muted)
    BasicTextField(
      value = value,
      onValueChange = onValueChange,
      textStyle = TextStyle(color = p.text, fontSize = 14.sp),
      cursorBrush = SolidColor(p.gold),
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

/** One-time inline card asking whether to send error reports (after the first good answer). */
@Composable
private fun ReportsAskCard(onYes: () -> Unit, onNo: () -> Unit) {
  val p = pal()
  Column(
    modifier =
      Modifier.fillMaxWidth()
        .padding(bottom = 8.dp)
        .clip(RoundedCornerShape(16.dp))
        .background(p.surface)
        .border(1.dp, p.line, RoundedCornerShape(16.dp))
        .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    EText(tr(T.reportsAskTitle), size = 14.sp, weight = FontWeight.SemiBold)
    TinyText(tr(T.reportsAskBody))
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.End,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TextBtn(tr(T.noThanks), onClick = onNo)
      TextBtn(tr(T.yesSend), onClick = onYes, color = p.goldInk)
    }
  }
}
