// ─────────────────────────────────────────────────────────────
// Diagram Builder – SVG-based ER / Flowchart editor
// ─────────────────────────────────────────────────────────────

let diagram = null;
let diagramId = null;
let diagramType = 'flowchart';
let selectedRelType = 'one-to-many';
let isReadOnly = false;

// Node/edge state
let nodes = [];
let edges = [];
let nextId = 1;

// Interaction state
let tool = 'select';
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let isDragging = false;
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let drawingEdge = null;
let selectedId = null;
let editingErNodeId = null;
let saveTimeout = null;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const NODE_DEFAULTS = {
  start:     { w: 130, h: 44, color: '#22d3a0', label: 'Start' },
  end:       { w: 130, h: 44, color: '#f87171', label: 'End' },
  process:   { w: 140, h: 50, color: '#7c6af0', label: 'Process' },
  decision:  { w: 130, h: 70, color: '#fbbf24', label: 'Decision?' },
  io:        { w: 140, h: 50, color: '#60a5fa', label: 'Input/Output' },
  connector: { w: 50,  h: 50, color: '#fb923c', label: '' },
  'er-table':{ w: 180, h: 120, color: '#7c6af0', label: 'NewTable' },
  'text':    { w: 180, h: 80, color: '#a8a8c0', label: 'Add text here...' }
};

$(document).ready(async function () {
  const session = await APP.init();

  const params = new URLSearchParams(window.location.search);
  diagramId = params.get('id');
  if (!diagramId) { window.location.href = 'dashboard.html'; return; }

  await loadDiagram();
  initCanvas();
  initPalette();
  initToolbar();
  initKeyboard();
  initUserMenu(session);
});

function initUserMenu(session) {
  const user = session?.user;
  if (!user) return;

  const isGuest = user.is_anonymous;
  const name = isGuest ? 'Guest' : (user.email?.split('@')[0] || 'User');
  const initials = name.slice(0, 2).toUpperCase();

  $('#diagram-user-avatar').text(initials);
  $('#diagram-user-name').text(name);
  $('#diagram-user-email').text(isGuest ? 'Guest account' : user.email);
  $('#btn-diagram-logout').html(isGuest ? '<span>👤</span> Sign In / Create Account' : '<span>🚪</span> Sign Out');

  $('#diagram-user-btn').on('click', function (e) {
    e.stopPropagation();
    $('#diagram-user-dropdown').toggleClass('open');
  });
  $(document).on('click', function () { $('#diagram-user-dropdown').removeClass('open'); });

  $('#btn-diagram-logout').on('click', async function () {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });
}

// ── Load / Save ───────────────────────────────────────────────
async function loadDiagram() {
  const { data, error } = await supabase
    .from('diagrams')
    .select('*')
    .eq('id', diagramId)
    .single();

  if (error || !data) { APP.toast('Diagram not found', 'error'); return; }

  diagram = data;
  diagramType = data.type;
  $('#diagram-name').val(data.name);
  $('#diagram-type-badge').text(diagramType === 'er' ? 'ER DIAGRAM' : 'FLOWCHART');

  // Check workspace membership; non-members get read-only access
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (user && !user.is_anonymous) {
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', data.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) setReadOnlyMode();
  } else {
    setReadOnlyMode();
  }

  // Show correct palette
  if (diagramType === 'er') {
    $('#palette-flowchart').hide();
    $('#palette-er').show();
  }

  // Load data
  const saved = data.data || { nodes: [], edges: [] };
  nodes = saved.nodes || [];
  edges = saved.edges || [];
  nextId = Math.max(0, ...nodes.map(n => parseInt(n.id.replace('n','')) || 0),
                       ...edges.map(e => parseInt(e.id.replace('e','')) || 0)) + 1;

  renderAll();
  fitView();
}

function setReadOnlyMode() {
  isReadOnly = true;
  $('#btn-save-diagram').hide();
  $('#btn-export').hide();
  $('#btn-export-json').hide();
  $('#btn-share').hide();
  $('[data-tool="connect"]').hide();
  $('#diagram-type-badge').off('click').css('opacity', '0.5');
  $('#diagram-name').prop('readonly', true);
  $('.diagram-sidebar').hide();
  $('<span style="padding:2px 10px;background:rgba(251,146,60,0.12);color:#fb923c;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.5px;white-space:nowrap">VIEW ONLY</span>')
    .insertAfter('#diagram-type-badge');
}

async function saveDiagram() {
  const name = $('#diagram-name').val().trim() || 'Untitled';
  const { error } = await supabase.from('diagrams').update({
    name,
    type: diagramType,
    data: { nodes, edges }
  }).eq('id', diagramId);

  if (error) { APP.toast('Save failed', 'error'); return; }
  APP.toast('Saved!', 'success');
}

