const DEFAULT_SERVER_URL = 'http://localhost:5000';

// Helper to get server URL from storage or fallback
async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl'], (result) => {
      resolve(result.serverUrl || DEFAULT_SERVER_URL);
    });
  });
}

// Check if token is expired based on the 24-hour offline rule
async function checkTokenExpiry() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['token', 'syncTimestamp'], (result) => {
      if (!result.token) {
        resolve({ valid: false, reason: 'NO_TOKEN' });
        return;
      }

      if (!result.syncTimestamp) {
        // No timestamp found, force re-login for safety
        clearAuthCache();
        resolve({ valid: false, reason: 'NO_TIMESTAMP' });
        return;
      }

      const delta = Date.now() - result.syncTimestamp;
      const twentyFourHours = 24 * 60 * 60 * 1000;

      if (delta > twentyFourHours) {
        clearAuthCache();
        resolve({ valid: false, reason: 'EXPIRED' });
      } else {
        resolve({ valid: true, token: result.token });
      }
    });
  });
}

function clearAuthCache() {
  chrome.storage.local.remove(['token', 'syncTimestamp', 'profiles', 'userEmail']);
}

// Fetch profiles from server
async function fetchProfiles(token) {
  const serverUrl = await getServerUrl();
  const response = await fetch(`${serverUrl}/api/profiles`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAuthCache();
      throw new Error('AUTH_FAILED');
    }
    throw new Error('SERVER_ERROR');
  }

  const profiles = await response.json();
  
  // Cache profiles and update sync timestamp
  await new Promise((resolve) => {
    chrome.storage.local.set({ 
      profiles, 
      syncTimestamp: Date.now() 
    }, resolve);
  });

  return profiles;
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkAuth') {
    checkTokenExpiry().then((authStatus) => {
      sendResponse(authStatus);
    });
    return true; // Keep channel open for async response
  }

  if (message.action === 'login') {
    const { email, password, serverUrl } = message.data;
    
    // Save server URL first if provided
    if (serverUrl) {
      chrome.storage.local.set({ serverUrl });
    }

    getServerUrl().then((url) => {
      fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((err) => { throw new Error(err.error || 'Login failed') });
        }
        return res.json();
      })
      .then((data) => {
        // Save token and email
        chrome.storage.local.set({
          token: data.token,
          userEmail: data.user.email,
          syncTimestamp: Date.now()
        }, () => {
          // Immediately pull profiles to cache them
          fetchProfiles(data.token)
            .then((profiles) => {
              sendResponse({ success: true, user: data.user, profiles });
            })
            .catch((err) => {
              // Even if sync fails initially, login succeeded
              sendResponse({ success: true, user: data.user, profiles: [], syncWarning: true });
            });
        });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    });
    return true;
  }

  if (message.action === 'sync') {
    checkTokenExpiry().then((authStatus) => {
      if (!authStatus.valid) {
        sendResponse({ success: false, error: 'Authentication expired or missing' });
        return;
      }

      fetchProfiles(authStatus.token)
        .then((profiles) => {
          sendResponse({ success: true, profiles });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
    });
    return true;
  }

  if (message.action === 'logout') {
    clearAuthCache();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'getProfiles') {
    checkTokenExpiry().then((authStatus) => {
      if (!authStatus.valid) {
        sendResponse({ success: false, error: authStatus.reason, profiles: [] });
        return;
      }

      // Try to fetch latest in background if online, otherwise return cache
      chrome.storage.local.get(['profiles'], (result) => {
        sendResponse({ 
          success: true, 
          profiles: result.profiles || [],
          syncTimestamp: authStatus.syncTimestamp 
        });

        // Background sync
        fetchProfiles(authStatus.token).catch((err) => {
          console.warn('Background sync failed:', err.message);
        });
      });
    });
    return true;
  }
});
