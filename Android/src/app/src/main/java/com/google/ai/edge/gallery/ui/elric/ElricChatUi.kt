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

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import android.os.SystemClock
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.ai.edge.gallery.ui.common.MarkdownText
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

fun modeLabel(m: ElricMode): Str =
  when (m) {
    ElricMode.STUDY -> T.study
    ElricMode.SHOPPING -> T.shopping
    ElricMode.GENERAL -> T.general
  }

@Composable
fun ElricTopBar(
  isChat: Boolean,
  mode: ElricMode,
  onLeft: () -> Unit,
  onMode: () -> Unit,
  onNewChat: () -> Unit,
) {
  val p = pal()
  AppBar {
    if (isChat) RoundIcon(Icons.AutoMirrored.Rounded.ArrowBack, tr(T.back), onLeft, tint = p.text)
    else RoundIcon(Icons.Rounded.Menu, tr(T.menu), onLeft, tint = p.text)
    Spacer(Modifier.weight(1f))
    Row(
      modifier =
        Modifier.heightIn(min = 44.dp)
          .clip(CircleShape)
          .background(p.surface2)
          .border(1.dp, p.line, CircleShape)
          .clickable(onClick = onMode)
          .padding(horizontal = 18.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      EText(tr(modeLabel(mode)), size = 14.sp, weight = FontWeight.Medium)
      Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = p.text, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.weight(1f))
    RoundIcon(Icons.Outlined.Edit, tr(T.newChat), onNewChat, tint = p.text)
  }
}

/** Status chip, banners and greeting at the top of Home. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeContent(
  mode: ElricMode,
  offline: Boolean,
  name: String,
  onSuggestion: (index: Int, text: String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val p = pal()
  val lang = LocalElricLang.current
  val shop = mode == ElricMode.SHOPPING
  Column(
    modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 8.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    if (offline) Banner(tr(if (shop) T.offlineAll else T.offlineStudy), warn = false)
    Box(
      modifier =
        Modifier.clip(CircleShape)
          .background(if (shop) p.indigoTint else p.greenTint)
          .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
      EText(tr(if (shop) T.shopOffline else T.onDevice), size = 12.sp, color = if (shop) p.indigoInk else p.green)
    }
    if (shop) TinyText(tr(T.livePricesSoon), modifier = Modifier.padding(top = 0.dp).graphicsLayer { translationY = -8.dp.toPx() })
    Column {
      val who = name.trim().ifEmpty { T.there.get(lang) }
      androidx.compose.material3.Text(
        text = T.hello.get(lang) + who,
        style =
          TextStyle(
            brush = p.grad,
            fontSize = 32.sp,
            lineHeight = if (lang == ElricLang.HI) 46.sp else 37.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.64).sp,
          ),
      )
      VSpace(4)
      EText(tr(T.reliable), color = p.muted)
    }
    Spacer(Modifier.height(24.dp))
    val sugg = listOf("◎" to T.sugQuiz, "▣" to T.sugPhoto, "▤" to T.sugTimetable, "◴" to T.sugWatch)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      for (row in 0..1) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          for (col in 0..1) {
            val i = row * 2 + col
            val (glyph, s) = sugg[i]
            val text = s.get(lang)
            Column(
              modifier =
                Modifier.weight(1f)
                  .heightIn(min = 112.dp)
                  .clip(RoundedCornerShape(20.dp))
                  .background(p.surface)
                  .border(1.dp, p.line, RoundedCornerShape(20.dp))
                  .clickable { onSuggestion(i, text) }
                  .padding(16.dp),
              verticalArrangement = Arrangement.SpaceBetween,
            ) {
              EText(glyph, size = 18.sp)
              VSpace(12)
              EText(text, size = 14.sp, lineHeight = 19.sp)
            }
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ composer

@Composable
fun Composer(
  value: String,
  onValueChange: (String) -> Unit,
  busy: Boolean,
  listening: Boolean,
  onCamera: () -> Unit,
  onMic: () -> Unit,
  onStopListening: () -> Unit,
  onSend: () -> Unit,
  onStop: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val p = pal()
  val border by animateColorAsState(if (listening) p.gold else p.line, tween(250), label = "border")
  Row(
    modifier =
      modifier
        .padding(bottom = 8.dp)
        .fillMaxWidth()
        .heightIn(min = 60.dp)
        .clip(RoundedCornerShape(30.dp))
        .background(p.surface)
        .border(1.dp, border, RoundedCornerShape(30.dp))
        .padding(8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    if (listening) {
      Row(
        modifier =
          Modifier.weight(1f).heightIn(min = 44.dp).clip(CircleShape).clickable(onClick = onStopListening).padding(
            horizontal = 12.dp
          ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Wave()
        EText(tr(T.listening), size = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
        TinyText(tr(T.tapToStop))
      }
      return@Row
    }
    Box(
      modifier = Modifier.size(44.dp).clip(CircleShape).background(p.gold).clickable(onClick = onCamera),
      contentAlignment = Alignment.Center,
    ) {
      Icon(Icons.Rounded.PhotoCamera, contentDescription = tr(T.camera), tint = p.onGold, modifier = Modifier.size(20.dp))
    }
    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
      if (value.isEmpty()) EText(tr(T.askAnything), color = p.muted, maxLines = 1)
      BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = TextStyle(color = p.text, fontSize = 15.sp, lineHeight = 21.sp),
        cursorBrush = SolidColor(p.gold),
        maxLines = 5,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { if (!busy) onSend() }),
        modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(vertical = 9.dp),
      )
    }
    RoundIcon(Icons.Rounded.Mic, tr(T.voice), onMic, size = 44)
    val live = busy || value.isNotBlank()
    val bg by animateColorAsState(if (live) p.gold else p.surface2, tween(250), label = "send")
    Box(
      modifier =
        Modifier.size(44.dp).clip(CircleShape).background(bg).clickable {
          if (busy) onStop() else onSend()
        },
      contentAlignment = Alignment.Center,
    ) {
      Icon(
        if (busy) Icons.Rounded.Stop else Icons.Rounded.ArrowUpward,
        contentDescription = tr(if (busy) T.stop else T.send),
        tint = if (live) p.onGold else p.muted,
        modifier = Modifier.size(20.dp),
      )
    }
  }
}

@Composable
private fun Wave() {
  val p = pal()
  val t = rememberInfiniteTransition(label = "wave")
  Row(
    modifier = Modifier.height(24.dp),
    horizontalArrangement = Arrangement.spacedBy(3.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    for (i in 0 until 5) {
      val s by
        t.animateFloat(
          initialValue = 0.25f,
          targetValue = 1f,
          animationSpec =
            infiniteRepeatable(
              tween(450, delayMillis = i * 120, easing = ElricEase),
              RepeatMode.Reverse,
            ),
          label = "bar$i",
        )
      Box(
        Modifier.width(3.dp).fillMaxHeight().graphicsLayer { scaleY = s }.clip(CircleShape).background(p.gold)
      )
    }
  }
}

// ------------------------------------------------------------------ chat thread

private fun words(text: String): Int = text.trim().split(Regex("\\s+")).count { it.isNotEmpty() }

private fun secs(ms: Long): String = String.format(Locale.US, "%.1f", ms / 1000.0)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatThread(
  turns: List<ElricTurn>,
  busy: Boolean,
  engine: ElricEngineState,
  loadStartedAt: Long,
  firstStart: Boolean,
  needsModel: Boolean,
  streamTick: Int,
  onEdit: (Int) -> Unit,
  onCopy: (String) -> Unit,
  onSpeak: (String) -> Unit,
  onRegenerate: () -> Unit,
  onRate: (Int, Int) -> Unit,
  onFollow: (String) -> Unit,
  onOpenModels: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val p = pal()
  val lang = LocalElricLang.current
  val listState = rememberLazyListState()
  val scope = rememberCoroutineScope()
  var follow by remember { mutableStateOf(true) }
  val itemCount = turns.size + 2 // turns, chips/need-model, bottom spacer

  // The user scrolling up stops following; reaching the bottom starts it again.
  LaunchedEffect(listState) {
    listState.interactionSource.interactions.collect { if (it is DragInteraction.Start) follow = false }
  }
  LaunchedEffect(listState) {
    snapshotFlow { listState.canScrollForward }.collect { if (!it) follow = true }
  }
  LaunchedEffect(turns.size) {
    follow = true
    scrollToBottom(listState, itemCount)
  }
  LaunchedEffect(streamTick) { if (follow) scrollToBottom(listState, itemCount) }

  val lastModel = turns.indexOfLast { !it.isUser }
  Box(modifier = modifier) {
    LazyColumn(
      state = listState,
      modifier = Modifier.fillMaxSize(),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      item { Spacer(Modifier.height(0.dp)) }
      for ((i, t) in turns.withIndex()) {
        item(key = "t$i") {
          if (t.isUser) {
            Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
              Box(modifier = Modifier.fillMaxWidth(0.84f), contentAlignment = Alignment.CenterEnd) {
                Box(
                  modifier =
                    Modifier.clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp))
                      .background(p.surface2)
                      .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                  EText(t.text)
                }
              }
              if (!busy) {
                Box(
                  modifier =
                    Modifier.heightIn(min = 44.dp).widthIn(min = 64.dp).clip(CircleShape).clickable {
                      onEdit(i)
                    }.padding(horizontal = 12.dp),
                  contentAlignment = Alignment.Center,
                ) {
                  TinyText(tr(T.edit))
                }
              }
            }
          } else {
            val streaming = busy && i == turns.size - 1
            AnswerBlock(
              turn = t,
              streaming = streaming,
              engine = engine,
              loadStartedAt = loadStartedAt,
              firstStart = firstStart,
              isLast = i == lastModel,
              onCopy = { onCopy(t.text) },
              onSpeak = { onSpeak(t.text) },
              onRegenerate = onRegenerate,
              onRate = { v -> onRate(i, v) },
            )
          }
        }
      }
      item(key = "tail") {
        when {
          needsModel ->
            Column(
              modifier =
                Modifier.fillMaxWidth()
                  .clip(RoundedCornerShape(20.dp))
                  .background(p.surface)
                  .border(1.dp, p.line, RoundedCornerShape(20.dp))
                  .padding(16.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              EText(tr(T.needModelTitle), weight = FontWeight.SemiBold)
              EText(tr(T.needModelBody), size = 14.sp, color = p.muted)
              GoldButton(tr(T.openModels), onClick = onOpenModels, small = true)
            }
          !busy && turns.isNotEmpty() && !turns.last().isUser && turns.last().failed != true -> {
            val follows =
              listOf(
                T.giveExample.get(lang),
                T.quizMe.get(lang),
                (if (lang == ElricLang.HI) T.explainEnglish else T.explainHindi).get(lang),
              )
            FlowRow(
              horizontalArrangement = Arrangement.spacedBy(8.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp),
              modifier = Modifier.padding(bottom = 4.dp),
            ) {
              for (f in follows) EChip(f, selected = false, onClick = { onFollow(f) })
            }
          }
          else -> Spacer(Modifier.height(0.dp))
        }
      }
    }

    AnimatedVisibility(
      visible = !follow && listState.canScrollForward,
      modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
      enter = fadeIn(tween(250)),
      exit = fadeOut(tween(250)),
    ) {
      Box(
        modifier =
          Modifier.size(44.dp)
            .clip(CircleShape)
            .background(p.surface2)
            .border(1.dp, p.line, CircleShape)
            .clickable {
              follow = true
              scope.launch { scrollToBottom(listState, itemCount) }
            },
        contentAlignment = Alignment.Center,
      ) {
        Icon(Icons.Rounded.ArrowDownward, contentDescription = tr(T.scrollLatest), tint = p.text, modifier = Modifier.size(20.dp))
      }
    }
  }
}

private suspend fun scrollToBottom(listState: androidx.compose.foundation.lazy.LazyListState, count: Int) {
  if (count > 0) {
    listState.scrollToItem(count - 1)
    listState.scrollBy(100000f)
  }
}

@Composable
private fun AnswerBlock(
  turn: ElricTurn,
  streaming: Boolean,
  engine: ElricEngineState,
  loadStartedAt: Long,
  firstStart: Boolean,
  isLast: Boolean,
  onCopy: () -> Unit,
  onSpeak: () -> Unit,
  onRegenerate: () -> Unit,
  onRate: (Int) -> Unit,
) {
  val p = pal()
  val lang = LocalElricLang.current
  Column(modifier = Modifier.fillMaxWidth(0.94f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    if (turn.text.isEmpty() && streaming) {
      if (engine == ElricEngineState.Loading) {
        LoadingProgress(startedAt = loadStartedAt, firstStart = firstStart)
      } else {
        TypingDots()
      }
      return@Column
    }
    if (turn.failed == true) {
      EText(turn.text, size = 14.sp, color = p.muted)
      if (isLast && !streaming) {
        EChip(tr(T.retryShort), selected = false, onClick = onRegenerate)
      }
    } else {
      MarkdownText(
        text = displayAnswer(turn.text) + if (streaming) " ▍" else "",
        textColor = p.text,
        linkColor = p.indigoInk,
      )
    }
    if (turn.memSaved == true && !streaming) {
      TinyText(tr(T.savedToMemory), color = p.green)
    }
    if (!streaming && turn.failed != true) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Act(Icons.Outlined.ContentCopy, tr(T.copy), false, onCopy)
        Act(Icons.AutoMirrored.Outlined.VolumeUp, tr(T.readAloud), false, onSpeak)
        if (isLast) Act(Icons.Rounded.Refresh, tr(T.regenerate), false, onRegenerate)
        Act(Icons.Outlined.ThumbUp, tr(T.goodAnswer), turn.rating == 1) { onRate(1) }
        Act(Icons.Outlined.ThumbDown, tr(T.badAnswer), turn.rating == -1) { onRate(-1) }
        val ms = turn.ms
        if (ms != null) {
          TinyText(T.statTime.format(lang, "s" to secs(ms)), modifier = Modifier.padding(start = 8.dp))
        }
      }
      val ms = turn.ms
      if (ms != null) {
        val parts = mutableListOf<String>()
        turn.firstMs?.let { parts.add(T.statFirst.format(lang, "s" to secs(it))) }
        val w = words(turn.text)
        val gen = (ms - (turn.firstMs ?: 0L)).coerceAtLeast(1L)
        if (w > 3) {
          parts.add(T.statSpeed.format(lang, "n" to String.format(Locale.US, "%.1f", w / (gen / 1000.0))))
        }
        if (parts.isNotEmpty()) {
          TinyText(parts.joinToString(" · "), modifier = Modifier.padding(start = 12.dp).graphicsLayer { translationY = -6.dp.toPx() })
        }
      }
    }
  }
}

@Composable
private fun Act(icon: ImageVector, desc: String, on: Boolean, onClick: () -> Unit) {
  val p = pal()
  Box(
    modifier = Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, contentDescription = desc, tint = if (on) p.goldInk else p.muted, modifier = Modifier.size(18.dp))
  }
}

/** "Elric is getting ready… 12 s", plus a hint the first time a model starts on this phone. */
@Composable
private fun LoadingProgress(startedAt: Long, firstStart: Boolean) {
  val lang = LocalElricLang.current
  var now by remember(startedAt) { mutableStateOf(SystemClock.elapsedRealtime()) }
  LaunchedEffect(startedAt) {
    while (true) {
      now = SystemClock.elapsedRealtime()
      delay(1000)
    }
  }
  val secs = if (startedAt > 0L) ((now - startedAt) / 1000L).coerceAtLeast(0L) else 0L
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      TypingDots()
      TinyText(T.starting.format(lang, "s" to secs.toString()))
    }
    if (firstStart) TinyText(tr(T.firstStartHint))
  }
}

@Composable
private fun TypingDots() {
  val p = pal()
  val t = rememberInfiniteTransition(label = "dots")
  Row(horizontalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.padding(vertical = 8.dp)) {
    for (i in 0 until 3) {
      val a by
        t.animateFloat(
          initialValue = 0.25f,
          targetValue = 1f,
          animationSpec = infiniteRepeatable(tween(500, delayMillis = i * 150), RepeatMode.Reverse),
          label = "d$i",
        )
      Box(Modifier.size(7.dp).graphicsLayer { alpha = a }.clip(CircleShape).background(p.gold))
    }
  }
}