async function switchDiagramType() {
  if (isReadOnly) return;
  const newType = diagramType === 'flowchart' ? 'er' : 'flowchart';
  diagramType = newType;
  const label = newType === 'er' ? 'ER DIAGRAM' : 'FLOWCHART';
  $('#diagram-type-badge').text(label);
  if (newType === 'er') {
    $('#palette-flowchart').hide();
    $('#palette-er').show();
  } else {
    $('#palette-er').hide();
    $('#palette-flowchart').show();
  }
  scheduleSave();
}

async function shareDiagram() {
  const $btn = $('#btn-share');
  $btn.text('Sharing...').prop('disabled', true);
  const { error } = await supabase.from('diagrams').update({ is_public: true }).eq('id', diagramId);
  if (error) {
    APP.toast('Could not share: ' + error.message, 'error');
    $btn.text('Share Link').prop('disabled', false);
    return;
  }
  const url = window.location.origin + window.location.pathname + '?id=' + diagramId;
  try {
    await navigator.clipboard.writeText(url);
    APP.toast('Share link copied to clipboard!', 'success');
  } catch {
    prompt('Copy this link:', url);
  }
  $btn.text('Shared ✓').prop('disabled', false);
}

function scheduleSave() {
  if (isReadOnly) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveDiagram, 2000);
}

// ── Inline Text Editor ────────────────────────────────────────
let textEditNode = null;

function openTextEditor(node) {
  // Close any open editor first (blur saves it)
  const existing = document.getElementById('inline-text-editor');
  if (existing) { existing.blur(); }

  textEditNode = node;
  const wrapper = document.getElementById('canvas-wrapper');
  const r = wrapper.getBoundingClientRect();

  const $ta = $('<textarea id="inline-text-editor"></textarea>')
    .css({
      left:      (r.left + panX + node.x * scale) + 'px',
      top:       (r.top  + panY + node.y * scale) + 'px',
      width:     (node.w * scale) + 'px',
      height:    (node.h * scale) + 'px',
      border:    '1.5px dashed ' + node.color,
      color:     node.color,
      fontSize:  Math.round(12 * scale) + 'px',
      caretColor: node.color
    })
    .val(node.label === 'Add text here...' ? '' : node.label);

  $('body').append($ta);
  $ta[0].setSelectionRange($ta.val().length, $ta.val().length);
  $ta.focus();

  $ta.on('input', function () {
    node.label = $(this).val() || '';
    renderNode(node);
  });

  $ta.on('blur', function () {
    if (!textEditNode || textEditNode.id !== node.id) return;
    node.label = $(this).val() || '';
    if (!node.label.trim()) node.label = '';
    renderNode(node);
    renderEdgesForNode(node.id);
    scheduleSave();
    $(this).remove();
    textEditNode = null;
  });

  $ta.on('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') $(this).blur();
  });
}

function updateInlineEditorPos() {
  if (!textEditNode) return;
  const $ta = $('#inline-text-editor');
  if (!$ta.length) return;
  const wrapper = document.getElementById('canvas-wrapper');
  const r = wrapper.getBoundingClientRect();
  $ta.css({
    left:     (r.left + panX + textEditNode.x * scale) + 'px',
    top:      (r.top  + panY + textEditNode.y * scale) + 'px',
    width:    (textEditNode.w * scale) + 'px',
    height:   (textEditNode.h * scale) + 'px',
    fontSize: Math.round(12 * scale) + 'px'
  });
}

