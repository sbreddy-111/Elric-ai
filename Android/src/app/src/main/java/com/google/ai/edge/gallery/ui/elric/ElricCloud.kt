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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import com.google.ai.edge.gallery.BuildConfig
import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "ElricCloud"

/** Elric AI backend (Supabase). The publishable key is public by design; tables are locked by RLS. */
private const val SUPABASE_URL = "https://hqsqpiwmozgsxiizhaml.supabase.co"
private const val SUPABASE_KEY = "sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT"

private const val PREFS = "elric_prefs"
private const val FACTS_FILE = "elric_facts.json"
private const val CRASH_DIR = "elric_crash_reports"
private const val FACTS_SYNC_MS = 24L * 60 * 60 * 1000
private const val MAX_FACTS = 5
private const val MAX_FACTS_CHARS = 500

/** One fact from the central facts list. */
data class ElricFact(val id: Long = 0, val topic: String? = null, val fact: String = "", val lang: String? = null)

/** Small HTTP helpers for the Elric backend. Nothing is ever sent without the user's choice. */
object ElricCloud {
  private val gson = Gson()

  fun online(context: Context): Boolean =
    try {
      val cm = context.getSystemService(ConnectivityManager::class.java)
      val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
      caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    } catch (e: Exception) {
      false
    }

  private fun open(path: String, method: String): HttpURLConnection {
    val c = URL("$SUPABASE_URL/rest/v1/$path").openConnection() as HttpURLConnection
    c.requestMethod = method
    c.connectTimeout = 10_000
    c.readTimeout = 15_000
    c.setRequestProperty("apikey", SUPABASE_KEY)
    c.setRequestProperty("Accept", "application/json")
    return c
  }

  /** Active facts, or null when they could not be fetched. */
  suspend fun fetchFacts(): List<ElricFact>? =
    withContext(Dispatchers.IO) {
      try {
        val c = open("ai_facts?select=id,topic,fact,lang&active=eq.true&order=id", "GET")
        try {
          if (c.responseCode !in 200..299) return@withContext null
          val body = c.inputStream.bufferedReader().use { it.readText() }
          val type = object : TypeToken<List<ElricFact>>() {}.type
          val list: List<ElricFact>? = gson.fromJson(body, type)
          list.orEmpty().filter { f ->
            val t: Any? = f?.fact
            t != null && f.fact.isNotBlank()
          }
        } finally {
          c.disconnect()
        }
      } catch (e: Exception) {
        Log.w(TAG, "facts fetch failed: ${e.javaClass.simpleName}")
        null
      }
    }

  /** Sends one row to the feedback table. Returns true when it was stored. */
  suspend fun sendFeedback(row: Map<String, String?>): Boolean =
    withContext(Dispatchers.IO) {
      try {
        val c = open("ai_feedback", "POST")
        try {
          c.doOutput = true
          c.setRequestProperty("Content-Type", "application/json")
          c.setRequestProperty("Prefer", "return=minimal")
          val clean = row.filterValues { it != null }.mapValues { (k, v) ->
            val max = if (k in setOf("question", "answer", "note")) 4000 else 120
            v!!.take(max)
          }
          c.outputStream.use { it.write(gson.toJson(clean).toByteArray(Charsets.UTF_8)) }
          c.responseCode in 200..299
        } finally {
          c.disconnect()
        }
      } catch (e: Exception) {
        Log.w(TAG, "feedback send failed: ${e.javaClass.simpleName}")
        false
      }
    }

  /** App and device details sent with feedback and error reports (never chat text). */
  fun baseRow(kind: String, backend: String?, model: String?, mode: String?): Map<String, String?> =
    mapOf(
      "kind" to kind,
      "app_version" to BuildConfig.VERSION_NAME,
      "platform" to "android ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT})",
      "device" to "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
      "backend" to backend,
      "model" to model,
      "mode" to mode,
    )
}

