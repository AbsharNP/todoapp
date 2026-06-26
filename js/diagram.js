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
let dragHistoryPushed = false;
let drawingEdge = null;
let selectedId = null;
let editingErNodeId = null;
let saveTimeout = null;
let snapEdgeTo = null;    // { nodeId, port, pos } — nearest port while drawing an edge
let isResizing = false;
let resizeNode = null;
let resizeHandle = '';     // 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
let resizeStartPos = { x: 0, y: 0 };
let resizeStartGeom = { x: 0, y: 0, w: 0, h: 0 };
let isDraggingBend = false;
let bendEdge = null;
let bendNaturalMid = { x: 0, y: 0 }; // cached base midpoint for current bend drag
let undoStack = [];
let redoStack = [];
let clipboard = null;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const SNAP_THRESHOLD = 8;  // diagram-space px for alignment snap while dragging
const PORT_SNAP_DIST = 30; // diagram-space px for port snap while connecting
const MIN_NODE_SIZE = 30;  // minimum width and height for any node
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
  APP.theme.init();
  APP.theme._updateButtons();

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
  $('#btn-diagram-logout').html(isGuest ? '<span><i class="fa-solid fa-user"></i></span> Sign In / Create Account' : '<span><i class="fa-solid fa-right-from-bracket"></i></span> Sign Out');

  $('#diagram-user-btn').on('click', function (e) {
    e.stopPropagation();
    $('#diagram-user-dropdown').toggleClass('open');
  });
  $(document).on('click', function () { $('#diagram-user-dropdown').removeClass('open'); });

  $('#btn-diagram-theme').on('click', function () { APP.theme.toggle(); });

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
    APP.toast('Copy this link: ' + url, 'info');
  }
  $btn.html('Shared <i class="fa-solid fa-check"></i>').prop('disabled', false);
}

function scheduleSave() {
  if (isReadOnly) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveDiagram, 2000);
}

