// ─────────────────────────────────────────────────────────────
// Dashboard – Todos, Overview, Diagrams, Settings
// ─────────────────────────────────────────────────────────────

let allTodos = [];
let allLists = [];
let allMembers = [];
let selectedListId = 'all';
let selectedColor = '#6366f1';

$(document).ready(async function () {
  APP.theme.init();
  APP.theme._updateButtons();
  $('#btn-theme-toggle').on('click', function () { APP.theme.toggle(); });

  // Sidebar collapse
  if (localStorage.getItem('taskflow_sidebar') === 'collapsed') {
    $('.app-layout').addClass('sidebar-collapsed');
  }
  $('#btn-toggle-sidebar').on('click', function () {
    const collapsed = $('.app-layout').toggleClass('sidebar-collapsed').hasClass('sidebar-collapsed');
    localStorage.setItem('taskflow_sidebar', collapsed ? 'collapsed' : 'expanded');
    $(this).attr('data-tooltip', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  });

  // Mobile sidebar drawer (hamburger + backdrop)
  $('#btn-mobile-menu').on('click', function (e) {
    e.stopPropagation();
    $('.app-layout').toggleClass('sidebar-open');
  });
  $('#sidebar-backdrop').on('click', () => $('.app-layout').removeClass('sidebar-open'));
  $('.sidebar .nav-item').on('click', () => $('.app-layout').removeClass('sidebar-open'));
  $(document).on('keydown', e => { if (e.key === 'Escape') $('.app-layout').removeClass('sidebar-open'); });

  const session = await APP.init();
  if (!session) { window.location.href = 'index.html'; return; }

  // Render user info
  const profile = await loadProfile(session.user);
  renderUserInfo(session.user, profile);

  // Load workspaces
  await loadWorkspaces();

  // Panel navigation
  $('.nav-item[data-panel], .btn[data-panel]').on('click', function () {
    const panel = $(this).data('panel');
    switchPanel(panel);
  });

  // Open a specific panel when arriving via a hash link (e.g. dashboard.html#team)
  const hashPanel = (location.hash || '').replace('#', '');
  if (['overview', 'diagrams', 'team', 'settings'].includes(hashPanel)) {
    switchPanel(hashPanel);
  }

  // Workspace switcher
  $('#ws-switcher').on('click', function (e) {
    e.stopPropagation();
    $('#ws-dropdown').toggleClass('open');
  });
  $(document).on('click', function () {
    $('#ws-dropdown').removeClass('open');
    $('.dropdown-menu').removeClass('open');
  });

  // User menu
  $('#user-menu-btn').on('click', function (e) {
    e.stopPropagation();
    $('#user-dropdown').toggleClass('open');
  });
  $('#btn-logout').on('click', async function () {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // New workspace
  $('#btn-new-workspace').on('click', () => openModal('modal-new-workspace'));
  $('#btn-create-workspace').on('click', createWorkspace);

  // List CRUD
  $('#btn-new-list').on('click', () => {
    selectedColor = '#6366f1';
    $('.color-swatch').removeClass('selected');
    $(`.color-swatch[data-color="#6366f1"]`).addClass('selected');
    $('#new-list-name').val('');
    openModal('modal-new-list');
  });
  $('#btn-create-list').on('click', createList);
  $('#btn-rename-list').on('click', renameList);
  $('#rename-list-name').on('keydown', e => { if (e.key === 'Enter') renameList(); });

  // Color picker
  $(document).on('click', '.color-swatch', function () {
    selectedColor = $(this).data('color');
    $('.color-swatch').removeClass('selected');
    $(this).addClass('selected');
  });

  // Todo CRUD
  $('#btn-new-todo, .kanban-col-add').on('click', function () {
    const status = $(this).data('status') || 'todo';
    openNewTodoModal(status);
  });
  $('#btn-create-todo').on('click', createTodo);
  $('#btn-save-todo').on('click', saveTodoDetail);
  $('#btn-delete-todo').on('click', deleteTodo);

  // Comments
  $('#btn-add-comment').on('click', addComment);
  $('#comment-input').on('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); }
  });

  // Diagrams
  $('#btn-new-flowchart').on('click', () => openNewDiagramModal('flowchart'));
  $('#btn-new-er').on('click', () => openNewDiagramModal('er'));
  $('#btn-create-diagram').on('click', createDiagram);
  $('#btn-rename-diagram').on('click', renameDiagramFromDashboard);
  $('#rename-diagram-name').on('keydown', e => { if (e.key === 'Enter') renameDiagramFromDashboard(); });
  $('#btn-import-diagram').on('click', () => $('#input-import-diagram').click());
  $('#input-import-diagram').on('change', function () {
    if (this.files[0]) { importDiagram(this.files[0]); this.value = ''; }
  });

  // Todos export/import
  $('#btn-export-todos').on('click', exportTodos);
  $('#btn-import-todos').on('click', () => $('#input-import-todos').click());
  $('#input-import-todos').on('change', function () {
    if (this.files[0]) { importTodos(this.files[0]); this.value = ''; }
  });

  // Settings
  $('#btn-save-workspace').on('click', saveWorkspaceSettings);
  $('#btn-delete-workspace').on('click', deleteWorkspace);

  // Modal close
  $(document).on('click', '[data-close]', function () {
    const id = $(this).data('close');
    closeModal(id);
  });
  $(document).on('click', '.modal-backdrop', function (e) {
    if ($(e.target).is('.modal-backdrop')) closeModal($(this).attr('id'));
  });
});

// ── Profile ──────────────────────────────────────────────────
async function loadProfile(user) {
  let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!data) {
    // Profile row missing — create it (upsert is safe if trigger already created it)
    await supabase.from('profiles').upsert({ id: user.id, display_name: null }, { onConflict: 'id' });
    ({ data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
  }
  return data;
}

function renderUserInfo(user, profile) {
  const isGuest = user.is_anonymous;
  const name = profile?.display_name || (isGuest ? 'Guest' : (user.email?.split('@')[0] || 'User'));
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  $('#user-avatar').text(initials);
  $('#user-display-name').text(name);
  $('#user-email-display').text(isGuest ? 'Guest account' : user.email);

  if (isGuest) {
    $('#btn-logout').html('<span><i class="fa-solid fa-user"></i></span> Sign In / Create Account');
  } else {
    $('#btn-logout').html('<span><i class="fa-solid fa-right-from-bracket"></i></span> Sign Out');
  }
}

// ── Workspaces ───────────────────────────────────────────────
let workspaces = [];
let currentWsId = null;

async function loadWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select(`*, workspace_members!inner(user_id)`)
    .eq('workspace_members.user_id', APP.currentUser.id)
    .order('created_at', { ascending: true });

  if (error) { APP.toast('Failed to load workspaces: ' + error.message, 'error'); return; }
  if (!data) return;
  workspaces = data;

  if (workspaces.length === 0) {
    if (APP.isGuest()) {
      await autoCreateWorkspace('My Workspace');
      return;
    }
    openModal('modal-new-workspace');
    return;
  }

  const savedId = localStorage.getItem('taskflow_ws');
  const ws = workspaces.find(w => w.id === savedId) || workspaces[0];
  selectWorkspace(ws.id);
}

function selectWorkspace(wsId) {
  currentWsId = wsId;
  APP.currentWorkspace = workspaces.find(w => w.id === wsId);
  localStorage.setItem('taskflow_ws', wsId);

  const ws = APP.currentWorkspace;
  $('#ws-icon').text((ws.name || 'W')[0].toUpperCase());
  $('#ws-name').text(ws.name);
  $('#ws-name-input').val(ws.name);
  $('#ws-desc-input').val(ws.description || '');

  renderWsList();
  loadAllData();
}

function renderWsList() {
  const html = workspaces.map(ws => `
    <div class="ws-item ${ws.id === currentWsId ? 'active' : ''}" data-ws="${escHtml(ws.id)}">
      <div class="workspace-icon" style="width:20px;height:20px;font-size:11px">${escHtml((ws.name||'W')[0].toUpperCase())}</div>
      ${escHtml(ws.name)}
      ${ws.id === currentWsId ? '<span style="margin-left:auto;color:var(--accent)"><i class="fa-solid fa-check"></i></span>' : ''}
    </div>
  `).join('');
  $('#ws-list').html(html);

  $('#ws-list').off('click').on('click', '.ws-item', function () {
    selectWorkspace($(this).data('ws'));
    $('#ws-dropdown').removeClass('open');
  });
}

async function autoCreateWorkspace(name) {
  const { data: ws, error } = await supabase.rpc('create_workspace', { ws_name: name });
  if (error || !ws) {
    APP.toast('Workspace error: ' + (error?.message || 'unknown'), 'error');
    openModal('modal-new-workspace');
    return;
  }
  workspaces = [ws];
  selectWorkspace(ws.id);
}

async function createWorkspace() {
  const name = $('#new-ws-name').val().trim();
  if (!name) return APP.toast('Please enter a workspace name', 'warning');

  const { data: ws, error } = await supabase.rpc('create_workspace', {
    ws_name: name,
    ws_description: $('#new-ws-desc').val().trim() || null
  });

  if (error || !ws) return APP.toast('Failed to create workspace: ' + (error?.message || 'unknown'), 'error');

  workspaces.push(ws);
  closeModal('modal-new-workspace');
  $('#new-ws-name').val('');
  $('#new-ws-desc').val('');
  selectWorkspace(ws.id);
  APP.toast('Workspace created!', 'success');
}

async function saveWorkspaceSettings() {
  const name = $('#ws-name-input').val().trim();
  if (!name) return APP.toast('Name is required', 'warning');

  const { error } = await supabase.from('workspaces')
    .update({ name, description: $('#ws-desc-input').val().trim() })
    .eq('id', currentWsId);

  if (error) return APP.toast('Failed to save', 'error');
  const ws = workspaces.find(w => w.id === currentWsId);
  if (ws) { ws.name = name; ws.description = $('#ws-desc-input').val().trim(); }
  $('#ws-name').text(name);
  APP.toast('Settings saved!', 'success');
}

async function deleteWorkspace() {
  const $btn = $('#btn-delete-workspace');
  if (!$btn.data('confirming')) {
    $btn.data('confirming', true).text('Click again to confirm delete').addClass('btn-danger');
    setTimeout(() => $btn.data('confirming', false).text('Delete Workspace').removeClass('btn-danger'), 4000);
    return;
  }
  $btn.data('confirming', false).text('Delete Workspace').removeClass('btn-danger');
  await supabase.from('workspaces').delete().eq('id', currentWsId);
  workspaces = workspaces.filter(w => w.id !== currentWsId);
  if (workspaces.length > 0) {
    selectWorkspace(workspaces[0].id);
  } else {
    currentWsId = null;
    openModal('modal-new-workspace');
  }
  APP.toast('Workspace deleted', 'info');
}

// ── Load all workspace data ───────────────────────────────────
async function loadAllData() {
  await Promise.all([loadLists(), loadMembers()]);
  await loadTodos();
  renderOverview();
  renderDiagrams();
  subscribeRealtime();
}

// ── Lists ─────────────────────────────────────────────────────
async function loadLists() {
  const { data } = await supabase
    .from('todo_lists')
    .select('*')
    .eq('workspace_id', currentWsId)
    .order('position');
  allLists = data || [];
  renderListSelector();
  renderListOptions();
}

function renderListSelector() {
  const chips = `<button class="list-chip ${selectedListId === 'all' ? 'active' : ''}" data-list="all">All Lists</button>`
    + allLists.map(l => {
      const safeColor = safeCssColor(l.color);
      return `
        <button class="list-chip ${selectedListId === l.id ? 'active' : ''}"
                data-list="${escHtml(l.id)}"
                style="${selectedListId === l.id ? `background:${safeColor};border-color:${safeColor}` : ''}">
          <span class="list-dot" style="background:${safeColor}"></span>
          ${escHtml(l.name)}
          <span class="list-chip-edit" data-list="${escHtml(l.id)}" data-name="${escHtml(l.name)}" data-tooltip="Rename list"><i class="fa-solid fa-pen"></i></span>
          <span class="list-chip-del" data-list="${escHtml(l.id)}" data-name="${escHtml(l.name)}" data-tooltip="Delete list"><i class="fa-solid fa-trash"></i></span>
        </button>
      `;
    }).join('');

  $('#list-selector').html(chips);
  $('#list-selector .list-chip').on('click', function () {
    selectedListId = $(this).data('list');
    renderListSelector();
    renderKanban();
  });
  $('#list-selector .list-chip-edit').on('click', function (e) {
    e.stopPropagation();
    openRenameListModal($(this).data('list'), $(this).data('name'));
  });
  $('#list-selector .list-chip-del').on('click', function (e) {
    e.stopPropagation();
    const $del = $(this);
    const id = $del.data('list');
    if (pendingDeleteListId !== id) {
      pendingDeleteListId = id;
      $('.list-chip-del').removeClass('confirm');
      $del.addClass('confirm');
      APP.toast(`Click delete again to remove "${$del.data('name')}" and its tasks`, 'warning');
      clearTimeout(pendingDeleteListTimer);
      pendingDeleteListTimer = setTimeout(() => { pendingDeleteListId = null; $del.removeClass('confirm'); }, 4000);
      return;
    }
    clearTimeout(pendingDeleteListTimer);
    pendingDeleteListId = null;
    deleteList(id, $del.data('name'));
  });
}

let pendingDeleteListId = null;
let pendingDeleteListTimer = null;
let renameListId = null;

function openRenameListModal(id, name) {
  const list = allLists.find(l => l.id === id);
  renameListId = id;
  $('#rename-list-name').val(name);
  selectedColor = (list && list.color) || '#6366f1';
  const $picker = $('#rename-list-color-picker');
  $picker.find('.color-swatch').removeClass('selected');
  $picker.find(`.color-swatch[data-color="${selectedColor}"]`).addClass('selected');
  openModal('modal-rename-list');
  setTimeout(() => $('#rename-list-name').focus().select(), 50);
}

async function renameList() {
  const name = $('#rename-list-name').val().trim();
  if (!name) return APP.toast('List name is required', 'warning');
  const { error } = await supabase.from('todo_lists').update({ name, color: selectedColor }).eq('id', renameListId);
  if (error) return APP.toast('Failed to update list', 'error');
  closeModal('modal-rename-list');
  APP.toast('List updated', 'success');
  await loadLists();
  renderKanban();
}

async function deleteList(id, name) {
  const { error } = await supabase.from('todo_lists').delete().eq('id', id);
  if (error) return APP.toast('Failed to delete list', 'error');
  if (selectedListId === id) selectedListId = 'all';
  APP.toast(`List "${name}" deleted`, 'info');
  await loadLists();
  await loadTodos();
  renderOverview();
}

function renderListOptions() {
  const opts = allLists.map(l => `<option value="${escHtml(l.id)}">${escHtml(l.name)}</option>`).join('');
  $('#todo-list, #detail-list').html(opts || '<option value="">No lists – create one first</option>');
}

async function createList() {
  const name = $('#new-list-name').val().trim();
  if (!name) return APP.toast('List name is required', 'warning');
  if (!currentWsId) return APP.toast('No workspace selected', 'error');

  const { data, error } = await supabase.from('todo_lists')
    .insert({ workspace_id: currentWsId, name, color: selectedColor, created_by: APP.currentUser.id, position: allLists.length })
    .select().single();

  if (error) return APP.toast('Failed to create list', 'error');
  allLists.push(data);
  closeModal('modal-new-list');
  $('#new-list-name').val('');
  renderListSelector();
  renderListOptions();
  APP.toast(`List "${name}" created!`, 'success');
}

// ── Members ───────────────────────────────────────────────────
async function loadMembers() {
  const { data } = await supabase
    .from('workspace_members')
    .select('*, profiles(*)')
    .eq('workspace_id', currentWsId);
  allMembers = data || [];
  renderMembers();
  renderAssigneeOptions();
}

// True if the current user is an owner/admin of the active workspace.
function isWsAdmin() {
  if (APP.isGuest()) return false;
  const me = allMembers.find(m => m.user_id === APP.currentUser.id);
  return !!(me && (me.role === 'owner' || me.role === 'admin'));
}

// Admin status that stays correct even before the member cache has loaded
// (e.g. arriving via dashboard.html#team). Queries the role directly as a fallback.
async function resolveWsAdmin() {
  if (APP.isGuest() || !currentWsId) return false;
  if (allMembers.length) return isWsAdmin();
  const { data } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', currentWsId)
    .eq('user_id', APP.currentUser.id)
    .maybeSingle();
  return !!(data && (data.role === 'owner' || data.role === 'admin'));
}

function renderMembers() {
  if (!allMembers.length) {
    $('#members-list, #overview-team').html('<div class="empty-state"><p>No members yet. Invite your team!</p></div>');
    return;
  }

  const iAmAdmin = isWsAdmin();

  const html = allMembers.map(m => {
    const name = m.profiles?.display_name || 'Unknown';
    const email = APP.currentUser.id === m.user_id ? APP.currentUser.email : '';
    const initials = escHtml(name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase());
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
    const color = colors[name.charCodeAt(0) % colors.length];
    const safeRole = escHtml(m.role);
    const isSelf = m.user_id === APP.currentUser.id;
    const roleBadge = `<span class="member-role role-${safeRole}">${safeRole}</span>`;
    let controls;
    if (iAmAdmin && m.role !== 'owner' && !isSelf) {
      // Admins/owners can manage everyone except the workspace owner and themselves
      controls = `
        <select class="member-role-select" data-id="${escHtml(m.user_id)}" data-tooltip="Change role">
          <option value="member" ${m.role === 'member' ? 'selected' : ''}>member</option>
          <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>admin</option>
        </select>
        <button class="btn btn-ghost btn-icon-sm member-remove" data-id="${escHtml(m.user_id)}" data-name="${escHtml(name)}" data-tooltip="Remove from team"><i class="fa-solid fa-user-minus"></i></button>
      `;
    } else if (isSelf && m.role !== 'owner') {
      // Any non-owner member can leave the workspace themselves
      controls = `${roleBadge}
        <button class="btn btn-ghost btn-sm member-leave" data-tooltip="Leave this workspace"><i class="fa-solid fa-right-from-bracket"></i> Leave</button>
      `;
    } else {
      controls = roleBadge;
    }
    return `
      <div class="member-card">
        <div class="avatar" style="width:40px;height:40px;background:${color};font-size:15px;font-weight:700;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center">${initials}</div>
        <div class="member-info">
          <div class="member-name">${escHtml(name)}</div>
          <div class="member-email">${escHtml(email)}</div>
        </div>
        <div class="member-actions">${controls}</div>
      </div>
    `;
  }).join('');

  $('#members-list').html(html);
  $('#members-list .member-role-select').on('change', changeMemberRole);
  $('#members-list .member-remove').on('click', removeMember);
  $('#members-list .member-leave').on('click', leaveWorkspace);
  if (window.TEAM && TEAM.applyPermissions) TEAM.applyPermissions();
  $('#overview-team').html(allMembers.slice(0,4).map(m => {
    const name = m.profiles?.display_name || 'Unknown';
    const initials = escHtml(name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase());
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
    const color = colors[name.charCodeAt(0) % colors.length];
    const safeRole = escHtml(m.role);
    return `
      <div class="member-card">
        <div class="avatar" style="width:36px;height:36px;background:${color};font-size:13px;font-weight:700;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center">${initials}</div>
        <div class="member-info"><div class="member-name">${escHtml(name)}</div></div>
        <span class="member-role role-${safeRole}">${safeRole}</span>
      </div>
    `;
  }).join(''));
}

async function changeMemberRole() {
  const userId = $(this).data('id');
  const newRole = $(this).val();
  const { error } = await supabase.from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', currentWsId)
    .eq('user_id', userId);
  if (error) { APP.toast('Failed to update role', 'error'); await loadMembers(); return; }
  APP.toast(`Role updated to ${newRole}`, 'success');
  await loadMembers();
}

async function removeMember() {
  const $btn = $(this);
  const userId = $btn.data('id');
  const name = $btn.data('name');
  if (!$btn.data('confirming')) {
    $btn.data('confirming', true).addClass('btn-danger');
    APP.toast(`Click again to remove ${name} from the team`, 'warning');
    setTimeout(() => $btn.data('confirming', false).removeClass('btn-danger'), 4000);
    return;
  }
  const { error } = await supabase.from('workspace_members')
    .delete()
    .eq('workspace_id', currentWsId)
    .eq('user_id', userId);
  if (error) { APP.toast('Failed to remove member', 'error'); return; }
  APP.toast(`${name} removed from the team`, 'info');
  await loadMembers();
}

async function leaveWorkspace() {
  const $btn = $(this);
  if (!$btn.data('confirming')) {
    $btn.data('confirming', true).addClass('btn-danger');
    APP.toast('Click again to leave this workspace', 'warning');
    setTimeout(() => $btn.data('confirming', false).removeClass('btn-danger'), 4000);
    return;
  }
  const wsId = currentWsId;
  const { error } = await supabase.from('workspace_members')
    .delete()
    .eq('workspace_id', wsId)
    .eq('user_id', APP.currentUser.id);
  if (error) { APP.toast('Failed to leave workspace', 'error'); return; }
  APP.toast('You left the workspace', 'info');
  workspaces = workspaces.filter(w => w.id !== wsId);
  if (workspaces.length > 0) {
    selectWorkspace(workspaces[0].id);
  } else {
    currentWsId = null;
    localStorage.removeItem('taskflow_ws');
    openModal('modal-new-workspace');
  }
}

function renderAssigneeOptions() {
  const opts = allMembers.map(m => `<option value="${escHtml(m.user_id)}">${escHtml(m.profiles?.display_name || 'Unknown')}</option>`).join('');
  $('#todo-assignee').html(`<option value="">Unassigned</option>${opts}`);
  $('#detail-assignee').html(`<option value="">Unassigned</option>${opts}`);
}

// ── Todos ─────────────────────────────────────────────────────
async function loadTodos() {
  if (!allLists.length) { allTodos = []; commentCounts = {}; renderKanban(); return; }

  const listIds = allLists.map(l => l.id);
  const { data } = await supabase
    .from('todos')
    .select('*')
    .in('list_id', listIds)
    .order('position');
  allTodos = data || [];
  await loadCommentCounts();
  renderKanban();
}

// Map of todo_id → number of comments, for the card indicator
let commentCounts = {};

async function loadCommentCounts() {
  const ids = allTodos.map(t => t.id);
  if (!ids.length) { commentCounts = {}; return; }
  const { data } = await supabase.from('todo_comments').select('todo_id').in('todo_id', ids);
  const counts = {};
  (data || []).forEach(c => { counts[c.todo_id] = (counts[c.todo_id] || 0) + 1; });
  commentCounts = counts;
}

function getFilteredTodos() {
  if (selectedListId === 'all') return allTodos;
  return allTodos.filter(t => t.list_id === selectedListId);
}

function renderKanban() {
  const filtered = getFilteredTodos();
  const byStatus = {
    todo: filtered.filter(t => t.status === 'todo'),
    in_progress: filtered.filter(t => t.status === 'in_progress'),
    done: filtered.filter(t => t.status === 'done')
  };

  ['todo', 'in_progress', 'done'].forEach(status => {
    const items = byStatus[status];
    $(`#count-${status}`).text(items.length);
    $(`#col-${status}`).html(items.map(renderTaskCard).join('') || '');
  });

  const pending = filtered.filter(t => t.status !== 'done').length;
  if (pending > 0) $('#badge-todos').text(pending).show();
  else $('#badge-todos').hide();

  // Re-bind card clicks
  $('.task-card').off('click').on('click', function (e) {
    if ($(e.target).hasClass('task-check') || $(e.target).closest('.task-check').length) return;
    const id = $(this).data('id');
    openTodoDetail(id);
  });

  // Quick status toggle (checkbox)
  $('.task-check').off('click').on('click', function (e) {
    e.stopPropagation();
    const $card = $(this).closest('.task-card');
    const id = $card.data('id');
    const todo = allTodos.find(t => t.id === id);
    if (!todo) return;
    const newStatus = todo.status === 'done' ? 'todo' : 'done';
    updateTodoStatus(id, newStatus);
  });

  bindDragAndDrop();
}

// ── Drag-to-reorder kanban ────────────────────────────────────
let draggedTodoId = null;

function bindDragAndDrop() {
  $('.task-card').off('dragstart dragend').on('dragstart', function (e) {
    draggedTodoId = $(this).data('id');
    e.originalEvent.dataTransfer.effectAllowed = 'move';
    e.originalEvent.dataTransfer.setData('text/plain', String(draggedTodoId));
    setTimeout(() => $(this).addClass('dragging'), 0);
  }).on('dragend', function () {
    $(this).removeClass('dragging');
    $('.kanban-col-body').removeClass('drag-over');
    draggedTodoId = null;
  });

  $('.kanban-col-body').off('dragover dragleave drop')
    .on('dragover', function (e) {
      e.preventDefault();
      e.originalEvent.dataTransfer.dropEffect = 'move';
      $(this).addClass('drag-over');
      const dragging = document.querySelector('.task-card.dragging');
      if (!dragging) return;
      const afterEl = getDragAfterElement(this, e.originalEvent.clientY);
      if (afterEl == null) this.appendChild(dragging);
      else this.insertBefore(dragging, afterEl);
    })
    .on('dragleave', function (e) {
      if (!this.contains(e.originalEvent.relatedTarget)) $(this).removeClass('drag-over');
    })
    .on('drop', function (e) {
      e.preventDefault();
      $(this).removeClass('drag-over');
      persistKanbanOrder();
    });
}

// Find the card the dragged element should be inserted before, based on cursor Y
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.task-card:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

// Read the DOM card order in each column, update local state + persist changes
async function persistKanbanOrder() {
  const updates = [];
  ['todo', 'in_progress', 'done'].forEach(status => {
    const ids = [...document.querySelectorAll(`#col-${status} .task-card`)].map(el => $(el).data('id'));
    ids.forEach((id, idx) => {
      const todo = allTodos.find(t => t.id === id);
      if (!todo) return;
      if (todo.position !== idx || todo.status !== status) {
        todo.position = idx;
        todo.status = status;
        updates.push({ id, position: idx, status });
      }
    });
    $(`#count-${status}`).text(ids.length);
  });

  // Update the pending badge + overview without a full re-render (DOM is already correct)
  const pending = getFilteredTodos().filter(t => t.status !== 'done').length;
  if (pending > 0) $('#badge-todos').text(pending).show(); else $('#badge-todos').hide();
  renderOverview();

  if (!updates.length) return;
  await Promise.all(updates.map(u =>
    supabase.from('todos').update({ position: u.position, status: u.status }).eq('id', u.id)
  ));
}

function renderTaskCard(todo) {
  const list = allLists.find(l => l.id === todo.list_id);
  const isOverdue = APP.isOverdue(todo.due_date) && todo.status !== 'done';
  const isDone = todo.status === 'done';
  const assignee = allMembers.find(m => m.user_id === todo.assigned_to);
  const assigneeName = assignee?.profiles?.display_name;
  const priority = escHtml(todo.priority);
  const commentCount = commentCounts[todo.id] || 0;

  return `
    <div class="task-card" data-id="${escHtml(todo.id)}" draggable="true">
      <div class="task-card-priority ${priority}"></div>
      <div class="task-card-header">
        <div class="task-check ${isDone ? 'checked' : ''}"></div>
        <div class="task-card-title ${isDone ? 'done-text' : ''}">${escHtml(todo.title)}</div>
      </div>
      <div class="task-card-meta">
        <span class="badge badge-${priority}">${priority}</span>
        ${todo.due_date ? `<span class="task-due ${isOverdue ? 'overdue' : ''}"><i class="fa-solid fa-calendar"></i> ${APP.formatDate(todo.due_date)}</span>` : ''}
        ${commentCount ? `<span class="task-comments" data-tooltip="${commentCount} comment${commentCount > 1 ? 's' : ''}"><i class="fa-solid fa-comment"></i> ${commentCount}</span>` : ''}
      </div>
      <div class="task-card-footer">
        ${list ? `<span class="task-list-badge" style="background:${safeCssColor(list.color)}">${escHtml(list.name)}</span>` : '<span></span>'}
        ${assigneeName ? `<span style="font-size:11px;color:var(--text-3)"><i class="fa-solid fa-user"></i> ${escHtml(assigneeName)}</span>` : ''}
      </div>
    </div>
  `;
}

async function updateTodoStatus(id, status) {
  const todo = allTodos.find(t => t.id === id);
  if (todo) todo.status = status;
  renderKanban();
  await supabase.from('todos').update({ status }).eq('id', id);
}

function openNewTodoModal(status = 'todo') {
  if (!allLists.length) {
    APP.toast('Create a list first before adding tasks', 'warning');
    openModal('modal-new-list');
    return;
  }
  $('#todo-title').val('');
  $('#todo-desc').val('');
  $('#todo-status').val(status);
  $('#todo-priority').val('medium');
  $('#todo-due').val('');
  $('#todo-assignee').val('');
  if (selectedListId !== 'all') $('#todo-list').val(selectedListId);
  openModal('modal-new-todo');
}

async function createTodo() {
  const title = $('#todo-title').val().trim();
  if (!title) return APP.toast('Task title is required', 'warning');
  const listId = $('#todo-list').val();
  if (!listId) return APP.toast('Select a list', 'warning');

  const todo = {
    list_id: listId,
    title,
    description: $('#todo-desc').val().trim() || null,
    status: $('#todo-status').val(),
    priority: $('#todo-priority').val(),
    due_date: $('#todo-due').val() || null,
    assigned_to: $('#todo-assignee').val() || null,
    created_by: APP.currentUser.id,
    position: allTodos.length
  };

  const { data, error } = await supabase.from('todos').insert(todo).select().single();
  if (error) return APP.toast('Failed to add task', 'error');
  allTodos.push(data);
  closeModal('modal-new-todo');
  renderKanban();
  renderOverview();
  APP.toast('Task added!', 'success');
}

function openTodoDetail(id) {
  const todo = allTodos.find(t => t.id === id);
  if (!todo) return;

  $('#detail-todo-id').val(todo.id);
  $('#detail-title').val(todo.title);
  $('#detail-desc').val(todo.description || '');
  $('#detail-status').val(todo.status);
  $('#detail-priority').val(todo.priority);
  $('#detail-due').val(todo.due_date || '');
  $('#detail-assignee').val(todo.assigned_to || '');

  currentDetailTodoId = id;
  $('#comment-input').val('');
  $('#comments-list').html('<div class="comments-empty">Loading…</div>');
  loadComments(id);

  openModal('modal-todo-detail');
}

async function saveTodoDetail() {
  const id = $('#detail-todo-id').val();
  const updates = {
    title: $('#detail-title').val().trim(),
    description: $('#detail-desc').val().trim() || null,
    status: $('#detail-status').val(),
    priority: $('#detail-priority').val(),
    due_date: $('#detail-due').val() || null,
    assigned_to: $('#detail-assignee').val() || null
  };
  if (!updates.title) return APP.toast('Title is required', 'warning');

  const { error } = await supabase.from('todos').update(updates).eq('id', id);
  if (error) return APP.toast('Failed to save', 'error');

  const idx = allTodos.findIndex(t => t.id === id);
  if (idx !== -1) allTodos[idx] = { ...allTodos[idx], ...updates };
  closeModal('modal-todo-detail');
  renderKanban();
  renderOverview();
  APP.toast('Task updated!', 'success');
}

async function deleteTodo() {
  const id = $('#detail-todo-id').val();
  const $btn = $('#btn-delete-todo');
  if (!$btn.data('confirming')) {
    $btn.data('confirming', true).text('Confirm delete?');
    setTimeout(() => $btn.data('confirming', false).text('Delete Task'), 4000);
    return;
  }
  $btn.data('confirming', false).text('Delete Task');
  await supabase.from('todos').delete().eq('id', id);
  allTodos = allTodos.filter(t => t.id !== id);
  closeModal('modal-todo-detail');
  renderKanban();
  renderOverview();
  APP.toast('Task deleted', 'info');
}

// ── Realtime sync ─────────────────────────────────────────────
let realtimeChannel = null;

function subscribeRealtime() {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (!currentWsId) return;

  realtimeChannel = supabase
    .channel('ws-' + currentWsId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, handleTodoChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_lists' }, handleListChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_comments' }, handleCommentChange)
    .subscribe();
}

function listInWorkspace(listId) {
  return allLists.some(l => l.id === listId);
}

// A todo was inserted/updated/deleted somewhere — reconcile local state.
// All handlers are idempotent so our own echoed changes are harmless.
function handleTodoChange(payload) {
  if (payload.eventType === 'DELETE') {
    const before = allTodos.length;
    allTodos = allTodos.filter(t => t.id !== payload.old.id);
    if (allTodos.length !== before) { renderKanban(); renderOverview(); }
    return;
  }
  const rec = payload.new;
  if (!listInWorkspace(rec.list_id)) return; // belongs to a different workspace
  const idx = allTodos.findIndex(t => t.id === rec.id);
  if (idx === -1) allTodos.push(rec);
  else allTodos[idx] = { ...allTodos[idx], ...rec };
  allTodos.sort((a, b) => (a.position || 0) - (b.position || 0));
  renderKanban();
  renderOverview();
}

async function handleListChange() {
  await loadLists();
  await loadTodos();
  renderOverview();
}

function handleCommentChange(payload) {
  // 1) Refresh the open comment thread, if any
  if (currentDetailTodoId && $('#modal-todo-detail').hasClass('open')) {
    const todoId = (payload.new && payload.new.todo_id) || null;
    if (todoId === null || todoId === currentDetailTodoId) loadComments(currentDetailTodoId);
  }

  // 2) Keep the card comment-count badges accurate
  if (payload.eventType === 'INSERT' && payload.new) {
    const tid = payload.new.todo_id;
    if (allTodos.some(t => t.id === tid)) {
      commentCounts[tid] = (commentCounts[tid] || 0) + 1;
      renderKanban();
    }
  } else {
    // DELETE payloads may omit todo_id — recount to stay accurate
    loadCommentCounts().then(renderKanban);
  }
}

// ── Comments ──────────────────────────────────────────────────
let currentDetailTodoId = null;

async function loadComments(todoId) {
  const { data, error } = await supabase
    .from('todo_comments')
    .select('*, profiles(display_name)')
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });
  if (error) { $('#comments-list').html('<div class="comments-empty">Could not load comments.</div>'); return; }
  if (currentDetailTodoId !== todoId) return; // modal moved on while loading
  renderComments(data || []);
}