// ── Canvas Init ───────────────────────────────────────────────
function initCanvas() {
  const svg = document.getElementById('diagram-svg');
  const wrapper = document.getElementById('canvas-wrapper');

  // Drag from palette (drop onto canvas)
  wrapper.addEventListener('dragover', e => { e.preventDefault(); wrapper.classList.add('drag-over'); });
  wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
  wrapper.addEventListener('drop', e => {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
    if (isReadOnly) return;
    const type = e.dataTransfer.getData('node-type');
    if (!type) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left - panX) / scale;
    const y = (e.clientY - rect.top - panY) / scale;
    addNode(type, x - NODE_DEFAULTS[type].w / 2, y - NODE_DEFAULTS[type].h / 2);
  });

  // Mouse events on SVG
  $(svg).on('mousedown', function (e) {
    if ($(e.target).closest('.node-group').length) return;
    if ($(e.target).closest('.node-port').length) return;

    const pos = svgPos(e);

    if (tool === 'pan' || e.button === 1) {
      isPanning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
      e.preventDefault();
      return;
    }

    if (tool === 'select') {
      selectNode(null);
      cancelEdgeDrawing();
    }
  });

  $(window).on('mousemove', function (e) {
    if (isPanning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      updateTransform();
      return;
    }
    if (isDragging && dragNode) {
      const pos = svgPos(e);
      dragNode.x = pos.x - dragOffset.x;
      dragNode.y = pos.y - dragOffset.y;
      renderNode(dragNode);
      renderEdgesForNode(dragNode.id);
      return;
    }
    if (drawingEdge) {
      const pos = svgPos(e);
      const fp = drawingEdge.fromPos;
      const mag = Math.max(Math.abs(pos.x - fp.x) * 0.5, Math.abs(pos.y - fp.y) * 0.5, 50);
      let c1x = fp.x, c1y = fp.y;
      if      (drawingEdge.fromPort === 'e') c1x = fp.x + mag;
      else if (drawingEdge.fromPort === 'w') c1x = fp.x - mag;
      else if (drawingEdge.fromPort === 'n') c1y = fp.y - mag;
      else if (drawingEdge.fromPort === 's') c1y = fp.y + mag;
      $('#temp-edge').attr('d', `M ${fp.x} ${fp.y} C ${c1x} ${c1y}, ${pos.x} ${pos.y}, ${pos.x} ${pos.y}`);
    }
  });

  $(window).on('mouseup', function (e) {
    if (isPanning) { isPanning = false; return; }
    if (isDragging) {
      isDragging = false;
      dragNode = null;
      scheduleSave();
      return;
    }
    if (drawingEdge && !$(e.target).closest('.node-group').length) {
      cancelEdgeDrawing();
    }
  });

  // Scroll to zoom
  $(svg).on('wheel', function (e) {
    e.preventDefault();
    const delta = e.originalEvent.deltaY > 0 ? 0.9 : 1.1;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * delta));
    panX = mx - (mx - panX) * (newScale / scale);
    panY = my - (my - panY) * (newScale / scale);
    scale = newScale;
    updateTransform();
    updateZoomDisplay();
  });

  // Right-click context menu
  $(svg).on('contextmenu', function (e) {
    if (!selectedId) return;
    e.preventDefault();
    $('#ctx-menu').css({ display: 'block', left: e.clientX - $(svg).offset().left, top: e.clientY - $(svg).offset().top });
  });

  $(document).on('click', function () { $('#ctx-menu').hide(); });

  $('#ctx-delete').on('click', () => deleteSelected());
  $('#ctx-duplicate').on('click', () => duplicateSelected());
  $('#ctx-bring-front').on('click', () => bringToFront(selectedId));
}

// ── Palette ───────────────────────────────────────────────────
function initPalette() {
  // Make palette items draggable
  $(document).on('dragstart', '.palette-item', function (e) {
    e.originalEvent.dataTransfer.setData('node-type', $(this).data('type'));
  });

  // Relationship type buttons
  $('.rel-btn').on('click', function () {
    $('.rel-btn').removeClass('active');
    $(this).addClass('active');
    selectedRelType = $(this).data('rel');
  });

  // ER column editor
  $('#btn-add-column').on('click', addErColumn);
  $('#btn-save-er-table').on('click', saveErTable);
  $(document).on('click', '[data-close]', function () {
    $(`#${$(this).data('close')}`).removeClass('open');
  });
}

// ── Toolbar ───────────────────────────────────────────────────
function initToolbar() {
  // Tool selection
  $('.tool-btn[data-tool]').on('click', function () {
    setTool($(this).data('tool'));
  });

  // Zoom
  $('#btn-zoom-in').on('click', () => { zoom(1.2); });
  $('#btn-zoom-out').on('click', () => { zoom(0.8); });
  $('#btn-zoom-fit').on('click', fitView);

  // Save
  $('#btn-save-diagram').on('click', saveDiagram);
  $('#diagram-name').on('input', scheduleSave);

  // Export / Share
  $('#btn-export').on('click', exportSVG);
  $('#btn-export-json').on('click', exportDiagramJson);
  $('#btn-share').on('click', shareDiagram);

  // Toggle diagram type (Flowchart ↔ ER)
  $('#diagram-type-badge').on('click', switchDiagramType);
}

function setTool(t) {
  tool = t;
  $('.tool-btn[data-tool]').removeClass('active');
  $(`.tool-btn[data-tool="${t}"]`).addClass('active');
  const svg = document.getElementById('diagram-svg');
  svg.className = `tool-${t}`;
  if (t !== 'connect') cancelEdgeDrawing();
}

function initKeyboard() {
  $(document).on('keydown', function (e) {
    if ($(e.target).is('input, textarea, select')) return;
    switch (e.key) {
      case 'v': case 'V': setTool('select'); break;
      case 'c': case 'C': setTool('connect'); break;
      case 'Delete': case 'Backspace': if (!isReadOnly) deleteSelected(); break;
      case '+': case '=': zoom(1.2); break;
      case '-': zoom(0.8); break;
      case 'Escape': selectNode(null); cancelEdgeDrawing(); setTool('select'); break;
      case ' ':
        e.preventDefault();
        if (!isPanning) setTool('pan');
        break;
    }
  });
  $(document).on('keyup', function (e) {
    if (e.key === ' ' && tool === 'pan') setTool('select');
  });
}

