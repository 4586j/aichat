import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,createConnection } from 'node:net';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readTunnelConfig,tunnelArguments,createTunnelManager } from '../lib/startup.mjs';

const fixture=fileURLToPath(new URL('./fixtures/ssh-tunnel.mjs',import.meta.url));
const modulePath=new URL('../lib/startup.mjs',import.meta.url).href;
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function open(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const finish=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(300,()=>finish(false));});}
async function until(predicate){const deadline=Date.now()+4000;while(Date.now()<deadline){if(await predicate())return;await delay(10);}assert.fail('timed out waiting for lifecycle transition');}
async function managed(t,extra={}){
  const port=await freePort(),children=[],logs=[],warnings=[];
  const manager=createTunnelManager({host:'test-server',forwards:[{local:port,remote:10001}]},{startupTimeoutMs:1500,retryDelayMs:25,pollIntervalMs:10,log:line=>logs.push(line),warn:line=>warnings.push(line),
    spawnImpl:(_command,args,options)=>{const child=spawn(process.execPath,[fixture,...args],options);children.push(child);return child;},...extra});
  t.after(()=>manager.close());return {manager,port,children,logs,warnings};
}

test('local environment is optional and existing process variables take precedence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qiyi-env-'));
  try{
    const path=join(directory,'.env');await writeFile(path,'QIYI_ENV_EXISTING=file-value\nQIYI_ENV_FROM_FILE=local-value\n');
    const script=`import {loadLocalEnvironment} from ${JSON.stringify(modulePath)};console.log(JSON.stringify({missing:loadLocalEnvironment(${JSON.stringify(join(directory,'missing'))}),loaded:loadLocalEnvironment(${JSON.stringify(path)}),existing:process.env.QIYI_ENV_EXISTING,fromFile:process.env.QIYI_ENV_FROM_FILE}));`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,QIYI_ENV_EXISTING:'shell-value'}});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{missing:false,loaded:true,existing:'shell-value',fromFile:'local-value'});
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('SSH is opt-in, config accepts only aliases and loopback port pairs',()=>{
  assert.equal(readTunnelConfig({}),null);assert.equal(readTunnelConfig({MEDIA_SSH_ENABLED:'false'}),null);
  const config=readTunnelConfig({MEDIA_SSH_ENABLED:'true',MEDIA_SSH_HOST:'my-server',MEDIA_SSH_FORWARDS:'4321:4321,11001:10001'});
  assert.deepEqual(config,{host:'my-server',forwards:[{local:4321,remote:4321},{local:11001,remote:10001}]});
  const args=tunnelArguments(config);
  for(const value of ['BatchMode=yes','StrictHostKeyChecking=yes','ExitOnForwardFailure=yes','ControlPath=none','127.0.0.1:4321:127.0.0.1:4321','127.0.0.1:11001:127.0.0.1:10001'])assert.ok(args.includes(value));
  assert.ok(!args.includes('-R'));assert.ok(!args.includes('-g'));
  for(const bad of [{MEDIA_SSH_ENABLED:'yes'},{MEDIA_SSH_HOST:'-oProxyCommand=bad'},{MEDIA_SSH_HOST:'root@host'},{MEDIA_SSH_FORWARDS:'0:4321'},{MEDIA_SSH_FORWARDS:'65536:4321'},{MEDIA_SSH_FORWARDS:'4321:1,4321:2'},{MEDIA_SSH_FORWARDS:'0.0.0.0:4321:host:80'}]){
    assert.throws(()=>readTunnelConfig({MEDIA_SSH_ENABLED:'true',MEDIA_SSH_HOST:'server',MEDIA_SSH_FORWARDS:'4321:4321',...bad}));
  }
});

test('disabled manager starts no child',async()=>{
  const manager=createTunnelManager(null,{spawnImpl:()=>assert.fail('SSH must remain disabled')});assert.equal(await manager.start(),false);assert.deepEqual(manager.status(),{enabled:false,connected:false});await manager.close();
});

test('owned tunnel starts hidden without a shell or service secrets and releases its port on close',async t=>{
  let optionsSeen;
  const f=await managed(t,{env:{...process.env,MUSIC_API_KEY:'test-music-secret',STICKER_API_KEY:'test-sticker-secret',SMTP_PASSWORD:'test-password',VISIBLE_TEST_VALUE:'preserved'},spawnImpl:(_command,args,options)=>{
    optionsSeen=options;return spawn(process.execPath,[fixture,...args],options);
  }});
  assert.equal(await f.manager.start(),true);assert.equal(await open(f.port),true);assert.equal(await f.manager.start(),true);
  assert.equal(optionsSeen.windowsHide,true);assert.equal(optionsSeen.shell,false);assert.equal(optionsSeen.env.MUSIC_API_KEY,undefined);assert.equal(optionsSeen.env.STICKER_API_KEY,undefined);assert.equal(optionsSeen.env.SMTP_PASSWORD,undefined);assert.equal(optionsSeen.env.VISIBLE_TEST_VALUE,'preserved');
  await f.manager.close();assert.equal(await open(f.port),false);assert.equal(f.manager.status().connected,false);
});

test('an existing listener is neither adopted nor terminated',async t=>{
  const server=createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const manager=createTunnelManager({host:'test-server',forwards:[{local:server.address().port,remote:10001}]},{spawnImpl:()=>assert.fail('must not spawn against an occupied port'),warn:()=>{},retryDelayMs:50});t.after(()=>manager.close());
  assert.equal(await manager.start(),false);assert.equal(manager.status().connected,false);assert.equal(await open(server.address().port),true);await manager.close();assert.equal(await open(server.address().port),true);
});

test('a dropped child reconnects, and stopping the manager prevents further retries',async t=>{
  const f=await managed(t);assert.equal(await f.manager.start(),true);f.children[0].kill();
  await until(()=>f.children.length>=2&&f.manager.status().connected);
  assert.ok(f.warnings.some(line=>line.includes('自动重连')));assert.equal(await open(f.port),true);
  await f.manager.close();const count=f.children.length;await delay(100);assert.equal(f.children.length,count);assert.equal(await open(f.port),false);
});

test('failed SSH startup stays bounded, retries in the background, and sanitizes diagnostics',async t=>{
  let count=0;
  const f=await managed(t,{spawnImpl:(_command,args,options)=>{count++;return count===1?spawn(process.execPath,['-e',"console.error('private-provider-diagnostic');process.exit(255)"],options):spawn(process.execPath,[fixture,...args],options);}});
  assert.equal(await f.manager.start(),false);await until(()=>f.manager.status().connected);
  assert.ok(count>=2);assert.ok(!JSON.stringify(f.warnings).includes('private-provider-diagnostic'));
});

test('closing during connection attempts kills the pending child and cancels reconnect',async t=>{
  let child;
  const f=await managed(t,{spawnImpl:(_command,_args,options)=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],options);return child;}});
  const pending=f.manager.start();await until(()=>Boolean(child));await f.manager.close();assert.equal(await pending,false);assert.equal(f.manager.status().connected,false);
});
