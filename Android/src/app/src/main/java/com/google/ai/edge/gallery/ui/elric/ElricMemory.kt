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

/** Most memory lines kept on the phone. */
const val ELRIC_MAX_MEMORIES = 20

/** Longest memory line. */
const val ELRIC_MEMORY_MAX_CHARS = 120

/** Most characters of memory put into the system prompt. */
const val ELRIC_MEMORY_PROMPT_CHARS = 400

/**
 * One short thing Elric remembers about the user. Stored only on the phone. [kind] groups lines
 * where only the newest one counts ("lang", "length", "name", "study"), or is empty.
 */
data class ElricMemory(val text: String, val kind: String = "", val at: Long = 0L)

/** What a message asks Elric to remember, if anything. [short] is set for answer-length lines. */
data class MemoryFind(val text: String, val kind: String, val short: Boolean? = null)

/**
 * Finds a memory in a user message with simple rules (no model call, so it is instant). Catches
 * "remember …" / "याद रखो …" and clear lasting preferences: answer length, answer language, what to
 * call the user, and their class.
 */
object ElricMemoryRules {
  private val opt = setOf(RegexOption.IGNORE_CASE)

  // "remember (that) X", "please remember: X", "note that X", "keep in mind that X", "yaad rakho X"
  private val rememberEn =
    Regex(
      "^(?:please\\s+|pls\\s+|also\\s+|and\\s+)?(?:remember|keep\\s+in\\s+mind|don'?t\\s+forget|never\\s+forget|yaad\\s+rakh(?:o|na|en|iye))(?:\\s+that)?\\s*[:,\\-–]?\\s+(.{3,})$",
      opt,
    )
  // "X, remember (this)" / "X yaad rakhna"
  private val rememberEnTail =
    Regex("^(.{3,}?)\\s*[,.;:\\-–]\\s*(?:please\\s+)?(?:remember(?:\\s+(?:this|that|it))?|yaad\\s+rakh(?:o|na|en|iye))[\\s.!]*$", opt)
  // "याद रखो (कि) X"
  private val rememberHiHead =
    Regex("^(?:कृपया\\s+)?(?:याद\\s+रख(?:ो|ना|ें|िए|िये|ियेगा|िएगा))\\s*[:,\\-–]?\\s*(?:कि\\s+)?(.{3,})$")
  // "X, याद रखो"
  private val rememberHiTail =
    Regex("^(.{3,}?)[\\s,।.;:\\-–]*(?:यह\\s+|ये\\s+|इसे\\s+)?(?:याद\\s+रख(?:ो|ना|ें|िए|िये|ियेगा|िएगा))[\\s।.!]*$")

  private val lengthNoun = Regex("\\b(?:answers|replies|responses|explanations)\\b|\\bto\\s+the\\s+point\\b", opt)
  private val lengthVerb = Regex("\\b(?:give|keep|make|write|want|prefer|like|use|be|always|from\\s+now)\\b", opt)
  private val shortWord = Regex("\\b(?:short|shorter|brief|concise|small)\\b|\\bto\\s+the\\s+point\\b", opt)
  private val longWord = Regex("\\b(?:detailed|long|longer|in\\s+detail|elaborate)\\b", opt)
  private val shortHi = Regex("(?:छोटे|छोटा|संक्षिप्त|कम\\s+शब्दों\\s+में)\\s*(?:में\\s*)?(?:जवाब|उत्तर)")
  private val longHi = Regex("(?:विस्तार\\s+से|लंबे|लम्बे|विस्तृत)\\s*(?:जवाब|उत्तर)?")
  private val hiGive = Regex("(?:दो|दें|दीजिए|दीजिये|देना|देना\\s+हमेशा|दिया\\s+करो|चाहिए|समझाया\\s+करो)")

