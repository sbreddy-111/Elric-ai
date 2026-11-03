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

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.google.ai.edge.gallery.common.calculatePeakAmplitude
import com.google.ai.edge.gallery.common.decodeSampledBitmapFromUri
import com.google.ai.edge.gallery.common.openSafeInputStream
import com.google.ai.edge.gallery.common.rotateBitmap
import com.google.ai.edge.gallery.data.MAX_AUDIO_CLIP_DURATION_SEC
import com.google.ai.edge.gallery.data.SAMPLE_RATE
import com.google.ai.edge.gallery.ui.common.chat.ChatMessageAudioClip
import com.google.ai.edge.gallery.ui.common.chat.ChatSide
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

private const val TAG = "ElricMedia"

/** Longest side of a photo given to the model (same as the upstream Ask Image flow). */
private const val PHOTO_MAX_SIDE = 1024

/** Longest recording, in ms (30 s, as in upstream Audio Scribe). */
const val ELRIC_MAX_VOICE_MS = MAX_AUDIO_CLIP_DURATION_SEC * 1000L

/**
 * Records the microphone as 16 kHz mono 16-bit PCM, at most 30 s: the format the on-device model
 * takes (same as the upstream Audio Scribe recorder). Nothing leaves the phone.
 */
class ElricRecorder {
  private val lock = Any()
  private val buffer = ByteArrayOutputStream()
  @Volatile private var recorder: AudioRecord? = null
  @Volatile private var peak = 0

  /** Loudest sample of the last recording (0..32767). */
  val lastPeak: Int
    get() = peak

  /**
   * Starts recording on its own thread. [onTick] gets the elapsed ms; [onMax] is called once when
   * the 30 s limit is reached. Returns false when the microphone can't be opened. The caller checks
   * the RECORD_AUDIO permission first.
   */
  @SuppressLint("MissingPermission")
  fun start(onTick: (Long) -> Unit, onMax: () -> Unit, onLevel: (Int) -> Unit = {}): Boolean {
    release()
    val minBuf =
      AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBuf <= 0) return false
    val r =
      try {
        AudioRecord(
          MediaRecorder.AudioSource.MIC,
          SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          minBuf * 2,
        )
      } catch (e: Exception) {
        Log.w(TAG, "AudioRecord failed", e)
        return false
      }
    if (r.state != AudioRecord.STATE_INITIALIZED) {
      r.release()
      return false
    }
    synchronized(lock) { buffer.reset() }
    peak = 0
    try {
      r.startRecording()
    } catch (e: Exception) {
      Log.w(TAG, "startRecording failed", e)
      r.release()
      return false
    }
    if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      r.release()
      return false
    }
    recorder = r
    Thread(
        {
          val buf = ByteArray(minBuf)
          val t0 = SystemClock.elapsedRealtime()
          while (recorder === r) {
            val n =
              try {
                r.read(buf, 0, buf.size)
              } catch (e: Exception) {
                -1
              }
            if (n < 0) break
            if (n > 0 && recorder === r) {
              val p = calculatePeakAmplitude(buffer = buf, bytesRead = n)
              if (p > peak) peak = p
              onLevel(p)
              synchronized(lock) { buffer.write(buf, 0, n) }
            }
            val elapsed = SystemClock.elapsedRealtime() - t0
            if (recorder !== r) break
            onTick(elapsed)
            if (elapsed >= ELRIC_MAX_VOICE_MS) {
              onMax()
              break
            }
          }
        },
        "elric-mic",
      )
      .start()
    return true
  }

  /** Stops and returns the recorded PCM. */
  fun stop(): ByteArray {
    release()
    return synchronized(lock) { buffer.toByteArray().also { buffer.reset() } }
  }

  /** Stops and throws the recording away. */
  fun cancel() {
    release()
    synchronized(lock) { buffer.reset() }
  }

  private fun release() {
    val r = recorder ?: return
    recorder = null
    try {
      if (r.recordingState == AudioRecord.RECORDSTATE_RECORDING) r.stop()
    } catch (e: Exception) {
      Log.w(TAG, "stop failed", e)
    }
    try {
      r.release()
    } catch (e: Exception) {
      Log.w(TAG, "release failed", e)
    }
  }
}

/** Wraps recorded PCM in a WAV header, as upstream Audio Scribe does before giving it to the model. */
fun elricWav(pcm: ByteArray): ByteArray =
  ChatMessageAudioClip(audioData = pcm, sampleRate = SAMPLE_RATE, side = ChatSide.USER)
    .genByteArrayForWav()

