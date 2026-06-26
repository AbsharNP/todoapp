// ─────────────────────────────────────────────────────────────
// Team Management & Invites
// ─────────────────────────────────────────────────────────────

const TEAM = {
  // Show invite-creation controls + the join code only to owners/admins.
  async applyPermissions() {
    const admin = (typeof resolveWsAdmin === 'function') ? await resolveWsAdmin() : false;
    $('#btn-invite').toggle(admin);
    $('#btn-regen-join-code').toggle(admin);
    $('#join-code-title').toggle(admin);
    if (!admin) $('#join-code-section').hide();
    $('#pending-invites-title').toggle(admin);
    if (!admin) $('#invites-list').hide();
    $('#join-requests-title').toggle(admin);
    if (!admin) $('#join-requests-list').hide();
  },

  // Pending requests from users who entered the join code (admins only).
  async loadJoinRequests() {
    if (!currentWsId) return;
    const admin = (typeof resolveWsAdmin === 'function') ? await resolveWsAdmin() : false;
    if (!admin) { $('#join-requests-title, #join-requests-list').hide(); return; }

    const { data } = await supabase
      .from('join_requests')
      .select('*, profiles(*)')
      .eq('workspace_id', currentWsId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    const reqs = data || [];
    $('#join-requests-title').show();
    $('#join-requests-list').show();

    if (!reqs.length) {
      $('#join-requests-list').html(`<p style="font-size:13px;color:var(--text-3)">No pending join requests.</p>`);
      return;
    }

    $('#join-requests-list').html(reqs.map(r => {
      const name = r.profiles?.display_name || 'Unknown';
      return `
        <div class="invite-card">
          <div>
            <div class="invite-email">${escHtml(name)}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">Requested ${APP.formatDate(r.created_at)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn btn-primary btn-sm jr-accept" data-id="${escHtml(r.id)}" data-user="${escHtml(r.user_id)}" data-name="${escHtml(name)}">Accept</button>
            <button class="btn btn-ghost btn-sm jr-reject" data-id="${escHtml(r.id)}" data-name="${escHtml(name)}">Reject</button>
          </div>
        </div>
      `;
    }).join(''));

    $('.jr-accept').on('click', acceptJoinRequest);
    $('.jr-reject').on('click', rejectJoinRequest);
  },

  async loadJoinCode() {
    if (!currentWsId) return;

    // The join code lets anyone join this workspace — members must not see it.
    const admin = (typeof resolveWsAdmin === 'function') ? await resolveWsAdmin() : false;
    if (!admin) { $('#join-code-section').hide(); return; }
    $('#join-code-section').show();

    const { data: ws } = await supabase
      .from('workspaces')
      .select('join_code, join_code_expires_at')
      .eq('id', currentWsId)
      .single();

    const code    = ws?.join_code;
    const expires = ws?.join_code_expires_at ? new Date(ws.join_code_expires_at) : null;
    const expired = expires && expires < new Date();

    if (!code || expired) {
      const msg = expired
        ? 'Join code expired. Generate a new one.'
        : 'No join code yet. Generate one so teammates can join without an email invite.';
      $('#join-code-section').html(`<p style="font-size:12px;color:var(--text-3)">${msg}</p>`);
      return;
    }

    const expiryLabel = expires ? `Expires ${APP.formatDate(expires.toISOString())}` : '';

    $('#join-code-section').html(`
      <div class="invite-link-box" style="align-items:center;gap:12px">
        <span style="font-size:22px;font-weight:700;letter-spacing:6px;color:var(--accent);font-family:monospace">${escHtml(code)}</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-secondary btn-sm" id="btn-copy-join-code">Copy</button>
        </div>
      </div>
      ${expiryLabel ? `<p style="font-size:11px;color:var(--text-3);margin-top:6px">${expiryLabel} · Share this code so teammates can join instantly.</p>` : ''}
    `);

    $('#btn-copy-join-code').on('click', function () {
      navigator.clipboard.writeText(code).then(() => {
        $(this).text('Copied!');
        setTimeout(() => $(this).text('Copy'), 2000);
        APP.toast('Join code copied!', 'success');
      });
    });
  },

  async loadInvites() {
    if (!currentWsId) return;

    // Only owners/admins manage invites — members must not see pending invites.
    const admin = (typeof resolveWsAdmin === 'function') ? await resolveWsAdmin() : false;
    if (!admin) { $('#invites-list').hide(); return; }
    $('#invites-list').show();

    const { data } = await supabase
      .from('invites')
      .select('*')
      .eq('workspace_id', currentWsId)
      .order('created_at', { ascending: false });

    const invites = data || [];
    if (!invites.length) {
      $('#invites-list').html(`<p style="font-size:13px;color:var(--text-3)">No pending invites.</p>`);
      return;
    }

    $('#invites-list').html(invites.map(inv => `
      <div class="invite-card">
        <div>
          <div class="invite-email">${escHtml(inv.email)}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            ${inv.role} · Expires ${APP.formatDate(inv.expires_at)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="invite-status status-${inv.status}">${inv.status}</span>
          ${inv.status === 'pending' && isWsAdmin() ? `<button class="btn btn-ghost btn-icon-sm revoke-invite" data-id="${inv.id}" title="Revoke"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
      </div>
    `).join(''));

    $('.revoke-invite').on('click', async function () {
      const $btn = $(this);
      if (!$btn.data('confirming')) {
        $btn.data('confirming', true).text('Sure?');
        setTimeout(() => $btn.data('confirming', false).html('<i class="fa-solid fa-xmark"></i>'), 1000);
        return;
      }
      const id = $btn.data('id');
      await supabase.from('invites').delete().eq('id', id);
      TEAM.loadInvites();
      APP.toast('Invite revoked', 'info');
    });
  }
};

$(document).ready(function () {
  // Invite member button
  $('#btn-invite').on('click', function () {
    if (!isWsAdmin()) return APP.toast('Only owners and admins can invite members', 'warning');
    $('#invite-email').val('');
    $('#invite-role').val('member');
    $('#invite-result').hide();
    $('#btn-send-invite').show();
    openModal('modal-invite');
  });

  // Generate invite link
  $('#btn-send-invite').on('click', async function () {
    if (!isWsAdmin()) return APP.toast('Only owners and admins can invite members', 'warning');
    const email = $('#invite-email').val().trim();
    if (!email || !isValidEmail(email)) return APP.toast('Enter a valid email address', 'warning');
    if (!currentWsId) return;

    $(this).text('Generating...').prop('disabled', true);

    // Check for existing pending invite for this email
    const { data: existing } = await supabase
      .from('invites')
      .select('*')
      .eq('workspace_id', currentWsId)
      .eq('email', email)
      .eq('status', 'pending')
      .single();

    let invite = existing;

    if (!invite) {
      const { data, error } = await supabase
        .from('invites')
        .insert({
          workspace_id: currentWsId,
          email,
          role: $('#invite-role').val(),
          invited_by: APP.currentUser.id
        })
        .select().single();

      if (error) {
        APP.toast('Failed to create invite', 'error');
        $(this).text('Generate Invite Link').prop('disabled', false);
        return;
      }
      invite = data;
    }

    const inviteUrl = `${window.location.origin}/invite.html?token=${invite.token}`;
    $('#invite-link-text').text(inviteUrl);
    $('#invite-result').show();
    $('#btn-send-invite').hide();
    TEAM.loadInvites();
    APP.toast('Invite link generated!', 'success');
  });

  // Generate workspace join code (expires in 7 days)
  $('#btn-regen-join-code').on('click', async function () {
    if (!isWsAdmin()) return APP.toast('Only owners and admins can generate a join code', 'warning');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('workspaces')
      .update({ join_code: code, join_code_expires_at: expiresAt })
      .eq('id', currentWsId);

    if (error) { APP.toast('Failed to generate code: ' + error.message, 'error'); return; }
    APP.toast('Join code generated! Expires in 7 days.', 'success');
    TEAM.loadJoinCode();
  });

  // Open join-by-code modal
  $('#btn-join-workspace').on('click', function () {
    if (APP.isGuest()) { APP.toast('Sign in to join a workspace', 'warning'); return; }
    $('#join-ws-code-input').val('');
    $('#join-ws-feedback').hide();
    openModal('modal-join-workspace');
  });

  // Shared join-by-code logic
  async function joinByCode(code, feedbackSel, btnEl) {
    const { data: ws, error } = await supabase
      .from('workspaces')
      .select('id, name, join_code_expires_at')
      .eq('join_code', code)
      .maybeSingle();

    if (error || !ws) {
      $(feedbackSel).text('No workspace found with that code. Check and try again.').show();
      btnEl.text(btnEl.data('label')).prop('disabled', false);
      return;
    }
    if (ws.join_code_expires_at && new Date(ws.join_code_expires_at) < new Date()) {
      $(feedbackSel).text('This join code has expired. Ask your team admin to generate a new one.').show();
      btnEl.text(btnEl.data('label')).prop('disabled', false);
      return;
    }

    const { data: existing } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', ws.id)
      .eq('user_id', APP.currentUser.id)
      .maybeSingle();

    if (existing) {
      APP.toast(`You're already in "${ws.name}"`, 'info');
      closeModal('modal-join-workspace');
      btnEl.text(btnEl.data('label')).prop('disabled', false);
      return;
    }

    // Already requested? Don't create a duplicate.
    const { data: existingReq } = await supabase
      .from('join_requests')
      .select('id')
      .eq('workspace_id', ws.id)
      .eq('user_id', APP.currentUser.id)
      .maybeSingle();

    if (existingReq) {
      APP.toast(`You've already requested to join "${ws.name}". Waiting for an admin to approve.`, 'info');
      closeModal('modal-join-workspace');
      btnEl.text(btnEl.data('label')).prop('disabled', false);
      return;
    }

    // Create a join request — an admin must approve before the user joins.
    const { error: reqErr } = await supabase
      .from('join_requests')
      .insert({ workspace_id: ws.id, user_id: APP.currentUser.id });

    if (reqErr) {
      $(feedbackSel).text('Failed to send join request. Please try again.').show();
      btnEl.text(btnEl.data('label')).prop('disabled', false);
      return;
    }

    APP.toast(`Request to join "${ws.name}" sent! An admin will review it.`, 'success');
    closeModal('modal-join-workspace');
    btnEl.text(btnEl.data('label')).prop('disabled', false);
  }

  // Submit join-by-code (workspace dropdown modal)
  $('#btn-submit-join-ws').data('label', 'Request to Join').on('click', async function () {
    const code = $('#join-ws-code-input').val().trim().toUpperCase();
    if (code.length !== 6) {
      $('#join-ws-feedback').text('Please enter a 6-character code.').show();
      return;
    }
    $(this).text('Sending request…').prop('disabled', true);
    $('#join-ws-feedback').hide();
    await joinByCode(code, '#join-ws-feedback', $(this));
  });

  // Team panel "Join by Code" button — opens the shared modal
  $('#btn-join-ws-from-team').on('click', function () {
    if (APP.isGuest()) { APP.toast('Sign in to join a workspace', 'warning'); return; }
    $('#join-ws-code-input').val('');
    $('#join-ws-feedback').hide();
    openModal('modal-join-workspace');
  });

  // Copy invite link
  $('#btn-copy-link').on('click', function () {
    const text = $('#invite-link-text').text();
    navigator.clipboard.writeText(text).then(() => {
      $(this).text('Copied!');
      setTimeout(() => $(this).text('Copy'), 2000);
      APP.toast('Link copied to clipboard!', 'success');
    }).catch(() => {
      // Fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      $(this).text('Copied!');
      setTimeout(() => $(this).text('Copy'), 2000);
    });
  });
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Approve a join request: add the user as a member, then clear the request.
async function acceptJoinRequest() {
  const $btn = $(this);
  const reqId = $btn.data('id');
  const userId = $btn.data('user');
  const name = $btn.data('name');
  $btn.prop('disabled', true).text('Accepting…');

  const { error: memberErr } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: currentWsId, user_id: userId, role: 'member' });

  if (memberErr) {
    APP.toast('Failed to add member', 'error');
    $btn.prop('disabled', false).text('Accept');
    return;
  }

  await supabase.from('join_requests').delete().eq('id', reqId);
  APP.toast(`${name} added to the team`, 'success');
  TEAM.loadJoinRequests();
  if (typeof loadMembers === 'function') loadMembers();
}

// Reject (and remove) a join request.
async function rejectJoinRequest() {
  const $btn = $(this);
  const reqId = $btn.data('id');
  const name = $btn.data('name');
  if (!$btn.data('confirming')) {
    $btn.data('confirming', true).text('Confirm reject').addClass('btn-danger');
    setTimeout(() => $btn.data('confirming', false).text('Reject').removeClass('btn-danger'), 4000);
    return;
  }
  const { error } = await supabase.from('join_requests').delete().eq('id', reqId);
  if (error) { APP.toast('Failed to reject request', 'error'); return; }
  APP.toast(`Request from ${name} rejected`, 'info');
  TEAM.loadJoinRequests();
}
