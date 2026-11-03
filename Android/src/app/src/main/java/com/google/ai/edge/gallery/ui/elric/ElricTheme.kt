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

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** Elric AI palette, taken from the approved Android UI design (dark, and light with cream). */
@Immutable
data class ElricPalette(
  val isLight: Boolean,
  val bg: Color,
  val surface: Color,
  val surface2: Color,
  val line: Color,
  val text: Color,
  val muted: Color,
  val gold: Color,
  val indigo: Color,
  val green: Color,
  val goldInk: Color,
  val goldTint: Color,
  val greenTint: Color,
  val indigoInk: Color,
  val indigoTint: Color,
  val onGold: Color,
  val danger: Color,
  val scrim: Color,
  val gesture: Color,
) {
  val grad: Brush
    get() = Brush.linearGradient(listOf(gold, indigo))
}

val ElricDarkPalette =
  ElricPalette(
    isLight = false,
    bg = Color(0xFF0F0F12),
    surface = Color(0xFF17171C),
    surface2 = Color(0xFF1F1F26),
    line = Color(0xFF2A2A33),
    text = Color(0xFFECECF1),
    muted = Color(0xFF9A9AA6),
    gold = Color(0xFFD4A64A),
    indigo = Color(0xFF6C6CF0),
    green = Color(0xFF3DBE7A),
    goldInk = Color(0xFFD4A64A),
    goldTint = Color(0xFF2B241A),
    greenTint = Color(0xFF15241F),
    indigoInk = Color(0xFF8C8CF5),
    indigoTint = Color(0xFF1C1C31),
    onGold = Color(0xFF1A1405),
    danger = Color(0xFFE5484D),
    scrim = Color(0x8C000000),
    gesture = Color(0xFF3A3A44),
  )

val ElricLightPalette =
  ElricPalette(
    isLight = true,
    bg = Color(0xFFFAFAF7),
    surface = Color(0xFFFFFFFF),
    surface2 = Color(0xFFF1F0EC),
    line = Color(0xFFE4E2DC),
    text = Color(0xFF15151A),
    muted = Color(0xFF6B6B75),
    gold = Color(0xFFB8862E),
    indigo = Color(0xFF4B4BD6),
    green = Color(0xFF17703F),
    goldInk = Color(0xFF7F5A12),
    goldTint = Color(0xFFF8F1E3),
    greenTint = Color(0xFFE3F1E9),
    indigoInk = Color(0xFF4B4BD6),
    indigoTint = Color(0xFFE8E8FA),
    onGold = Color(0xFF1A1405),
    danger = Color(0xFFD93B40),
    scrim = Color(0x5215151A),
    gesture = Color(0xFFCFCDC6),
  )

val LocalElricPalette = staticCompositionLocalOf { ElricDarkPalette }
