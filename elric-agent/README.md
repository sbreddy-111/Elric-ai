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
POST `{ text, ui_lang?: "te"|"hi"|"en", prev?: {task, fields} }` with header `apikey: <publishable key>`.
Returns `{ task, lang, fields, missing, confirm_text }`.
- Tasks: `electricity_bill` (biller, service_number), `bus_search` (from, to, date YYYY-MM-DD), `pm_kisan_status` (aadhaar_or_mobile_last4), `unknown`.
- `prev` = last card, so a follow-up ("4455667") fills missing fields and keeps the rest.
- Model: Groq `openai/gpt-oss-20b` in JSON mode (secret `GROQ_API_KEY`), Gemini flash-lite backup (`GEMINI_API_KEY`).
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
- Mic uses the Web Speech API in the chosen language (te-IN / hi-IN / en-IN); the spoken words appear in the text box and send when you stop. If a browser has no speech support, only the mic hides.
- "Yes" on a power bill shows a **TEST — NOT REAL** sample bill (fake amount). Bus and PM-Kisan show "Coming soon".
- No payments, no Razorpay. Nothing saved in the browser. No model/provider names in the UI.

## Not done yet (next steps)
- Real bill fetch / payment, real bus search, real PM-Kisan lookup.
- Spoken reply (text-to-speech).
- Numbers said as words ("okati rendu…") are dropped as a safety rule unless the model turns them into the same digits the text has; typed digits work best.
