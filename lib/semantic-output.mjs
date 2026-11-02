import { AppError } from './model.mjs';
import { STATE_OPTIONS } from './chat-state.mjs';

const closed=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
function predictionSchema(messageIds) {
 const evidence={type:'array',items:closed({messageId:{type:['string','integer'],enum:['current',...messageIds,...messageIds.map(String)]},quote:{type:'string'}})};
 return {anyOf:[closed(Object.fromEntries(Object.entries(STATE_OPTIONS).map(([key,options])=>{
  const value={type:'string',enum:Object.keys(options)};
  return [key,{anyOf:[closed({value:key==='emotion'?{type:'array',items:value}:value,...(key==='emotion'?{intensity:{type:['integer','null'],enum:[1,2,3,4,5,null]}}:{}),confidence:{type:'string',enum:['low','medium','high']},evidence}),{type:'null'}]}];
 }))),{type:'null'}]};
}

// The provider's structured-output support is capability-gated by the caller.
export function answerSchema(candidates,sourceCount,{stateEnabled=true,stateMessageIds=[]}={}) {
 const choice=(decision,candidate)=>({type:'object',properties:{decision:{type:'string',enum:[decision]},candidate},required:['decision','candidate'],additionalProperties:false});
 const none=choice('none',{type:'null'}),ids=Object.keys(candidates);
 // Ark supports enum and anyOf, but not all length/range keywords. Keep
 // resource limits in the parser and constrain actual identifiers on the wire.
 const sourceIds=sourceCount ? {type:'array',items:{type:'integer',enum:Array.from({length:sourceCount},(_,i)=>i+1)}} : {type:'array',items:{type:'integer'},enum:[[]]};
 return {type:'object',properties:{
  paragraphs:{type:'array',items:{type:'object',properties:{text:{type:'string'},sourceIds},required:['text','sourceIds'],additionalProperties:false}},
  sticker:ids.length?{anyOf:[choice('select',{type:'string',enum:ids}),none]}:none,
  state:stateEnabled?predictionSchema(stateMessageIds):{type:'null'},
 },required:['paragraphs','sticker','state'],additionalProperties:false};
}

const invalid=()=>new AppError('模型返回的结构化回答无效，请重试。',502);
function paragraph(value,count) {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join(',')!=='sourceIds,text' || typeof value.text!=='string' || !value.text.trim() || value.text.length>12000 || !Array.isArray(value.sourceIds) || value.sourceIds.length>8 || value.sourceIds.some(n=>!Number.isSafeInteger(n)||n<1||n>count))throw invalid();
 // IDs are validated here; they still do not establish factual entailment.
 return value.text.trim()+[...new Set(value.sourceIds)].map(n=>` [${n}]`).join('');
}
export function parseSemanticOutput(raw,candidates,sourceCount) {
 let result;try {result=JSON.parse(raw);}catch{throw invalid();}
 if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='paragraphs,state,sticker'||!Array.isArray(result.paragraphs)||!result.paragraphs.length||result.paragraphs.length>20)throw invalid();
 const content=result.paragraphs.map(item=>paragraph(item,sourceCount)).join('\n\n');
 const choice=result.sticker;
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||Object.keys(choice).sort().join(',')!=='candidate,decision'||!['select','none'].includes(choice.decision))throw invalid();
 let stickerId;
 if(choice.decision==='select') {if(typeof choice.candidate!=='string'||!Object.hasOwn(candidates,choice.candidate))throw invalid();stickerId=candidates[choice.candidate];}
 else if(choice.candidate!==null)throw invalid();
 if(result.state!==null && (typeof result.state!=='object'||Array.isArray(result.state)||JSON.stringify(result.state).length>8000))throw invalid();
 // Field values, quotes, manual overrides and expiry are checked by chat-state.
 return {content,stickerId,prediction:result.state};
}

// Emit only complete, validated paragraph objects, never partial JSON syntax.
export function completedParagraphs(raw,sourceCount) {
 const start=/^\s*\{\s*"paragraphs"\s*:\s*\[/u.exec(raw);if(!start)return [];
 const output=[];let i=start[0].length;
 while(i<raw.length) {
  while(i<raw.length && /[\s,]/u.test(raw[i]))i++;
  if(raw[i]!== '{')break;
  const begin=i;let depth=0,quoted=false,escaped=false,done=false;
  for(;i<raw.length;i++) {const c=raw[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}' && --depth===0){i++;done=true;break;}}
  if(!done)break;
  let item;try{item=JSON.parse(raw.slice(begin,i));}catch{break;}
  output.push(paragraph(item,sourceCount));if(output.length>20)throw invalid();
 }
 return output;
}

export function streamingParagraphs(raw, sourceCount) {
  const start = /^\s*\{\s*"paragraphs"\s*:\s*\[/u.exec(raw);
  if (!start) return [];
  const output = [];
  let i = start[0].length;
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/u.test(raw[i])) i++;
    if (raw[i] !== '{') break;
    const begin = i;
    let depth = 0, quoted = false, escaped = false, done = false;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { i++; done = true; break; }
    }
    if (done) {
      let item;
      try { item = JSON.parse(raw.slice(begin, i)); } catch { break; }
      output.push(paragraph(item, sourceCount));
      if (output.length > 20) throw invalid();
    } else {
      const partial = raw.slice(begin);
      const textMatch = /"text"\s*:\s*"/u.exec(partial);
      if (textMatch) {
        let preview = '', p = textMatch.index + textMatch[0].length;
        while (p < partial.length) {
          const ch = partial[p];
          if (ch === '"') break;
          if (ch === '\\') {
            if (p + 1 >= partial.length) break;
            const esc = partial[p + 1];
            if (esc === 'u') {
              if (p + 6 > partial.length) break;
              const code = Number.parseInt(partial.slice(p + 2, p + 6), 16);
              if (Number.isFinite(code)) preview += String.fromCharCode(code);
              p += 6; continue;
            }
            preview += ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[esc] ?? esc);
            p += 2; continue;
          }
          preview += ch; p++;
        }
        if (preview.trim()) output.push(preview);
      }
      break;
    }
  }
  return output;
}
