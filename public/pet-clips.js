// Authored poses use animation timing, independent of the longer interaction caption.
export const PET_CLIP_LAYOUT = { size: 384, columns: 6, rows: 4 };
export const PET_CLIPS = {
  wave: { row: 0, sequence: [0, 1, 2, 3, 2, 3, 4, 5], weights: [1, 1, 1, 1, 1, 1, 1, 1], cycles:2 },
  stretch: { row: 1, sequence: [0, 1, 2, 3, 2, 4, 5], weights: [1, 1, 1, 5, 1, 1, 1] },
  feed: { row: 2, sequence: [0, 1, 2, 3, 2, 3, 2, 3, 4, 5], weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  play: { row: 3, sequence: [0, 1, 2, 3, 4, 1, 2, 3, 4, 5], weights: [1, 1, .7, 1.2, .8, .8, .7, 1, .8, 1] },
};
export const petClipSprite = id => `/assets/pets/${id}-actions-v3.webp`;
const poseMs=85;
export function petClipDuration(kind){
  if(kind==='hop'||kind==='celebrate')return 6*poseMs;
  const clip=Object.hasOwn(PET_CLIPS,kind)?PET_CLIPS[kind]:null;
  return clip?clip.weights.reduce((a,b)=>a+b,0)*poseMs*(clip.cycles || 1):0;
}

export function petClipFrame(kind, progress) {
  const action = kind === 'hop' || kind === 'celebrate' ? 'play' : kind;
  const clip = Object.hasOwn(PET_CLIPS,action) ? PET_CLIPS[action] : null;
  if (!clip || !Number.isFinite(progress) || progress < 0 || progress >= 1) return null;
  const singleHop = kind === 'hop' || kind === 'celebrate';
  const sequence = singleHop ? [0, 1, 2, 3, 4, 5] : clip.sequence;
  const weights = singleHop ? [1, 1, .7, 1.2, .8, 1] : clip.weights;
  const cycles=singleHop?1:clip.cycles || 1, phase=progress*cycles%1;
  const position = phase * weights.reduce((a, b) => a + b, 0);
  let start = 0, index = 0;
  for (; index < weights.length - 1; index++) { if (position < start+weights[index]) break; start+=weights[index]; }
  const envelope=Math.sin(progress*Math.PI)**2;
  const angle=Math.sin(progress*Math.PI*(action==='feed'?8:4))*envelope*.012;
  const scaleY=action==='stretch'?Math.sin(phase*Math.PI)*.018:Math.sin(progress*Math.PI*4)*envelope*.006;
  const fade = Math.min(1, progress / .025, (1 - progress) / .025);
  return { action, row: clip.row, column: sequence[index], opacity: Math.max(0, fade), angle, scaleY, progress };
}
