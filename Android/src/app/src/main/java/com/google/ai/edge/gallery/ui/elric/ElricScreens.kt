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

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.ai.edge.gallery.R
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.data.ModelDownloadStatus
import com.google.ai.edge.gallery.data.ModelDownloadStatusType
import java.util.Locale
import kotlinx.coroutines.delay

fun gbText(bytes: Long): String = String.format(Locale.US, "%.1f GB", bytes / 1e9)

fun ModelDownloadStatus?.isDownloaded(): Boolean = this?.status == ModelDownloadStatusType.SUCCEEDED

fun ModelDownloadStatus?.isDownloading(): Boolean =
  this?.status == ModelDownloadStatusType.IN_PROGRESS ||
    this?.status == ModelDownloadStatusType.UNZIPPING

fun ModelDownloadStatus?.fraction(model: Model): Float {
  val s = this ?: return 0f
  val total = if (s.totalBytes > 0) s.totalBytes else model.downloadInfo.totalBytes
  if (total <= 0) return 0f
  return (s.receivedBytes.toFloat() / total).coerceIn(0f, 1f)
}

@Composable
private fun BackBar(onBack: () -> Unit, title: String? = null) {
  AppBar {
    RoundIcon(Icons.AutoMirrored.Rounded.ArrowBack, tr(T.back), onBack, tint = pal().text)
    if (title != null) EText(title, size = 17.sp, weight = FontWeight.SemiBold)
  }
}

// ------------------------------------------------------------------ 1 splash

@Composable
fun SplashScreen(onDone: () -> Unit) {
  var shown by remember { mutableStateOf(false) }
  val scale by animateFloatAsState(if (shown) 1f else 0.9f, tween(700, easing = ElricEase), label = "pop")
  val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(700, easing = ElricEase), label = "fade")
  LaunchedEffect(Unit) {
    shown = true
    delay(1500)
    onDone()
  }
  Column(
    modifier = Modifier.fillMaxSize(),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Image(
      painterResource(R.drawable.elric_mark),
      contentDescription = tr(T.brand),
      modifier =
        Modifier.size(88.dp).scale(scale).clip(RoundedCornerShape(24.dp)).then(
          Modifier.background(Color.Transparent)
        ),
      alpha = alpha,
    )
    VSpace(16)
    EText(tr(T.brand), size = 28.sp, weight = FontWeight.SemiBold, letterSpacing = (-0.28).sp)
    VSpace(16)
    EText(tr(T.tagline), color = pal().muted)
  }
}

// ------------------------------------------------------------------ 2 onboarding

