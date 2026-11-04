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

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File

private const val TAG = "ElricStore"
private const val PREFS = "elric_prefs"
private const val CHATS_FILE = "elric_chats.json"

/** Maximum number of saved chats kept on the phone (same as the web app). */
const val ELRIC_MAX_CHATS = 50

/** Elric modes. Stored by [id]. */
enum class ElricMode(val id: String) {
  STUDY("study"),
  SHOPPING("shopping"),
  GENERAL("general");

  companion object {
    fun fromId(id: String?): ElricMode = entries.firstOrNull { it.id == id } ?: STUDY
  }
}

/** One turn of a chat. Model turns carry their timing stats. */
data class ElricTurn(
  val role: String, // "user" or "model"
  val text: String,
  /** Total answer time in ms (model turns only). */
  val ms: Long? = null,
  /** Time to first word in ms. */
  val firstMs: Long? = null,
  /** 1 = good, -1 = bad, 0 = not rated. */
  val rating: Int? = null,
  /** True for answers that failed or were stopped before any text; never sent back to the model. */
  val failed: Boolean? = null,
  /** True when the question this answers added a memory (shows "Saved to memory"). */
  val memSaved: Boolean? = null,
  /** Private path of the photo sent with this question (user turns only), if any. */
  val image: String? = null,
  /** Where the answer was made: "online" or "offline" (model turns; null in older chats). */
  val src: String? = null,
) {
  val isUser: Boolean
    get() = role == "user"
}

data class ElricChat(
  val id: String,
  val title: String,
  val mode: String,
  val turns: List<ElricTurn>,
  val at: Long,
)

/** Local-only storage: preferences in SharedPreferences, chats in one JSON file. */
class ElricStore(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val chatsFile = File(context.filesDir, CHATS_FILE)
  private val gson = Gson()

  /** Backend ("cpu" or "gpu") that last started [modelName] on this phone, or "" if none yet. */
  fun backendFor(modelName: String): String = prefs.getString("backend_$modelName", "") ?: ""

  fun saveBackend(modelName: String, backend: String) {
    prefs.edit().putString("backend_$modelName", backend).apply()
  }

  /** Backends ("gpu/gpu", "cpu/gpu" or "cpu/cpu": main/vision) that last started photo and voice. */
  fun mediaBackendFor(modelName: String): String = prefs.getString("media_backend_$modelName", "") ?: ""

  fun saveMediaBackend(modelName: String, backend: String) {
    prefs.edit().putString("media_backend_$modelName", backend).apply()
  }

  /** Model and backend of the latest start attempt, for error reports (no chat text). */
  fun saveLastRun(model: String, backend: String) {
    prefs.edit().putString("last_model", model).putString("last_backend", backend).apply()
  }

  var onboarded: Boolean
    get() = prefs.getBoolean("onboarded", false)
    set(v) = prefs.edit().putBoolean("onboarded", v).apply()

  var name: String
    get() = prefs.getString("name", "") ?: ""
    set(v) = prefs.edit().putString("name", v).apply()

  var study: String
    get() = prefs.getString("study", "") ?: ""
    set(v) = prefs.edit().putString("study", v).apply()

  /** Language code, or empty when the user hasn't picked one yet. */
  var lang: String
    get() = prefs.getString("lang", "") ?: ""
    set(v) = prefs.edit().putString("lang", v).apply()

  var mode: String
    get() = prefs.getString("mode", ElricMode.STUDY.id) ?: ElricMode.STUDY.id
    set(v) = prefs.edit().putString("mode", v).apply()

  /** Short answers are the default. */
  var short: Boolean
    get() = prefs.getBoolean("short", true)
    set(v) = prefs.edit().putBoolean("short", v).apply()

  /** Name of the model the user picked to answer with, or empty for the best downloaded one. */
  var activeModel: String
    get() = prefs.getString("active_model", "") ?: ""
    set(v) = prefs.edit().putString("active_model", v).apply()

  /** The user confirmed they are 18 or older (needed for online answers). False until they do. */
  var age18: Boolean
    get() = prefs.getBoolean("age18", false)
    set(v) = prefs.edit().putBoolean("age18", v).apply()

  /**
   * Online answers: off by default, and only ever on after the user confirmed they are 18 or older
   * (older installs that never confirmed are treated as off).
   */
  var onlineOn: Boolean
    get() = age18 && prefs.getBoolean("online_on", false)
    set(v) = prefs.edit().putBoolean("online_on", v && age18).apply()

  /**
   * Offline mode: answer on the phone with the downloaded model when online can't. New installs
   * start with it off (online-first); installs onboarded before 0.4.0 keep it on.
   */
  var offlineOn: Boolean
    get() = if (prefs.contains("offline_on")) prefs.getBoolean("offline_on", false) else onboarded
    set(v) = prefs.edit().putBoolean("offline_on", v).apply()

  /** Memory is on by default. */
  var memoryOn: Boolean
    get() = prefs.getBoolean("memory_on", true)
    set(v) = prefs.edit().putBoolean("memory_on", v).apply()

  /** Memory lines, newest first. Kept only on this phone. */
  fun loadMemories(): List<ElricMemory> {
    return try {
      val json = prefs.getString("memories", null) ?: return emptyList()
      val type = object : TypeToken<List<ElricMemory>>() {}.type
      val list: List<ElricMemory>? = gson.fromJson(json, type)
      list
        .orEmpty()
        .filter { m ->
          val t: Any? = m?.text
          t != null && m.text.isNotBlank()
        }
        .map { m -> m.copy(kind = (m.kind as String?) ?: "") }
        .sortedByDescending { it.at }
        .take(ELRIC_MAX_MEMORIES)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to read memories", e)
      emptyList()
    }
  }

  fun saveMemories(list: List<ElricMemory>) {
    prefs.edit().putString("memories", gson.toJson(list.take(ELRIC_MAX_MEMORIES))).apply()
  }

  fun loadChats(): List<ElricChat> {
    return try {
      if (!chatsFile.exists()) return emptyList()
      val type = object : TypeToken<List<ElricChat>>() {}.type
      val list: List<ElricChat>? = gson.fromJson(chatsFile.readText(), type)
      // Gson can leave fields null for damaged entries; drop those.
      list
        .orEmpty()
        .filter { isValidChat(it) }
        .map { c ->
          c.copy(
            title = (c.title as String?) ?: "",
            mode = (c.mode as String?) ?: ElricMode.STUDY.id,
            turns = c.turns.filter { isValidTurn(it) },
          )
        }
        .sortedByDescending { it.at }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to read chats", e)
      emptyList()
    }
  }

  // Gson fills Kotlin non-null fields with null when they are missing from the file.
  private fun isValidChat(c: ElricChat?): Boolean {
    val any: Any? = c?.id
    val turns: Any? = c?.turns
    return any != null && turns != null
  }

  private fun isValidTurn(t: ElricTurn?): Boolean {
    val text: Any? = t?.text
    val role: Any? = t?.role
    return text != null && role != null
  }

  fun saveChats(chats: List<ElricChat>) {
    try {
      val list = chats.sortedByDescending { it.at }.take(ELRIC_MAX_CHATS)
      val tmp = File(chatsFile.parentFile, "$CHATS_FILE.tmp")
      tmp.writeText(gson.toJson(list))
      if (!tmp.renameTo(chatsFile)) {
        chatsFile.writeText(gson.toJson(list))
        tmp.delete()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to save chats", e)
    }
  }
}
