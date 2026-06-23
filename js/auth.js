$(document).ready(function () {
  // Redirect if already logged in
  APP.redirectIfAuth();

  // Check for invite redirect param
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite');
  if (inviteToken) {
    sessionStorage.setItem('pendingInviteToken', inviteToken);
  }

  // Tab switching
  $('.auth-tab').on('click', function () {
    const tab = $(this).data('tab');
    $('.auth-tab').removeClass('active');
    $(this).addClass('active');
    $('.auth-form-panel').removeClass('active');
    $(`#panel-${tab}`).addClass('active');
    $('.error-msg').hide();
  });

  // Login
  $('#login-form').on('submit', async function (e) {
    e.preventDefault();
    const email = $('#login-email').val().trim();
    const password = $('#login-password').val();

    setLoading('#login-btn', true);
    $('#login-error').hide();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showError('#login-error', error.message);
      setLoading('#login-btn', false);
      return;
    }

    APP.currentUser = data.user;
    const token = sessionStorage.getItem('pendingInviteToken');
    if (token) {
      window.location.href = `invite.html?token=${token}`;
    } else {
      window.location.href = 'dashboard.html';
    }
  });

  // Signup
  $('#signup-form').on('submit', async function (e) {
    e.preventDefault();
    const name = $('#signup-name').val().trim();
    const email = $('#signup-email').val().trim();
    const password = $('#signup-password').val();

    setLoading('#signup-btn', true);
    $('#signup-error').hide();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });

    if (error) {
      showError('#signup-error', error.message);
      setLoading('#signup-btn', false);
      return;
    }

    if (data.user && !data.session) {
      // Email confirmation required
      showError('#signup-error', null);
      $('#auth-message').text('Check your email for a confirmation link, then sign in.').show();
      setLoading('#signup-btn', false);
      $('.auth-tab[data-tab="login"]').click();
      return;
    }

    APP.currentUser = data.user;
    const token = sessionStorage.getItem('pendingInviteToken');
    if (token) {
      window.location.href = `invite.html?token=${token}`;
    } else {
      window.location.href = 'dashboard.html';
    }
  });

  function showError(selector, message) {
    if (message) {
      $(selector).text(friendlyError(message)).show();
    }
  }

  function setLoading(btnSelector, loading) {
    const $btn = $(btnSelector);
    if (loading) {
      $btn.data('original', $btn.html());
      $btn.html('<span class="spinner spinner-sm" style="border-top-color:#fff;margin:0 auto"></span>');
      $btn.addClass('btn-loading');
    } else {
      $btn.html($btn.data('original'));
      $btn.removeClass('btn-loading');
    }
  }

  // Continue as guest (anonymous sign-in)
  $('#btn-guest').on('click', async function () {
    $(this).text('Loading...').prop('disabled', true);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      $(this).text('Continue without account →').prop('disabled', false);
      APP.toast('Could not start guest session', 'error');
      return;
    }
    window.location.href = 'dashboard.html';
  });

  function friendlyError(msg) {
    if (msg.includes('Invalid login')) return 'Incorrect email or password. Please try again.';
    if (msg.includes('already registered')) return 'This email is already registered. Try signing in.';
    if (msg.includes('weak')) return 'Password is too weak. Use at least 6 characters.';
    if (msg.includes('valid email')) return 'Please enter a valid email address.';
    return msg;
  }
});