@Composable
fun OnboardingScreen(
  lang: ElricLang,
  onLang: (ElricLang) -> Unit,
  onDone: () -> Unit,
) {
  val p = pal()
  var slide by rememberSaveable { mutableIntStateOf(0) }
  Column(
    modifier =
      Modifier.fillMaxSize().padding(horizontal = 16.dp).pointerInput(Unit) {
        var total = 0f
        detectHorizontalDragGestures(
          onDragStart = { total = 0f },
          onDragEnd = {
            if (total < -80f && slide < 2) {
              slide += 1
            } else if (total > 80f && slide > 0) {
              slide -= 1
            }
          },
        ) { _, dx ->
          total += dx
        }
      }
  ) {
    AppBar {
      Spacer(Modifier.weight(1f))
      TextBtn(tr(T.skip), onClick = onDone)
    }
    Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
      AnimatedContent(
        targetState = slide,
        transitionSpec = {
          (fadeIn(tween(250, easing = ElricEase)) +
            slideInHorizontally(tween(250, easing = ElricEase)) { 30 }) togetherWith
            fadeOut(tween(150))
        },
        label = "slide",
      ) { i ->
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Box(
            modifier =
              Modifier.fillMaxWidth()
                .height(180.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(p.surface)
                .background(
                  Brush.radialGradient(
                    listOf(p.gold.copy(alpha = 0.22f), p.indigo.copy(alpha = 0.16f), Color.Transparent),
                    radius = 700f,
                    center = androidx.compose.ui.geometry.Offset(160f, 40f),
                  )
                )
                .border(1.dp, p.line, RoundedCornerShape(24.dp)),
            contentAlignment = Alignment.Center,
          ) {
            EText(listOf("◈", "🔒", "अ")[i], size = 44.sp, color = p.text)
          }
          VSpace(16)
          val (title, body) =
            when (i) {
              0 -> T.ob1Title to T.ob1Body
              1 -> T.ob2Title to T.ob2Body
              else -> T.ob3Title to T.ob3Body
            }
          EText(tr(title), size = 26.sp, weight = FontWeight.SemiBold, letterSpacing = (-0.26).sp)
          EText(tr(body), color = p.muted)
          if (i == 2) {
            Row(
              modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
              horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              EChip(
                "English",
                selected = lang == ElricLang.EN,
                onClick = { onLang(ElricLang.EN) },
                modifier = Modifier.weight(1f),
                large = true,
              )
              EChip(
                "हिन्दी",
                selected = lang == ElricLang.HI,
                onClick = { onLang(ElricLang.HI) },
                modifier = Modifier.weight(1f),
                large = true,
              )
            }
          }
        }
      }
    }
    Row(
      modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
      for (i in 0..2) {
        val w by animateDpAsState(if (i == slide) 20.dp else 6.dp, tween(250, easing = ElricEase), label = "dot")
        Box(
          Modifier.width(w).height(6.dp).clip(CircleShape).background(if (i == slide) p.gold else p.line)
        )
      }
    }
    Row(
      modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TinyText(tr(T.reliable), modifier = Modifier.weight(1f))
      GoldButton(
        tr(if (slide == 2) T.getStarted else T.next),
        onClick = {
          if (slide == 2) {
            onDone()
          } else {
            slide += 1
          }
        },
      )
    }
  }
}

// ------------------------------------------------------------------ 3 about you

val STUDY_OPTIONS = listOf(T.study68, T.study910, T.study1112, T.studyCollege, T.studyExams)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AboutYouScreen(
  initialName: String,
  initialStudy: String,
  showBack: Boolean,
  buttonText: String,
  onBack: () -> Unit,
  onContinue: (name: String, study: String) -> Unit,
) {
  val lang = LocalElricLang.current
  var name by rememberSaveable { mutableStateOf(initialName) }
  // Stored in English so the system prompt reads the same in both languages.
  var study by rememberSaveable { mutableStateOf(initialStudy) }
  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
    if (showBack) BackBar(onBack) else AppBar {}
    Column(
      modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      EText(tr(T.aboutName), size = 22.sp, weight = FontWeight.SemiBold, letterSpacing = (-0.22).sp)
      EField(
        value = name,
        onValueChange = { name = it.take(40) },
        placeholder = tr(T.aboutNameHint),
        capitalization = KeyboardCapitalization.Words,
      )
      EText(
        tr(T.aboutStudy),
        modifier = Modifier.padding(top = 8.dp),
        size = 22.sp,
        weight = FontWeight.SemiBold,
        letterSpacing = (-0.22).sp,
      )
      FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        for (opt in STUDY_OPTIONS) {
          EChip(
            opt.get(lang),
            selected = study == opt.en,
            onClick = { study = if (study == opt.en) "" else opt.en },
          )
        }
      }
      TinyText(tr(T.stays))
    }
    Box(modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp)) {
      GoldButton(buttonText, onClick = { onContinue(name.trim(), study) }, modifier = Modifier.fillMaxWidth())
    }
  }
}

