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
import android.os.Bundle
import android.os.StatFs
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
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
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.google.ai.edge.gallery.BuildConfig
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.data.Model
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
  var overlay by rememberSaveable { mutableStateOf(Overlay.NONE) }
  var input by rememberSaveable { mutableStateOf("") }
  var listening by remember { mutableStateOf(false) }
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
    listening = false
    screen = s
  }

  fun openFromMenu(s: Screen) {
    returnTo = if (screen == Screen.CHAT) Screen.CHAT else Screen.HOME
    go(s)
  }

  fun ask(text: String) {
    val q = text.trim()
    if (q.isEmpty() || vm.busy) return
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

  // Voice input and read aloud.
  val voice = rememberVoiceInput(
    lang = vm.lang,
    onText = { input = it },
    onEnd = { listening = false },
    onError = { msg ->
      listening = false
      if (msg != null) showToast(msg.get(vm.lang))
    },
  )
  val micLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) {
        listening = voice.start()
        if (!listening) showToast(T.voiceUnavailable.get(vm.lang))
      } else {
        showToast(T.micNeeded.get(vm.lang))
      }
    }
  fun startMic() {
    overlay = Overlay.NONE
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      listening = voice.start()
      if (!listening) showToast(T.voiceUnavailable.get(vm.lang))
    } else {
      micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
  }
  val tts = rememberTts()

  // Back handling.
  BackHandler(enabled = listening) {
    voice.stop()
    listening = false
  }
  BackHandler(enabled = overlay != Overlay.NONE) { overlay = Overlay.NONE }
  BackHandler(enabled = overlay == Overlay.NONE && !listening && screen in setOf(Screen.CHAT, Screen.MODELS, Screen.PRIVACY, Screen.MEMORY, Screen.DOWNLOAD) ||
    (overlay == Overlay.NONE && !listening && screen == Screen.ABOUT && vm.onboarded)) {
    when (screen) {
      Screen.CHAT -> newChat()
      Screen.DOWNLOAD -> go(Screen.ABOUT)
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
          Screen.SPLASH -> SplashScreen(onDone = { if (screen == Screen.SPLASH) go(Screen.ONBOARD) })
          Screen.ONBOARD ->
            OnboardingScreen(
              lang = vm.lang,
              onLang = { vm.updateLang(it) },
              onDone = { go(Screen.ABOUT) },
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
                  vm.finishOnboarding()
                  go(if (downloaded.isNotEmpty()) Screen.HOME else Screen.DOWNLOAD)
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
              onDownload = { download(it) },
              onBack = { go(Screen.ABOUT) },
              onReady = { m ->
                vm.updateActiveModel(m.name)
                go(Screen.HOME)
              },
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
                  onOpenModels = { openFromMenu(Screen.MODELS) },
                  modifier = Modifier.weight(1f).fillMaxWidth(),
                )
              } else {
                HomeContent(
                  mode = vm.mode,
                  offline = offline,
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
                listening = listening,
                onCamera = { overlay = Overlay.CAMERA },
                onMic = { startMic() },
                onStopListening = {
                  voice.stop()
                  listening = false
                },
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
              onDownload = { download(it) },
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
        SheetOption("◉", tr(T.takePhoto), null, false) {
          overlay = Overlay.NONE
          showToast(T.photoSoon.get(vm.lang))
        }
        SheetOption("▣", tr(T.chooseGallery), null, false) {
          overlay = Overlay.NONE
          showToast(T.photoSoon.get(vm.lang))
        }
        TinyText(
          tr(T.photoSoon),
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
          light = light,
          onClose = { overlay = Overlay.NONE },
          onOpenChat = { id ->
            vm.openChat(id)
            input = ""
            go(Screen.CHAT)
          },
          onAboutYou = { openFromMenu(Screen.ABOUT) },
          onModels = { openFromMenu(Screen.MODELS) },
          onMemory = { openFromMenu(Screen.MEMORY) },
          onPrivacy = { openFromMenu(Screen.PRIVACY) },
          onAboutApp = { overlay = Overlay.ABOUT_APP },
          onToggleTheme = {
            val t = if (light) Theme.THEME_DARK else Theme.THEME_LIGHT
            ThemeSettings.themeOverride.value = t
            modelManagerViewModel.saveThemeOverride(t)
          },
        )
      }
    }

    if (showTos && screen == Screen.HOME) {
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
  light: Boolean,
  onClose: () -> Unit,
  onOpenChat: (String) -> Unit,
  onAboutYou: () -> Unit,
  onModels: () -> Unit,
  onMemory: () -> Unit,
  onPrivacy: () -> Unit,
  onAboutApp: () -> Unit,
  onToggleTheme: () -> Unit,
) {
  val p = pal()
  val lang = LocalElricLang.current
  var query by rememberSaveable { mutableStateOf("") }
  var menuFor by remember { mutableStateOf<String?>(null) }
  var renaming by remember { mutableStateOf<String?>(null) }
  val shape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp)
  var dragX by remember { mutableStateOf(0f) }
  Column(
    modifier =
      Modifier.fillMaxHeight()
        .fillMaxWidth(0.86f)
        .clip(shape)
        .background(p.surface)
        .border(1.dp, p.line, shape)
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
          menuFor = null
        }
        .pointerInput(Unit) {
          detectHorizontalDragGestures(
            onDragStart = { dragX = 0f },
            onDragEnd = { if (dragX < -80f) onClose() },
          ) { _, dx ->
            dragX += dx
          }
        }
        .padding(start = 12.dp, end = 12.dp, top = 16.dp, bottom = 8.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Row(
      modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Image(
        painterResource(R.drawable.elric_mark),
        contentDescription = null,
        modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)),
      )
      Column {
        EText(tr(T.brand), size = 16.sp, weight = FontWeight.Bold)
        TinyText(tr(T.tagline))
      }
    }
    EField(value = query, onValueChange = { query = it }, placeholder = tr(T.searchChats), height = 44)

    val q = query.trim().lowercase()
    val filtered = vm.chats.filter { q.isEmpty() || it.title.lowercase().contains(q) }
    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
      item { SecLabel(tr(T.recentChats)) }
      if (filtered.isEmpty()) {
        item { TinyText(tr(T.noChats), modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) }
      }
      val groups = filtered.groupBy { dayGroup(it.at) }
      for (g in 0..2) {
        val list = groups[g] ?: continue
        item(key = "g$g") {
          TinyText(
            tr(
              when (g) {
                0 -> T.today
                1 -> T.yesterday
                else -> T.earlier
              }
            ),
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp),
          )
        }
        for (c in list) {
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

    Column(modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
      Box(Modifier.fillMaxWidth().padding(bottom = 6.dp).background(p.line).heightIn(min = 1.dp, max = 1.dp))
      DrawerRow("☺", tr(T.aboutYou), onClick = onAboutYou)
      DrawerRow("✦", tr(T.memory), onClick = onMemory)
      DrawerRow("▦", tr(T.models), onClick = onModels)
      DrawerRow(
        "अ",
        tr(T.language),
        trailing = {
          Row {
            EText("English", size = 12.sp, weight = FontWeight.Medium, color = if (lang == ElricLang.EN) p.goldInk else p.muted)
            EText(" · ", size = 12.sp, color = p.muted)
            EText("हिन्दी", size = 12.sp, weight = FontWeight.Medium, color = if (lang == ElricLang.HI) p.goldInk else p.muted)
          }
        },
        onClick = { vm.updateLang(if (lang == ElricLang.EN) ElricLang.HI else ElricLang.EN) },
      )
      DrawerRow(
        "◐",
        tr(T.appearance),
        trailing = {
          Row {
            EText(tr(T.dark), size = 12.sp, weight = FontWeight.Medium, color = if (!light) p.goldInk else p.muted)
            EText(" · ", size = 12.sp, color = p.muted)
            EText(tr(T.light), size = 12.sp, weight = FontWeight.Medium, color = if (light) p.goldInk else p.muted)
          }
        },
        onClick = onToggleTheme,
      )
      DrawerRow("⛉", tr(T.privacy), onClick = onPrivacy)
      DrawerRow("ⓘ", tr(T.aboutElric), onClick = onAboutApp)
      TinyText("v${BuildConfig.VERSION_NAME}", modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
    }
  }
}