  private val langEn =
    Regex(
      "\\b(?:always\\s+)?(?:answer|reply|respond|talk|speak|write|chat)\\s+(?:to\\s+me\\s+|with\\s+me\\s+)?(?:always\\s+|only\\s+)?in\\s+(hindi|english|hinglish)\\b|\\b(?:always\\s+)?use\\s+(hindi|english|hinglish)\\b|\\bi\\s+prefer\\s+(hindi|english|hinglish)\\b",
      opt,
    )
  private val langHi =
    Regex("(हिंदी|हिन्दी|अंग्रेज़ी|अंग्रेजी|इंग्लिश|english|hindi)\\s*में\\s*(?:ही\\s*)?(?:जवाब|उत्तर|बात)\\s*(?:दो|दें|दीजिए|दीजिये|देना|दिया\\s+करो|करो|करें|कीजिए)", opt)

  private val nameEn =
    Regex("\\b(?:call\\s+me|my\\s+name\\s+is|my\\s+name's)\\s+([\\p{L}][\\p{L}\\p{M}.'\\-]*(?:\\s+[\\p{L}][\\p{L}\\p{M}.'\\-]*){0,2})", opt)
  private val nameHi1 = Regex("मुझे\\s+([\\p{L}\\p{M}]+(?:\\s+[\\p{L}\\p{M}]+)?)\\s+(?:कहकर\\s+|नाम\\s+से\\s+)?(?:बुलाओ|बुलाइए|बुलाना|बुलाया\\s+करो|कहो|कहा\\s+करो)")
  private val nameHi2 = Regex("मेरा\\s+नाम\\s+([\\p{L}\\p{M}]+(?:\\s+[\\p{L}\\p{M}]+)?)\\s+है")
  private val nameStop = setOf("not", "is", "and", "the", "a", "what", "your", "when", "later", "back", "tomorrow", "now", "if", "at", "on", "nahi", "नहीं", "क्या")

  private val classEn1 =
    Regex("\\bi(?:'m|\\s+am)\\s+(?:in|studying\\s+in|a\\s+student\\s+of)\\s+(?:class|grade|std\\.?|standard)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b", opt)
  private val classEn2 =
    Regex("\\bi(?:'m|\\s+am)\\s+(?:in|studying\\s+in)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?!\\s*(?:year|yr|sem))\\s*(?:class|grade|std|standard)?\\b", opt)
  private val classHi = Regex("(?:मैं\\s+)?(?:कक्षा|क्लास)\\s*(\\d{1,2})\\s*(?:वीं|वी)?\\s*में\\s+(?:हूँ|हूं|पढ़ता|पढ़ती)|मैं\\s+(\\d{1,2})\\s*(?:वीं|वी)\\s*(?:कक्षा|क्लास)?\\s*में\\s+(?:हूँ|हूं|पढ़ता|पढ़ती)")

  /** The memory [message] asks for, or null. */
  fun find(message: String): MemoryFind? {
    val m = message.trim().replace(Regex("\\s+"), " ")
    if (m.length < 4 || m.length > 300) return null

    explicit(m)?.let { inner ->
      // "remember I'm in class 10" still becomes the tidy class line.
      return preference(inner) ?: MemoryFind(tidy(inner), "")
    }
    // Lasting preferences are only read from short messages, so a long question is not misread.
    if (m.length > 140) return null
    return preference(m)
  }

  private fun explicit(m: String): String? {
    if (m.endsWith("?")) return null
    val inner =
      rememberEn.find(m)?.groupValues?.get(1)
        ?: rememberHiHead.find(m)?.groupValues?.get(1)
        ?: rememberHiTail.find(m)?.groupValues?.get(1)
        ?: rememberEnTail.find(m)?.groupValues?.get(1)
        ?: return null
    val t = inner.trim().trim(',', '.', ':', ';', '-', '।', ' ')
    return t.takeIf { it.length >= 3 }
  }

