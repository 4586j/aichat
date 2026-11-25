const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureModal(id, className, labelledBy) {
  let dlg = document.getElementById(id);
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = className;
    dlg.setAttribute('aria-labelledby', labelledBy);
    dlg.addEventListener('click', ev => {
      if (ev.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
  }
  return dlg;
}

function highlightTextHtml(textStr, query) {
  const clean = String(textStr || '');
  const q = String(query || '').trim();
  if (!q) return e(clean);
  const idx = clean.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return e(clean);
  return `${e(clean.slice(0, idx))}<mark>${e(clean.slice(idx, idx + q.length))}</mark>${e(clean.slice(idx + q.length))}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function openGlobalSearchModal({ api, personas = [], onJumpToMessage }) {
  const dlg = ensureModal('global-search-dialog', 'search-modal', 'global-search-title');
  const personaMap = new Map(personas.map(p => [p.id, p]));
  let timer = null;
  let seq = 0;

  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="global-search-title">搜索全部聊天记录</h2>
      <button type="button" class="icon-button" data-search-close aria-label="关闭搜索">×</button>
    </div>
    <div class="extras-dialog-body">
      <div class="search-controls-row">
        <input id="global-search-input" type="search" maxlength="200" placeholder="输入关键词，跨单聊与群聊检索原话（Ctrl + K）…" autocomplete="off">
        <select id="global-search-kind" aria-label="对话类型筛选">
          <option value="all">全部对话</option>
          <option value="direct">仅单聊</option>
          <option value="group">仅群聊</option>
        </select>
        <select id="global-search-persona" aria-label="按角色筛选">
          <option value="">所有角色</option>
          ${personas.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}
        </select>
      </div>
      <div id="global-search-results" class="search-results-list" role="region" aria-live="polite">
        <p class="small muted">输入关键字即可检索历史对话原话，点击结果直接定位到对应消息。</p>
      </div>
    </div>
  `;

  const inputEl = dlg.querySelector('#global-search-input');
  const kindEl = dlg.querySelector('#global-search-kind');
  const personaEl = dlg.querySelector('#global-search-persona');
  const resultsEl = dlg.querySelector('#global-search-results');

  async function runSearch() {
    const q = inputEl.value.trim();
    const mySeq = ++seq;
    if (!q) {
      resultsEl.innerHTML = '<p class="small muted">输入关键字即可检索历史对话原话，点击结果直接定位到对应消息。</p>';
      return;
    }
    resultsEl.innerHTML = '<p class="small muted">正在检索…</p>';
    try {
      const params = new URLSearchParams({ q, kind: kindEl.value, personaId: personaEl.value, limit: '30' });
      const { results = [] } = await api(`/messages/search?${params}`);
      if (mySeq !== seq) return;
      if (!results.length) {
        resultsEl.innerHTML = '<p class="small muted">没有找到匹配的聊天记录，换个词试试看。</p>';
        return;
      }
      resultsEl.innerHTML = results.map(hit => {
        const speakerName = hit.role === 'user'
          ? (hit.origin === 'narrator' ? '旁白' : '我')
          : (personaMap.get(hit.speakerPersonaId)?.name || '角色');
        return `
          <button type="button" class="search-hit-item" data-conv-id="${e(hit.conversationId)}" data-msg-id="${e(hit.messageId)}">
            <div class="search-hit-head">
              <strong>${e(hit.conversationTitle || '未命名对话')}</strong>
              <span class="pill">${hit.conversationKind === 'group' ? '群聊' : '单聊'}</span>
              <span class="pill">${e(speakerName)}</span>
              <time>${e(formatDateTime(hit.createdAt))}</time>
            </div>
            <div class="search-hit-snippet">${highlightTextHtml(hit.snippet, q)}</div>
          </button>
        `;
      }).join('');
    } catch (err) {
      if (mySeq === seq) resultsEl.innerHTML = `<p class="inline-error" role="alert">${e(err.message || '检索失败')}</p>`;
    }
  }

  dlg.onclick = ev => {
    if (ev.target.closest('[data-search-close]')) { dlg.close(); return; }
    const hitBtn = ev.target.closest('.search-hit-item');
    if (hitBtn) {
      const convId = hitBtn.dataset.convId;
      const msgId = hitBtn.dataset.msgId;
      dlg.close();
      void onJumpToMessage(convId, msgId);
    }
  };
  inputEl.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void runSearch(), 150);
  };
  kindEl.onchange = () => void runSearch();
  personaEl.onchange = () => void runSearch();

  if (!dlg.open) dlg.showModal();
  inputEl.focus();
}