// ── Node CRUD ─────────────────────────────────────────────────
function addNode(type, x, y) {
  const def = NODE_DEFAULTS[type] || NODE_DEFAULTS.process;
  const node = {
    id: 'n' + nextId++,
    type,
    label: def.label,
    x: Math.round(x),
    y: Math.round(y),
    w: def.w,
    h: def.h,
    color: def.color,
    columns: type === 'er-table' ? [
      { name: 'id', type: 'UUID', pk: true, fk: false, nn: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', pk: false, fk: false, nn: false }
    ] : []
  };
  nodes.push(node);
  renderNode(node);
  selectNode(node.id);
  scheduleSave();
  return node;
}

function deleteNode(id) {
  if (textEditNode && textEditNode.id === id) {
    $('#inline-text-editor').off('blur').remove();
    textEditNode = null;
  }
  nodes = nodes.filter(n => n.id !== id);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  $(`#${id}`).remove();
  renderEdges();
  if (selectedId === id) selectNode(null);
  scheduleSave();
}

function duplicateSelected() {
  const node = nodes.find(n => n.id === selectedId);
  if (!node) return;
  const dup = { ...node, id: 'n' + nextId++, x: node.x + 30, y: node.y + 30, columns: JSON.parse(JSON.stringify(node.columns || [])) };
  nodes.push(dup);
  renderNode(dup);
  selectNode(dup.id);
  scheduleSave();
}

function bringToFront(id) {
  const el = document.getElementById(id);
  if (el) el.parentNode.appendChild(el);
}

function deleteSelected() {
  if (isReadOnly || !selectedId) return;
  const edge = edges.find(e => e.id === selectedId);
  if (edge) {
    edges = edges.filter(e => e.id !== selectedId);
    $(`#${selectedId}`).remove();
    $(`#label-${selectedId}`).remove();
    selectNode(null);
    scheduleSave();
    return;
  }
  deleteNode(selectedId);
}

// ── Rendering ─────────────────────────────────────────────────
function renderAll() {
  $('#nodes-layer').empty();
  $('#edges-layer').empty();
  edges.forEach(e => renderEdge(e));
  nodes.forEach(n => renderNode(n));
}

function renderNode(node) {
  const existing = document.getElementById(node.id);
  if (existing) existing.remove();

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', node.id);
  g.setAttribute('class', 'node-group');
  g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const shape = buildNodeShape(node);
  g.appendChild(shape);

  // Ports (connection points)
  const ports = [
    { id: 'n', cx: node.w / 2, cy: 0 },
    { id: 's', cx: node.w / 2, cy: node.h },
    { id: 'e', cx: node.w, cy: node.h / 2 },
    { id: 'w', cx: 0, cy: node.h / 2 }
  ];

  ports.forEach(p => {
    const port = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    port.setAttribute('class', 'node-port');
    port.setAttribute('cx', p.cx);
    port.setAttribute('cy', p.cy);
    port.setAttribute('r', 5);
    port.setAttribute('data-port', p.id);
    port.style.display = 'none';
    g.appendChild(port);
  });

  document.getElementById('nodes-layer').appendChild(g);
  bindNodeEvents(g, node);
}

function buildNodeShape(node) {
  const frag = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  frag.setAttribute('class', 'node-shape');
  const { w, h, color, label, type, columns } = node;
  const alpha = '26'; // ~15% opacity fill

  if (type === 'start' || type === 'end') {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('rx', h / 2); r.setAttribute('ry', h / 2);
    r.setAttribute('fill', color + alpha); r.setAttribute('stroke', color); r.setAttribute('stroke-width', '2');
    frag.appendChild(r);
    frag.appendChild(makeText(label, w / 2, h / 2, 12, color));
  } else if (type === 'decision') {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `${w/2},0 ${w},${h/2} ${w/2},${h} 0,${h/2}`);
    poly.setAttribute('fill', color + alpha); poly.setAttribute('stroke', color); poly.setAttribute('stroke-width', '2');
    frag.appendChild(poly);
    frag.appendChild(makeText(label, w / 2, h / 2, 11, color));
  } else if (type === 'io') {
    const off = 12;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `${off},0 ${w},0 ${w - off},${h} 0,${h}`);
    poly.setAttribute('fill', color + alpha); poly.setAttribute('stroke', color); poly.setAttribute('stroke-width', '2');
    frag.appendChild(poly);
    frag.appendChild(makeText(label, w / 2, h / 2, 12, color));
  } else if (type === 'connector') {
    const cx = w / 2, cy = h / 2, r2 = Math.min(w, h) / 2 - 2;
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r2);
    c.setAttribute('fill', color + alpha); c.setAttribute('stroke', color); c.setAttribute('stroke-width', '2');
    frag.appendChild(c);
  } else if (type === 'er-table') {
    // Table header
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 6); rect.setAttribute('fill', '#16162a');
    rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '2');
    frag.appendChild(rect);

    const hdr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hdr.setAttribute('width', w); hdr.setAttribute('height', 28);
    hdr.setAttribute('rx', 6);
    hdr.setAttribute('fill', color + '40');
    frag.appendChild(hdr);

    // Fix corners
    const hdrFix = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hdrFix.setAttribute('y', 14); hdrFix.setAttribute('width', w); hdrFix.setAttribute('height', 14);
    hdrFix.setAttribute('fill', color + '40');
    frag.appendChild(hdrFix);

    frag.appendChild(makeText(label, w / 2, 14, 12, '#f4f4f8', 700));

    // Divider
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', 28);
    line.setAttribute('x2', w); line.setAttribute('y2', 28);
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1'); line.setAttribute('stroke-opacity', '0.4');
    frag.appendChild(line);

    // Columns
    let cy = 44;
    (columns || []).slice(0, Math.floor((h - 36) / 16)).forEach(col => {
      const icon = col.pk ? '🔑' : col.fk ? '🔗' : ' ';
      frag.appendChild(makeText(`${icon} ${col.name}`, 10, cy, 10, col.pk ? '#fbbf24' : col.fk ? '#60a5fa' : '#a8a8c0', 500, 'start'));
      frag.appendChild(makeText(col.type, w - 6, cy, 9, '#6a6a88', 400, 'end'));
      cy += 16;
    });

    // Edit button overlay (invisible, clickable)
    const editBtn = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    editBtn.setAttribute('width', w); editBtn.setAttribute('height', 28);
    editBtn.setAttribute('fill', 'transparent');
    editBtn.setAttribute('class', 'er-edit-btn');
    editBtn.setAttribute('data-node-id', node.id);
    frag.appendChild(editBtn);
  } else if (type === 'text') {
    // Invisible hit/select area — no visible box in normal state
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('width', w); hit.setAttribute('height', h);
    hit.setAttribute('rx', 6);
    hit.setAttribute('class', 'text-hit-area');
    frag.appendChild(hit);
    const lines = String(label || '').split('\n');
    const lineH = 18;
    const totalH = lines.length * lineH;
    const startY = (h - totalH) / 2 + lineH / 2;
    if (lines.length === 1 && !lines[0].trim()) {
      frag.appendChild(makeText('Double-click to edit', w / 2, h / 2, 10, color + '70', 400));
    } else {
      lines.forEach((line, i) => frag.appendChild(makeText(line, w / 2, startY + i * lineH, 12, color, 400)));
    }
  } else {
    // Default process rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 6); rect.setAttribute('fill', color + alpha);
    rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '2');
    frag.appendChild(rect);
    frag.appendChild(makeText(label, w / 2, h / 2, 12, '#f4f4f8'));
  }

  return frag;
}