// ── Undo / Redo ────────────────────────────────────────────────
function pushHistory() {
  if (isReadOnly) return;
  undoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function applyHistoryState(state) {
  nodes = state.nodes; edges = state.edges;
  nextId = Math.max(0, ...nodes.map(n => +n.id.slice(1) || 0), ...edges.map(e => +e.id.slice(1) || 0)) + 1;
  selectNode(null); renderAll(); scheduleSave();
}

function undo() {
  if (!undoStack.length) { APP.toast('Nothing to undo', 'info'); return; }
  redoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  applyHistoryState(undoStack.pop());
}

function redo() {
  if (!redoStack.length) { APP.toast('Nothing to redo', 'info'); return; }
  undoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  applyHistoryState(redoStack.pop());
}

// ── Clipboard ──────────────────────────────────────────────────
function copySelected() {
  const node = nodes.find(n => n.id === selectedId);
  if (!node) return;
  clipboard = JSON.parse(JSON.stringify(node));
  APP.toast('Copied', 'info');
}

function cutSelected() {
  if (isReadOnly) return;
  const node = nodes.find(n => n.id === selectedId);
  if (!node) return;
  clipboard = JSON.parse(JSON.stringify(node));
  deleteSelected(); // deleteSelected pushes its own history
  APP.toast('Cut', 'info');
}

function pasteClipboard() {
  if (!clipboard || isReadOnly) return;
  pushHistory();
  const node = {
    ...JSON.parse(JSON.stringify(clipboard)),
    id: 'n' + nextId++,
    x: clipboard.x + 30,
    y: clipboard.y + 30
  };
  nodes.push(node); renderNode(node); selectNode(node.id); scheduleSave();
}

// ── Inline Text Editor ────────────────────────────────────────
let textEditNode = null;

function openTextEditor(node) {
  const existing = document.getElementById('inline-text-editor');
  if (existing) { existing.blur(); }

  textEditNode = node;
  const wrapper = document.getElementById('canvas-wrapper');
  const r = wrapper.getBoundingClientRect();

  let histPushed = false;
  const maybePush = () => { if (!histPushed) { pushHistory(); histPushed = true; } };

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
    .val(node.type === 'text' && node.label === 'Add text here...' ? '' : node.label);

  $('body').append($ta);
  $ta[0].setSelectionRange(0, $ta.val().length);
  $ta.focus();

  $ta.on('input', function () {
    maybePush();
    node.label = $(this).val() || '';
    renderNode(node);
  });

  $ta.on('blur', function () {
    if (!textEditNode || textEditNode.id !== node.id) return;
    node.label = $(this).val() || '';
    if (node.type === 'text' && !node.label.trim()) node.label = '';
    renderNode(node);
    renderEdgesForNode(node.id);
    scheduleSave();
    $(this).remove();
    textEditNode = null;
  });

  $ta.on('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') { $(this).blur(); return; }
    // Enter confirms for single-label nodes; Shift+Enter or text nodes allow newlines
    if (e.key === 'Enter' && !e.shiftKey && node.type !== 'text') {
      e.preventDefault();
      $(this).blur();
    }
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

  // Snap guide lines (live inside diagram-layer so they follow pan/zoom)
  const snapLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  snapLayer.setAttribute('id', 'snap-guides-layer');
  snapLayer.setAttribute('pointer-events', 'none');

  const mkGuide = (id, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('id', id);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    el.style.display = 'none';
    return el;
  };
  snapLayer.appendChild(mkGuide('snap-guide-h', { x1: '-9999', x2: '9999', y1: '0', y2: '0', stroke: '#7c6af0', 'stroke-width': '1', 'stroke-dasharray': '5,3', 'stroke-opacity': '0.8' }));
  snapLayer.appendChild(mkGuide('snap-guide-v', { x1: '0', x2: '0', y1: '-9999', y2: '9999', stroke: '#7c6af0', 'stroke-width': '1', 'stroke-dasharray': '5,3', 'stroke-opacity': '0.8' }));

  // Port snap highlight ring (shown while connecting near a port)
  const portHL = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  portHL.setAttribute('id', 'port-snap-highlight');
  portHL.setAttribute('r', '9');
  portHL.setAttribute('fill', 'rgba(124,106,240,0.2)');
  portHL.setAttribute('stroke', '#7c6af0');
  portHL.setAttribute('stroke-width', '2');
  portHL.setAttribute('pointer-events', 'none');
  portHL.style.display = 'none';
  snapLayer.appendChild(portHL);

  document.getElementById('diagram-layer').appendChild(snapLayer);

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
    if ($(e.target).hasClass('bend-handle')) return; // handled by the handle's own listener

    const pos = svgPos(e);

    if (tool === 'pan' || e.button === 1) {
      isPanning = true;
      panStart = { x: e.clientX - panX, y: e.clientY - panY };
      e.preventDefault();
      return;
    }

    // Deselect and cancel edge drawing on any canvas background click
    // (pan/middle-mouse already returns early above)
    selectNode(null);
    cancelEdgeDrawing();
  });

  $(window).on('mousemove', function (e) {
    if (isPanning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      updateTransform();
      return;
    }
    if (isDragging && dragNode) {
      if (!dragHistoryPushed) { pushHistory(); dragHistoryPushed = true; }
      const pos = svgPos(e);
      let nx = pos.x - dragOffset.x;
      let ny = pos.y - dragOffset.y;
      const dx = dragNode;

      // Alignment snap: find closest match on each axis
      let bestV = { dist: SNAP_THRESHOLD, snapX: null, guideX: null };
      let bestH = { dist: SNAP_THRESHOLD, snapY: null, guideY: null };

      for (const other of nodes) {
        if (other.id === dx.id) continue;
        const oCx = other.x + other.w / 2;
        const oCy = other.y + other.h / 2;

        // X-axis candidates → vertical guide line
        const xTests = [
          { my: nx,              their: other.x,         snapX: other.x,                 guideX: other.x },
          { my: nx + dx.w,       their: other.x + other.w, snapX: other.x + other.w - dx.w, guideX: other.x + other.w },
          { my: nx + dx.w / 2,   their: oCx,             snapX: oCx - dx.w / 2,          guideX: oCx },
        ];
        for (const t of xTests) {
          const d = Math.abs(t.my - t.their);
          if (d < bestV.dist) bestV = { dist: d, snapX: t.snapX, guideX: t.guideX };
        }

        // Y-axis candidates → horizontal guide line
        const yTests = [
          { my: ny,              their: other.y,          snapY: other.y,                  guideY: other.y },
          { my: ny + dx.h,       their: other.y + other.h, snapY: other.y + other.h - dx.h, guideY: other.y + other.h },
          { my: ny + dx.h / 2,   their: oCy,              snapY: oCy - dx.h / 2,           guideY: oCy },
        ];
        for (const t of yTests) {
          const d = Math.abs(t.my - t.their);
          if (d < bestH.dist) bestH = { dist: d, snapY: t.snapY, guideY: t.guideY };
        }
      }

      if (bestV.snapX !== null) nx = bestV.snapX;
      if (bestH.snapY !== null) ny = bestH.snapY;

      dragNode.x = Math.round(nx);
      dragNode.y = Math.round(ny);
      updateSnapGuides(bestH.guideY, bestV.guideX);
      renderNode(dragNode);
      renderEdgesForNode(dragNode.id);
      return;
    }
    if (isResizing && resizeNode) {
      const pos = svgPos(e);
      const dx = pos.x - resizeStartPos.x;
      const dy = pos.y - resizeStartPos.y;
      const { x: ox, y: oy, w: ow, h: oh } = resizeStartGeom;
      let nx = ox, ny = oy, nw = ow, nh = oh;

      if (resizeHandle.includes('e')) nw = Math.max(MIN_NODE_SIZE, ow + dx);
      if (resizeHandle.includes('s')) nh = Math.max(MIN_NODE_SIZE, oh + dy);
      if (resizeHandle.includes('w')) { nw = Math.max(MIN_NODE_SIZE, ow - dx); nx = ox + ow - nw; }
      if (resizeHandle.includes('n')) { nh = Math.max(MIN_NODE_SIZE, oh - dy); ny = oy + oh - nh; }

      resizeNode.x = Math.round(nx); resizeNode.y = Math.round(ny);
      resizeNode.w = Math.round(nw); resizeNode.h = Math.round(nh);
      renderNode(resizeNode);
      renderEdgesForNode(resizeNode.id);
      return;
    }
    if (isDraggingBend && bendEdge) {
      const pos = svgPos(e);
      bendEdge.bend = { x: pos.x - bendNaturalMid.x, y: pos.y - bendNaturalMid.y };
      renderEdge(bendEdge);
      return;
    }
    if (drawingEdge) {
      const pos = svgPos(e);

      // Port snap: find nearest port within threshold
      const nearest = findNearestPort(pos, drawingEdge.fromId);
      snapEdgeTo = nearest;
      const endPos = nearest ? nearest.pos : pos;

      const fp = drawingEdge.fromPos;
      const mag = Math.max(Math.abs(endPos.x - fp.x) * 0.5, Math.abs(endPos.y - fp.y) * 0.5, 50);
      let c1x = fp.x, c1y = fp.y;
      if      (drawingEdge.fromPort === 'e') c1x = fp.x + mag;
      else if (drawingEdge.fromPort === 'w') c1x = fp.x - mag;
      else if (drawingEdge.fromPort === 'n') c1y = fp.y - mag;
      else if (drawingEdge.fromPort === 's') c1y = fp.y + mag;
      $('#temp-edge').attr('d', `M ${fp.x} ${fp.y} C ${c1x} ${c1y}, ${endPos.x} ${endPos.y}, ${endPos.x} ${endPos.y}`);

      // Show/hide port highlight ring
      const portHL = document.getElementById('port-snap-highlight');
      if (nearest) {
        portHL.setAttribute('cx', nearest.pos.x);
        portHL.setAttribute('cy', nearest.pos.y);
        portHL.style.display = '';
      } else {
        portHL.style.display = 'none';
      }
    }
  });

  $(window).on('mouseup', function (e) {
    if (isPanning) { isPanning = false; return; }
    if (isDraggingBend) {
      isDraggingBend = false;
      bendEdge = null;
      scheduleSave();
      return;
    }
    if (isResizing) {
      isResizing = false;
      resizeNode = null;
      scheduleSave();
      return;
    }
    if (isDragging) {
      isDragging = false;
      dragNode = null;
      clearSnapGuides();
      scheduleSave();
      return;
    }
    if (drawingEdge) {
      const overNode = $(e.target).closest('.node-group').length > 0;
      if (!overNode && snapEdgeTo) {
        // Released near a port but not directly over the node — complete via snap
        completeEdge(snapEdgeTo.nodeId, snapEdgeTo.port);
        document.getElementById('port-snap-highlight').style.display = 'none';
        snapEdgeTo = null;
      } else if (!overNode) {
        cancelEdgeDrawing();
      }
      // If over a node-group, its mouseup handler fires (with stopPropagation) and handles it
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
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); if (!isReadOnly) undo(); return;
        case 'y': e.preventDefault(); if (!isReadOnly) redo(); return;
        case 'c': e.preventDefault(); copySelected(); return;
        case 'x': e.preventDefault(); if (!isReadOnly) cutSelected(); return;
        case 'v': e.preventDefault(); if (!isReadOnly) pasteClipboard(); return;
        case 'd': e.preventDefault(); if (!isReadOnly) duplicateSelected(); return;
      }
    }
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
  pushHistory();
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
  pushHistory();
  const edge = edges.find(e => e.id === selectedId);
  if (edge) {
    edges = edges.filter(e => e.id !== selectedId);
    $(`#${selectedId}`).remove();
    $(`#label-${selectedId}`).remove();
    $(`#bend-handle-${selectedId}`).remove();
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

  // Resize handles — shown only when this node is selected
  if (selectedId === node.id && !isReadOnly) appendResizeHandles(g, node);

  document.getElementById('nodes-layer').appendChild(g);
  bindNodeEvents(g, node);
}

