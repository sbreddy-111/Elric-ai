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

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** The two languages Elric AI speaks. Switchable in the app, independent of the phone language. */
enum class ElricLang(val code: String) {
  EN("en"),
  HI("hi");

  companion object {
    fun fromCode(code: String?): ElricLang = if (code == "hi") HI else EN
  }
}

val LocalElricLang = staticCompositionLocalOf { ElricLang.EN }

/** One UI string in English and Hindi. */
class Str(val en: String, val hi: String) {
  fun get(lang: ElricLang): String = if (lang == ElricLang.HI) hi else en

  fun format(lang: ElricLang, vararg pairs: Pair<String, String>): String {
    var s = get(lang)
    for ((k, v) in pairs) s = s.replace("{$k}", v)
    return s
  }
}

@Composable @ReadOnlyComposable fun tr(s: Str): String = s.get(LocalElricLang.current)

@Composable
@ReadOnlyComposable
fun tr(s: Str, vararg pairs: Pair<String, String>): String = s.format(LocalElricLang.current, *pairs)

/** All Elric UI text. Model names are Elric names only. */
object T {
  val brand = Str("Elric AI", "Elric AI")
  val tagline = Str("AI you can rely on", "ऐसा AI जिस पर भरोसा कर सकें")
  val reliable = Str("Reliable answers. Private by default.", "भरोसेमंद जवाब। आपकी प्राइवेसी सुरक्षित।")

  // Onboarding
  val skip = Str("Skip", "छोड़ें")
  val next = Str("Next", "आगे")
  val getStarted = Str("Get started", "शुरू करें")
  val ob1Title = Str("Answers you can trust", "ऐसे जवाब जिन पर भरोसा हो")
  val ob1Body =
    Str(
      "Study help that works offline, with steps you can follow and check.",
      "ऑफ़लाइन चलने वाली पढ़ाई की मदद, ऐसे स्टेप्स के साथ जिन्हें आप समझ और जाँच सकें।",
    )
  val ob2Title = Str("Private by default", "शुरू से प्राइवेट")
  val ob2Body =
    Str(
      "Chats never leave your phone. Nothing is uploaded, nothing is sold.",
      "चैट आपके फ़ोन से बाहर नहीं जातीं। न कुछ अपलोड होता है, न कुछ बेचा जाता है।",
    )
  val ob3Title = Str("Hindi & English", "हिन्दी और English")
  val ob3Body =
    Str(
      "Pick the language you think in. You can switch any time.",
      "वह भाषा चुनें जिसमें आप सोचते हैं। आप कभी भी बदल सकते हैं।",
    )

  // About you
  val aboutName = Str("What should Elric call you?", "Elric आपको किस नाम से बुलाए?")
  val aboutNameHint = Str("Your name", "आपका नाम")
  val aboutStudy = Str("What do you study?", "आप क्या पढ़ते हैं?")
  val stays = Str("Stays only on this phone.", "यह सिर्फ़ इसी फ़ोन पर रहता है।")
  val cont = Str("Continue", "आगे बढ़ें")
  val save = Str("Save", "सेव करें")
  val study68 = Str("Class 6–8", "कक्षा 6–8")
  val study910 = Str("Class 9–10", "कक्षा 9–10")
  val study1112 = Str("Class 11–12", "कक्षा 11–12")
  val studyCollege = Str("College", "कॉलेज")
  val studyExams = Str("Competitive exams", "प्रतियोगी परीक्षाएँ")

  // Download
  val dlTitle = Str("Download a model", "एक मॉडल डाउनलोड करें")
  val dlSub = Str("One download, then Elric runs on your phone.", "एक बार डाउनलोड करें, फिर Elric आपके फ़ोन पर चलेगा।")
  val liteDesc = Str("Fast, works offline. Best for most phones.", "तेज़, ऑफ़लाइन चलता है। ज़्यादातर फ़ोन के लिए सबसे अच्छा।")
  val standardDesc = Str("Smarter, needs a powerful phone.", "ज़्यादा समझदार, दमदार फ़ोन चाहिए।")
  val liteShort = Str("Fast, works offline", "तेज़, ऑफ़लाइन चलता है")
  val standardShort = Str("Smarter, needs a powerful phone", "ज़्यादा समझदार, दमदार फ़ोन चाहिए")
  val wifiTip = Str("Use Wi‑Fi. Download once, use offline forever.", "Wi‑Fi इस्तेमाल करें। एक बार डाउनलोड करें, फिर हमेशा ऑफ़लाइन चलाएँ।")
  val download = Str("Download", "डाउनलोड करें")
  val downloading = Str("Downloading…", "डाउनलोड हो रहा है…")
  val ofGb = Str("{done} of {total}", "{total} में से {done}")
  val ready = Str("Ready ✓", "तैयार ✓")
  val dlFailed =
    Str(
      "Download stopped. Check your internet and try again.",
      "डाउनलोड रुक गया। इंटरनेट जाँचें और फिर कोशिश करें।",
    )
  val retry = Str("Try again", "फिर कोशिश करें")
  val resume = Str("Resume download", "डाउनलोड जारी रखें")
  val gettingReady = Str("Getting the model list…", "मॉडल की सूची आ रही है…")
  val listFailed =
    Str(
      "Couldn't get the model list. Connect to the internet and try again.",
      "मॉडल की सूची नहीं मिली। इंटरनेट से जुड़ें और फिर कोशिश करें।",
    )
  val needsAccess =
    Str(
      "This download needs sign-in, which Elric doesn't support yet.",
      "इस डाउनलोड के लिए साइन-इन चाहिए, जो Elric में अभी नहीं है।",
    )

