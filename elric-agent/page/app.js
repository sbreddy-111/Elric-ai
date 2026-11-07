// Elric Agent prototype (elricai.sbs/agent/). Talks only to the ai-agent edge function.
// No user text is saved here (nothing in localStorage), no payments.
(() => {
  const API = 'https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-agent';
  const KEY = 'sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT'; // public by design (same as the app)

  const $ = (s) => document.querySelector(s);
  // Fit to the visible screen: on iPhone the keyboard shrinks visualViewport but not 100dvh, which hid the input.
  const root = document.documentElement;
  const fit = () => {
    const vv = window.visualViewport;
    if (vv && Math.abs(vv.scale - 1) > 0.01) return;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    root.style.setProperty('--app-h', h + 'px');
    root.classList.toggle('kb', !!vv && window.innerHeight - vv.height > 120);
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
    requestAnimationFrame(() => { const m = document.getElementById('main'); if (m && root.classList.contains('kb')) m.scrollTop = m.scrollHeight; });
  };
  fit();
  let fr = 0; const onFit = () => { cancelAnimationFrame(fr); fr = requestAnimationFrame(fit); };
  addEventListener('resize', onFit); visualViewport?.addEventListener('resize', onFit); visualViewport?.addEventListener('scroll', onFit);
  const log = $('#log'), q = $('#q'), mic = $('#mic'), main = $('#main');
  let speechLang = 'en-IN'; // mic only; replies follow the user's own language automatically
  let pending = null; // last card that still has missing fields → next message is a follow-up
  let busy = false;
  let lastCtx = ''; // short text of the last result shown (sent so follow-ups like "per kg?" can be answered)

  // Card text in the user's language. *-latn = Telugu/Hindi typed in English letters.
  const T = {
    'te-latn': { yes: 'Avunu', edit: 'Maarchu', need: 'kavali', soon: 'Tvaralo vastundi. Idi inka test maatrame.', fill: 'Paina adigindi type cheyandi leda cheppandi.', err: 'Connect kaledu. Malli try cheyandi.', limit: 'Ee ganta limit ayipoyindi. Konchem tarvata try cheyandi.',
      task: { electricity_bill: 'Current bill', mobile_recharge: 'Mobile recharge', mandi_price: 'Market price', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Elric' },
      label: { commodity: 'Crop', place: 'Place', mobile_number: 'Mobile number', operator: 'Network', amount: 'Amount (Rs.)', biller: 'Company', service_number: 'Service number', from: 'Ekkada nunchi', to: 'Ekkadiki', date: 'Tedi', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['Test bill — nijam kaadu', 'Due', 'Test kosam sample bill. Payment emi jaragadu.'], pay: ['Official site lo pay cheyandi', 'Mee service number copy ayindi. Site lo paste chesi, captcha vesi pay cheyandi.', 'Pay cheyadaniki open cheyandi', 'Copy ayindi'] },
    'hi-latn': { yes: 'Haan', edit: 'Badlein', need: 'chahiye', soon: 'Jald aa raha hai. Abhi sirf test hai.', fill: 'Upar ke sawaal ka jawab likhein ya bolein.', err: 'Connect nahi hua. Phir try karein.', limit: 'Is ghante ki limit poori. Thodi der baad try karein.',
      task: { electricity_bill: 'Bijli bill', mobile_recharge: 'Mobile recharge', mandi_price: 'Market price', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Elric' },
      label: { commodity: 'Crop', place: 'Place', mobile_number: 'Mobile number', operator: 'Network', amount: 'Amount (Rs.)', biller: 'Company', service_number: 'Service number', from: 'Kahan se', to: 'Kahan tak', date: 'Tareekh', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['Test bill — asli nahi', 'Due', 'Test ke liye sample bill. Koi payment nahi hota.'], pay: ['Official site par pay karein', 'Aapka service number copy ho gaya. Site par paste karke captcha bharein aur pay karein.', 'Pay karne ke liye kholein', 'Copy ho gaya'] },
    te: { yes: 'అవును', edit: 'మార్చు', need: 'కావాలి', soon: 'త్వరలో వస్తుంది. ఇది ఇంకా టెస్ట్ మాత్రమే.', fill: 'పై ప్రశ్నకు జవాబు టైప్ చేయండి లేదా చెప్పండి.', err: 'కనెక్ట్ కాలేదు. మళ్లీ ప్రయత్నించండి.', limit: 'ఈ గంటకు పరిమితి దాటింది. కొంచెం తర్వాత ప్రయత్నించండి.',
      task: { electricity_bill: 'కరెంట్ బిల్లు', mobile_recharge: 'మొబైల్ రీఛార్జ్', mandi_price: 'మార్కెట్ ధర', bus_search: 'బస్ వెతుకు', pm_kisan_status: 'PM-కిసాన్ స్టేటస్', unknown: 'Elric' },
      label: { commodity: 'పంట', place: 'ఊరు', mobile_number: 'మొబైల్ నంబర్', operator: 'నెట్‌వర్క్', amount: 'మొత్తం (₹)', biller: 'సంస్థ', service_number: 'సర్వీస్ నంబర్', from: 'ఎక్కడి నుంచి', to: 'ఎక్కడికి', date: 'తేదీ', aadhaar_or_mobile_last4: 'ఆధార్/మొబైల్ (చివరి 4)' },
      bill: ['టెస్ట్ — నిజం కాదు', 'గడువు', 'టెస్ట్ కోసం నమూనా బిల్లు. ఎలాంటి చెల్లింపు జరగదు.'], pay: ['అధికారిక సైట్‌లో చెల్లించండి', 'మీ సర్వీస్ నంబర్ కాపీ అయింది. సైట్‌లో పేస్ట్ చేసి, క్యాప్చా వేసి చెల్లించండి.', 'చెల్లించడానికి ఓపెన్ చేయండి', 'కాపీ అయింది'] },
    hi: { yes: 'हाँ', edit: 'बदलें', need: 'चाहिए', soon: 'जल्द आ रहा है। अभी सिर्फ़ टेस्ट है।', fill: 'ऊपर के सवाल का जवाब लिखें या बोलें।', err: 'कनेक्ट नहीं हुआ। फिर से कोशिश करें।', limit: 'इस घंटे की सीमा पूरी हुई। थोड़ी देर बाद कोशिश करें।',
      task: { electricity_bill: 'बिजली बिल', mobile_recharge: 'मोबाइल रिचार्ज', mandi_price: 'मंडी भाव', bus_search: 'बस खोजें', pm_kisan_status: 'PM-किसान स्टेटस', unknown: 'Elric' },
      label: { commodity: 'फसल', place: 'जगह', mobile_number: 'मोबाइल नंबर', operator: 'नेटवर्क', amount: 'राशि (₹)', biller: 'कंपनी', service_number: 'सर्विस नंबर', from: 'कहाँ से', to: 'कहाँ तक', date: 'तारीख', aadhaar_or_mobile_last4: 'आधार/मोबाइल (आखिरी 4)' },
      bill: ['टेस्ट — असली नहीं', 'देय', 'टेस्ट के लिए नमूना बिल। कोई भुगतान नहीं होता।'], pay: ['आधिकारिक साइट पर भुगतान करें', 'आपका सर्विस नंबर कॉपी हो गया। साइट पर पेस्ट करें, कैप्चा भरें और भुगतान करें।', 'भुगतान के लिए खोलें', 'कॉपी हो गया'] },
    en: { yes: 'Yes', edit: 'Edit', need: 'needed', soon: 'Coming soon. This is a test version.', fill: 'Type or say the answer to the question above.', err: 'Could not connect. Please try again.', limit: 'Hourly limit reached. Please try a bit later.',
      task: { electricity_bill: 'Power bill', mobile_recharge: 'Mobile recharge', mandi_price: 'Market price', bus_search: 'Bus search', pm_kisan_status: 'PM-Kisan status', unknown: 'Elric' },
      label: { commodity: 'Crop', place: 'Place', mobile_number: 'Mobile no.', operator: 'Network', amount: 'Amount (Rs.)', biller: 'Company', service_number: 'Service no.', from: 'From', to: 'To', date: 'Date', aadhaar_or_mobile_last4: 'Aadhaar/mobile (last 4)' },
      bill: ['TEST — NOT REAL', 'Due', 'Sample bill for testing. No payment is made.'], pay: ['Pay on the official site', 'Your service number is copied. Paste it on the site, fill the captcha and pay.', 'Open to pay', 'Copied'] },
  };
  const qs0 = () => new URLSearchParams(location.search);
  const uiLang = () => speechLang.slice(0, 2);
  let lastLang = 'en', lastScript = 'native';
  const t = (lang, script) => T[lang && lang !== 'en' && script === 'latn' ? lang + '-latn' : lang] || T.en;
  const ICON = { electricity_bill: '⚡', mobile_recharge: '📱', mandi_price: '🌶️', bus_search: '🚌', pm_kisan_status: '🌾', unknown: '💬' };

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
    if (lastCtx) body.ctx = lastCtx;
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
        const OPN = { JIO: 'Jio', AIRTEL: 'Airtel', VI: 'Vi', BSNL: 'BSNL' };
        dl.append(el('dt', null, L.label[f] || f), el('dd', v || f === 'place' ? '' : 'miss', v || f === 'place' ? (!v ? 'Andhra Pradesh' : f === 'date' ? fmtDate(v) : f === 'operator' ? (OPN[v] || v) : f === 'amount' ? '₹' + v : v) : '— ' + L.need));
      }
      c.append(dl);
    }
    log.append(c);
    if (res.task === 'unknown') { pending = null; return; }
    if (res.missing && res.missing.length) {
      pending = res;
      const PICKS = { biller: ['APCPDCL', 'APSPDCL', 'APEPDCL'], operator: ['Jio', 'Airtel', 'Vi', 'BSNL'] };
      if (PICKS[res.missing[0]]) {
        // Tap a choice instead of typing or saying it.
        const row = el('div', 'picks');
        for (const b of PICKS[res.missing[0]]) {
          const btn = el('button', 'pick', b);
          btn.type = 'button';
          btn.onclick = () => { if (busy) return; row.querySelectorAll('button').forEach((x) => x.disabled = true); btn.classList.add('on'); send(b); };
          row.append(btn);
        }
        c.append(row);
        return;
      }
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
      // No BBPS access yet: hand off to the power company's own official pay page (it needs a captcha, so no prefill).
      const PAY = {
        APCPDCL: 'https://www.apcpdcl.in/ConsumerDashboard/KnownBillPay',
        APSPDCL: 'https://apspdcl.in/ConsumerDashboard/serviceDetails.jsp',
        APEPDCL: 'https://www.apeasternpower.com/payWithoutLogin',
      };
      const sn = res.fields.service_number || '';
      const b = el('div', 'bill');
      b.append(el('div', 'tag', L.pay[0]));
      b.append(el('div', 'sub', `${res.fields.biller} · ${L.label.service_number} ${sn}`));
      b.append(el('div', 'sub', L.pay[1]));
      const go = el('a', 'yes paygo', L.pay[2]);
      go.href = PAY[res.fields.biller] || PAY.APCPDCL; go.target = '_blank'; go.rel = 'noopener';
      go.onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText(sn); } catch {} };
      b.append(go);
      log.append(b);
      try { navigator.clipboard && navigator.clipboard.writeText(sn); } catch {}
    } else if (res.task === 'mandi_price') {
      mandi(res, L);
    } else {
      log.append(el('div', 'soon', `${ICON[res.task] || ICON.unknown} ${L.soon}`));
    }
    scroll();
  }

  // Live mandi prices: the phone asks data.gov.in (Agmarknet, Govt of India) directly. Prices are Rs per quintal.
  const OGD = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
  const OGD_KEY = '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b'; // public sample key (10 rows per call)
  const MT = { en: ['Latest market price', 'per quintal', 'Source: Agmarknet, Govt of India', 'No price reported yet. Try again later.', 'Could not reach the price service.', (p) => `No ${p} price reported today. Other AP markets:`],
    te: ['తాజా మార్కెట్ ధర', 'క్వింటాకు', 'మూలం: Agmarknet, భారత ప్రభుత్వం', 'ఇంకా ధర రాలేదు. తర్వాత చూడండి.', 'ధర సేవ అందలేదు.', (p) => `ఈరోజు ${p} ధర రాలేదు. ఇతర AP మార్కెట్లు:`],
    hi: ['ताज़ा मंडी भाव', 'प्रति क्विंटल', 'स्रोत: Agmarknet, भारत सरकार', 'अभी भाव नहीं आया। बाद में देखें।', 'भाव सेवा से जुड़ नहीं पाए।', (p) => `आज ${p} का भाव नहीं आया। AP की दूसरी मंडियाँ:`] };
  async function mandi(res, L) {
    const M = MT[res.lang] || MT.en;
    const b = el('div', 'bill');
    b.append(el('div', 'tag', M[0]));
    const wait = el('div', 'typing'); wait.innerHTML = '<i></i><i></i><i></i>'; b.append(wait);
    log.append(b); scroll();
    const get = async (extra) => {
      const u = `${OGD}?api-key=${OGD_KEY}&format=json&limit=10&filters%5Bstate.keyword%5D=Andhra%20Pradesh&filters%5Bcommodity%5D=${encodeURIComponent(res.fields.commodity)}${extra}`;
      const r = await fetch(u); if (!r.ok) throw new Error(r.status); return (await r.json()).records || [];
    };
    try {
      let rows = [];
      const pl = (res.fields.place || '').trim();
      if (pl) { try { rows = await get(`&filters%5Bmarket%5D=${encodeURIComponent(pl)}`); } catch {} if (!rows.length) { try { rows = await get(`&filters%5Bdistrict%5D=${encodeURIComponent(pl)}`); } catch {} } }
      let other = false;
      if (!rows.length) { rows = await get(''); other = !!pl; }
      wait.remove();
      if (!rows.length) { b.append(el('div', 'sub', M[3])); return; }
      if (other) b.append(el('div', 'sub', M[5](pl)));
      rows.sort((a, b2) => Number(b2.modal_price) - Number(a.modal_price));
      for (const x of rows.slice(0, 3)) {
        const r = el('div', 'mrow');
        const qp = Number(x.modal_price);
        const a = el('div', 'amt', '₹' + qp.toLocaleString('en-IN'));
        a.append(el('span', 'kg', ` · ₹${(qp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}/kg`));
        r.append(a);
        r.append(el('div', 'sub', `${M[1]} · ${x.market}, ${x.district} · ${x.variety} · ${x.arrival_date}`));
        b.append(r);
      }
      b.append(el('div', 'sub', M[2]));
      lastCtx = `${res.fields.commodity} modal prices in Rs per quintal (100 kg): ` + rows.slice(0, 3).map((x) => `${x.market} (${x.district}) Rs ${x.modal_price} per quintal = Rs ${(Number(x.modal_price) / 100).toFixed(2)} per kg, on ${x.arrival_date}`).join('; ');
    } catch {
      wait.remove();
      b.append(el('div', 'sub', M[4]));
      const go = el('a', 'yes paygo', 'agmarknet.gov.in'); go.href = 'https://agmarknet.gov.in/'; go.target = '_blank'; go.rel = 'noopener'; b.append(go);
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
  if (qs0().get('from') === 'app') {
    $('#back').hidden = false; $('#proto').hidden = true;
    $('#back').onclick = (e) => { if (history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } };
  }
  // Opened from the Elric AI app: ?lang=hi|te sets the mic language, ?q= starts that task.
  const qs = qs0();
  const ql = ML.findIndex((x) => x[0].startsWith(qs.get('lang') || '-'));
  if (ql > 0) { speechLang = ML[ql][0]; mlBtn.textContent = ML[ql][1]; mlBtn.classList.add('set'); }
  if (qs.get('q')) setTimeout(() => send(qs.get('q').slice(0, 200)), 50);
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