// Add 8 resize handles to a node's <g> element
function appendResizeHandles(g, node) {
  if (isReadOnly) return;
  const resizeDirs = [
    { dir: 'nw', cx: 0,           cy: 0            },
    { dir: 'n',  cx: node.w / 2,  cy: 0            },
    { dir: 'ne', cx: node.w,      cy: 0            },
    { dir: 'e',  cx: node.w,      cy: node.h / 2   },
    { dir: 'se', cx: node.w,      cy: node.h       },
    { dir: 's',  cx: node.w / 2,  cy: node.h       },
    { dir: 'sw', cx: 0,           cy: node.h       },
    { dir: 'w',  cx: 0,           cy: node.h / 2   },
  ];
  const cursors = { nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize', se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize' };
  resizeDirs.forEach(({ dir, cx, cy }) => {
    const rh = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rh.setAttribute('x', cx - 4); rh.setAttribute('y', cy - 4);
    rh.setAttribute('width', 8);  rh.setAttribute('height', 8);
    rh.setAttribute('rx', 1.5);
    rh.setAttribute('fill', '#ffffff');
    rh.setAttribute('stroke', '#7c6af0');
    rh.setAttribute('stroke-width', '1.5');
    rh.setAttribute('class', 'resize-handle');
    rh.setAttribute('data-resize', dir);
    rh.style.cursor = cursors[dir];
    g.appendChild(rh);
  });
}

