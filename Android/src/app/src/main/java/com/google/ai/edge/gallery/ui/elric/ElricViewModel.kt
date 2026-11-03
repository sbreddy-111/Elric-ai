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
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.ai.edge.gallery.data.Accelerator
import com.google.ai.edge.gallery.data.BuiltInTaskId
import com.google.ai.edge.gallery.data.ConfigKeys
import com.google.ai.edge.gallery.data.DEFAULT_MAX_TOKEN
import com.google.ai.edge.gallery.data.Model
import com.google.ai.edge.gallery.runtime.EXTRA_CONTEXT_MAX_OUTPUT_TOKENS
import com.google.ai.edge.gallery.ui.llmchat.LlmChatModelHelper
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Message
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import kotlin.coroutines.resume
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "ElricViewModel"

/** Cap on generated tokens for Short answers (a safety net; the system prompt asks for <80 words). */
private const val SHORT_MAX_OUTPUT_TOKENS = 512

/** Tokens kept free in the context window for the answer. */
private const val ANSWER_RESERVE_TOKENS = 1100

/** Time the GPU gets to start before Elric falls back to the CPU. */
private const val GPU_INIT_TIMEOUT_MS = 45_000L

/** Time the whole load gets before it ends in a clear failure with Retry. */
private const val LOAD_TIMEOUT_MS = 180_000L

/** The CPU always gets at least this long, even after a slow GPU attempt. */
private const val MIN_CPU_TIMEOUT_MS = 90_000L

/** Context size limits: small enough for the CPU and for phones with little memory. */
private const val MIN_TOKENS = 1024
private const val MAX_TOKENS_CAP = 4096
private const val CPU_LOW_RAM_MAX_TOKENS = 2048

/** Rough characters per token, kept low so Hindi text is not under-counted. */
private const val CHARS_PER_TOKEN = 2.5

/** Returned by [ElricViewModel.ensureLoaded] when photo and voice can't start on this phone. */
private const val MEDIA_UNSUPPORTED = "media_unsupported"

/** Time a photo/voice start that uses the GPU gets before the next option is tried. */
private const val MEDIA_GPU_TIMEOUT_MS = 60_000L

/** Tokens a photo takes in the context window (kept free when trimming history). */
private const val PHOTO_TOKENS = 300

/** Cap on generated tokens when turning speech into text. */
private const val TRANSCRIBE_MAX_TOKENS = 300

/** Longest a transcription may take before it is stopped. */
private const val TRANSCRIBE_TIMEOUT_MS = 120_000L

/** Asks the model for the spoken words only (same idea as upstream Audio Scribe). */
private const val TRANSCRIBE_PROMPT =
  "Transcribe this audio exactly as spoken. If the speech is in Hindi, write it in Hindi " +
    "(Devanagari script). If it is in English, write it in English. Output only the spoken " +
    "words, with no notes, labels or translation."

/** Recordings shorter than this, or quieter than [VOICE_MIN_PEAK], are treated as no speech. */
private const val VOICE_MIN_MS = 600L
private const val VOICE_MIN_PEAK = 600

/** What the Talk view shows. */
enum class ElricTalkState {
  OFF,
  LISTENING,
  /** Starting the model with voice support. */
  PREPARING,
  /** Turning speech into text, then answering. */
  THINKING,
  SPEAKING,
  /** Waiting for a tap (nothing was heard, or something went wrong). */
  PAUSED,
  MUTED,
}

/** Finds the end of what the user says from microphone levels (simple, on-device, no model). */
private class ElricTalkVad(private val start: Long) {
  private var ambientSum = 0L
  private var ambientN = 0
  private var threshold = 1200
  private var speechStart = 0L
  private var lastLoud = 0L
  var heard = false
    private set

  /** Returns true when the user has spoken and then been quiet for a moment. */
  fun feed(level: Int, now: Long): Boolean {
    if (now - start < 300) {
      ambientSum += level
      ambientN++
      threshold = maxOf(1200, (ambientSum / ambientN * 2.5).toInt())
      return false
    }
    if (level >= threshold) {
      if (speechStart == 0L) speechStart = now
      lastLoud = now
      if (now - speechStart > 300) heard = true
    } else if (!heard && speechStart != 0L && now - lastLoud > 600) {
      // A short noise, not speech.
      speechStart = 0L
    }
    return heard && now - lastLoud > 1300
  }

  fun silentTooLong(now: Long): Boolean = !heard && now - start > 12_000
}

/** What the voice control in the composer shows. */
enum class ElricVoiceState {
  IDLE,
  RECORDING,
  /** Starting the model with voice support (first use in a session). */
  PREPARING,
  /** Turning the recording into text. */
  TRANSCRIBING,
}

sealed interface ElricEngineState {
  data object Idle : ElricEngineState

  data object Loading : ElricEngineState

  data object Ready : ElricEngineState

  data class Failed(val message: String) : ElricEngineState
}

/**
 * State and on-device answering for the Elric AI app: profile, language, mode and answer length,
 * saved chats, and the chat that is open. Answers come from the Gallery LLM runtime
 * ([LlmChatModelHelper]) running the downloaded Elric model on the phone.
 */