function makeText(text, x, y, size, fill, weight = 600, anchor = 'middle') {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', x); t.setAttribute('y', y);
  t.setAttribute('font-size', size); t.setAttribute('fill', fill);
  t.setAttribute('font-weight', weight);
  t.setAttribute('text-anchor', anchor);
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('font-family', 'Inter, sans-serif');
  t.textContent = text;
  return t;
}

// ── Node Events ───────────────────────────────────────────────
function bindNodeEvents(g, node) {
  const $g = $(g);

  // Show ports on hover
  $g.on('mouseenter', function () {
    if (tool === 'connect' || tool === 'select') {
      $(this).find('.node-port').show();
    }
  }).on('mouseleave', function () {
    $(this).find('.node-port').hide();
  });

  // Mousedown – start drag or connect
  $g.on('mousedown', function (e) {
    e.stopPropagation();

    if ($(e.target).hasClass('node-port')) {
      // Start edge drawing
      if (!isReadOnly && (tool === 'connect' || tool === 'select')) {
        const portDir = $(e.target).data('port');
        const portPos = getPortPos(node, portDir);
        drawingEdge = { fromId: node.id, fromPort: portDir, fromPos: portPos };
        $('#temp-edge').attr('d', `M ${portPos.x} ${portPos.y}`).show();
        e.preventDefault();
        return;
      }
    }

    if ($(e.target).hasClass('er-edit-btn')) {
      openErEditor(node.id);
      return;
    }

    if (drawingEdge) return;

    selectNode(node.id);

    if (tool === 'select' && !isReadOnly) {
      isDragging = true;
      dragNode = node;
      const pos = svgPos(e);
      dragOffset = { x: pos.x - node.x, y: pos.y - node.y };
      e.preventDefault();
    }
  });

  // Complete edge on port click (from another node)
  $g.on('mouseup', function (e) {
    if (!drawingEdge || drawingEdge.fromId === node.id) {
      cancelEdgeDrawing();
      return;
    }
    const portDir = $(e.target).data('port') || 'w';
    completeEdge(node.id, portDir);
    e.stopPropagation();
  });

  // Double-click to edit label
  $g.on('dblclick', function (e) {
    if (isReadOnly) return;
    if (node.type === 'er-table') { openErEditor(node.id); return; }
    if (node.type === 'text') { openTextEditor(node); return; }
    const newLabel = prompt('Edit label:', node.label);
    if (newLabel !== null) {
      node.label = newLabel;
      renderNode(node);
      renderEdgesForNode(node.id);
      scheduleSave();
    }
  });
}