// Show/hide resize handles on an already-rendered node without recreating it
// (recreating the <g> on every click would break native dblclick detection)
function showResizeHandles(node) {
  const g = document.getElementById(node.id);
  if (!g || g.querySelector('.resize-handle')) return;
  appendResizeHandles(g, node);
}
function hideResizeHandles(id) {
  const g = document.getElementById(id);
  if (!g) return;
  g.querySelectorAll('.resize-handle').forEach(h => h.remove());
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
    const cx = w / 2, cy = h / 2;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy);
    el.setAttribute('rx', w / 2 - 1); el.setAttribute('ry', h / 2 - 1);
    el.setAttribute('fill', color + alpha); el.setAttribute('stroke', color); el.setAttribute('stroke-width', '2');
    frag.appendChild(el);
    if (label) frag.appendChild(makeText(label, cx, cy, 11, color));
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

  // Show ports on hover (text nodes never connect)
  $g.on('mouseenter', function () {
    if (node.type === 'text') return;
    if (tool === 'connect' || tool === 'select') {
      $(this).find('.node-port').show();
    }
  }).on('mouseleave', function () {
    $(this).find('.node-port').hide();
  });

  // Mousedown – start drag or connect
  $g.on('mousedown', function (e) {
    e.stopPropagation();

    if ($(e.target).hasClass('resize-handle') && !isReadOnly && tool === 'select') {
      pushHistory();
      isResizing = true;
      resizeNode = node;
      resizeHandle = $(e.target).data('resize');
      resizeStartPos = svgPos(e);
      resizeStartGeom = { x: node.x, y: node.y, w: node.w, h: node.h };
      e.preventDefault();
      return;
    }

    if ($(e.target).hasClass('node-port') && node.type !== 'text') {
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
      dragHistoryPushed = false;
      dragNode = node;
      const pos = svgPos(e);
      dragOffset = { x: pos.x - node.x, y: pos.y - node.y };
      e.preventDefault();
    }
  });

  // Complete edge on port click (from another node)
  $g.on('mouseup', function (e) {
    if (!drawingEdge || drawingEdge.fromId === node.id || node.type === 'text') {
      cancelEdgeDrawing();
      return;
    }
    // Prefer the snapped port if snap is targeting this node
    const portDir = (snapEdgeTo && snapEdgeTo.nodeId === node.id)
      ? snapEdgeTo.port
      : ($(e.target).data('port') || 'w');
    completeEdge(node.id, portDir);
    e.stopPropagation();
  });

  // Double-click to edit label
  $g.on('dblclick', function (e) {
    if (isReadOnly) return;
    if (node.type === 'er-table') { openErEditor(node.id); return; }
    openTextEditor(node);
  });
}

