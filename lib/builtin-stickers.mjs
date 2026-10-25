// Original vector stickers: no remote assets, fonts or animation dependencies.
export const BUILTIN_STICKERS = [
  ['leaf-cheer', '好耶', '小叶开心地举起双手，庆祝成功和好消息', '开心 庆祝 好耶 成功 加油', '#e5edc8', 'happy'],
  ['leaf-hug', '抱抱', '小叶张开双臂，温和地安慰、陪伴和鼓励', '抱抱 安慰 陪伴 难过 鼓励', '#f2e2d6', 'hug'],
  ['leaf-think', '让我想想', '小叶托着脸思考，适合讨论和琢磨问题', '思考 想想 疑问 琢磨', '#e3e9ef', 'think'],
  ['leaf-thanks', '谢谢你', '小叶捧着一朵花，表达感谢和认可', '谢谢 感谢 认可 感动', '#f4e7c8', 'thanks'],
  ['leaf-wave', '我在呢', '小叶挥手打招呼，回应问候和重逢', '你好 问候 挥手 我在 早安', '#dfece2', 'wave'],
  ['leaf-rest', '歇一会儿', '小叶靠着软垫休息，提醒喝茶和放松', '休息 放松 晚安 睡觉 喝茶', '#e8e4f0', 'rest'],
];

export function builtinSticker(row) {
  const [, caption, , , color, mood] = row;
  const eyes = mood === 'rest' ? '<path d="M83 108q7 7 14 0m18 0q7 7 14 0"/>' : mood === 'happy' ? '<path d="M83 110q7-12 14 0m18 0q7-12 14 0"/>' : '<circle cx="91" cy="110" r="3" fill="#315c47"/><circle cx="121" cy="110" r="3" fill="#315c47"/>';
  const arms = mood === 'happy' ? 'M64 119 43 88m105 31 23-31' : mood === 'hug' ? 'M65 119 37 129m110-10 30 10' : 'M65 121q-22 6-15 21m98-21q22 6 15 21';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220"><rect x="7" y="7" width="206" height="206" rx="38" fill="#fffdf6"/><ellipse cx="110" cy="163" rx="58" ry="8" fill="#315c4710"/><g stroke="#315c47" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${arms}" fill="none"/><path d="M77 151v12m65-12v12"/><path d="M65 100c-8-33 97-40 86 3l-4 40c-5 22-76 23-80 0Z" fill="${color}"/><path d="M108 80V46m0 15c-26 2-29-15-25-24 18 0 25 9 25 24Zm0-9c0-23 16-25 28-23-1 18-11 25-28 23Z" fill="#c7d9af"/>${eyes}<path d="M101 125q5 ${mood === 'think' ? '-2' : '8'} 12 0" fill="none"/></g><ellipse cx="78" cy="122" rx="8" ry="4" fill="#dca48c66"/><ellipse cx="134" cy="122" rx="8" ry="4" fill="#dca48c66"/><text x="110" y="194" text-anchor="middle" fill="#315c47" font-family="Microsoft YaHei,PingFang SC,sans-serif" font-size="21" font-weight="600">${caption}</text></svg>`);
}