  private fun preference(m: String): MemoryFind? {
    // Answer length.
    val hiShort = shortHi.containsMatchIn(m) && hiGive.containsMatchIn(m)
    val hiLong = !hiShort && longHi.containsMatchIn(m) && hiGive.containsMatchIn(m) &&
      Regex("जवाब|उत्तर|समझा").containsMatchIn(m)
    val enLen = lengthNoun.containsMatchIn(m) && lengthVerb.containsMatchIn(m)
    if (hiShort || (enLen && shortWord.containsMatchIn(m) && !longWord.containsMatchIn(m))) {
      return MemoryFind("Prefers short answers.", "length", short = true)
    }
    if (hiLong || (enLen && longWord.containsMatchIn(m) && !shortWord.containsMatchIn(m))) {
      return MemoryFind("Prefers detailed answers.", "length", short = false)
    }

    // Answer language.
    val lang =
      langEn.find(m)?.groupValues?.drop(1)?.firstOrNull { it.isNotEmpty() }
        ?: langHi.find(m)?.groupValues?.get(1)
    if (lang != null) {
      val l =
        when (lang.lowercase()) {
          "hindi", "हिंदी", "हिन्दी" -> "Hindi"
          "hinglish" -> "Hinglish (Hindi in English letters)"
          else -> "English"
        }
      return MemoryFind("Wants answers in $l.", "lang")
    }

    // What to call the user.
    val name =
      nameEn.find(m)?.groupValues?.get(1)
        ?: nameHi1.find(m)?.groupValues?.get(1)
        ?: nameHi2.find(m)?.groupValues?.get(1)
    if (name != null) {
      val words = name.trim().trim('.', ',', '\'', '-').split(' ').filter { it.isNotBlank() }
      val kept = words.takeWhile { it.lowercase() !in nameStop }
      if (kept.isNotEmpty()) {
        val n = kept.joinToString(" ") { w -> w.replaceFirstChar { it.uppercaseChar() } }.take(30)
        return MemoryFind("Call the user $n.", "name")
      }
    }

    // Class.
    val cls =
      classEn1.find(m)?.groupValues?.get(1)
        ?: classEn2.find(m)?.groupValues?.get(1)
        ?: classHi.find(m)?.groupValues?.drop(1)?.firstOrNull { it.isNotEmpty() }
    val n = cls?.toIntOrNull()
    if (n != null && n in 1..12) return MemoryFind("Studies in class $n.", "study")
    return null
  }

  private fun tidy(s: String): String {
    var t = s.trim()
    if (t.isNotEmpty() && t[0].isLowerCase()) t = t[0].uppercaseChar() + t.substring(1)
    if (t.length > ELRIC_MEMORY_MAX_CHARS) t = t.take(ELRIC_MEMORY_MAX_CHARS - 1).trimEnd() + "…"
    return t
  }

  /** Adds [f] to [list]: newest first, one line per kind, no duplicates, at most the max. */
  fun add(list: List<ElricMemory>, f: MemoryFind, now: Long): List<ElricMemory>? {
    val text = f.text.take(ELRIC_MEMORY_MAX_CHARS)
    if (list.any { it.text.equals(text, ignoreCase = true) }) return null
    val kept = list.filterNot { f.kind.isNotEmpty() && it.kind == f.kind }
    return (listOf(ElricMemory(text, f.kind, now)) + kept).take(ELRIC_MAX_MEMORIES)
  }

  /** The memory part of the system prompt, newest first, within [ELRIC_MEMORY_PROMPT_CHARS]. */
  fun promptBlock(list: List<ElricMemory>): String {
    if (list.isEmpty()) return ""
    val sb = StringBuilder()
    for (m in list.sortedByDescending { it.at }) {
      val line = m.text.trim().let { if (it.endsWith(".") || it.endsWith("।") || it.endsWith("…")) it else "$it." }
      if (sb.length + line.length + 1 > ELRIC_MEMORY_PROMPT_CHARS) continue
      if (sb.isNotEmpty()) sb.append(' ')
      sb.append(line)
    }
    if (sb.isEmpty()) return ""
    return " What you know about this user (follow it; it overrides the defaults above when they differ): $sb"
  }
}
