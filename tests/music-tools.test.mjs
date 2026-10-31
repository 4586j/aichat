import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, addConversation, addMessages, deferred, errorStatus, modelResponse } from './helpers.mjs';
import { mockMediaFetch } from './media-fixtures.mjs';

const call = (query = '安静片刻', extra = {}) => ({ id: 'music_call_1', type: 'function', function: { name: 'search_music', arguments: JSON.stringify({ query, ...extra }) } });
const toolReply = (tool = call(), content = null) => new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content, tool_calls: [tool] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } });
const streamTool = () => {
  const frames = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'music_call_1', type: 'function', function: { name: 'search_music', arguments: '{"qu' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ery":"安静' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '片刻"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  return new Response(frames.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
};
function setup(t, replies, options = {}) {
  const requests = [];
  const f = fixture(t, replies, { musicApiKey: '', stickerApiKey: '', mediaFetchImpl: async (url, init) => { requests.push(new URL(url)); return mockMediaFetch(url, init); }, ...options });
  f.api.updateSettings({ musicToolMode: 'native' });
  f.api.media.update({ musicBaseUrl: 'http://music-fixture.invalid' });
  return { ...f, requests, conversationId: addConversation(f.api, f.personaId) };
}
const songs = message => message.attachments.filter(item => ['song', 'song-search'].includes(item.type));
const send = (f, content = '播放《安静片刻》', options) => f.api.sendMessage(f.conversationId, { content }, options);
function relaxed(f) {
  const state = f.api.getChatState({ personaId: f.personaId, conversationId: f.conversationId }).chatState;
  f.api.updateChatState({ personaId: f.personaId, conversationId: f.conversationId, patch: { expectedManualRevision: state.manualRevision, fields: { need: { value: 'chat' }, emotion: { value: ['calm'], intensity: 1 } } } });
  addMessages(f.store, f.conversationId, Array.from({ length: 8 }, (_, i) => i % 2 ? '好的。' : '继续聊聊。'));
}

for (const streaming of [false, true]) test(`native music completes one lookup and two model requests (streaming=${streaming})`, async t => {
  const f = setup(t, [streaming ? streamTool() : toolReply(), '已找到歌曲，请点击卡片播放。\n<qiyi-media>{"songQuery":"别的歌曲"}</qiyi-media>']);
  const events = [];
  const result = await send(f, undefined, streaming ? { onEvent: event => events.push(event) } : undefined);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.tools[0].function.name, 'search_music');
  assert.equal(f.calls[0].body.parallel_tool_calls, false);
  assert.equal(f.calls[1].body.tool_choice, 'none');
  const tool = f.calls[1].body.messages.find(row => row.role === 'tool');
  assert.equal(tool.tool_call_id, 'music_call_1');
  const value = JSON.parse(tool.content);
  assert.equal(value.status, 'found');
  assert.equal(value.requiresClick, true);
  assert.deepEqual(Object.keys(value.song).sort(), ['artist', 'id', 'title']);
  assert.equal(value.song.title, '安静片刻');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].pathname, '/api/library');
  assert.equal(songs(result.message).length, 1);
  assert.equal(result.message.content, '已找到歌曲，请点击卡片播放。');
  assert.equal(f.api.getConversation(f.conversationId).messages.length, 2);
  assert.ok(events.every(event => !JSON.stringify(event).includes('music_call_1')));
  if (streaming) assert.ok(events.some(event => event.phase === 'finalizing'));
});

for (const mode of ['tags', 'native']) for (const content of ['放歌', '播放《安静片刻》']) test(`${mode} text-only reply falls back once for ${content}`, async t => {
  const f = setup(t, ['这里有一张歌曲卡片，点击后播放。']);
  f.api.updateSettings({ musicToolMode: mode });
  const result = await send(f, content, { onEvent: () => {} });
  assert.equal(f.calls.length, 1);
  assert.equal(songs(result.message).length, 1);
  assert.equal(f.requests.filter(url => url.pathname === '/api/library').length, 1);
  assert.ok(f.requests.every(url => !['/api/local_play', '/api/stream'].includes(url.pathname)));
  if (mode === 'tags') assert.equal(f.calls[0].body.tools, undefined);
});