@Composable
fun EField(
  value: String,
  onValueChange: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  height: Int = 56,
  capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
  onDone: (() -> Unit)? = null,
) {
  val p = pal()
  var focused by remember { mutableStateOf(false) }
  val shape = RoundedCornerShape(if (height >= 56) 16.dp else 99.dp)
  BasicTextField(
    value = value,
    onValueChange = onValueChange,
    singleLine = true,
    textStyle = TextStyle(color = p.text, fontSize = if (height >= 56) 15.sp else 14.sp),
    cursorBrush = SolidColor(p.gold),
    keyboardOptions =
      KeyboardOptions(capitalization = capitalization, imeAction = ImeAction.Done),
    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone?.invoke() }),
    modifier =
      modifier
        .fillMaxWidth()
        .heightIn(min = height.dp)
        .onFocusChanged { focused = it.isFocused }
        .clip(shape)
        .background(p.surface)
        .border(1.dp, if (focused) p.gold else p.line, shape),
    decorationBox = { inner ->
      Box(
        modifier = Modifier.padding(horizontal = 16.dp).heightIn(min = height.dp),
        contentAlignment = Alignment.CenterStart,
      ) {
        if (value.isEmpty()) EText(placeholder, color = p.muted, size = if (height >= 56) 15.sp else 14.sp)
        inner()
      }
    },
  )
}

// ------------------------------------------------------------------ 4 download

@Composable
fun DownloadScreen(
  lite: Model?,
  standard: Model?,
  statuses: Map<String, ModelDownloadStatus>,
  listLoading: Boolean,
  listError: Boolean,
  onRetryList: () -> Unit,
  onDownload: (Model) -> Unit,
  onBack: () -> Unit,
  onReady: (Model) -> Unit,
) {
  val p = pal()
  var pickStandard by rememberSaveable { mutableStateOf(false) }
  val picked = if (pickStandard) standard else lite
  val status = picked?.let { statuses[it.name] }
  val ready = status.isDownloaded()
  val downloading = status.isDownloading()
  val failed =
    status?.status == ModelDownloadStatusType.FAILED ||
      (status?.status == ModelDownloadStatusType.PARTIALLY_DOWNLOADED && !downloading)

  LaunchedEffect(ready, picked?.name) {
    if (ready && picked != null) {
      delay(700)
      onReady(picked)
    }
  }

  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
    BackBar(onBack)
    Column(
      modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      EText(tr(T.dlTitle), size = 22.sp, weight = FontWeight.SemiBold, letterSpacing = (-0.22).sp)
      EText(tr(T.dlSub), color = p.muted)
      when {
        lite == null && standard == null && listLoading -> TinyText(tr(T.gettingReady))
        lite == null && standard == null -> {
          if (listError) Banner(tr(T.listFailed), warn = true) else TinyText(tr(T.gettingReady))
          GoldButton(tr(T.retry), onClick = onRetryList, small = true)
        }
        else -> {
          if (lite != null) {
            ECard(selected = !pickStandard, onClick = { if (!downloading) pickStandard = false }) {
              RadioDot(!pickStandard)
              Column {
                EText("Elric Lite · ${gbText(lite.downloadInfo.totalBytes)}", size = 16.sp, weight = FontWeight.SemiBold)
                TinyText(tr(T.liteDesc))
              }
            }
          }
          if (standard != null) {
            ECard(selected = pickStandard, onClick = { if (!downloading) pickStandard = true }) {
              RadioDot(pickStandard)
              Column {
                EText(
                  "Elric Standard · ${gbText(standard.downloadInfo.totalBytes)}",
                  size = 16.sp,
                  weight = FontWeight.SemiBold,
                )
                TinyText(tr(T.standardDesc))
              }
            }
          }
          Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.surface2).padding(
              horizontal = 16.dp,
              vertical = 12.dp,
            )
          ) {
            EText(tr(T.wifiTip), size = 13.sp, color = p.muted)
          }
          if (picked != null && (downloading || ready || (status?.receivedBytes ?: 0L) > 0L)) {
            Column {
              GradBar(if (ready) 1f else status.fraction(picked))
              VSpace(8)
              val total = status?.totalBytes?.takeIf { it > 0 } ?: picked.downloadInfo.totalBytes
              TinyText(
                if (ready) tr(T.ready)
                else tr(T.ofGb, "done" to gbText(status?.receivedBytes ?: 0L), "total" to gbText(total))
              )
            }
          }
          if (failed) Banner(tr(T.dlFailed), warn = true)
        }
      }
    }
    Box(modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp)) {
      GoldButton(
        text =
          when {
            ready -> tr(T.ready)
            downloading -> tr(T.downloading)
            failed -> tr(T.resume)
            else -> tr(T.download)
          },
        onClick = { if (picked != null && !downloading && !ready) onDownload(picked) },
        enabled = picked != null && !downloading,
        modifier = Modifier.fillMaxWidth(),
      )
    }
  }
}

