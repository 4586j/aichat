import cytoscape from '/vendor/cytoscape.esm.min.mjs';

const KIND_LABELS = { memory: '原始记忆', entity: '实体', relation: '语义关系', evidence: '证据连线' };
const DISPLAY_VALUES = {
  type: { person: '人物', organization: '组织', place: '地点', topic: '主题', event: '事件', other: '其他' },
  category: { fact: '事实', preference: '偏好', goal: '目标', constraint: '约束', summary: '摘要' },
  status: { active: '活跃', archived: '已归档' },
};
const PROPERTY_LABELS = {
  id: '标识', memoryId: '记忆标识', type: '实体类型', category: '分类',
  score: '保留分数', importance: '重要性', confidence: '置信度', pinned: '固定',
  status: '状态', source: '来源', indexed: '已处理', memoryIds: '引用记忆标识',
};

function plain(value) {
  if (value === undefined || value === null) return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function memoryId(node) {
  if (node.kind !== 'memory') return null;
  return node.memoryId ?? node.id.slice('memory:'.length);
}

function shortLabel(value, length = 42) {
  const characters = Array.from(plain(value).replace(/\s+/gu, ' '));
  return characters.length > length ? `${characters.slice(0, length).join('')}…` : characters.join('');
}

const GRAPH_STYLE = [
  { selector: 'node', style: {
    label: 'data(caption)', 'font-family': 'Microsoft YaHei, PingFang SC, sans-serif',
    'font-size': 11, color: '#263e34', 'text-wrap': 'wrap', 'text-max-width': 108,
    'border-width': 1.5, 'border-color': '#91a58a', 'background-color': '#e7ede1',
    'overlay-opacity': 0, 'text-valign': 'center', 'text-halign': 'center',
  } },
  { selector: 'node[kind = "memory"]', style: {
    shape: 'round-rectangle', width: 132, height: 62, padding: 7,
  } },
  { selector: 'node[kind = "entity"]', style: {
    shape: 'ellipse', width: 48, height: 48, 'background-color': '#315c47',
    'border-color': '#254936', 'text-valign': 'bottom', 'text-margin-y': 9,
    'text-background-color': '#f5f4ee', 'text-background-opacity': 0.9, 'text-background-padding': 2,
  } },
  { selector: 'node.pending', style: {
    'background-color': '#f7f0df', 'border-color': '#9b7a3f', 'border-style': 'dashed',
  } },
  { selector: 'node.pinned', style: { 'border-width': 3 } },
  { selector: '.archived', style: { opacity: 0.6 } },
  { selector: 'edge', style: {
    label: 'data(caption)', width: 1.5, 'curve-style': 'bezier',
    'line-color': '#91a58a', 'target-arrow-color': '#91a58a', 'target-arrow-shape': 'triangle',
    'arrow-scale': 0.8, 'font-size': 10, color: '#52684b', 'text-rotation': 'autorotate',
    'text-background-color': '#f5f4ee', 'text-background-opacity': 1, 'text-background-padding': 3,
    'text-wrap': 'wrap', 'text-max-width': 110, 'overlay-opacity': 0,
  } },
  { selector: 'edge[kind = "relation"][score]', style: { width: 'mapData(score, 0, 1, 1, 3.5)' } },
  { selector: 'edge[kind = "evidence"]', style: {
    label: '', width: 1, 'line-style': 'dashed', 'line-color': '#b7b4a2',
    'target-arrow-shape': 'none',
  } },
  { selector: '.search-dim', style: { opacity: 0.18 } },
  { selector: 'node.search-match', style: { 'border-color': '#9b7a3f', 'border-width': 4 } },
  { selector: 'edge.search-match', style: { width: 3, 'line-color': '#9b7a3f', 'target-arrow-color': '#9b7a3f' } },
  { selector: 'node.chosen', style: { opacity: 1, 'border-width': 4, 'border-color': '#a16b32' } },
  { selector: 'edge.chosen', style: { opacity: 1, width: 3.5, 'line-color': '#315c47', 'target-arrow-color': '#315c47', color: '#254936' } },
  { selector: '.filtered-out', style: { display: 'none' } },
];

export function mountMemoryGraph(container, { data = {}, onOpenMemory } = {}) {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const listeners = [];
  let disposed = false;
  let cy = null;
  let layout = null;
  let observer = null;
  let resizeFrame = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let canvasFailed = false;
  let selectedId = null;
  let query = '';
  let matches = new Set();
  let contextualNodes = new Set();
  let visibleNodes = [];
  let visibleEdges = [];
  const listButtons = new Map();

  function element(tag, className, text) {
    const item = doc.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = plain(text);
    return item;
  }

  function listen(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }

  function button(label, action, testId) {
    const item = element('button', 'mg-button', label);
    item.type = 'button';
    item.dataset.action = action;
    if (testId) item.dataset.testid = testId;
    return item;
  }

  const nodes = [];
  const edges = [];
  const records = new Map();
  const nodeById = new Map();
  const memoryById = new Map();
  let omitted = 0;
  for (const node of Array.isArray(data?.nodes) ? data.nodes : []) {
    if (!node || typeof node.id !== 'string' || !node.id || records.has(node.id)
      || !['memory', 'entity'].includes(node.kind)) { omitted++; continue; }
    nodes.push(node);
    records.set(node.id, node);
    nodeById.set(node.id, node);
    if (node.kind === 'memory') memoryById.set(String(memoryId(node)), node);
  }
  for (const edge of Array.isArray(data?.edges) ? data.edges : []) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || records.has(edge.id)
      || !['relation', 'evidence'].includes(edge.kind)
      || !nodeById.has(edge.source) || !nodeById.has(edge.target)) { omitted++; continue; }
    edges.push(edge);
    records.set(edge.id, edge);
  }
  const nodeLabel = id => plain(nodeById.get(id)?.label ?? id);
  const edgeLabel = edge => `${nodeLabel(edge.source)} — ${plain(edge.label ?? KIND_LABELS[edge.kind])} → ${nodeLabel(edge.target)}`;
  const searchIndex = new Map([...records].map(([id, record]) => [id,
    `${plain(record)} ${KIND_LABELS[record.kind]} ${record.indexed === false ? '待提取' : ''} ${nodeById.has(id) ? '' : edgeLabel(record)}`.toLocaleLowerCase(),
  ]));

  const root = element('section', 'memory-graph');
  root.dataset.testid = 'memory-graph';
  root.setAttribute('aria-label', '记忆知识图谱');
  const stylesheet = element('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./memory-graph.css', import.meta.url).href;
  root.append(stylesheet);

  const stats = element('dl', 'mg-stats');
  stats.setAttribute('aria-label', '图谱统计');
  stats.dataset.testid = 'memory-graph-stats';
  for (const [key, label] of [
    ['memoryCount', '当前记忆'], ['entityCount', '实体'], ['relationCount', '语义关系'],
    ['pendingCount', '待提取'], ['totalMemoryCount', '全部记忆'],
  ]) {
    const item = element('div', key === 'pendingCount' ? 'mg-stat mg-stat-pending' : 'mg-stat');
    const value = element('dd', '', data?.stats?.[key] ?? '—');
    value.dataset.stat = key;
    item.append(element('dt', '', label), value);
    stats.append(item);
  }
  root.append(stats);
  if (data?.truncated) {
    const notice = element('p', 'mg-notice', '当前仅展示部分图谱；统计来自本次响应，不能视为完整图谱规模。未展示的记忆和关系仍保留在本地，搜索仅覆盖当前窗口。');
    notice.dataset.testid = 'memory-graph-truncated';
    notice.setAttribute('role', 'note');
    root.append(notice);
  }
  if (omitted) root.append(element('p', 'mg-notice', `有 ${omitted} 个格式不完整、重复或缺少端点的条目未绘制。未补造节点或关系。`));

  const tools = element('div', 'mg-tools');
  const searchLabel = element('label', 'mg-search');
  searchLabel.append(element('span', 'mg-field-label', '搜索图谱'));
  const search = element('input', 'mg-search-input');
  search.type = 'search';
  search.placeholder = '搜索实体、原文、关系或来源';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('aria-label', '搜索图谱');
  search.dataset.testid = 'memory-graph-search';
  searchLabel.append(search);
  const searchActions = element('div', 'mg-search-actions');
  const focusButton = button('聚焦结果', 'focus', 'memory-graph-focus');
  const clearButton = button('清除搜索', 'clear-search', 'memory-graph-clear-search');
  searchActions.append(focusButton, clearButton);
  tools.append(searchLabel, searchActions);
  const switches = element('div', 'mg-switches');
  function checkbox(label, testId, checked) {
    const wrapper = element('label', 'mg-checkbox');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.testid = testId;
    wrapper.append(input, element('span', '', label));
    switches.append(wrapper);
    return input;
  }
  const filter = checkbox('仅显示匹配项', 'memory-graph-filter', false);
  const evidence = checkbox('显示证据连线', 'memory-graph-evidence-toggle', true);
  tools.append(switches);
  root.append(tools);

  const body = element('div', 'mg-body');
  const graphPanel = element('div', 'mg-graph-panel');
  const viewportTools = element('div', 'mg-viewport-tools');
  viewportTools.setAttribute('role', 'group');
  viewportTools.setAttribute('aria-label', '图谱视图控制');
  const zoomOut = button('−', 'zoom-out', 'memory-graph-zoom-out');
  zoomOut.setAttribute('aria-label', '缩小图谱');
  zoomOut.title = '缩小图谱';
  const zoomValue = element('output', 'mg-zoom-value', '100%');
  zoomValue.setAttribute('aria-label', '图谱缩放比例');
  zoomValue.dataset.testid = 'memory-graph-zoom';
  const zoomIn = button('+', 'zoom-in', 'memory-graph-zoom-in');
  zoomIn.setAttribute('aria-label', '放大图谱');
  zoomIn.title = '放大图谱';
  const fitButton = button('适配视图', 'fit', 'memory-graph-fit');
  const layoutButton = button('重新布局', 'layout', 'memory-graph-relayout');
  viewportTools.append(zoomOut, zoomValue, zoomIn, fitButton, layoutButton);
  graphPanel.append(viewportTools);
  const stage = element('div', 'mg-stage');
  stage.dataset.testid = 'memory-graph-stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', '知识图谱画布，方向键平移，加减键缩放，0 键适配；也可使用下方节点和关系列表');
  // Definite dimensions must exist before Cytoscape inserts its native canvases.
  stage.style.position = 'relative';
  stage.style.height = 'var(--mg-stage-height, clamp(360px, 52vh, 560px))';
  stage.style.minWidth = '0';
  stage.style.overflow = 'hidden';
  const canvas = element('div', 'mg-canvas');
  canvas.dataset.testid = 'memory-graph-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  const empty = element('div', 'mg-empty');
  empty.dataset.testid = 'memory-graph-empty';
  stage.append(canvas, empty);
  graphPanel.append(stage);
  const legend = element('ul', 'mg-legend');
  legend.setAttribute('aria-label', '图谱图例');
  for (const [kind, label] of [['memory', '原始记忆'], ['entity', '实体'], ['pending', '待提取记忆'], ['relation', '语义关系'], ['evidence', '证据连线']]) {
    const item = element('li');
    const swatch = element('span', `mg-swatch mg-swatch-${kind}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, element('span', '', label));
    legend.append(item);
  }
  graphPanel.append(legend, element('p', 'mg-hint', '拖动节点整理位置，拖动画布平移，滚轮或双指缩放。位置与大小不代表分数。'));
  body.append(graphPanel);

  const detail = element('aside', 'mg-detail');
  detail.dataset.testid = 'memory-graph-details';
  detail.setAttribute('aria-label', '选择详情');
  const detailHeader = element('div', 'mg-detail-header');
  detailHeader.append(element('span', 'mg-field-label', '选择详情'));
  const deselect = button('取消选择', 'deselect', 'memory-graph-deselect');
  detailHeader.append(deselect);
  const detailContent = element('div', 'mg-detail-content');
  detailContent.tabIndex = -1;
  detail.append(detailHeader, detailContent);
  body.append(detail);
  root.append(body);

  const directory = element('section', 'mg-directory');
  directory.setAttribute('aria-label', '可键盘操作的图谱列表');
  const directoryHeader = element('div', 'mg-directory-header');
  directoryHeader.append(element('h3', '', '逐条浏览'), button('查看选择详情', 'details', 'memory-graph-jump-details'));
  const status = element('p', 'mg-result-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.dataset.testid = 'memory-graph-search-status';
  const announcement = element('p', 'mg-sr-only');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  const lists = element('div', 'mg-lists');
  function listGroup(title, label, testId) {
    const section = element('section', 'mg-list-group');
    const heading = element('h4', 'mg-list-heading', title);
    const list = element('ul', 'mg-list');
    list.setAttribute('aria-label', label);
    list.dataset.testid = testId;
    section.append(heading, list);
    lists.append(section);
    return { list, heading };
  }
  const nodeList = listGroup('节点', '图谱节点列表', 'memory-graph-node-list');
  const edgeList = listGroup('关系与证据', '图谱关系列表', 'memory-graph-edge-list');
  directory.append(directoryHeader, status, lists, announcement);
  root.append(directory);

  function appendProperties(parent, record, keys, overrides = {}) {
    const properties = element('dl', 'mg-properties');
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null) continue;
      const row = element('div');
      const value = Object.hasOwn(DISPLAY_VALUES[key] || {}, record[key]) ? DISPLAY_VALUES[key][record[key]] : record[key];
      row.append(element('dt', '', overrides[key] ?? PROPERTY_LABELS[key] ?? key), element('dd', '', value));
      properties.append(row);
    }
    if (properties.childElementCount) parent.append(properties);
  }

  function evidenceIds(record) {
    const ids = new Map();
    const add = id => { if (id !== undefined && id !== null && String(id) !== '') ids.set(String(id), id); };
    const addReferences = item => { if (Array.isArray(item.memoryIds)) item.memoryIds.forEach(add); };
    if (record.kind === 'memory') add(memoryId(record));
    else {
      addReferences(record);
      const connections = record.kind === 'entity'
        ? edges.filter(edge => edge.kind === 'evidence' && (edge.source === record.id || edge.target === record.id))
        : record.kind === 'evidence' ? [record] : [];
      for (const edge of connections) {
        addReferences(edge);
        for (const endpoint of [edge.source, edge.target]) {
          const node = nodeById.get(endpoint);
          if (node?.kind === 'memory') add(memoryId(node));
        }
      }
    }
    return [...ids.values()];
  }

  function renderDetails() {
    detailContent.replaceChildren();
    const record = records.get(selectedId);
    deselect.disabled = !record;
    if (!record) {
      detailContent.append(element('div', 'mg-detail-mark', '原文 · 关系 · 证据'));
      detailContent.append(element('h3', 'mg-detail-title', '每一条关联，都有来处'));
      detailContent.append(element('p', 'mg-detail-placeholder', '点击图中的节点或连线，查看它的属性与原始记忆。也可以使用下方列表，按 Tab 移动、Enter 或空格选择。'));
      detailContent.append(element('p', 'mg-hint', '这里只展示已保存的数据，不推断缺失的关系，也不补全置信度。'));
      return;
    }
    detailContent.append(element('span', `mg-kind mg-kind-${record.kind}`, KIND_LABELS[record.kind]));
    detailContent.append(element('h3', 'mg-detail-title', nodeById.has(record.id) ? (record.label ?? record.id) : edgeLabel(record)));
    appendProperties(detailContent, record,
      nodeById.has(record.id) ? ['type', 'category', 'score', 'importance', 'confidence', 'pinned', 'status', 'indexed'] : ['score', 'confidence', 'status']);
    detailContent.append(element('h4', 'mg-evidence-heading', '原始记忆证据'));
    const ids = evidenceIds(record);
    if (!ids.length) detailContent.append(element('p', 'mg-hint', '本次响应未提供关联的原始记忆引用。'));
    for (const id of ids) {
      const memory = memoryById.get(String(id));
      const card = element('article', 'mg-evidence-card');
      card.dataset.testid = 'memory-graph-memory-evidence';
      card.append(element('p', 'mg-evidence-id', `记忆标识：${plain(id)}`));
      const raw = element('p', 'mg-original', memory?.content ?? '当前图谱响应未包含这条记忆的原文；可打开原始记忆查看。');
      raw.dataset.testid = 'memory-graph-original-text';
      card.append(raw);
      if (memory) appendProperties(card, memory, ['source', 'category', 'status', 'score', 'importance', 'confidence', 'pinned', 'indexed']);
      const open = button('编辑原始记忆', 'open-memory', 'memory-graph-open-memory');
      open.dataset.memoryRef = String(id);
      open.setAttribute('aria-label', `编辑原始记忆 ${plain(id)}`);
      open.disabled = typeof onOpenMemory !== 'function';
      if (open.disabled) open.title = '当前未提供记忆编辑入口';
      card.append(open);
      detailContent.append(card);
    }
    const identifiers = element('details');
    identifiers.append(element('summary', 'mg-hint', '技术标识'));
    appendProperties(identifiers, record, ['id', 'memoryId', 'memoryIds']);
    detailContent.append(identifiers, element('p', 'mg-hint', '数值来自支撑记忆；未提供的数值不估算。'));
  }

  function markSelection() {
    if (cy) {
      cy.elements().removeClass('chosen');
      if (selectedId) cy.getElementById(selectedId).addClass('chosen');
    }
    for (const [id, item] of listButtons) item.setAttribute('aria-pressed', String(id === selectedId));
  }

  function select(id, focusGraph = false) {
    if (disposed) return;
    selectedId = records.has(id) ? id : null;
    markSelection();
    renderDetails();
    const record = records.get(selectedId);
    announcement.textContent = record ? `已选择${KIND_LABELS[record.kind]}：${plain(record.label ?? record.id)}。原文与属性已显示在选择详情中。` : '已取消选择。';
    if (focusGraph && cy && selectedId) {
      const item = cy.getElementById(selectedId);
      const neighborhood = item.isNode() ? item.closedNeighborhood() : item.union(item.connectedNodes());
      fitCollection(neighborhood.filter(':visible'));
    }
  }

  function renderLists(list, items, isEdge) {
    list.replaceChildren();
    if (!items.length) {
      list.append(element('li', 'mg-list-empty', query ? '没有匹配项' : '暂无条目'));
      return;
    }
    const fragment = doc.createDocumentFragment();
    for (const record of items) {
      const row = element('li');
      const item = button('', 'select', isEdge ? 'memory-graph-edge' : 'memory-graph-node');
      item.className = 'mg-list-button';
      item.dataset.graphId = record.id;
      item.dataset.kind = record.kind;
      item.setAttribute('aria-pressed', String(record.id === selectedId));
      const kind = element('span', `mg-kind mg-kind-${record.kind}`, KIND_LABELS[record.kind]);
      const title = element('span', 'mg-list-label', isEdge ? edgeLabel(record) : record.label ?? record.id);
      item.append(kind, title);
      if (record.kind === 'memory') {
        if (record.content !== undefined) item.append(element('span', 'mg-list-preview', shortLabel(record.content, 110)));
        if (record.indexed === false) item.append(element('span', 'mg-pending-label', '待提取'));
      }
      if (record.status === 'archived') item.append(element('span', 'mg-pending-label', '已归档'));
      row.append(item);
      fragment.append(row);
      listButtons.set(record.id, item);
    }
    list.append(fragment);
  }

  function syncCanvas() {
    if (!cy) return;
    const visibleIds = new Set([...visibleNodes, ...visibleEdges].map(item => item.id));
    cy.batch(() => {
      cy.elements().forEach(item => {
        const id = item.id();
        item.toggleClass('filtered-out', !visibleIds.has(id));
        item.toggleClass('search-match', Boolean(query) && matches.has(id));
        item.toggleClass('search-dim', Boolean(query) && !matches.has(id) && !contextualNodes.has(id));
      });
      markSelection();
    });
  }

  function updateEmpty() {
    empty.replaceChildren();
    empty.hidden = Boolean(nodes.length && !canvasFailed && visibleNodes.length);
    if (empty.hidden) return;
    empty.append(element('h3', '', canvasFailed ? '画布暂时无法绘制' : nodes.length ? '没有匹配的节点或关系' : '这里，还没有记忆'));
    empty.append(element('p', '', canvasFailed ? '仍可通过下方列表选择条目，查看属性和原始记忆。' : nodes.length ? '换个关键词，或取消“仅显示匹配项”。' : '当前角色没有可展示的记忆。保存记忆后，它们会在这里出现；未提取关系的记忆也会独立显示。'));
  }

  function updateSearch() {
    if (disposed) return;
    query = search.value.trim().toLocaleLowerCase();
    const allowedEdges = edges.filter(edge => evidence.checked || edge.kind !== 'evidence');
    matches = new Set([...nodes, ...allowedEdges].filter(record => !query || searchIndex.get(record.id).includes(query)).map(record => record.id));
    contextualNodes = new Set(nodes.filter(node => matches.has(node.id)).map(node => node.id));
    for (const edge of allowedEdges) if (matches.has(edge.id)) {
      contextualNodes.add(edge.source);
      contextualNodes.add(edge.target);
    }
    const filteredNodes = nodes.filter(node => contextualNodes.has(node.id));
    const filteredEdges = allowedEdges.filter(edge => matches.has(edge.id)
      || (contextualNodes.has(edge.source) && contextualNodes.has(edge.target)));
    visibleNodes = query && filter.checked ? filteredNodes : nodes;
    visibleEdges = query && filter.checked ? filteredEdges : allowedEdges;
    listButtons.clear();
    renderLists(nodeList.list, filteredNodes, false);
    renderLists(edgeList.list, filteredEdges, true);
    nodeList.heading.textContent = `节点 · ${filteredNodes.length}`;
    edgeList.heading.textContent = `关系与证据 · ${filteredEdges.length}`;
    status.textContent = `${query ? '搜索结果' : '当前列表'}：${filteredNodes.length} 个节点，${filteredEdges.length} 条连线${query ? '（包含匹配关系的端点）' : ''}。${evidence.checked ? '' : '证据连线已隐藏，原始记忆仍保留。'}`;
    clearButton.disabled = !search.value;
    focusButton.disabled = !query || !contextualNodes.size || !cy;
    const selectedVisible = [...visibleNodes, ...visibleEdges].some(record => record.id === selectedId);
    if (selectedId && !selectedVisible) select(null);
    syncCanvas();
    updateEmpty();
    updateControls();
  }

  function updateControls() {
    const disabled = !cy || !visibleNodes.length || canvasFailed;
    for (const item of [zoomOut, zoomIn, fitButton, layoutButton]) item.disabled = disabled;
    focusButton.disabled = disabled || !query || !contextualNodes.size;
    if (cy) zoomValue.textContent = `${Math.round(cy.zoom() * 100)}%`;
    else zoomValue.textContent = '—';
  }

  function fitCollection(collection) {
    if (!cy || !collection.length || disposed) return;
    cy.fit(collection, 36);
    // A single node should remain readable, not fill the entire viewport.
    if (cy.zoom() > 1.35) { cy.zoom(1.35); cy.center(collection); }
    updateControls();
  }

  function fitGraph() {
    if (cy) fitCollection(cy.elements(':visible'));
  }

  function focusResults() {
    if (!cy || !contextualNodes.size) return;
    fitCollection(cy.nodes().filter(node => contextualNodes.has(node.id()) && node.visible()));
  }

  function runLayout() {
    if (!cy || !visibleNodes.length || disposed) return;
    if (layout) { const previous = layout; layout = null; previous.stop(); }
    const next = cy.elements(':visible').layout({
      name: 'cose', animate: false, fit: false, randomize: true,
      nodeRepulsion: 6500, idealEdgeLength: 110, nodeOverlap: 24,
      componentSpacing: 65, gravity: 0.3, numIter: 650,
      nodeDimensionsIncludeLabels: true,
      stop: () => { if (!disposed && layout === next) fitGraph(); },
    });
    layout = next;
    next.run();
  }

  function zoom(factor) {
    if (!cy || !visibleNodes.length) return;
    cy.zoom({ level: Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  function canvasUnavailable() {
    canvasFailed = true;
    if (layout) { const previous = layout; layout = null; previous.stop(); }
    if (cy) { cy.destroy(); cy = null; }
    updateControls();
    updateEmpty();
  }

  function resize() {
    resizeFrame = null;
    if (disposed || canvasFailed || !nodes.length || !root.isConnected) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    try {
      if (!cy) {
        cy = cytoscape({
          container: canvas,
          elements: [
            ...nodes.map(node => ({ data: { id: node.id, kind: node.kind, caption: shortLabel(node.label ?? node.content ?? node.id) }, classes: [node.kind === 'memory' && node.indexed === false ? 'pending' : '', node.pinned === true ? 'pinned' : '', node.status === 'archived' ? 'archived' : ''].join(' ') })),
            ...edges.map(edge => ({ data: { id: edge.id, kind: edge.kind, source: edge.source, target: edge.target, score: edge.score, caption: shortLabel(edge.label ?? '', 32) }, classes: edge.status === 'archived' ? 'archived' : '' })),
          ],
          style: GRAPH_STYLE, layout: { name: 'preset' },
          minZoom: 0.04, maxZoom: 3, autoungrabify: false, autounselectify: true,
          boxSelectionEnabled: false,
        });
        cy.on('tap', 'node, edge', event => select(event.target.id()));
        cy.on('tap', event => { if (event.target === cy) select(null); });
        cy.on('zoom', updateControls);
        syncCanvas();
        runLayout();
      } else if (width !== lastWidth || height !== lastHeight) {
        cy.resize();
        fitGraph();
      }
      lastWidth = width;
      lastHeight = height;
      updateControls();
    } catch {
      canvasUnavailable();
    }
  }

  function scheduleResize() {
    if (!disposed && resizeFrame === null) resizeFrame = view.requestAnimationFrame(resize);
  }

  function clearSearch() {
    search.value = '';
    updateSearch();
    fitGraph();
    search.focus();
  }

  listen(root, 'click', event => {
    const target = event.target.closest?.('button[data-action]');
    if (!target || !root.contains(target) || target.disabled || disposed) return;
    switch (target.dataset.action) {
      case 'select': select(target.dataset.graphId, true); break;
      case 'deselect': select(null); break;
      case 'clear-search': clearSearch(); break;
      case 'focus': focusResults(); break;
      case 'fit': fitGraph(); break;
      case 'layout': try { runLayout(); } catch { canvasUnavailable(); } break;
      case 'zoom-in': zoom(1.25); break;
      case 'zoom-out': zoom(0.8); break;
      case 'details': detailContent.focus(); break;
      case 'open-memory': {
        const reference = target.dataset.memoryRef;
        const record = records.get(selectedId);
        const id = record && evidenceIds(record).find(value => String(value) === reference);
        if (id !== undefined && typeof onOpenMemory === 'function') {
          onOpenMemory(memoryById.has(reference) ? memoryId(memoryById.get(reference)) : id);
        }
        break;
      }
    }
  });
  listen(search, 'input', updateSearch);
  listen(filter, 'change', () => { updateSearch(); fitGraph(); });
  listen(evidence, 'change', () => { updateSearch(); fitGraph(); });
  listen(root, 'keydown', event => {
    if (disposed) return;
    if (event.target === search && event.key === 'Enter') { event.preventDefault(); focusResults(); }
    if (event.key === 'Escape') {
      if (event.target === search && search.value) { event.preventDefault(); clearSearch(); }
      else if (selectedId) { event.preventDefault(); select(null); }
    }
    if (event.target !== stage || !cy || event.ctrlKey || event.metaKey || event.altKey) return;
    const pans = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } };
    if (Object.hasOwn(pans, event.key)) { event.preventDefault(); cy.panBy(pans[event.key]); }
    else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') fitGraph(); else zoom(event.key === '-' ? 0.8 : 1.25);
    }
  });
  listen(stylesheet, 'load', scheduleResize);

  container.append(root);
  renderDetails();
  updateSearch();
  if (typeof view.ResizeObserver === 'function') {
    observer = new view.ResizeObserver(scheduleResize);
    observer.observe(stage);
  }
  scheduleResize();

  return function cleanup() {
    if (disposed) return;
    disposed = true;
    if (resizeFrame !== null) view.cancelAnimationFrame(resizeFrame);
    observer?.disconnect();
    listeners.splice(0).forEach(remove => remove());
    if (layout) { layout.stop(); layout = null; }
    if (cy) { cy.removeAllListeners(); cy.destroy(); cy = null; }
    listButtons.clear();
    root.remove();
  };
}
