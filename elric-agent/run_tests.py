# Runs the sample utterances against the deployed ai-agent function and writes TESTS.md.
import json, urllib.request, datetime, time
API='https://hqsqpiwmozgsxiizhaml.supabase.co/functions/v1/ai-agent'
KEY='sb_publishable_Yv1D_ZUk38W3-ZvYdoAD8A_-fx5gPCT'
today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5,minutes=30))).date()
tm=str(today+datetime.timedelta(days=1))
# (lang, text, ui_lang, expected task, expected fields subset (None = must be missing), expected missing)
T=[
 ('te','నా కరెంట్ బిల్లు చూడు, APCPDCL సర్వీస్ నంబర్ 1234567','en','electricity_bill',{'biller':'APCPDCL','service_number':'1234567'},[]),
 ('te','repu Guntur nunchi Hyderabad ki bus kavali','en','bus_search',{'from':'Guntur','to':'Hyderabad','date':tm},[]),
 ('te','నా కరెంట్ బిల్లు ఎంత ఉందో చెప్పు','en','electricity_bill',{'biller':None,'service_number':None},['biller','service_number']),
 ('te','PM కిసాన్ డబ్బులు వచ్చాయా చూడు','en','pm_kisan_status',{'aadhaar_or_mobile_last4':None},['aadhaar_or_mobile_last4']),
 ('hi','मेरा बिजली बिल चेक करो, APSPDCL, सर्विस नंबर 556677','en','electricity_bill',{'biller':'APSPDCL','service_number':'556677'},[]),
 ('hi','kal Hyderabad se Vijayawada bus chahiye','en','bus_search',{'from':'Hyderabad','to':'Vijayawada','date':tm},[]),
 ('hi','PM Kisan ka status batao, aadhaar last 4 digit 4321','en','pm_kisan_status',{'aadhaar_or_mobile_last4':'4321'},[]),
 ('hi','Bangalore jaane wali bus dikhao','en','bus_search',{'to':'Bangalore','from':None,'date':None},['from','date']),
 ('en','Check my APEPDCL electricity bill, service number 9988776655','en','electricity_bill',{'biller':'APEPDCL','service_number':'9988776655'},[]),
 ('en','I need a bus from Narasaraopet to Chennai tomorrow','en','bus_search',{'from':'Narasaraopet','to':'Chennai','date':tm},[]),
 ('en','Pay my current bill','en','electricity_bill',{'biller':None,'service_number':None},['biller','service_number']),
 ('en','Book me a movie ticket for tonight','en','unknown',{},[]),
 ('en','Check my APCPDCL bill, service number nine eight seven six five four three','en','electricity_bill',{'biller':'APCPDCL','service_number':'9876543'},[]),
 ('te','APCPDCL కరెంట్ బిల్లు, సర్వీస్ నంబర్ తొమ్మిది ఎనిమిది ఏడు ఆరు ఐదు','en','electricity_bill',{'biller':'APCPDCL','service_number':'98765'},[]),
 ('hi','PM Kisan status batao, aadhaar last 4 digit ek do teen chaar','en','pm_kisan_status',{'aadhaar_or_mobile_last4':'1234'},[]),
 ('en','Pay my APEPDCL bill, service number 112413A035070847','en','electricity_bill',{'biller':'APEPDCL','service_number':'112413A035070847'},[]),
 ('en','Recharge my Jio number 9876543210 with 299','en','mobile_recharge',{'mobile_number':'9876543210','operator':'JIO','amount':'299'},[]),
 ('te','naa Airtel number 9123456780 ki 199 recharge cheyyi','en','mobile_recharge',{'mobile_number':'9123456780','operator':'AIRTEL','amount':'199'},[]),
 ('hi','मेरे फोन में रिचार्ज करो','en','mobile_recharge',{'mobile_number':None,'operator':None,'amount':None},['mobile_number','operator','amount']),
 ('hi','Vi number 8899776655 par 155 ka recharge karo','en','mobile_recharge',{'mobile_number':'8899776655','operator':'VI','amount':'155'},[]),
 ('en','Recharge BSNL nine eight four eight one two three four five six','en','mobile_recharge',{'mobile_number':'9848123456','operator':'BSNL','amount':None},['amount']),
 ('te','Guntur lo mirchi rate enta','en','mandi_price',{'commodity':'Dry Chillies','place':'Guntur'},[]),
 ('te','ఈరోజు పత్తి ధర ఎంత?','en','mandi_price',{'commodity':'Cotton'},[]),
 ('te','bendakaya rate enta ivvala','en','mandi_price',{'commodity':'Bhindi(Ladies Finger)'},[]),
 ('en','tomato price in Guntur market','en','mandi_price',{'commodity':'Tomato','place':'Guntur'},[]),
 ('te','biyyam rate enta','en','mandi_price',{'commodity':'Rice'},[]),
 ('hi','aaj pyaz ka mandi bhav batao','en','mandi_price',{'commodity':'Onion'},[]),
 ('en','What is the mandi crop price today?','en','mandi_price',{'commodity':'ALL'},[]),
 ('te','boppayi rate enta','te-latn','mandi_price',{'commodity':'Papaya'},[]),
 ('hi','sabzi ke bhav batao','hi-latn','mandi_price',{'commodity':'ALL'},[]),
]
rows=[];passed=0
for i,(lg,text,ui,task,exp,miss) in enumerate(T,1):
    t0=time.time()
    try:
        req=urllib.request.Request(API,data=json.dumps({'text':text,'ui_lang':ui}).encode(),headers={'Content-Type':'application/json','apikey':KEY})
        r=json.load(urllib.request.urlopen(req,timeout=40)); err=''
    except Exception as e:
        r={};err=str(e)
    dt=time.time()-t0
    f=r.get('fields',{}) or {}
    probs=[]
    if r.get('task')!=task: probs.append(f"task={r.get('task')}")
    for k,v in exp.items():
        got=f.get(k)
        if v is None:
            if got: probs.append(f"{k} invented: {got}")
        elif (got or '').lower()!=v.lower(): probs.append(f"{k}={got}")
    if set(r.get('missing',[]))!=set(miss): probs.append(f"missing={r.get('missing')}")
    if task!='unknown' and r.get('lang')!=lg: probs.append(f"lang={r.get('lang')}")
    if not r.get('confirm_text'): probs.append('no confirm_text')
    if err: probs=[err]
    ok=not probs; passed+=ok
    rows.append((i,lg,text,r.get('task'),json.dumps({k:v for k,v in f.items()},ensure_ascii=False),', '.join(r.get('missing',[])) or '—',r.get('confirm_text',''),f"{dt:.1f}s",'PASS' if ok else 'FAIL: '+'; '.join(probs)))
    time.sleep(1)
esc=lambda s:str(s).replace('|','\\|')
md=[f"# Elric Agent — function tests\n",f"Function: `ai-agent` (Supabase project hqsqpiwmozgsxiizhaml). Run {datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5,minutes=30))):%Y-%m-%d %H:%M} IST. \"Tomorrow\" = {tm}.\n",
    f"**Result: {passed}/{len(T)} pass.** Script: `run_tests.py`. Every request sends ui_lang=en (the page default); the reply language must follow the user's words.\n",
    "| # | Lang | Said | Task | Fields | Missing | Reply (confirm_text) | Time | Result |","|---|---|---|---|---|---|---|---|---|"]
for r in rows: md.append('| '+' | '.join(esc(x) for x in r)+' |')
open('TESTS.md','w').write('\n'.join(md)+'\n')
print('\n'.join(md))
