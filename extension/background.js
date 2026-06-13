// Load public configuration
importScripts('config.js');

// Helper to check if credentials are set
function isConfigured() {
  return FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY" && FIREBASE_CONFIG.projectId !== "YOUR_PROJECT_ID";
}

// Check if token is expired based on the 24-hour system time rule
async function checkTokenExpiry() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['token', 'syncTimestamp', 'userId', 'userEmail'], (result) => {
      if (!result.token) {
        resolve({ valid: false, reason: 'NO_TOKEN' });
        return;
      }

      if (!result.syncTimestamp) {
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
        resolve({ 
          valid: true, 
          token: result.token, 
          userId: result.userId, 
          userEmail: result.userEmail,
          syncTimestamp: result.syncTimestamp
        });
      }
    });
  });
}

function clearAuthCache() {
  chrome.storage.local.remove(['token', 'syncTimestamp', 'profiles', 'userEmail', 'userId']);
}

// Parse structured Firestore document back into clean JSON
function parseFirestoreFields(fields) {
  const result = {};
  if (!fields) return result;
  for (const [key, val] of Object.entries(fields)) {
    result[key] = parseValue(val);
  }
  return result;
}

function parseValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.arrayValue !== undefined) {
    const list = val.arrayValue.values || [];
    return list.map(item => parseValue(item));
  }
  if (val.mapValue !== undefined) {
    return parseFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

// Fetch profiles directly from Firestore REST API
async function fetchProfilesFromFirestore(token, userId, userEmail) {
  if (!isConfigured()) {
    throw new Error('CONFIG_REQUIRED');
  }

  const projectId = FIREBASE_CONFIG.projectId;
  const email = userEmail.toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

  // Query 1: Profiles owned by the user
  const queryOwned = {
    structuredQuery: {
      from: [{ collectionId: 'profiles' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'userId' },
          op: 'EQUAL',
          value: { stringValue: userId }
        }
      }
    }
  };

  // Query 2: Profiles shared with this user's email
  const queryShared = {
    structuredQuery: {
      from: [{ collectionId: 'profiles' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'sharedWith' },
          op: 'ARRAY_CONTAINS',
          value: { stringValue: email }
        }
      }
    }
  };

  const executeQuery = async (queryPayload) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(queryPayload)
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('AUTH_FAILED');
      }
      throw new Error('FIRESTORE_ERROR');
    }

    const results = await response.json();
    
    // Parse results
    // Firestore runQuery returns an array of objects containing document or empty objects
    const parsedDocs = [];
    results.forEach((res) => {
      if (res.document) {
        const docName = res.document.name;
        const id = docName.substring(docName.lastIndexOf('/') + 1);
        const parsedData = parseFirestoreFields(res.document.fields);
        parsedDocs.push({
          id,
          ...parsedData
        });
      }
    });

    return parsedDocs;
  };

  // Run queries in parallel
  const [ownedProfiles, sharedProfiles] = await Promise.all([
    executeQuery(queryOwned),
    executeQuery(queryShared)
  ]);

  // Merge results, removing duplicates
  const allProfiles = [...ownedProfiles];
  const ownedIds = new Set(ownedProfiles.map(p => p.id));
  
  sharedProfiles.forEach((p) => {
    if (!ownedIds.has(p.id)) {
      allProfiles.push(p);
    }
  });

  // Cache profiles and update timestamp
  await new Promise((resolve) => {
    chrome.storage.local.set({ 
      profiles: allProfiles, 
      syncTimestamp: Date.now() 
    }, resolve);
  });

  return allProfiles;
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkAuth') {
    checkTokenExpiry().then((authStatus) => {
      sendResponse(authStatus);
    });
    return true;
  }

  if (message.action === 'login') {
    if (!isConfigured()) {
      sendResponse({ success: false, error: 'Firebase keys not set. Configure config.js first.' });
      return false;
    }

    const { email, password } = message.data;
    const loginUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`;

    fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    })
    .then((res) => {
      if (!res.ok) {
        return res.json().then((err) => { 
          throw new Error(err.error?.message || 'Login failed');
        });
      }
      return res.json();
    })
    .then((data) => {
      // Save details to local storage
      chrome.storage.local.set({
        token: data.idToken,
        userId: data.localId,
        userEmail: data.email,
        syncTimestamp: Date.now()
      }, () => {
        // Fetch profiles
        fetchProfilesFromFirestore(data.idToken, data.localId, data.email)
          .then((profiles) => {
            sendResponse({ success: true, user: { id: data.localId, email: data.email }, profiles });
          })
          .catch((err) => {
            sendResponse({ success: true, user: { id: data.localId, email: data.email }, profiles: [], syncWarning: true });
          });
      });
    })
    .catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.action === 'sync') {
    checkTokenExpiry().then((authStatus) => {
      if (!authStatus.valid) {
        sendResponse({ success: false, error: 'Authentication expired or missing' });
        return;
      }

      fetchProfilesFromFirestore(authStatus.token, authStatus.userId, authStatus.userEmail)
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

      chrome.storage.local.get(['profiles'], (result) => {
        sendResponse({ 
          success: true, 
          profiles: result.profiles || [],
          syncTimestamp: authStatus.syncTimestamp 
        });

        // Trigger background sync silently if online
        fetchProfilesFromFirestore(authStatus.token, authStatus.userId, authStatus.userEmail)
          .catch((err) => console.log('Background sync failed:', err.message));
      });
    });
    return true;
  }
});
