// Which questions are "hard" for the small on-device model: multi-step maths/science/reasoning and recent
// facts. With Online answers on, these wait longer for the online answer (and retry once) before the
// device answers instead.

const MATH = /\b(solve|calculate|compute|how (many|much|long|far|fast)|what time|percent|percentage|profit|loss|discount|markup|interest|ratio|average|speed|km\/h|kmph|distance|area|volume|perimeter|equation|probability|lcm|hcf|emi|gst|train|catch|overtake|marked price|cost price|selling price|original price)\b|%|×|÷|\d\s*[-+*/^x]\s*\d|हल|गणना|प्रतिशत|लाभ|हानि|छूट|ब्याज|अनुपात|औसत|गति|दूरी|क्षेत्रफल|मूल्य/i;
const REASON = /\b(step by step|show steps|prove|derive|balance (the |this )?(chemical )?equation|explain why|why does|why do|acceleration|velocity|momentum|circuit|molar|moles|logic|puzzle|riddle)\b|चरणबद्ध|सिद्ध/i;
const RECENT = /\b(today|latest|current(ly)?|recent(ly)?|news|this (week|month|year)|who won|winner|results?|score|price|rate|election|20[2-9]\d)\b|आज|ताज़ा|ताजा|खबर|समाचार|चुनाव|नतीजा|कीमत/i;

export function isHard(q: string): boolean {
  const nums = (q.match(/\d+(\.\d+)?/g) || []).length;
  return (nums >= 2 && MATH.test(q)) || REASON.test(q) || RECENT.test(q);
}

// "Make an image of …" (pictures, not diagrams: those are drawn in the chat as Mermaid).
const IMG_EN = /\b(make|create|generate|draw|paint|design|show me|give me)\b[^.?!]{0,25}?\b(an? |the |some )?(image|picture|photo|pic|illustration|drawing|painting|artwork|wallpaper|poster)s?\b|^\s*(an? )?(image|picture|photo|illustration) of\b/i;
const IMG_HI = /(तस्वीर|चित्र|फ़ोटो|फोटो|इमेज|पिक्चर)[^.?!।]{0,20}(बनाओ|बनाइए|बनाइये|बनाएं|बनाएँ|बना दो|बना दीजिए|दिखाओ)|(बनाओ|बनाइए|बनाएं|बनाएँ)[^.?!।]{0,25}(तस्वीर|चित्र|इमेज)/;
const IMG_HINGLISH = /\b(image|photo|tasveer|tasvir|chitra|pic|picture)\b[^.?!]{0,20}\b(bana|banao|bana do|banado|banaiye|banaye)\b/i;
const NOT_IMG = /\b(diagram|flow ?chart|chart|graph|mind ?map|timeline|table|map of the process)\b|आरेख|फ्लोचार्ट/i;

export function isImageRequest(q: string): boolean {
  if (q.length > 500 || NOT_IMG.test(q)) return false;
  return IMG_EN.test(q) || IMG_HI.test(q) || IMG_HINGLISH.test(q);
}