  // Home
  val hello = Str("Hello, ", "नमस्ते, ")
  val there = Str("there", "दोस्त")
  val onDevice = Str("● On‑device · private", "● फ़ोन पर · प्राइवेट")
  val shopOffline = Str("● Shopping · offline", "● शॉपिंग · ऑफ़लाइन")
  val livePricesSoon = Str("Live prices coming soon", "लाइव कीमतें जल्द आ रही हैं")
  val offlineStudy = Str("You're offline. Study still works.", "आप ऑफ़लाइन हैं। पढ़ाई फिर भी चलेगी।")
  val offlineAll = Str("You're offline. Elric still works.", "आप ऑफ़लाइन हैं। Elric फिर भी चलेगा।")
  val sugQuiz = Str("Quiz me on a chapter", "किसी चैप्टर पर मेरा क्विज़ लें")
  val sugPhoto = Str("Explain a homework photo", "होमवर्क की फ़ोटो समझाएँ")
  val sugTimetable = Str("Make a study timetable", "पढ़ाई का टाइमटेबल बनाएँ")
  val sugWatch = Str("Compare watches under ₹5,000", "₹5,000 से कम की घड़ियों की तुलना करें")
  val askAnything = Str("Ask anything…", "कुछ भी पूछें…")
  val listening = Str("Listening… Hindi or English", "सुन रहा है… हिन्दी या English")
  val tapToStop = Str("Tap to stop", "रोकने के लिए दबाएँ")

  // Chat
  val edit = Str("✎ Edit", "✎ बदलें")
  val copied = Str("Copied", "कॉपी हो गया")
  val readingAloud = Str("Reading aloud", "पढ़कर सुना रहा है")
  val giveExample = Str("Give an example", "एक उदाहरण दें")
  val quizMe = Str("Quiz me", "मेरा क्विज़ लें")
  val explainHindi = Str("Explain in Hindi", "हिन्दी में समझाएँ")
  val explainEnglish = Str("Explain in English", "English में समझाएँ")
  val statTime = Str("⏱ {s} s", "⏱ {s} सेकंड")
  val statFirst = Str("first word {s} s", "पहला शब्द {s} सेकंड")
  val statSpeed = Str("{n} words/sec", "{n} शब्द/सेकंड")
  val stopped = Str("(stopped)", "(रोक दिया गया)")
  val errorAnswer = Str("Something went wrong while answering. {err}", "जवाब देते समय कुछ गड़बड़ हुई। {err}")
  val starting = Str("Elric is getting ready… {s} s", "Elric तैयार हो रहा है… {s} सेकंड")
  val firstStartHint =
    Str("First start can take up to a minute.", "पहली बार शुरू होने में एक मिनट तक लग सकता है।")
  val startFailed =
    Str(
      "Elric couldn't start on this phone. Try closing other apps and tap Retry.",
      "Elric इस फ़ोन पर शुरू नहीं हो सका। दूसरे ऐप बंद करें और फिर से कोशिश करें दबाएँ।",
    )
  val retryShort = Str("Retry", "फिर से कोशिश करें")
  val needModelTitle = Str("Download a model to get answers", "जवाब पाने के लिए एक मॉडल डाउनलोड करें")
  val needModelBody =
    Str(
      "Answers are made on your phone, so Elric needs its model first. Nothing was sent anywhere.",
      "जवाब आपके फ़ोन पर बनते हैं, इसलिए पहले Elric का मॉडल चाहिए। कुछ भी कहीं नहीं भेजा गया।",
    )
  val openModels = Str("Open Models", "मॉडल खोलें")
  val scrollLatest = Str("Scroll to latest", "नए मैसेज पर जाएँ")