test('an explicit title overrides a different model tool query without exposing the rest of the turn', async t => {
  const f = setup(t, [toolReply(call('换一首别的')), '请点击歌曲卡片。']);
  await send(f, '播放《安静片刻》，然后我们聊一下私人计划。');
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.calls[1].body.messages.find(row => row.role === 'tool').content).query, '安静片刻');
  assert.ok(f.requests.every(url => !url.href.includes('私人计划')));
});

for (const content of ['不要播放《安静片刻》', '别放《晴天》', '如何实现放歌功能？', '音乐服务怎么设置', '我在做音乐平台项目', '示例：播放《晴天》', '> 播放《晴天》', '```text\n播放《晴天》\n```']) test(`blocked request stays blocked after the proactive interval: ${content}`, async t => {
  const f = setup(t, ['这里只讨论你的问题。\n<qiyi-media>{"songQuery":"安静片刻"}</qiyi-media>']);
  relaxed(f);
  const result = await send(f, content, { onEvent: () => {} });
  assert.equal(f.calls[0].body.tools, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(songs(result.message).length, 0);
});

test('master off hides tools and blocks even explicit fallback', async t => {
  const f = setup(t, ['请先在设置中开启音乐。']);
  f.api.media.update({ musicEnabled: false });
  const result = await send(f, undefined, { onEvent: () => {} });
  assert.equal(f.calls[0].body.tools, undefined);
  assert.equal(f.requests.length, 0);
  assert.equal(songs(result.message).length, 0);
});

test('unexpected tool calls when tools are withheld are rejected without lookup', async t => {
  const f = setup(t, [toolReply()]);
  f.api.media.update({ musicEnabled: false });
  await assert.rejects(send(f), errorStatus(502));
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.getConversation(f.conversationId).messages.length, 0);
});

test('explicit requests still work with proactive music disabled', async t => {
  const f = setup(t, [toolReply(), '点击后播放。']);
  f.api.responsePolicy.update({ expectedRevision: 0, musicLinked: false });
  assert.equal(songs((await send(f)).message).length, 1);
  assert.equal(f.requests.length, 1);
});

for (const query of ['', 'x'.repeat(121), 'http://private.invalid/secret', 'a\nb', 'data:text/plain,hello']) test(`invalid music arguments never execute: ${query.slice(0, 25)}`, async t => {
  const f = setup(t, [toolReply(call(query))]);
  await assert.rejects(send(f), errorStatus(502));
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.api.getConversation(f.conversationId).messages.length, 0);
});

test('additional tool arguments are rejected rather than treated as playback options', async t => {
  const f = setup(t, [toolReply(call('安静片刻', { autoplay: true }))]);
  await assert.rejects(send(f), errorStatus(502));
  assert.equal(f.requests.length, 0);
});

test('second-round repeated tool call fails without a third request or second search', async t => {
  const f = setup(t, [toolReply(), toolReply()]);
  await assert.rejects(send(f), errorStatus(502));
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.api.getConversation(f.conversationId).messages.length, 0);
});

test('provider error is not retried in tag mode or another model request', async t => {
  const f = setup(t, [new Response('private error', { status: 400 })]);
  await assert.rejects(send(f), errorStatus(502));
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests.length, 0);
});

test('missing service returns one pending card and a bounded tool result', async t => {
  const f = setup(t, [toolReply(), '音乐服务未配置，请先配置。']);
  f.api.media.update({ musicBaseUrl: '' });
  const result = await send(f);
  assert.equal(songs(result.message)[0].type, 'song-search');
  assert.equal(f.requests.length, 0);
  assert.equal(JSON.parse(f.calls[1].body.messages.find(row => row.role === 'tool').content).status, 'unavailable');
});

test('failed music lookup returns a pending card and cannot trigger tag retry', async t => {
  let count = 0;
  const f = setup(t, [toolReply(), '暂不可用。\n<qiyi-media>{"songQuery":"再试一次"}</qiyi-media>'], { mediaFetchImpl: async () => { count++; return new Response('{}', { status: 503 }); } });
  const result = await send(f);
  assert.equal(songs(result.message)[0].type, 'song-search');
  assert.equal(count, 2, 'one logical search: local library then online provider');
  assert.equal(f.calls.length, 2);
});

test('turning music off while the model waits prevents tool execution and fallback', async t => {
  const gate = deferred();
  const f = setup(t, [() => gate.promise, '音乐已关闭。']);
  const pending = send(f);
  f.api.media.update({ musicEnabled: false });
  gate.resolve(toolReply());
  const result = await pending;
  assert.equal(f.requests.length, 0);
  assert.equal(songs(result.message).length, 0);
  assert.equal(JSON.parse(f.calls[1].body.messages.find(row => row.role === 'tool').content).status, 'blocked');
});