// ── Edge Drawing ──────────────────────────────────────────────
function completeEdge(toId, toPort) {
  if (!drawingEdge) return;
  const pending = drawingEdge;
  cancelEdgeDrawing();

  const edge = {
    id: 'e' + nextId++,
    from: pending.fromId,
    fromPort: pending.fromPort,
    to: toId,
    toPort: toPort,
    label: '',
    relType: selectedRelType
  };
  edges.push(edge);
  renderEdge(edge);
  scheduleSave();
}

function cancelEdgeDrawing() {
  drawingEdge = null;
  $('#temp-edge').hide();
}

function renderEdge(edge) {
  // Remove existing
  $(`#${edge.id}`).remove();
  $(`#label-${edge.id}`).remove();

  const fromNode = nodes.find(n => n.id === edge.from);
  const toNode = nodes.find(n => n.id === edge.to);
  if (!fromNode || !toNode) return;

  const fp = getPortPos(fromNode, edge.fromPort || 'e');
  const tp = getPortPos(toNode, edge.toPort || 'w');

  // Bezier control points — follow port direction so arrow orient="auto" works correctly
  const mag = Math.max(Math.abs(tp.x - fp.x) * 0.5, Math.abs(tp.y - fp.y) * 0.5, 50);
  let c1x = fp.x, c1y = fp.y;
  const fromPort = edge.fromPort || 'e';
  if      (fromPort === 'e') c1x = fp.x + mag;
  else if (fromPort === 'w') c1x = fp.x - mag;
  else if (fromPort === 'n') c1y = fp.y - mag;
  else if (fromPort === 's') c1y = fp.y + mag;

  let c2x = tp.x, c2y = tp.y;
  const toPort = edge.toPort || 'w';
  if      (toPort === 'w') c2x = tp.x - mag;
  else if (toPort === 'e') c2x = tp.x + mag;
  else if (toPort === 'n') c2y = tp.y - mag;
  else if (toPort === 's') c2y = tp.y + mag;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('id', edge.id);
  path.setAttribute('class', `edge-path ${edge.id === selectedId ? 'selected' : ''}`);
  path.setAttribute('d', `M ${fp.x} ${fp.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tp.x} ${tp.y}`);
  path.setAttribute('marker-end', `url(#${edge.id === selectedId ? 'arrow-selected' : 'arrow'})`);
  path.setAttribute('stroke', edge.id === selectedId ? '#7c6af0' : getEdgeColor(edge.relType));
  path.setAttribute('stroke-width', '2');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-dasharray', edge.relType === 'many-to-many' ? '6,3' : 'none');

  // Click to select edge
  path.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNode(edge.id);
  });

  document.getElementById('edges-layer').appendChild(path);

  // Cardinality labels for ER
  if (diagramType === 'er' && edge.relType) {
    const labels = getRelLabels(edge.relType);
    const midX = (fp.x + tp.x) / 2;
    const midY = (fp.y + tp.y) / 2;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `label-${edge.id}`);

    const fromLabel = makeText(labels[0], fp.x + (fp.x < tp.x ? 16 : -16), fp.y - 8, 11, '#6a6a88');
    const toLabel = makeText(labels[1], tp.x + (tp.x > fp.x ? -16 : 16), tp.y - 8, 11, '#6a6a88');

    g.appendChild(fromLabel);
    g.appendChild(toLabel);
    document.getElementById('edges-layer').appendChild(g);
  }
}

function getEdgeColor(relType) {
  if (!relType) return '#4a4a68';
  if (relType === 'one-to-many') return '#6366f1';
  if (relType === 'many-to-many') return '#8b5cf6';
  return '#60a5fa';
}

function getRelLabels(relType) {
  const map = {
    'one-to-many': ['1', 'N'],
    'many-to-many': ['M', 'N'],
    'one-to-one': ['1', '1']
  };
  return map[relType] || ['', ''];
}

function renderEdges() {
  $('#edges-layer').empty();
  edges.forEach(e => renderEdge(e));
}

function renderEdgesForNode(nodeId) {
  edges.filter(e => e.from === nodeId || e.to === nodeId).forEach(e => renderEdge(e));
}

// ── Selection ─────────────────────────────────────────────────
function selectNode(id) {
  selectedId = id;
  $('.node-group').removeClass('selected');
  $('.edge-path').removeClass('selected').attr('stroke', '#4a4a68').attr('marker-end', 'url(#arrow)');

  if (!id) {
    $('#properties-panel').hide();
    return;
  }

  const node = nodes.find(n => n.id === id);
  if (node) {
    $(`#${id}`).addClass('selected');
    showNodeProperties(node);
    return;
  }

  const edge = edges.find(e => e.id === id);
  if (edge) {
    const path = document.getElementById(id);
    if (path) {
      path.setAttribute('stroke', '#7c6af0');
      path.setAttribute('marker-end', 'url(#arrow-selected)');
    }
    showEdgeProperties(edge);
  }
}

