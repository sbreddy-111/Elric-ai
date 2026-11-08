// Mandi prices without the AI: crop and place are found on the phone from a fixed word list,
// so the Prices button and price questions work even when the AI service is busy or capped.

/** [Agmarknet name, English label, emoji, group, words people type or say (en / te / hi / Tenglish)] */
export type Crop = [string, string, string, 'crop' | 'veg' | 'fruit', RegExp];
export const CROPS: Crop[] = [
  ['Dry Chillies', 'Chilli', '🌶️', 'crop', /chill?i(es)?|chilly|mirchi|mirapa\w*|మిర్చి|మిరప\S*|मिर्च\S*/i],
  ['Cotton', 'Cotton', '☁️', 'crop', /cotton|patti|pathi|kapas|పత్తి|कपास/i],
  ['Paddy(Dhan)(Common)', 'Paddy', '🌾', 'crop', /paddy|vadlu|vari\b|dhan\b|వడ్లు|వరి|धान/i],
  ['Maize', 'Maize', '🌽', 'crop', /maize|corn|mokka\w*|makka\w*|మొక్కజొన్న|मक्का/i],
  ['Turmeric', 'Turmeric', '🟡', 'crop', /turmeric|pasupu|haldi|పసుపు|हल्दी/i],
  ['Groundnut', 'Groundnut', '🥜', 'crop', /groundnut|peanut|verusenaga\w*|palli|వేరుశ\S*|మూంగ్‌?ఫలీ|मूंगफली/i],
  ['Bengal Gram(Gram)(Whole)', 'Bengal gram', '🫘', 'crop', /bengal ?gram|chana|senaga\w*|శనగ\S*|चना/i],
  ['Black Gram (Urd Beans)(Whole)', 'Black gram', '🫘', 'crop', /black ?gram|urad|urd|minumu\w*|మినుము\S*|उड़द|उडद/i],
  ['Green Gram (Moong)(Whole)', 'Green gram', '🫛', 'crop', /green ?gram|moong|pesalu|pesara\w*|పెసలు|పెసర\S*|मूंग/i],
  ['Tomato', 'Tomato', '🍅', 'veg', /tomato\w*|tamata\w*|tamatar|టమాట\S*|టమోట\S*|टमाटर/i],
  ['Onion', 'Onion', '🧅', 'veg', /onion\w*|ullipaya\w*|ulli\b|pyaz|pyaaz|ఉల్లి\S*|प्याज/i],
  ['Potato', 'Potato', '🥔', 'veg', /potato\w*|aloo|alu\b|bangala ?dumpa|బంగాళ\S*|आलू/i],
  ['Brinjal', 'Brinjal', '🍆', 'veg', /brinjal|eggplant|vankaya\w*|baingan|వంకాయ\S*|बैंगन/i],
  ['Bhindi(Ladies Finger)', 'Lady finger', '🫑', 'veg', /bhindi|okra|lady'?s? ?finger|benda\w*|బెండ\S*|भिंडी/i],
  ['Green Chilli', 'Green chilli', '🌶️', 'veg', /green ?chill?i|pachi ?mirchi|hari ?mirch|పచ్చి ?మిర్చి|हरी ?मिर्च/i],
  ['Carrot', 'Carrot', '🥕', 'veg', /carrot|gajar|క్యారెట్|गाजर/i],
  ['Cabbage', 'Cabbage', '🥬', 'veg', /cabbage|patta ?gobi|క్యాబేజీ|पत्ता ?गोभी/i],
  ['Banana', 'Banana', '🍌', 'fruit', /banana\w*|arati\w*|kela\b|అరటి\S*|केला/i],
  ['Mango', 'Mango', '🥭', 'fruit', /mango\w*|mamidi\w*|\baam\b|మామిడి\S*|आम/i],
  ['Apple', 'Apple', '🍎', 'fruit', /apple|seb\b|ఆపిల్|सेब/i],
  ['Papaya', 'Papaya', '🍈', 'fruit', /papaya|boppayi|బొప్పాయి|पपीता/i],
  ['Coconut', 'Coconut', '🥥', 'fruit', /coconut|kobbari|nariyal|కొబ్బరి|नारियल/i],
  ['Lemon', 'Lemon', '🍋', 'fruit', /lemon|nimma\w*|nimbu|నిమ్మ\S*|नींबू/i],
];

/** Words that mean "market price" (with no other task in the sentence). */
export const PRICE_WORDS = /\b(mandi|market ?(price|rate|yard)s?|crop ?prices?|prices?|rates?|bhav|bhaav|dhara\w*|vegetables?|fruits?|sabzi|sabji|kooragay\w*)\b|ధర\S*|రేటు|కూరగాయ\S*|పండ్ల\S*|भाव|मंडी|सब्ज़ी|सब्जी|फल/i;
const OTHER_TASK = /\b(bill|recharge|top ?up|bus|ticket|kisan|electricity|current|power)\b|బిల్లు|రీఛార్జ్|బస్|बिल|रिचार्ज|बस/i;
export const ALL_WORDS = /\ball (crops?|prices?|vegetables?|items?)\b|అన్ని|सभी|सब (भाव|फसल)/i;

/** AP districts and big markets people name (Agmarknet market or district filter). */
const PLACES = ['Guntur', 'Palnadu', 'Narasaraopet', 'Krishna', 'Vijayawada', 'Kurnool', 'Anantapur', 'Prakasam', 'Ongole', 'Nellore', 'Kadapa', 'Chittoor', 'Tirupati', 'Visakhapatnam', 'Vizag', 'East Godavari', 'West Godavari', 'Srikakulam', 'Vizianagaram', 'Hindupur', 'Madanapalle', 'Pattikonda', 'Adoni', 'Duggirala', 'Rajahmundry', 'Kakinada', 'Eluru', 'Tenali', 'Chilakaluripet'];

export function findCrop(text: string): Crop | null {
  // Green chilli is checked before chilli so "green chilli" doesn't become dry chilli.
  const gc = CROPS.find((c) => c[0] === 'Green Chilli')!;
  if (gc[4].test(text)) return gc;
  return CROPS.find((c) => c[0] !== 'Green Chilli' && c[4].test(text)) || null;
}
export function findPlace(text: string): string {
  const p = PLACES.find((x) => new RegExp('\\b' + x + '\\b', 'i').test(text)) || '';
  return p === 'Vizag' ? 'Visakhapatnam' : p;
}

/** What the phone can answer on its own: 'ask' = show crop picker; a crop = fetch it; null = not a price question. */
export function priceIntent(text: string): { crop: string; label: string; emoji: string; place: string } | 'ask' | null {
  if (OTHER_TASK.test(text)) return null;
  const c = findCrop(text);
  const priceWord = PRICE_WORDS.test(text);
  if (ALL_WORDS.test(text) && priceWord) return { crop: 'ALL', label: 'All crops', emoji: '📋', place: findPlace(text) };
  if (c && (priceWord || text.trim().split(/\s+/).length <= 3)) return { crop: c[0], label: c[1], emoji: c[2], place: findPlace(text) };
  // Only clear market words open the picker; a bare "price" (e.g. "iPhone price") goes to the AI.
  if (!c && /\b(mandi|market ?(price|rate|yard)s?|crop ?prices?|vegetables? ?prices?|fruits? ?prices?|bhav|bhaav|dhara\w*)\b|మార్కెట్|కూరగాయ\S*|మండీ|मंडी|भाव/i.test(text)) return 'ask';
  if (/^\s*(prices?|rates?)\s*$/i.test(text)) return 'ask';
  return null;
}
