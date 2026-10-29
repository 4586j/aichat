# 完整动作生成提示（v3）

2026-10-26，使用内置 imagegen，透明背景参数为 true。每次以对应的 `public/assets/pets/*-v1.png` 为形象参考。共七次独立调用：四款先生成 6 列 × 4 行动作图；奶油猫的招手用 3 列 × 2 行重做；垂耳兔与小狐狸另做留白修订，避免长耳朵和大尾巴越过格子边界。以下保留完整实际提示，初版与修订版均有记录。

最终源图：奶油猫第一版完整图与招手修订图；柴犬第一版；垂耳兔与小狐狸最后的留白修订版。没有下载开源项目的角色素材。生成源保留在工具的默认目录，应用只引用仓库中的版本化 WebP。整理脚本保留透明通道、裁切和注册姿势，并清理网格边缘邻格碎片，不在运行期生图。打包说明见 [宠物动画](pet-animation.md)。

## 奶油猫完整动作

生成文件：`exec-3dd0dbfd-8e4e-4d41-a4ff-7d571ad06f57.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a cream kitten with amber eyes, pink paw pads and sage green leaf-print bandana, large softly tilted head and curved fluffy tail on viewer right. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same kitten, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting kitten occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with pink pads facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
```

## 柴犬完整动作

生成文件：`exec-8557aa73-5f95-40f9-8d74-fde5f9460a35.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a a honey and cream shiba puppy with big warm amber eyes, triangular upright ears, curled tail on viewer right, sage green scarf with a small gold leaf clasp. Keep all these details and puppy canine anatomy.. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same character, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting character occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. All frames of the wave must raise the SAME forepaw on viewer-left; do not swap paws or mirror the head/accessories between frames. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with paw facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
```

## 垂耳兔完整动作（初版）

生成文件：`exec-e7fc738c-ad1e-4c04-af8e-ce21b0737ece.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a a cream white lop-eared rabbit with long pink floppy ears, big amber eyes, sage green neck bow with pearl and gold leaf, a matching leaf-and-pearl hair clip on viewer right, rounded pink foot pads. Keep floppy ears and ornaments on the same side. Rabbit has no large visible tail.. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same character, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting character occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. All frames of the wave must raise the SAME forepaw on viewer-left; do not swap paws or mirror the head/accessories between frames. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with paw facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
```

## 小狐狸完整动作（初版）

生成文件：`exec-fd4b0e73-3605-46a8-9779-4f0c2ed7f303.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a a cinnamon orange fox with cream cheeks and chest, huge fluffy cream-tipped tail on viewer right, dark brown paws and ear rims, sage green scarf with gold leaf clasp and green leaf tassel. Keep the dark paws, fox nose, and same tail and scarf details.. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same character, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting character occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. All frames of the wave must raise the SAME forepaw on viewer-left; do not swap paws or mirror the head/accessories between frames. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with paw facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
```

## 奶油猫招手修订

生成文件：`exec-7a121e0b-b3a3-406d-81bb-0db19ce87324.png`。

```text
Use case: identity-preserve
Asset type: 6-frame animation sprite sheet. Input image is the exact cream kitten character identity. Preserve its cream plush fur, amber eyes, pink paw pads, green leaf bandana, original head tilt and curled tail on viewer right. Same camera and warm light, no redesign.
Create a landscape 3:2 sprite sheet, EXACTLY 3 columns x 2 rows of equal square cells, 1536x1024 preferred. The reading order is left-to-right then next row; this is ONE smooth chronological SIX-FRAME PAW WAVE. Transparent alpha background, no text/grid/shadows/props. The full kitten is visible in every cell, same scale and seated foot baseline y=94%, ears and tail not cropped. Resting body fills 90% height.
Very important: the kitten ALWAYS raises the paw on the LEFT SIDE OF THE IMAGE, on the viewer's left; keep its other front paw on the viewer's right beside its belly. Do not mirror or swap sides in any frame. Do not change head tilt or move feet.
Frame 1: original seated rest, both forepaws held at chest.
Frame 2: viewer-left forepaw half raised, pink pads beginning to face viewer.
Frame 3: same viewer-left forepaw fully lifted beside cheek, pink pads face viewer and paw tips slightly outward. Eyes open.
Frame 4: same viewer-left forepaw remains up beside cheek, tips inward toward face, happy closed-eye smile. This is a small rotation of the SAME raised paw.
Frame 5: same viewer-left forepaw halfway down, eyes softly open.
Frame 6: return to frame 1's original rest.
Only the chosen paw and gentle expression change. Preserve head angle, body, planted feet, accessory, tail location, size and identity exactly across all frames. Real limb articulation, not global image translations. No extra/missing paws, no cloned characters, truly transparent background.
```

## 垂耳兔留白修订（最终版）