function showNodeProperties(node) {
  if (node.type === 'er-table') { $('#properties-panel').hide(); return; }
  $('#properties-panel').show();

  if (node.type === 'text') {
    $('#properties-content').html(`
      <div class="prop-row">
        <label class="prop-label">Color</label>
        <input type="color" class="prop-input" id="prop-color" value="${node.color}" style="padding:2px;height:32px">
      </div>
      <p style="font-size:10px;color:var(--text-3);margin-top:8px;line-height:1.5">Double-click the text on canvas to edit. Click outside to close.</p>
    `);
    $('#prop-color').on('input', function () {
      node.color = $(this).val();
      renderNode(node);
      const $ta = $('#inline-text-editor');
      if ($ta.length && textEditNode && textEditNode.id === node.id) {
        $ta.css({ border: '1.5px dashed ' + node.color, color: node.color, caretColor: node.color });
      }
      scheduleSave();
    });
    return;
  }

  $('#properties-content').html(`
    <div class="prop-row">
      <label class="prop-label">Label</label>
      <input class="prop-input" id="prop-label" value="${escHtml(node.label)}">
    </div>
    <div class="prop-row">
      <label class="prop-label">Color</label>
      <input type="color" class="prop-input" id="prop-color" value="${node.color}" style="padding:2px;height:32px">
    </div>
  `);

  $('#prop-label').on('input', function () {
    node.label = $(this).val();
    renderNode(node);
    scheduleSave();
  });
  $('#prop-color').on('input', function () {
    node.color = $(this).val();
    renderNode(node);
    scheduleSave();
  });
}

function showEdgeProperties(edge) {
  $('#properties-panel').show();
  const relOpts = diagramType === 'er' ? `
    <div class="prop-row">
      <label class="prop-label">Relationship</label>
      <select class="prop-input" id="prop-rel">
        <option value="one-to-many" ${edge.relType==='one-to-many'?'selected':''}>1 to N</option>
        <option value="many-to-many" ${edge.relType==='many-to-many'?'selected':''}>M to N</option>
        <option value="one-to-one" ${edge.relType==='one-to-one'?'selected':''}>1 to 1</option>
      </select>
    </div>
  ` : '';

  $('#properties-content').html(`
    <div class="prop-row">
      <label class="prop-label">Label</label>
      <input class="prop-input" id="prop-edge-label" value="${escHtml(edge.label || '')}">
    </div>
    ${relOpts}
    <button class="btn btn-danger btn-sm" id="prop-delete-edge" style="margin-top:4px">Delete Edge</button>
  `);

  $('#prop-edge-label').on('input', function () {
    edge.label = $(this).val();
    renderEdge(edge);
    scheduleSave();
  });
  $('#prop-rel').on('change', function () {
    edge.relType = $(this).val();
    renderEdge(edge);
    scheduleSave();
  });
  $('#prop-delete-edge').on('click', function () {
    edges = edges.filter(e => e.id !== edge.id);
    $(`#${edge.id}`).remove();
    $(`#label-${edge.id}`).remove();
    selectNode(null);
    scheduleSave();
  });
}

// ── ER Table Editor ───────────────────────────────────────────
function openErEditor(nodeId) {
  if (isReadOnly) return;
  editingErNodeId = nodeId;
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;

  $('#er-table-name').val(node.label);
  renderErColumns(node.columns || []);
  $('#modal-er-columns').addClass('open');
}

