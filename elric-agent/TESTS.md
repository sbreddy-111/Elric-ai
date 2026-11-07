# Elric Agent — function tests

Function: `ai-agent` (Supabase project hqsqpiwmozgsxiizhaml). Run 2026-11-08 00:30 IST. "Tomorrow" = 2026-11-09.

**Result: 28/28 pass.** Script: `run_tests.py`. Every request sends ui_lang=en (the page default); the reply language must follow the user's words.

| # | Lang | Said | Task | Fields | Missing | Reply (confirm_text) | Time | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | te | నా కరెంట్ బిల్లు చూడు, APCPDCL సర్వీస్ నంబర్ 1234567 | electricity_bill | {"biller": "APCPDCL", "service_number": "1234567"} | — | APCPDCL బిల్లు, సర్వీస్ నంబర్ 1234567. చెక్ చేయాలా? | 1.7s | PASS |
| 2 | te | repu Guntur nunchi Hyderabad ki bus kavali | bus_search | {"from": "Guntur", "to": "Hyderabad", "date": "2026-11-09"} | — | Guntur nunchi Hyderabad bus, 9 Nov. Chudamaa? | 0.8s | PASS |
| 3 | te | నా కరెంట్ బిల్లు ఎంత ఉందో చెప్పు | electricity_bill | {"biller": null, "service_number": null} | biller, service_number | ఏ విద్యుత్ సంస్థ? (APCPDCL / APSPDCL / APEPDCL) | 1.7s | PASS |
| 4 | te | PM కిసాన్ డబ్బులు వచ్చాయా చూడు | pm_kisan_status | {"aadhaar_or_mobile_last4": null} | aadhaar_or_mobile_last4 | ఆధార్ లేదా మొబైల్ చివరి 4 అంకెలు? | 1.7s | PASS |
| 5 | hi | मेरा बिजली बिल चेक करो, APSPDCL, सर्विस नंबर 556677 | electricity_bill | {"biller": "APSPDCL", "service_number": "556677"} | — | APSPDCL बिल, सर्विस नंबर 556677. चेक करें? | 1.7s | PASS |
| 6 | hi | kal Hyderabad se Vijayawada bus chahiye | bus_search | {"from": "Hyderabad", "to": "Vijayawada", "date": "2026-11-09"} | — | Hyderabad se Vijayawada bus, kal (9 Nov). Dekhein? | 1.1s | PASS |
| 7 | hi | PM Kisan ka status batao, aadhaar last 4 digit 4321 | pm_kisan_status | {"aadhaar_or_mobile_last4": "4321"} | — | PM-Kisan status, aadhaar last 4 digits 4321. Check karein? | 1.6s | PASS |
| 8 | hi | Bangalore jaane wali bus dikhao | bus_search | {"from": null, "to": "Bangalore", "date": null} | from, date | Kahan se? | 13.1s | PASS |
| 9 | en | Check my APEPDCL electricity bill, service number 9988776655 | electricity_bill | {"biller": "APEPDCL", "service_number": "9988776655"} | — | APEPDCL bill, service no. 9988776655. Check it? | 1.3s | PASS |
| 10 | en | I need a bus from Narasaraopet to Chennai tomorrow | bus_search | {"from": "Narasaraopet", "to": "Chennai", "date": "2026-11-09"} | — | Narasaraopet to Chennai bus, tomorrow (9 Nov). Proceed? | 1.2s | PASS |
| 11 | en | Pay my current bill | electricity_bill | {"biller": null, "service_number": null} | biller, service_number | Which power company? (APCPDCL / APSPDCL / APEPDCL) | 1.5s | PASS |
| 12 | en | Book me a movie ticket for tonight | unknown | {} | — | I can help with power bills, mobile recharge, crop market prices, bus search and PM‑Kisan status. What would you like to do? | 1.3s | PASS |
| 13 | en | Check my APCPDCL bill, service number nine eight seven six five four three | electricity_bill | {"biller": "APCPDCL", "service_number": "9876543"} | — | APCPDCL bill, service no. 9876543. Check it? | 1.3s | PASS |
| 14 | te | APCPDCL కరెంట్ బిల్లు, సర్వీస్ నంబర్ తొమ్మిది ఎనిమిది ఏడు ఆరు ఐదు | electricity_bill | {"biller": "APCPDCL", "service_number": "98765"} | — | APCPDCL బిల్లు, సర్వీస్ నంబర్ 98765. చెక్ చేయాలా? | 1.6s | PASS |
| 15 | hi | PM Kisan status batao, aadhaar last 4 digit ek do teen chaar | pm_kisan_status | {"aadhaar_or_mobile_last4": "1234"} | — | PM-Kisan status, aadhaar last 4 digits 1234. Check karein? | 1.1s | PASS |
| 16 | en | Pay my APEPDCL bill, service number 112413A035070847 | electricity_bill | {"biller": "APEPDCL", "service_number": "112413A035070847"} | — | APEPDCL bill, service number 112413A035070847. Pay it? | 1.7s | PASS |
| 17 | en | Recharge my Jio number 9876543210 with 299 | mobile_recharge | {"mobile_number": "9876543210", "operator": "JIO", "amount": "299"} | — | Jio mobile number 9876543210 recharge for 299. Proceed? | 1.7s | PASS |
| 18 | te | naa Airtel number 9123456780 ki 199 recharge cheyyi | mobile_recharge | {"mobile_number": "9123456780", "operator": "AIRTEL", "amount": "199"} | — | AirTel number 9123456780 ki 199 recharge cheyyala? | 2.3s | PASS |
| 19 | hi | मेरे फोन में रिचार्ज करो | mobile_recharge | {"mobile_number": null, "operator": null, "amount": null} | mobile_number, operator, amount | किस मोबाइल नंबर पर रिचार्ज? | 3.6s | PASS |
| 20 | hi | Vi number 8899776655 par 155 ka recharge karo | mobile_recharge | {"mobile_number": "8899776655", "operator": "VI", "amount": "155"} | — | 8899776655 (Vi) par Rs.155 ka recharge. Karein? | 3.0s | PASS |
| 21 | en | Recharge BSNL nine eight four eight one two three four five six | mobile_recharge | {"mobile_number": "9848123456", "operator": "BSNL", "amount": null} | amount | How much to recharge? (Rs.) | 1.5s | PASS |
| 22 | te | Guntur lo mirchi rate enta | mandi_price | {"commodity": "Dry Chillies", "place": "Guntur"} | — | Dry Chillies market rate (Guntur). Chupinchamantara? | 1.8s | PASS |
| 23 | te | ఈరోజు పత్తి ధర ఎంత? | mandi_price | {"commodity": "Cotton", "place": null} | — | ఈరోజు పత్తి ధర ఎంత అని తనిఖీ చేయాలా? | 1.7s | PASS |
| 24 | te | bendakaya rate enta ivvala | mandi_price | {"commodity": "Bhindi(Ladies Finger)", "place": null} | — | Bhindi(Ladies Finger) market rate. Chupinchamantara? | 1.5s | PASS |
| 25 | en | tomato price in Guntur market | mandi_price | {"commodity": "Tomato", "place": "Guntur"} | — | Tomato price in Guntur market. Check it? | 1.7s | PASS |
| 26 | te | biyyam rate enta | mandi_price | {"commodity": "Rice", "place": null} | — | Rice market rate. Chupinchamantara? | 1.2s | PASS |
| 27 | hi | aaj pyaz ka mandi bhav batao | mandi_price | {"commodity": "Onion", "place": null} | — | Onion mandi bhav. Dikhayein? | 1.0s | PASS |
| 28 | en | What is the mandi crop price today? | mandi_price | {"commodity": null, "place": null} | commodity | Which crop price? (chilli, cotton, paddy...) | 1.7s | PASS |
