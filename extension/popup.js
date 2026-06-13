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
  const btnToggleServer = document.getElementById('btn-toggle-server');
  const serverUrlContainer = document.getElementById('server-url-container');
  const serverUrlInput = document.getElementById('server-url');
  const loginErrorDiv = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');
  const loginSpinner = btnLogin.querySelector('.spinner');
  const loginBtnText = btnLogin.querySelector('.btn-text');
  
  // Action Buttons
  const btnSync = document.getElementById('btn-sync');
  const btnLogout = document.getElementById('btn-logout');
  const btnGoLogin = document.getElementById('btn-go-login');

  // Load initial settings (like server URL and saved email)
  chrome.storage.local.get(['serverUrl', 'userEmail'], (res) => {
    if (res.serverUrl) serverUrlInput.value = res.serverUrl;
    if (res.userEmail) loginEmailInput.value = res.userEmail;
    
    // Set up register link URL dynamically based on server URL
    updateRegisterLinkUrl(res.serverUrl || 'http://localhost:5000');
  });

  // Check authentication status on open
  checkAuthStatus();

  // Toggle Advanced Settings (Server URL)
  btnToggleServer.addEventListener('click', () => {
    serverUrlContainer.classList.toggle('hidden');
    if (serverUrlContainer.classList.contains('hidden')) {
      btnToggleServer.textContent = 'Advanced Settings';
    } else {
      btnToggleServer.textContent = 'Hide Advanced Settings';
    }
  });

  // Server URL input listener to keep registration link in sync
  serverUrlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim() || 'http://localhost:5000';
    updateRegisterLinkUrl(url);
  });

  function updateRegisterLinkUrl(serverUrl) {
    const registerLink = document.getElementById('register-link');
    // If it's localhost:5000 (default server), dashboard is localhost:5173 (default vite port).
    // Otherwise, we assume the web app dashboard is hosted on the same domain or we link to root of serverUrl
    if (serverUrl.includes('localhost:5000')) {
      registerLink.href = 'http://localhost:5173';
    } else {
      // Stripping /api if it exists and trying to point to the base domain
      registerLink.href = serverUrl.replace(/\/api$/, '').replace(/:5000$/, ':5173');
    }
  }

  // Handle Login Submission
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    const serverUrl = serverUrlInput.value.trim();

    // Show loading state
    loginSpinner.classList.remove('hidden');
    loginBtnText.textContent = 'Signing In...';
    btnLogin.disabled = true;
    loginErrorDiv.classList.add('hidden');

    chrome.runtime.sendMessage({
      action: 'login',
      data: { email, password, serverUrl }
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
      btnSync.innerHTML = '<span class="icon">🔄</span> Sync Now';

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