export function openRelationshipDialog({ api, personas = [], relationships = [], focusPersonaId = '', toast, onSaved }) {
  if (personas.length < 2) {
    toast('请先创建至少 2 位角色，再设定角色之间的关系。', 'info');
    return;
  }
  const dlg = ensureModal('relationship-dialog', 'relationship-modal', 'rel-dialog-title');
  const personaMap = new Map(personas.map(p => [p.id, p]));
  let currentRels = [...relationships];
  let selA = focusPersonaId && personaMap.has(focusPersonaId) ? focusPersonaId : personas[0].id;
  let selB = personas.find(p => p.id !== selA)?.id || personas[1].id;

  function findRel(aId, bId) {
    if (!aId || !bId || aId === bId) return null;
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
    return currentRels.find(r => r.personaAId === lo && r.personaBId === hi) || null;
  }

  function render() {
    const rel = findRel(selA, selB);
    const aName = personaMap.get(selA)?.name || '角色 A';
    const bName = personaMap.get(selB)?.name || '角色 B';
    const isDirectOrder = selA < selB;
    const noteAtoB = rel ? (isDirectOrder ? rel.aToBNote : rel.bToANote) : '';
    const noteBtoA = rel ? (isDirectOrder ? rel.bToANote : rel.aToBNote) : '';

    const visibleList = focusPersonaId
      ? currentRels.filter(r => r.personaAId === focusPersonaId || r.personaBId === focusPersonaId)
      : currentRels;

    dlg.innerHTML = `
      <div class="dialog-header">
        <h2 id="rel-dialog-title">角色关系设定</h2>
        <button type="button" class="icon-button" data-rel-close aria-label="关闭对话框">×</button>
      </div>
      <div class="extras-dialog-body">
        <div class="field-row">
          <div class="field">
            <label for="rel-persona-a">角色甲</label>
            <select id="rel-persona-a">${personas.map(p => `<option value="${e(p.id)}"${p.id === selA ? ' selected' : ''}>${e(p.name)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="rel-persona-b">角色乙</label>
            <select id="rel-persona-b">${personas.map(p => `<option value="${e(p.id)}"${p.id === selB ? ' selected' : ''}>${e(p.name)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field">
          <label for="rel-shared-label">共同关系标签 <span>群聊场记与两位角色都会参考</span></label>
          <input id="rel-shared-label" maxlength="120" value="${e(rel?.sharedLabel || '')}" placeholder="例如：互损老友、师徒、严谨搭档与创意派">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="rel-a-to-b">${e(aName)} 眼中的 ${e(bName)}（选填）</label>
            <textarea id="rel-a-to-b" rows="2" maxlength="400" placeholder="例如：嘴硬心软，但总在关键时刻靠谱">${e(noteAtoB)}</textarea>
          </div>
          <div class="field">
            <label for="rel-b-to-a">${e(bName)} 眼中的 ${e(aName)}（选填）</label>
            <textarea id="rel-b-to-a" rows="2" maxlength="400" placeholder="例如：规矩有点多，但其实很护短">${e(noteBtoA)}</textarea>
          </div>
        </div>
        <div id="rel-error" class="inline-error" role="alert" hidden></div>
        <div class="card-actions">
          <button type="button" id="rel-save-btn" class="button primary small">保存关系</button>
          ${rel ? `<button type="button" id="rel-delete-btn" class="button small danger" data-rel-id="${e(rel.id)}">移除此关系</button>` : ''}
        </div>
        <hr style="border:0;border-top:1px solid var(--line-soft);margin:4px 0">
        <div class="field">
          <label>已设定的关系（${visibleList.length} 条）</label>
          <div class="rel-list">
            ${visibleList.length ? visibleList.map(r => {
              const nameA = personaMap.get(r.personaAId)?.name || '未知角色';
              const nameB = personaMap.get(r.personaBId)?.name || '未知角色';
              return `
                <div class="rel-card">
                  <div class="rel-card-head">
                    <strong>${e(nameA)} ↔ ${e(nameB)} ${r.sharedLabel ? `<span class="pill">${e(r.sharedLabel)}</span>` : ''}</strong>
                    <div class="rel-card-actions">
                      <button type="button" class="button small" data-rel-edit-a="${e(r.personaAId)}" data-rel-edit-b="${e(r.personaBId)}">编辑</button>
                      <button type="button" class="button small" data-rel-del="${e(r.id)}">删除</button>
                    </div>
                  </div>
                  ${r.aToBNote ? `<small class="muted">${e(nameA)} → ${e(nameB)}：${e(r.aToBNote)}</small>` : ''}
                  ${r.bToANote ? `<small class="muted">${e(nameB)} → ${e(nameA)}：${e(r.bToANote)}</small>` : ''}
                </div>
              `;
            }).join('') : '<p class="small muted">尚未建立角色间关系。选中上方两位角色填写即可。</p>'}
          </div>
        </div>
      </div>
    `;

    dlg.querySelector('#rel-persona-a').onchange = ev => { selA = ev.target.value; render(); };
    dlg.querySelector('#rel-persona-b').onchange = ev => { selB = ev.target.value; render(); };
    dlg.querySelector('#rel-save-btn').onclick = async () => {
      const errBox = dlg.querySelector('#rel-error');
      errBox.hidden = true;
      try {
        const res = await api('/relationships', 'PUT', {
          personaAId: selA,
          personaBId: selB,
          sharedLabel: dlg.querySelector('#rel-shared-label').value.trim(),
          aToBNote: dlg.querySelector('#rel-a-to-b').value.trim(),
          bToANote: dlg.querySelector('#rel-b-to-a').value.trim()
        });
        currentRels = res.relationships || [];
        onSaved(currentRels);
        toast(res.deleted ? '已清除该组关系设定。' : '角色关系已保存。');
        render();
      } catch (err) {
        errBox.textContent = err.message || '保存失败';
        errBox.hidden = false;
      }
    };
    const delBtn = dlg.querySelector('#rel-delete-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        const res = await api(`/relationships/${encodeURIComponent(delBtn.dataset.relId)}`, 'DELETE');
        currentRels = res.relationships || [];
        onSaved(currentRels);
        toast('已移除角色关系。');
        render();
      };
    }
    dlg.onclick = async ev => {
      if (ev.target.closest('[data-rel-close]')) { dlg.close(); return; }
      const editBtn = ev.target.closest('[data-rel-edit-a]');
      if (editBtn) {
        selA = editBtn.dataset.relEditA;
        selB = editBtn.dataset.relEditB;
        render();
        return;
      }
      const rowDel = ev.target.closest('[data-rel-del]');
      if (rowDel) {
        const res = await api(`/relationships/${encodeURIComponent(rowDel.dataset.relDel)}`, 'DELETE');
        currentRels = res.relationships || [];
        onSaved(currentRels);
        toast('已移除角色关系。');
        render();
      }
    };
  }

  render();
  if (!dlg.open) dlg.showModal();
}

export function openBookmarkNoteDialog({ bookmark, api, toast, onSaved }) {
  if (!bookmark) return;
  const dlg = ensureModal('bookmark-note-dialog', 'bookmark-note-modal', 'bookmark-note-title');
  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="bookmark-note-title">编辑摘录备注</h2>
      <button type="button" class="icon-button" data-bm-close aria-label="关闭对话框">×</button>
    </div>
    <div class="extras-dialog-body">
      <div class="field">
        <label for="bookmark-note-input">摘录备注 <span>最多 500 字</span></label>
        <textarea id="bookmark-note-input" rows="4" maxlength="500" placeholder="写下你想记住的缘由、情绪或灵感…">${e(bookmark.note || '')}</textarea>
      </div>
      <div id="bookmark-note-error" class="inline-error" role="alert" hidden></div>
      <div class="card-actions">
        <button type="button" id="bookmark-note-cancel" class="button small">取消</button>
        <button type="button" id="bookmark-note-save" class="button primary small">保存备注</button>
      </div>
    </div>
  `;
  dlg.querySelector('[data-bm-close]').onclick = () => dlg.close();
  dlg.querySelector('#bookmark-note-cancel').onclick = () => dlg.close();
  dlg.querySelector('#bookmark-note-save').onclick = async () => {
    const errEl = dlg.querySelector('#bookmark-note-error');
    errEl.hidden = true;
    try {
      const note = dlg.querySelector('#bookmark-note-input').value;
      const res = await api(`/bookmarks/${encodeURIComponent(bookmark.id)}`, 'PUT', { note });
      onSaved(res.bookmarks || []);
      toast('摘录备注已保存。');
      dlg.close();
    } catch (err) {
      errEl.textContent = err.message || '保存备注失败';
      errEl.hidden = false;
    }
  };
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('#bookmark-note-input').focus();
}

const LONGIMG_PALETTES = {
  spring: { name: '春园', bg: '#f4efe4', card: '#fbf8f1', border: '#b8ccb9', accent: '#2e5e4e', userBg: '#e3efe8', text: '#1f2b25', muted: '#5f6f66' },
  autumn: { name: '秋庭', bg: '#f5e9d6', card: '#fcf6ec', border: '#d8b48a', accent: '#8c462b', userBg: '#f2dfc7', text: '#2d211b', muted: '#725b4e' },
  night: { name: '夜雨', bg: '#161d1e', card: '#1f282a', border: '#35494b', accent: '#d4b06a', userBg: '#263a38', text: '#e6ece8', muted: '#8fa39e' }
};

function wrapCanvasLines(ctx, content, maxWidth) {
  const paragraphs = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      const candidate = line + ch;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function loadOptionalAvatarImage(src) {
  if (!src || !src.startsWith('data:image/')) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function openLongImageDialog({ title = '', messages = [], personas = [], userAvatar = '', initialTheme = 'spring', toast }) {
  if (!messages.length) {
    toast('请先勾选至少 1 条消息。', 'info');
    return;
  }
  const dlg = ensureModal('long-image-dialog', 'longimg-modal', 'longimg-dialog-title');
  let activeTheme = Object.hasOwn(LONGIMG_PALETTES, initialTheme) ? initialTheme : 'spring';
  const personaMap = new Map(personas.map(p => [p.id, p]));

  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="longimg-dialog-title">长图摘录预览 · 已选 ${messages.length} 条</h2>
      <button type="button" class="icon-button" data-longimg-close aria-label="关闭预览">×</button>
    </div>
    <div class="extras-dialog-body">
      <div class="card-actions" style="justify-content:space-between;flex-wrap:wrap">
        <div class="card-actions" role="group" aria-label="长图配色主题">
          ${Object.entries(LONGIMG_PALETTES).map(([key, p]) => `<button type="button" class="button small${key === activeTheme ? ' primary' : ''}" data-longimg-theme="${key}">${e(p.name)}</button>`).join('')}
        </div>
        <button type="button" id="long-image-download-btn" class="button primary small">下载 PNG 长图</button>
      </div>
      <div class="longimg-preview-scroll">
        <canvas id="long-image-canvas" aria-label="对话长图预览画布"></canvas>
      </div>
    </div>
  `;

  const avatarCache = new Map();
  if (userAvatar && userAvatar.startsWith('data:image/')) {
    avatarCache.set('__user__', await loadOptionalAvatarImage(userAvatar));
  }
  for (const p of personas) {
    if (p?.avatar && p.avatar.startsWith('data:image/')) {
      avatarCache.set(p.id, await loadOptionalAvatarImage(p.avatar));
    }
  }

  async function renderCanvas() {
    const palette = LONGIMG_PALETTES[activeTheme] || LONGIMG_PALETTES.spring;
    const canvas = dlg.querySelector('#long-image-canvas');
    if (!canvas) return;
    const scale = 2;
    const width = 680;
    const padX = 34;
    const cardPadX = 22;
    const bubbleInnerW = width - (padX * 2) - (cardPadX * 2);
    const probe = canvas.getContext('2d');
    probe.font = '15px "Microsoft YaHei", "PingFang SC", sans-serif';

    const blocks = messages.map(msg => {
      const isNarrator = msg.origin === 'narrator';
      const isUser = msg.role === 'user' && !isNarrator;
      const speaker = isNarrator ? { name: '旁白' } : isUser ? { name: '我', avatar: userAvatar } : (personaMap.get(msg.speakerPersonaId) || personas[0] || { name: '伙伴' });
      const lines = wrapCanvasLines(probe, msg.content, bubbleInnerW - 28);
      const textHeight = lines.length * 23;
      const blockHeight = 34 + textHeight + 22;
      return { msg, isUser, isNarrator, speaker, lines, blockHeight };
    });

    const headerHeight = 98;
    const footerHeight = 64;
    const bodyHeight = blocks.reduce((acc, b) => acc + b.blockHeight + 14, 10);
    const totalHeight = Math.max(360, headerHeight + bodyHeight + footerHeight + 24);

    canvas.width = width * scale;
    canvas.height = totalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, totalHeight);

    drawRoundedRect(ctx, 16, 16, width - 32, totalHeight - 32, 14);
    ctx.fillStyle = palette.card;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.border;
    ctx.stroke();

    ctx.fillStyle = palette.accent;
    ctx.font = 'bold 21px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(title || '栖忆 · 对话摘录', padX, 56, width - padX * 2);
    ctx.fillStyle = palette.muted;
    ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
    const stamp = new Date().toLocaleDateString('zh-CN');
    ctx.fillText(`${messages.length} 段精选对白 · ${stamp}`, padX, 80);

    ctx.beginPath();
    ctx.moveTo(padX, 96);
    ctx.lineTo(width - padX, 96);
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    let y = 114;
    for (const block of blocks) {
      const bx = padX;
      const bw = width - padX * 2;
      drawRoundedRect(ctx, bx, y, bw, block.blockHeight, 10);
      ctx.fillStyle = block.isUser ? palette.userBg : palette.bg;
      ctx.fill();
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      const avatarX = bx + 20;
      const avatarY = y + 20;
      const avatarImg = block.isUser ? avatarCache.get('__user__') : avatarCache.get(block.speaker?.id);
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, 11, 0, Math.PI * 2);
      ctx.closePath();
      if (avatarImg) {
        ctx.clip();
        ctx.drawImage(avatarImg, avatarX - 11, avatarY - 11, 22, 22);
      } else {
        ctx.fillStyle = palette.accent;
        ctx.fill();
        ctx.fillStyle = palette.card;
        ctx.font = 'bold 11px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = block.speaker?.avatar && !block.speaker.avatar.startsWith('data:')
          ? [...block.speaker.avatar][0]
          : [...(block.speaker?.name || '友')][0];
        ctx.fillText(glyph || '友', avatarX, avatarY + 0.5);
      }
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = palette.accent;
      ctx.font = 'bold 13px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.fillText(block.speaker?.name || '伙伴', bx + 38, y + 24);

      ctx.fillStyle = palette.text;
      ctx.font = '15px "Microsoft YaHei", "PingFang SC", sans-serif';
      let lineY = y + 48;
      for (const line of block.lines) {
        ctx.fillText(line, bx + 16, lineY);
        lineY += 23;
      }
      y += block.blockHeight + 14;
    }

    ctx.fillStyle = palette.muted;
    ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('栖忆 · 本地私藏长图', width / 2, totalHeight - 30);
    ctx.textAlign = 'left';
  }

  dlg.onclick = ev => {
    if (ev.target.closest('[data-longimg-close]')) { dlg.close(); return; }
    const themeBtn = ev.target.closest('[data-longimg-theme]');
    if (themeBtn) {
      activeTheme = themeBtn.dataset.longimgTheme;
      dlg.querySelectorAll('[data-longimg-theme]').forEach(btn => {
        btn.classList.toggle('primary', btn.dataset.longimgTheme === activeTheme);
      });
      void renderCanvas();
      return;
    }
    if (ev.target.closest('#long-image-download-btn')) {
      const canvas = dlg.querySelector('#long-image-canvas');
      if (!canvas) return;
      const safeName = (title || '栖忆摘录').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
      const triggerDownload = href => {
        const a = document.createElement('a');
        a.href = href;
        a.download = `${safeName}.png`;
        a.click();
      };
      if (canvas.toBlob) {
        canvas.toBlob(blob => {
          if (!blob) {
            triggerDownload(canvas.toDataURL('image/png'));
            return;
          }
          const url = URL.createObjectURL(blob);
          triggerDownload(url);
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }, 'image/png');
      } else {
        triggerDownload(canvas.toDataURL('image/png'));
      }
      toast('已导出 PNG 长图。');
    }
  };

  if (!dlg.open) dlg.showModal();
  await renderCanvas();
}

