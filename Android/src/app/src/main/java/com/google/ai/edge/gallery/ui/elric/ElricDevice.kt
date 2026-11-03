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

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import java.util.Locale

/**
 * Picks where the model should start on this phone. The GPU path of the on-device engine can hang
 * or crawl on Mali (MediaTek) and Unisoc GPUs and on phones with little memory, so those start on
 * the CPU, which is slower per word but reliable.
 */
object ElricDevice {
  /**
   * Phones below this total memory start on the CPU. Android reports less than the marketed size
   * (an "8 GB" phone shows about 7.2-7.7 GB, a "6 GB" phone about 5.5 GB), so this sits between them.
   */
  private const val LOW_RAM_BYTES = 7_000_000_000L

  fun totalMemBytes(context: Context): Long =
    try {
      val am = context.getSystemService(ActivityManager::class.java)
      val mi = ActivityManager.MemoryInfo()
      am?.getMemoryInfo(mi)
      mi.totalMem
    } catch (e: Exception) {
      0L
    }

  fun isLowRam(context: Context): Boolean {
    val total = totalMemBytes(context)
    return total in 1 until LOW_RAM_BYTES
  }

  private fun socManufacturer(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MANUFACTURER ?: "" else ""

  private fun socModel(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL ?: "" else ""

  /** True on MediaTek (Mali GPU) and Unisoc chips, whose GPUs are risky for the engine. */
  fun isRiskyGpu(): Boolean {
    val soc = socManufacturer().lowercase(Locale.ROOT)
    if (
      soc.contains("mediatek") || soc.contains("unisoc") || soc.contains("spreadtrum") ||
        soc == "mtk"
    ) {
      return true
    }
    val model = socModel().lowercase(Locale.ROOT)
    if (model.startsWith("mt") || model.startsWith("ums") || model.startsWith("sc9863")) return true
    val hw = (Build.HARDWARE ?: "").lowercase(Locale.ROOT)
    val board = (Build.BOARD ?: "").lowercase(Locale.ROOT)
    for (v in listOf(hw, board)) {
      if (v.startsWith("mt") || v.startsWith("ums") || v.contains("unisoc") || v.contains("sprd")) {
        return true
      }
    }
    return false
  }

  /** True when the model should start on the CPU instead of trying the GPU first. */
  fun preferCpu(context: Context): Boolean = isLowRam(context) || isRiskyGpu()

  fun describe(context: Context): String =
    "ram=${totalMemBytes(context) / 1_000_000}MB soc=${socManufacturer()}/${socModel()} " +
      "hw=${Build.HARDWARE} board=${Build.BOARD}"
}
