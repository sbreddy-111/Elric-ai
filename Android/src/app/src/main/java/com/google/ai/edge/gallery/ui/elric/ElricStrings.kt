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
      "Study help with steps you can follow and check, online or offline.",
      "पढ़ाई की मदद, ऐसे स्टेप्स के साथ जिन्हें आप समझ और जाँच सकें, ऑनलाइन या ऑफ़लाइन।",
    )
  val ob2Title = Str("Private by default", "शुरू से प्राइवेट")
  val ob2Body =
    Str(
      "Chats are saved only on your phone. Online questions are sent to answer you, never sold. Offline mode keeps everything on your phone.",
      "चैट सिर्फ़ आपके फ़ोन पर सेव होती हैं। ऑनलाइन सवाल सिर्फ़ जवाब देने के लिए भेजे जाते हैं, कभी बेचे नहीं जाते। ऑफ़लाइन मोड में सब कुछ फ़ोन पर रहता है।",
    )
  val ob3Title = Str("Hindi & English", "हिन्दी और English")
  val ob3Body =
    Str(
      "Pick the language you think in. You can switch any time.",
      "वह भाषा चुनें जिसमें आप सोचते हैं। आप कभी भी बदल सकते हैं।",
    )

  // Welcome (first launch): one short dialog over the chat.
  val welcomeTitle = Str("Welcome to Elric AI", "Elric AI में आपका स्वागत है")
  val welcomePrivacy =
    Str(
      "Chats stay on your phone. Online questions are sent to our server only to answer you.",
      "चैट आपके फ़ोन पर ही रहती हैं। ऑनलाइन सवाल सिर्फ़ जवाब देने के लिए हमारे सर्वर पर जाते हैं।",
    )
  val welcomeAge =
    Str(
      "Online answers are for users 18+. By tapping Continue you confirm you're 18 or older.",
      "ऑनलाइन जवाब 18+ उम्र वालों के लिए हैं। Continue दबाकर आप पुष्टि करते हैं कि आपकी उम्र 18 या ज़्यादा है।",
    )
  val welcomeContinue = Str("Continue", "Continue")
  val welcomeUnder18 = Str("Under 18? Use offline mode", "18 से कम? ऑफ़लाइन मोड इस्तेमाल करें")
  val offlineTip =
    Str(
      "Tip: turn on Offline mode in ☰ to use without internet.",
      "सुझाव: बिना इंटरनेट इस्तेमाल के लिए ☰ में ऑफ़लाइन मोड चालू करें।",
    )

  // Offline mode
  val offlineMode = Str("Offline mode", "ऑफ़लाइन मोड")
  val offlineMenu = Str("Offline mode — works without internet", "ऑफ़लाइन मोड — बिना इंटरनेट चलता है")
  val offlineHow = Str("One-time download · about {size}", "एक बार डाउनलोड · लगभग {size}")
  val offlineReadyCap = Str("Ready on your phone", "आपके फ़ोन पर तैयार")
  val offlineDownloadingPct = Str("Downloading… {pct}% · tap to see", "डाउनलोड हो रहा है… {pct}% · देखने के लिए दबाएँ")
  val offlineDlTitle = Str("Turn on Offline mode?", "ऑफ़लाइन मोड चालू करें?")
  val offlineDlBody =
    Str(
      "Elric AI will download its offline model (about {size}) so it can answer without internet.",
      "Elric AI अपना ऑफ़लाइन मॉडल (लगभग {size}) डाउनलोड करेगा, ताकि बिना इंटरनेट जवाब दे सके।",
    )
  val offlineWifi =
    Str("Use Wi‑Fi if you can. It downloads once.", "हो सके तो Wi‑Fi इस्तेमाल करें। यह एक ही बार डाउनलोड होता है।")
  val offlineReadyMsg =
    Str("Offline mode is ready. Elric AI can now answer without internet.", "ऑफ़लाइन मोड तैयार है। अब Elric AI बिना इंटरनेट जवाब दे सकता है।")
  val offlineOnToast = Str("Offline mode on", "ऑफ़लाइन मोड चालू")
  val cancelDownload = Str("Cancel download", "डाउनलोड रद्द करें")
  val hide = Str("Hide", "छिपाएँ")
  val offlineOffTitle = Str("Offline mode off", "ऑफ़लाइन मोड बंद")
  val offlineOffBody =
    Str(
      "Elric AI will answer online only. Keep the offline model ({size}) on your phone for later, or delete it to free space.",
      "Elric AI सिर्फ़ ऑनलाइन जवाब देगा। ऑफ़लाइन मॉडल ({size}) बाद के लिए फ़ोन पर रखें, या जगह खाली करने के लिए मिटा दें।",
    )
  val keep = Str("Keep", "रखें")
  val deleteModel = Str("Delete offline model", "ऑफ़लाइन मॉडल मिटाएँ")
  val needNoNet =
    Str(
      "No internet. Download the offline model to use Elric AI without internet.",
      "इंटरनेट नहीं है। बिना इंटरनेट Elric AI इस्तेमाल करने के लिए ऑफ़लाइन मॉडल डाउनलोड करें।",
    )
  val needLimit =
    Str(
      "Online answers aren't available right now. Download the offline model to keep using Elric AI.",
      "ऑनलाइन जवाब अभी उपलब्ध नहीं हैं। Elric AI इस्तेमाल करते रहने के लिए ऑफ़लाइन मॉडल डाउनलोड करें।",
    )
  val needOffline =
    Str(
      "Download the offline model to get answers on your phone.",
      "फ़ोन पर जवाब पाने के लिए ऑफ़लाइन मॉडल डाउनलोड करें।",
    )
  val needTurnOnOffline =
    Str(
      "Turn on Offline mode to answer on your phone without internet.",
      "बिना इंटरनेट फ़ोन पर जवाब पाने के लिए ऑफ़लाइन मोड चालू करें।",
    )
  val downloadOfflineModel = Str("Download offline model", "ऑफ़लाइन मॉडल डाउनलोड करें")
  val turnOnOffline = Str("Turn on Offline mode", "ऑफ़लाइन मोड चालू करें")
  val offlineNoNetHome =
    Str(
      "You're offline. Turn on Offline mode in the menu to use Elric AI without internet.",
      "आप ऑफ़लाइन हैं। बिना इंटरनेट Elric AI इस्तेमाल करने के लिए मेनू में ऑफ़लाइन मोड चालू करें।",
    )
  val onlineOnlyPill = Str("● Online", "● ऑनलाइन")

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
  val onlinePill = Str("● Online · phone backup", "● ऑनलाइन · फ़ोन बैकअप")
  val shopOffline = Str("● Shopping · offline", "● शॉपिंग · ऑफ़लाइन")
  val livePricesSoon = Str("Live prices coming soon", "लाइव कीमतें जल्द आ रही हैं")
  val offlineStudy = Str("You're offline. Study still works.", "आप ऑफ़लाइन हैं। पढ़ाई फिर भी चलेगी।")
  val offlineAll = Str("You're offline. Elric still works.", "आप ऑफ़लाइन हैं। Elric फिर भी चलेगा।")
  val sugQuiz = Str("Quiz me on a chapter", "किसी चैप्टर पर मेरा क्विज़ लें")
  val sugPhoto = Str("Explain a homework photo", "होमवर्क की फ़ोटो समझाएँ")
  val sugTimetable = Str("Make a study timetable", "पढ़ाई का टाइमटेबल बनाएँ")
  val sugWatch = Str("Compare watches under ₹5,000", "₹5,000 से कम की घड़ियों की तुलना करें")
  val askAnything = Str("Ask anything…", "कुछ भी पूछें…")
  val listening = Str("Listening… {t} / 0:30", "सुन रहा है… {t} / 0:30")
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
      "To answer without internet, Elric needs its model on your phone.",
      "बिना इंटरनेट जवाब देने के लिए Elric का मॉडल आपके फ़ोन पर होना चाहिए।",
    )
  val onlineUnavailable =
    Str(
      "Online answers aren't available right now. Download a model to answer on your phone.",
      "ऑनलाइन जवाब अभी उपलब्ध नहीं हैं। फ़ोन पर जवाब पाने के लिए एक मॉडल डाउनलोड करें।",
    )
  val tagOnline = Str("Online", "ऑनलाइन")
  val tagOffline = Str("Offline", "ऑफ़लाइन")
  val openModels = Str("Open Models", "मॉडल खोलें")
  val scrollLatest = Str("Scroll to latest", "नए मैसेज पर जाएँ")

  // Mode sheet
  val modeSec = Str("Mode", "मोड")
  val study = Str("Study", "पढ़ाई")
  val shopping = Str("Shopping", "शॉपिंग")
  val general = Str("General", "सामान्य")
  val studyDesc = Str("Step-by-step tutor for school and college", "स्कूल और कॉलेज के लिए स्टेप-बाय-स्टेप ट्यूटर")
  val shoppingDesc = Str("Compare products", "प्रोडक्ट्स की तुलना")
  val generalDesc = Str("Anything else", "बाकी सब कुछ")
  val lengthSec = Str("Answer length", "जवाब की लंबाई")
  val short = Str("Short · fast", "छोटा · तेज़")
  val detailed = Str("Detailed", "विस्तार से")
  val done = Str("Done", "हो गया")

  // Camera sheet
  val takePhoto = Str("Take photo", "फ़ोटो लें")
  val chooseGallery = Str("Choose from gallery", "गैलरी से चुनें")
  val photoPrivate =
    Str(
      "Voice is turned into text on your phone. Photos stay on your phone, except when Online answers are on: then the photo is sent to answer you.",
      "आवाज़ आपके फ़ोन पर ही टेक्स्ट बनती है। फ़ोटो फ़ोन पर रहती हैं, सिर्फ़ ऑनलाइन जवाब चालू होने पर फ़ोटो जवाब के लिए भेजी जाती है।",
    )
  val photoDefault = Str("Explain this photo.", "इस फ़ोटो को समझाइए।")
  val removePhoto = Str("Remove photo", "फ़ोटो हटाएँ")
  val photoFailed =
    Str("Couldn't open this photo. Try another one.", "यह फ़ोटो खुल नहीं पाई। कोई दूसरी फ़ोटो आज़माएँ।")
  val photoUnsupported =
    Str(
      "Photos can't run on this phone yet. Text questions still work.",
      "इस फ़ोन पर अभी फ़ोटो नहीं चल सकतीं। लिखकर सवाल पूछना चलता रहेगा।",
    )
  val cameraNeeded = Str("Allow the camera to take a photo", "फ़ोटो लेने के लिए कैमरे की अनुमति दें")
  val mediaFirstHint =
    Str(
      "Getting photo and voice ready. The first time can take a minute or two.",
      "फ़ोटो और आवाज़ तैयार हो रही है। पहली बार में एक-दो मिनट लग सकते हैं।",
    )

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
  val memory = Str("Memory", "मेमोरी")
  val onlineAnswers = Str("Online answers", "ऑनलाइन जवाब")
  val onlineHow = Str("Smarter answers with internet · 18+", "इंटरनेट से बेहतर जवाब · 18+")
  // Drawer + profile (mirrors the web app).
  val recents = Str("Recents", "हाल की चैट")
  val photoQuestion = Str("Photo question", "फ़ोटो से सवाल")
  val profile = Str("Profile", "प्रोफ़ाइल")
  val addName = Str("Add your name", "अपना नाम जोड़ें")
  val secPersonalise = Str("Personalise", "आपके हिसाब से")
  val secAI = Str("AI", "AI")
  val secPrivacy = Str("Privacy & data", "प्राइवेसी और डेटा")
  val secAbout = Str("About", "जानकारी")
  val age = Str("Age", "उम्र")
  val ageYes = Str("18 or older", "18 या ज़्यादा")
  val ageNo = Str("Not confirmed", "पुष्टि नहीं")
  val clearChats = Str("Clear all chats", "सारी चैट मिटाएँ")
  val clearChatsConfirm =
    Str("Delete all saved chats on this phone? This can't be undone.", "इस फ़ोन की सारी सेव चैट मिटाएँ? यह वापस नहीं होगा।")
  val version = Str("Version", "वर्शन")
  val close = Str("Close", "बंद करें")
  val noMatches = Str("No matching chats.", "कोई मिलती चैट नहीं।")
  val age18Text =
    Str(
      "Online answers are for users 18 or older. Questions are sent to our server and an AI provider.",
      "ऑनलाइन जवाब 18 साल या उससे ज़्यादा उम्र वालों के लिए हैं। सवाल हमारे सर्वर और एक AI प्रदाता को भेजे जाते हैं।",
    )
  val age18Yes = Str("I'm 18 or older", "मेरी उम्र 18 या ज़्यादा है")
  val notNow = Str("Not now", "अभी नहीं")
  val on = Str("On", "चालू")
  val off = Str("Off", "बंद")
  val chatOnlineNow = Str("Chat online while it downloads", "डाउनलोड होने तक ऑनलाइन चैट करें")

  // Memory screen
  val memoryOnly = Str("Saved only on this phone.", "सिर्फ़ इसी फ़ोन पर सेव होता है।")
  val memorySwitch = Str("Remember things I tell Elric", "जो मैं बताऊँ, Elric याद रखे")
  val memoryHow =
    Str(
      "Say \"remember …\" or a lasting preference like \"give short answers\" or \"call me Ravi\".",
      "\"याद रखो …\" कहें या कोई पक्की पसंद बताएँ, जैसे \"छोटे जवाब दो\" या \"मुझे रवि बुलाओ\"।",
    )
  val memoryEmpty = Str("Nothing saved yet.", "अभी कुछ सेव नहीं है।")
  val memoryOff = Str("Memory is off. Nothing new is saved or used.", "मेमोरी बंद है। न कुछ नया सेव होगा, न इस्तेमाल होगा।")
  val clearAll = Str("Clear all", "सब मिटाएँ")
  val clearAllConfirm =
    Str("Delete everything Elric remembers about you?", "Elric को आपके बारे में जो याद है, वह सब मिटाएँ?")
  val savedToMemory = Str("✓ Saved to memory", "✓ मेमोरी में सेव हो गया")
  val aboutElric = Str("About Elric AI", "Elric AI के बारे में")
  val licenses = Str("Open-source licenses", "ओपन-सोर्स लाइसेंस")
  val aboutLine = Str("v{v} · Online or on your phone, private by default", "v{v} · ऑनलाइन या आपके फ़ोन पर, शुरू से प्राइवेट")

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
  val privacyTitle = Str("Your chats are saved only on this phone", "आपकी चैट सिर्फ़ इसी फ़ोन पर सेव होती हैं")
  val privacy1 = Str("With Offline mode on, answers work without internet", "ऑफ़लाइन मोड चालू होने पर जवाब बिना इंटरनेट मिलते हैं")
  val privacy2 =
    Str(
      "With Online answers on, your question, recent messages of the chat, any photo you attach and the memory used for it are sent to our server and an AI provider to answer. We don't store them.",
      "ऑनलाइन जवाब चालू होने पर आपका सवाल, चैट के हाल के मैसेज, जोड़ी गई फ़ोटो और उसके लिए इस्तेमाल हुई मेमोरी जवाब के लिए हमारे सर्वर और एक AI प्रोवाइडर को भेजी जाती है। हम इन्हें सेव नहीं करते।",
    )
  val privacyOffline =
    Str(
      "Offline answers keep everything on your phone. Turn on Offline mode and turn off Online answers in the menu to stay fully offline.",
      "ऑफ़लाइन जवाब में सब कुछ आपके फ़ोन पर रहता है। पूरी तरह ऑफ़लाइन रहने के लिए मेनू में ऑफ़लाइन मोड चालू और ऑनलाइन जवाब बंद करें।",
    )
  val privacy3 =
    Str("Live prices are coming soon.", "लाइव कीमतें जल्द आ रही हैं।")
  val privacy4 =
    Str(
      "Feedback and error reports are optional and off by default. They are stored on our server (Supabase), which may be outside India.",
      "फ़ीडबैक और एरर रिपोर्ट आपकी मर्ज़ी पर हैं और शुरू में बंद रहती हैं। ये हमारे सर्वर (Supabase) पर रखी जाती हैं, जो भारत से बाहर हो सकता है।",
    )
  val privacy5 =
    Str(
      "When online, Elric downloads a short list of facts (at most once a day) to answer more reliably. Nothing about you is sent.",
      "इंटरनेट होने पर Elric तथ्यों की एक छोटी सूची (दिन में ज़्यादा से ज़्यादा एक बार) डाउनलोड करता है, ताकि जवाब और भरोसेमंद हों। आपके बारे में कुछ नहीं भेजा जाता।",
    )
  val reportsSwitch = Str("Send error reports", "एरर रिपोर्ट भेजें")
  val reportsHow =
    Str(
      "If Elric crashes or gets stuck loading, send the app version, phone model, Android version and model name. Never your chats.",
      "अगर Elric क्रैश हो या लोड होते हुए अटक जाए, तो ऐप वर्ज़न, फ़ोन मॉडल, Android वर्ज़न और मॉडल का नाम भेजें। आपकी चैट कभी नहीं।",
    )
  val reportsAskTitle = Str("Help make Elric more reliable?", "Elric को और भरोसेमंद बनाने में मदद करें?")
  val reportsAskBody =
    Str(
      "Send error reports when Elric crashes or gets stuck. Only app and phone details, never your chats. You can change this in Privacy.",
      "Elric क्रैश हो या अटके तो एरर रिपोर्ट भेजें। सिर्फ़ ऐप और फ़ोन की जानकारी, आपकी चैट कभी नहीं। इसे आप प्राइवेसी में बदल सकते हैं।",
    )
  val yesSend = Str("Yes, send", "हाँ, भेजें")
  val noThanks = Str("No thanks", "नहीं, धन्यवाद")

  // Feedback sheet
  val fbTitle = Str("What went wrong?", "क्या गड़बड़ थी?")
  val fbWrong = Str("Wrong answer", "गलत जवाब")
  val fbNotHelpful = Str("Not helpful", "मददगार नहीं")
  val fbNote = Str("Add a note (optional)", "कुछ लिखें (वैकल्पिक)")
  val fbInclude = Str("Include this question and answer", "यह सवाल और जवाब भी भेजें")
  val fbOnlySend =
    Str(
      "Sent only when you tap Send. Your other chats stay on this phone.",
      "सिर्फ़ भेजें दबाने पर जाता है। आपकी बाकी चैट इसी फ़ोन पर रहती हैं।",
    )
  val fbThanks = Str("Thanks — this helps Elric improve.", "धन्यवाद — इससे Elric बेहतर होता है।")
  val fbFailed =
    Str("Couldn't send. Check your internet and try again.", "भेज नहीं पाए। इंटरनेट देखकर फिर से कोशिश करें।")

  // Voice / misc
  val voiceUnavailable = Str("Couldn't use the microphone. Try again.", "माइक इस्तेमाल नहीं हो पाया। फिर से कोशिश करें।")
  val voicePreparing = Str("Getting voice ready… {s} s", "आवाज़ तैयार हो रही है… {s} s")
  val voiceWorking = Str("Turning speech into text…", "आवाज़ को टेक्स्ट में बदल रहे हैं…")
  val voiceCheck = Str("Check the text, then tap send", "टेक्स्ट देख लें, फिर भेजें दबाएँ")
  val voiceNothing =
    Str("Didn't catch that. Speak a little louder and try again.", "सुनाई नहीं दिया। थोड़ा ज़ोर से बोलकर फिर कोशिश करें।")
  val voiceNeedModel =
    Str("Voice is turned into text on your phone. Download the offline model to ask by voice.", "आवाज़ फ़ोन पर ही टेक्स्ट बनती है। बोलकर पूछने के लिए ऑफ़लाइन मॉडल डाउनलोड करें।")
  val voiceUnsupported =
    Str(
      "Voice can't run on this phone yet. Typing still works.",
      "इस फ़ोन पर अभी आवाज़ से पूछना नहीं चल सकता। लिखकर पूछना चलता रहेगा।",
    )
  val voiceFailed =
    Str("Couldn't turn your voice into text. Try again.", "आपकी आवाज़ को टेक्स्ट में नहीं बदल पाए। फिर से कोशिश करें।")
  val photo = Str("Photo", "फ़ोटो")

  // Talk (hands-free conversation)
  val talk = Str("Talk", "बातचीत")
  val talkListening = Str("Listening…", "सुन रहा है…")
  val talkPreparing =
    Str("Getting voice ready… The first time can take a minute.", "आवाज़ तैयार हो रही है… पहली बार में एक मिनट लग सकता है।")
  val talkThinking = Str("Thinking…", "सोच रहा है…")
  val talkSpeaking = Str("Speaking · tap to interrupt", "बोल रहा है · रोकने के लिए दबाएँ")
  val talkPaused = Str("Tap the circle to speak", "बोलने के लिए गोले को दबाएँ")
  val talkMutedLabel = Str("Microphone off", "माइक बंद है")
  val talkMute = Str("Mute", "म्यूट")
  val talkUnmute = Str("Unmute", "अनम्यूट")
  val talkEnd = Str("End", "बंद करें")
  val talkWait = Str("Wait for the answer to finish", "जवाब पूरा होने दें")
  val talkFailed = Str("Couldn't answer that. Tap to try again.", "इसका जवाब नहीं दे पाए। फिर से कोशिश करने के लिए दबाएँ।")
  val talkNoVoice =
    Str(
      "This phone can't read answers aloud. Answers are in the chat.",
      "यह फ़ोन जवाब पढ़कर नहीं सुना सकता। जवाब चैट में हैं।",
    )
  val talkHint =
    Str(
      "Speak in Hindi or English. Your voice is turned into text on your phone.",
      "हिन्दी या English में बोलें। आपकी आवाज़ फ़ोन पर ही टेक्स्ट बनती है।",
    )
  val cancelVoice = Str("Cancel", "रद्द करें")
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