export function openUrlClipDialog({ api, saveToKnowledge = false, toast, onClipped }) {
  const dlg = ensureModal('url-clip-dialog', 'search-modal', 'url-clip-title');
  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="url-clip-title">${saveToKnowledge ? '抓取网页导入知识库' : '抓取网页作为对话附件'}</h2>
      <button type="button" class="icon-button" data-clip-close aria-label="关闭对话框">×</button>
    </div>
    <form id="url-clip-form" class="extras-dialog-body">
      <div class="field">
        <label for="clip-url-input">公开网页地址 <span>仅支持 http:// 或 https:// 公开页面</span></label>
        <input id="clip-url-input" type="url" required maxlength="2000" placeholder="https://example.com/article" autocomplete="off">
      </div>
      <p class="small muted">本地安全校验会过滤脚本与内网地址，仅提取干净的 Markdown 正文。</p>
      <div id="clip-url-error" class="inline-error" role="alert" hidden></div>
      <div class="card-actions">
        <button type="button" class="button small" data-clip-close>取消</button>
        <button type="submit" id="clip-url-submit" class="button primary small">${saveToKnowledge ? '抓取并入库' : '抓取并附加'}</button>
      </div>
    </form>
  `;
  dlg.querySelectorAll('[data-clip-close]').forEach(btn => { btn.onclick = () => dlg.close(); });
  const form = dlg.querySelector('#url-clip-form');
  const submitBtn = dlg.querySelector('#clip-url-submit');
  const errEl = dlg.querySelector('#clip-url-error');
  form.onsubmit = async ev => {
    ev.preventDefault();
    errEl.hidden = true;
    const url = dlg.querySelector('#clip-url-input').value.trim();
    if (!url) return;
    submitBtn.disabled = true;
    submitBtn.textContent = '正在抓取…';
    try {
      const res = await api('/web/clip', 'POST', { url, saveToKnowledge });
      dlg.close();
      await onClipped(res);
      toast(saveToKnowledge ? `已抓取「${res.clipped?.title || '网页'}」并存入知识库。` : `已抓取「${res.clipped?.title || '网页'}」作为本条附件。`);
    } catch (err) {
      errEl.textContent = err.message || '抓取网页失败';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = saveToKnowledge ? '抓取并入库' : '抓取并附加';
    }
  };
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('#clip-url-input').focus();
}

export function renderSplitCanvasPane({ canvas, formatMarkdownHtml }) {
  if (!canvas) return '';
  const { filename, ext, lang, code, mode } = canvas;
  const isRenderable = ext === 'html' || ext === 'svg' || ext === 'md' || lang === 'markdown';
  let bodyHtml = '';
  if (mode === 'code') {
    bodyHtml = `<textarea id="canvas-code-editor" class="canvas-code-editor" aria-label="画布源码编辑" spellcheck="false">${e(code)}</textarea>`;
  } else if (ext === 'html') {
    bodyHtml = `<iframe class="canvas-sandbox-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${e(code)}" title="${e(filename)}"></iframe>`;
  } else if (ext === 'svg') {
    const svgDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:12px;width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:transparent;}svg{max-width:100%;max-height:100%;}</style></head><body>${code}</body></html>`;
    bodyHtml = `<iframe class="canvas-sandbox-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${e(svgDoc)}" title="${e(filename)}"></iframe>`;
  } else if (ext === 'md' || lang === 'markdown') {
    bodyHtml = `<div class="canvas-markdown-view plain-text">${formatMarkdownHtml(code)}</div>`;
  } else {
    bodyHtml = `<div class="artifact-preview-code-wrap" style="padding:14px"><pre class="artifact-preview-code"><code>${e(code)}</code></pre></div>`;
  }

  return `
    <aside id="chat-canvas-pane" class="card chat-canvas-pane" aria-label="分屏实时画布">
      <header class="canvas-toolbar">
        <div class="canvas-toolbar-title">
          <span class="pill">${e((lang || ext || 'TEXT').toUpperCase())}</span>
          <span title="${e(filename)}">${e(filename)}</span>
        </div>
        <div class="canvas-toolbar-actions">
          ${isRenderable ? `<button type="button" class="button small${mode === 'preview' ? ' primary' : ''}" data-action="canvas-mode-preview">实时预览</button>` : ''}
          <button type="button" class="button small${mode === 'code' ? ' primary' : ''}" data-action="canvas-mode-code">编辑源码</button>
          <button type="button" class="button small" data-action="canvas-copy">复制</button>
          <button type="button" class="button small" data-action="canvas-download">下载</button>
          <button type="button" class="icon-button" data-action="close-canvas" aria-label="关闭分屏画布">×</button>
        </div>
      </header>
      <div class="canvas-body">
        ${bodyHtml}
      </div>
    </aside>
  `;
}