@HiltViewModel
class ElricViewModel @Inject constructor(@ApplicationContext private val context: Context) :
  ViewModel() {
  private val store = ElricStore(context)
  private val main = Handler(Looper.getMainLooper())

  var onboarded by mutableStateOf(store.onboarded)
    private set

  var lang by mutableStateOf(initialLang())
    private set

  var name by mutableStateOf(store.name)
    private set

  var study by mutableStateOf(store.study)
    private set

  var mode by mutableStateOf(ElricMode.fromId(store.mode))
    private set

  var short by mutableStateOf(store.short)
    private set

  var activeModelName by mutableStateOf(store.activeModel)
    private set

  var memoryOn by mutableStateOf(store.memoryOn)
    private set

  /** What Elric remembers about the user, newest first. Only on this phone. */
  val memories = mutableStateListOf<ElricMemory>().apply { addAll(store.loadMemories()) }

  /** The central facts list, cached on the phone (downloaded when online, at most once a day). */
  private val facts = ElricFacts(context)

  /** Opt-in error reports (crash and stuck). Off by default. */
  var reportsOn by mutableStateOf(ElricReports.isOn(context))
    private set

  /** True when the one-time "Send error reports?" card should show (after a first good answer). */
  var askReports by mutableStateOf(false)
    private set

  fun updateReportsOn(on: Boolean) {
    reportsOn = on
    askReports = false
    ElricReports.setOn(context, on)
  }

  fun dismissReportsAsk() {
    askReports = false
    ElricReports.markAsked(context)
  }

  /**
   * Sends feedback on the answer at [index] when the user taps Send. The question and answer are
   * included only when [include] is true. [onDone] gets true when it was stored.
   */
  fun sendFeedback(index: Int, kind: String, note: String, include: Boolean, onDone: (Boolean) -> Unit) {
    val answer = turns.getOrNull(index)
    val question = turns.take(index.coerceAtLeast(0)).lastOrNull { it.isUser }
    val modelName = loadedModel?.name ?: activeModelName.ifEmpty { null }
    val row =
      ElricCloud.baseRow(
        kind = kind,
        backend = modelName?.let { store.backendFor(it).ifEmpty { null } },
        model = modelName?.let { elricModelDisplayName(it) ?: it },
        mode = mode.id,
      ) +
        mapOf(
          "note" to note.trim().take(4000).ifEmpty { null },
          "question" to if (include) question?.text?.take(4000) else null,
          "answer" to if (include) answer?.text?.take(4000) else null,
        )
    viewModelScope.launch {
      val ok = ElricCloud.sendFeedback(row)
      onDone(ok)
    }
  }

  private fun reportStuck(model: Model, reason: String) {
    val backend = if (model.currentAccelerator == Accelerator.GPU) "gpu" else "cpu"
    val m = elricModelDisplayName(model.name) ?: model.name
    val md = mode.id
    viewModelScope.launch {
      try {
        ElricReports.sendStuck(context, backend, m, md, reason)
      } catch (e: CancellationException) {
        throw e
      } catch (t: Throwable) {
        Log.w(TAG, "stuck report failed", t)
      }
    }
  }

  /** True when the question being answered added a memory. */
  private var replySavedMemory = false

  val chats = mutableStateListOf<ElricChat>().apply { addAll(store.loadChats()) }
  val turns = mutableStateListOf<ElricTurn>()

  var chatId by mutableStateOf<String?>(null)
    private set

  var busy by mutableStateOf(false)
    private set

  var engine by mutableStateOf<ElricEngineState>(ElricEngineState.Idle)
    private set

  /** When the current load began ([SystemClock.elapsedRealtime]), for the seconds counter. */
  var loadStartedAt by mutableStateOf(0L)
    private set

  /** True while loading a model that has never started on this phone before. */
  var firstStart by mutableStateOf(false)
    private set

  /** True when the last question could not be answered because no model is downloaded. */
  var needsModel by mutableStateOf(false)
    private set

  /** Private path of the photo waiting to be sent with the next question, if any. */
  var attachment by mutableStateOf<String?>(null)
    private set

  /** What the voice control shows: recording, getting ready, or turning speech into text. */
  var voiceState by mutableStateOf(ElricVoiceState.IDLE)
    private set

  /** Length of the recording so far, in ms. */
  var voiceMs by mutableStateOf(0L)
    private set

  /** True while the engine is starting with photo and voice support. */
  var mediaLoading by mutableStateOf(false)
    private set

  private val recorder = ElricRecorder()

  /** Set when the user cancels voice while the model is still getting ready. */
  @Volatile private var voiceCancelled = false

  /** The engine instance that was started with photo and voice support, if any. */
  private var mediaInstance: Any? = null

  /** Models whose photo/voice start failed on this phone in this session; never retried in a loop. */
  private val mediaFailed = mutableSetOf<String>()

  /** Bumped whenever an answer streams more text, so the chat can follow it. */
  var streamTick by mutableStateOf(0)
    private set

  private var loadedModel: Model? = null
  private var runningModel: Model? = null
  private var stopRequested = false

  /** Identifies what the engine's conversation holds: system prompt plus history. */
  private var syncedKey: String? = null

  private fun initialLang(): ElricLang {
    val saved = store.lang
    if (saved.isNotEmpty()) return ElricLang.fromCode(saved)
    return if (Locale.getDefault().language == "hi") ElricLang.HI else ElricLang.EN
  }

  // ---------------------------------------------------------------- settings

  fun updateLang(l: ElricLang) {
    lang = l
    store.lang = l.code
  }

  fun updateProfile(newName: String, newStudy: String) {
    name = newName.trim().take(40)
    study = newStudy
    store.name = name
    store.study = study
  }

  fun finishOnboarding() {
    onboarded = true
    store.onboarded = true
  }

  fun updateMode(m: ElricMode) {
    mode = m
    store.mode = m.id
  }

  fun updateShort(s: Boolean) {
    short = s
    store.short = s
  }

  fun updateActiveModel(modelName: String) {
    activeModelName = modelName
    store.activeModel = modelName
  }

  // ---------------------------------------------------------------- memory

  fun updateMemoryOn(on: Boolean) {
    memoryOn = on
    store.memoryOn = on
  }

  fun deleteMemory(m: ElricMemory) {
    memories.remove(m)
    store.saveMemories(memories.toList())
  }

  fun clearMemories() {
    memories.clear()
    store.saveMemories(emptyList())
  }

  /** Saves what [question] asks Elric to remember, with simple rules. Returns true if saved. */
  private fun rememberFrom(question: String): Boolean {
    if (!memoryOn) return false
    val f = ElricMemoryRules.find(question) ?: return false
    val next = ElricMemoryRules.add(memories.toList(), f, System.currentTimeMillis()) ?: return false
    memories.clear()
    memories.addAll(next)
    store.saveMemories(next)
    // "give short answers" / "give detailed answers" also sets the answer-length switch.
    f.short?.let { updateShort(it) }
    return true
  }

  // ---------------------------------------------------------------- chats

  fun newChat() {
    if (busy) stop()
    chatId = null
    turns.clear()
    needsModel = false
  }

  fun openChat(id: String) {
    if (busy) stop()
    val c = chats.firstOrNull { it.id == id } ?: return
    chatId = c.id
    turns.clear()
    turns.addAll(c.turns)
    mode = ElricMode.fromId(c.mode)
    needsModel = false
  }

  fun renameChat(id: String, title: String) {
    val t = title.trim()
    if (t.isEmpty()) return
    val i = chats.indexOfFirst { it.id == id }
    if (i < 0) return
    chats[i] = chats[i].copy(title = t.take(60))
    store.saveChats(chats.toList())
  }

  fun deleteChat(id: String) {
    val images = chats.firstOrNull { it.id == id }?.turns?.mapNotNull { it.image }.orEmpty()
    chats.removeAll { it.id == id }
    store.saveChats(chats.toList())
    if (chatId == id) newChat()
    ElricImages.delete(context, images.filter { !isUsed(it) })
  }

  /** True when a photo is still shown in a chat or waiting in the composer. */
  private fun isUsed(path: String): Boolean =
    attachment == path ||
      turns.any { it.image == path } ||
      chats.any { c -> c.turns.any { it.image == path } }

  private fun persist() {
    val done = turns.filter { it.text.isNotBlank() }
    if (done.isEmpty()) return
    val id = chatId ?: System.currentTimeMillis().toString(36).also { chatId = it }
    val existing = chats.firstOrNull { it.id == id }
    val first = done.firstOrNull { it.isUser }?.text ?: ""
    val title = existing?.title?.takeIf { it.isNotBlank() } ?: first.replace('\n', ' ').take(60)
    val updated =
      ElricChat(id = id, title = title, mode = mode.id, turns = done, at = System.currentTimeMillis())
    chats.removeAll { it.id == id }
    chats.add(0, updated)
    val dropped = mutableListOf<String>()
    while (chats.size > ELRIC_MAX_CHATS) {
      dropped.addAll(chats.removeAt(chats.size - 1).turns.mapNotNull { it.image })
    }
    store.saveChats(chats.toList())
    if (dropped.isNotEmpty()) ElricImages.delete(context, dropped.filter { !isUsed(it) })
  }

  /**
   * Removes the question at [index] and every turn after it, and returns its text so it can be put
   * back in the composer for editing.
   */
  fun editQuestion(index: Int): String? {
    if (busy || index !in turns.indices || !turns[index].isUser) return null
    val text = turns[index].text
    val img = turns[index].image
    val dropped = turns.subList(index, turns.size).mapNotNull { it.image }.filter { it != img }
    while (turns.size > index) turns.removeAt(turns.size - 1)
    needsModel = false
    persist()
    // The photo goes back into the composer with the question.
    if (img != null) {
      val old = attachment
      attachment = img
      if (old != null && old != img && !isUsed(old)) ElricImages.delete(context, listOf(old))
    }
    ElricImages.delete(context, dropped.filter { !isUsed(it) })
    return if (img != null && text == T.photoDefault.get(lang)) "" else text
  }

  fun rate(index: Int, value: Int) {
    if (index !in turns.indices) return
    val t = turns[index]
    turns[index] = t.copy(rating = if (t.rating == value) 0 else value)
    persist()
  }

  /** Answers the last question again. */
  fun regenerate(model: Model?) {
    if (busy) return
    val lastUser = turns.indexOfLast { it.isUser }
    if (lastUser < 0) return
    val q = turns[lastUser].text
    val img = turns[lastUser].image
    while (turns.size > lastUser) turns.removeAt(turns.size - 1)
    ask(q, model, img)
  }

  // ---------------------------------------------------------------- photo

  /** Attaches a picked or captured photo to the next question. [onFail] runs when it can't be read. */
  fun attachPhoto(uri: Uri, onFail: () -> Unit) {
    viewModelScope.launch {
      val path = withContext(Dispatchers.IO) { ElricImages.importPhoto(context, uri) }
      if (path == null) {
        onFail()
        return@launch
      }
      val old = attachment
      attachment = path
      if (old != null && !isUsed(old)) ElricImages.delete(context, listOf(old))
    }
  }

  fun removeAttachment() {
    val a = attachment ?: return
    attachment = null
    if (!isUsed(a)) ElricImages.delete(context, listOf(a))
  }

  // ---------------------------------------------------------------- voice

  /**
   * Starts recording a voice question (at most 30 s). [onMax] runs on the main thread when the
   * limit is reached. Returns false when the microphone can't be used. The caller checks the
   * RECORD_AUDIO permission first.
   */
  fun startRecording(onMax: () -> Unit): Boolean {
    if (voiceState != ElricVoiceState.IDLE || busy) return false
    voiceMs = 0L
    val ok =
      recorder.start(
        onTick = { ms -> main.post { if (voiceState == ElricVoiceState.RECORDING) voiceMs = ms } },
        onMax = { main.post { if (voiceState == ElricVoiceState.RECORDING) onMax() } },
      )
    if (ok) voiceState = ElricVoiceState.RECORDING
    return ok
  }

  /** Cancels recording, or stops turning speech into text. Nothing is kept. */
  fun cancelVoice() {
    when (voiceState) {
      ElricVoiceState.RECORDING -> {
        recorder.cancel()
        voiceState = ElricVoiceState.IDLE
      }
      ElricVoiceState.PREPARING,
      ElricVoiceState.TRANSCRIBING -> {
        voiceCancelled = true
        stop()
      }
      ElricVoiceState.IDLE -> {}
    }
  }

  /**
   * Stops recording and turns the speech into text on the phone with [model] (Hindi or English),
   * the way upstream Audio Scribe does. [onText] gets the words to put in the composer; [onError]
   * gets a message to show.
   */
  fun finishRecording(model: Model?, onText: (String) -> Unit, onError: (Str) -> Unit) {
    if (voiceState != ElricVoiceState.RECORDING) return
    val pcm = recorder.stop()
    val peak = recorder.lastPeak
    voiceState = ElricVoiceState.IDLE
    if (elricPcmMs(pcm) < VOICE_MIN_MS || peak < VOICE_MIN_PEAK) {
      onError(T.voiceNothing)
      return
    }
    if (model == null || (model.instance == null && !modelFileComplete(model))) {
      onError(T.voiceNeedModel)
      return
    }
    if (!model.supportAudio) {
      onError(T.voiceUnsupported)
      return
    }
    if (busy) return
    voiceCancelled = false
    stopRequested = false
    voiceState = ElricVoiceState.PREPARING
    viewModelScope.launch {
      try {
        val (text, err) =
          speechToText(model, pcm, cancelled = { voiceCancelled }) {
            voiceState = ElricVoiceState.TRANSCRIBING
          }
        if (voiceCancelled) return@launch
        if (text != null) onText(text) else if (err != null) onError(err)
      } finally {
        voiceState = ElricVoiceState.IDLE
      }
    }
  }

  /**
   * Turns recorded speech into text on the phone: starts the engine with voice support if needed,
   * then runs one transcription turn on a fresh conversation. Returns the text, or a message to
   * show. [onTranscribing] runs when the model is ready and transcription begins.
   */
  private suspend fun speechToText(
    model: Model,
    pcm: ByteArray,
    cancelled: () -> Boolean,
    onTranscribing: () -> Unit,
  ): Pair<String?, Str?> {
    val err =
      try {
        ensureLoaded(model, systemPrompt(), media = true)
      } catch (e: CancellationException) {
        throw e
      } catch (t: Throwable) {
        t.message ?: "start failed"
      }
    if (cancelled()) return null to null
    if (err != null) return null to (if (err == MEDIA_UNSUPPORTED) T.voiceUnsupported else T.voiceFailed)
    onTranscribing()
    withContext(Dispatchers.Default) {
      LlmChatModelHelper.resetConversation(
        model = model,
        supportImage = false,
        supportAudio = true,
        systemInstruction = null,
        tools = listOf(),
        enableConversationConstrainedDecoding = false,
        initialMessages = listOf(),
        enableResponseFormat = false,
      )
    }
    // The chat's own conversation is rebuilt before the next answer.
    syncedKey = null
    val raw = withTimeoutOrNull(TRANSCRIBE_TIMEOUT_MS) { transcribe(model, elricWav(pcm)) }
    if (raw == null) {
      try {
        LlmChatModelHelper.stopResponse(model)
      } catch (e: Exception) {
        Log.w(TAG, "stop failed", e)
      }
    }
    if (cancelled()) return null to null
    val text = cleanTranscript(raw?.getOrNull() ?: "")
    return when {
      raw == null || raw.isFailure -> null to T.voiceFailed
      text.isEmpty() -> null to T.voiceNothing
      else -> text to null
    }
  }

  /** Runs one transcription turn. The result fails when the engine reports an error. */
  private suspend fun transcribe(model: Model, wav: ByteArray): Result<String> =
    suspendCancellableCoroutine { cont ->
      val raw = StringBuilder()
      val done = AtomicBoolean(false)
      fun end(r: Result<String>) {
        if (!done.compareAndSet(false, true)) return
        main.post {
          if (runningModel === model) runningModel = null
          if (cont.isActive) cont.resume(r)
        }
      }
      runningModel = model
      try {
        LlmChatModelHelper.runInference(
          model = model,
          input = TRANSCRIBE_PROMPT,
          resultListener = { partial, finished, _ ->
            if (partial.isNotEmpty()) synchronized(raw) { raw.append(partial) }
            if (finished) end(Result.success(synchronized(raw) { raw.toString() }))
          },
          cleanUpListener = {},
          onError = { msg ->
            Log.w(TAG, "transcribe failed: $msg")
            end(Result.failure(RuntimeException(msg)))
          },
          images = listOf(),
          audioClips = listOf(wav),
          coroutineScope = viewModelScope,
          extraContext = mapOf(EXTRA_CONTEXT_MAX_OUTPUT_TOKENS to TRANSCRIBE_MAX_TOKENS.toString()),
          responseJsonSchema = null,
        )
      } catch (e: Exception) {
        Log.e(TAG, "transcribe failed", e)
        end(Result.failure(e))
      }
    }

  // ---------------------------------------------------------------- talk

  /** Hands-free conversation: listen, answer, read the answer aloud, listen again. */
  var talkState by mutableStateOf(ElricTalkState.OFF)
    private set

  var talkMuted by mutableStateOf(false)
    private set

  /** Microphone level (0..1) while listening, for the animated circle. */
  var talkLevel by mutableStateOf(0f)
    private set

  /** What Elric last heard, or a short message, shown under the circle. */
  var talkCaption by mutableStateOf("")
    private set

  private val speaker = ElricSpeaker(context)
  private var talkModel: Model? = null
  private var talkReplyIndex = -1
  private var talkSession = 0
  private var talkMisses = 0

  /** Opens Talk. Returns a message to show instead when it can't start. */
  fun startTalk(model: Model?): Str? {
    if (busy || voiceState != ElricVoiceState.IDLE) return T.talkWait
    if (model == null || (model.instance == null && !modelFileComplete(model))) return T.voiceNeedModel
    if (!model.supportAudio || model.name in mediaFailed) return T.voiceUnsupported
    talkModel = model
    talkMuted = false
    talkMisses = 0
    talkCaption = ""
    talkState = ElricTalkState.PAUSED
    listenTalk()
    return null
  }

  fun stopTalk() {
    if (talkState == ElricTalkState.OFF) return
    val wasTranscribing =
      !busy && (talkState == ElricTalkState.THINKING || talkState == ElricTalkState.PREPARING)
    talkSession++
    talkState = ElricTalkState.OFF
    talkReplyIndex = -1
    recorder.cancel()
    speaker.stop()
    // An answer being written keeps going into the chat; a transcription is stopped.
    if (wasTranscribing) stop()
  }

  fun toggleTalkMute() {
    talkMuted = !talkMuted
    if (talkMuted && talkState == ElricTalkState.LISTENING) {
      talkSession++
      recorder.cancel()
      talkState = ElricTalkState.MUTED
    } else if (!talkMuted && (talkState == ElricTalkState.MUTED || talkState == ElricTalkState.PAUSED)) {
      listenTalk()
    }
  }

  /** Tap on the circle: interrupt reading, send now, or listen again. */
  fun tapTalk() {
    when (talkState) {
      ElricTalkState.SPEAKING -> {
        // Interrupt: stop reading and writing; what was written stays in the chat.
        speaker.stop()
        talkReplyIndex = -1
        if (busy) stop()
        listenTalk()
      }
      ElricTalkState.LISTENING -> endListening(talkSession)
      ElricTalkState.PAUSED -> {
        talkMisses = 0
        listenTalk()
      }
      ElricTalkState.MUTED -> toggleTalkMute()
      else -> {}
    }
  }

  private fun listenTalk() {
    if (talkState == ElricTalkState.OFF) return
    val session = ++talkSession
    if (talkMuted) {
      talkState = ElricTalkState.MUTED
      return
    }
    talkLevel = 0f
    val vad = ElricTalkVad(SystemClock.elapsedRealtime())
    val ended = AtomicBoolean(false)
    val ok =
      recorder.start(
        onTick = {},
        onMax = { main.post { endListening(session) } },
        onLevel = { level ->
          val now = SystemClock.elapsedRealtime()
          val done = vad.feed(level, now)
          val silent = vad.silentTooLong(now)
          main.post { if (session == talkSession) talkLevel = (level / 12000f).coerceIn(0f, 1f) }
          if ((done || silent) && ended.compareAndSet(false, true)) {
            main.post {
              if (done) {
                endListening(session)
              } else if (session == talkSession && talkState == ElricTalkState.LISTENING) {
                recorder.cancel()
                talkCaption = T.talkPaused.get(lang)
                talkState = ElricTalkState.PAUSED
              }
            }
          }
        },
      )
    if (!ok) {
      talkCaption = T.voiceUnavailable.get(lang)
      talkState = ElricTalkState.PAUSED
      return
    }
    talkState = ElricTalkState.LISTENING
  }

  private fun endListening(session: Int) {
    if (session != talkSession || talkState != ElricTalkState.LISTENING) return
    val pcm = recorder.stop()
    talkLevel = 0f
    val model = talkModel
    if (model == null) {
      stopTalk()
      return
    }
    if (elricPcmMs(pcm) < VOICE_MIN_MS || recorder.lastPeak < VOICE_MIN_PEAK) {
      talkMiss(session)
      return
    }
    talkState = if (hasMedia(model)) ElricTalkState.THINKING else ElricTalkState.PREPARING
    stopRequested = false
    viewModelScope.launch {
      val (text, err) =
        speechToText(model, pcm, cancelled = { session != talkSession }) {
          if (session == talkSession) talkState = ElricTalkState.THINKING
        }
      if (session != talkSession || talkState == ElricTalkState.OFF) return@launch
      if (text == null) {
        if (err == null || err === T.voiceNothing) {
          talkMiss(session)
        } else {
          talkCaption = err.get(lang)
          talkState = ElricTalkState.PAUSED
        }
        return@launch
      }
      talkMisses = 0
      talkCaption = text
      if (!ask(text, model, null) || !busy) {
        talkCaption = T.talkFailed.get(lang)
        talkState = ElricTalkState.PAUSED
        return@launch
      }
      talkSpokenTo = 0
      talkStarted = false
      talkReplyIndex = turns.size - 1
    }
  }

  /** Nothing clear was heard: listen once more, then wait for a tap (never loops). */
  private fun talkMiss(session: Int) {
    if (session != talkSession) return
    talkMisses++
    if (talkMisses >= 2) {
      talkCaption = T.talkPaused.get(lang)
      talkState = ElricTalkState.PAUSED
    } else {
      listenTalk()
    }
  }

  /** Characters of the answer already given to the speaker, and whether speaking has begun. */
  private var talkSpokenTo = 0
  private var talkStarted = false

  /**
   * Gives the speaker each finished sentence of the answer as it is written, so Elric starts
   * speaking after the first sentence. With [final] the rest is given and the speaker is closed.
   */
  private fun talkFeed(rawText: String, final: Boolean) {
    val text = rawText.trimStart()
    if (talkSpokenTo > text.length) talkSpokenTo = text.length
    var end = text.length
    if (!final) {
      end = -1
      for (i in text.length - 1 downTo talkSpokenTo) {
        val c = text[i]
        if (c == '.' || c == '!' || c == '?' || c == '\u0964' || c == '\n') {
          // A full stop inside a number (3.14) is not the end of a sentence.
          if (c == '.' && i + 1 < text.length && text[i + 1].isDigit()) continue
          if (c == '.' && i + 1 >= text.length) continue
          end = i + 1
          break
        }
      }
      if (end < 0 || end - talkSpokenTo < 12) return
    }
    val chunk = text.substring(talkSpokenTo, end)
    talkSpokenTo = end
    if (chunk.isNotBlank()) {
      if (!talkStarted) {
        talkStarted = true
        val session = talkSession
        talkState = ElricTalkState.SPEAKING
        speaker.begin { ok ->
          if (session != talkSession || talkState != ElricTalkState.SPEAKING) return@begin
          if (!ok) talkCaption = T.talkNoVoice.get(lang)
          listenTalk()
        }
      }
      speaker.add(chunk)
    }
    if (final) speaker.end()
  }

  private fun onTalkAnswer(turn: ElricTurn) {
    talkReplyIndex = -1
    if (turn.failed == true && !talkStarted) {
      talkCaption = turn.text
      talkState = ElricTalkState.PAUSED
      return
    }
    if (turn.failed == true) {
      speaker.end()
      return
    }
    talkFeed(turn.text, final = true)
    // Nothing to read aloud (an empty answer): listen again.
    if (!talkStarted) listenTalk()
  }

  // ---------------------------------------------------------------- answering

  fun systemPrompt(question: String = ""): String {
    val today = SimpleDateFormat("d MMMM yyyy", Locale.ENGLISH).format(Date())
    val sb = StringBuilder()
    sb.append(
      "Today is $today. Your knowledge may be out of date, so for recent news, results or events, " +
        "say you may not know and suggest checking a trusted source. "
    )
    sb.append(
      "You are Elric AI, built on open models. Answer reliably in the user's language (English or " +
        "Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI. " +
        "Write maths in plain text (like 17 × 24 = 408), never LaTeX. Keep " +
        "answers clear and not too long."
    )
    val cached = facts.facts
    if (cached.isEmpty()) {
      // Offline fallback until the facts list has been downloaded once.
    sb.append(
      " Facts: Elric AI is an offline-first study and shopping assistant for India, founded by Brahma Reddy Suravarapu (elricai.sbs, \"AI you can rely on.\"). Elric Watches is an official Titan watch store founded and owned by Brahma Reddy Suravarapu (elricwatches.in, Instagram @elricwatches). Brahma Reddy Suravarapu is the founder of the Elric brands: Elric Watches, Elric AI and Elric Next (give no details about Elric Next). Being built: Student OS, Elric Fit (a fitness and diet tracker) and Elric AI Watch; say they are being built and do not describe features. If asked who made, built or founded you, say Elric AI was founded by Brahma Reddy Suravarapu; never say Google, Gemma, Gemini or Qwen made you. Use these facts exactly when relevant. For any other small or local business or person, say you are not sure rather than guess."
    )
    } else {
      sb.append(
        " If asked who made, built or founded you, say Elric AI was founded by Brahma Reddy " +
          "Suravarapu; never say Google, Gemma, Gemini or Qwen made you. For any small or local " +
          "business or person you have no facts about, say you are not sure rather than guess. " +
          "Never invent details or features of Elric products beyond the facts given."
      )
      val rel = ElricFacts.pick(cached, question)
      if (rel.isNotEmpty()) {
        sb.append(" Facts (use exactly when relevant): ").append(rel.joinToString(" "))
      }
    }
    when (mode) {
      ElricMode.STUDY -> sb.append(" Mode: Study. Be a patient tutor for Indian students.")
      ElricMode.SHOPPING ->
        sb.append(
          " Mode: Shopping. You have NO access to live prices, stock or offers. Never state or " +
            "guess specific prices, and never invent products, shops or links. Help compare " +
            "features and explain what to look for, and say live prices are coming soon."
        )
      ElricMode.GENERAL -> {}
    }
    val mem = if (memoryOn) memories.toList() else emptyList()
    fun has(kind: String) = mem.any { it.kind == kind }
    if (lang == ElricLang.HI && !has("lang")) sb.append(" The user prefers Hindi.")
    if (name.isNotBlank() && !has("name")) sb.append(" The user's name is ${name.trim()}.")
    if (study.isNotBlank() && !has("study")) {
      sb.append(" The user studies: $study. Match explanations to this level.")
    }
    val talking = talkState != ElricTalkState.OFF
    if (talking) {
      sb.append(
        " This is a spoken conversation: reply in plain spoken sentences, with no markdown, " +
          "lists, tables, symbols or emojis, in the language the user spoke."
      )
    }
    sb.append(
      if (short || talking) {
        " ANSWER LENGTH: SHORT. Reply in at most 4 short sentences or 5 bullet points (under 80 " +
          "words). Give the key answer first. No greetings, no repeating the question. If the " +
          "user sends several questions, answer each in one or two lines."
      } else {
        " ANSWER LENGTH: DETAILED. Explain step by step with an example."
      }
    )
    sb.append(ElricMemoryRules.promptBlock(mem.filter { it.kind != "length" }))
    return sb.toString()
  }

  /** A turn as the model sees it when the chat is replayed (older photos are not sent again). */
  private fun seedText(t: ElricTurn): String =
    if (t.isUser && t.image != null) "[Photo] ${t.text}" else t.text

  private fun keyOf(system: String, history: List<ElricTurn>): String {
    val h = StringBuilder()
    for (t in history) h.append(t.role).append('\u0001').append(seedText(t)).append('\u0002')
    return "${loadedModel?.name}|${system.hashCode()}|${h.length}|${h.toString().hashCode()}"
  }

  /** History to seed the conversation with, dropping the oldest turns when it would not fit. */
  private fun trimmedHistory(
    model: Model,
    system: String,
    question: String,
    history: List<ElricTurn>,
    extraTokens: Int = 0,
  ): List<ElricTurn> {
    val maxTokens =
      model.getIntConfigValue(key = ConfigKeys.MAX_TOKENS, defaultValue = DEFAULT_MAX_TOKEN)
    val budgetChars =
      ((maxTokens - ANSWER_RESERVE_TOKENS - extraTokens).coerceAtLeast(600) * CHARS_PER_TOKEN).toInt()
    var start = 0
    fun size(): Int =
      system.length + question.length + history.subList(start, history.size).sumOf { it.text.length }
    while (start < history.size && size() > budgetChars) {
      start++
      // Keep the history starting on a question.
      while (start < history.size && !history[start].isUser) start++
    }
    return history.subList(start, history.size).toList()
  }

  /**
   * Loads [model] for answering. Returns null when ready, or an error. Never waits forever: the
   * GPU gets [GPU_INIT_TIMEOUT_MS], and the whole load [LOAD_TIMEOUT_MS], after which it ends in
   * [ElricEngineState.Failed].
   *
   * With [media] the engine is started with photo and voice support (the same LiteRT-LM options the
   * upstream Ask Image and Audio Scribe screens use). It tries the GPU for the photo encoder first
   * where that is safe, then the CPU, and returns [MEDIA_UNSUPPORTED] when no option starts on this
   * phone. Text chat keeps working either way.
   */
  private suspend fun ensureLoaded(model: Model, system: String, media: Boolean = false): String? {
    if (loadedModel === model && model.instance != null && (!media || hasMedia(model))) return null
    if (media && model.name in mediaFailed) return MEDIA_UNSUPPORTED
    loadStartedAt = SystemClock.elapsedRealtime()
    firstStart =
      if (media) store.mediaBackendFor(model.name).isEmpty() else store.backendFor(model.name).isEmpty()
    mediaLoading = media
    engine = ElricEngineState.Loading
    try {
      // A start from an earlier attempt is still running (it timed out but was kept): use it when
      // it fits, otherwise wait for it, so two copies are never loaded into memory at once.
      val pending = pendingStart
      if (pending != null && !pending.result.isCompleted) {
        if (pending.model === model && (pending.media || !media)) {
          val err = initialize(model, system, LOAD_TIMEOUT_MS, abandonOnTimeout = false, media = pending.media)
          if (err == null && model.instance != null) {
            val backend = if (model.currentAccelerator == Accelerator.GPU) "gpu" else "cpu"
            if (pending.media) startedMedia(model, system, backend) else started(model, system, backend)
            // It was started with an older system prompt.
            syncedKey = null
            return null
          }
          val msg = err ?: "timed out after ${LOAD_TIMEOUT_MS / 1000} s"
          engine = ElricEngineState.Failed(msg)
          reportStuck(model, if (err == null) "load timeout ${LOAD_TIMEOUT_MS / 1000} s" else "load failed: $msg")
          return msg
        }
        val finished = withTimeoutOrNull(LOAD_TIMEOUT_MS) { pending.result.await() }
        if (finished == null) {
          val msg = "an earlier start is still running"
          engine = ElricEngineState.Failed(msg)
          return msg
        }
        if (pendingStart === pending) pendingStart = null
      }

      // Free engines that don't fit this request: another model, or this one without photo/voice.
      for (m in listOfNotNull(loadedModel, pending?.model, model).distinct()) {
        if (m.instance != null && (m !== model || (media && !hasMedia(m)))) release(m)
      }
      loadedModel = null
      syncedKey = null
      if (model.instance != null) {
        // Initialized earlier (for example before a screen rotation, or a start that finished
        // after a timeout); its conversation is unknown.
        loadedModel = model
        engine = ElricEngineState.Ready
        mediaLoading = false
        return null
      }
      return if (media) startMedia(model, system) else startText(model, system)
    } catch (e: CancellationException) {
      engine = ElricEngineState.Idle
      throw e
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to start model", t)
      val msg = t.message ?: t.javaClass.simpleName
      engine = ElricEngineState.Failed(msg)
      reportStuck(model, "load failed: ${t.javaClass.simpleName}")
      return msg
    } finally {
      mediaLoading = false
    }
  }

  /** True when [model]'s engine was started with photo and voice support. */
  private fun hasMedia(model: Model): Boolean = model.instance != null && model.instance === mediaInstance

  /** Closes [m]'s engine and waits (at most 15 s) for it to be freed. */
  private suspend fun release(m: Model) {
    withTimeoutOrNull(15_000L) {
      withContext(Dispatchers.Default) {
        suspendCancellableCoroutine { cont ->
          LlmChatModelHelper.cleanUp(m) { if (cont.isActive) cont.resume(Unit) }
          if (m.instance == null && cont.isActive) cont.resume(Unit)
        }
      }
    }
    if (loadedModel === m) loadedModel = null
    syncedKey = null
  }

  /** Text-only start: GPU first where it is safe, then the CPU. */
  private suspend fun startText(model: Model, system: String): String? {
    val deadline = loadStartedAt + LOAD_TIMEOUT_MS
    val saved = store.backendFor(model.name)
    val lowRam = ElricDevice.isLowRam(context)
    val startOnGpu =
      when (saved) {
        "cpu" -> false
        "gpu" -> true
        else -> !ElricDevice.preferCpu(context)
      }
    Log.i(
      TAG,
      "Starting ${model.name}: saved=$saved lowRam=$lowRam ${ElricDevice.describe(context)} " +
        "gpuFirst=$startOnGpu",
    )

    var error: String? = null
    if (startOnGpu) {
      configure(model, Accelerator.GPU, lowRam)
      // A timed-out GPU start is abandoned: its engine is closed if it ever finishes.
      error = initialize(model, system, GPU_INIT_TIMEOUT_MS, abandonOnTimeout = true, media = false)
      if (error == null && model.instance != null) {
        return started(model, system, "gpu")
      }
      Log.w(TAG, "GPU start failed or timed out (${error ?: "timeout"}); trying CPU")
    }
    configure(model, Accelerator.CPU, lowRam)
    val left = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(MIN_CPU_TIMEOUT_MS)
    // The last attempt is not abandoned: a Retry waits for it instead of starting a second copy.
    error = initialize(model, system, left, abandonOnTimeout = false, media = false)
    if (error == null && model.instance != null) {
      return started(model, system, "cpu")
    }
    val msg = error ?: "timed out after ${LOAD_TIMEOUT_MS / 1000} s"
    Log.e(TAG, "Failed to start model: $msg")
    engine = ElricEngineState.Failed(msg)
    reportStuck(model, if (error == null) "load timeout ${LOAD_TIMEOUT_MS / 1000} s" else "load failed: $msg")
    return msg
  }

  /**
   * Photo and voice start. Options (main/vision backend) are tried in order: the one that worked
   * last time, GPU/GPU where the GPU is safe, CPU/CPU, then CPU/GPU. The voice encoder always runs
   * on the CPU. When every option fails with an error the model is marked unsupported for this
   * session (no retry loop); a timeout is reported as a normal failure so Retry can wait for it.
   */
  private suspend fun startMedia(model: Model, system: String): String? {
    val deadline = loadStartedAt + LOAD_TIMEOUT_MS
    val lowRam = ElricDevice.isLowRam(context)
    val savedMain = store.backendFor(model.name)
    val gpuOk =
      when (savedMain) {
        "cpu" -> false
        "gpu" -> true
        else -> !ElricDevice.preferCpu(context)
      }
    val options = mutableListOf<Pair<Accelerator, Accelerator>>()
    parseMediaBackend(store.mediaBackendFor(model.name))?.let { options.add(it) }
    if (gpuOk) options.add(Accelerator.GPU to Accelerator.GPU)
    options.add(Accelerator.CPU to Accelerator.CPU)
    options.add(Accelerator.CPU to Accelerator.GPU)
    val tries = options.distinct()
    Log.i(TAG, "Starting ${model.name} with photo+voice: options=$tries ${ElricDevice.describe(context)}")

    var timedOut = false
    var lastError: String? = null
    for ((i, opt) in tries.withIndex()) {
      val (mainAcc, vision) = opt
      val last = i == tries.size - 1
      configure(model, mainAcc, lowRam, vision)
      val usesGpu = mainAcc == Accelerator.GPU || vision == Accelerator.GPU
      val left = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(MIN_CPU_TIMEOUT_MS)
      val timeout = if (usesGpu && !last) minOf(MEDIA_GPU_TIMEOUT_MS, left) else left
      val err = initialize(model, system, timeout, abandonOnTimeout = !last, media = true)
      if (err == null && model.instance != null) {
        store.saveMediaBackend(model.name, "${mainAcc.label.lowercase()}/${vision.label.lowercase()}")
        return startedMedia(model, system, if (mainAcc == Accelerator.GPU) "gpu" else "cpu")
      }
      if (err == null || err.startsWith("timed out")) timedOut = true
      lastError = err ?: "timed out"
      Log.w(TAG, "Photo+voice start ${mainAcc.label}/${vision.label} failed: $lastError")
      if (SystemClock.elapsedRealtime() > deadline && !last) {
        timedOut = true
        break
      }
    }
    if (!timedOut) {
      mediaFailed.add(model.name)
      engine = ElricEngineState.Idle
      return MEDIA_UNSUPPORTED
    }
    val msg = lastError ?: "timed out"
    engine = ElricEngineState.Failed(msg)
    reportStuck(model, "photo/voice load timeout")
    return msg
  }

  private fun parseMediaBackend(s: String): Pair<Accelerator, Accelerator>? {
    val parts = s.split('/')
    if (parts.size != 2) return null
    fun acc(x: String) =
      when (x) {
        "gpu" -> Accelerator.GPU
        "cpu" -> Accelerator.CPU
        else -> null
      }
    val first = acc(parts[0]) ?: return null
    val vision = acc(parts[1]) ?: return null
    return first to vision
  }

  private fun started(model: Model, system: String, backend: String): String? {
    store.saveBackend(model.name, backend)
    loadedModel = model
    // A fresh conversation already holds this system prompt and no history.
    syncedKey = keyOf(system, emptyList())
    engine = ElricEngineState.Ready
    Log.i(TAG, "Started ${model.name} on $backend in ${SystemClock.elapsedRealtime() - loadStartedAt} ms")
    return null
  }

  private fun startedMedia(model: Model, system: String, backend: String): String? {
    loadedModel = model
    mediaInstance = model.instance
    syncedKey = keyOf(system, emptyList())
    engine = ElricEngineState.Ready
    Log.i(
      TAG,
      "Started ${model.name} with photo+voice on $backend in " +
        "${SystemClock.elapsedRealtime() - loadStartedAt} ms",
    )
    return null
  }

  /** Sets the backend and a context size that suits it before a start. */
  private fun configure(
    model: Model,
    accelerator: Accelerator,
    lowRam: Boolean,
    vision: Accelerator? = null,
  ) {
    store.saveLastRun(elricModelDisplayName(model.name) ?: model.name, if (accelerator == Accelerator.GPU) "gpu" else "cpu")
    val current =
      model.getIntConfigValue(key = ConfigKeys.MAX_TOKENS, defaultValue = DEFAULT_MAX_TOKEN)
    val cap = if (accelerator == Accelerator.CPU && lowRam) CPU_LOW_RAM_MAX_TOKENS else MAX_TOKENS_CAP
    val tokens = current.coerceIn(MIN_TOKENS, cap)
    model.configValues =
      model.configValues.toMutableMap().apply {
        put(ConfigKeys.ACCELERATOR.label, accelerator.label)
        put(ConfigKeys.MAX_TOKENS.label, tokens.toString())
        if (vision != null) put(ConfigKeys.VISION_ACCELERATOR.label, vision.label)
      }
  }

  /** A start still running from an earlier attempt that was not abandoned. */
  private class PendingStart(
    val model: Model,
    val result: CompletableDeferred<String>,
    val media: Boolean,
  )

  private var pendingStart: PendingStart? = null

  /**
   * Starts the engine on its own thread (the native start blocks and cannot be interrupted) and
   * waits at most [timeoutMs]. Returns null when started, the error text, or null with no
   * instance on a timeout. With [media] the engine gets photo and voice support.
   */
  private suspend fun initialize(
    model: Model,
    system: String,
    timeoutMs: Long,
    abandonOnTimeout: Boolean,
    media: Boolean,
  ): String? {
    val pending = pendingStart
    val result: CompletableDeferred<String>
    val abandoned = AtomicBoolean(false)
    if (pending != null && pending.model === model && !pending.result.isCompleted) {
      Log.i(TAG, "Waiting for the start that is still running")
      result = pending.result
    } else {
      result = CompletableDeferred()
      val r = result
      Thread(
          {
            try {
              LlmChatModelHelper.initializeGuarded(
                context = context,
                model = model,
                taskId = BuiltInTaskId.LLM_CHAT,
                supportImage = media && model.supportImage,
                supportAudio = media && model.supportAudio,
                onDone = { err -> r.complete(err) },
                systemInstruction = Contents.of(system),
                tools = listOf(),
                enableConversationConstrainedDecoding = false,
                initialMessages = listOf(),
                enableResponseFormat = false,
                abandoned = abandoned,
              )
            } catch (t: Throwable) {
              r.complete(t.message ?: t.javaClass.simpleName)
            }
            r.complete("start ended without a result")
          },
          "elric-engine-start",
        )
        .start()
      if (!abandonOnTimeout) pendingStart = PendingStart(model, result, media)
    }
    val err = withTimeoutOrNull(timeoutMs) { result.await() }
    if (err == null) {
      if (abandonOnTimeout) {
        synchronized(abandoned) { abandoned.set(true) }
      }
      // It may have finished just before giving up.
      return if (model.instance != null) null else "timed out after ${timeoutMs / 1000} s"
    }
    if (pendingStart?.result === result) pendingStart = null
    return err.ifEmpty { null }
  }

  /** True when the model file on the phone is complete (not a partial download). */
  private fun modelFileComplete(model: Model): Boolean {
    if (model.downloadInfo.imported) return true
    val expected = model.downloadInfo.sizeInBytes
    return try {
      val f = File(model.getPath(context))
      f.exists() && (expected <= 0L || f.length() >= expected)
    } catch (e: Exception) {
      Log.w(TAG, "model file check failed", e)
      true
    }
  }

  /**
   * Asks [text] in the open chat, with the attached photo if there is one. [model] is the
   * downloaded model to answer with, if any.
   */
  fun send(text: String, model: Model?) {
    val image = attachment
    if (ask(text, model, image) && image != null) attachment = null
  }

  /** Returns true when the question was added to the chat. */
  private fun ask(text: String, model: Model?, image: String?): Boolean {
    val q = text.trim().ifEmpty { if (image != null) T.photoDefault.get(lang) else "" }
    if (q.isEmpty() || busy || voiceState != ElricVoiceState.IDLE) return false
    val history = turns.filter { it.failed != true && it.text.isNotBlank() }.toList()
    turns.add(ElricTurn(role = "user", text = q, image = image))
    replySavedMemory = rememberFrom(q)
    if (model == null || (model.instance == null && !modelFileComplete(model))) {
      // Never fake an answer: the chat shows that a (complete) model is needed.
      if (model != null) Log.w(TAG, "Model file for ${model.name} is incomplete")
      needsModel = true
      persist()
      return true
    }
    needsModel = false
    busy = true
    stopRequested = false
    turns.add(ElricTurn(role = "model", text = "", memSaved = if (replySavedMemory) true else null))
    val replyIndex = turns.size - 1
    val system = systemPrompt(q)
    if (image != null && !model.supportImage) {
      finishReply(replyIndex, ElricTurn(role = "model", text = T.photoUnsupported.get(lang), failed = true))
      return true
    }

    viewModelScope.launch {
      val loadError =
        try {
          ensureLoaded(model, system, media = image != null)
        } catch (e: CancellationException) {
          throw e
        } catch (t: Throwable) {
          t.message ?: "start failed"
        }
      if (loadError != null) {
        val msg = if (loadError == MEDIA_UNSUPPORTED) T.photoUnsupported else T.startFailed
        finishReply(replyIndex, ElricTurn(role = "model", text = msg.get(lang), failed = true))
        return@launch
      }
      val bitmap: Bitmap? = image?.let { withContext(Dispatchers.IO) { ElricImages.read(it) } }
      if (image != null && bitmap == null) {
        finishReply(replyIndex, ElricTurn(role = "model", text = T.photoFailed.get(lang), failed = true))
        return@launch
      }
      if (stopRequested) {
        finishReply(replyIndex, ElricTurn(role = "model", text = T.stopped.get(lang), failed = true))
        return@launch
      }
      val seed = trimmedHistory(model, system, q, history, if (image != null) PHOTO_TOKENS else 0)
      val key = keyOf(system, seed)
      if (key != syncedKey) {
        withContext(Dispatchers.Default) {
          LlmChatModelHelper.resetConversation(
            model = model,
            supportImage = false,
            supportAudio = false,
            systemInstruction = Contents.of(system),
            tools = listOf(),
            enableConversationConstrainedDecoding = false,
            initialMessages =
              seed.map {
                if (it.isUser) Message.user(Contents.of(seedText(it)))
                else Message.model(Contents.of(it.text))
              },
            enableResponseFormat = false,
          )
        }
        syncedKey = key
      }
      runAnswer(model, system, seed, q, image, bitmap, replyIndex)
    }
    return true
  }

  private fun runAnswer(
    model: Model,
    system: String,
    seed: List<ElricTurn>,
    q: String,
    image: String?,
    bitmap: Bitmap?,
    replyIndex: Int,
  ) {
    runningModel = model
    val t0 = SystemClock.elapsedRealtime()
    val raw = StringBuilder()
    var firstMs: Long? = null
    val finished = AtomicBoolean(false)
    val posted = AtomicBoolean(false)

    fun current(): String = synchronized(raw) { raw.toString() }

    fun postUpdate() {
      if (!posted.compareAndSet(false, true)) return
      main.postDelayed(
        {
          posted.set(false)
          if (finished.get() || replyIndex !in turns.indices) return@postDelayed
          val partial = cleanModelText(current())
          turns[replyIndex] = turns[replyIndex].copy(text = partial)
          streamTick++
          if (talkState != ElricTalkState.OFF && replyIndex == talkReplyIndex) talkFeed(partial, final = false)
        },
        40,
      )
    }

    fun finish(error: String?) {
      if (!finished.compareAndSet(false, true)) return
      val ms = SystemClock.elapsedRealtime() - t0
      main.post {
        runningModel = null
        val text = cleanModelText(current()).trim()
        val turn =
          when {
            error != null && text.isEmpty() ->
              ElricTurn(
                role = "model",
                text = T.errorAnswer.format(lang, "err" to error.take(160)),
                failed = true,
              )
            text.isEmpty() -> ElricTurn(role = "model", text = T.stopped.get(lang), failed = true)
            stopRequested || error != null -> ElricTurn(role = "model", text = text)
            else -> ElricTurn(role = "model", text = text, ms = ms, firstMs = firstMs)
          }
        // Only a fully finished answer leaves the engine's conversation in a known state.
        syncedKey =
          if (error == null && !stopRequested && text.isNotEmpty()) {
            keyOf(system, seed + ElricTurn("user", q, image = image) + ElricTurn("model", text))
          } else {
            null
          }
        finishReply(replyIndex, turn)
      }
    }

    val extra =
      if (short || talkState != ElricTalkState.OFF) {
        mapOf(EXTRA_CONTEXT_MAX_OUTPUT_TOKENS to SHORT_MAX_OUTPUT_TOKENS.toString())
      } else {
        emptyMap()
      }
    try {
      LlmChatModelHelper.runInference(
        model = model,
        input = q,
        resultListener = { partial, done, _ ->
          if (partial.isNotEmpty()) {
            synchronized(raw) { raw.append(partial) }
            if (firstMs == null && current().isNotBlank()) {
              firstMs = SystemClock.elapsedRealtime() - t0
            }
            postUpdate()
          }
          if (done) finish(null)
        },
        cleanUpListener = {},
        onError = { msg -> finish(msg) },
        images = listOfNotNull(bitmap),
        audioClips = listOf(),
        coroutineScope = viewModelScope,
        extraContext = extra,
        responseJsonSchema = null,
      )
    } catch (e: Exception) {
      Log.e(TAG, "runInference failed", e)
      finish(e.message ?: "error")
    }
  }

  private fun finishReply(index: Int, turn: ElricTurn) {
    if (index in turns.indices) {
      turns[index] = if (replySavedMemory) turn.copy(memSaved = true) else turn
    }
    if (turn.failed != true && turn.ms != null && !reportsOn && !ElricReports.asked(context)) {
      askReports = true
    }
    replySavedMemory = false
    busy = false
    streamTick++
    persist()
    if (talkState != ElricTalkState.OFF && index == talkReplyIndex) onTalkAnswer(turns[index])
  }

  fun stop() {
    stopRequested = true
    val m = runningModel ?: return
    try {
      LlmChatModelHelper.stopResponse(m)
    } catch (e: Exception) {
      Log.w(TAG, "stop failed", e)
    }
  }

  /** Frees the engine before its model files are deleted. */
  fun releaseModel(model: Model, onDone: () -> Unit) {
    if (busy && runningModel === model) stop()
    if (model.instance == null) {
      if (loadedModel === model) loadedModel = null
      onDone()
      return
    }
    viewModelScope.launch(Dispatchers.Default) {
      LlmChatModelHelper.cleanUp(model) {}
      withContext(Dispatchers.Main) {
        if (loadedModel === model) {
          loadedModel = null
          syncedKey = null
          engine = ElricEngineState.Idle
        }
        onDone()
      }
    }
  }

  init {
    viewModelScope.launch {
      try {
        if (facts.syncIfDue()) syncedKey = null
        ElricReports.sendPending(context)
      } catch (e: CancellationException) {
        throw e
      } catch (t: Throwable) {
        Log.w(TAG, "startup sync failed", t)
      }
    }
  }

  override fun onCleared() {
    super.onCleared()
    recorder.cancel()
    speaker.shutdown()
    val m = loadedModel ?: return
    try {
      LlmChatModelHelper.cleanUp(m) {}
    } catch (e: Exception) {
      Log.w(TAG, "cleanup failed", e)
    }
  }
}