// ------------------------------------------------------------------ 9 models

@Composable
fun ModelsScreen(
  lite: Model?,
  standard: Model?,
  statuses: Map<String, ModelDownloadStatus>,
  activeName: String?,
  listLoading: Boolean,
  listError: Boolean,
  onRetryList: () -> Unit,
  totalStorageBytes: Long,
  onBack: () -> Unit,
  onDownload: (Model) -> Unit,
  onRemove: (Model) -> Unit,
  onUse: (Model) -> Unit,
) {
  val lang = LocalElricLang.current
  var confirmRemove by remember { mutableStateOf<Model?>(null) }
  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
    BackBar(onBack, tr(T.models))
    Column(
      modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      if (lite == null && standard == null) {
        if (listLoading) TinyText(tr(T.gettingReady))
        else {
          Banner(tr(if (listError) T.listFailed else T.gettingReady), warn = listError)
          GoldButton(tr(T.retry), onClick = onRetryList, small = true)
        }
      }
      for ((model, isLite) in listOfNotNull(lite?.let { it to true }, standard?.let { it to false })) {
        val st = statuses[model.name]
        val on = st.isDownloaded()
        val dl = st.isDownloading()
        val active = on && model.name == activeName
        val size = gbText(model.downloadInfo.totalBytes)
        ECard(selected = active, onClick = if (on && !active) ({ onUse(model) }) else null) {
          Column(modifier = Modifier.weight(1f)) {
            EText(if (isLite) "Elric Lite" else "Elric Standard", size = 16.sp, weight = FontWeight.SemiBold)
            val sub =
              when {
                dl ->
                  T.ofGb.format(
                    lang,
                    "done" to gbText(st?.receivedBytes ?: 0L),
                    "total" to gbText(st?.totalBytes?.takeIf { it > 0 } ?: model.downloadInfo.totalBytes),
                  )
                on -> T.installed.format(lang, "size" to size) + if (active) " · " + T.inUse.get(lang) else ""
                else -> "$size · " + (if (isLite) T.liteShort else T.standardShort).get(lang)
              }
            TinyText(sub)
            if (dl) {
              VSpace(8)
              GradBar(st.fraction(model))
            }
          }
          when {
            dl -> GoldButton("${(st.fraction(model) * 100).toInt()}%", onClick = {}, enabled = false, small = true)
            on -> TextBtn(tr(T.remove), onClick = { confirmRemove = model })
            else -> GoldButton(tr(T.download), onClick = { onDownload(model) }, small = true)
          }
        }
      }
      val used =
        listOfNotNull(lite, standard).filter { statuses[it.name].isDownloaded() }.sumOf {
          it.downloadInfo.totalBytes
        }
      Column {
        SecLabel(tr(T.storage), modifier = Modifier.padding(vertical = 8.dp))
        GradBar(if (totalStorageBytes > 0) used.toFloat() / totalStorageBytes else 0f)
        VSpace(8)
        TinyText(tr(T.storageUsed, "used" to gbText(used), "total" to gbText(totalStorageBytes)))
      }
    }
  }
  confirmRemove?.let { m ->
    val p = pal()
    val display = if (m === lite) "Elric Lite" else "Elric Standard"
    AlertDialog(
      onDismissRequest = { confirmRemove = null },
      containerColor = p.surface,
      text = { EText(T.removeConfirm.format(lang, "name" to display)) },
      confirmButton = {
        TextButton(
          onClick = {
            confirmRemove = null
            onRemove(m)
          }
        ) {
          EText(tr(T.remove), color = p.danger, weight = FontWeight.SemiBold)
        }
      },
      dismissButton = {
        TextButton(onClick = { confirmRemove = null }) { EText(tr(T.cancel), color = p.muted) }
      },
    )
  }
}

