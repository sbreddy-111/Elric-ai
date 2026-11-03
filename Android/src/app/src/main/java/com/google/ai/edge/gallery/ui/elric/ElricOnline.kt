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
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.google.gson.JsonParser
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val TAG = "ElricOnline"

private const val CHAT_URL = "https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-chat"
/** Public by design (the same publishable key the app already uses for facts and feedback). */
private const val CHAT_KEY = "sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT"

/** Largest photo side sent online, and the JPEG quality. */
private const val ONLINE_PHOTO_SIDE = 1024
private const val ONLINE_PHOTO_MAX_BYTES = 900_000

/** How an online answer ended. */
sealed interface ElricOnlineEnd {
  /** The whole answer arrived. */
  data object Done : ElricOnlineEnd

  /** The user tapped Stop. */
  data object Stopped : ElricOnlineEnd

  /** The server or the provider is at its limit; try again after [retryAfterSec]. */
  data class Limit(val retryAfterSec: Int, val scope: String) : ElricOnlineEnd

  /** No first word in time, the connection dropped, or the server failed. */
  data class Failed(val reason: String) : ElricOnlineEnd
}

/**
 * One streamed online answer. [run] blocks (on the IO dispatcher) until the answer ends; [cancel]
 * stops it from any thread. No chat text is logged.
 */
class ElricOnlineCall {
  @Volatile private var conn: HttpURLConnection? = null
  @Volatile private var cancelled = false

  fun cancel() {
    cancelled = true
    disconnect()
  }

  private fun disconnect() {
    try {
      conn?.disconnect()
    } catch (_: Exception) {}
  }

  /**
   * Sends [body] and streams the answer to [onText]. Gives up when there is no first word within
   * [firstTokenMs] of starting, or no data for [stallMs] after that.
   */
  suspend fun run(body: String, firstTokenMs: Long, stallMs: Long, onText: (String) -> Unit): ElricOnlineEnd =
    withContext(Dispatchers.IO) {
      val start = SystemClock.elapsedRealtime()
      val lastData = AtomicLong(start)
      val gotFirst = AtomicBoolean(false)
      val watchdogReason = AtomicReference<String?>(null)
      val watchdog =
        Thread(
          {
            try {
              while (!cancelled) {
                Thread.sleep(200)
                val now = SystemClock.elapsedRealtime()
                if (!gotFirst.get() && now - start > firstTokenMs) {
                  watchdogReason.set("no first word in $firstTokenMs ms")
                  disconnect()
                  break
                }
                if (gotFirst.get() && now - lastData.get() > stallMs) {
                  watchdogReason.set("stalled")
                  disconnect()
                  break
                }
              }
            } catch (_: InterruptedException) {}
          },
          "elric-online-watchdog",
        )
      watchdog.isDaemon = true
      watchdog.start()
      try {
        if (cancelled) return@withContext ElricOnlineEnd.Stopped
        val c = URL(CHAT_URL).openConnection() as HttpURLConnection
        conn = c
        c.requestMethod = "POST"
        c.connectTimeout = firstTokenMs.toInt().coerceAtLeast(1000)
        c.readTimeout = (firstTokenMs + stallMs).toInt()
        c.doOutput = true
        c.setRequestProperty("apikey", CHAT_KEY)
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("Accept", "text/event-stream")
        val bytes = body.toByteArray(Charsets.UTF_8)
        c.setFixedLengthStreamingMode(bytes.size)
        c.outputStream.use { it.write(bytes) }
        val code = c.responseCode
        if (code == 429) {
          val err = try { c.errorStream?.bufferedReader()?.use { it.readText() } } catch (_: Exception) { null }
          var retry = 600
          var scope = "provider"
          try {
            val o = JsonParser.parseString(err ?: "{}").asJsonObject
            if (o.has("retry_after")) retry = o.get("retry_after").asInt
            if (o.has("scope")) scope = o.get("scope").asString
          } catch (_: Exception) {}
          return@withContext ElricOnlineEnd.Limit(retry, scope)
        }
        if (code !in 200..299) return@withContext ElricOnlineEnd.Failed("http $code")
        val reader = InputStreamReader(c.inputStream, Charsets.UTF_8).buffered()
        var end: ElricOnlineEnd? = null
        while (end == null) {
          val line = reader.readLine() ?: break
          lastData.set(SystemClock.elapsedRealtime())
          if (!line.startsWith("data:")) continue
          val o =
            try {
              JsonParser.parseString(line.substring(5).trim()).asJsonObject
            } catch (_: Exception) {
              continue
            }
          when {
            o.has("t") -> {
              val t = o.get("t").asString
              if (t.isNotEmpty()) {
                if (t.isNotBlank()) gotFirst.set(true)
                onText(t)
              }
            }
            o.has("done") -> end = ElricOnlineEnd.Done
            o.has("error") -> {
              val e = o.get("error").asString
              end = if (e == "limit") ElricOnlineEnd.Limit(600, "provider") else ElricOnlineEnd.Failed(e)
            }
          }
        }
        when {
          cancelled -> ElricOnlineEnd.Stopped
          end != null -> end
          else -> ElricOnlineEnd.Failed(watchdogReason.get() ?: "connection closed")
        }
      } catch (e: Exception) {
        if (cancelled) ElricOnlineEnd.Stopped
        else ElricOnlineEnd.Failed(watchdogReason.get() ?: e.javaClass.simpleName)
      } finally {
        watchdog.interrupt()
        disconnect()
        conn = null
      }
    }
}

object ElricOnline {
  /** A random id for this install, used only for the server's rate limit (stored there hashed). */
  fun deviceId(context: Context): String {
    val prefs = context.getSharedPreferences("elric_prefs", Context.MODE_PRIVATE)
    prefs.getString("device_id", null)?.let { return it }
    val id = UUID.randomUUID().toString()
    prefs.edit().putString("device_id", id).apply()
    return id
  }

  /** A photo as base64 JPEG for the online request, or null when it can't be read. */
  fun photoBase64(path: String): String? {
    val bmp = ElricImages.read(path, ONLINE_PHOTO_SIDE) ?: return null
    return try {
      var quality = 82
      var out: ByteArray
      do {
        val bos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, bos)
        out = bos.toByteArray()
        quality -= 15
      } while (out.size > ONLINE_PHOTO_MAX_BYTES && quality >= 40)
      Base64.encodeToString(out, Base64.NO_WRAP)
    } catch (t: Throwable) {
      Log.w(TAG, "photo encode failed: ${t.javaClass.simpleName}")
      null
    }
  }
}