function renderComments(comments) {
  if (!comments.length) {
    $('#comments-list').html('<div class="comments-empty">No comments yet. Start the discussion.</div>');
    return;
  }
  $('#comments-list').html(comments.map(c => {
    const name = c.profiles?.display_name || 'Unknown';
    const mine = c.user_id === APP.currentUser.id;
    return `
      <div class="comment-item">
        ${APP.avatar(name, 28)}
        <div class="comment-body">
          <div class="comment-meta">
            <span class="comment-author">${escHtml(name)}</span>
            <span class="comment-time">${APP.formatDate(c.created_at)}</span>
          </div>
          <div class="comment-text">${escHtml(c.body)}</div>
        </div>
        ${mine ? `<button class="comment-delete" data-id="${escHtml(c.id)}" data-tooltip="Delete comment"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>`;
  }).join(''));

  $('.comment-delete').off('click').on('click', async function () {
    const id = $(this).data('id');
    await supabase.from('todo_comments').delete().eq('id', id);
    loadComments(currentDetailTodoId);
  });

  const el = document.getElementById('comments-list');
  if (el) el.scrollTop = el.scrollHeight;
}

async function addComment() {
  const body = $('#comment-input').val().trim();
  if (!body || !currentDetailTodoId) return;
  const { error } = await supabase.from('todo_comments').insert({
    todo_id: currentDetailTodoId,
    user_id: APP.currentUser.id,
    body
  });
  if (error) return APP.toast('Failed to post comment', 'error');
  $('#comment-input').val('');
  loadComments(currentDetailTodoId);
}

// ── Overview ──────────────────────────────────────────────────
function renderOverview() {
  if (!document.getElementById('overview-recent')) return; // not on this page
  const total = allTodos.length;
  const inProgress = allTodos.filter(t => t.status === 'in_progress').length;
  const done = allTodos.filter(t => t.status === 'done').length;
  const overdue = allTodos.filter(t => APP.isOverdue(t.due_date) && t.status !== 'done').length;

  $('#stat-total').text(total);
  $('#stat-in-progress').text(inProgress);
  $('#stat-done').text(done);
  $('#stat-overdue').text(overdue);

  const recent = allTodos.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  if (!recent.length) {
    $('#overview-recent').html('<div class="empty-state"><p>No tasks yet. Add your first task!</p></div>');
    return;
  }
  $('#overview-recent').html(`
    <div class="card" style="padding:0;overflow:hidden">
      ${recent.map(t => {
        const list = allLists.find(l => l.id === t.list_id);
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer" data-id="${t.id}" class="overview-todo-row">
            <div style="width:3px;height:36px;background:${safeCssColor(list?.color)};border-radius:2px;flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:500;${t.status === 'done' ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${escHtml(t.title)}</div>
              ${t.due_date ? `<div style="font-size:11px;color:${APP.isOverdue(t.due_date) && t.status !== 'done' ? 'var(--red)' : 'var(--text-3)'}">${APP.formatDate(t.due_date)}</div>` : ''}
            </div>
            <span class="badge badge-${escHtml(t.priority)}">${escHtml(t.priority)}</span>
            <span class="badge badge-${escHtml(t.status)}">${escHtml(t.status.replace('_',' '))}</span>
          </div>
        `;
      }).join('')}
    </div>
  `);

  $('.overview-todo-row').on('click', function () {
    openTodoDetail($(this).data('id'));
  });
}

// ── Diagrams ──────────────────────────────────────────────────
async function renderDiagrams() {
  if (!document.getElementById('diagrams-grid')) return; // not on this page
  const { data } = await supabase
    .from('diagrams')
    .select('*')
    .eq('workspace_id', currentWsId)
    .order('updated_at', { ascending: false });

  const diagrams = data || [];

  if (!diagrams.length) {
    $('#diagrams-grid').html(`
      <div class="empty-state" style="grid-column:1/-1">
        <div style="font-size:48px;color:var(--accent)"><i class="fa-solid fa-diagram-project"></i></div>
        <h4>No diagrams yet</h4>
        <p>Create a flowchart or ER diagram to visualize your system.</p>
      </div>
    `);
    return;
  }

  const icons = { flowchart: '<i class="fa-solid fa-diagram-project"></i>', er: '<i class="fa-solid fa-database"></i>' };
  $('#diagrams-grid').html(diagrams.map(d => `
    <div class="diagram-card" data-diagram-id="${d.id}">
      <div class="diagram-preview">${icons[d.type] || '<i class="fa-solid fa-diagram-project"></i>'}</div>
      <div class="diagram-card-body">
        <div class="diagram-card-name">${escHtml(d.name)}</div>
        <div class="diagram-card-meta">${d.type.toUpperCase()} · ${APP.formatDate(d.updated_at)}</div>
      </div>
      <div class="diagram-card-actions">
        <button class="btn btn-ghost btn-sm diagram-export-btn" data-id="${d.id}" data-name="${escHtml(d.name)}" title="Export as JSON"><i class="fa-solid fa-arrow-down"></i> Export</button>
        <button class="btn btn-ghost btn-sm diagram-rename-btn" data-id="${d.id}" data-name="${escHtml(d.name)}" title="Rename diagram"><i class="fa-solid fa-pen"></i> Rename</button>
        <button class="btn btn-ghost btn-sm diagram-delete-btn" data-id="${d.id}" data-name="${escHtml(d.name)}" title="Delete diagram"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join(''));

  $('.diagram-card').on('click', function (e) {
    if ($(e.target).closest('.diagram-export-btn, .diagram-rename-btn, .diagram-delete-btn').length) return;
    const id = $(this).data('diagram-id');
    window.location.href = `diagram.html?id=${id}`;
  });

  $('.diagram-export-btn').on('click', function (e) {
    e.stopPropagation();
    exportDiagramFromDashboard($(this).data('id'), $(this).data('name'));
  });

  $('.diagram-rename-btn').on('click', function (e) {
    e.stopPropagation();
    openRenameDiagramModal($(this).data('id'), $(this).data('name'));
  });

  $('.diagram-delete-btn').on('click', function (e) {
    e.stopPropagation();
    const $btn = $(this);
    if (!$btn.data('confirming')) {
      $btn.data('confirming', true).addClass('btn-danger');
      APP.toast(`Click delete again to remove "${$btn.data('name')}"`, 'warning');
      setTimeout(() => $btn.data('confirming', false).removeClass('btn-danger'), 4000);
      return;
    }
    deleteDiagramFromDashboard($btn.data('id'), $btn.data('name'));
  });
}

let renameDiagramId = null;

function openRenameDiagramModal(id, name) {
  renameDiagramId = id;
  $('#rename-diagram-name').val(name);
  openModal('modal-rename-diagram');
  setTimeout(() => $('#rename-diagram-name').focus().select(), 50);
}

async function renameDiagramFromDashboard() {
  const name = $('#rename-diagram-name').val().trim();
  if (!name) return APP.toast('Please enter a diagram name', 'warning');
  const { error } = await supabase.from('diagrams').update({ name }).eq('id', renameDiagramId);
  if (error) return APP.toast('Failed to rename diagram', 'error');
  closeModal('modal-rename-diagram');
  APP.toast('Diagram renamed', 'success');
  renderDiagrams();
}

async function deleteDiagramFromDashboard(id, name) {
  const { error } = await supabase.from('diagrams').delete().eq('id', id);
  if (error) return APP.toast('Failed to delete diagram', 'error');
  APP.toast(`Diagram "${name}" deleted`, 'info');
  renderDiagrams();
}

let pendingDiagramType = 'flowchart';

function openNewDiagramModal(type) {
  if (!currentWsId) return APP.toast('No workspace selected', 'error');
  pendingDiagramType = type;
  $('#modal-new-diagram-title').text(type === 'er' ? 'New ER Diagram' : 'New Flowchart');
  $('#new-diagram-name').val(type === 'er' ? 'Database Schema' : 'My Flow');
  openModal('modal-new-diagram');
  setTimeout(() => $('#new-diagram-name').focus().select(), 50);
}

async function createDiagram() {
  const name = $('#new-diagram-name').val().trim();
  if (!name) return APP.toast('Please enter a diagram name', 'warning');

  const { data, error } = await supabase.from('diagrams')
    .insert({ workspace_id: currentWsId, name, type: pendingDiagramType, created_by: APP.currentUser.id })
    .select().single();

  if (error) return APP.toast('Failed to create diagram', 'error');
  closeModal('modal-new-diagram');
  window.location.href = `diagram.html?id=${data.id}`;
}

// ── Panel switching ───────────────────────────────────────────
function switchPanel(name) {
  $('.panel').removeClass('active');
  $(`#panel-${name}`).addClass('active');
  $('.nav-item').removeClass('active');
  $(`.nav-item[data-panel="${name}"]`).addClass('active');

  const titles = {
    overview: 'Overview', todos: 'Tasks',
    diagrams: 'Diagrams', team: 'Team', settings: 'Settings'
  };
  $('#panel-title').text(titles[name] || name);

  if (name === 'team') {
    if (APP.isGuest()) {
      $('#panel-team').html(`
        <div class="empty-state" style="padding:60px 0">
          <div style="font-size:48px;margin-bottom:12px;color:var(--accent)"><i class="fa-solid fa-users"></i></div>
          <h4 style="margin-bottom:8px">Team features require an account</h4>
          <p style="color:var(--text-2);margin-bottom:20px">Sign in or create a free account to invite members and collaborate.</p>
          <a href="index.html" class="btn btn-primary">Sign In / Create Account</a>
        </div>
      `);
      return;
    }
    TEAM.applyPermissions();
    TEAM.loadInvites();
    TEAM.loadJoinCode();
  }
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id) { $(`#${id}`).addClass('open'); }
function closeModal(id) { $(`#${id}`).removeClass('open'); }

// ── Export / Import ───────────────────────────────────────────
function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTodos() {
  if (!allLists.length) return APP.toast('No tasks to export', 'warning');
  const data = {
    taskflow_todos: true,
    version: 1,
    lists: allLists.map(l => ({
      name: l.name,
      color: l.color,
      todos: allTodos.filter(t => t.list_id === l.id).map(t => ({
        title: t.title,
        description: t.description || null,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date || null,
        tags: t.tags || []
      }))
    }))
  };
  downloadJson(data, 'tasks-export.json');
  APP.toast('Tasks exported!', 'success');
}

async function importTodos(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return APP.toast('Invalid JSON file', 'error'); }
  if (!data.taskflow_todos) return APP.toast('Not a TaskFlow tasks export', 'error');
  if (!currentWsId) return APP.toast('Select a workspace first', 'warning');

  let imported = 0;
  for (const list of (data.lists || [])) {
    const { data: newList, error } = await supabase.from('todo_lists')
      .insert({ workspace_id: currentWsId, name: list.name, color: list.color || '#6366f1', created_by: APP.currentUser.id, position: allLists.length + imported })
      .select().single();
    if (error) continue;
    for (const todo of (list.todos || [])) {
      await supabase.from('todos').insert({
        list_id: newList.id,
        title: todo.title,
        description: todo.description || null,
        status: todo.status || 'todo',
        priority: todo.priority || 'medium',
        due_date: todo.due_date || null,
        tags: todo.tags || [],
        created_by: APP.currentUser.id,
        position: 0
      });
    }
    imported++;
  }
  await loadAllData();
  APP.toast(`Imported ${imported} list(s)!`, 'success');
}

async function exportDiagramFromDashboard(id, name) {
  const { data, error } = await supabase.from('diagrams').select('*').eq('id', id).single();
  if (error || !data) return APP.toast('Could not load diagram', 'error');
  const exportData = {
    taskflow_diagram: true,
    version: 1,
    name: data.name,
    type: data.type,
    nodes: (data.data || {}).nodes || [],
    edges: (data.data || {}).edges || []
  };
  downloadJson(exportData, (data.name || 'diagram').replace(/\s+/g, '_') + '.json');
  APP.toast('Diagram exported!', 'success');
}

async function importDiagram(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return APP.toast('Invalid JSON file', 'error'); }
  if (!data.taskflow_diagram) return APP.toast('Not a TaskFlow diagram export', 'error');
  if (!currentWsId) return APP.toast('Select a workspace first', 'warning');

  const { data: newDiagram, error } = await supabase.from('diagrams')
    .insert({
      workspace_id: currentWsId,
      name: data.name || 'Imported Diagram',
      type: data.type || 'flowchart',
      data: { nodes: data.nodes || [], edges: data.edges || [] },
      created_by: APP.currentUser.id
    })
    .select().single();

  if (error) return APP.toast('Import failed', 'error');
  APP.toast('Diagram imported!', 'success');
  window.location.href = `diagram.html?id=${newDiagram.id}`;
}

// ── Utils ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Validates that a color value is a safe CSS color (hex, rgb, hsl) before
// injecting into style attributes to prevent CSS injection.
function safeCssColor(color, fallback = '#6366f1') {
  const s = String(color || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(s)) return s;
  if (/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/.test(s)) return s;
  if (/^hsl\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*\)$/.test(s)) return s;
  return fallback;
}
