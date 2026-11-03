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
    chats.removeAll { it.id == id }
    store.saveChats(chats.toList())
    if (chatId == id) newChat()
  }

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
    while (chats.size > ELRIC_MAX_CHATS) chats.removeAt(chats.size - 1)
    store.saveChats(chats.toList())
  }

  /**
   * Removes the question at [index] and every turn after it, and returns its text so it can be put
   * back in the composer for editing.
   */
  fun editQuestion(index: Int): String? {
    if (busy || index !in turns.indices || !turns[index].isUser) return null
    val text = turns[index].text
    while (turns.size > index) turns.removeAt(turns.size - 1)
    needsModel = false
    persist()
    return text
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
    while (turns.size > lastUser) turns.removeAt(turns.size - 1)
    send(q, model)
  }

  // ---------------------------------------------------------------- answering

  fun systemPrompt(): String {
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
    sb.append(
      " Facts: Elric AI is an offline-first study and shopping assistant for India, founded by Brahma Reddy Suravarapu (elricai.sbs, \"AI you can rely on.\"). Elric Watches is an official Titan watch store founded and owned by Brahma Reddy Suravarapu (elricwatches.in, Instagram @elricwatches). Brahma Reddy Suravarapu is the founder of the Elric brands: Elric Watches, Elric AI and Elric Next (give no details about Elric Next). Being built: Student OS, Elric Fit (a fitness and diet tracker) and Elric AI Watch; say they are being built and do not describe features. If asked who made, built or founded you, say Elric AI was founded by Brahma Reddy Suravarapu; never say Google, Gemma, Gemini or Qwen made you. Use these facts exactly when relevant. For any other small or local business or person, say you are not sure rather than guess."
    )
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
    sb.append(
      if (short) {
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

  private fun keyOf(system: String, history: List<ElricTurn>): String {
    val h = StringBuilder()
    for (t in history) h.append(t.role).append('\u0001').append(t.text).append('\u0002')
    return "${loadedModel?.name}|${system.hashCode()}|${h.length}|${h.toString().hashCode()}"
  }

  /** History to seed the conversation with, dropping the oldest turns when it would not fit. */
  private fun trimmedHistory(
    model: Model,
    system: String,
    question: String,
    history: List<ElricTurn>,
  ): List<ElricTurn> {
    val maxTokens =
      model.getIntConfigValue(key = ConfigKeys.MAX_TOKENS, defaultValue = DEFAULT_MAX_TOKEN)
    val budgetChars =
      ((maxTokens - ANSWER_RESERVE_TOKENS).coerceAtLeast(800) * CHARS_PER_TOKEN).toInt()
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
   */
  private suspend fun ensureLoaded(model: Model, system: String): String? {
    if (loadedModel === model && model.instance != null) return null
    loadStartedAt = SystemClock.elapsedRealtime()
    firstStart = store.backendFor(model.name).isEmpty()
    engine = ElricEngineState.Loading
    try {
      val previous = loadedModel
      if (previous != null && previous !== model && previous.instance != null) {
        withTimeoutOrNull(15_000L) {
          withContext(Dispatchers.Default) {
            suspendCancellableCoroutine { cont ->
              LlmChatModelHelper.cleanUp(previous) { if (cont.isActive) cont.resume(Unit) }
              if (previous.instance == null && cont.isActive) cont.resume(Unit)
            }
          }
        }
      }
      loadedModel = null
      syncedKey = null
      if (model.instance != null) {
        // Initialized earlier (for example before a screen rotation, or a start that finished
        // after a timeout); its conversation is unknown.
        loadedModel = model
        engine = ElricEngineState.Ready
        return null
      }

      // A start from an earlier attempt is still running (it timed out but was kept): wait for it
      // instead of loading a second copy into memory.
      val pending = pendingStart
      if (pending != null && pending.first === model && !pending.second.isCompleted) {
        val err = initialize(model, system, LOAD_TIMEOUT_MS, abandonOnTimeout = false)
        if (err == null && model.instance != null) {
          val backend = if (model.currentAccelerator == Accelerator.GPU) "gpu" else "cpu"
          started(model, system, backend)
          // It was started with an older system prompt.
          syncedKey = null
          return null
        }
        val msg = err ?: "timed out after ${LOAD_TIMEOUT_MS / 1000} s"
        engine = ElricEngineState.Failed(msg)
        return msg
      }

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
        error = initialize(model, system, GPU_INIT_TIMEOUT_MS, abandonOnTimeout = true)
        if (error == null && model.instance != null) {
          return started(model, system, "gpu")
        }
        Log.w(TAG, "GPU start failed or timed out (${error ?: "timeout"}); trying CPU")
      }
      configure(model, Accelerator.CPU, lowRam)
      val left = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(MIN_CPU_TIMEOUT_MS)
      // The last attempt is not abandoned: a Retry waits for it instead of starting a second copy.
      error = initialize(model, system, left, abandonOnTimeout = false)
      if (error == null && model.instance != null) {
        return started(model, system, "cpu")
      }
      val msg = error ?: "timed out after ${LOAD_TIMEOUT_MS / 1000} s"
      Log.e(TAG, "Failed to start model: $msg")
      engine = ElricEngineState.Failed(msg)
      return msg
    } catch (e: CancellationException) {
      engine = ElricEngineState.Idle
      throw e
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to start model", t)
      val msg = t.message ?: t.javaClass.simpleName
      engine = ElricEngineState.Failed(msg)
      return msg
    }
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

  /** Sets the backend and a context size that suits it before a start. */
  private fun configure(model: Model, accelerator: Accelerator, lowRam: Boolean) {
    val current =
      model.getIntConfigValue(key = ConfigKeys.MAX_TOKENS, defaultValue = DEFAULT_MAX_TOKEN)
    val cap = if (accelerator == Accelerator.CPU && lowRam) CPU_LOW_RAM_MAX_TOKENS else MAX_TOKENS_CAP
    val tokens = current.coerceIn(MIN_TOKENS, cap)
    model.configValues =
      model.configValues.toMutableMap().apply {
        put(ConfigKeys.ACCELERATOR.label, accelerator.label)
        put(ConfigKeys.MAX_TOKENS.label, tokens.toString())
      }
  }

  /** The start still running from an earlier attempt that was not abandoned, if any. */
  private var pendingStart: Pair<Model, CompletableDeferred<String>>? = null

  /**
   * Starts the engine on its own thread (the native start blocks and cannot be interrupted) and
   * waits at most [timeoutMs]. Returns null when started, the error text, or null with no
   * instance on a timeout.
   */
  private suspend fun initialize(
    model: Model,
    system: String,
    timeoutMs: Long,
    abandonOnTimeout: Boolean,
  ): String? {
    val pending = pendingStart
    val result: CompletableDeferred<String>
    val abandoned = AtomicBoolean(false)
    if (pending != null && pending.first === model && !pending.second.isCompleted) {
      Log.i(TAG, "Waiting for the start that is still running")
      result = pending.second
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
                supportImage = false,
                supportAudio = false,
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
      if (!abandonOnTimeout) pendingStart = model to result
    }
    val err = withTimeoutOrNull(timeoutMs) { result.await() }
    if (err == null) {
      if (abandonOnTimeout) {
        synchronized(abandoned) { abandoned.set(true) }
      }
      // It may have finished just before giving up.
      return if (model.instance != null) null else "timed out after ${timeoutMs / 1000} s"
    }
    if (pendingStart?.second === result) pendingStart = null
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

  /** Asks [text] in the open chat. [model] is the downloaded model to answer with, if any. */
  fun send(text: String, model: Model?) {
    val q = text.trim()
    if (q.isEmpty() || busy) return
    val history = turns.filter { it.failed != true && it.text.isNotBlank() }.toList()
    turns.add(ElricTurn(role = "user", text = q))
    replySavedMemory = rememberFrom(q)
    if (model == null || (model.instance == null && !modelFileComplete(model))) {
      // Never fake an answer: the chat shows that a (complete) model is needed.
      if (model != null) Log.w(TAG, "Model file for ${model.name} is incomplete")
      needsModel = true
      persist()
      return
    }
    needsModel = false
    busy = true
    stopRequested = false
    turns.add(ElricTurn(role = "model", text = "", memSaved = if (replySavedMemory) true else null))
    val replyIndex = turns.size - 1
    val system = systemPrompt()

    viewModelScope.launch {
      val loadError =
        try {
          ensureLoaded(model, system)
        } catch (e: CancellationException) {
          throw e
        } catch (t: Throwable) {
          t.message ?: "start failed"
        }
      if (loadError != null) {
        finishReply(replyIndex, ElricTurn(role = "model", text = T.startFailed.get(lang), failed = true))
        return@launch
      }
      if (stopRequested) {
        finishReply(replyIndex, ElricTurn(role = "model", text = T.stopped.get(lang), failed = true))
        return@launch
      }
      val seed = trimmedHistory(model, system, q, history)
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
                if (it.isUser) Message.user(Contents.of(it.text))
                else Message.model(Contents.of(it.text))
              },
            enableResponseFormat = false,
          )
        }
        syncedKey = key
      }
      runAnswer(model, system, seed, q, replyIndex)
    }
  }

  private fun runAnswer(
    model: Model,
    system: String,
    seed: List<ElricTurn>,
    q: String,
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
          turns[replyIndex] = turns[replyIndex].copy(text = cleanModelText(current()))
          streamTick++
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
            keyOf(system, seed + ElricTurn("user", q) + ElricTurn("model", text))
          } else {
            null
          }
        finishReply(replyIndex, turn)
      }
    }

    val extra =
      if (short) mapOf(EXTRA_CONTEXT_MAX_OUTPUT_TOKENS to SHORT_MAX_OUTPUT_TOKENS.toString())
      else emptyMap()
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
        images = listOf(),
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
    replySavedMemory = false
    busy = false
    streamTick++
    persist()
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

  override fun onCleared() {
    super.onCleared()
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
