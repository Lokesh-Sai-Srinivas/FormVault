document.addEventListener('DOMContentLoaded', () => {
  // Screen Elements
  const screenLogin = document.getElementById('screen-login');
  const screenDashboard = document.getElementById('screen-dashboard');
  const screenExpired = document.getElementById('screen-expired');
  
  // Indicator & Fields
  const syncIndicator = document.getElementById('sync-indicator');
  const userEmailSpan = document.getElementById('user-email');
  const profileCountSpan = document.getElementById('profile-count');
  const profilesListDiv = document.getElementById('profiles-list');
  const syncTimeSpan = document.getElementById('sync-time');
  
  // Login Form Elements
  const loginForm = document.getElementById('login-form');
  const loginEmailInput = document.getElementById('login-email');
  const loginPasswordInput = document.getElementById('login-password');
  const loginErrorDiv = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');
  const loginSpinner = btnLogin.querySelector('.spinner');
  const loginBtnText = btnLogin.querySelector('.btn-text');
  
  // Action Buttons
  const btnSync = document.getElementById('btn-sync');
  const btnLogout = document.getElementById('btn-logout');
  const btnGoLogin = document.getElementById('btn-go-login');

  // Load saved email if available
  chrome.storage.local.get(['userEmail'], (res) => {
    if (res.userEmail) loginEmailInput.value = res.userEmail;
  });

  // Check authentication status on open
  checkAuthStatus();

  // Handle Login Submission
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    // Show loading state
    loginSpinner.classList.remove('hidden');
    loginBtnText.textContent = 'Signing In...';
    btnLogin.disabled = true;
    loginErrorDiv.classList.add('hidden');

    chrome.runtime.sendMessage({
      action: 'login',
      data: { email, password }
    }, (response) => {
      // Reset loading state
      loginSpinner.classList.add('hidden');
      loginBtnText.textContent = 'Sign In';
      btnLogin.disabled = false;

      if (response && response.success) {
        showScreen('dashboard');
        renderDashboard();
      } else {
        loginErrorDiv.textContent = response ? response.error : 'Connection error';
        loginErrorDiv.classList.remove('hidden');
      }
    });
  });

  // Handle Sync Button
  btnSync.addEventListener('click', () => {
    btnSync.disabled = true;
    btnSync.innerHTML = '🔄 Syncing...';
    syncIndicator.className = 'sync-dot status-offline';

    chrome.runtime.sendMessage({ action: 'sync' }, (response) => {
      btnSync.disabled = false;
      btnSync.innerHTML = '<span class="icon">🔄</span> Sync';

      if (response && response.success) {
        renderDashboard();
      } else {
        syncIndicator.className = 'sync-dot status-error';
        alert('Sync failed: ' + (response ? response.error : 'Unknown error'));
      }
    });
  });

  // Handle Logout Button
  btnLogout.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'logout' }, () => {
      showScreen('login');
      syncIndicator.className = 'sync-dot status-offline';
    });
  });

  // Handle Expired Go Login Button
  btnGoLogin.addEventListener('click', () => {
    showScreen('login');
  });

  // Check Auth State
  function checkAuthStatus() {
    chrome.runtime.sendMessage({ action: 'checkAuth' }, (status) => {
      if (status && status.valid) {
        showScreen('dashboard');
        renderDashboard();
      } else if (status && status.reason === 'EXPIRED') {
        showScreen('expired');
        syncIndicator.className = 'sync-dot status-warning';
      } else {
        showScreen('login');
        syncIndicator.className = 'sync-dot status-offline';
      }
    });
  }

  // Switch Active Screen
  function showScreen(screenId) {
    screenLogin.classList.remove('active');
    screenDashboard.classList.remove('active');
    screenExpired.classList.remove('active');
    
    if (screenId === 'login') screenLogin.classList.add('active');
    if (screenId === 'dashboard') screenDashboard.classList.add('active');
    if (screenId === 'expired') screenExpired.classList.add('active');
  }

  // Render Dashboard Profiles
  function renderDashboard() {
    chrome.runtime.sendMessage({ action: 'getProfiles' }, (response) => {
      if (!response || !response.success) {
        if (response && response.error === 'EXPIRED') {
          showScreen('expired');
          syncIndicator.className = 'sync-dot status-warning';
        } else {
          showScreen('login');
          syncIndicator.className = 'sync-dot status-offline';
        }
        return;
      }

      // Set Email
      chrome.storage.local.get(['userEmail'], (res) => {
        userEmailSpan.textContent = res.userEmail || 'User';
      });

      // Status Indicator
      syncIndicator.className = 'sync-dot status-online';

      const profiles = response.profiles || [];
      profileCountSpan.textContent = profiles.length;
      
      // Sync Time Formatting
      if (response.syncTimestamp) {
        const date = new Date(response.syncTimestamp);
        syncTimeSpan.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString();
      } else {
        syncTimeSpan.textContent = 'Never';
      }

      // Empty State Check
      if (profiles.length === 0) {
        profilesListDiv.innerHTML = '<div class="empty-state">No profiles found.<br>Create or share profiles in the FormVault Web App.</div>';
        return;
      }

      // Generate HTML
      profilesListDiv.innerHTML = '';
      chrome.storage.local.get(['userEmail'], (storageRes) => {
        const currentUserEmail = (storageRes.userEmail || '').toLowerCase();
        
        profiles.forEach((profile) => {
          const profileItem = document.createElement('div');
          profileItem.className = 'profile-item';
          
          const isShared = profile.userId && currentUserEmail && profile.sharedWith && profile.sharedWith.includes(currentUserEmail);
          const tagHtml = isShared 
            ? '<span class="shared-tag">Shared</span>' 
            : '<span class="owner-tag">Owner</span>';

          profileItem.innerHTML = `
            <div class="profile-info">
              <div class="profile-name">${escapeHtml(profile.name)}</div>
              <div class="profile-meta">${profile.fields ? profile.fields.length : 0} fields</div>
            </div>
            ${tagHtml}
          `;
          profilesListDiv.appendChild(profileItem);
        });
      });
    });
  }

  // Escape HTML Helper
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }
});