function renderErColumns(cols) {
  const types = ['UUID', 'TEXT', 'INT', 'BIGINT', 'BOOLEAN', 'TIMESTAMPTZ', 'DATE', 'FLOAT', 'JSONB', 'UUID[]'];
  const html = cols.map((col, i) => `
    <div class="er-col-row" data-idx="${i}">
      <input class="input col-name" value="${escHtml(col.name)}" placeholder="column_name" style="font-size:12px">
      <select class="select col-type" style="font-size:12px">
        ${types.map(t => `<option ${col.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <div class="col-flags">
        <button class="flag-btn pk ${col.pk?'active':''}" data-flag="pk" title="Primary Key">PK</button>
        <button class="flag-btn fk ${col.fk?'active':''}" data-flag="fk" title="Foreign Key">FK</button>
        <button class="flag-btn nn ${col.nn?'active':''}" data-flag="nn" title="Not Null">NN</button>
      </div>
      <button class="btn btn-ghost btn-icon-sm remove-col" data-idx="${i}">✕</button>
    </div>
  `).join('');
  $('#er-columns-list').html(html);

  // Flag toggles
  $(document).off('click.er-flags').on('click.er-flags', '.flag-btn', function () {
    $(this).toggleClass('active');
  });

  // Remove column
  $(document).off('click.er-remove').on('click.er-remove', '.remove-col', function () {
    $(this).closest('.er-col-row').remove();
  });
}

function addErColumn() {
  const $list = $('#er-columns-list');
  const idx = $list.children().length;
  const types = ['UUID','TEXT','INT','BIGINT','BOOLEAN','TIMESTAMPTZ','DATE','FLOAT','JSONB'];
  $list.append(`
    <div class="er-col-row" data-idx="${idx}">
      <input class="input col-name" value="new_column" placeholder="column_name" style="font-size:12px">
      <select class="select col-type" style="font-size:12px">${types.map(t=>`<option>${t}</option>`).join('')}</select>
      <div class="col-flags">
        <button class="flag-btn pk" data-flag="pk" title="Primary Key">PK</button>
        <button class="flag-btn fk" data-flag="fk" title="Foreign Key">FK</button>
        <button class="flag-btn nn" data-flag="nn" title="Not Null">NN</button>
      </div>
      <button class="btn btn-ghost btn-icon-sm remove-col" data-idx="${idx}">✕</button>
    </div>
  `);
}

function saveErTable() {
  const node = nodes.find(n => n.id === editingErNodeId);
  if (!node) return;

  node.label = $('#er-table-name').val().trim() || 'Table';
  node.columns = [];

  $('#er-columns-list .er-col-row').each(function () {
    node.columns.push({
      name: $(this).find('.col-name').val().trim(),
      type: $(this).find('.col-type').val(),
      pk: $(this).find('.pk').hasClass('active'),
      fk: $(this).find('.fk').hasClass('active'),
      nn: $(this).find('.nn').hasClass('active')
    });
  });

  // Resize node height based on columns
  node.h = Math.max(80, 36 + node.columns.length * 16 + 8);

  $('#modal-er-columns').removeClass('open');
  renderNode(node);
  renderEdgesForNode(node.id);
  scheduleSave();
}

// ── View helpers ───────────────────────────────────────────────
function getPortPos(node, dir) {
  const { x, y, w, h } = node;
  const ports = {
    n: { x: x + w / 2, y },
    s: { x: x + w / 2, y: y + h },
    e: { x: x + w, y: y + h / 2 },
    w: { x, y: y + h / 2 }
  };
  return ports[dir] || ports.e;
}

function svgPos(e) {
  const svg = document.getElementById('diagram-svg');
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - panX) / scale,
    y: (e.clientY - rect.top - panY) / scale
  };
}

function updateTransform() {
  document.getElementById('diagram-layer').setAttribute('transform', `translate(${panX},${panY}) scale(${scale})`);
  updateInlineEditorPos();
}

function updateZoomDisplay() {
  $('#zoom-display').text(Math.round(scale * 100) + '%');
}

function zoom(factor) {
  const svg = document.getElementById('diagram-svg');
  const cx = svg.clientWidth / 2;
  const cy = svg.clientHeight / 2;
  const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
  panX = cx - (cx - panX) * (newScale / scale);
  panY = cy - (cy - panY) * (newScale / scale);
  scale = newScale;
  updateTransform();
  updateZoomDisplay();
}

function fitView() {
  if (!nodes.length) { scale = 1; panX = 100; panY = 100; updateTransform(); updateZoomDisplay(); return; }

  const svg = document.getElementById('diagram-svg');
  const pad = 60;
  const minX = Math.min(...nodes.map(n => n.x)) - pad;
  const minY = Math.min(...nodes.map(n => n.y)) - pad;
  const maxX = Math.max(...nodes.map(n => n.x + n.w)) + pad;
  const maxY = Math.max(...nodes.map(n => n.y + n.h)) + pad;

  const cw = svg.clientWidth, ch = svg.clientHeight;
  const sx = cw / (maxX - minX);
  const sy = ch / (maxY - minY);
  scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(sx, sy)));
  panX = (cw - (maxX - minX) * scale) / 2 - minX * scale;
  panY = (ch - (maxY - minY) * scale) / 2 - minY * scale;

  updateTransform();
  updateZoomDisplay();
}

// ── Export ─────────────────────────────────────────────────────
function exportSVG() {
  const svg = document.getElementById('diagram-svg');
  const clone = svg.cloneNode(true);
  clone.querySelector('#svg-bg').style.fill = '#0a0a0f';
  clone.querySelector('#temp-edge').remove();
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`;
  clone.insertBefore(style, clone.firstChild);

  const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${$('#diagram-name').val() || 'diagram'}.svg`;
  a.click();
  URL.revokeObjectURL(url);
  APP.toast('SVG exported!', 'success');
}

function exportDiagramJson() {
  const name = $('#diagram-name').val().trim() || 'Untitled';
  const data = {
    taskflow_diagram: true,
    version: 1,
    name,
    type: diagramType,
    nodes,
    edges
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/\s+/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  APP.toast('Diagram exported as JSON!', 'success');
}

// ── Utility ────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