const MOOD_PRESETS = [
  { id: 'happy', emoji: '😊', label: '愉悦' },
  { id: 'calm', emoji: '🌿', label: '平静' },
  { id: 'fulfilled', emoji: '✨', label: '充实' },
  { id: 'pensive', emoji: '🤔', label: '沉思' },
  { id: 'focused', emoji: '🔥', label: '专注' },
  { id: 'tired', emoji: '🌧️', label: '疲惫' }
];
const MOOD_MAP = new Map(MOOD_PRESETS.map(m => [m.id, m]));

function toLocalDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function openMoodJournalModal({ api, personas = [], journals = [], activePersonaId = '', toast, onUpdated }) {
  const dlg = ensureModal('mood-journal-dialog', 'journal-modal', 'mood-journal-title');
  const nowDate = new Date();
  let viewYear = nowDate.getFullYear();
  let viewMonth = nowDate.getMonth();
  let selectedDate = toLocalDateStr(nowDate);
  let journalMap = new Map((journals || []).map(j => [j.date, j]));
  let busy = false;

  function render() {
    const existing = journalMap.get(selectedDate);
    const activeMood = existing?.mood || 'calm';
    const userNote = existing?.userNote || '';
    const scopeValue = existing?.scope === 'persona' && existing?.personaId ? existing.personaId : '';
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const monthLabel = `${viewYear} 年 ${String(viewMonth + 1).padStart(2, '0')} 月`;
    const companionName = existing?.personaId
      ? (personas.find(p => p.id === existing.personaId)?.name || '伴侣')
      : (personas[0]?.name || '伴侣');

    const dayCells = [];
    for (let i = 0; i < startWeekday; i++) {
      dayCells.push('<div></div>');
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const entry = journalMap.get(ds);
      const moodInfo = entry ? (MOOD_MAP.get(entry.mood) || { emoji: '📝' }) : null;
      dayCells.push(`
        <button type="button" class="calendar-day${ds === selectedDate ? ' is-selected' : ''}${entry ? ' has-entry' : ''}" data-cal-date="${ds}">
          <span>${d}</span>
          ${moodInfo ? `<span class="calendar-day-mood">${moodInfo.emoji}</span>` : ''}
        </button>
      `);
    }

    dlg.innerHTML = `
      <div class="dialog-header">
        <h2 id="mood-journal-title">心情日历与每日小结</h2>
        <button type="button" class="icon-button" data-journal-close aria-label="关闭日历">×</button>
      </div>
      <div class="extras-dialog-body">
        <div class="journal-layout">
          <div>
            <div class="calendar-header">
              <button type="button" class="button small" id="cal-prev-month" aria-label="上一月">‹</button>
              <strong>${e(monthLabel)}</strong>
              <button type="button" class="button small" id="cal-next-month" aria-label="下一月">›</button>
            </div>
            <div class="calendar-grid">
              ${['日', '一', '二', '三', '四', '五', '六'].map(w => `<div class="calendar-weekday">${w}</div>`).join('')}
              ${dayCells.join('')}
            </div>
          </div>
          <div class="stack" style="gap:10px">
            <div class="field">
              <label>当前日期：${e(selectedDate)}</label>
              <div class="mood-chip-row" role="group" aria-label="选择今日心情">
                ${MOOD_PRESETS.map(m => `<button type="button" class="mood-chip${activeMood === m.id ? ' is-selected' : ''}" data-mood-pick="${m.id}">${m.emoji} ${m.label}</button>`).join('')}
              </div>
            </div>
            <div class="field">
              <label for="journal-user-note">今日手记 / 心情随笔</label>
              <textarea id="journal-user-note" rows="3" maxlength="4000" placeholder="写几句今天的心情、想法或值得留念的小事…">${e(userNote)}</textarea>
            </div>
            <div class="field">
              <label for="journal-scope-persona">AI 小结汇总范围</label>
              <select id="journal-scope-persona">
                <option value=""${scopeValue === '' ? ' selected' : ''}>汇总当日全部角色对话</option>
                ${personas.map(p => `<option value="${e(p.id)}"${(scopeValue || (existing ? '' : activePersonaId)) === p.id ? ' selected' : ''}>仅「${e(p.name)}」的对话（并以其口吻寄语）</option>`).join('')}
              </select>
            </div>
            <div id="journal-error" class="inline-error" role="alert" hidden></div>
            <div class="card-actions">
              <button type="button" id="journal-save-btn" class="button small"${busy ? ' disabled' : ''}>保存手记</button>
              <button type="button" id="journal-generate-btn" class="button primary small"${busy ? ' disabled' : ''}>${busy ? '正在生成…' : 'AI 生成今日小结与寄语'}</button>
            </div>
            ${(existing?.summary || existing?.companionComment) ? `
              <div class="journal-ai-card">
                ${existing.summary ? `<div><strong>每日小结</strong><p class="plain-text" style="margin:4px 0 0">${e(existing.summary)}</p></div>` : ''}
                ${existing.companionComment ? `<div><strong>来自「${e(companionName)}」的寄语</strong><p class="plain-text" style="margin:4px 0 0">${e(existing.companionComment)}</p></div>` : ''}
              </div>
            ` : '<p class="small muted">选好日期与心情后，可手动保存手记，或点击由 AI 梳理当日对话生成小结与伴侣寄语。</p>'}
          </div>
        </div>
      </div>
    `;

    let pickedMood = activeMood;
    dlg.querySelector('[data-journal-close]').onclick = () => dlg.close();
    dlg.querySelector('#cal-prev-month').onclick = () => {
      if (viewMonth === 0) { viewYear--; viewMonth = 11; } else viewMonth--;
      render();
    };
    dlg.querySelector('#cal-next-month').onclick = () => {
      if (viewMonth === 11) { viewYear++; viewMonth = 0; } else viewMonth++;
      render();
    };
    dlg.querySelectorAll('[data-cal-date]').forEach(btn => {
      btn.onclick = () => { selectedDate = btn.dataset.calDate; render(); };
    });
    dlg.querySelectorAll('[data-mood-pick]').forEach(btn => {
      btn.onclick = () => {
        pickedMood = btn.dataset.moodPick;
        dlg.querySelectorAll('[data-mood-pick]').forEach(b => b.classList.toggle('is-selected', b.dataset.moodPick === pickedMood));
      };
    });
    dlg.querySelector('#journal-save-btn').onclick = async () => {
      const errEl = dlg.querySelector('#journal-error');
      errEl.hidden = true;
      try {
        const res = await api(`/journals/${encodeURIComponent(selectedDate)}`, 'PUT', {
          mood: pickedMood,
          userNote: dlg.querySelector('#journal-user-note').value,
          personaId: dlg.querySelector('#journal-scope-persona').value || null,
          scope: dlg.querySelector('#journal-scope-persona').value ? 'persona' : 'all'
        });
        journalMap = new Map((res.journals || []).map(j => [j.date, j]));
        onUpdated(res.journals || []);
        toast('今日心情手记已保存。');
        render();
      } catch (err) {
        errEl.textContent = err.message || '保存失败';
        errEl.hidden = false;
      }
    };
    dlg.querySelector('#journal-generate-btn').onclick = async () => {
      const errEl = dlg.querySelector('#journal-error');
      errEl.hidden = true;
      busy = true;
      const personaId = dlg.querySelector('#journal-scope-persona').value || null;
      const userNoteText = dlg.querySelector('#journal-user-note').value;
      render();
      try {
        const res = await api(`/journals/${encodeURIComponent(selectedDate)}/generate`, 'POST', {
          mood: pickedMood,
          userNote: userNoteText,
          personaId
        });
        journalMap = new Map((res.journals || []).map(j => [j.date, j]));
        onUpdated(res.journals || []);
        toast('今日小结与伴侣寄语已生成。');
      } catch (err) {
        toast(err.message || '生成失败', 'error');
      } finally {
        busy = false;
        render();
      }
    };
  }

  render();
  if (!dlg.open) dlg.showModal();
}

