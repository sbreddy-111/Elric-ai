# Elric Agent — function tests

Function: `ai-agent` (Supabase project hqsqpiwmozgsxiizhaml). Run 2026-11-06 00:24 IST. "Tomorrow" = 2026-11-07.

**Result: 12/12 pass.** Script: `run_tests.py`.

| # | Lang | Said | Task | Fields | Missing | Reply (confirm_text) | Time | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | te | నా కరెంట్ బిల్లు చూడు, APCPDCL సర్వీస్ నంబర్ 1234567 | electricity_bill | {"biller": "APCPDCL", "service_number": "1234567"} | — | APCPDCL బిల్లు, సర్వీస్ నంబర్ 1234567. చెక్ చేయాలా? | 1.6s | PASS |
| 2 | te | repu Guntur nunchi Hyderabad ki bus kavali | bus_search | {"from": "Guntur", "to": "Hyderabad", "date": "2026-11-07"} | — | Guntur nunchi Hyderabad bus, repu (7 Nov). Chudamaa? | 2.0s | PASS |
| 3 | te | నా కరెంట్ బిల్లు ఎంత ఉందో చెప్పు | electricity_bill | {"biller": null, "service_number": null} | biller, service_number | ఏ విద్యుత్ సంస్థ? (APCPDCL / APSPDCL / APEPDCL) | 1.2s | PASS |
| 4 | te | PM కిసాన్ డబ్బులు వచ్చాయా చూడు | pm_kisan_status | {"aadhaar_or_mobile_last4": null} | aadhaar_or_mobile_last4 | ఆధార్ లేదా మొబైల్ చివరి 4 అంకెలు? | 1.0s | PASS |
| 5 | hi | मेरा बिजली बिल चेक करो, APSPDCL, सर्विस नंबर 556677 | electricity_bill | {"biller": "APSPDCL", "service_number": "556677"} | — | APSPDCL बिल, सर्विस नंबर 556677. चेक करें? | 1.2s | PASS |
| 6 | hi | kal Hyderabad se Vijayawada bus chahiye | bus_search | {"from": "Hyderabad", "to": "Vijayawada", "date": "2026-11-07"} | — | Hyderabad se Vijayawada bus, kal (7 Nov). Dekhein? | 1.6s | PASS |
| 7 | hi | PM Kisan ka status batao, aadhaar last 4 digit 4321 | pm_kisan_status | {"aadhaar_or_mobile_last4": "4321"} | — | PM-Kisan बिल, आख़िरी 4 अंक 4321. जाँच करें? | 1.2s | PASS |
| 8 | hi | Bangalore jaane wali bus dikhao | bus_search | {"from": null, "to": "Bangalore", "date": null} | from, date | Kahan se? | 4.5s | PASS |
| 9 | en | Check my APEPDCL electricity bill, service number 9988776655 | electricity_bill | {"biller": "APEPDCL", "service_number": "9988776655"} | — | APEPDCL bill, service no. 9988776655. Check it? | 0.8s | PASS |
| 10 | en | I need a bus from Narasaraopet to Chennai tomorrow | bus_search | {"from": "Narasaraopet", "to": "Chennai", "date": "2026-11-07"} | — | Bus from Narasaraopet to Chennai, tomorrow (7 Nov). Shall I check? | 3.6s | PASS |
| 11 | en | Pay my current bill | electricity_bill | {"biller": null, "service_number": null} | biller, service_number | Which power company? (APCPDCL / APSPDCL / APEPDCL) | 1.5s | PASS |
| 12 | en | Book me a movie ticket for tonight | unknown | {} | — | I can help with power bills, bus search and PM-Kisan status. | 1.2s | PASS |
