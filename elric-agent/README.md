# Elric Agent (prototype)

Voice task agent for Elric AI. Say a task in Telugu, Hindi, English or mixed; Elric Agent fills a task card and asks "Yes / Edit".
Separate page, **not linked from the Elric AI app**.

- Page: https://elricai.sbs/agent/ (gh-pages branch, folder `/agent/`)
- Function: Supabase Edge Function `ai-agent` (project `hqsqpiwmozgsxiizhaml`), `verify_jwt: false`

## Folders
- `function/index.ts` — the edge function.
- `page/` — the page (plain HTML/CSS/JS, no build step). Copy as-is to gh-pages `/agent/`.
- `run_tests.py` — runs 12 sample sentences against the live function and writes `TESTS.md`.

## Function
POST `{ text, ui_lang?: "te"|"hi"|"en" (default en), prev?: {task, fields, lang, script} }` with header `apikey: <publishable key>`.
Returns `{ task, lang, script, fields, missing, confirm_text }`. `lang` + `script` (native / latn) = how the user wrote; the page shows the card in that language.
- Language: Telugu or Devanagari script decides directly; romanised text is judged by the model (Tenglish → te, Hinglish → hi). A short follow-up with no language of its own ("APCPDCL 4455667") keeps the last turn's language.
- Ready-to-go and "which X?" sentences on follow-ups use fixed templates in 5 styles (en, te, hi, Tenglish, Hinglish), so the language never drifts.
- Bus: if only one city is given and the words say the direction ("Vijayawada jaana", "Hyderabad se", "to X"), the server puts it in the right field.
- Tasks: `electricity_bill` (biller, service_number), `bus_search` (from, to, date YYYY-MM-DD), `pm_kisan_status` (aadhaar_or_mobile_last4), `unknown`.
- `prev` = last card, so a follow-up ("4455667") fills missing fields and keeps the rest.
- Model: Groq `openai/gpt-oss-20b` in JSON mode (secret `GROQ_API_KEY`), Gemini flash-lite backup (`GEMINI_API_KEY`).
- Spoken numbers: digit words in English, Telugu, Hindi, Tenglish, Hinglish ("nine eight seven", "తొమ్మిది ఎనిమిది", "ek do teen", "double five") and Telugu/Devanagari digits become ASCII digits before anything else (only runs of 3+ digits, so "do teen din" stays).
- No invented values: the server drops a service number / last-4 that is not in the user's words, a biller not in the list, a bad date.
  When something is missing, the question comes from fixed sentences (Telugu, Hindi, English, Tenglish, Hinglish).
- Privacy: user text is never stored or logged (only status codes). Rate limit: 40/hour, 150/day per IP, via the shared
  `ai_usage_hit` RPC with a salted hash of the IP (key prefix `ag:`). No new tables.
- CORS: https://elricai.sbs, https://www.elricai.sbs, http://localhost, http://127.0.0.1 (any port).

Deploy:
```
cd function && curl -X POST "https://api.supabase.com/v1/projects/hqsqpiwmozgsxiizhaml/functions/deploy?slug=ai-agent" \
  -F 'metadata={"name":"ai-agent","entrypoint_path":"index.ts","verify_jwt":false};type=application/json' \
  -F "file=@index.ts;type=application/typescript"
```

## Page
- Chat screen: text box always visible with a mic button beside it. Typed and spoken messages go through the same path (same card, same follow-ups).
- Language: English by default (page text and mic en-IN). If the user types or speaks Telugu or Hindi (or Tenglish/Hinglish), the reply and the whole task card switch to that language by themselves; no picking needed.
- A small optional mic-language switch beside the mic (EN → తె → हि) only helps speech recognition; default EN. If a browser has no speech support, the mic and switch hide.
- "Yes" on a power bill shows a **TEST — NOT REAL** sample bill (fake amount). Bus and PM-Kisan show "Coming soon".
- No payments, no Razorpay. Nothing saved in the browser. No model/provider names in the UI.

## Not done yet (next steps)
- Real bill fetch / payment, real bus search, real PM-Kisan lookup.
- Spoken reply (text-to-speech).
- Numbers said as words ("okati rendu…") are dropped as a safety rule unless the model turns them into the same digits the text has; typed digits work best.
