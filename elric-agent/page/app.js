// Elric Agent prototype (elricai.sbs/agent/). Talks only to the ai-agent edge function.
// No user text is saved here (nothing in localStorage), no payments.
(() => {
  const API = 'https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-agent';
  const KEY = 'sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT'; // public by design (same as the app)

  const $ = (s) => document.querySelector(s);
  const log = $('#log'), q = $('#q'), mic = $('#mic'), main = $('#main');
  let speechLang = 'te-IN';
  let pending = null; // last card that still has missing fields → next message is a follow-up
  let busy = false;

  const T = {
    te: { yes: 'అవును', edit: 'మార్చు', need: 'కావాలి', soon: 'త్వరలో వస్తుంది. ఇది ఇంకా టెస్ట్ మాత్రమే.', fill: 'పై ప్రశ్నకు జవాబు చెప్పండి లేదా టైప్ చేయండి.', err: 'కనెక్ట్ కాలేదు. మళ్లీ ప్రయత్నించండి.', limit: 'ఈ గంటకు పరిమితి దాటింది. కొంచెం తర్వాత ప్రయత్నించండి.' },
    hi: { yes: 'हाँ', edit: 'बदलें', need: 'चाहिए', soon: 'जल्द आ रहा है। अभी सिर्फ़ टेस्ट है।', fill: 'ऊपर के सवाल का जवाब बोलें या लिखें।', err: 'कनेक्ट नहीं हुआ। फिर से कोशिश करें।', limit: 'इस घंटे की सीमा पूरी हुई। थोड़ी देर बाद कोशिश करें।' },
    en: { yes: 'Yes', edit: 'Edit', need: 'needed', soon: 'Coming soon. This is a test version.', fill: 'Answer the question above by voice or text.', err: 'Could not connect. Please try again.', limit: 'Hourly limit reached. Please try a bit later.' },
  };
  const uiLang = () => speechLang.slice(0, 2);
  const t = (lang) => T[lang] || T.en;

  const TASK = {
    electricity_bill: { icon: '⚡', name: 'Power bill' },
    bus_search: { icon: '🚌', name: 'Bus search' },
    pm_kisan_status: { icon: '🌾', name: 'PM-Kisan status' },
    unknown: { icon: '💬', name: 'Not sure yet' },
  };
  const LABEL = {
    biller: 'Company', service_number: 'Service no.', from: 'From', to: 'To', date: 'Date',
    aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)',
  };

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
    if (pending) body.prev = { task: pending.task, fields: pending.fields };
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify(body) });
      wait.remove();
      if (r.status === 429) { log.append(el('div', 'err', t(uiLang()).limit)); return; }
      if (!r.ok) throw new Error(String(r.status));
      card(await r.json());
    } catch {
      wait.remove();
      log.append(el('div', 'err', t(uiLang()).err));
    } finally { busy = false; scroll(); }
  }

  function card(res) {
    const L = t(res.lang);
    const c = el('div', 'card');
    const k = el('div', 'kind'); const info = TASK[res.task] || TASK.unknown;
    k.append(el('span', null, info.icon), el('b', null, info.name));
    c.append(k, el('div', 'say', res.confirm_text || ''));
    const keys = Object.keys(res.fields || {});
    if (keys.length) {
      const dl = el('dl', 'rows');
      for (const f of keys) {
        const v = res.fields[f];
        dl.append(el('dt', null, LABEL[f] || f), el('dd', v ? '' : 'miss', v ? (f === 'date' ? fmtDate(v) : v) : '— ' + L.need));
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
      q.value = ''; q.focus();
    };
  }

  function done(res) {
    const L = t(res.lang);
    if (res.task === 'electricity_bill') {
      // TEST MODE: fake numbers, nothing is fetched from any power company.
      const seed = [...(res.fields.service_number || '0')].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      const amt = 180 + (seed % 1400) + (seed % 100) / 100;
      const due = new Date(Date.now() + 10 * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const b = el('div', 'bill');
      b.append(el('div', 'tag', 'TEST — NOT REAL'));
      b.append(el('div', 'sub', `${res.fields.biller} · Service no. ${res.fields.service_number}`));
      b.append(el('div', 'amt', '₹' + amt.toFixed(2)));
      b.append(el('div', 'sub', `Due ${due} · Sample bill for testing. No payment is made.`));
      log.append(b);
    } else {
      log.append(el('div', 'soon', `${(TASK[res.task] || TASK.unknown).icon} ${L.soon}`));
    }
    scroll();
  }

  // ---- language picker
  document.querySelectorAll('.lg').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.lg').forEach((x) => x.classList.toggle('on', x === b));
    speechLang = b.dataset.l;
  });
  document.querySelectorAll('.chip').forEach((b) => b.onclick = () => send(b.dataset.t));
  $('#f').onsubmit = (e) => { e.preventDefault(); const v = q.value; q.value = ''; send(v); };

  // ---- voice (Web Speech API); typed input stays as fallback
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) {
    mic.style.display = 'none';
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
      };
      try { rec.start(); } catch { mic.classList.remove('live'); rec = null; }
    };
  }
})();