// ------------------------------------------------------------------ 10 privacy

@Composable
fun PrivacyScreen(onBack: () -> Unit) {
  val p = pal()
  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
    BackBar(onBack, tr(T.privacy))
    Column(
      modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Box(
        modifier =
          Modifier.padding(top = 24.dp, bottom = 8.dp)
            .size(112.dp)
            .clip(RoundedCornerShape(32.dp))
            .background(p.green.copy(alpha = 0.14f))
            .align(Alignment.CenterHorizontally),
        contentAlignment = Alignment.Center,
      ) {
        Icon(
          Icons.Outlined.VerifiedUser,
          contentDescription = null,
          tint = p.green,
          modifier = Modifier.size(56.dp),
        )
      }
      EText(
        tr(T.privacyTitle),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        size = 22.sp,
        weight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
      )
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (point in listOf(T.privacy1, T.privacy2, T.privacy3)) {
          Row(
            modifier =
              Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(p.surface)
                .border(1.dp, p.line, RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
          ) {
            EText("✓", size = 14.sp, weight = FontWeight.Bold, color = p.green)
            EText(tr(point), size = 14.sp)
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ 11 memory

@Composable
fun MemoryScreen(
  memories: List<ElricMemory>,
  on: Boolean,
  onToggle: (Boolean) -> Unit,
  onDelete: (ElricMemory) -> Unit,
  onClearAll: () -> Unit,
  onBack: () -> Unit,
) {
  val p = pal()
  var confirmClear by remember { mutableStateOf(false) }
  Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
    BackBar(onBack, tr(T.memory))
    Column(
      modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Banner(tr(T.memoryOnly), warn = false)
      Row(
        modifier =
          Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(p.surface)
            .border(1.dp, p.line, RoundedCornerShape(16.dp))
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        EText(tr(T.memorySwitch), size = 14.sp, modifier = Modifier.weight(1f))
        Switch(
          checked = on,
          onCheckedChange = onToggle,
          colors =
            SwitchDefaults.colors(
              checkedThumbColor = p.onGold,
              checkedTrackColor = p.gold,
              uncheckedThumbColor = p.muted,
              uncheckedTrackColor = p.surface2,
              uncheckedBorderColor = p.line,
            ),
        )
      }
      TinyText(tr(if (on) T.memoryHow else T.memoryOff), modifier = Modifier.padding(horizontal = 4.dp))
      if (memories.isEmpty()) {
        TinyText(tr(T.memoryEmpty), modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp))
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          for (m in memories) {
            Row(
              modifier =
                Modifier.fillMaxWidth()
                  .clip(RoundedCornerShape(16.dp))
                  .background(p.surface)
                  .border(1.dp, p.line, RoundedCornerShape(16.dp))
                  .padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              EText(
                m.text,
                size = 14.sp,
                color = if (on) p.text else p.muted,
                modifier = Modifier.weight(1f).padding(vertical = 10.dp),
              )
              RoundIcon(Icons.Rounded.Close, tr(T.delete), onClick = { onDelete(m) }, size = 44)
            }
          }
        }
        TextBtn(tr(T.clearAll), onClick = { confirmClear = true }, color = p.danger)
      }
    }
  }
  if (confirmClear) {
    AlertDialog(
      onDismissRequest = { confirmClear = false },
      containerColor = p.surface,
      text = { EText(tr(T.clearAllConfirm)) },
      confirmButton = {
        TextButton(
          onClick = {
            confirmClear = false
            onClearAll()
          }
        ) {
          EText(tr(T.clearAll), color = p.danger, weight = FontWeight.SemiBold)
        }
      },
      dismissButton = {
        TextButton(onClick = { confirmClear = false }) { EText(tr(T.cancel), color = p.muted) }
      },
    )
  }
}
