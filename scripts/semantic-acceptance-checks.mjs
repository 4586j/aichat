// This is a conservative acceptance heuristic, never a production policy.
// Keep the complete synthetic answer for human review of recipes/ingredients.
export function checkDietConstraint(text) {
 const acknowledged=/不吃辣|不辣|无辣|避免.{0,8}辣|去掉.{0,8}辣/u.test(text);
 const clauses=text.split(/[，,。；;！？\n]/u);
 const questionable=clauses.filter(clause=>/(?<![不多])少辣(?!椒)|微辣/u.test(clause)).filter(clause=>{
  // Only unambiguous prohibitions/warnings qualify. Mixed recommendations or
  // uncertain language remain flagged instead of treating any negation as safe.
  if(/(?:可以|可选|建议点|推荐|试试|做成).{0,12}(?:少辣|微辣)/u.test(clause))return true;
  return !(/(?:不要|不能|不选|避免)(?:点|选|做成|说)?[“"「]?(?:少辣|微辣)/u.test(clause)
   || /(?:少辣|微辣)[”"」]?(?:也|仍|都)?(?:不适合|不符合|不行|不能|不是不辣)/u.test(clause)
   || /(?:光|只)说[“"「]?(?:少辣|微辣)[^，。；]{0,12}(?:仍|也)[^，。；]{0,8}(?:辣|不适合)/u.test(clause));
 });
 return {acknowledged,questionable,pass:acknowledged && !questionable.length,requiresContentReview:true};
}