/** Length of recorded PCM in ms. */
fun elricPcmMs(pcm: ByteArray): Long = pcm.size * 1000L / (SAMPLE_RATE * 2L)

/** Photos shared in chats, kept only in the app's private storage on this phone. */
object ElricImages {
  private fun dir(context: Context): File = File(context.filesDir, "elric_images").apply { mkdirs() }

  /** Where the camera writes a new photo (shared with the camera app through the FileProvider). */
  fun cameraUri(context: Context): Uri {
    val d = File(context.cacheDir, "images").apply { mkdirs() }
    val f = File(d, "elric_camera.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.provider", f)
  }

  /**
   * Opens a picked or captured photo upright and at most 1024 px on its longest side, then saves a
   * private copy. Returns the copy's path, or null when it can't be read. Call off the main thread.
   */
  fun importPhoto(context: Context, uri: Uri): String? {
    return try {
      val orientation =
        openSafeInputStream(context, uri)?.use { s ->
          ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
      val decoded =
        decodeSampledBitmapFromUri(context, uri, PHOTO_MAX_SIDE, PHOTO_MAX_SIDE) ?: return null
      val upright = rotateBitmap(bitmap = decoded, orientation = orientation)
      val scaled = scaleDown(upright, PHOTO_MAX_SIDE)
      val f = File(dir(context), "p" + System.currentTimeMillis().toString(36) + ".jpg")
      FileOutputStream(f).use { scaled.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      f.absolutePath
    } catch (t: Throwable) {
      Log.w(TAG, "importPhoto failed", t)
      null
    }
  }

  /** Reads a saved photo, at most [maxSide] px on its longest side. */
  fun read(path: String, maxSide: Int = PHOTO_MAX_SIDE): Bitmap? {
    return try {
      val f = File(path)
      if (!f.exists()) return null
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= maxSide || bounds.outHeight / (sample * 2) >= maxSide) {
        sample *= 2
      }
      val bmp =
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
          ?: return null
      scaleDown(bmp, maxSide)
    } catch (t: Throwable) {
      Log.w(TAG, "read failed", t)
      null
    }
  }

  /** Deletes saved photos (only ones inside the app's photo folder). */
  fun delete(context: Context, paths: Collection<String?>) {
    val root = dir(context).absolutePath
    for (p in paths) {
      if (p == null || !p.startsWith(root)) continue
      try {
        File(p).delete()
      } catch (e: Exception) {
        Log.w(TAG, "delete failed", e)
      }
    }
  }

  private fun scaleDown(bmp: Bitmap, maxSide: Int): Bitmap {
    val longest = maxOf(bmp.width, bmp.height)
    if (longest <= maxSide || longest <= 0) return bmp
    val s = maxSide.toFloat() / longest
    return Bitmap.createScaledBitmap(
      bmp,
      (bmp.width * s).toInt().coerceAtLeast(1),
      (bmp.height * s).toInt().coerceAtLeast(1),
      true,
    )
  }
}

/** True when [text] is mostly Hindi (Devanagari) rather than English. */
fun elricIsHindi(text: String): Boolean {
  var dev = 0
  var latin = 0
  for (c in text) {
    if (c in '\u0900'..'\u097F') dev++ else if (c in 'a'..'z' || c in 'A'..'Z') latin++
  }
  return dev > latin
}

/** Turns an answer into plain sentences for reading aloud (no markdown symbols). */
fun elricSpeakable(text: String): String =
  displayAnswer(text)
    .replace(Regex("```[\\s\\S]*?```"), " ")
    .replace(Regex("[*#`|_>~]"), " ")
    .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
    .replace(Regex("\\s+"), " ")
    .trim()

/**
 * Reads answers aloud with the phone's own text-to-speech, offline when the phone has the voice
 * data, in Hindi or English to match each sentence. It picks the best installed offline voice for
 * each language. Text can be added sentence by sentence while the answer is still being written
 * ([begin], [add], [end]), so speaking starts after the first sentence. Callbacks run on the main
 * thread.
 */
class ElricSpeaker(context: Context) {
  private val app = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private var failed = false
  private var session = 0
  private var open = false
  private var allOk = true
  private var outstanding = 0
  private var onAllDone: ((Boolean) -> Unit)? = null
  private val waiting = mutableListOf<String>()
  private val ids = mutableSetOf<String>()
  private var seq = 0
  private var currentLang = ""
  private val bestVoice = mutableMapOf<String, android.speech.tts.Voice?>()

