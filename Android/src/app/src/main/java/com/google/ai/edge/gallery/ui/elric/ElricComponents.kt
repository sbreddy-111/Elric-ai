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
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

val ElricEase = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)

@Composable fun pal(): ElricPalette = LocalElricPalette.current

/** Plain text in the Elric palette. */
@Composable
fun EText(
  text: String,
  modifier: Modifier = Modifier,
  size: TextUnit = 15.sp,
  weight: FontWeight = FontWeight.Normal,
  color: Color = pal().text,
  lineHeight: TextUnit = TextUnit.Unspecified,
  maxLines: Int = Int.MAX_VALUE,
  letterSpacing: TextUnit = TextUnit.Unspecified,
  style: TextStyle? = null,
  textAlign: androidx.compose.ui.text.style.TextAlign? = null,
) {
  val base =
    style
      ?: TextStyle(
        color = color,
        fontSize = size,
        fontWeight = weight,
        lineHeight = if (lineHeight == TextUnit.Unspecified) (size.value * 1.5f).sp else lineHeight,
        letterSpacing = letterSpacing,
      )
  Text(
    text = text,
    modifier = modifier,
    style = if (textAlign != null) base.copy(textAlign = textAlign) else base,
    maxLines = maxLines,
    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
  )
}

@Composable
fun TinyText(text: String, modifier: Modifier = Modifier, color: Color = pal().muted) {
  EText(text, modifier = modifier, size = 12.sp, color = color)
}

/** Gold pill button (`.btn`). */
@Composable
fun GoldButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  small: Boolean = false,
) {
  val p = pal()
  Box(
    modifier =
      modifier
        .heightIn(min = if (small) 44.dp else 48.dp)
        .clip(CircleShape)
        .background(p.gold.copy(alpha = if (enabled) 1f else 0.6f))
        .clickable(enabled = enabled, onClick = onClick)
        .padding(horizontal = if (small) 18.dp else 24.dp),
    contentAlignment = Alignment.Center,
  ) {
    EText(text, size = if (small) 14.sp else 15.sp, weight = FontWeight.SemiBold, color = p.onGold)
  }
}

/** Text button (`.btn--text`). */
@Composable
fun TextBtn(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = pal().muted) {
  Box(
    modifier =
      modifier.heightIn(min = 48.dp).clip(CircleShape).clickable(onClick = onClick).padding(
        horizontal = 16.dp
      ),
    contentAlignment = Alignment.Center,
  ) {
    EText(text, weight = FontWeight.Medium, color = color)
  }
}

/** Outlined chip (`.chip`), gold when selected. */
@Composable
fun EChip(
  text: String,
  selected: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  large: Boolean = false,
) {
  val p = pal()
  Box(
    modifier =
      modifier
        .heightIn(min = if (large) 56.dp else 44.dp)
        .clip(CircleShape)
        .background(if (selected) p.goldTint else Color.Transparent)
        .border(1.dp, if (selected) p.gold else p.line, CircleShape)
        .clickable(onClick = onClick)
        .padding(horizontal = 16.dp),
    contentAlignment = Alignment.Center,
  ) {
    EText(
      text,
      size = if (large) 16.sp else 13.sp,
      weight = if (large) FontWeight.Medium else FontWeight.Normal,
      color = if (selected) p.goldInk else p.muted,
    )
  }
}

/** Round 48dp icon button (`.icon`). */
@Composable
fun RoundIcon(
  icon: ImageVector,
  contentDescription: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  size: Int = 48,
  tint: Color = pal().muted,
) {
  Box(
    modifier = modifier.size(size.dp).clip(CircleShape).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(22.dp))
  }
}

/** 56dp app bar row. */
@Composable
fun AppBar(content: @Composable RowScope.() -> Unit) {
  Row(
    modifier = Modifier.fillMaxWidth().height(56.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    content = content,
  )
}

/** Section label (`.sec`). */
@Composable
fun SecLabel(text: String, modifier: Modifier = Modifier) {
  EText(
    text.uppercase(),
    modifier = modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp, bottom = 2.dp),
    size = 12.sp,
    weight = FontWeight.SemiBold,
    color = pal().muted,
    letterSpacing = 0.7.sp,
  )
}

/** Thin progress bar with the gold→indigo gradient (`.bar`). */
@Composable
fun GradBar(progress: Float, modifier: Modifier = Modifier) {
  val p = pal()
  Box(modifier = modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(p.surface2)) {
    Box(
      modifier =
        Modifier.fillMaxWidth(progress.coerceIn(0f, 1f))
          .height(8.dp)
          .clip(CircleShape)
          .background(p.grad)
    )
  }
}

/** Banner (`.banner`), green or gold when [warn]. */
@Composable
fun Banner(text: String, warn: Boolean, modifier: Modifier = Modifier) {
  val p = pal()
  Box(
    modifier =
      modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(12.dp))
        .background(if (warn) p.goldTint else p.greenTint)
        .padding(horizontal = 14.dp, vertical = 8.dp)
  ) {
    EText(text, size = 13.sp, color = if (warn) p.goldInk else p.green)
  }
}

