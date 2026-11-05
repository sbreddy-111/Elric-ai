// Elric Agent prototype (elricai.sbs/agent/). Talks only to the ai-agent edge function.
// No user text is saved here (nothing in localStorage), no payments.
(() => {
  const API = 'https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-agent';
  const KEY = 'sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT'; // public by design (same as the app)

  const $ = (s) => document.querySelector(s);
  const log = $('#log'), q = $('#q'), mic = $('#mic'), main = $('#main');
  let speechLang = 'en-IN'; // mic only; replies follow the user's own language automatically
  let pending = null; // last card that still has missing fields → next message is a follow-up
  let busy = false;

  // Card text in the user's language. *-latn = Telugu/Hindi typed in English letters.
  const T = {
    'te-latn': { yes: 'Avunu', edit: 'Maarchu', need: 'kavali', soon: 'Tvaralo vastundi. Idi inka test maatrame.', fill: 'Paina adigindi type cheyandi leda cheppandi.', err: 'Connect kaledu. Malli try cheyandi.', limit: 'Ee ganta limit ayipoyindi. Konchem tarvata try cheyandi.',
      task: { electricity_bill: 'Current bill', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Inka teliyadu' },
      label: { biller: 'Company', service_number: 'Service number', from: 'Ekkada nunchi', to: 'Ekkadiki', date: 'Tedi', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['Test bill — nijam kaadu', 'Due', 'Test kosam sample bill. Payment emi jaragadu.'] },
    'hi-latn': { yes: 'Haan', edit: 'Badlein', need: 'chahiye', soon: 'Jald aa raha hai. Abhi sirf test hai.', fill: 'Upar ke sawaal ka jawab likhein ya bolein.', err: 'Connect nahi hua. Phir try karein.', limit: 'Is ghante ki limit poori. Thodi der baad try karein.',
      task: { electricity_bill: 'Bijli bill', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Abhi pata nahi' },
      label: { biller: 'Company', service_number: 'Service number', from: 'Kahan se', to: 'Kahan tak', date: 'Tareekh', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['Test bill — asli nahi', 'Due', 'Test ke liye sample bill. Koi payment nahi hota.'] },
    te: { yes: 'అవును', edit: 'మార్చు', need: 'కావాలి', soon: 'త్వరలో వస్తుంది. ఇది ఇంకా టెస్ట్ మాత్రమే.', fill: 'పై ప్రశ్నకు జవాబు టైప్ చేయండి లేదా చెప్పండి.', err: 'కనెక్ట్ కాలేదు. మళ్లీ ప్రయత్నించండి.', limit: 'ఈ గంటకు పరిమితి దాటింది. కొంచెం తర్వాత ప్రయత్నించండి.',
      task: { electricity_bill: 'కరెంట్ బిల్లు', bus_search: 'బస్ వెతుకు', pm_kisan_status: 'PM-కిసాన్ స్టేటస్', unknown: 'ఇంకా తెలియదు' },
      label: { biller: 'సంస్థ', service_number: 'సర్వీస్ నంబర్', from: 'ఎక్కడి నుంచి', to: 'ఎక్కడికి', date: 'తేదీ', aadhaar_or_mobile_last4: 'ఆధార్/మొబైల్ (చివరి 4)' },
      bill: ['టెస్ట్ — నిజం కాదు', 'గడువు', 'టెస్ట్ కోసం నమూనా బిల్లు. ఎలాంటి చెల్లింపు జరగదు.'] },
    hi: { yes: 'हाँ', edit: 'बदलें', need: 'चाहिए', soon: 'जल्द आ रहा है। अभी सिर्फ़ टेस्ट है।', fill: 'ऊपर के सवाल का जवाब लिखें या बोलें।', err: 'कनेक्ट नहीं हुआ। फिर से कोशिश करें।', limit: 'इस घंटे की सीमा पूरी हुई। थोड़ी देर बाद कोशिश करें।',
      task: { electricity_bill: 'बिजली बिल', bus_search: 'बस खोजें', pm_kisan_status: 'PM-किसान स्टेटस', unknown: 'अभी पता नहीं' },
      label: { biller: 'कंपनी', service_number: 'सर्विस नंबर', from: 'कहाँ से', to: 'कहाँ तक', date: 'तारीख', aadhaar_or_mobile_last4: 'आधार/मोबाइल (आखिरी 4)' },
      bill: ['टेस्ट — असली नहीं', 'देय', 'टेस्ट के लिए नमूना बिल। कोई भुगतान नहीं होता।'] },
    en: { yes: 'Yes', edit: 'Edit', need: 'needed', soon: 'Coming soon. This is a test version.', fill: 'Type or say the answer to the question above.', err: 'Could not connect. Please try again.', limit: 'Hourly limit reached. Please try a bit later.',
      task: { electricity_bill: 'Power bill', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Not sure yet' },
      label: { biller: 'Company', service_number: 'Service no.', from: 'From', to: 'To', date: 'Date', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['TEST — NOT REAL', 'Due', 'Sample bill for testing. No payment is made.'] },
  };
  const uiLang = () => speechLang.slice(0, 2);
  let lastLang = 'en', lastScript = 'native';
  const t = (lang, script) => T[lang && lang !== 'en' && script === 'latn' ? lang + '-latn' : lang] || T.en;
  const ICON = { electricity_bill: '⚡', bus_search: '🚌', pm_kisan_status: '🌾', unknown: '💬' };

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const scroll = () => requestAnimationFrame(() => main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' }));
  const hideHero = () => { const h = $('#hero'); if (h) h.remove(); };

  function fmtDate(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return d;
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    hideHero();
    busy = true;
    log.append(el('div', 'you', text));
    const wait = el('div', 'typing'); wait.innerHTML = '<i></i><i></i><i></i>';
    log.append(wait); scroll();
    const body = { text, ui_lang: uiLang() };
    if (pending) body.prev = { task: pending.task, fields: pending.fields, lang: pending.lang, script: pending.script };
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify(body) });
      wait.remove();
      if (r.status === 429) { log.append(el('div', 'err', t(lastLang, lastScript).limit)); return; }
      if (!r.ok) throw new Error(String(r.status));
      card(await r.json());
    } catch {
      wait.remove();
      log.append(el('div', 'err', t(lastLang, lastScript).err));
    } finally { busy = false; scroll(); }
  }

  function card(res) {
    lastLang = res.lang || 'en'; lastScript = res.script || 'native';
    const L = t(res.lang, res.script);
    const c = el('div', 'card');
    c.lang = res.lang || 'en';
    const k = el('div', 'kind');
    k.append(el('span', null, ICON[res.task] || ICON.unknown), el('b', null, L.task[res.task] || L.task.unknown));
    c.append(k, el('div', 'say', res.confirm_text || ''));
    const keys = Object.keys(res.fields || {});
    if (keys.length) {
      const dl = el('dl', 'rows');
      for (const f of keys) {
        const v = res.fields[f];
        dl.append(el('dt', null, L.label[f] || f), el('dd', v ? '' : 'miss', v ? (f === 'date' ? fmtDate(v) : v) : '— ' + L.need));
      }
      c.append(dl);
    }
    log.append(c);
    if (res.task === 'unknown') { pending = null; return; }
    if (res.missing && res.missing.length) {
      pending = res;
      c.append(el('div', 'hint', L.fill));
      q.focus({ preventScroll: true });
      return;
    }
    pending = null;
    const acts = el('div', 'acts');
    const yes = el('button', 'yes', L.yes), edit = el('button', 'edit', L.edit);
    acts.append(yes, edit); c.append(acts);
    yes.onclick = () => { yes.disabled = edit.disabled = true; done(res); };
    edit.onclick = () => {
      yes.disabled = edit.disabled = true;
      pending = { ...res, missing: [] }; // keep the card so the edit message only changes what is said
      q.value = ''; sync(); q.focus();
    };
  }

  function done(res) {
    const L = t(res.lang, res.script);
    if (res.task === 'electricity_bill') {
      // TEST MODE: fake numbers, nothing is fetched from any power company.
      const seed = [...(res.fields.service_number || '0')].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      const amt = 180 + (seed % 1400) + (seed % 100) / 100;
      const due = new Date(Date.now() + 10 * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const b = el('div', 'bill');
      b.append(el('div', 'tag', L.bill[0]));
      if (L !== T.en) b.append(el('div', 'tag2', 'TEST — NOT REAL'));
      b.append(el('div', 'sub', `${res.fields.biller} · ${L.label.service_number} ${res.fields.service_number}`));
      b.append(el('div', 'amt', '₹' + amt.toFixed(2)));
      b.append(el('div', 'sub', `${L.bill[1]} ${due} · ${L.bill[2]}`));
      log.append(b);
    } else {
      log.append(el('div', 'soon', `${ICON[res.task] || ICON.unknown} ${L.soon}`));
    }
    scroll();
  }

  // ---- optional mic language switch (EN → తె → हि). Only affects speech recognition.
  const ML = [['en-IN', 'EN', 'English'], ['te-IN', 'తె', 'Telugu'], ['hi-IN', 'हि', 'Hindi']];
  const mlBtn = $('#ml');
  mlBtn.onclick = () => {
    const i = (ML.findIndex((x) => x[0] === speechLang) + 1) % ML.length;
    speechLang = ML[i][0]; mlBtn.textContent = ML[i][1];
    mlBtn.setAttribute('aria-label', 'Mic language: ' + ML[i][2]);
    mlBtn.classList.toggle('set', i !== 0);
  };
  document.querySelectorAll('.chip').forEach((b) => b.onclick = () => send(b.dataset.t));
  let rec = null;
  const form = $('#f');
  const sync = () => form.classList.toggle('typed', !!q.value.trim() && !rec);
  q.addEventListener('input', sync);
  form.onsubmit = (e) => { e.preventDefault(); const v = q.value; q.value = ''; sync(); send(v); };

  // ---- voice (Web Speech API): spoken text goes through the same send() as typed text
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    mic.style.display = 'none'; mlBtn.style.display = 'none'; form.classList.add('nomic');
  } else {
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = speechLang; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      let finalText = '';
      mic.classList.add('live');
      rec.onresult = (e) => {
        let s = '';
        for (const r of e.results) { s += r[0].transcript; if (r.isFinal) finalText = s; }
        q.value = s;
      };
      rec.onerror = () => {};
      rec.onend = () => {
        mic.classList.remove('live'); rec = null;
        const v = (finalText || q.value).trim();
        if (v) { q.value = ''; send(v); }
        sync();
      };
      try { rec.start(); } catch { mic.classList.remove('live'); rec = null; }
    };
  }
})();