// ── Edge Drawing ──────────────────────────────────────────────
function completeEdge(toId, toPort) {
  if (!drawingEdge) return;
  pushHistory();
  const pending = drawingEdge;
  cancelEdgeDrawing();

  const edge = {
    id: 'e' + nextId++,
    from: pending.fromId,
    fromPort: pending.fromPort,
    to: toId,
    toPort: toPort,
    label: '',
    relType: selectedRelType,
    bend: { x: 0, y: 0 }
  };
  edges.push(edge);
  renderEdge(edge);
  scheduleSave();
}

function cancelEdgeDrawing() {
  drawingEdge = null;
  snapEdgeTo = null;
  $('#temp-edge').hide();
  const portHL = document.getElementById('port-snap-highlight');
  if (portHL) portHL.style.display = 'none';
}

function updateSnapGuides(snapH, snapV) {
  const h = document.getElementById('snap-guide-h');
  const v = document.getElementById('snap-guide-v');
  if (h) { if (snapH !== null) { h.setAttribute('y1', snapH); h.setAttribute('y2', snapH); h.style.display = ''; } else h.style.display = 'none'; }
  if (v) { if (snapV !== null) { v.setAttribute('x1', snapV); v.setAttribute('x2', snapV); v.style.display = ''; } else v.style.display = 'none'; }
}

