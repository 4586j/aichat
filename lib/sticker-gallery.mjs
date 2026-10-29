// Gallery v1 metadata is untrusted data. Keep validation and scene translation here.
export const GALLERY_SCENES = ['general', 'comfort', 'celebration', 'thinking', 'rest', 'greeting', 'thanks'];
export const GALLERY_EMOTIONS = ['neutral', 'joy', 'sadness', 'anger', 'fear', 'surprise', 'affection'];
export const GALLERY_CONTEXTS = ['serious_distress', 'conflict', 'grief', 'medical_or_safety'];
const expressions = {
  comfort: ['轻轻安慰 陪伴 抱抱', 'affection'], celebration: ['开心 庆祝 好消息', 'joy'],
  thinking: ['思考 好奇', 'neutral'], rest: ['安静 休息 放松', 'neutral'],
  greeting: ['你好 问候 招手', 'affection'], thanks: ['谢谢 感谢', 'affection'], general: ['害羞 可爱 温柔', 'affection'],
};
export function stickerContexts(content = '') {
  return [
    ['serious_distress', /撑不下去|崩溃|绝望|痛不欲生|严重抑郁|serious distress/iu],
    ['conflict', /吵架|争吵|冲突|冷战|闹矛盾|conflict|argument/iu],
    ['grief', /去世|离世|过世|逝世|死亡|病逝|丧事|葬礼|悼念|丧亲|哀悼|bereavement|passed away|funeral/iu],
    ['medical_or_safety', /自杀|自残|轻生|伤害自己|不想活|医疗|看病|就医|治疗|生病|手术|住院|急救|受伤|用药|药物|服药|诊断|胸痛|呼吸困难|人身安全|家暴|suicid|self.harm|medical|emergency/iu],
  ].filter(([, pattern]) => pattern.test(content)).map(([context]) => context);
}

// Queries consist only of these expression words; raw conversation and model text never leave the chat service.
export function planStickerSearch(plan, content = '') {
  if (!plan?.stickerAllowed || plan.stickerContexts?.some(value => ['serious_distress','grief','medical_or_safety'].includes(value))) return null;
  if (!plan.explicitSticker && ['rest','comfort','focus'].includes(plan.scene)) return null;
  let scene = { rest:'rest', comfort:'comfort', focus:'thinking', celebrate:'celebration' }[plan.scene];
  if (!scene) {
    if (/安慰|抱抱|陪伴|comfort|hug/iu.test(content)) scene = 'comfort';
    else if (/休息|疲惫|好累|放松|晚安|rest/iu.test(content)) scene = 'rest';
    else if (/庆祝|开心|获奖|中奖|好消息|celebrat/iu.test(content)) scene = 'celebration';
    else if (/思考|想一想|好奇|thinking/iu.test(content)) scene = 'thinking';
    else if (/谢谢|感谢|thanks/iu.test(content)) scene = 'thanks';
    else if (/你好|早安|问候|招手|hello|greeting/iu.test(content)) scene = 'greeting';
    else if (/害羞|可爱|卖萌|shy|cute/iu.test(content)) scene = 'general';
  }
  if (!scene) return null;
  if (!plan.explicitSticker && ['rest','comfort','thinking'].includes(scene)) return null;
  const [q, emotion] = expressions[scene];
  return { q, scene, emotion, maxIntensity:Math.min(plan.maxStickerIntensity || 2, ['comfort','rest'].includes(scene) ? 1 : 3), contexts:[...(plan.stickerContexts || [])], limit:8 };
}

const text = (value, max, required = false) => typeof value === 'string' && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) && (!required || Boolean(value.trim()));
const enums = (values, allowed, max, required = true) => Array.isArray(values) && values.length <= max && (!required || values.length > 0) && values.every(value => allowed.includes(value)) && new Set(values).size === values.length;
export function matchesGallery(item, search) {
  return Boolean(search && item.scenes?.includes(search.scene) && item.emotions?.includes(search.emotion)
    && item.intensity <= search.maxIntensity && !item.excludedContexts?.some(value => search.contexts.includes(value)));
}
export function normalizeGallerySticker(value, service, search) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !/^stk_[a-f0-9]{64}$/u.test(value.id)
    || !text(value.name,80,true) || !text(value.meaning,1000,true) || !text(value.description,2000)
    || !Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 20 || value.tags.some(tag => !text(tag,40,true))
    || !enums(value.scenes,GALLERY_SCENES,7) || !enums(value.emotions,GALLERY_EMOTIONS,3)
    || !enums(value.excludedContexts,GALLERY_CONTEXTS,4,false) || !Number.isInteger(value.intensity) || value.intensity < 1 || value.intensity > 3
    || !Array.isArray(value.examples) || value.examples.length > 5 || value.examples.some(example => !text(example,200,true))
    || !text(value.alt,240,true) || typeof value.animated !== 'boolean' || !['image/png','image/jpeg','image/gif','image/webp'].includes(value.mime)
    || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096 || value.width*value.height > 16000000
    || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 4*1024*1024
    || !Number.isInteger(value.revision) || value.revision < 1 || !text(value.updatedAt,64,true) || !Number.isFinite(Date.parse(value.updatedAt))
    || !Number.isFinite(value.score) || value.score <= 0 || (value.status !== undefined && value.status !== 'enabled')) return null;
  let url;
  try { url = new URL(value.url); } catch { return null; }
  if (url.origin !== new URL(service).origin || url.username || url.password || url.search || url.hash || url.pathname !== `/api/v1/images/${value.id.slice(4)}` || !matchesGallery(value,search)) return null;
  // Copy known fields only. Do not persist unknown fields, credentials, or arbitrary model context.
  return Object.fromEntries(['id','name','meaning','description','tags','scenes','emotions','excludedContexts','examples','intensity','alt','mime','width','height','sizeBytes','animated','revision','updatedAt','score'].map(key => [key,value[key]]).concat([['url',url.href]]));
}
export function eligibleSticker(item, plan) {
  if (!plan) return !item.galleryId;
  if (!plan.stickerAllowed) return false;
  if (item.galleryId) return matchesGallery(item, plan.stickerSearch);
  return plan.explicitSticker || (plan.allowedStickerScenes.includes(item.scene) && item.intensity <= plan.maxStickerIntensity);
}
