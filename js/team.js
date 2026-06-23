// ─────────────────────────────────────────────────────────────
// Team Management & Invites
// ─────────────────────────────────────────────────────────────

const TEAM = {
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
