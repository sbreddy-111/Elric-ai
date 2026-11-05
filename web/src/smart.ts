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