生成文件：`exec-fa2bc2b2-1cdd-4ae2-b7e3-005306e4638d.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a a cream white lop-eared rabbit with long pink floppy ears, big amber eyes, sage green neck bow with pearl and gold leaf, a matching leaf-and-pearl hair clip on viewer right, rounded pink foot pads. Keep floppy ears and ornaments on the same side. Rabbit has no large visible tail.. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same character, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting character occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. All frames of the wave must raise the SAME forepaw on viewer-left; do not swap paws or mirror the head/accessories between frames. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with paw facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
CRITICAL PRODUCTION CORRECTION: The previous sheet packed the characters too tightly and neighbouring ears/tails crossed cell borders. THIS VERSION MUST HAVE MUCH SMALLER CHARACTERS WITH GENEROUS TRANSPARENT MARGINS. Within EACH 256x256 cell, the COMPLETE character (all fur, tail, long ears, paws, jump silhouette) MUST stay inside x=34..222 and y=30..222, a maximum 188 pixels wide and 192 pixels tall. Scale all 24 characters equally smaller. Leave at least 30 empty transparent pixels on EVERY side of EVERY cell. Never clip ears/tail or allow any part into adjacent cell. Maintain the 6x4 grid, all same 24 poses, same identity. The large empty space is intentional and required, do not fill the cells.
```

## 小狐狸留白修订（最终版）

生成文件：`exec-30a25d50-3298-402e-a5b6-f331a3fe9441.png`。

```text
Use case: identity-preserve
Asset type: production full-body animation sprite sheet for a plush companion in a web app.
Input image 1 is the exact character identity and fur/material reference: a a cinnamon orange fox with cream cheeks and chest, huge fluffy cream-tipped tail on viewer right, dark brown paws and ear rims, sage green scarf with gold leaf clasp and green leaf tassel. Keep the dark paws, fox nose, and same tail and scarf details.. Preserve this character, its plush fine fur, proportions, colors, accessories, soft warm lighting and camera angle. This is NOT a redesign.
Create ONE sprite sheet with EXACTLY 6 columns and 4 rows, 24 equal square cells, landscape 3:2 canvas (1536x1024 preferred), no gutters, text, labels, outlines or borders. Each cell holds ONE complete same character, isolated on truly transparent alpha. No floor, background, shadows, checkerboard or other characters. Use same scale throughout: resting character occupies 76% cell height, same x center and foot baseline y=92%, full ears and tail within cell. Camera locked. All frames of the wave must raise the SAME forepaw on viewer-left; do not swap paws or mirror the head/accessories between frames. Do not zoom per cell. Leave extra headroom for raised paws and jumps.
Each ROW is a sequence of SIX chronologically ordered animation frames. IMPORTANT: visibly re-pose the actual limbs and torso, do not merely translate, squash or rotate one unchanged illustration. Small variation only as required for animation; consistent face, bandana and fur color.
Row 1 WAVING: (1) original seated rest; (2) viewer-left forepaw lifted halfway; (3) forepaw raised beside face with paw facing viewer tilted outward; (4) same raised paw waves inward, head tips gently; (5) forepaw halfway down; (6) return to original seated rest.
Row 2 STRETCHING: (1) original seated rest; (2) head lowers and shoulders gather; (3) both forepaws lift high, torso visibly lengthens upward; (4) full overhead stretch with sleepy closed eyes and ears relaxed, paws distinct, do not crop; (5) forepaws lower and torso settles; (6) return to original seated rest.
Row 3 EATING: (1) original seated rest; (2) both front paws hold ONE small round biscuit below chin; (3) paws bring biscuit to mouth, head bends forward; (4) gentle bite with biscuit visibly smaller and closed happy eyes, cheeks softly raised; (5) paws lower, tiny tongue licking lips, biscuit gone; (6) return to original seated rest. No bowl, floating food or unrelated props.
Row 4 PLAYFUL HOP: (1) original seated rest; (2) low anticipation crouch, paws bend; (3) push off with forepaws raised and feet extending; (4) small airborne happy jump with visible different leg pose and tail following, no ground shadow; (5) landing crouch with ears settling; (6) original seated rest.
Avoid: duplicate unchanged middle poses, missing/extra paws, shifting scale, new character details, photographic props, motion blur, glow, captions. All 24 cells must be crisp and individually usable. Transparency is required.
CRITICAL PRODUCTION CORRECTION: The previous sheet packed the characters too tightly and neighbouring ears/tails crossed cell borders. THIS VERSION MUST HAVE MUCH SMALLER CHARACTERS WITH GENEROUS TRANSPARENT MARGINS. Within EACH 256x256 cell, the COMPLETE character (all fur, tail, long ears, paws, jump silhouette) MUST stay inside x=34..222 and y=30..222, a maximum 188 pixels wide and 192 pixels tall. Scale all 24 characters equally smaller. Leave at least 30 empty transparent pixels on EVERY side of EVERY cell. Never clip ears/tail or allow any part into adjacent cell. Maintain the 6x4 grid, all same 24 poses, same identity. The large empty space is intentional and required, do not fill the cells.
```

