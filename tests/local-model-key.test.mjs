import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';

test('local model key survives restart, rotation and explicit clearing, without appearing in settings', async t => {
  const dir=await mkdtemp(join(tmpdir(),'qiyi-model-key-'));
  const path=join(dir,'model-key.local'), store=createStore(join(dir,'app.sqlite'));
  let api;const headers=[];
  const options={apiKey:'ENVIRONMENT_TEST_KEY',modelKeyStore:createLocalModelKey(path),fetchImpl:async (_url,init)=>{
    headers.push(init.headers.Authorization||'');return Response.json({choices:[{message:{content:'ok'}}]});
  }};
  const stop=async()=>{if(api)await api.scheduler.stop();};
  t.after(async()=>{await stop();store.close();await rm(dir,{recursive:true,force:true});});
  api=createService(store,options);api.updateSettings({baseUrl:'https://model.invalid/v1',model:'test'});
  await api.testModel();assert.equal(headers.at(-1),'Bearer ENVIRONMENT_TEST_KEY');
  const saved=api.updateSettings({apiKey:'LOCAL_TEST_SECRET'});assert.equal(saved.settings.hasApiKey,true);
  assert.ok(!JSON.stringify(saved).includes('LOCAL_TEST_SECRET'));
  assert.ok(!JSON.stringify(store.settings()).includes('LOCAL_TEST_SECRET'));
  if(process.platform==='win32')assert.ok(!(await readFile(path)).includes(Buffer.from('LOCAL_TEST_SECRET')));
  await stop();api=createService(store,options);await api.testModel();assert.equal(headers.at(-1),'Bearer LOCAL_TEST_SECRET');
  api.updateSettings({apiKey:''});await api.testModel();assert.equal(headers.at(-1),'Bearer LOCAL_TEST_SECRET');
  api.updateSettings({apiKey:'ROTATED_TEST_SECRET'});await stop();api=createService(store,options);await api.testModel();assert.equal(headers.at(-1),'Bearer ROTATED_TEST_SECRET');
  api.updateSettings({clearApiKey:true});await stop();api=createService(store,options);assert.equal(api.model.settings().hasApiKey,false);await api.testModel();assert.equal(headers.at(-1),'');
});

test('a failed key write does not change the runtime key or ordinary settings', async t=>{
  const store=createStore(':memory:');const api=createService(store,{apiKey:'ORIGINAL_TEST_KEY',modelKeyStore:{read:()=>null,write:()=>{throw new Error('write failed');}}});
  t.after(async()=>{await api.scheduler.stop();store.close();});
  assert.throws(()=>api.updateSettings({model:'new-model',apiKey:'NEW_TEST_KEY'}),/write failed/u);
  assert.notEqual(api.model.settings().model,'new-model');assert.equal(api.model.settings().hasApiKey,true);
});