/** The central facts list, cached on the phone so answers keep using it offline. */
class ElricFacts(private val context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val file = File(context.filesDir, FACTS_FILE)
  private val gson = Gson()

  @Volatile var facts: List<ElricFact> = load()
    private set

  private fun load(): List<ElricFact> =
    try {
      if (!file.exists()) emptyList()
      else {
        val type = object : TypeToken<List<ElricFact>>() {}.type
        val list: List<ElricFact>? = gson.fromJson(file.readText(), type)
        list.orEmpty().filter { f ->
          val t: Any? = f?.fact
          t != null && f.fact.isNotBlank()
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "facts cache unreadable", e)
      emptyList()
    }

  /** Downloads the facts when online, at most once a day. Returns true when the cache changed. */
  suspend fun syncIfDue(): Boolean {
    val last = prefs.getLong("facts_synced_at", 0L)
    val now = System.currentTimeMillis()
    if (facts.isNotEmpty() && now - last in 0 until FACTS_SYNC_MS) return false
    if (!ElricCloud.online(context)) return false
    val fresh = ElricCloud.fetchFacts() ?: return false
    prefs.edit().putLong("facts_synced_at", now).apply()
    if (fresh.isEmpty() && facts.isEmpty()) return false
    withContext(Dispatchers.IO) {
      try {
        val tmp = File(file.parentFile, "$FACTS_FILE.tmp")
        tmp.writeText(gson.toJson(fresh))
        if (!tmp.renameTo(file)) {
          file.writeText(gson.toJson(fresh))
          tmp.delete()
        }
      } catch (e: Exception) {
        Log.w(TAG, "facts cache write failed", e)
      }
    }
    val changed = fresh != facts
    facts = fresh
    return changed
  }

  /** Up to [MAX_FACTS] facts that share words with [question], within [MAX_FACTS_CHARS] chars. */
  fun relevant(question: String): List<String> = pick(facts, question)

  companion object {
    private val STOP =
      setOf(
        "the", "and", "for", "are", "was", "who", "what", "when", "where", "which", "how", "why",
        "you", "your", "with", "from", "that", "this", "about", "tell", "does", "did", "can",
        "his", "her", "its", "was", "were", "has", "have", "had", "is", "of", "in", "on", "a", "an",
        "to", "me", "my", "i", "do", "be", "by", "it", "at", "or", "as", "kya", "hai", "kaun",
        "ke", "ki", "ka", "ko", "se", "में", "है", "का", "की", "के", "को", "से", "क्या", "कौन", "और",
      )

    /** Hindi spellings that should match English fact words. */
    private val ALIASES =
      mapOf(
        "एलरिक" to "elric",
        "एल्रिक" to "elric",
        "रामानुजन" to "ramanujan",
        "टाइटन" to "titan",
        "घड़ी" to "watches",
        "घड़ियाँ" to "watches",
        "ब्रह्मा" to "brahma",
        "संस्थापक" to "founded",
        "founder" to "founded",
        "founders" to "founded",
        "watch" to "watches",
      )

    private fun words(s: String): Set<String> =
      s.lowercase(Locale.ROOT)
        .split(Regex("[^\\p{L}\\p{M}\\p{N}]+"))
        .filter { it.length >= 3 || it.any { ch -> ch.code > 0x900 } }
        .filter { it !in STOP }
        .map { ALIASES[it] ?: it }
        .toSet()

    fun pick(facts: List<ElricFact>, question: String): List<String> {
      val q = words(question)
      if (q.isEmpty()) return emptyList()
      val scored =
        facts
          .map { f ->
            val w = words(f.fact + " " + (f.topic ?: ""))
            val score = q.count { qw -> w.any { it == qw || (qw.length >= 5 && it.startsWith(qw.take(5))) } }
            f to score
          }
          .filter { it.second > 0 }
          .sortedWith(compareByDescending<Pair<ElricFact, Int>> { it.second }.thenBy { it.first.id })
      val out = mutableListOf<String>()
      var chars = 0
      for ((f, _) in scored) {
        if (out.size >= MAX_FACTS) break
        val t = f.fact.trim()
        if (chars + t.length > MAX_FACTS_CHARS) continue
        out.add(t)
        chars += t.length + 1
      }
      return out
    }
  }
}

/** Opt-in error reports: crashes are saved to disk and sent on the next launch; never chat text. */
object ElricReports {
  private const val KEY_ON = "reports_on"
  private const val KEY_ASKED = "reports_asked"

  fun isOn(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, false)

  fun setOn(context: Context, on: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(KEY_ON, on).putBoolean(KEY_ASKED, true).apply()
    if (!on) crashDir(context).listFiles()?.forEach { it.delete() }
  }

  fun asked(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ASKED, false)

  fun markAsked(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ASKED, true).apply()
  }

  private fun crashDir(context: Context) = File(context.filesDir, CRASH_DIR)

  /** Installs the crash handler. Saves a report only when error reports are on. */
  fun install(context: Context) {
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        if (isOn(app)) {
          val dir = crashDir(app)
          dir.mkdirs()
          val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          val row =
            ElricCloud.baseRow(
              kind = "crash",
              backend = prefs.getString("last_backend", null),
              model = prefs.getString("last_model", null),
              mode = null,
            ) + ("note" to describe(error, thread.name))
          File(dir, "crash_${System.currentTimeMillis()}.json").writeText(Gson().toJson(row))
        }
      } catch (_: Throwable) {}
      previous?.uncaughtException(thread, error)
    }
  }

  /** Exception types and stack frames only; exception messages are left out (they could hold text). */
  private fun describe(error: Throwable, thread: String): String {
    val sb = StringBuilder("thread=$thread\n")
    var e: Throwable? = error
    var depth = 0
    while (e != null && depth < 4) {
      if (depth > 0) sb.append("caused by: ")
      sb.append(e.javaClass.name).append('\n')
      for (f in e.stackTrace.take(12)) sb.append("  at ").append(f.toString()).append('\n')
      e = e.cause
      depth++
    }
    return sb.toString().take(3900)
  }

  /** Sends saved crash reports when online and reports are on; deletes each one that was stored. */
  suspend fun sendPending(context: Context) {
    val dir = crashDir(context)
    val files = withContext(Dispatchers.IO) { dir.listFiles()?.toList().orEmpty() }
    if (files.isEmpty()) return
    if (!isOn(context)) {
      withContext(Dispatchers.IO) { files.forEach { it.delete() } }
      return
    }
    if (!ElricCloud.online(context)) return
    for (f in files.sortedBy { it.name }.take(5)) {
      val row: Map<String, String?>? =
        withContext(Dispatchers.IO) {
          try {
            val obj = JsonParser.parseString(f.readText()).asJsonObject
            obj.entrySet().associate { (k, v) -> k to (if (v.isJsonNull) null else v.asString) }
          } catch (e: Exception) {
            null
          }
        }
      if (row == null || ElricCloud.sendFeedback(row)) withContext(Dispatchers.IO) { f.delete() }
    }
  }

  /** Sends a 'stuck' report (model load timed out or failed) when reports are on. */
  suspend fun sendStuck(context: Context, backend: String?, model: String?, mode: String?, reason: String) {
    if (!isOn(context) || !ElricCloud.online(context)) return
    // Only a short, generic reason: timeouts and engine errors, never chat text.
    ElricCloud.sendFeedback(ElricCloud.baseRow("stuck", backend, model, mode) + ("note" to reason.take(300)))
  }
}
