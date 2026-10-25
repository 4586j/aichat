import { AppError } from './model.mjs';

export const PET_CATALOG = [
  { id: 'cream-cat', species: '奶油猫', defaultName: '团团', description: '圆滚滚的慢性子，喜欢安静地陪你。', color: '#eee3cd', image: '/assets/pets/cream-cat-v1.png' },
  { id: 'shiba', species: '柴犬', defaultName: '豆包', description: '把好心情藏在卷尾巴里，随时准备出发。', color: '#ead5b8', image: '/assets/pets/shiba-v1.png' },
  { id: 'lop-rabbit', species: '垂耳兔', defaultName: '糯米', description: '耳朵软软的，很会听你慢慢说。', color: '#eee7e1', image: '/assets/pets/lop-rabbit-v1.png' },
  { id: 'little-fox', species: '小狐狸', defaultName: '栗栗', description: '对新鲜事充满好奇，陪你冒出小灵感。', color: '#e8d2c1', image: '/assets/pets/little-fox-v1.png' },
];
export const PET_DEFAULTS = { enabled: true, selectedId: 'cream-cat', animations: true };
const find = id => { const pet = PET_CATALOG.find(item => item.id === id); if (!pet) throw new AppError('宠物类型不存在。', 404); return pet; };
const MAX_POINTS = 1_000_000;

export function createPets(store, { petClock = Date.now } = {}) {
  store.run('INSERT OR IGNORE INTO pet_state(id,value,revision) VALUES (1,?,0)', JSON.stringify(PET_DEFAULTS));
  for (const pet of PET_CATALOG) store.run('INSERT OR IGNORE INTO pet_profiles(id,name,bond,petCount,feedCount,playCount,lastInteractionAt) VALUES (?,?,0,0,0,0,0)', pet.id, pet.defaultName);
  const state = () => store.get('SELECT * FROM pet_state WHERE id=1');
  const settings = () => ({ ...PET_DEFAULTS, ...JSON.parse(state().value) });
  function bootstrap() {
    const current = state();
    return { settings: { ...PET_DEFAULTS, ...JSON.parse(current.value) }, revision: current.revision,
      pets: PET_CATALOG.map(pet => ({ ...pet, ...store.get('SELECT * FROM pet_profiles WHERE id=?', pet.id) })) };
  }
  function update(input) {
    const next = settings();
    for (const key of ['enabled', 'animations']) if (key in input) {
      if (typeof input[key] !== 'boolean') throw new AppError('宠物开关必须为布尔值。');
      next[key] = input[key];
    }
    if ('selectedId' in input) next.selectedId = find(input.selectedId).id;
    if (JSON.stringify(next) !== JSON.stringify(settings())) store.run('UPDATE pet_state SET value=?,revision=revision+1 WHERE id=1', JSON.stringify(next));
    return bootstrap();
  }
  function rename(petId, input) {
    find(petId);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 20 || /[\x00-\x1f\x7f]/.test(input.name)) throw new AppError('宠物名字需为 1～20 个字符，不能包含换行或控制字符。');
    store.transaction(() => {
      const name = input.name.trim();
      if (store.get('SELECT name FROM pet_profiles WHERE id=?', petId).name === name) return;
      store.run('UPDATE pet_profiles SET name=? WHERE id=?', name, petId);
      store.run('UPDATE pet_state SET revision=revision+1 WHERE id=1');
    });
    return bootstrap();
  }
  function interact(input) {
    const pet = find(input.petId);
    if (!['pet', 'feed', 'play'].includes(input.action)) throw new AppError('宠物互动类型无效。');
    let applied = false;
    store.transaction(() => {
      const profile = store.get('SELECT * FROM pet_profiles WHERE id=?', pet.id);
      const stamp = petClock(), elapsed = stamp - profile.lastInteractionAt;
      // A short shared cooldown avoids double-counting a double-click, including across tabs.
      if (profile.lastInteractionAt > 0 && elapsed >= 0 && elapsed < 1000) return;
      const counter = { pet: 'petCount', feed: 'feedCount', play: 'playCount' }[input.action];
      store.run(`UPDATE pet_profiles SET bond=?,${counter}=?,lastInteractionAt=? WHERE id=?`,
        Math.min(MAX_POINTS, profile.bond + (input.action === 'feed' ? 2 : 1)), Math.min(MAX_POINTS, profile[counter] + 1), stamp, pet.id);
      store.run('UPDATE pet_state SET revision=revision+1 WHERE id=1'); applied = true;
    });
    const name = store.get('SELECT name FROM pet_profiles WHERE id=?', pet.id).name;
    return { ...bootstrap(), interaction: { petId: pet.id, action: input.action, applied,
      message: !applied ? `${name}已经收到啦，稍等一下再玩。` : input.action === 'feed' ? `${name}收到小点心，陪伴点数 +2。`
        : input.action === 'play' ? `${name}开心地蹦了一下，陪伴点数 +1。` : `${name}蹭了蹭你的手，陪伴点数 +1。` } };
  }
  return { bootstrap, update, rename, interact };
}
