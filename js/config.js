// ─────────────────────────────────────────────────────────────
// Supabase Configuration
// Replace with your actual Supabase project values from:
// 3
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://wxoxwmsuquhltlyebvje.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C2Eb6-92rO_hmttZeWnIwA_cHj5ozH9';

window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// App-wide helpers
const APP = {
  currentUser: null,
  currentWorkspace: null,

  async init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      APP.currentUser = session.user;
      return session;
    }
    // No session — sign in anonymously so the app works without a login
    const { data, error } = await supabase.auth.signInAnonymously();
    if (!error && data.session) {
      APP.currentUser = data.session.user;
      return data.session;
    }
    return null;
  },

  isGuest() {
    return APP.currentUser?.is_anonymous === true;
  },

  requireAuth() {
    // Anonymous users are allowed through; only redirect if there is truly no session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) window.location.href = 'index.html';
    });
  },

  redirectIfAuth() {
    // Only redirect real (non-anonymous) signed-in users away from the login page
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !session.user.is_anonymous) window.location.href = 'dashboard.html';
    });
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  isOverdue(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date(new Date().toDateString());
  },

  avatar(name, size = 32) {
    const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
    const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
    return `<div class="avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${size * 0.38}px">${initials}</div>`;
  },

  toast(message, type = 'info') {
    const id = 'toast-' + Date.now();
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const $toast = $(`
      <div id="${id}" class="toast toast-${type}">
        <span class="toast-icon">${icons[type]}</span>
        <span>${message}</span>
      </div>
    `);
    if (!$('#toast-container').length) {
      $('body').append('<div id="toast-container"></div>');
    }
    $('#toast-container').append($toast);
    setTimeout(() => $toast.addClass('show'), 10);
    setTimeout(() => {
      $toast.removeClass('show');
      setTimeout(() => $toast.remove(), 300);
    }, 3500);
  }
};
