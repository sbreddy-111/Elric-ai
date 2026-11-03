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

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Full-screen Talk view: a big circle that moves with the voice (Listening), breathes while
 * Elric thinks, and pulses while it speaks. Tap the circle to interrupt or to speak again.
 */
@Composable
fun TalkView(
  state: ElricTalkState,
  muted: Boolean,
  level: Float,
  caption: String,
  onTap: () -> Unit,
  onMute: () -> Unit,
  onEnd: () -> Unit,
) {
  val p = pal()
  val lang = LocalElricLang.current
  val inf = rememberInfiniteTransition(label = "talk")
  val breathe by
    inf.animateFloat(
      initialValue = 0.94f,
      targetValue = 1.04f,
      animationSpec = infiniteRepeatable(tween(1300, easing = ElricEase), RepeatMode.Reverse),
      label = "breathe",
    )
  val pulse by
    inf.animateFloat(
      initialValue = 0.97f,
      targetValue = 1.08f,
      animationSpec = infiniteRepeatable(tween(420, easing = ElricEase), RepeatMode.Reverse),
      label = "pulse",
    )
  val spin by
    inf.animateFloat(
      initialValue = 0f,
      targetValue = 360f,
      animationSpec = infiniteRepeatable(tween(2600, easing = LinearEasing)),
      label = "spin",
    )
  val lvl by animateFloatAsState(level, tween(120), label = "level")
  val scale =
    when (state) {
      ElricTalkState.LISTENING -> 0.9f + lvl * 0.3f
      ElricTalkState.SPEAKING -> pulse
      ElricTalkState.THINKING,
      ElricTalkState.PREPARING -> breathe
      else -> 0.88f
    }
  val dim = state == ElricTalkState.PAUSED || state == ElricTalkState.MUTED
  val label =
    when (state) {
      ElricTalkState.LISTENING -> T.talkListening
      ElricTalkState.PREPARING -> T.talkPreparing
      ElricTalkState.THINKING -> T.talkThinking
      ElricTalkState.SPEAKING -> T.talkSpeaking
      ElricTalkState.MUTED -> T.talkMutedLabel
      else -> T.talkPaused
    }

  Column(
    modifier =
      Modifier.fillMaxSize()
        .background(p.bg)
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
        .padding(horizontal = 24.dp, vertical = 16.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    EText(tr(T.brand), size = 16.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
    TinyText(tr(T.talk))
    Spacer(Modifier.weight(1f))
    Box(modifier = Modifier.size(280.dp), contentAlignment = Alignment.Center) {
      Box(
        modifier =
          Modifier.size(260.dp)
            .graphicsLayer {
              scaleX = scale
              scaleY = scale
            }
            .clip(CircleShape)
            .border(2.dp, p.gold.copy(alpha = if (state == ElricTalkState.LISTENING) 0.15f + lvl * 0.6f else 0.12f), CircleShape)
      )
      Box(
        modifier =
          Modifier.size(210.dp)
            .graphicsLayer {
              scaleX = scale
              scaleY = scale
              rotationZ = if (state == ElricTalkState.THINKING || state == ElricTalkState.PREPARING) spin else 0f
              alpha = if (dim) 0.45f else 1f
            }
            .clip(CircleShape)
            .background(p.grad)
            .clickable(onClick = onTap)
      )
    }
    EText(
      tr(label),
      size = 20.sp,
      weight = FontWeight.SemiBold,
      textAlign = TextAlign.Center,
      modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
    )
    if (caption.isNotBlank()) {
      EText(
        caption,
        size = 14.sp,
        color = p.muted,
        maxLines = 3,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
      )
    }
    Spacer(Modifier.weight(1f))
    TinyText(tr(T.talkHint), modifier = Modifier.padding(bottom = 16.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(40.dp), verticalAlignment = Alignment.CenterVertically) {
      TalkButton(
        icon = if (muted) Icons.Rounded.MicOff else Icons.Rounded.Mic,
        label = tr(if (muted) T.talkUnmute else T.talkMute),
        bg = if (muted) p.gold else p.surface2,
        tint = if (muted) p.onGold else p.text,
        onClick = onMute,
      )
      TalkButton(icon = Icons.Rounded.Close, label = tr(T.talkEnd), bg = p.danger, tint = Color.White, onClick = onEnd)
    }
  }
}

@Composable
private fun TalkButton(icon: ImageVector, label: String, bg: Color, tint: Color, onClick: () -> Unit) {
  Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Box(
      modifier = Modifier.size(64.dp).clip(CircleShape).background(bg).clickable(onClick = onClick),
      contentAlignment = Alignment.Center,
    ) {
      Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(26.dp))
    }
    TinyText(label)
  }
}
