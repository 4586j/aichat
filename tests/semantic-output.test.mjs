import test from 'node:test';
import assert from 'node:assert/strict';
import {answerSchema,completedParagraphs,parseSemanticOutput} from '../lib/semantic-output.mjs';

const valid={paragraphs:[{text:'先报到。',sourceIds:[1]},{text:'继续。',sourceIds:[]}],sticker:{decision:'select',candidate:'S1'},state:null};
test('structured output resolves only a current candidate and renders citations',()=>{
 const out=parseSemanticOutput(JSON.stringify(valid),{S1:'real-id'},1);
 assert.equal(out.content,'先报到。 [1]\n\n继续。');assert.equal(out.stickerId,'real-id');
 for(const sticker of [{decision:'select',candidate:'S2'},{decision:'none',candidate:'S1'}])assert.throws(()=>parseSemanticOutput(JSON.stringify({...valid,sticker}),{S1:'real-id'},1),/结构化回答无效/u);
 assert.throws(()=>parseSemanticOutput(JSON.stringify({...valid,paragraphs:[{text:'伪造',sourceIds:[2]}]}),{S1:'real-id'},1),/结构化回答无效/u);
 assert.throws(()=>parseSemanticOutput('{"paragraphs":',{},0),/结构化回答无效/u);
 assert.throws(()=>parseSemanticOutput(JSON.stringify({...valid,sticker:{decision:'none',candidate:null}}),{},0),/结构化回答无效/u);
});
test('per-turn schema forbids nonexistent sources and pairs sticker decision with current aliases',()=>{
 const empty=answerSchema({},0,{stateEnabled:false}).properties;
 assert.deepEqual(empty.paragraphs.items.properties.sourceIds.enum,[[]]);
 assert.deepEqual(empty.sticker.properties.decision.enum,['none']);
 assert.deepEqual(empty.sticker.properties.candidate,{type:'null'});
 assert.deepEqual(empty.state,{type:'null'});
 const filled=answerSchema({S1:'real-id',S2:'other-id'},2).properties;
 assert.deepEqual(filled.paragraphs.items.properties.sourceIds.items.enum,[1,2]);
 const [select,none]=filled.sticker.anyOf;
 assert.deepEqual(select.properties.decision.enum,['select']);
 assert.deepEqual(select.properties.candidate.enum,['S1','S2']);
 assert.deepEqual(none.properties.candidate,{type:'null'});
 assert.ok(!JSON.stringify(filled).includes('real-id'));
});
test('state is a typed object, with separately grounded evidence and no JSON string wrapper',()=>{
 const state={need:{value:'task',confidence:'high',evidence:[{messageId:'current',quote:'帮我'}]}};
 assert.deepEqual(parseSemanticOutput(JSON.stringify({...valid,state}),{S1:'real'},1).prediction,state);
 assert.throws(()=>parseSemanticOutput(JSON.stringify({...valid,state:JSON.stringify(state)}),{S1:'real'},1),/结构化回答无效/u);
 const schema=answerSchema({},0,{stateMessageIds:[7]}).properties.state.anyOf[0];
 assert.deepEqual(schema.properties.need.anyOf[0].properties.evidence.items.properties.messageId.enum,['current',7,'7']);
});
test('incremental output emits only complete paragraphs with validated source IDs',()=>{
 const raw=JSON.stringify(valid);
 const end=raw.indexOf('},{')+1;
 assert.deepEqual(completedParagraphs(raw.slice(0,end),1),['先报到。 [1]']);
 assert.deepEqual(completedParagraphs(raw,1),['先报到。 [1]','继续。']);
 assert.deepEqual(completedParagraphs('{"paragraphs":[{"text":"未完成',1),[]);
});