function clearSnapGuides() {
  const h = document.getElementById('snap-guide-h');
  const v = document.getElementById('snap-guide-v');
  if (h) h.style.display = 'none';
  if (v) v.style.display = 'none';
}

function findNearestPort(pos, excludeNodeId) {
  let nearest = null;
  let nearestDist = PORT_SNAP_DIST;
  for (const node of nodes) {
    if (node.id === excludeNodeId || node.type === 'text') continue;
    for (const portDir of ['n', 's', 'e', 'w']) {
      const pp = getPortPos(node, portDir);
      const dist = Math.hypot(pos.x - pp.x, pos.y - pp.y);
      if (dist < nearestDist) { nearestDist = dist; nearest = { nodeId: node.id, port: portDir, pos: pp }; }
    }
  }
  return nearest;
}

function renderEdge(edge) {
  // Remove existing elements for this edge
  $(`#${edge.id}`).remove();
  $(`#label-${edge.id}`).remove();
  $(`#bend-handle-${edge.id}`).remove();

  const fromNode = nodes.find(n => n.id === edge.from);
  const toNode = nodes.find(n => n.id === edge.to);
  if (!fromNode || !toNode) return;

  const fp = getPortPos(fromNode, edge.fromPort || 'e');
  const tp = getPortPos(toNode, edge.toPort || 'w');
  const bend = edge.bend || { x: 0, y: 0 };

  // Base control points (port direction, no bend)
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

  // Natural Bezier midpoint (t=0.5, no bend) — used for handle position
  const natMx = (1/8)*fp.x + (3/8)*c1x + (3/8)*c2x + (1/8)*tp.x;
  const natMy = (1/8)*fp.y + (3/8)*c1y + (3/8)*c2y + (1/8)*tp.y;

  // Apply bend: shifting both control points by (4/3)*bend moves B(0.5) by exactly bend
  const db = 4 / 3;
  c1x += db * bend.x; c1y += db * bend.y;
  c2x += db * bend.x; c2y += db * bend.y;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('id', edge.id);
  path.setAttribute('class', `edge-path ${edge.id === selectedId ? 'selected' : ''}`);
  path.setAttribute('d', `M ${fp.x} ${fp.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tp.x} ${tp.y}`);
  path.setAttribute('marker-end', `url(#${edge.id === selectedId ? 'arrow-selected' : 'arrow'})`);
  path.setAttribute('stroke', edge.id === selectedId ? '#7c6af0' : getEdgeColor(edge.relType));
  path.setAttribute('stroke-width', '2');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-dasharray', edge.relType === 'many-to-many' ? '6,3' : 'none');

  path.addEventListener('click', (e) => { e.stopPropagation(); selectNode(edge.id); });
  document.getElementById('edges-layer').appendChild(path);

  // Bend handle — draggable midpoint shown when this edge is selected
  if (edge.id === selectedId && !isReadOnly) {
    const hx = natMx + bend.x;
    const hy = natMy + bend.y;
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('id', `bend-handle-${edge.id}`);
    handle.setAttribute('cx', hx); handle.setAttribute('cy', hy); handle.setAttribute('r', 6);
    handle.setAttribute('fill', '#7c6af0'); handle.setAttribute('stroke', '#fff'); handle.setAttribute('stroke-width', '1.5');
    handle.setAttribute('class', 'bend-handle');
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      pushHistory();
      isDraggingBend = true;
      bendEdge = edge;
      bendNaturalMid = { x: natMx, y: natMy };
    });
    document.getElementById('edges-layer').appendChild(handle);
  }

  // Cardinality labels for ER
  if (diagramType === 'er' && edge.relType) {
    const labels = getRelLabels(edge.relType);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `label-${edge.id}`);
    g.appendChild(makeText(labels[0], fp.x + (fp.x < tp.x ? 16 : -16), fp.y - 8, 11, '#6a6a88'));
    g.appendChild(makeText(labels[1], tp.x + (tp.x > fp.x ? -16 : 16), tp.y - 8, 11, '#6a6a88'));
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
  const prevId = selectedId;
  selectedId = id;
  $('.node-group').removeClass('selected');
  $('.edge-path').removeClass('selected').attr('stroke', '#4a4a68').attr('marker-end', 'url(#arrow)');

  // Strip handles/highlights from the previous selection.
  // Important: do NOT re-render the node element here — recreating the <g>
  // between clicks breaks the browser's native dblclick detection.
  if (prevId && prevId !== id) {
    hideResizeHandles(prevId);
    const prevEdge = edges.find(e => e.id === prevId);
    if (prevEdge) renderEdge(prevEdge);
  }

  if (!id) {
    $('#properties-panel').hide();
    return;
  }

  const node = nodes.find(n => n.id === id);
  if (node) {
    if (!isReadOnly) showResizeHandles(node);
    $(`#${id}`).addClass('selected');
    showNodeProperties(node);
    return;
  }

  const edge = edges.find(e => e.id === id);
  if (edge) {
    renderEdge(edge); // redraws with bend handle
    showEdgeProperties(edge);
  }
}