@Composable
private fun DrawerRow(
  glyph: String,
  label: String,
  trailing: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  val p = pal()
  Row(
    modifier =
      Modifier.fillMaxWidth()
        .heightIn(min = 44.dp)
        .clip(RoundedCornerShape(12.dp))
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    EText(glyph, size = 14.sp, color = p.muted, modifier = Modifier.width(20.dp), textAlign = TextAlign.Center)
    EText(label, size = 14.sp, modifier = Modifier.weight(1f))
    trailing?.invoke()
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

class ElricVoice(private val startFn: () -> Boolean, private val stopFn: () -> Unit) {
  fun start(): Boolean = startFn()

  fun stop() = stopFn()
}

/**
 * Speech to text in Hindi or English. Uses the phone's on-device recognizer when it has one.
 */
@Composable
private fun rememberVoiceInput(
  lang: ElricLang,
  onText: (String) -> Unit,
  onEnd: () -> Unit,
  onError: (Str?) -> Unit,
): ElricVoice {
  val context = LocalContext.current
  val holder = remember { arrayOfNulls<SpeechRecognizer>(1) }
  val callbacks = remember { arrayOfNulls<Any>(3) }
  callbacks[0] = onText
  callbacks[1] = onEnd
  callbacks[2] = onError

  @Suppress("UNCHECKED_CAST")
  fun cbText(s: String) = (callbacks[0] as (String) -> Unit)(s)

  @Suppress("UNCHECKED_CAST")
  fun cbEnd() = (callbacks[1] as () -> Unit)()

  @Suppress("UNCHECKED_CAST")
  fun cbError(s: Str?) = (callbacks[2] as (Str?) -> Unit)(s)

  DisposableEffect(Unit) {
    onDispose {
      holder[0]?.destroy()
      holder[0] = null
    }
  }
  val langTag = if (lang == ElricLang.HI) "hi-IN" else "en-IN"
  return remember(langTag) {
    ElricVoice(
      startFn = {
        holder[0]?.destroy()
        holder[0] = null
        val onDevice =
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        if (!onDevice && !SpeechRecognizer.isRecognitionAvailable(context)) {
          false
        } else {
          try {
            val r =
              if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
              else SpeechRecognizer.createSpeechRecognizer(context)
            r.setRecognitionListener(
              object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}

                override fun onBeginningOfSpeech() {}

                override fun onRmsChanged(rmsdB: Float) {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {}

                override fun onError(error: Int) {
                  cbError(
                    if (
                      error == SpeechRecognizer.ERROR_NO_MATCH ||
                        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ||
                        error == SpeechRecognizer.ERROR_CLIENT
                    )
                      null
                    else T.voiceUnavailable
                  )
                }

                override fun onResults(results: Bundle?) {
                  results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.let { cbText(it) }
                  cbEnd()
                }

                override fun onPartialResults(partialResults: Bundle?) {
                  partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { cbText(it) }
                }

                override fun onEvent(eventType: Int, params: Bundle?) {}
              }
            )
            val intent =
              Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, langTag)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
              }
            r.startListening(intent)
            holder[0] = r
            true
          } catch (e: Exception) {
            false
          }
        }
      },
      stopFn = {
        try {
          holder[0]?.stopListening()
        } catch (e: Exception) {}
      },
    )
  }
}

class ElricTts(private val speakFn: (String, ElricLang) -> Unit) {
  fun speak(text: String, lang: ElricLang) = speakFn(text, lang)
}

@Composable
private fun rememberTts(): ElricTts {
  val context = LocalContext.current
  val holder = remember { arrayOfNulls<TextToSpeech>(1) }
  val ready = remember { booleanArrayOf(false) }
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
      if (t != null && ready[0]) {
        t.language = locale
        t.speak(plain, TextToSpeech.QUEUE_FLUSH, null, "elric")
      } else if (t == null) {
        holder[0] =
          TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
              ready[0] = true
              holder[0]?.language = locale
              holder[0]?.speak(plain, TextToSpeech.QUEUE_FLUSH, null, "elric")
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
