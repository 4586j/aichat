// Only validate numbered references in prose; code examples remain literal.
export function validateCitations(text, sourceCount) {
  let fence = null;
  return text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence=marker;
      else if (marker[0]===fence[0] && marker.length>=fence.length) fence=null;
      return line;
    }
    if (fence) return line;
    let ticks=0;
    return line.replace(/(`+)|\[(\d+)\]/gu,(match,code,number)=>{
      if (code) { if (!ticks) ticks=code.length; else if (ticks===code.length) ticks=0; return match; }
      if (ticks) return match;
      const index=Number(number);
      return Number.isSafeInteger(index) && index>=1 && index<=sourceCount ? match : '';
    });
  }).join('\n');
}