  // Mode sheet
  val modeSec = Str("Mode", "मोड")
  val study = Str("Study", "पढ़ाई")
  val shopping = Str("Shopping", "शॉपिंग")
  val general = Str("General", "सामान्य")
  val studyDesc = Str("Step-by-step tutor for school and college", "स्कूल और कॉलेज के लिए स्टेप-बाय-स्टेप ट्यूटर")
  val shoppingDesc = Str("Compare products · works offline", "प्रोडक्ट्स की तुलना · ऑफ़लाइन चलता है")
  val generalDesc = Str("Anything else", "बाकी सब कुछ")
  val lengthSec = Str("Answer length", "जवाब की लंबाई")
  val short = Str("Short · fast", "छोटा · तेज़")
  val detailed = Str("Detailed", "विस्तार से")
  val done = Str("Done", "हो गया")

  // Camera sheet
  val takePhoto = Str("Take photo", "फ़ोटो लें")
  val chooseGallery = Str("Choose from gallery", "गैलरी से चुनें")
  val photoSoon = Str("Photo help coming soon", "फ़ोटो से मदद जल्द आ रही है")

  // Drawer
  val searchChats = Str("Search chats", "चैट खोजें")
  val recentChats = Str("Recent chats", "पिछली चैट")
  val noChats = Str("No saved chats yet.", "अभी कोई सेव चैट नहीं।")
  val today = Str("Today", "आज")
  val yesterday = Str("Yesterday", "कल")
  val earlier = Str("Earlier", "पहले")
  val rename = Str("Rename", "नाम बदलें")
  val delete = Str("Delete", "मिटाएँ")
  val chatName = Str("Chat name", "चैट का नाम")
  val moreOptions = Str("More options", "और विकल्प")
  val aboutYou = Str("About you", "आपके बारे में")
  val models = Str("Models", "मॉडल")
  val language = Str("Language", "भाषा")
  val appearance = Str("Appearance", "थीम")
  val dark = Str("Dark", "डार्क")
  val light = Str("Light", "लाइट")
  val privacy = Str("Privacy", "प्राइवेसी")
  val aboutElric = Str("About Elric AI", "Elric AI के बारे में")
  val licenses = Str("Open-source licenses", "ओपन-सोर्स लाइसेंस")
  val aboutLine = Str("v{v} · Runs on your phone, private by default", "v{v} · आपके फ़ोन पर चलता है, शुरू से प्राइवेट")

  // Models screen
  val installed = Str("Installed ✓ · {size}", "इंस्टॉल ✓ · {size}")
  val inUse = Str("In use", "चालू")
  val useThis = Str("Use", "चलाएँ")
  val remove = Str("Remove", "हटाएँ")
  val removeConfirm =
    Str(
      "Remove {name} from this phone? You can download it again later.",
      "{name} को इस फ़ोन से हटाएँ? आप इसे बाद में फिर डाउनलोड कर सकते हैं।",
    )
  val cancel = Str("Cancel", "रद्द करें")
  val storage = Str("Storage", "स्टोरेज")
  val storageUsed = Str("{used} used of {total}", "{total} में से {used} इस्तेमाल")

  // Privacy
  val privacyTitle = Str("Your chats stay on this phone", "आपकी चैट इसी फ़ोन पर रहती हैं")
  val privacy1 = Str("Study answers work offline", "पढ़ाई के जवाब ऑफ़लाइन मिलते हैं")
  val privacy2 = Str("Nothing you type is sent anywhere", "आप जो लिखते हैं वह कहीं नहीं भेजा जाता")
  val privacy3 =
    Str(
      "Live prices are coming soon. Today everything runs on your phone.",
      "लाइव कीमतें जल्द आ रही हैं। अभी सब कुछ आपके फ़ोन पर ही चलता है।",
    )

  // Voice / misc
  val voiceUnavailable = Str("Voice input isn't available on this phone", "इस फ़ोन पर बोलकर पूछना उपलब्ध नहीं है")
  val micNeeded = Str("Allow the microphone to ask by voice", "बोलकर पूछने के लिए माइक की अनुमति दें")
  val back = Str("Back", "वापस")
  val menu = Str("Menu", "मेन्यू")
  val newChat = Str("New chat", "नई चैट")
  val camera = Str("Camera", "कैमरा")
  val voice = Str("Voice", "आवाज़")
  val send = Str("Send", "भेजें")
  val stop = Str("Stop", "रोकें")
  val copy = Str("Copy", "कॉपी करें")
  val readAloud = Str("Read aloud", "पढ़कर सुनाएँ")
  val regenerate = Str("Regenerate", "फिर से जवाब दें")
  val goodAnswer = Str("Good answer", "अच्छा जवाब")
  val badAnswer = Str("Bad answer", "खराब जवाब")
}