private val CHANNEL_BLOCK = Regex("<\\|channel>[\\s\\S]*?<channel\\|>")
private val CHANNEL_OPEN = Regex("<\\|channel>[\\s\\S]*$")
private val TURN_TOKENS = Regex("<\\|?turn\\|?>")
private val THINK = Regex("<think>[\\s\\S]*?</think>")
private val TURN_MARKERS = Regex("<(start|end)_of_turn>(model|user)?")

/** Removes control tokens the model can emit as text. */
fun cleanModelText(text: String): String =
  text
    .replace(CHANNEL_BLOCK, "")
    .replace(TURN_TOKENS, "")
    .replace(CHANNEL_OPEN, "")
    .replace(THINK, "")
    .replace(TURN_MARKERS, "")

private val SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉"
private val SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹"

/** Turns simple LaTeX into plain text (the model is asked not to use LaTeX, but sometimes does). */
fun plainMaths(m: String): String {
  var x = m
  repeat(4) {
    x =
      x.replace(Regex("\\\\(?:text|mathrm|mathbf)\\{([^{}]*)\\}"), "$1")
        .replace(Regex("\\\\frac\\{([^{}]*)\\}\\{([^{}]*)\\}"), "($1)/($2)")
  }
  x =
    x.replace("\\times", "×")
      .replace("\\div", "÷")
      .replace("\\cdot", "·")
      .replace("\\longrightarrow", "→")
      .replace("\\rightarrow", "→")
      .replace("\\quad", " ")
      .replace("\\%", "%")
  x =
    Regex("_\\{?(\\d+)\\}?").replace(x) { r ->
      r.groupValues[1].map { SUB_DIGITS[it - '0'] }.joinToString("")
    }
  x =
    Regex("\\^\\{?(\\d+)\\}?").replace(x) { r ->
      r.groupValues[1].map { SUP_DIGITS[it - '0'] }.joinToString("")
    }
  return x.replace("{", "").replace("}", "").replace("\\", "")
}

/** Prepares an answer for display: plain maths instead of `$...$` LaTeX. */
fun displayAnswer(text: String): String {
  var s = Regex("\\$\\$([\\s\\S]*?)\\$\\$").replace(text) { r -> "\n`" + plainMaths(r.groupValues[1]).trim() + "`\n" }
  s = Regex("\\$([^$\\n]+?)\\$").replace(s) { r -> plainMaths(r.groupValues[1]) }
  return s
}

private val TRANSCRIPT_LABEL = Regex("(?i)^\\s*(transcription|transcript|text)\\s*:\\s*")

/** Tidies a transcription: no control tokens, labels or wrapping quotes. */
fun cleanTranscript(text: String): String {
  var t = cleanModelText(text).trim()
  t = t.replace(TRANSCRIPT_LABEL, "").trim()
  t = t.trim('"', '\u201C', '\u201D', '\'', '`').trim()
  return t.take(1000)
}
