// Each authored action has 24 chronological poses in its own small, lazy atlas.
export const PET_CLIP_LAYOUT = { size: 256, columns: 6, rows: 4, frames: 24 };
export const PET_CLIPS = {
  wave: { row: 0, duration: 1000, cycles: 1 },
  stretch: { row: 1, duration: 1200, cycles: 1 },
  feed: { row: 2, duration: 1100, cycles: 1 },
  play: { row: 3, duration: 1600, cycles: 2 },
};
export const petClipAction = kind => kind === 'hop' || kind === 'celebrate' ? 'play' : Object.hasOwn(PET_CLIPS, kind) ? kind : null;
export const petClipSprite = (id, action = 'wave') => `/assets/pets/${id}-${action}-v4.webp`;
export function petClipDuration(kind) {
  if (kind === 'hop' || kind === 'celebrate') return 800;
  return PET_CLIPS[petClipAction(kind)]?.duration || 0;
}

export function petClipFrame(kind, progress) {
  const action = petClipAction(kind), clip = PET_CLIPS[action];
  if (!clip || !Number.isFinite(progress) || progress < 0 || progress >= 1) return null;
  const cycles = kind === 'hop' || kind === 'celebrate' ? 1 : clip.cycles;
  const phase = progress*cycles%1, column = Math.min(PET_CLIP_LAYOUT.frames-1, Math.floor(phase*PET_CLIP_LAYOUT.frames));
  const envelope = Math.sin(progress*Math.PI)**2;
  const angle = Math.sin(progress*Math.PI*(action === 'feed' ? 8 : 4))*envelope*.012;
  const scaleY = action === 'stretch' ? Math.sin(phase*Math.PI)*.018 : Math.sin(progress*Math.PI*4)*envelope*.006;
  const fade = Math.min(1, progress/.025, (1-progress)/.025);
  return { action, row: clip.row, column, spriteColumn: column%PET_CLIP_LAYOUT.columns,
    spriteRow: Math.floor(column/PET_CLIP_LAYOUT.columns), size: PET_CLIP_LAYOUT.size,
    opacity: Math.max(0, fade), angle, scaleY, progress };
}
