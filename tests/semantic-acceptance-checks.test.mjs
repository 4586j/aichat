import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDietConstraint} from '../scripts/semantic-acceptance-checks.mjs';
test('diet acceptance distinguishes explicit warnings from recommended compromises',()=>{
 for(const text of ['你不吃辣，完全不放辣椒。','你不吃辣，光说“微辣”对你来说仍可能偏辣。','你不吃辣，不要点微辣。']) assert.equal(checkDietConstraint(text).pass,true,text);
 for(const text of ['你不吃辣，可以做少辣或不放辣椒。','你不吃辣，建议点微辣。','你不吃辣，不要太辣，可以选微辣。','你不吃辣，少辣也许可以。']) assert.equal(checkDietConstraint(text).pass,false,text);
 assert.equal(checkDietConstraint('微辣即可。').pass,false);
 assert.equal(checkDietConstraint('不辣。').requiresContentReview,true);
 assert.equal(checkDietConstraint('不吃辣，不少辣味藏在蘸料里，不要加蘸料。').pass,true);
});