/** Card surface used for model cards and the like (`.card`). */
@Composable
fun ECard(
  modifier: Modifier = Modifier,
  selected: Boolean = false,
  onClick: (() -> Unit)? = null,
  content: @Composable RowScope.() -> Unit,
) {
  val p = pal()
  val shape = RoundedCornerShape(20.dp)
  Row(
    modifier =
      modifier
        .fillMaxWidth()
        .heightIn(min = 76.dp)
        .clip(shape)
        .background(if (selected) p.goldTint else p.surface)
        .border(1.dp, if (selected) p.gold else p.line, shape)
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
        .padding(16.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.Top,
    content = content,
  )
}

/** Radio dot (`.radio`). */
@Composable
fun RadioDot(selected: Boolean) {
  val p = pal()
  Box(
    modifier =
      Modifier.padding(top = 2.dp)
        .size(20.dp)
        .border(2.dp, if (selected) p.gold else p.muted, CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    if (selected) Box(Modifier.size(10.dp).clip(CircleShape).background(p.gold))
  }
}

/** Option row in a sheet (`.opt`). */
@Composable
fun SheetOption(
  glyph: String,
  title: String,
  subtitle: String?,
  selected: Boolean,
  onClick: () -> Unit,
) {
  val p = pal()
  val shape = RoundedCornerShape(16.dp)
  Row(
    modifier =
      Modifier.fillMaxWidth()
        .heightIn(min = 64.dp)
        .clip(shape)
        .background(if (selected) p.goldTint else Color.Transparent)
        .border(1.dp, if (selected) p.gold else Color.Transparent, shape)
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(
      modifier =
        Modifier.size(40.dp)
          .clip(RoundedCornerShape(12.dp))
          .background(if (selected) p.surface else p.surface2),
      contentAlignment = Alignment.Center,
    ) {
      EText(glyph, size = 17.sp, color = if (selected) p.goldInk else p.text)
    }
    Column {
      EText(title, weight = FontWeight.SemiBold)
      if (subtitle != null) EText(subtitle, size = 12.sp, color = p.muted)
    }
  }
}

/**
 * Scrim plus a bottom sheet that slides up (`.sheet`). Drag the handle down to close.
 */
@Composable
fun BoxScope.BottomSheetOverlay(
  visible: Boolean,
  onDismiss: () -> Unit,
  content: @Composable ColumnScope.() -> Unit,
) {
  val p = pal()
  Scrim(visible = visible, onDismiss = onDismiss)
  AnimatedVisibility(
    visible = visible,
    modifier = Modifier.align(Alignment.BottomCenter),
    enter = slideInVertically(tween(300, easing = ElricEase)) { it },
    exit = slideOutVertically(tween(300, easing = ElricEase)) { it },
  ) {
    var drag by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    Column(
      modifier =
        Modifier.fillMaxWidth()
          .offset { IntOffset(0, drag.roundToInt()) }
          .clip(shape)
          .background(p.surface)
          .border(1.dp, p.line, shape)
          .clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = {},
          )
          .navigationBarsPadding()
          .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
          .verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      // Handle.
      Box(
        modifier =
          Modifier.fillMaxWidth().height(24.dp).pointerInput(Unit) {
            detectVerticalDragGestures(
              onDragEnd = {
                if (drag > with(density) { 60.dp.toPx() }) onDismiss()
                drag = 0f
              },
              onDragCancel = { drag = 0f },
            ) { _, dy ->
              drag = (drag + dy).coerceAtLeast(0f)
            }
          },
        contentAlignment = Alignment.Center,
      ) {
        Box(Modifier.width(36.dp).height(4.dp).clip(CircleShape).background(p.line))
      }
      content()
    }
  }
}

@Composable
fun Scrim(visible: Boolean, onDismiss: () -> Unit) {
  AnimatedVisibility(
    visible = visible,
    enter = fadeIn(tween(250, easing = ElricEase)),
    exit = fadeOut(tween(250, easing = ElricEase)),
  ) {
    Box(
      modifier =
        Modifier.fillMaxSize()
          .background(pal().scrim)
          .clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = onDismiss,
          )
    )
  }
}

/** Small pill toast near the bottom (`.toast`). */
@Composable
fun BoxScope.Toast(message: String?) {
  val p = pal()
  AnimatedVisibility(
    visible = message != null,
    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 104.dp),
    enter = fadeIn(tween(250)) + slideInVertically(tween(250)) { it / 3 },
    exit = fadeOut(tween(250)),
  ) {
    var last by remember { androidx.compose.runtime.mutableStateOf("") }
    if (message != null) last = message
    Box(
      modifier =
        Modifier.clip(CircleShape)
          .background(p.surface2)
          .border(1.dp, p.line, CircleShape)
          .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
      EText(last, size = 13.sp)
    }
  }
}

@Composable fun VSpace(h: Int) = Spacer(Modifier.height(h.dp))
