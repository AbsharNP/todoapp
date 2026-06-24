// ─────────────────────────────────────────────────────────────
// Team Management & Invites
// ─────────────────────────────────────────────────────────────

const TEAM = {
  async loadJoinCode() {
    if (!currentWsId) return;
    const { data: ws } = await supabase
      .from('workspaces')
      .select('join_code')
      .eq('id', currentWsId)
      .single();

    const code = ws?.join_code;
    if (!code) {
      $('#join-code-section').html(
        `<p style="font-size:12px;color:var(--text-3)">No join code yet. Generate one so teammates can join without an email invite.</p>`
      );
      return;
    }

    $('#join-code-section').html(`
      <div class="invite-link-box" style="align-items:center;gap:12px">
        <span style="font-size:22px;font-weight:700;letter-spacing:6px;color:var(--accent);font-family:monospace">${escHtml(code)}</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-secondary btn-sm" id="btn-copy-join-code">Copy</button>
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-3);margin-top:6px">
        Share this code with teammates — they can enter it in "Join Workspace" to join instantly.
      </p>
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
          ${inv.status === 'pending' ? `<button class="btn btn-ghost btn-icon-sm revoke-invite" data-id="${inv.id}" title="Revoke">✕</button>` : ''}
        </div>
      </div>
    `).join(''));

    $('.revoke-invite').on('click', async function () {
      const id = $(this).data('id');
      if (!confirm('Revoke this invite?')) return;
      await supabase.from('invites').delete().eq('id', id);
      TEAM.loadInvites();
      APP.toast('Invite revoked', 'info');
    });
  }
};

$(document).ready(function () {
  // Invite member button
  $('#btn-invite').on('click', function () {
    $('#invite-email').val('');
    $('#invite-role').val('member');
    $('#invite-result').hide();
    $('#btn-send-invite').show();
    openModal('modal-invite');
  });

  // Generate invite link
  $('#btn-send-invite').on('click', async function () {
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

  // Generate workspace join code
  $('#btn-regen-join-code').on('click', async function () {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

    const { error } = await supabase
      .from('workspaces')
      .update({ join_code: code })
      .eq('id', currentWsId);

    if (error) { APP.toast('Failed to generate code', 'error'); return; }
    APP.toast('Join code generated!', 'success');
    TEAM.loadJoinCode();
  });

  // Open join-by-code modal
  $('#btn-join-workspace').on('click', function () {
    if (APP.isGuest()) { APP.toast('Sign in to join a workspace', 'warning'); return; }
    $('#join-ws-code-input').val('');
    $('#join-ws-feedback').hide();
    openModal('modal-join-workspace');
  });

  // Submit join-by-code
  $('#btn-submit-join-ws').on('click', async function () {
    const code = $('#join-ws-code-input').val().trim().toUpperCase();
    if (code.length !== 6) {
      $('#join-ws-feedback').text('Please enter a 6-character code.').show();
      return;
    }

    $(this).text('Joining…').prop('disabled', true);
    $('#join-ws-feedback').hide();

    const { data: ws, error } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('join_code', code)
      .maybeSingle();

    if (error || !ws) {
      $('#join-ws-feedback').text('No workspace found with that code. Check and try again.').show();
      $(this).text('Join Workspace').prop('disabled', false);
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
      $(this).text('Join Workspace').prop('disabled', false);
      return;
    }

    const { error: memberErr } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: ws.id, user_id: APP.currentUser.id, role: 'member' });

    if (memberErr) {
      $('#join-ws-feedback').text('Failed to join. Please try again.').show();
      $(this).text('Join Workspace').prop('disabled', false);
      return;
    }

    APP.toast(`Joined "${ws.name}"!`, 'success');
    closeModal('modal-join-workspace');
    $(this).text('Join Workspace').prop('disabled', false);
    localStorage.setItem('taskflow_ws', ws.id);
    window.location.reload();
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
