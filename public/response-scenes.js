export const RESPONSE_SCENES = {
  normal: { label: '自然交流', caption: '点点我，给我一个摸摸。', petPhase: 'idle', stickers: ['general', 'greet', 'thanks', 'think', 'celebrate', 'comfort', 'rest'], intensity: 2 },
  rest: { label: '安静休息', caption: '安静地陪你待着。', petPhase: 'quiet', stickers: ['rest', 'comfort'], intensity: 1 },
  comfort: { label: '温和陪伴', caption: '我在这里，慢慢说就好。', petPhase: 'comfort', stickers: ['comfort', 'rest', 'greet'], intensity: 1 },
  focus: { label: '专注解决', caption: '陪你把眼前这件事理清楚。', petPhase: 'focus', stickers: ['think'], intensity: 1 },
  celebrate: { label: '轻轻庆祝', caption: '好消息，一起开心一下。', petPhase: 'idle', stickers: ['celebrate', 'thanks', 'greet'], intensity: 2 },
};

export function responseScene(snapshot) {
  if (!snapshot?.fields || snapshot.mode === 'off') return 'normal';
  const value = key => snapshot.fields[key]?.value;
  if (['task', 'advice'].includes(value('need'))) return 'focus';
  if (value('energy') === 'low') return 'rest';
  const emotions = value('emotion') || [];
  if (value('need') === 'listen' || emotions.some(e => ['sad', 'worried', 'irritated'].includes(e))) return 'comfort';
  if (emotions.some(e => ['happy', 'excited'].includes(e)) && value('proactivity') !== 'low' && value('roleMood') !== 'serious') return 'celebrate';
  return 'normal';
}
