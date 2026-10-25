import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createPets, PET_CATALOG, PET_DEFAULTS } from '../lib/pets.mjs';
import { startServer } from '../server.mjs';

function fixture(t, options) { const store = createStore(); t.after(() => store.close()); return { store, pets: createPets(store, options) }; }
test('pet defaults seed four original local portraits without changing existing user data', async t => {
  const { store, pets } = fixture(t);
  const persona = store.get('SELECT * FROM personas LIMIT 1'), info = pets.bootstrap();
  assert.deepEqual(info.settings, PET_DEFAULTS); assert.equal(info.revision, 0); assert.equal(info.pets.length, 4);
  assert.equal(info.pets[0].name, '团团'); assert.ok(info.pets.every(pet => pet.bond === 0));
  assert.deepEqual(createPets(store).bootstrap(), info); assert.deepEqual(store.get('SELECT * FROM personas LIMIT 1'), persona);
  for (const pet of PET_CATALOG) {
    const png = await readFile(new URL('../public' + pet.image, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.length > 1000); assert.equal(png[25], 6, 'RGBA PNG preserves generated alpha');
  }
});

test('pet settings reject invalid values atomically and version actual changes', t => {
  const { pets } = fixture(t); const before = pets.bootstrap();
  for (const input of [{ selectedId: '../../private' }, { enabled: 'false' }, { animations: null }, { enabled: false, selectedId: 'other' }]) assert.throws(() => pets.update(input));
  assert.deepEqual(pets.bootstrap(), before);
  assert.equal(pets.update({ selectedId: 'shiba' }).revision, 1);
  assert.equal(pets.update({ selectedId: 'shiba' }).revision, 1);
  const result = pets.update({ enabled: false, animations: false }); assert.equal(result.revision, 2); assert.equal(result.settings.selectedId, 'shiba');
});

test('each pet keeps its own validated name and records', t => {
  let clock = Date.now(); const { pets } = fixture(t, { petClock: () => clock });
  const updated = pets.rename('little-fox', { name: '  小 <栗> & 朋友  ' }); assert.equal(updated.pets[3].name, '小 <栗> & 朋友');
  for (const name of ['', ' '.repeat(2), 'a'.repeat(21), 'cat\nname', 'cat\0']) assert.throws(() => pets.rename('little-fox', { name }));
  assert.throws(() => pets.rename('missing', { name: '合法名字' }), error => error.status === 404);
  assert.equal(pets.bootstrap().pets[0].name, '团团');
  pets.interact({ petId: 'little-fox', action: 'feed' }); clock += 1000;
  pets.interact({ petId: 'cream-cat', action: 'pet' });
  const info = pets.bootstrap(); assert.equal(info.pets[3].bond, 2); assert.equal(info.pets[0].bond, 1); assert.equal(info.pets[1].bond, 0);
});

test('pet interactions count once per second across actions and never punish time away', t => {
  let clock = Date.now(); const { pets } = fixture(t, { petClock: () => clock });
  const first = pets.interact({ petId: 'cream-cat', action: 'pet' }); assert.equal(first.interaction.applied, true); assert.equal(first.pets[0].bond, 1);
  const duplicate = pets.interact({ petId: 'cream-cat', action: 'feed' }); assert.equal(duplicate.interaction.applied, false); assert.equal(duplicate.revision, first.revision);
  clock += 1000; const fed = pets.interact({ petId: 'cream-cat', action: 'feed' }); assert.equal(fed.pets[0].bond, 3); assert.equal(fed.pets[0].feedCount, 1);
  clock += 1000; const played = pets.interact({ petId: 'cream-cat', action: 'play' }); assert.equal(played.pets[0].bond, 4); assert.equal(played.pets[0].playCount, 1);
  clock += 365 * 86400000; assert.equal(pets.bootstrap().pets[0].bond, 4);
  assert.throws(() => pets.interact({ petId: 'cream-cat', action: 'exec' }));
  assert.throws(() => pets.interact({ petId: 'https://other.invalid', action: 'pet' }));
});

test('pet counts remain bounded and a backward system-clock adjustment cannot lock interaction', t => {
  let clock = Date.now(); const { store, pets } = fixture(t, { petClock: () => clock });
  store.run('UPDATE pet_profiles SET bond=1000000,petCount=1000000,lastInteractionAt=? WHERE id=?', clock + 10000, 'cream-cat');
  const result = pets.interact({ petId: 'cream-cat', action: 'pet' }); assert.equal(result.interaction.applied, true); assert.equal(result.pets[0].bond, 1000000); assert.equal(result.pets[0].petCount, 1000000);
});

test('pet selection, preferences, names and interactions survive a database reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qiyi-pets-')), filename = join(directory, 'pets.sqlite');
  let store;
  try {
    store = createStore(filename); const pets = createPets(store);
    pets.update({ selectedId: 'lop-rabbit', animations: false }); pets.rename('lop-rabbit', { name: '棉花糖' }); pets.interact({ petId: 'lop-rabbit', action: 'feed' });
    const before = pets.bootstrap(); store.close(); store = createStore(filename);
    assert.deepEqual(createPets(store).bootstrap(), before);
  } finally { store?.close(); await rm(filename, { force: true }); await rmdir(directory); }
});

test('pet HTTP works without a model, concurrent interactions count once and fixed assets are cacheable', async t => {
  let modelCalls = 0;
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false, modelOptions: { fetchImpl: () => { modelCalls++; throw new Error('no provider access'); } } }); t.after(() => app.close());
  const req = (path, method = 'GET', data) => fetch(app.url + path, { method, ...(data ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const initial = await (await req('/api/bootstrap')).json(); assert.equal(initial.pets.pets.length, 4);
  await req('/api/pets/settings', 'PUT', { selectedId: 'shiba' }); await req('/api/pets/shiba', 'PUT', { name: '饼干' });
  const results = await Promise.all(Array.from({ length: 3 }, () => req('/api/pets/interact', 'POST', { petId: 'shiba', action: 'feed' }).then(r => r.json())));
  assert.equal(results.filter(r => r.interaction.applied).length, 1);
  const data = await (await req('/api/pets')).json(); assert.equal(data.pets[1].name, '饼干'); assert.equal(data.pets[1].bond, 2);
  const image = await req('/assets/pets/shiba-v1.png'); assert.equal(image.headers.get('content-type'), 'image/png'); assert.match(image.headers.get('cache-control'), /immutable/); assert.ok((await image.arrayBuffer()).byteLength > 1000);
  const head = await req('/assets/pets/cream-cat-v1.png', 'HEAD'); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await req('/api/pets/settings', 'PUT', { selectedId: 'missing' })).status, 404);
  assert.equal(modelCalls, 0); assert.equal(app.api.bootstrap().stats.messageCount, 0);
});