function showNodeProperties(node) {
  if (node.type === 'er-table') { $('#properties-panel').hide(); return; }
  $('#properties-panel').show();

  let histPushed = false;
  const maybePush = () => { if (!histPushed) { pushHistory(); histPushed = true; } };

  if (node.type === 'text') {
    $('#properties-content').html(`
      <div class="prop-row">
        <label class="prop-label">Color</label>
        <input type="color" class="prop-input" id="prop-color" value="${node.color}" style="padding:2px;height:32px">
      </div>
      <p style="font-size:10px;color:var(--text-3);margin-top:8px;line-height:1.5">Double-click the text on canvas to edit. Click outside to close.</p>
    `);
    $('#prop-color').on('input', function () {
      maybePush();
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
      <label class="prop-label">Color</label>
      <input type="color" class="prop-input" id="prop-color" value="${node.color}" style="padding:2px;height:32px">
    </div>
    <p style="font-size:10px;color:var(--text-3);margin-top:8px;line-height:1.5">Double-click the node to edit its label.</p>
  `);

  $('#prop-color').on('input', function () {
    maybePush();
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
    <div class="prop-row">
      <label class="prop-label">Curve</label>
      <p style="font-size:10px;color:var(--text-3);line-height:1.5;margin:0">Drag the <i class="fa-solid fa-circle" style="color:#7c6af0;font-size:7px;vertical-align:middle"></i> handle on the edge to bend it.</p>
      <button class="btn btn-ghost btn-sm" id="prop-reset-curve" style="margin-top:4px">Reset Curve</button>
    </div>
    <button class="btn btn-danger btn-sm" id="prop-delete-edge" style="margin-top:4px">Delete Edge</button>
  `);

  let histPushed = false;
  const maybePush = () => { if (!histPushed) { pushHistory(); histPushed = true; } };

  $('#prop-edge-label').on('input', function () {
    maybePush();
    edge.label = $(this).val();
    renderEdge(edge);
    scheduleSave();
  });
  $('#prop-rel').on('change', function () {
    maybePush();
    edge.relType = $(this).val();
    renderEdge(edge);
    scheduleSave();
  });
  $('#prop-reset-curve').on('click', function () {
    pushHistory();
    edge.bend = { x: 0, y: 0 };
    renderEdge(edge);
    scheduleSave();
  });
  $('#prop-delete-edge').on('click', function () {
    edges = edges.filter(e => e.id !== edge.id);
    $(`#${edge.id}`).remove();
    $(`#label-${edge.id}`).remove();
    $(`#bend-handle-${edge.id}`).remove();
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
      <button class="btn btn-ghost btn-icon-sm remove-col" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button>
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
      <button class="btn btn-ghost btn-icon-sm remove-col" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `);
}

function saveErTable() {
  const node = nodes.find(n => n.id === editingErNodeId);
  if (!node) return;
  pushHistory();
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
