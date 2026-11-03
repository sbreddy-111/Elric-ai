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

/**
 * Elric display names for the open models the app runs. Internal model names, ids and download
 * files are unchanged; only what the user sees is mapped. Model licenses stay listed in the
 * open-source licenses screen.
 */
private data class ElricModelBrand(val match: Regex, val displayName: String, val info: String)

private val BRANDS =
  listOf(
    ElricModelBrand(
      Regex("(?i)^gemma[-_ ]?4[-_ ]?e4b"),
      "Elric Standard",
      "Elric Standard gives the best answers and runs fully on your phone. Supports photos and audio.",
    ),
    ElricModelBrand(
      Regex("(?i)^gemma[-_ ]?4[-_ ]?e2b"),
      "Elric Lite",
      "Elric Lite is smaller and faster, and runs fully on your phone. Supports photos and audio.",
    ),
    ElricModelBrand(
      Regex("(?i)^gemma[-_ ]?3n[-_ ]?e4b"),
      "Elric Legacy Standard",
      "Older on-device model. Elric Standard is recommended.",
    ),
    ElricModelBrand(
      Regex("(?i)^gemma[-_ ]?3n[-_ ]?e2b"),
      "Elric Legacy Lite",
      "Older on-device model. Elric Lite is recommended.",
    ),
    ElricModelBrand(
      Regex("(?i)^gemma[-_ ]?3[-_ ]?1b"),
      "Elric Mini",
      "Very small text-only model for low-memory phones.",
    ),
    ElricModelBrand(
      Regex("(?i)^embeddinggemma"),
      "Elric Embedding",
      "On-device embedding model used for search features.",
    ),
  )

/** Returns the Elric display name for a model, or null to keep the model's own name. */
fun elricModelDisplayName(modelName: String): String? =
  BRANDS.firstOrNull { it.match.containsMatchIn(modelName) }?.displayName

/** Returns an Elric description for a model, or null to keep the allowlist description. */
fun elricModelInfo(modelName: String): String? =
  BRANDS.firstOrNull { it.match.containsMatchIn(modelName) }?.info

/**
 * Sort key for picking a default model: lower is preferred. Elric Standard, then Elric Lite, then
 * anything else; older (Gemma 3 family) models last.
 */
fun elricModelPreference(modelName: String): Int =
  when (elricModelDisplayName(modelName)) {
    "Elric Standard" -> 0
    "Elric Lite" -> 1
    null -> 5
    "Elric Embedding" -> 6
    else -> 8
  }
