# 宠物表情素材生成提示

日期：2026-10-26。使用内置 imagegen，每款独立编辑调用一次；`referenced_image_paths` 为该款 `public/assets/pets/<id>-v1.png`，`transparent_background` 为 true。生成原图经人工检查后，只提取内部面部区域，经过注册、裁切、边缘融合及 WebP 打包后使用。没有使用 CLI/API 生图回退，也没有加入外部角色素材。

以下保留实际使用的完整提示。初始参考图的外部背景并未进入最终素材；最终身体轮廓来自原始 v1 PNG。最终文件及处理步骤见 [素材记录](pet-assets.md)。

## cream-cat

编辑目标：`public/assets/pets/cream-cat-v1.png`。

```text
Use case: precise-object-edit. Asset: production 2D pet animation expression sprite sheet, transparent RGBA. Edit target is the attached existing cream plush kitten. Preserve its identity EXACTLY: cream fur texture, slightly tilted big round head, triangular sage green bib with leaf, seated body, pink paw pads, curled tail on viewer right, original lighting and proportions. Create a perfectly regular THREE COLUMNS by TWO ROWS sprite sheet with SIX equal square cells, no gaps or borders, no text. Repeat the SAME full-body kitten at IDENTICAL scale, framing, body pose, head position and angle in all six cells. Each cell contains the entire pet with transparent margins; keep paws, ears, tail unchanged. Change ONLY eyelids, brows and mouth. Reading order: 1 warm gentle listening (soft open eyes, small closed smile); 2 happy (both eyes closed as upward smiling curves, joyful small smile); 3 attentive curious (open eyes, subtly lifted brows, small closed mouth); 4 sleepy (both eyes half closed, relaxed tiny smile); 5 blink halfway (upper lids halfway down across original eye positions, original mouth); 6 blink fully closed (both eyes closed with relaxed gentle downward lid curves, original mouth). Critical: same eye centers and nose coordinates in EVERY cell, same exact face geometry and fur colors. Preserve original nose and cheeks. Original is plush painterly 3D, NOT flat cartoon. No props, no new accessories, no ground shadows, no background, no labels. Output landscape 3:2 sheet, ideally 1536x1024 or larger.
```

## shiba

编辑目标：`public/assets/pets/shiba-v1.png`。

```text
Use case: precise-object-edit. Asset: production 2D pet animation expression sheet. Edit target is the attached original honey orange and cream plush shiba, sage green scarf with gold leaf clasp, upright triangular ears, seated paws, curled tail on viewer right. Preserve its existing plush furry texture, identity, fur colors, proportions, accessories, lighting and seated pose. Create a perfectly regular THREE COLUMNS by TWO ROWS sheet: SIX identical square cells, no gap, no border, no text. The SAME full-body pet in all cells, EXACT same scale, framing, head position, angle, eye centers, nose position and body silhouette, entirely visible. Change ONLY eyelids, brows and mouth. Reading order: (1) warm listening, soft open eyes and gentle small closed smile; (2) happy, both eyes closed as upward smiling curves and joyful small smile; (3) focused curious, attentive open eyes with lifted brows and small closed mouth; (4) sleepy relaxed, half closed eyelids and tiny relaxed smile; (5) halfway blink, both upper lids halfway down in original eye positions, original mouth unchanged; (6) fully closed blink, relaxed curved closed lids in original eye positions, original mouth unchanged. Original plush painterly 3D rendering, NOT flat cartoon. Do not change ears, head pose, limbs, accessory or tail between frames. True transparent alpha background, no backdrop, no ground shadow, no labels. Landscape 3:2 sheet ideally 1536x1024.
```

## lop-rabbit

编辑目标：`public/assets/pets/lop-rabbit-v1.png`。

```text
Use case: precise-object-edit. Asset: production 2D pet animation expression sheet. Edit target is the attached original cream plush lop rabbit, long floppy pink inner ears, sage green bow and leaf pearl hair clip, seated body and pink paw pads. Preserve its existing plush furry texture, identity, fur colors, proportions, accessories, lighting and seated pose. Create a perfectly regular THREE COLUMNS by TWO ROWS sheet: SIX identical square cells, no gap, no border, no text. The SAME full-body pet in all cells, EXACT same scale, framing, head position, angle, eye centers, nose position and body silhouette, entirely visible. Change ONLY eyelids, brows and mouth. Reading order: (1) warm listening, soft open eyes and gentle small closed smile; (2) happy, both eyes closed as upward smiling curves and joyful small smile; (3) focused curious, attentive open eyes with lifted brows and small closed mouth; (4) sleepy relaxed, half closed eyelids and tiny relaxed smile; (5) halfway blink, both upper lids halfway down in original eye positions, original mouth unchanged; (6) fully closed blink, relaxed curved closed lids in original eye positions, original mouth unchanged. Original plush painterly 3D rendering, NOT flat cartoon. Do not change ears, head pose, limbs, accessory or tail between frames. True transparent alpha background, no backdrop, no ground shadow, no labels. Landscape 3:2 sheet ideally 1536x1024.
```

## little-fox

编辑目标：`public/assets/pets/little-fox-v1.png`。

```text
Use case: precise-object-edit. Asset: production 2D pet animation expression sheet. Edit target is the attached original cinnamon orange plush fox, cream cheeks and chest, dark brown paws and ear rims, large cream tipped tail on viewer right, sage green scarf with gold leaf clasp. Preserve its existing plush furry texture, identity, fur colors, proportions, accessories, lighting and seated pose. Create a perfectly regular THREE COLUMNS by TWO ROWS sheet: SIX identical square cells, no gap, no border, no text. The SAME full-body pet in all cells, EXACT same scale, framing, head position, angle, eye centers, nose position and body silhouette, entirely visible. Change ONLY eyelids, brows and mouth. Reading order: (1) warm listening, soft open eyes and gentle small closed smile; (2) happy, both eyes closed as upward smiling curves and joyful small smile; (3) focused curious, attentive open eyes with lifted brows and small closed mouth; (4) sleepy relaxed, half closed eyelids and tiny relaxed smile; (5) halfway blink, both upper lids halfway down in original eye positions, original mouth unchanged; (6) fully closed blink, relaxed curved closed lids in original eye positions, original mouth unchanged. Original plush painterly 3D rendering, NOT flat cartoon. Do not change ears, head pose, limbs, accessory or tail between frames. True transparent alpha background, no backdrop, no ground shadow, no labels. Landscape 3:2 sheet ideally 1536x1024.
```