for (const change of ['off', 'service', 'source']) test(`music ${change} during final answer discards stale tool card`, async t => {
  const gate = deferred(), started = deferred();
  const f = setup(t, [toolReply(), () => { started.resolve(); return gate.promise; }]);
  const pending = send(f);
  await started.promise;
  f.api.media.update(change === 'off' ? { musicEnabled: false } : change === 'service' ? { musicBaseUrl: 'http://changed.invalid' } : { musicSource: 'netease' });
  gate.resolve(modelResponse('请确认当前音乐配置。'));
  const result = await pending;
  assert.equal(songs(result.message).length, 0);
  assert.equal(f.requests.length, 1);
});

test('cancellation during lookup cancels the body and stops follow-up and persistence', async t => {
  const started = deferred();
  let cancelled = false;
  const f = setup(t, [toolReply()], { mediaFetchImpl: async () => new Response(new ReadableStream({ start() { started.resolve(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }) });
  const controller = new AbortController();
  const pending = send(f, undefined, { signal: controller.signal, onEvent: () => {} });
  await started.promise;
  controller.abort();
  await assert.rejects(pending, errorStatus(499));
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.api.getConversation(f.conversationId).messages.length, 0);
});

for (const mode of ['tags', 'native', 'native-fallback']) for (const found of [false, true]) test(`${mode} exact requests skip fuzzy local matches and reject unrelated online results (found=${found})`, async t => {
  const paths = [];
  const f = setup(t, mode === 'native' ? [toolReply(call('晴天')), '请点击准确匹配的歌曲。'] : ['已处理本轮点歌。'], {
    mediaFetchImpl: async url => {
      const { pathname } = new URL(url); paths.push(pathname);
      return Response.json(pathname === '/api/library' ? { files: [{ name: 'different.wav', title: '晴天的另一首歌', singer: '周杰伦' }] }
        : { songs: [{ songmid: 'different', songname: '晴天的另一首歌', singer: '周杰伦' }, ...(found ? [{ songmid: 'correct', songname: '晴天', singer: '周杰伦' }] : [])] });
    },
  });
  f.api.updateSettings({ musicToolMode: mode === 'tags' ? 'tags' : 'native' });
  const result = await send(f, '播放《晴天》');
  assert.deepEqual(paths, ['/api/library', '/api/search']);
  assert.equal(songs(result.message).length, 1);
  const card = songs(result.message)[0];
  assert.equal(card.type, found ? 'song' : 'song-search');
  if (found) assert.equal(card.song.title, '晴天');
  else assert.equal(card.query, '晴天');
  assert.equal(f.calls.length, mode === 'native' ? 2 : 1);
});

test('an unquoted artist and title match the named artist rather than a fuzzy title', async t => {
  const f = setup(t, [toolReply(), '点击卡片后播放。'], { mediaFetchImpl: async () => Response.json({ files: [
    { name: 'wrong.wav', title: '晴天', singer: '另一位歌手' }, { name: 'correct.wav', title: '晴天', singer: '周杰伦' },
  ] }) });
  const result = await send(f, '播放周杰伦的晴天');
  assert.equal(songs(result.message)[0].song.artist, '周杰伦');
  assert.equal(songs(result.message)[0].song.title, '晴天');
});

for (const mode of ['tags', 'native', 'native-fallback']) test(`${mode} respects the artist in a quoted title`, async t => {
  const f = setup(t, mode === 'native' ? [toolReply(call('别的歌')), '点击卡片后播放。'] : ['点击卡片后播放。'], { mediaFetchImpl: async () => Response.json({ files: [
    { name: 'wrong.wav', title: '晴天', singer: '另一位歌手' }, { name: 'correct.wav', title: '晴天', singer: '周杰伦' },
  ] }) });
  f.api.updateSettings({ musicToolMode: mode === 'tags' ? 'tags' : 'native' });
  const card = songs((await send(f, '播放周杰伦的《晴天》')).message)[0];
  assert.equal(card.type, 'song');assert.equal(card.song.artist, '周杰伦');assert.equal(card.song.title, '晴天');
});

for (const mode of ['tags', 'native', 'native-fallback']) test(`${mode} does not send an unpunctuated private detail as a search query`, async t => {
  const requests=[];
  const privateTurn='播放晴天我今天确诊了糖尿病';
  const f=setup(t, mode === 'native' ? [toolReply(call(privateTurn)), '点击后播放。'] : [mode === 'tags' ? `正文\n<qiyi-media>${JSON.stringify({songQuery:privateTurn})}</qiyi-media>` : '正文'], {
    mediaFetchImpl: async url => {requests.push(new URL(url));return Response.json(new URL(url).pathname === '/api/library' ? {files:[]} : {songs:[]});},
  });
  f.api.updateSettings({musicToolMode:mode === 'tags' ? 'tags' : 'native'});
  const card=songs((await send(f,privateTurn)).message)[0];
  assert.equal(card.type,'song-search');assert.equal(card.query,'轻音乐');
  assert.equal(requests.find(url=>url.pathname==='/api/search').searchParams.get('keyword'),'轻音乐');
  assert.ok(requests.every(url=>!url.href.includes(encodeURIComponent('糖尿病'))));
});

test('a music style request creates a card with its own search term without a model footer',async t=>{
  const f=setup(t,['点击后播放。']);f.api.updateSettings({musicToolMode:'tags'});
  const result=await send(f,'放点摇滚');
  assert.equal(songs(result.message).length,1);
  assert.equal(f.requests.find(url=>url.pathname==='/api/search')?.searchParams.get('keyword'),'摇滚');
});

for (const mode of ['tags', 'native']) test(`${mode} carries a singer correction from the immediately preceding song request`,async t=>{
  const requests=[];
  const replies=mode==='native' ? ['请点击卡片。',toolReply(call('错误的歌')), '请点击卡片。'] : ['请点击卡片。','请点击卡片。'];
  const f=setup(t,replies,{mediaFetchImpl:async url=>{
    const parsed=new URL(url);requests.push(parsed);
    return Response.json(parsed.pathname==='/api/library' ? {files:[{name:'old.wav',title:'沦陷',singer:'王靖雯'}]}
      : {songs:[{songmid:'wrong',songname:'沦陷',singer:'其他歌手'},{songmid:'correct',songname:'沦陷 (未来的每一天都多爱你一遍)',singer:'贾格JuggShots'}]});
  }});
  f.api.updateSettings({musicToolMode:mode});
  assert.equal(songs((await send(f,'播放沦陷')).message)[0].song.artist,'王靖雯');
  const result=await send(f,'贾格的',{onEvent:()=>{}});
  const card=songs(result.message)[0];assert.equal(card.type,'song');assert.equal(card.song.artist,'贾格JuggShots');
  assert.equal(requests.find(url=>url.pathname==='/api/search').searchParams.get('keyword'),'沦陷 贾格');
  assert.equal(result.message.responseBehavior.explicitSong,true);
});

test('a singer correction without a matching result yields a pending card instead of the wrong singer',async t=>{
  const f=setup(t,['好的。','好的。'],{mediaFetchImpl:async url=>Response.json(new URL(url).pathname==='/api/library'
    ? {files:[{name:'old.wav',title:'沦陷',singer:'王靖雯'}]} : {songs:[{songmid:'wrong',songname:'沦陷',singer:'其他歌手'}]})});
  f.api.updateSettings({musicToolMode:'tags'});await send(f,'播放沦陷');
  const card=songs((await send(f,'贾格的')).message)[0];assert.equal(card.type,'song-search');assert.equal(card.query,'沦陷 贾格');
});

test('a short reply after ordinary conversation does not cause music searches',async t=>{
  const f=setup(t,['普通聊天回复。','普通聊天回复。']);f.api.updateSettings({musicToolMode:'tags'});
  await send(f,'你好');const result=await send(f,'贾格的');
  assert.equal(songs(result.message).length,0);assert.equal(f.requests.length,0);
});

for (const mode of ['tags','native']) test(`${mode} uses the model's grounded singer extraction for a natural correction`,async t=>{
  const urls=[];
  const responses=mode==='tags' ? ['好的。','请点击卡片。\n<qiyi-media>{"songQuery":"沦陷 贾格","songArtist":"贾格"}</qiyi-media>']
    : ['好的。',toolReply(call('沦陷 贾格',{artist:'贾格'})),'请点击卡片。'];
  const f=setup(t,responses,{mediaFetchImpl:async url=>{
    const u=new URL(url);urls.push(u);return Response.json(u.pathname==='/api/library'
      ? {files:[{name:'old.wav',title:'沦陷',singer:'王靖雯'}]}
      : {songs:[{songmid:'wrong',songname:'沦陷',singer:'其他歌手'},{songmid:'correct',songname:'沦陷 (未来的每一天都多爱你一遍)',singer:'贾格JuggShots'}]});
  }});
  f.api.updateSettings({musicToolMode:mode});await send(f,'播放一下沦陷');
  const result=await send(f,'换成贾格唱的',{onEvent:()=>{}});
  assert.equal(songs(result.message)[0].song.artist,'贾格JuggShots');
  assert.equal(urls.find(url=>url.pathname==='/api/search').searchParams.get('keyword'),'沦陷 贾格');
  assert.ok(f.calls[1].body.messages[0].content.includes('提取本轮原话中明确出现的歌手名'));
});

for (const [mode,artist] of [['tags','编造歌手'],['tags',''],['native','编造歌手']]) test(`${mode} asks for clarification when the model cannot ground its singer`,async t=>{
  const urls=[];const replies=mode==='tags' ? ['好的。',`好的。\n<qiyi-media>${JSON.stringify({songQuery:'编造查询',songArtist:artist})}</qiyi-media>`]
    : ['好的。',toolReply(call('编造查询',{artist})),'请补充歌手。'];
  const f=setup(t,replies,{mediaFetchImpl:async url=>{urls.push(new URL(url));return Response.json({files:[{name:'old.wav',title:'沦陷',singer:'王靖雯'}]});}});
  f.api.updateSettings({musicToolMode:mode});await send(f,'播放沦陷');urls.length=0;
  const card=songs((await send(f,'换成贾格唱的')).message)[0];
  assert.equal(card.type,'song-search');assert.match(card.message,/补充歌手/);assert.equal(card.query,'沦陷');assert.equal(urls.length,0);
});

for (const change of ['off', 'service', 'source', 'mode']) test(`music ${change} after final media resolution is rechecked immediately before persistence`, async t => {
  const gate = deferred(), started = deferred();
  const f = setup(t, [toolReply(), '点击卡片。\n<qiyi-media>{"stickerId":"leaf-cheer"}</qiyi-media>']);
  const resolve = f.api.media.resolve;
  f.api.media.resolve = async (...args) => {
    const result = await resolve(...args);
    assert.equal(result.attachments.length, 2);
    started.resolve(); await gate.promise;
    return result;
  };
  const pending = send(f, '播放《安静片刻》，发一个表情');
  await started.promise;
  if (change === 'mode') f.api.updateSettings({ musicToolMode: 'tags' });
  else f.api.media.update(change === 'off' ? { musicEnabled: false } : change === 'service' ? { musicBaseUrl: 'http://changed.invalid' } : { musicSource: 'netease' });
  gate.resolve();
  const result = await pending;
  assert.equal(songs(result.message).length, 0);
  assert.equal(result.message.attachments[0].type, 'sticker');
  assert.equal(f.requests.length, 1);
  assert.equal(songs(f.api.getConversation(f.conversationId).messages.at(-1)).length, 0);
});

for (const mode of ['tags', 'native']) test(`${mode} mode changes while a text-only model waits suppress fallback`, async t => {
  const gate = deferred();
  const f = setup(t, [() => gate.promise]);
  f.api.updateSettings({ musicToolMode: mode });
  const pending = send(f);
  f.api.updateSettings({ musicToolMode: mode === 'tags' ? 'native' : 'tags' });
  gate.resolve(modelResponse('本轮配置已改变。'));
  const result = await pending;
  assert.equal(f.requests.length, 0);
  assert.equal(songs(result.message).length, 0);
});

test('settings mode is explicit, persisted and atomically validated without model calls', t => {
  const f = fixture(t);
  assert.equal(f.api.model.settings().musicToolMode, 'tags');
  f.api.updateSettings({ musicToolMode: 'native' });
  assert.equal(f.store.settings().musicToolMode, 'native');
  for (const value of ['auto', '', true, null]) assert.throws(() => f.api.updateSettings({ model: 'do-not-save', musicToolMode: value }), errorStatus(400));
  assert.equal(f.store.settings().model, 'test-model');
  assert.equal(f.store.settings().musicToolMode, 'native');
  assert.equal(f.calls.length, 0);
});