export function openPersonaCardExportDialog({ api, persona, toast }) {
  if (!persona) return;
  const dlg = ensureModal('persona-card-export-dialog', 'search-modal', 'persona-card-export-title');
  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="persona-card-export-title">导出角色卡 · ${e(persona.name)}</h2>
      <button type="button" class="icon-button" data-card-close aria-label="关闭">×</button>
    </div>
    <div class="extras-dialog-body">
      <p class="small">导出为本地 JSON 角色卡文件，可分享或在其他栖忆实例中一键导入。</p>
      <label class="checkbox-label">
        <input id="export-card-memories" type="checkbox">
        <span>同时附带该角色当前的活跃长期记忆（请确认不包含个人隐私后再分享）</span>
      </label>
      <div class="card-actions">
        <button type="button" class="button small" data-card-close>取消</button>
        <button type="button" id="export-card-confirm" class="button primary small">下载角色卡 JSON</button>
      </div>
    </div>
  `;
  dlg.querySelectorAll('[data-card-close]').forEach(btn => { btn.onclick = () => dlg.close(); });
  dlg.querySelector('#export-card-confirm').onclick = async () => {
    const includeMemories = Boolean(dlg.querySelector('#export-card-memories').checked);
    const card = await api(`/personas/${encodeURIComponent(persona.id)}/card?includeMemories=${includeMemories}`);
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${persona.name.replace(/[\\/:*?"<>|]/g, '_') || 'persona'}.qiyi-card.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    dlg.close();
    toast(`已导出角色卡「${persona.name}」。`);
  };
  if (!dlg.open) dlg.showModal();
}

export function openBackupImportDialog({ fileJson, api, toast, onRestored }) {
  const dlg = ensureModal('backup-import-dialog', 'search-modal', 'backup-import-title');
  const counts = {
    personas: fileJson?.data?.personas?.length || 0,
    conversations: fileJson?.data?.conversations?.length || 0,
    messages: fileJson?.data?.messages?.length || 0,
    memories: fileJson?.data?.memories?.length || 0,
    documents: fileJson?.data?.documents?.length || 0
  };
  dlg.innerHTML = `
    <div class="dialog-header">
      <h2 id="backup-import-title">恢复本地工作台备份</h2>
      <button type="button" class="icon-button" data-bk-close aria-label="关闭">×</button>
    </div>
    <div class="extras-dialog-body">
      <p class="small">备份包含：${counts.personas} 个角色、${counts.conversations} 段对话（${counts.messages} 条消息）、${counts.memories} 条记忆、${counts.documents} 份文档。</p>
      <div class="field">
        <label>选择恢复方式</label>
        <label class="checkbox-label"><input type="radio" name="backupMode" value="merge" checked><span>增量合并（推荐：保留现有数据，仅补入缺失内容）</span></label>
        <label class="checkbox-label"><input type="radio" name="backupMode" value="replace"><span>覆盖恢复（清空当前本地数据并完全替换为备份内容）</span></label>
      </div>
      <div id="backup-replace-confirm-wrap" hidden>
        <label class="checkbox-label inline-error" style="padding:8px 10px;border-radius:8px">
          <input id="backup-confirm-replace" type="checkbox">
          <span>我已确认：覆盖恢复会永久清空当前所有本地角色、对话与记忆！</span>
        </label>
      </div>
      <div id="backup-import-error" class="inline-error" role="alert" hidden></div>
      <div class="card-actions">
        <button type="button" class="button small" data-bk-close>取消</button>
        <button type="button" id="backup-import-submit" class="button primary small">开始恢复</button>
      </div>
    </div>
  `;
  dlg.querySelectorAll('[data-bk-close]').forEach(btn => { btn.onclick = () => dlg.close(); });
  const confirmWrap = dlg.querySelector('#backup-replace-confirm-wrap');
  const confirmBox = dlg.querySelector('#backup-confirm-replace');
  dlg.querySelectorAll('input[name="backupMode"]').forEach(r => {
    r.onchange = () => { confirmWrap.hidden = r.value !== 'replace' || !r.checked; };
  });
  dlg.querySelector('#backup-import-submit').onclick = async () => {
    const errEl = dlg.querySelector('#backup-import-error');
    errEl.hidden = true;
    const mode = dlg.querySelector('input[name="backupMode"]:checked')?.value || 'merge';
    const confirmReplace = Boolean(confirmBox.checked);
    try {
      const res = await api('/backup/import', 'POST', { ...fileJson, mode, confirmReplace });
      dlg.close();
      await onRestored(res);
      toast(`备份恢复完成（${mode === 'replace' ? '覆盖模式' : '合并模式'}）。`);
    } catch (err) {
      errEl.textContent = err.message || '恢复备份失败';
      errEl.hidden = false;
    }
  };
  if (!dlg.open) dlg.showModal();
}