  /** Reads [text] in one go; [onDone] gets false when it couldn't be read aloud. */
  fun speak(text: String, onDone: (Boolean) -> Unit) {
    begin(onDone)
    add(text)
    end()
  }

  /** Starts a new answer; stops anything still being read. */
  fun begin(onDone: (Boolean) -> Unit) {
    stop()
    open = true
    allOk = true
    onAllDone = onDone
    if (tts == null && !failed) init()
  }

  /** Adds the next part of the answer. */
  fun add(text: String) {
    if (!open) return
    val plain = elricSpeakable(text)
    if (plain.isEmpty()) return
    if (failed) {
      allOk = false
      return
    }
    val t = tts
    if (t == null || !ready) {
      waiting.add(plain)
      return
    }
    say(t, plain)
  }

  /** No more text for this answer; the callback runs once everything has been read. */
  fun end() {
    if (!open) return
    open = false
    checkDone()
  }

  /** Stops reading. The callback of the stopped answer is not called. */
  fun stop() {
    session++
    open = false
    onAllDone = null
    waiting.clear()
    ids.clear()
    outstanding = 0
    try {
      tts?.stop()
    } catch (e: Exception) {
      Log.w(TAG, "tts stop failed", e)
    }
  }

  fun shutdown() {
    stop()
    try {
      tts?.shutdown()
    } catch (e: Exception) {}
    tts = null
    ready = false
  }

  private fun checkDone() {
    if (open || outstanding > 0 || waiting.isNotEmpty() && !failed) return
    val cb = onAllDone ?: return
    onAllDone = null
    val ok = allOk && !failed
    main.post { cb(ok) }
  }

  private fun init() {
    tts =
      TextToSpeech(app) { status ->
        main.post {
          if (status == TextToSpeech.SUCCESS) {
            ready = true
            tts?.setOnUtteranceProgressListener(
              object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}

                override fun onDone(utteranceId: String?) {
                  main.post { finished(utteranceId, true) }
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                  main.post { finished(utteranceId, false) }
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                  main.post { finished(utteranceId, false) }
                }
              }
            )
            val t = tts
            val list = waiting.toList()
            waiting.clear()
            if (t != null) for (w in list) say(t, w)
            checkDone()
          } else {
            failed = true
            tts = null
            waiting.clear()
            allOk = false
            checkDone()
          }
        }
      }
  }

  /** The best installed voice for [lang] that works offline, preferring Indian voices. */
  private fun voiceFor(t: TextToSpeech, lang: String): android.speech.tts.Voice? {
    if (bestVoice.containsKey(lang)) return bestVoice[lang]
    val v =
      try {
        t.voices
          ?.filter { v ->
            v.locale.language == lang &&
              !v.isNetworkConnectionRequired &&
              !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
          }
          ?.sortedWith(
            compareByDescending<android.speech.tts.Voice> { it.locale.country == "IN" }
              .thenByDescending { it.quality }
              .thenBy { it.latency }
          )
          ?.firstOrNull()
      } catch (e: Exception) {
        null
      }
    bestVoice[lang] = v
    return v
  }

  private fun say(t: TextToSpeech, plain: String) {
    val lang = if (elricIsHindi(plain)) "hi" else "en"
    if (lang != currentLang) {
      currentLang = lang
      try {
        val v = voiceFor(t, lang)
        if (v != null) {
          t.voice = v
        } else {
          val r = t.setLanguage(if (lang == "hi") Locale("hi", "IN") else Locale("en", "IN"))
          if ((r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) && lang == "en") {
            t.setLanguage(Locale.US)
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "tts voice failed", e)
      }
    }
    val max =
      try {
        TextToSpeech.getMaxSpeechInputLength()
      } catch (e: Exception) {
        3900
      }
    val id = "elric-$session-" + (++seq)
    ids.add(id)
    outstanding++
    val res =
      try {
        t.speak(plain.take(max - 1), TextToSpeech.QUEUE_ADD, null, id)
      } catch (e: Exception) {
        TextToSpeech.ERROR
      }
    if (res != TextToSpeech.SUCCESS) finished(id, false)
  }

  private fun finished(id: String?, ok: Boolean) {
    if (id == null || !ids.remove(id)) return
    outstanding = (outstanding - 1).coerceAtLeast(0)
    if (!ok) allOk = false
    checkDone()
  }
}
